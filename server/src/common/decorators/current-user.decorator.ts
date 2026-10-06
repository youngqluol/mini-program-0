import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@shared';

/** 标记接口无需登录。配合全局 JwtAuthGuard 使用。 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 挂在 `request.user` 上的当前登录用户 */
export interface CurrentUserPayload {
  /** users.id */
  userId: bigint;
  /** 小程序 openid */
  openid: string;
}

/**
 * 取当前登录用户。
 *
 * 用法：
 *   @CurrentUser() user: CurrentUserPayload          // 整个对象
 *   @CurrentUser('userId') userId: bigint            // 只要 userId
 *
 * ⚠️ 只有经过 `JwtAuthGuard` 的路由才能拿到值。
 *    如果拿到 undefined，先检查路由是不是被 `@Public()` 放行了。
 */
export const CurrentUser = createParamDecorator(
  (field: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = req.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

/** 供 JwtAuthGuard 复用：JWT 载荷 → 请求上下文用户 */
export function payloadToUser(payload: JwtPayload): CurrentUserPayload {
  return { userId: BigInt(payload.sub), openid: payload.openid };
}
