import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MP_TEMPLATE_SPECS, MpTemplateKind } from './notify.templates';

/**
 * wxpush 客户端 —— 唯一允许调用 Cloudflare Worker 的地方。
 *
 * 职责边界（不要越界）：
 *   ✅ 拼参数、发 HTTP、解析微信错误码
 *   ❌ 不做通道选择、不写数据库、不组装业务文案
 *
 * Worker 侧代码见 `wxpush/index.js`，部署与配置见
 * `docs/08-wxpush推送集成方案.md`。
 */

/** 微信返回的错误码 → 业务含义 */
export const WX_ERRCODE = {
  /** 用户未关注公众号（或已取关） */
  NOT_SUBSCRIBED: 43004,
  /** access_token 失效 */
  TOKEN_INVALID: 40001,
  TOKEN_EXPIRED: 42001,
  /** 模板参数不匹配 —— 开发期最常见，模板字段名与 data 对不上 */
  TEMPLATE_MISMATCH: 47003,
  /** 接口调用超限 */
  RATE_LIMIT: 45009,
} as const;

export interface WxpushSendOptions {
  /** 接收人的**公众号** openid（注意：不是小程序 openid） */
  userid: string;
  /** 消息标题 */
  title: string;
  /** 消息正文 */
  content: string;
  /** 公众号模板数据。字段名必须与后台模板严格一致，否则 47003 */
  data?: Record<string, { value: string }> | null;
  /** 模板种类 —— 客户端据此从环境变量读取模板 ID */
  templateKind?: MpTemplateKind;
  /** 直接指定模板 ID（优先级高于 templateKind） */
  templateId?: string;
  /** 跳转小程序 appid；不传则用环境变量 MP_APPID */
  miniprogramAppid?: string;
  /** 跳转小程序页面路径 */
  miniprogramPagepath?: string;
  /** 防重 ID：微信侧 24h 内相同 ID 只会发送一次 */
  clientMsgId?: string;
}

export interface WxpushSendResult {
  ok: boolean;
  /**
   * 通道**未启用/未配置**，而非发送失败。
   * 调用方应静默降级到下一通道，**不要**记成 FAILED。
   */
  skipped?: boolean;
  /** 微信错误码；成功时为 undefined */
  errcode?: number;
  /** 微信错误描述 / Worker 返回文本 */
  errmsg?: string;
  /** 网络层或配置层错误 */
  error?: string;
}

@Injectable()
export class WxpushClient {
  private readonly logger = new Logger(WxpushClient.name);

  constructor(private readonly config: ConfigService) {}

  /** 通道总开关。产品化拆除时只需把 NOTIFY_MP_ENABLED 置为 false。 */
  get enabled(): boolean {
    return this.config.get<string>('NOTIFY_MP_ENABLED') !== 'false';
  }

  /**
   * 发送一条公众号模板消息。
   *
   * 内置一次**降级重试**：如果配置了 `miniprogram` 字段但发送失败
   * （测试号可能不支持该字段，见 PRD 假设 A6），会自动去掉该字段重发一次，
   * 让消息至少能送到，跳转降级为中转页。
   */
  async send(options: WxpushSendOptions): Promise<WxpushSendResult> {
    if (!this.enabled) {
      return { ok: false, skipped: true, error: 'MP channel disabled (NOTIFY_MP_ENABLED=false)' };
    }

    const templateId = this.resolveTemplateId(options);
    if (!templateId) {
      const spec = options.templateKind ? MP_TEMPLATE_SPECS[options.templateKind] : undefined;
      const hint = spec ? `${spec.name}（${spec.envKey}）` : 'templateId';
      this.logger.warn(`模板 ID 未配置：${hint}，跳过公众号模板消息通道`);
      return { ok: false, skipped: true, error: `template id not configured: ${hint}` };
    }

    const mpAppid = options.miniprogramAppid ?? this.config.get<string>('MP_APPID');
    const first = await this.post(options, mpAppid, templateId);

    // 带了 miniprogram 却失败 → 去掉它再试一次
    if (!first.ok && mpAppid) {
      this.logger.warn(
        `带 miniprogram 字段发送失败（errcode=${first.errcode}），去掉该字段重试一次`,
      );
      const second = await this.post(options, undefined, templateId);
      if (second.ok) return second;
      // 两次都失败，返回第一次的错误（更接近根因）
      return first;
    }

    return first;
  }

