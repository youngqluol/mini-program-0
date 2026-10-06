import type { PipeTransform } from '@nestjs/common';
import { BusinessException } from '../errors/business.exception';

/**
 * 路径参数 → bigint。
 *
 * 为什么需要：`users.id` 等主键在 Prisma 里是 `bigint`，但 URL 参数永远是字符串。
 * 直接用 `BigInt(raw)` 会在 `/families/abc` 这类输入上抛 `SyntaxError`，
 * 被兜成 50000「出了点小问题」；而正确答案是 40001「参数不对」。
 *
 * ⚠️ 这里用**工厂函数**而不是 `@Injectable()` 的类，是刻意的：
 *    Nest 见到带构造参数的类就会尝试依赖注入，而 `what` 只是配置项，
 *    结果就是启动时报 `Nest can't resolve dependencies of ParseBigIntPipe (?)`。
 *    工厂返回普通对象，Nest 直接拿来用，不碰 DI。
 *
 * 用法：`@Param('memberId', parseBigInt('成员')) memberId: bigint`
 */
export function parseBigInt(what = '参数'): PipeTransform<string, bigint> {
  return {
    transform(value: string): bigint {
      const s = String(value ?? '').trim();
      if (!/^\d+$/.test(s)) {
        throw BusinessException.invalidParam(`${what}不对`);
      }
      return BigInt(s);
    },
  };
}
