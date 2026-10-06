import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { BusinessException } from '../../common/errors/business.exception';

/**
 * 微信小程序服务端 API 封装 —— **唯一允许直接调微信 HTTP 接口的地方**。
 *
 * 职责边界：
 *   ✅ code2Session / access_token 管理 / 订阅消息下发
 *   ❌ 不做通道选择、不写 notification_logs、不组装业务文案
 *      （那些是 `modules/notify` 的事）
 *
 * 所有方法在微信返回错误时抛 `BusinessException.wechatFailed()`，
 * 由全局过滤器统一转成 50001 —— 调用方不需要自己解析 errcode。
 */

/** 微信 code2Session 成功返回 */
export interface Code2SessionResult {
  openid: string;
  unionid: string | null;
  sessionKey: string;
}

/** 微信错误响应 */
interface WxError {
  errcode: number;
  errmsg: string;
}

/** 内容安全检测结论 */
export type SecCheckSuggest = 'pass' | 'review' | 'risky';

/** `msgSecCheck` 的结果 */
export interface MsgSecCheckResult {
  /** 微信**是否给出了结论**。`false` = 这次没判断出来（网络 / 凭证 / errcode） */
  ok: boolean;
  /** `ok=true` 时一定有值；`ok=false` 时为 null —— 别把 null 当成 pass */
  suggest: SecCheckSuggest | null;
  /** 微信给的违规标签（广告 / 时政 / 色情 …），**只用于日志**，不回给用户 */
  label: number | null;
  errcode?: number;
  errmsg?: string;
}

/** `msgSecCheck` 原始响应（version=2） */
interface MsgSecCheckResponse {
  errcode?: number;
  errmsg?: string;
  result?: { suggest?: SecCheckSuggest; label?: number };
  detail?: unknown[];
  trace_id?: string;
}

/**
 * `msgSecCheck` 的场景值（微信文档）。
 *
 * 本项目用 `SOCIAL_LOG`：「留个念」的文字是**家人之间的分享**，
 * 不是公开评论、也不是用户资料。场景值只影响微信的风控口径，
 * 传错不会报错，但传对了误判更少。
 */
export const SEC_CHECK_SCENE = {
  /** 资料 */
  PROFILE: 1,
  /** 评论 */
  COMMENT: 2,
  /** 论坛 */
  FORUM: 3,
  /** 社交日志 */
  SOCIAL_LOG: 4,
} as const;

/** v1 时代用 errcode 表示违规；v2 改放 `result.suggest`，但部分账号仍会以 errcode 返回 */
const SEC_CHECK_ERRCODE_RISKY = 87014;

/** access_token 在 Redis 里的 key */
const ACCESS_TOKEN_KEY = 'wechat:mp:access_token';
/** 微信 access_token 有效期 7200 秒，提前 5 分钟过期避免边界失败 */
const ACCESS_TOKEN_TTL = 7200 - 300;
/** 普通微信接口超时 */
const WX_TIMEOUT_MS = 8000;
/**
 * 内容安全检测的超时**故意比别的接口短**。
 *
 * 它在「创建一条小事」的同步路径上：微信慢 8 秒，用户就干等 8 秒。
 * 检测是**辅助能力**（判不了就放行，见 `ContentSecurityService`），
 * 不值得让家人等 —— 3 秒拿不到结论就直接走。
 */
