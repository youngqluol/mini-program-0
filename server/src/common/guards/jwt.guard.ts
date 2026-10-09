import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtPayload } from '@shared';
import { EnabledStatus } from '@shared/enums';
import { PrismaService } from '../../prisma/prisma.service';
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
 *
 * ⚠️ **验签之后还要查一次账号状态**（`assertUserActive`）。
 *    JWT 是无状态的：签出去之后到过期之前一直有效，撤销不了。
 *    没有这一查，「账号被禁用」和「账号已注销」都只是数据库里的一行字，
 *    旧 token 照样能刷接口。代价是每个请求多一次主键查询 ——
 *    家庭规模下可以忽略，而换来的是「禁用 / 注销立即生效」。
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
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

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch (e) {
      // 区分「过期」与「无效」：过期要静默重登后重放请求，无效要重新走登录流程
      if (e instanceof Error && e.name === 'TokenExpiredError') {
        throw BusinessException.tokenExpired();
      }
      throw BusinessException.unauthorized();
    }

    const user = payloadToUser(payload);
    // 刻意放在 try 之外：这一步抛的是 40100，不该被上面「解析失败」的 catch 混淆
    await this.assertUserActive(user.userId);

    req.user = user;
    return true;
  }

  /**
   * 账号是否还能用（存在且未被禁用）。
   *
   * ⚠️ **这一查是注销功能的一部分，别当成优化掉。**
   * 注销后 `users.status=0`、`openid` 换成墓碑值，但**已经签出去的 token
   * 仍然验签通过** —— 少了这一步，「注销」就退化成「前端清了一下本地缓存」，
   * 旧 token 还能继续改资料、传图片，直到 7 天后自然过期。
   *
   * 查不到 / 已禁用统一回 **40100（未登录）而不是 40301**，理由是**收场**：
   * 40100 会触发小程序的静默重登，而注销后的 openid 已是墓碑值，
   * 重登命中不了旧行 → 新建一个干净账号 → 落到「创建家庭」引导页，
   * 这正是「你已经注销了」该有的样子。回 40301 则会让用户卡在一个
   * 反复报错的页面上，还得自己找出口。
   */
  private async assertUserActive(userId: bigint): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== EnabledStatus.ENABLED) {
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
