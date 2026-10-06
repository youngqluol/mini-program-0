import { Injectable, Logger } from '@nestjs/common';
import { NotifyStatus, ReminderStatus } from '@shared/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys, RedisTtl } from '../../redis/redis.keys';
import { ReminderService } from '../thing/reminder.service';

/**
 * 提醒调度器 —— docs/02 §十。
 *
 * 云托管 Cron 每分钟打一次 `/internal/scheduler/tick`，
 * 每天打一次 `/internal/scheduler/compensate`。
 *
 * **职责边界**：本文件只管「什么时候发、发哪些、别重复发」。
 * 「一条提醒该怎么发、发完状态怎么变」全在 `ReminderService` ——
 * 那里与用户点「叮一下」共用同一套代码，所以两条路径的文案与状态一定一致。
 *
 * ⚠️ 两个接口都必须**幂等**：Cron 可能重试、云托管可能多实例，
 *    重复执行不能造成重复推送。靠的是 Redis 锁 + 状态位双重保护。
 */

/** 一次 tick 最多处理多少条 —— 微信接口有频率限制，宁可多跑几轮 */
const TICK_BATCH = 50;
/** 一次补偿最多处理多少条 */
const COMPENSATE_BATCH = 20;
/** 补偿只看最近多久的日志 */
const COMPENSATE_WINDOW_HOURS = 24;
/** 超过这么久还停在 PENDING 的日志算「幽灵记录」（见 closeGhostLogs） */
const GHOST_AFTER_MINUTES = 30;

/** `tick` 的返回（docs/02 §10.1） */
export interface TickResult {
  /** 扫到几条到点的提醒 */
  scanned: number;
  sent: number;
  notBound: number;
  noQuota: number;
  failed: number;
  /** 小事已结束 / 接收人已退出 —— **正常跳过，不是失败** */
  skipped: number;
  /** true = 没抢到锁（另一个实例正在跑），本次什么都没做 */
  locked: boolean;
  durationMs: number;
}

