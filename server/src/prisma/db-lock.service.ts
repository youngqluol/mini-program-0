import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 基于 MySQL `GET_LOCK` 的分布式锁 —— 取代原来的 Redis 锁。
 *
 * 约束与原理：
 *   - `GET_LOCK` 是**连接级**的：必须在同一个连接上 GET 与 RELEASE。
 *     所以这里把它包在 Prisma 的交互式事务里，事务持有同一条连接。
 *   - 任务本身用普通 Prisma 客户端执行（另一条连接），事务只负责持锁，
 *     不会把「发微信」这种网络调用塞进数据库事务。
 *   - 进程崩溃 / 连接断开时，MySQL 会自动释放该连接持有的锁。
 *   - 事务超时（15 分钟）是最后一道保险：任务异常卡死时连接会被回收，锁随之释放。
 *
 * 为什么不用表模拟锁：`GET_LOCK` 不需要建表、不需要清理过期行，
 * 也不会因为「全库不做物理 DELETE」这条铁律产生冲突。
 */

/** 单次任务允许持有锁的最长时间（同时是交互式事务超时） */
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export interface LockResult<T> {
  /** false = 没抢到锁（另一个实例正在跑），本次什么都没做 */
  locked: boolean;
  result?: T;
}

@Injectable()
export class DbLockService {
  constructor(private readonly prisma: PrismaService) {}

  async withLock<T>(name: string, task: () => Promise<T>): Promise<LockResult<T>> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ ok: number | bigint }>>`
          SELECT GET_LOCK(${name}, 0) AS ok
        `;
        const ok = Number(rows[0]?.ok ?? 0);
        if (ok !== 1) return { locked: false };

        try {
          return { locked: true, result: await task() };
        } finally {
          await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
        }
      },
      { timeout: LOCK_TIMEOUT_MS, maxWait: 10_000 },
    );
  }
}
