import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { BusinessException } from '../errors/business.exception';

/**
 * 内部接口鉴权守卫。
 *
 * 用于**只给机器调用**的端点：云托管定时任务、运维脚本、保底手工操作。
 * 这些接口不对小程序端开放，因此不用 JWT，改用共享密钥。
 *
 * 请求头：`X-Internal-Secret: <INTERNAL_CRON_SECRET>`
 *
 * ⚠️ 两个细节：
 *   ① 用 `timingSafeEqual` 而不是 `===`，避免通过响应时间差逐字节猜密钥；
 *   ② 密钥未配置时**直接拒绝**（不是放行）—— 配置缺失绝不能变成后门。
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_CRON_SECRET')?.trim();
    if (!expected) {
      throw BusinessException.forbidden('内部接口密钥未配置');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-internal-secret'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided) throw BusinessException.forbidden();

    if (!safeEqual(provided, expected)) throw BusinessException.forbidden();
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // 长度不同直接失败；timingSafeEqual 要求等长入参
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