/** `compensate` 的返回 */
export interface CompensateResult {
  /** 扫到几条需要处理的日志（FAILED + 幽灵 PENDING） */
  scanned: number;
  /** 重发后**真的推到微信了** */
  resent: number;
  /** 重发了，但还是只有站内（未绑定 / 无额度）—— 与 resent 分开，才看得出补偿有没有用 */
  degraded: number;
  /** 不需要处理（类型不支持 / 小事已结束 / 已被处理） */
  skipped: number;
  /** 重发时抛异常 */
  failed: number;
  /** 收尾的幽灵 PENDING 记录数 */
  ghostsClosed: number;
  locked: boolean;
  durationMs: number;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly reminders: ReminderService,
  ) {}

  // =============================================================
  // 提醒调度心跳（M2-B20 / B21）
  // =============================================================

  /**
   * 扫描到点的提醒并下发。
   *
   * 三道防重：
   *   ① Redis 锁（M2-B21）—— 多实例并发时只有一个能进
   *   ② `fireDueReminder` 里的状态检查 —— 谁先谁算，不抢
   *   ③ 发完把 `next_remind_at` 推走 —— 同一条不会被下一轮再捞
   */
  async tick(): Promise<TickResult> {
    const startedAt = Date.now();
    const result: TickResult = {
      scanned: 0,
      sent: 0,
      notBound: 0,
      noQuota: 0,
      failed: 0,
      skipped: 0,
      locked: false,
      durationMs: 0,
    };

    const lockKey = RedisKeys.cronReminderLock();
    // ⚠️ 单位陷阱：`RedisTtl.CRON_LOCK` 是**秒**，`acquireLock` 收**毫秒**
    const token = await this.redis.acquireLock(lockKey, RedisTtl.CRON_LOCK * 1000);
    if (token == null) {
      // 另一个实例正在跑 —— 正常现象，不是错误，所以只记 info 不记 warn
      result.locked = true;
      result.durationMs = Date.now() - startedAt;
      this.logger.log('调度心跳：没抢到锁，本次跳过（另一个实例在跑）');
      return result;
    }

    try {
      const due = await this.prisma.thingReminder.findMany({
        where: {
          status: ReminderStatus.PENDING,
          // `lte` 在 SQL 里天然排除 NULL，写 `not: null` 是为了让读代码的人一眼看清
          nextRemindAt: { not: null, lte: new Date() },
        },
        orderBy: { nextRemindAt: 'asc' },
        take: TICK_BATCH,
        select: { id: true },
      });

      result.scanned = due.length;

      // **串行**下发：微信接口有频率限制，而家庭场景的量本来就小
      //（一天几十条），并发只会在极端情况下把接口打爆，换不来可感知的收益。
      for (const r of due) {
        const outcome = await this.reminders.fireDueReminder(r.id);
        switch (outcome) {
          case 'sent':
            result.sent++;
            break;
          case 'not_bound':
            result.notBound++;
            break;
          case 'no_quota':
            result.noQuota++;
            break;
          case 'skipped':
            result.skipped++;
            break;
          default:
            result.failed++;
        }
      }
    } finally {
      // 必须放在 finally：中途抛异常也要释放，否则锁要等 TTL 自然过期
      await this.redis.releaseLock(lockKey, token);
    }

    result.durationMs = Date.now() - startedAt;
    this.logger.log(
      `调度心跳：扫描 ${result.scanned} → 送达 ${result.sent} / 未绑定 ${result.notBound} / ` +
        `无额度 ${result.noQuota} / 失败 ${result.failed} / 跳过 ${result.skipped}` +
        `（${result.durationMs}ms）`,
    );
    return result;
  }

  // =============================================================
  // 补偿任务（M2-B22）
  // =============================================================

  /**
   * 补偿扫描 —— docs/01 风险表第 9 条「定时任务漏发」的应对。
   *
   * 处理两类记录，**理由完全不同**，所以分开统计：
   *
   * | 扫什么 | 做什么 | 为什么需要 |
   * | --- | --- | --- |
   * | `status=FAILED`（24h 内） | 重发一次 | 提醒 FAILED 后 `next_remind_at` 被置 null，**tick 永远不会再碰它** —— 这是真正的永久丢失 |
   * | `status=PENDING` 且超 30 分钟 | 收尾为 FAILED | `dispatch` 中途进程挂掉会留下「幽灵记录」，消息中心会一直显示「发送中」 |
   *
   * 建议 Cron：每天一次（`0 3 * * *`）。低频是刻意的 ——
   * 补偿是**运维兜底**，不是产品行为；产品侧明确「不自动重试」，
   * 免得「悄悄重发」制造重复提醒。
   */
  async compensate(): Promise<CompensateResult> {
    const startedAt = Date.now();
    const result: CompensateResult = {
      scanned: 0,
      resent: 0,
      degraded: 0,
      skipped: 0,
      failed: 0,
      ghostsClosed: 0,
      locked: false,
      durationMs: 0,
    };

    const lockKey = RedisKeys.cronCompensateLock();
    const token = await this.redis.acquireLock(lockKey, RedisTtl.CRON_LOCK * 1000);
    if (token == null) {
      result.locked = true;
      result.durationMs = Date.now() - startedAt;
      this.logger.log('补偿任务：没抢到锁，本次跳过（另一个实例在跑）');
      return result;
    }

    try {
      result.ghostsClosed = await this.closeGhostLogs();

      const since = new Date(Date.now() - COMPENSATE_WINDOW_HOURS * 3600_000);
      const failedLogs = await this.prisma.notificationLog.findMany({
        where: { status: NotifyStatus.FAILED, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        take: COMPENSATE_BATCH,
        select: { id: true },
      });

      result.scanned = failedLogs.length;

      for (const log of failedLogs) {
        const outcome = await this.reminders.retryReminderNotification(log.id);
        switch (outcome) {
          case 'resent':
            result.resent++;
            break;
          case 'degraded':
            result.degraded++;
            break;
          case 'skipped':
            result.skipped++;
            break;
          default:
            result.failed++;
        }
      }
    } finally {
      await this.redis.releaseLock(lockKey, token);
    }

    result.durationMs = Date.now() - startedAt;
    this.logger.log(
      `补偿任务：扫描 ${result.scanned} → 重发成功 ${result.resent} / 仍站内 ${result.degraded} / ` +
        `跳过 ${result.skipped} / 失败 ${result.failed}；收尾幽灵记录 ${result.ghostsClosed} 条` +
        `（${result.durationMs}ms）`,
    );
    return result;
  }

  /**
   * 收尾「幽灵 PENDING 记录」。
   *
   * 正常流程里 `dispatch` 结束前一定会把状态从 PENDING 改掉，
   * 所以长期停在 PENDING 只可能是**进程中途挂了**（云托管重启 / 被 kill）。
   *
   * 为什么置 `FAILED` 而不是 `NOT_BOUND`：
   *   `NOT_BOUND` 特指「对方没开微信提醒」，用它会把**系统故障说成对方的设置**，
   *   发起人看到会以为「是他没开提醒」，而事实是我们没发出去。
   *   `FAILED` 表达「没确认送达」最接近事实。
   */
  private async closeGhostLogs(): Promise<number> {
    const before = new Date(Date.now() - GHOST_AFTER_MINUTES * 60_000);
    const res = await this.prisma.notificationLog.updateMany({
      where: { status: NotifyStatus.PENDING, createdAt: { lt: before } },
      data: { status: NotifyStatus.FAILED },
    });
    if (res.count > 0) {
      this.logger.warn(`收尾了 ${res.count} 条幽灵 PENDING 记录（超过 ${GHOST_AFTER_MINUTES} 分钟未落状态）`);
    }
    return res.count;
  }
}
