import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifyChannel, NotifyStatus, NotifyType } from '@shared/enums';
import { DeliveryResult } from '@shared/dto/notify';
import { WxpushClient, WX_ERRCODE } from './wxpush.client';
import { buildTemplate, BuiltTemplate, TemplateContext } from './notify.templates';
import { subPageOf } from './subscribe.templates';
import {
  SUBSCRIBE_MESSAGE_PORT,
  SubscribeMessagePort,
} from './subscribe-message.port';

// 端口契约定义在 ./subscribe-message.port.ts，这里再导出一次方便调用方引用
export { SUBSCRIBE_MESSAGE_PORT };
export type { SubscribeMessagePort };

export interface DispatchInput {
  /** 接收用户 ID */
  userId: bigint;
  /** 关联家庭（可空） */
  familyId?: bigint | null;
  /** 关联小事（可空） */
  thingId?: bigint | null;
  type: NotifyType;
  /** 文案组装上下文 */
  ctx: TemplateContext;
}

export interface DispatchResult {
  /** 最终实际使用的渠道 */
  channel: NotifyChannel;
  /** 给发起人看的三档结果 */
  result: DeliveryResult;
  /** notification_logs.id */
  logId: bigint;
}

/**
 * 通知下发服务 —— 通道选择、降级、日志，全部在这里收口。
 *
 * 通道优先级（PRD 6.5.7）：
 *   ① 公众号模板消息（wxpush）  主力，无限次，能推给别人
 *   ② 小程序订阅消息            辅助，有额度就用
 *   ③ 站内消息                  兜底，永不失败
 *
 * ⚠️ 任何情况下都不能因为推送失败而阻塞用户操作。
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wxpush: WxpushClient,
    @Inject(SUBSCRIBE_MESSAGE_PORT)
    private readonly subscribe: SubscribeMessagePort,
  ) {}

  // -------------------------------------------------------------
  // 对外方法
  // -------------------------------------------------------------

  /**
   * 派活通知
   *
   * 入参用 `Omit<DispatchInput, 'type'>` —— 类型由方法本身决定，
   * 调用方再传一遍 `type` 没有意义，还容易传错（传了也会被覆盖）。
   */
  async notifyTaskAssigned(input: Omit<DispatchInput, 'type'>): Promise<DispatchResult> {
    return this.dispatch({ ...input, type: NotifyType.TASK_ASSIGNED });
  }

  /** 叮一下提醒 */
  async notifyReminder(input: Omit<DispatchInput, 'type'>): Promise<DispatchResult> {
    return this.dispatch({ ...input, type: NotifyType.REMINDER });
  }

  /** 完成回执 */
  async notifyTaskDone(input: Omit<DispatchInput, 'type'>): Promise<DispatchResult> {
    return this.dispatch({ ...input, type: NotifyType.TASK_DONE });
  }

  /**
   * 核心：把一条通知送到用户手上。
   *
   * 流程：先落库（status=PENDING）→ 依次尝试通道 → 回写最终状态。
   * 落库在前是刻意的：**即使所有推送都失败，站内消息也一定存在**。
   */
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const built = buildTemplate(input.type, input.ctx);

    // ① 先落库。channel 先按兜底的「站内消息」记，成功后回写真实渠道。
    const log = await this.prisma.notificationLog.create({
      data: {
        userId: input.userId,
        familyId: input.familyId ?? null,
        thingId: input.thingId ?? null,
        type: input.type,
        title: built.title,
        content: built.content,
        channel: NotifyChannel.IN_APP,
        status: NotifyStatus.PENDING,
      },
    });

    // ② 通道一：公众号模板消息（主力）
    const mpResult = await this.tryMpTemplate(input.userId, built, log.id);
    if (mpResult) {
      await this.markLog(log.id, mpResult.channel, mpResult.status, mpResult.errcode);
      return { channel: mpResult.channel, result: mpResult.result, logId: log.id };
    }

    // ③ 通道二：小程序订阅消息（辅助）
    const subOk = await this.trySubscribe(input, built);
    if (subOk) {
      await this.markLog(log.id, NotifyChannel.SUBSCRIBE, NotifyStatus.SENT);
      return { channel: NotifyChannel.SUBSCRIBE, result: DeliveryResult.SENT, logId: log.id };
    }

    // ④ 通道三：站内消息（兜底，永不失败）
    const reason = await this.explainFallback(input.userId);
    await this.markLog(log.id, NotifyChannel.IN_APP, reason.status, reason.errcode);
    return { channel: NotifyChannel.IN_APP, result: reason.result, logId: log.id };
  }

  // -------------------------------------------------------------
  // 各通道实现
  // -------------------------------------------------------------

  /** 通道一：公众号模板消息 */
  private async tryMpTemplate(
    userId: bigint,
    built: BuiltTemplate,
    logId: bigint,
  ): Promise<{ channel: NotifyChannel; status: NotifyStatus; result: DeliveryResult; errcode?: number } | null> {
    if (!this.wxpush.enabled) return null;

    // 该通知类型没有对应的公众号模板（例如「加入家庭」）→ 正常降级，不是错误
    if (!built.mpKind) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mpOpenid: true },
    });
    if (!user?.mpOpenid) return null; // 未绑定，交给下一通道

    const res = await this.wxpush.send({
      userid: user.mpOpenid,
      title: built.title,
      content: built.content,
      data: built.templateData,
      templateKind: built.mpKind,
      // 用日志 ID 做防重：同一条通知不会重复推给用户
      clientMsgId: `log-${logId}`,
    });

    // 通道未启用 / 模板 ID 未配置 —— 静默降级，**不要**记成 FAILED
    if (res.skipped) return null;

    if (res.ok) {
      return {
        channel: NotifyChannel.MP_TEMPLATE,
        status: NotifyStatus.SENT,
        result: DeliveryResult.SENT,
      };
    }

    // 用户已取关 —— 标记为未绑定，并把 mp_openid 清掉，避免后续反复失败
    if (res.errcode === WX_ERRCODE.NOT_SUBSCRIBED) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { mpOpenid: null, mpBoundAt: null },
      });
      return {
        channel: NotifyChannel.MP_TEMPLATE,
        status: NotifyStatus.NOT_BOUND,
        result: DeliveryResult.NOT_BOUND,
        errcode: res.errcode,
      };
    }

    // 其他错误：记失败，继续降级
    this.logger.warn(
      `通道一失败 user=${userId} errcode=${res.errcode} errmsg=${res.errmsg ?? res.error}`,
    );
    return {
      channel: NotifyChannel.MP_TEMPLATE,
      status: NotifyStatus.FAILED,
      result: DeliveryResult.FAILED,
      errcode: res.errcode,
    };
  }

  /**
   * 通道二：小程序订阅消息。
   *
   * 三道闸门，任何一道不过就直接返回 false 让流程降级：
   *   ① 该通知类型有没有订阅消息模板（`subKind`）
   *   ② 模板数据组装成功了吗（`subTemplateData`）——
   *      **派活不设时间时这里必为 null**，因为 `time23` 是必填的 time 字段
   *   ③ 用户还有没有额度
   *
   * 真正的额度扣减在适配器里原子完成，所以这里的额度判断读脏了也不会多发。
   */
  private async trySubscribe(input: DispatchInput, built: BuiltTemplate): Promise<boolean> {
    if (!built.subKind || !built.subTemplateData) return false;

    try {
      if (!(await this.subscribe.hasQuota(input.userId, input.type))) return false;
      return await this.subscribe.send({
        userId: input.userId,
        type: input.type,
        templateData: built.subTemplateData,
        page: subPageOf(built.subKind, input.thingId),
        title: built.title,
        content: built.content,
        thingId: input.thingId ?? undefined,
      });
    } catch (e) {
      // 适配器承诺不抛异常，这里只是最后一道保险
      this.logger.warn(`通道二异常: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** 全部通道都失败时，判断该记哪种状态 —— 用于给发起人一句准确的话 */
  private async explainFallback(
    userId: bigint,
  ): Promise<{ status: NotifyStatus; result: DeliveryResult; errcode?: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mpOpenid: true },
    });
    if (!user?.mpOpenid) {
      return { status: NotifyStatus.NOT_BOUND, result: DeliveryResult.NOT_BOUND };
    }
    return { status: NotifyStatus.NO_QUOTA, result: DeliveryResult.NO_QUOTA };
  }

  private async markLog(
    logId: bigint,
    channel: NotifyChannel,
    status: NotifyStatus,
    errcode?: number,
  ): Promise<void> {
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        channel,
        status,
        sentAt: status === NotifyStatus.SENT ? new Date() : null,
        errorCode: errcode != null ? String(errcode) : null,
      },
    });
  }
}
