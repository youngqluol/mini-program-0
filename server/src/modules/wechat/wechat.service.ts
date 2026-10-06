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

/** 微信 access_token 在 Redis 里的 key */
const ACCESS_TOKEN_KEY = 'wechat:mp:access_token';
/** 微信 access_token 有效期 7200 秒，提前 5 分钟过期避免边界失败 */
const ACCESS_TOKEN_TTL = 7200 - 300;

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
  ): Promise<T & Partial<WxError>> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
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
