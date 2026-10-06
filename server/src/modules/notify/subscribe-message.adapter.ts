import { Injectable, Logger } from '@nestjs/common';
import { NotifyType, EnabledStatus } from '@shared/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatService } from '../wechat/wechat.service';
import { SubscribeQuotaService } from './subscribe-quota.service';
import { SUB_TEMPLATE_SPECS, subKindOf } from './subscribe.templates';
import type { SubscribeMessagePort } from './subscribe-message.port';

/**
 * `SubscribeMessagePort` 的**真实实现** —— 通道二落地在这里。
 *
 * 依赖方向：notify → wechat（只借用 `WechatService` 的 HTTP 能力），
 * 所以整个订阅消息通道（模板 / 额度 / 下发）都收在 notify 模块里，
 * 不会和 `WechatModule` 形成环。
 *
 * 三条纪律：
 *   ① **不抛异常** —— 订阅消息是辅助通道，失败必须能安静降级到站内消息
 *   ② **openid 别搞混** —— 订阅消息发到**小程序 openid**，不是 `mp_openid`
 *   ③ **先扣额度再发** —— 反过来的话并发会把 1 条额度用成 2 条
 */
@Injectable()
export class SubscribeMessageAdapter implements SubscribeMessagePort {
  private readonly logger = new Logger(SubscribeMessageAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechat: WechatService,
    private readonly quota: SubscribeQuotaService,
  ) {}

  async hasQuota(userId: bigint, type: NotifyType): Promise<boolean> {
    const kind = subKindOf(type);
    if (!kind) return false;

    const templateId = this.quota.templateIdOf(kind);
    if (!templateId) return false; // 模板未配置 → 通道关闭，静默降级

    return this.quota.hasQuota(userId, templateId);
  }

  async send(params: {
    userId: bigint;
    type: NotifyType;
    templateData: Record<string, { value: string }>;
    page?: string;
    title: string;
    content: string;
    thingId?: bigint;
  }): Promise<boolean> {
    const kind = subKindOf(params.type);
    if (!kind) return false;

    const templateId = this.quota.templateIdOf(kind);
    if (!templateId) {
      // 模板 ID 没配是**部署问题**，不是用户问题 —— 只警告，不打断流程
      this.logger.warn(
        `订阅消息模板未配置（${SUB_TEMPLATE_SPECS[kind].envKey}），跳过通道二`,
      );
      return false;
    }

    // 端口契约要求「实现方不抛异常」，所以整段兜住：
    // 查库挂了、Redis 挂了、微信挂了，都只是「这条没推成」，绝不影响用户操作。
    try {
      // ① 取接收人的**小程序** openid
      const user = await this.prisma.user.findUnique({
        where: { id: params.userId },
        select: { openid: true, status: true },
      });
      if (!user?.openid || user.status !== EnabledStatus.ENABLED) return false;

      // ② 原子扣减额度 —— 扣不到说明确实没额度，直接放弃（省一次微信请求）
      const granted = await this.quota.consume(params.userId, templateId);
      if (!granted) return false;

      // ③ 下发（`sendSubscribeMessage` 承诺不抛异常，失败以 errcode 形式返回）
      const res = await this.wechat.sendSubscribeMessage({
        touser: user.openid,
        templateId,
        data: params.templateData,
        page: params.page,
      });

      if (res.ok) return true;

      if (res.errcode === SUB_ERRCODE.NO_QUOTA) {
        // 微信说用户没有额度 —— 本地账错了，归零；**不要**退还（会永远还不清）
        this.logger.warn(
          `订阅消息 43101（用户拒收或无额度），本地额度已归零 user=${params.userId} ` +
            `template=${SUB_TEMPLATE_SPECS[kind].name}`,
        );
        await this.quota.reset(params.userId, templateId);
        return false;
      }

      // 其他失败（网络抖动 / 47003 字段不匹配 / openid 无效）不代表「用掉了一条」，退还
      this.logger.warn(
        `订阅消息下发失败 errcode=${res.errcode} template=${SUB_TEMPLATE_SPECS[kind].name} ` +
          `errmsg=${res.errmsg ?? ''} —— 额度已退还`,
      );
      await this.quota.refund(params.userId, templateId);
      return false;
    } catch (e) {
      this.logger.warn(
        `订阅消息通道异常（已降级到站内消息）: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }
}

/** 微信订阅消息错误码 */
export const SUB_ERRCODE = {
  /** 用户拒收 / 没有订阅额度 */
  NO_QUOTA: 43101,
  /** 模板字段不匹配 —— 开发期最常见，字段名或值格式与后台模板对不上 */
  TEMPLATE_MISMATCH: 47003,
  /** openid 无效 */
  INVALID_OPENID: 40003,
} as const;
