/**
 * Redis key 命名约定 —— **唯一来源**，不要在业务代码里手写字符串拼 key。
 *
 * 命名风格参考 docs/02 §9.5 已写明的 `mpbind:code:{code}`，保持文档与代码一致。
 * 云托管上的 Redis 是本项目独占实例，因此不加项目前缀。
 *
 * 每加一个 key 都在这里加一个函数，顺带把 TTL 也写清楚 ——
 * 没有 TTL 的 key 是内存泄漏，评审时要能一眼看出来。
 */
export const RedisKeys = {
  // ---- 鉴权 ----
  /** 登录态吊销标记（主动登出 / 强制失效），值为 1 */
  authRevoked: (userId: bigint | number) => `auth:revoked:${userId}`,

  // ---- 订阅消息额度池 ----
  /**
   * 某用户在某订阅消息模板上的剩余额度。
   * 1 次授权 = 1 条，发送成功即扣减。
   * 这是**辅助通道**的额度；主力通道是公众号模板消息，不受此限制。
   */
  subscribeQuota: (userId: bigint | number, templateId: string) =>
    `subscribe:quota:${userId}:${templateId}`,

  // ---- 公众号提醒绑定（命名与 docs/02 §9.5 一致） ----
  /** 绑定码 → userId */
  mpBindCode: (code: string) => `mpbind:code:${code}`,
  /** userId → 当前绑定码（防止同一用户刷出多个码） */
  mpBindCodeOfUser: (userId: bigint | number) => `mpbind:user:${userId}`,

  // ---- 定时任务分布式锁 ----
  /** 提醒调度扫描锁 */
  cronReminderLock: () => 'cron:lock:reminder',
  /** 重复任务生成锁 */
  cronRecurrenceLock: () => 'cron:lock:recurrence',
  /** 补偿任务锁 */
  cronCompensateLock: () => 'cron:lock:compensate',

  // ---- 限流 ----
  /** 建家 / 生成邀请码等敏感操作的限流计数 */
  rateLimit: (scene: string, id: string | number) => `rate:${scene}:${id}`,
} as const;

/** 常用 TTL（秒）—— 避免各处的魔法数字 */
export const RedisTtl = {
  /** 绑定码 10 分钟（docs/02 §9.5） */
  MP_BIND_CODE: 10 * 60,
  /** 同一用户重复生成绑定码的冷却 30 秒（docs/02 §9.5） */
  MP_BIND_COOLDOWN: 30,
  /** 订阅额度按天重置 */
  SUBSCRIBE_QUOTA: 24 * 60 * 60,
  /** 限流窗口 1 分钟 */
  RATE_LIMIT_WINDOW: 60,
  /** 定时任务锁 5 分钟（远大于单次扫描耗时，防止任务重入） */
  CRON_LOCK: 5 * 60,
} as const;
