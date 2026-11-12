import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeFetchFailure } from '../../common/utils/describe-fetch-failure';
import { MP_TEMPLATE_SPECS, MpTemplateKind } from './notify.templates';

/**
 * 公众号（接口测试号）模板消息客户端 —— **通道一**。
 *
 * 职责边界（与 `notify.service.ts` 分工，不要越界）：
 *   ✅ 取 access_token、拼模板消息体、发 HTTP、解析微信错误码
 *   ❌ 不做通道选择、不写数据库、不组装业务文案
 *
 * 2026-11-12 架构变更：原先这里调的是 Cloudflare Worker（`WXPUSH_URL`），
 * Worker 再去调微信。上海容器出不到 `*.workers.dev`（DNS 污染，`docs/08` §十五 第 8 行），
 * 通道一因此全灭。现在**由后端直接调微信 API** —— 容器到 `api.weixin.qq.com`
 * 是已被登录链路证明可达的那条路（`docs/06` §5.17）。
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
  /** 调用方 IP 不在白名单内 —— 云托管出口 IP 不固定时会撞上 */
  IP_NOT_ALLOWED: 40164,
} as const;

const API_BASE = 'https://api.weixin.qq.com/cgi-bin';
const TOKEN_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 8000;
/** 提前 5 分钟过期，避免卡在有效期边界上拿到已失效的 token */
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

export interface MpSendOptions {
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

export interface MpSendResult {
  ok: boolean;
  /**
   * 通道**未启用/未配置**，而非发送失败。
   * 调用方应静默降级到下一通道，**不要**记成 FAILED。
   */
  skipped?: boolean;
  /** 微信错误码；成功时为 undefined */
  errcode?: number;
  /** 微信错误描述 */
  errmsg?: string;
  /** 网络层或配置层错误 */
  error?: string;
}

interface TokenResult {
  token?: string;
  errcode?: number;
  errmsg?: string;
  error?: string;
}

@Injectable()
export class MpAccountClient {
  private readonly logger = new Logger(MpAccountClient.name);
  private token: { value: string; expiresAt: number } | null = null;
  /**
   * 并发合并：一批通知同时进来时只取一次 token。
   * 不做合并的话每个请求各自打 `stable_token`，白打微信接口。
   */
  private inflight: Promise<TokenResult> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** 通道总开关。停用通道一时置为 false，业务代码一行不用改。 */
  get enabled(): boolean {
    return this.config.get<string>('NOTIFY_MP_ENABLED') !== 'false';
  }