const SEC_CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  /** 进程内的二级缓存，避免每次下发消息都打一次 Redis */
  private tokenCache: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  // -------------------------------------------------------------
  // 登录凭证
  // -------------------------------------------------------------

  /**
   * 用 `wx.login` 的 code 换 openid（M1-B4）。
   *
   * ⚠️ code 只能用一次，5 分钟有效。前端拿到 401 时重新 `wx.login` 即可。
   */
  async code2Session(code: string): Promise<Code2SessionResult> {
    const appid = this.requireConfig('WX_APPID');
    const secret = this.requireConfig('WX_SECRET');

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    const data = await this.request<{
      openid?: string;
      unionid?: string;
      session_key?: string;
    }>(url, { method: 'GET' }, 'code2Session');

    if (!data.openid) {
      // 常见 errcode：40029 code 无效、45011 频率限制、40226 高风险用户
      throw BusinessException.wechatFailed('登录凭证校验失败，请重新进入小程序');
    }

    return {
      openid: data.openid,
      unionid: data.unionid ?? null,
      sessionKey: data.session_key ?? '',
    };
  }

  // -------------------------------------------------------------
  // access_token
  // -------------------------------------------------------------

  /**
   * 获取 access_token。
   *
   * ⚠️ 微信对 access_token 的获取有频率限制（2000 次/天），
   *    且**新 token 会让旧 token 失效**。所以必须缓存、不能每次现取。
   *    三级缓存：进程内 → Redis → 微信接口。
   */
  async getAccessToken(force = false): Promise<string> {
    if (!force && this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.value;
    }

    if (!force) {
      const cached = await this.redis.get(ACCESS_TOKEN_KEY);
      if (cached) {
        this.tokenCache = {
          value: cached,
          expiresAt: Date.now() + ACCESS_TOKEN_TTL * 1000,
        };
        return cached;
      }
    }

    const appid = this.requireConfig('WX_APPID');
    const secret = this.requireConfig('WX_SECRET');
    const url =
      'https://api.weixin.qq.com/cgi-bin/token' +
      `?grant_type=client_credential&appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}`;

    const data = await this.request<{ access_token?: string; expires_in?: number }>(
      url,
      { method: 'GET' },
      'getAccessToken',
    );

    if (!data.access_token) {
      throw BusinessException.wechatFailed('获取微信凭证失败');
    }

    const ttl = Math.max((data.expires_in ?? 7200) - 300, 60);
    this.tokenCache = {
      value: data.access_token,
      expiresAt: Date.now() + ttl * 1000,
    };
    await this.redis.set(ACCESS_TOKEN_KEY, data.access_token, ttl);

    return data.access_token;
  }

  /** 主动让本地缓存失效（收到 40001 / 42001 时调用，然后重试一次） */
  invalidateAccessToken(): void {
    this.tokenCache = null;
  }

  // -------------------------------------------------------------
  // 订阅消息
  // -------------------------------------------------------------

  /**
   * 下发一条订阅消息（辅助通道）。
   *
   * @param touser    小程序 openid（注意不是公众号 openid）
   * @param templateId 订阅消息模板 ID
   * @param data      模板数据，字段名必须与模板严格一致
   * @param page      点击后跳转的页面
   *
   * @returns `{ ok, errcode }`。**不抛异常** —— 订阅消息是辅助通道，
   *          失败必须能安静降级，不能打断主流程。
   */
  async sendSubscribeMessage(params: {
    touser: string;
    templateId: string;
    data: Record<string, { value: string }>;
    page?: string;
  }): Promise<{ ok: boolean; errcode?: number; errmsg?: string }> {
    const send = async (token: string) => {
      const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`;
      return this.request<{ errcode?: number; errmsg?: string }>(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: params.touser,
            template_id: params.templateId,
            page: params.page,
            data: params.data,
          }),
        },
        'subscribeMessage.send',
      );
    };

    try {
      let token = await this.getAccessToken();
      let res = await send(token);

      // 40001/42001 = access_token 失效，刷新一次再试
      if (res.errcode === 40001 || res.errcode === 42001) {
        this.invalidateAccessToken();
        token = await this.getAccessToken(true);
        res = await send(token);
      }

      if (res.errcode === 0) return { ok: true };

      // 43101 = 用户拒收 / 无订阅额度；47003 = 模板字段不匹配（开发期常见）
      this.logger.warn(
        `订阅消息下发失败 touser=${maskOpenid(params.touser)} errcode=${res.errcode} errmsg=${res.errmsg}`,
      );
      return { ok: false, errcode: res.errcode, errmsg: res.errmsg };
    } catch (e) {
      this.logger.warn(
        `订阅消息下发异常: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { ok: false, errmsg: e instanceof Error ? e.message : String(e) };
    }
  }

  // -------------------------------------------------------------
  // 内容安全（M2-B9）
  // -------------------------------------------------------------

  /**
   * 文本内容安全检测（`security.msgSecCheck`）。
   *
   * 小程序审核的硬性要求（docs/01 §六、PRD §18.4）：用户生成文字必须过这一关。
   *
   * ⚠️ 但与 `sendSubscribeMessage` 同理 —— **本方法不抛异常**：
   *    「内容违规」要拦人，「检测本身失败」不该拦人。
   *    这里只如实返回「判出来了没有、判成什么」，怎么处理交给
   *    `ContentSecurityService`（那里是唯一的策略点）。
   *
   * @param openid  用户的小程序 openid。v2 接口要求传，微信据此做风控。
   * @param content 待检测文本（微信上限 2500 字，调用方先截断）
   * @param scene   场景值，见 `SEC_CHECK_SCENE`
   */
  async msgSecCheck(params: {
    openid: string;
    content: string;
    scene?: number;
  }): Promise<MsgSecCheckResult> {
    const call = async (token: string) => {
      const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`;
      return this.request<MsgSecCheckResponse>(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: 2,
            openid: params.openid,
            scene: params.scene ?? SEC_CHECK_SCENE.SOCIAL_LOG,
            content: params.content,
          }),
        },
        'msgSecCheck',
        SEC_CHECK_TIMEOUT_MS,
      );
    };

    try {
      let token = await this.getAccessToken();
      let res = await call(token);

      // 40001/42001 = access_token 失效，刷新一次再试
      if (res.errcode === 40001 || res.errcode === 42001) {
        this.invalidateAccessToken();
        token = await this.getAccessToken(true);
        res = await call(token);
      }

      // 老接口形态：违规直接给 errcode
      if (res.errcode === SEC_CHECK_ERRCODE_RISKY) {
        return { ok: true, suggest: 'risky', label: null };
      }

      if (res.errcode === 0) {
        const suggest = res.result?.suggest;
        if (!suggest) {
          // errcode=0 却没有结论 —— 属于「没判断出来」，**不要当 pass**
          this.logger.warn('msgSecCheck 返回 ok 但缺 suggest');
          return { ok: false, suggest: null, label: null, errmsg: 'missing suggest' };
        }
        return { ok: true, suggest, label: res.result?.label ?? null };
      }

      // 常见：48001 接口未授权（个人主体 / 未开通）、61010 openid 不合法、
      //       45009 调用超频。都走「判不了」这条路，由调用方决定放不放行。
      this.logger.warn(`msgSecCheck 失败 errcode=${res.errcode} errmsg=${res.errmsg}`);
      return {
        ok: false,
        suggest: null,
        label: null,
        errcode: res.errcode,
        errmsg: res.errmsg,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`msgSecCheck 异常: ${msg}`);
      return { ok: false, suggest: null, label: null, errmsg: msg };
    }
  }

  // -------------------------------------------------------------
  // 内部实现
  // -------------------------------------------------------------

  private requireConfig(key: string): string {
    const v = this.config.get<string>(key)?.trim();
    if (!v) {
      // 配置缺失是**部署问题**，不是用户问题；直接抛 500 让运维看到
      throw BusinessException.wechatFailed(`缺少环境变量 ${key}`);
    }
    return v;
  }

  /**
   * 统一 HTTP 调用。
   *
   * 微信有个坑：**HTTP 200 不代表成功**，业务错误码在 body 里。
   * 所以这里只负责网络层与 JSON 解析，业务判断交给调用方。
   */
  private async request<T>(
    url: string,
    init: RequestInit,
    op: string,
    timeoutMs: number = WX_TIMEOUT_MS,
  ): Promise<T & Partial<WxError>> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`微信接口 ${op} 网络异常: ${msg}`);
      throw BusinessException.wechatFailed('网络打了个盹，再试一次');
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as T & Partial<WxError>;
    } catch {
      this.logger.error(`微信接口 ${op} 返回非 JSON: ${text.slice(0, 200)}`);
      throw BusinessException.wechatFailed('微信接口返回异常');
    }
  }
}

/** 日志里不要打完整 openid */
function maskOpenid(openid: string): string {
  if (!openid || openid.length <= 8) return '***';
  return `${openid.slice(0, 4)}***${openid.slice(-4)}`;
}