  // -------------------------------------------------------------
  // 内部实现
  // -------------------------------------------------------------

  /** 显式传入的 templateId 优先；否则按 templateKind 查环境变量 */
  private resolveTemplateId(options: WxpushSendOptions): string | undefined {
    if (options.templateId?.trim()) return options.templateId.trim();
    if (!options.templateKind) return undefined;

    const spec = MP_TEMPLATE_SPECS[options.templateKind];
    const fromEnv = this.config.get<string>(spec.envKey)?.trim();
    return fromEnv || undefined;
  }

  private async post(
    options: WxpushSendOptions,
    mpAppid: string | undefined,
    templateId: string,
  ): Promise<WxpushSendResult> {
    const baseUrl = this.config.get<string>('WXPUSH_URL');
    const token = this.config.get<string>('WXPUSH_TOKEN');
    if (!baseUrl || !token) {
      this.logger.warn('WXPUSH_URL / WXPUSH_TOKEN 未配置，跳过公众号模板消息通道');
      return { ok: false, skipped: true, error: 'WXPUSH_URL or WXPUSH_TOKEN not configured' };
    }

    const body: Record<string, unknown> = {
      userid: options.userid,
      title: options.title,
      content: options.content,
      // ⚠️ 必须显式传 template_id：Worker 的 env.WX_TEMPLATE_ID 是单个默认值，
      //    不传的话三种通知会全用同一个模板，字段对不上直接 47003。
      template_id: templateId,
    };
    if (options.data) body.data = options.data;
    if (options.clientMsgId) body.client_msg_id = options.clientMsgId;
    if (mpAppid) {
      body.miniprogram_appid = mpAppid;
      body.miniprogram_pagepath =
        options.miniprogramPagepath ??
        this.config.get<string>('MP_PAGEPATH') ??
        'pages/index/index';
    }

    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/wxsend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          // Worker 支持 "Bearer <token>" 或裸 token 两种格式
          Authorization: token,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });

      const text = await res.text();
      const parsed = safeJsonParse(text);

      if (res.ok) {
        return { ok: true, errmsg: parsed?.msg ?? 'ok' };
      }

      // Worker 返回 4xx/5xx 时，msg 里通常夹着微信的原始错误
      const raw = parsed?.msg ?? text;
      const { errcode, errmsg } = this.parseWechatError(raw);
      this.logger.warn(
        `wxpush 发送失败 userid=${maskOpenid(options.userid)} errcode=${errcode} errmsg=${errmsg}`,
      );
      return { ok: false, errcode, errmsg, error: raw };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.error(`wxpush 请求异常: ${error}`);
      return { ok: false, error };
    }
  }

  /** 从 Worker 的文本里抠出微信错误码，例如 "Failed to send messages. First error: 43004" */
  private parseWechatError(raw: unknown): { errcode?: number; errmsg: string } {
    const s = typeof raw === 'string' ? raw : String(raw ?? '');
    const m = /(?:^|\D)(\d{4,5})(?:\D|$)/.exec(s);
    return { errcode: m ? Number(m[1]) : undefined, errmsg: s };
  }
}

function safeJsonParse(text: string): { msg?: string } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 日志里不要打完整 openid */
function maskOpenid(openid: string): string {
  if (!openid || openid.length <= 8) return '***';
  return `${openid.slice(0, 4)}***${openid.slice(-4)}`;
}
