/**
 * 业务错误码 —— 前后端共享的唯一来源（docs/02 §1.2）。
 *
 * 约定：
 *   - HTTP 状态码统一返回 200（业务结果看 `code`），**唯一例外**是
 *     鉴权失败（40100 / 40101）同时返回 HTTP 401，便于前端统一拦截跳登录。
 *   - 前端只认 `code`，不认 HTTP 状态码。这样错误处理只需要写一处。
 */

export enum ErrorCode {
  /** 成功 */
  OK = 0,

  // ---- 4xxxx 客户端问题 ----
  /** 参数校验失败 */
  INVALID_PARAM = 40001,
  /** 内容包含敏感词 */
  SENSITIVE_CONTENT = 40002,
  /** 未登录 / token 缺失 */
  UNAUTHORIZED = 40100,
  /** token 过期 */
  TOKEN_EXPIRED = 40101,
  /** 不是该家庭成员 */
  NOT_FAMILY_MEMBER = 40300,
  /** 无权限操作（非创建者） */
  FORBIDDEN = 40301,
  /** 资源不存在 */
  NOT_FOUND = 40400,
  /** 冲突（称谓重复 / 已加入家庭 / 邀请码已用） */
  CONFLICT = 40900,
  /** 请求过于频繁 */
  TOO_MANY_REQUESTS = 42900,

  // ---- 5xxxx 服务端问题 ----
  /** 服务端异常 */
  INTERNAL_ERROR = 50000,
  /** 微信接口调用失败 */
  WECHAT_API_FAILED = 50001,
  /** 推送失败（所有通道都失败） */
  PUSH_FAILED = 50002,
  /** 绑定码无效或已过期 */
  BIND_CODE_INVALID = 50003,
}

/**
 * 默认用户可见文案。
 *
 * 纪律（AGENTS.md 文案规则）：**不出现技术词、不出现指责性词汇**。
 * 家庭场景里，「操作失败」远不如「出了点小问题，再试一次」。
 */
export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  [ErrorCode.OK]: 'ok',
  [ErrorCode.INVALID_PARAM]: '这个填得不太对，再检查一下～',
  [ErrorCode.SENSITIVE_CONTENT]: '内容需要修改一下',
  [ErrorCode.UNAUTHORIZED]: '请先登录',
  [ErrorCode.TOKEN_EXPIRED]: '登录已过期，请重新进入小程序',
  [ErrorCode.NOT_FAMILY_MEMBER]: '你不在这个家里',
  [ErrorCode.FORBIDDEN]: '只有家里人能改',
  [ErrorCode.NOT_FOUND]: '这个内容找不到了',
  [ErrorCode.CONFLICT]: '这个已经存在啦',
  [ErrorCode.TOO_MANY_REQUESTS]: '慢一点～',
  [ErrorCode.INTERNAL_ERROR]: '出了点小问题，再试一次',
  [ErrorCode.WECHAT_API_FAILED]: '网络打了个盹，再试一次',
  [ErrorCode.PUSH_FAILED]: '没叮成功，稍后再试',
  [ErrorCode.BIND_CODE_INVALID]: '这个码不对或过期了，重新获取一下',
};

/**
 * 该错误码对应的 HTTP 状态码。
 *
 * 只有鉴权失败走真 401，其余一律 200 —— 见文件头约定。
 */
export function httpStatusOf(code: ErrorCode): number {
  if (code === ErrorCode.UNAUTHORIZED || code === ErrorCode.TOKEN_EXPIRED) return 401;
  return 200;
}
