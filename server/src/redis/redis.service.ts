import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * Redis 封装。
 *
 * 用途（V0.1）：
 *   ① 订阅消息额度池计数（1 次授权 = 1 条，用完即止）
 *   ② 定时任务扫描的分布式锁（多实例下同一条只发一次）
 *   ③ 公众号绑定码的临时存储（6 位码，5 分钟有效）
 *
 * ⚠️ 铁律：Redis 是**加速层**，不是真相来源。
 *    任何「Redis 挂了就丢数据」的写法都是 bug。写不进去只降级、不报错。
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379/0';

    this.client = new Redis(url, {
      // 连不上时不要无限重试刷屏，交给业务降级
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: false,
    });

    this.client.on('connect', () => this.logger.log('Redis 连接就绪'));
    this.client.on('error', (e: Error) =>
      this.logger.warn(`Redis 异常（已降级）: ${e.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    // quit() 在连接已断时会 reject，用 disconnect 兜底
    try {
      await this.client?.quit();
    } catch {
      this.client?.disconnect();
    }
  }

  /** 健康检查用 */
  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------
  // 基础读写 —— 全部吞掉异常，返回安全默认值
  // -------------------------------------------------------------

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (e) {
      this.warn('get', key, e);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    try {
      if (ttlSeconds != null) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (e) {
      this.warn('set', key, e);
      return false;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (e) {
      this.warn('del', key, e);
    }
  }

  async incrBy(key: string, delta: number): Promise<number | null> {
    try {
      return await this.client.incrby(key, delta);
    } catch (e) {
      this.warn('incrby', key, e);
      return null;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.expire(key, ttlSeconds);
    } catch (e) {
      this.warn('expire', key, e);
    }
  }

  /**
   * 剩余存活秒数。
   * 返回 -2 表示 key 不存在，-1 表示没有设过期时间 —— 与 Redis 原生语义一致，
   * 因为调用方经常需要区分「不存在」和「永不过期」。
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (e) {
      this.warn('ttl', key, e);
      return -2;
    }
  }

  /** 仅当 key 不存在时写入。用于幂等保护（如绑定码、重复提交）。 */
  async setNx(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    try {
      const res =
        ttlSeconds != null
          ? await this.client.set(key, value, 'EX', ttlSeconds, 'NX')
          : await this.client.set(key, value, 'NX');
      return res === 'OK';
    } catch (e) {
      this.warn('setNx', key, e);
      return false;
    }
  }

  // -------------------------------------------------------------
  // 分布式锁 —— 定时任务扫描用
  // -------------------------------------------------------------

  /**
   * 尝试获取锁。拿到返回释放令牌，没拿到返回 null。
   *
   * 释放时必须用令牌比对（Lua 保证原子），避免「A 超时释放了 B 的锁」。
   */
  async acquireLock(
    key: string,
    ttlMs = 30_000,
  ): Promise<string | null> {
    const token = randomUUID();
    try {
      const ok = await this.client.set(key, token, 'PX', ttlMs, 'NX');
      return ok === 'OK' ? token : null;
    } catch (e) {
      this.warn('acquireLock', key, e);
      // Redis 不可用时**放行**：宁可重复发一条，也不要整个定时任务停摆
      return token;
    }
  }

  async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        token,
      );
    } catch (e) {
      this.warn('releaseLock', key, e);
    }
  }

  // -------------------------------------------------------------

  private warn(op: string, key: string, e: unknown): void {
    this.logger.warn(
      `Redis ${op} 失败 key=${key}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
