import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtPayload } from '@shared';
import { BusinessException } from '../errors/business.exception';
import {
  CurrentUserPayload,
  IS_PUBLIC_KEY,
  payloadToUser,
} from '../decorators/current-user.decorator';

/** 挂在 `request.user` 上的当前登录用户（守卫写入，`@CurrentUser()` 读取） */
type AuthedRequest = Request & { user?: CurrentUserPayload };

/**
 * JWT 鉴权守卫（全局注册，见 AppModule 的 APP_GUARD）。
 *
 * 默认**所有接口都要登录**，公开接口显式加 `@Public()`。
 * 这个默认值是有意选的：漏加 `@Public()` 的后果是「接口调不通」，
 * 而漏加鉴权的后果是「数据裸奔」。前者开发期就会暴露，后者不会。
 *
 * 用 `@nestjs/jwt` 直接实现，不引入 passport —— 这里只需要验签一个
 * HS256 token，passport 那套策略 / 序列化是多余的抽象。
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractBearerToken(req);
    if (!token) throw BusinessException.unauthorized();

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      req.user = payloadToUser(payload);
      return true;
    } catch (e) {
      // 区分「过期」与「无效」：过期要静默重登后重放请求，无效要重新走登录流程
      if (e instanceof Error && e.name === 'TokenExpiredError') {
        throw BusinessException.tokenExpired();
      }
      throw BusinessException.unauthorized();
    }
  }
}

/** 从 `Authorization: Bearer xxx` 里取出 token，兼容裸 token 写法 */
function extractBearerToken(req: Request): string | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : raw.trim() || null;
}
