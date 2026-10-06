/**
 * 业务错误码 —— **小程序侧镜像**
 *
 * ⚠️⚠️ 权威来源是 `packages/shared/src/error-codes.ts`。改那边必须同步改这里。
 *      一致性由 `node tools/check-shared.mjs` 校验（会比对两边的数值）。
 *
 * 为什么不能直接 `import { ErrorCode } from '@shared'`：
 *   微信开发者工具的 TypeScript 编译插件由 **@babel/plugin-transform-typescript**
 *   实现，官方文档写明它「仅仅是移除了 ts 代码中类型声明等信息」——
 *   也就是**只做类型擦除，不做模块解析、不读 tsconfig 的 paths**。
 *   于是：
 *     `import type { ApiResponse } from '@shared/dto/common'` → 整条被擦除，运行时安全 ✓
 *     `import { ErrorCode } from '@shared'`                   → 保留 `require('@shared')`，
 *                                                               运行时 MODULE_NOT_FOUND ✗
 *
 *   结论（写小程序端代码时请守住）：
 *     **类型可以引 shared，运行时的值必须在小程序侧定义。**
 *
 * 为什么用 `as const` 对象而不是 `enum`：
 *   `@babel/plugin-transform-typescript` 默认不转换 `enum`（需要额外的
 *   `@babel/plugin-transform-typescript` 配置或 `babel-plugin-const-enum`），
 *   直接写 `enum` 有编译风险。对象字面量 + `as const` 在任何链路下都安全。
 */

export const ErrorCode = {
  /** 成功 */
  OK: 0,

  // ---- 4xxxx 客户端问题 ----
  /** 参数校验失败 */
  INVALID_PARAM: 40001,
  /** 内容包含敏感词 */
  SENSITIVE_CONTENT: 40002,
  /** 未登录 / token 缺失 */
  UNAUTHORIZED: 40100,
  /** token 过期 */
  TOKEN_EXPIRED: 40101,
  /** 不是该家庭成员 */
  NOT_FAMILY_MEMBER: 40300,
  /** 无权限操作（非创建者） */
  FORBIDDEN: 40301,
  /** 资源不存在 */
  NOT_FOUND: 40400,
  /** 冲突（称谓重复 / 已加入家庭 / 邀请码已用） */
  CONFLICT: 40900,
  /** 请求过于频繁 */
  TOO_MANY_REQUESTS: 42900,

  // ---- 5xxxx 服务端问题 ----
  /** 服务端异常 */
  INTERNAL_ERROR: 50000,
  /** 微信接口调用失败 */
  WECHAT_API_FAILED: 50001,
  /** 推送失败（所有通道都失败） */
  PUSH_FAILED: 50002,
  /** 绑定码无效或已过期 */
  BIND_CODE_INVALID: 50003,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 需要「静默重登后重放请求」的错误码（见 services/request.ts） */
export const RELOGIN_CODES: readonly number[] = [ErrorCode.UNAUTHORIZED, ErrorCode.TOKEN_EXPIRED];

/** 网络异常时的兜底文案（后端没机会返回 message 的情况） */
export const NETWORK_ERROR_MESSAGE = '网络打了个盹，再试一次';
