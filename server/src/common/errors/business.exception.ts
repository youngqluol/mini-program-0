import { HttpException } from '@nestjs/common';
import { ErrorCode, ERROR_MESSAGE, httpStatusOf } from '@shared';

/**
 * 业务异常 —— 业务代码里**只允许抛这个**，不要抛裸 `Error`。
 *
 * 为什么：`Error` 会被全局过滤器兜成 50000「出了点小问题」，
 * 用户看到的是无意义的通用文案；而业务异常能带上准确的 `code`
 * 与用户看得懂的一句话。
 *
 * 用法：
 *   throw new BusinessException(ErrorCode.CONFLICT, '这个称谓家里已经有人用啦');
 *   throw BusinessException.notFound('这个邀请码');
 */
export class BusinessException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    const msg = message ?? ERROR_MESSAGE[code];
    super({ code, message: msg }, httpStatusOf(code));
    this.code = code;
  }

  // -------------------------------------------------------------
  // 常用快捷构造 —— 减少各处重复写 code
  // -------------------------------------------------------------

  /** 40001 参数校验失败 */
  static invalidParam(message?: string): BusinessException {
    return new BusinessException(ErrorCode.INVALID_PARAM, message);
  }

  /**
   * 40002 内容包含敏感词（docs/02 §1.2）。
   *
   * 默认文案是「内容需要修改一下」—— **不要**回微信给的理由（label / 命中词），
   * 那既没帮助又像在指责人。家里人不该被系统审判。
   */
  static sensitiveContent(message?: string): BusinessException {
    return new BusinessException(ErrorCode.SENSITIVE_CONTENT, message);
  }

  /** 40300 不是该家庭成员 */
  static notMember(): BusinessException {
    return new BusinessException(ErrorCode.NOT_FAMILY_MEMBER);
  }

  /** 40301 无权限（非创建者） */
  static forbidden(message?: string): BusinessException {
    return new BusinessException(ErrorCode.FORBIDDEN, message);
  }

  /**
   * 40400 资源不存在。
   * 传中文名词，拼成「这个{名词}找不到了」，避免各处硬编码文案。
   */
  static notFound(what: string): BusinessException {
    return new BusinessException(ErrorCode.NOT_FOUND, `这个${what}找不到了`);
  }

  /** 40900 冲突 */
  static conflict(message?: string): BusinessException {
    return new BusinessException(ErrorCode.CONFLICT, message);
  }

  /** 40100 未登录 */
  static unauthorized(message?: string): BusinessException {
    return new BusinessException(ErrorCode.UNAUTHORIZED, message);
  }

  /** 40101 token 过期 */
  static tokenExpired(): BusinessException {
    return new BusinessException(ErrorCode.TOKEN_EXPIRED);
  }

  /** 50001 微信接口调用失败 */
  static wechatFailed(message?: string): BusinessException {
    return new BusinessException(ErrorCode.WECHAT_API_FAILED, message);
  }

  /** 42900 请求过于频繁 */
  static tooManyRequests(message?: string): BusinessException {
    return new BusinessException(ErrorCode.TOO_MANY_REQUESTS, message);
  }
}
