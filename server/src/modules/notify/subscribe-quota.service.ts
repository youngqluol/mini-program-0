import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SUB_TEMPLATE_KINDS, SUB_TEMPLATE_SPECS, SubTemplateKind } from './subscribe.templates';
import type { SubscribeQuota, SubscribeQuotaResponse } from '@shared/dto/auth';

/**
 * 订阅消息额度池。
 *
 * 背景：小程序订阅消息是**一次性**的 —— 用户授权一次，只能收到一条。
 * 所以必须在服务端记账，否则会出现「以为能发，发出去 43101」的假成功。
 *
 * 记账规则：
 *   授权成功（前端调 `wx.requestSubscribeMessage` 拿到 accept）→ `grant()` +1
 *   下发成功                                                → `consume()` -1
 *   下发失败但额度确实在（网络抖动 / 47003）                  → `refund()` +1，别白扣
 *   微信说 43101（用户拒收 / 根本没额度）                     → `reset()` 归零，说明本地账错了
 *
 * v0.2.3：不再使用 Redis，额度持久化在 MySQL `subscribe_quotas` 表。
 *   原子性由单条 UPDATE 保证（`remaining > 0` 是 WHERE 条件），
 *   并发下不会把 1 条额度用成 2 条。
 *
 * 过期行不物理删除（全库不做物理 DELETE），按 0 处理；
 * 行数上限 = 用户数 × 已配置模板数，不会无限增长。
 *
 * ⚠️ 订阅消息只是**辅助通道**，额度读写失败绝不能阻塞主流程 ——
 *    调用方 `NotifyService.trySubscribe` 已用 try/catch 包住。
 */
@Injectable()
export class SubscribeQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------
  // 模板 ID 解析
  // -------------------------------------------------------------

  /** 该模板种类对应的模板 ID；未配置环境变量时返回 null */
  templateIdOf(kind: SubTemplateKind): string | null {
    const envKey = SUB_TEMPLATE_SPECS[kind].envKey;
    return this.config.get<string>(envKey)?.trim() || null;
  }

  /** 模板 ID → 种类；不是我们的模板则返回 null（用于校验前端上报） */
  kindOfTemplateId(templateId: string): SubTemplateKind | null {
    const id = templateId?.trim();
    if (!id) return null;
    for (const kind of SUB_TEMPLATE_KINDS) {
      if (this.templateIdOf(kind) === id) return kind;
    }
    return null;
  }

  /**
   * 模板 ID → 给用户看的名字。
   *
   * ⚠️ 用 `displayName` 而不是后台标题 —— 后台标题里带禁用词
   *    （「待办事项提醒」的「待办事项」），AGENTS.md §6 禁止它出现在用户界面。
   *    查不到时给个中性名字，不要暴露「未知模板」给用户。
   */
  templateNameOf(templateId: string): string {
    const kind = this.kindOfTemplateId(templateId);
    return kind ? SUB_TEMPLATE_SPECS[kind].displayName : '微信提醒';
  }

  // -------------------------------------------------------------
  // 额度读写
  // -------------------------------------------------------------

  /** 剩余额度；过期或读不到按 0 算（宁可少发，不可假成功） */
  async remaining(userId: bigint, templateId: string): Promise<number> {
    const row = await this.prisma.subscribeQuota.findUnique({
      where: { userId_templateId: { userId, templateId } },
      select: { remaining: true, expiresAt: true },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return 0;
    return row.remaining > 0 ? Math.trunc(row.remaining) : 0;
  }

  /** 是否还有额度 —— 下发前的前置快筛 */
  async hasQuota(userId: bigint, templateId: string): Promise<boolean> {
    return (await this.remaining(userId, templateId)) > 0;
  }

  /**
   * 授权成功后入账。
   *
   * `count` 做上下限钳制：微信一次 `requestSubscribeMessage` 单个模板
   * 最多 +1，前端传大数说明有 bug，别让它把额度池撑爆。
   *
   * 过期行重新入账时重置为本次授权数；未过期则累加。
   */
  async grant(userId: bigint, templateId: string, count = 1): Promise<number> {
    const n = Math.min(Math.max(Math.trunc(count) || 1, 1), 10);

    await this.prisma.$executeRaw`
      INSERT INTO subscribe_quotas (user_id, template_id, remaining, expires_at)
      VALUES (${userId}, ${templateId}, ${n}, DATE_ADD(NOW(), INTERVAL 24 HOUR))
      ON DUPLICATE KEY UPDATE
        remaining = IF(expires_at <= NOW(), VALUES(remaining), remaining + VALUES(remaining)),
        expires_at = IF(expires_at <= NOW(), VALUES(expires_at), expires_at)
    `;

    return this.remaining(userId, templateId);
  }

  /**
   * 下发前扣减额度，返回是否扣减成功。
   *
   * 单条 UPDATE 保证原子性：`remaining > 0 AND expires_at > NOW()`
   * 是 WHERE 条件，并发请求里只有一个能把 1 扣成 0。
   */
  async consume(userId: bigint, templateId: string): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE subscribe_quotas
      SET remaining = remaining - 1
      WHERE user_id = ${userId}
        AND template_id = ${templateId}
        AND remaining > 0
        AND expires_at > NOW()
    `;
    return affected > 0;
  }

  /** 下发失败时退还额度 —— 网络抖动、47003 这类「不是用户问题」的失败 */
  async refund(userId: bigint, templateId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO subscribe_quotas (user_id, template_id, remaining, expires_at)
      VALUES (${userId}, ${templateId}, 1, DATE_ADD(NOW(), INTERVAL 24 HOUR))
      ON DUPLICATE KEY UPDATE
        remaining = IF(expires_at <= NOW(), 1, remaining + 1),
        expires_at = IF(expires_at <= NOW(), VALUES(expires_at), expires_at)
    `;
  }

  /** 归零 —— 微信返回 43101 时调用，说明用户其实没有额度 */
  async reset(userId: bigint, templateId: string): Promise<void> {
    await this.prisma.subscribeQuota.updateMany({
      where: { userId, templateId },
      data: { remaining: 0, expiresAt: new Date() },
    });
  }

  // -------------------------------------------------------------
  // 给前端用的快照
  // -------------------------------------------------------------

  /**
   * 三个模板的额度快照（docs/02 §2.4 / §2.5）。
   *
   * 只列**已配置模板 ID** 的种类：没配的种类前端拿不到模板 ID，
   * 也就无从调 `requestSubscribeMessage`，列出来只会让前端显示一堆没用的项。
   */
  async snapshot(userId: bigint): Promise<SubscribeQuotaResponse> {
    const quotas: SubscribeQuota[] = [];

    for (const kind of SUB_TEMPLATE_KINDS) {
      const templateId = this.templateIdOf(kind);
      if (!templateId) continue;
      quotas.push({
        templateId,
        templateName: SUB_TEMPLATE_SPECS[kind].displayName,
        remaining: await this.remaining(userId, templateId),
      });
    }

    return {
      quotas,
      // 全部见底 → 前端展示「再开一次微信提醒，就能多叮几次」的轻提示
      // （注意：这里只能回 `needReauthorize` 这个**技术字段**，
      //   真正给用户看的文案在 packages/shared/src/dto/notify.ts，
      //   且不得出现「授权」等机制词 —— AGENTS.md §6）
      needReauthorize: quotas.length > 0 && quotas.every((q) => q.remaining <= 0),
    };
  }
}
