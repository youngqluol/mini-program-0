import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys, RedisTtl } from '../../redis/redis.keys';
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
 * ⚠️ Redis 是**加速层**不是真相来源。额度读不到时按 0 处理（少发一条订阅消息），
 *    但**绝不能让主流程报错** —— 订阅消息只是辅助通道。
 *
 * 一次性订阅的额度微信侧长期有效，但本地仍设 24h TTL：避免长期不用的
 * 僵尸计数无限累积，也让「额度」这个概念对用户是可解释的。
 */
@Injectable()
export class SubscribeQuotaService {
  private readonly logger = new Logger(SubscribeQuotaService.name);

  constructor(
    private readonly redis: RedisService,
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

  /** 剩余额度；读不到按 0 算（宁可少发，不可假成功） */
  async remaining(userId: bigint, templateId: string): Promise<number> {
    const raw = await this.redis.get(RedisKeys.subscribeQuota(userId, templateId));
    const n = Number(raw ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
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
   */
  async grant(userId: bigint, templateId: string, count = 1): Promise<number> {
    const n = Math.min(Math.max(Math.trunc(count) || 1, 1), 10);
    const key = RedisKeys.subscribeQuota(userId, templateId);

    const left = await this.redis.incrBy(key, n);
    await this.redis.expire(key, RedisTtl.SUBSCRIBE_QUOTA);

    // Redis 不可用时 incrBy 返回 null —— 不报错，返回 0 让前端提示「稍后重试」
    return left ?? 0;
  }

  /**
   * 下发前扣减额度，返回是否扣减成功。
   *
   * ⚠️ **必须原子**：用 `INCRBY -1` 而不是「先 GET 再 SET」，
   *    否则两个并发请求会同时通过检查、把 1 条额度用成 2 条。
   *    扣成负数说明本地账不准（并发或脏数据），立刻归零并拒绝本次发送。
   *
   * Redis 不可用时**放行**：微信侧会用 43101 兜住，代价只是多一次无效请求，
   * 比「Redis 一抖订阅消息就全哑」要好。
   */
  async consume(userId: bigint, templateId: string): Promise<boolean> {
    const key = RedisKeys.subscribeQuota(userId, templateId);
    const left = await this.redis.incrBy(key, -1);

    if (left === null) return true; // Redis 不可用 → 放行
    if (left >= 0) return true;

    // 扣成负数 → 本地计数错了，归零（不用 refund，避免留下无 TTL 的 0 值 key）
    this.logger.warn(`订阅额度扣成负数，已归零 user=${userId} template=${maskId(templateId)}`);
    await this.redis.del(key);
    return false;
  }

  /** 下发失败时退还额度 —— 网络抖动、47003 这类「不是用户问题」的失败 */
  async refund(userId: bigint, templateId: string): Promise<void> {
    const key = RedisKeys.subscribeQuota(userId, templateId);
    await this.redis.incrBy(key, 1);
    await this.redis.expire(key, RedisTtl.SUBSCRIBE_QUOTA);
  }

  /** 归零 —— 微信返回 43101 时调用，说明用户其实没有额度 */
  async reset(userId: bigint, templateId: string): Promise<void> {
    await this.redis.del(RedisKeys.subscribeQuota(userId, templateId));
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

/** 日志里不要打完整模板 ID */
function maskId(id: string): string {
  if (!id || id.length <= 8) return '***';
  return `${id.slice(0, 4)}***${id.slice(-4)}`;
}