  /**
   * 发送一条公众号模板消息。
   *
   * 内置一次**降级重试**：配了 `miniprogram` 却失败时（测试号没有「关联小程序」的入口，
   * 该字段可能不被接受，见 PRD 假设 A6），去掉该字段重发一次 ——
   * 消息能送到比能点开更重要。
   */
  async send(options: MpSendOptions): Promise<MpSendResult> {
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

    const account = this.account();
    if (!account) {
      this.logger.warn('MP_ACCOUNT_APPID / MP_ACCOUNT_SECRET 未配置，跳过公众号模板消息通道');
      return {
        ok: false,
        skipped: true,
        error: 'MP_ACCOUNT_APPID or MP_ACCOUNT_SECRET not configured',
      };
    }

    const mpAppid = options.miniprogramAppid ?? this.config.get<string>('MP_APPID');
    const first = await this.sendOnce(options, account, mpAppid, templateId);

    if (!first.ok && mpAppid) {
      this.logger.warn(
        `带 miniprogram 字段发送失败（errcode=${first.errcode}），去掉该字段重试一次`,
      );
      const second = await this.sendOnce(options, account, undefined, templateId);
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
  private resolveTemplateId(options: MpSendOptions): string | undefined {
    if (options.templateId?.trim()) return options.templateId.trim();
    if (!options.templateKind) return undefined;

    const spec = MP_TEMPLATE_SPECS[options.templateKind];
    const fromEnv = this.config.get<string>(spec.envKey)?.trim();
    return fromEnv || undefined;
  }

  private account(): { appid: string; secret: string } | null {
    const appid = this.config.get<string>('MP_ACCOUNT_APPID')?.trim();
    const secret = this.config.get<string>('MP_ACCOUNT_SECRET')?.trim();
    return appid && secret ? { appid, secret } : null;
  }

  private async sendOnce(
    options: MpSendOptions,
    account: { appid: string; secret: string },
    mpAppid: string | undefined,
    templateId: string,
  ): Promise<MpSendResult> {
    const tokenRes = await this.accessToken(account);
    if (!tokenRes.token) {
      this.logger.error(
        `拿不到公众号 access_token: errcode=${tokenRes.errcode} errmsg=${tokenRes.errmsg ?? tokenRes.error}`,
      );
      return {
        ok: false,
        errcode: tokenRes.errcode,
        errmsg: tokenRes.errmsg ?? tokenRes.error,
        error: tokenRes.errmsg ?? tokenRes.error,
      };
    }

    const body: Record<string, unknown> = {
      touser: options.userid,
      template_id: templateId,
      data: options.data ?? {
        title: { value: options.title },
        content: { value: options.content },
      },
    };
    if (mpAppid) {
      body.miniprogram = {
        appid: mpAppid,
        pagepath:
          options.miniprogramPagepath ??
          this.config.get<string>('MP_PAGEPATH') ??
          'pages/index/index',
      };
    }
    // url 是 miniprogram 不被接受时的降级跳转（落地页见 landing.controller.ts）
    const landing = this.landingUrl(options);
    if (landing) body.url = landing;
    if (options.clientMsgId) body.client_msg_id = options.clientMsgId;

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/message/template/send?access_token=${tokenRes.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (e) {
      const error = describeFetchFailure(e);
      this.logger.error(`模板消息请求异常 target=${API_BASE}/message/template/send : ${error}`);
      return { ok: false, error };
    }

    const text = await res.text();
    const parsed = safeJsonParse(text);
    const errcode = typeof parsed?.errcode === 'number' ? parsed.errcode : undefined;
    const errmsg = typeof parsed?.errmsg === 'string' ? parsed.errmsg : text.slice(0, 200);

    if (errcode === 0) {
      return { ok: true, errmsg: 'ok' };
    }

    this.logger.warn(
      `模板消息发送失败 userid=${maskOpenid(options.userid)} http=${res.status} errcode=${errcode} errmsg=${errmsg}`,
    );
    return { ok: false, errcode, errmsg, error: text.slice(0, 200) };
  }

  /**
   * access_token —— 走 `stable_token`，**进程内缓存**。
   *
   * 为什么不用老接口 `/token`：那个是「后取的顶掉前一个」，多实例会互相打飞。
   * `stable_token` 同一凭据重复调用返回同一个 token（`force_refresh: false`），
   * 所以云托管多副本 + 重启都安全。
   */
  private async accessToken(account: { appid: string; secret: string }): Promise<TokenResult> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return { token: this.token.value };
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.fetchToken(account).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(account: { appid: string; secret: string }): Promise<TokenResult> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/stable_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          grant_type: 'client_credential',
          appid: account.appid,
          secret: account.secret,
          force_refresh: false,
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (e) {
      return { error: describeFetchFailure(e) };
    }

    const data = safeJsonParse(await res.text());
    if (!data) return { errmsg: 'access_token 返回非 JSON' };
    if (typeof data.access_token !== 'string') {
      return {
        errcode: typeof data.errcode === 'number' ? data.errcode : undefined,
        errmsg: typeof data.errmsg === 'string' ? data.errmsg : '拿不到 access_token',
      };
    }

    const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 7200;
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + expiresInSec * 1000 - TOKEN_SAFETY_MS,
    };
    return { token: data.access_token };
  }

  /**
   * 中转页（落地页）绝对地址 + 查询参数。
   *
   * ⚠️ 只从环境变量取，**不拼任何写死的 host**（AGENTS §4.5）：没配 `MP_LANDING_URL`
   *    就不带 `url` 字段，此时点击跳转全靠 `miniprogram`。
   */
  private landingUrl(options: MpSendOptions): string | undefined {
    const base = this.config.get<string>('MP_LANDING_URL')?.trim();
    if (!base) return undefined;

    const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    const params = new URLSearchParams({
      message: options.content,
      title: options.title,
      date: beijing,
    });
    if (options.templateKind) params.set('kind', options.templateKind);
    return `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
  }
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 日志里不要打完整 openid */
function maskOpenid(openid: string): string {
  if (!openid || openid.length <= 8) return '***';
  return `${openid.slice(0, 4)}***${openid.slice(-4)}`;
}
