import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotifyChannel,
  NotifyType,
  RecurrenceType,
  RemindType,
  ReminderStatus,
  dbToEnum,
  enumToDb,
} from '@shared/enums';
import { DeliveryResult } from '@shared/dto/notify';
import type { InboxItem, InboxResponse, NudgeResponse, ThingDetail } from '@shared/dto/thing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifyService } from '../notify/notify.service';
import { SubscribeQuotaService } from '../notify/subscribe-quota.service';
import { subKindOf } from '../notify/subscribe.templates';
import { BusinessException } from '../../common/errors/business.exception';
import {
  formatDateTime,
  parseBeijingDateTime,
  toNumberRequired,
} from '../../common/serialize/beijing-time';
import type { FamilyMemberContext } from '../families/family-context';
import { ContentSecurityService } from '../wechat/content-security.service';
import { ThingService } from './thing.service';
import { isBeijingDateTime } from './dto/thing.dto';
import type { AddReminderDto, InboxQueryDto, NudgeDto } from './dto/reminder.dto';

/** 收件箱一次最多返回多少条 */
const INBOX_LIMIT = 100;
/** 「在册成员」的状态值 */
const MEMBER_ACTIVE = 1;

/**
 * 提醒模块 —— docs/02 §五。
 *
 * 「叮一下」有两条入口，它们共用同一套下发逻辑：
 *   ① 创建小事时内嵌 `reminders[]`（在 `ThingService` 里处理）
 *   ② 独立的 `POST /reminders/nudge`（本文件）—— 首页那个大大的「叮一下」按钮
 *
 * 本文件还负责**收件箱**：订阅消息发不出去时的兜底通道。
 * 「有人叮了你」这件事必须在小程序里看得见，否则整个提醒功能在没开微信提醒时就是哑的。
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly things: ThingService,
    private readonly notify: NotifyService,
    private readonly quota: SubscribeQuotaService,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  // =============================================================
  // 立即叮一下（M2-B17）
  // =============================================================

  /**
   * 立即叮一下（docs/02 §5.3）。
   *
   * 两种用法：
   *   - 带 `thingId`：对已有小事补一次「现在就提醒」
   *   - 不带 `thingId`：现场建一条 REMINDER 小事（标题取 `content`）再叮
   *
   * 返回的三档 `deliveryStatus` 是**给发起人看**的：
   * 「叮到了」/「对方没开微信提醒」/「额度用完了，已转站内」必须分清，
   * 否则发起人会按错误的提示去操作（PRD 6.5.6）。
   */
  async nudge(ctx: FamilyMemberContext, dto: NudgeDto): Promise<NudgeResponse> {
    const recipient = await this.assertMember(ctx.familyId, dto.recipientMemberId);

    let thing;
    if (dto.thingId != null) {
      thing = await this.things.loadVisibleThing(ctx, BigInt(dto.thingId));
      if (thing.status !== 1) {
        throw BusinessException.conflict('这件小事已经结束啦，不用再叮了');
      }
    } else {
      const title = dto.content?.trim();
      if (!title) throw BusinessException.invalidParam('要叮点什么呢');

      // 内容安全（M2-B9）：叮一下的正文是用户输入，同样要过检测。
      // 带 thingId 的那条路径不改内容，所以不需要 —— 别做无用的微信调用。
      await this.contentSecurity.assertTextSafe(ctx.userId, title, '叮一下的内容');

      thing = await this.prisma.familyThing.create({
        data: {
          familyId: ctx.familyId,
          creatorMemberId: ctx.memberId,
          type: 2, // ThingType.REMINDER
          title,
          assigneeMemberId: recipient.id,
          visibility: 2, // ThingVisibility.RELATED —— 叮一下默认只有双方可见
          status: 1, // ThingStatus.PENDING
        },
      });
    }

    const now = new Date();
    const reminder = await this.prisma.thingReminder.create({
      data: {
        thingId: thing.id,
        recipientMemberId: recipient.id,
        remindType: RemindType.NOW,
        // 立即叮也记下「实际提醒时刻」——「今日提醒」按它归日
        remindAt: now,
        recurrenceType: RecurrenceType.NONE,
        status: ReminderStatus.PENDING,
        nextRemindAt: now,
      },
    });

    // 下发。NotifyService 内部承诺不抛异常，这里再兜一层，保证「叮失败」不影响返回值
    let deliveryStatus: string = DeliveryResult.FAILED;
    let deliveryChannel: string = channelName(NotifyChannel.IN_APP);
    try {
      const familyName = await this.familyNameOf(ctx.familyId);
      const [recipientRoleName, fromRoleName] = await Promise.all([
        this.things.roleNameOfMember(recipient.id),
        this.things.roleNameOfMember(ctx.memberId),
      ]);

      const result = await this.notify.notifyReminder({
        userId: recipient.userId,
        familyId: ctx.familyId,
        thingId: thing.id,
        ctx: {
          roleName: recipientRoleName,
          familyName,
          thingTitle: thing.title,
          thingContent: thing.content ?? undefined,
          fromRoleName,
          remindAt: now,
        },
      });

      deliveryStatus = result.result;
      deliveryChannel = channelName(result.channel);
    } catch (e) {
      this.logger.warn(`叮一下下发异常（已忽略）：${e instanceof Error ? e.message : String(e)}`);
    }

    // 回写提醒状态。
    // FAILED 时**不**置 SENT，也不留 nextRemindAt —— 不做自动重试，
    // 让站内消息兜底（用户打开小程序就能看到），避免「悄悄重试」制造重复提醒。
    await this.prisma.thingReminder.update({
      where: { id: reminder.id },
      data:
        deliveryStatus === DeliveryResult.FAILED
          ? { status: ReminderStatus.PENDING, nextRemindAt: null }
          : {
              status: ReminderStatus.SENT,
              sentCount: 1,
              lastSentAt: now,
              nextRemindAt: null,
            },
    });

    return {
      thingId: toNumberRequired(thing.id),
      reminderId: toNumberRequired(reminder.id),
      deliveryStatus,
      deliveryChannel,
      quotaRemaining: await this.quotaRemaining(recipient.userId),
    };
  }

  // =============================================================
  // 收件箱（M2-B24）
  // =============================================================

  /**
   * 我的待提醒（docs/02 §5.4）—— 站内消息兜底通道。
   *
   * 默认返回「未取消」的全部提醒（含已发送的）：叮过了不代表做完了，
   * 用户打开小程序还得看得见是谁叮了他什么。
   */
  async inbox(ctx: FamilyMemberContext, query: InboxQueryDto): Promise<InboxResponse> {
    const where = {
      recipientMemberId: ctx.memberId,
      ...(query.status
        ? { status: requireReminderStatus(query.status) }
        : { status: { not: ReminderStatus.CANCELLED } }),
    };

    const [rows, unreadCount] = await Promise.all([
      this.prisma.thingReminder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: INBOX_LIMIT,
      }),
      this.prisma.thingReminder.count({
        where: { recipientMemberId: ctx.memberId, readAt: null, status: { not: ReminderStatus.CANCELLED } },
      }),
    ]);

    if (rows.length === 0) return { list: [], unreadCount };

    // 两次查询代替 relation（schema 刻意不定义 relation）
    const things = await this.prisma.familyThing.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.thingId))] }, familyId: ctx.familyId },
    });
    const thingById = new Map(things.map((t) => [t.id, t]));

    const briefs = await this.things.memberBriefs(things.map((t) => t.creatorMemberId));

    const list: InboxItem[] = [];
    for (const r of rows) {
      const thing = thingById.get(r.thingId);
      // 小事已被删除 / 不属于这个家 —— 跳过，不要给前端半条数据
      if (!thing) continue;
      list.push({
        id: toNumberRequired(r.id),
        thingId: toNumberRequired(r.thingId),
        title: thing.title,
        content: thing.content,
        fromRoleName: briefs.get(thing.creatorMemberId)?.roleName ?? '家人',
        remindAt: formatDateTime(r.remindAt),
        isRead: r.readAt != null,
      });
    }

    return { list, unreadCount };
  }

  /** 标记收件箱某条为已读（docs/02 §5.5）。只能标记**发给我的**那一条。 */
  async markInboxRead(ctx: FamilyMemberContext, reminderId: bigint): Promise<void> {
    const hit = await this.prisma.thingReminder.findFirst({
      where: { id: reminderId, recipientMemberId: ctx.memberId },
      select: { id: true, readAt: true },
    });
    if (!hit) throw BusinessException.notFound('这条提醒');
    if (hit.readAt != null) return; // 幂等：已读就不改时刻

    await this.prisma.thingReminder.update({
      where: { id: hit.id },
      data: { readAt: new Date() },
    });
  }

  // =============================================================
  // 给已有小事加 / 取消提醒（docs/02 §5.1 / §5.2）
  // =============================================================

  /** 给某条小事补一条提醒（docs/02 §5.1）。权限同「编辑小事」。 */
  async addReminder(
    ctx: FamilyMemberContext,
    thingId: bigint,
    dto: AddReminderDto,
  ): Promise<ThingDetail> {
    const thing = await this.things.loadVisibleThing(ctx, thingId);
    if (thing.creatorMemberId !== ctx.memberId && !ctx.isOwner) {
      throw BusinessException.forbidden('这件事不是你发起的，加不了提醒');
    }
    if (thing.status !== 1) {
      throw BusinessException.conflict('这件小事已经结束啦，不用再加提醒');
    }

    const recipientId = dto.recipientMemberId
      ? (await this.assertMember(ctx.familyId, dto.recipientMemberId)).id
      : (thing.assigneeMemberId ?? thing.creatorMemberId);

    const remindType = requireRemindType(dto.remindType);
    const remindAt = dto.remindAt ? this.parseRemindAt(dto.remindAt) : null;
    if (remindType === RemindType.SCHEDULED && remindAt == null) {
      throw BusinessException.invalidParam('定时提醒要选个时间哦');
    }

    const now = new Date();
    await this.prisma.thingReminder.create({
      data: {
        thingId: thing.id,
        recipientMemberId: recipientId,
        remindType,
        remindAt: remindAt ?? (remindType === RemindType.NOW ? now : null),
        recurrenceType: requireRecurrenceType(dto.recurrenceType),
        recurrenceConfig: toJson(dto.recurrenceConfig),
        status: ReminderStatus.PENDING,
        nextRemindAt: remindType === RemindType.NOW ? now : remindAt,
      },
    });

    return this.things.detail(ctx, thing.id);
  }

  /**
   * 取消一条提醒（docs/02 §5.2）。置 `status=3`，**不物理删除**。
   *
   * 谁有权取消：接收人本人（不想被叮了）、小事的发起人、家庭创建者。
   */
  async cancelReminder(userId: bigint, reminderId: bigint): Promise<void> {
    const ctx = await this.contextForReminder(userId, reminderId);

    const reminder = await this.prisma.thingReminder.findUnique({
      where: { id: reminderId },
      select: { id: true, thingId: true, recipientMemberId: true, status: true },
    });
    if (!reminder) throw BusinessException.notFound('这条提醒');

    const thing = await this.prisma.familyThing.findUnique({
      where: { id: reminder.thingId },
      select: { creatorMemberId: true },
    });

    const allowed =
      reminder.recipientMemberId === ctx.memberId ||
      thing?.creatorMemberId === ctx.memberId ||
      ctx.isOwner;
    if (!allowed) {
      throw BusinessException.forbidden('这条提醒不是你加的，取消不了');
    }

    if (reminder.status === ReminderStatus.CANCELLED) return; // 幂等

    await this.prisma.thingReminder.update({
      where: { id: reminder.id },
      data: { status: ReminderStatus.CANCELLED, nextRemindAt: null },
    });
  }

  /**
   * 由「提醒 ID」反查家庭上下文。
   *
   * `DELETE /reminders/:id` 的 URL 里既没有 familyId 也没有 thingId，
   * 只能顺着「提醒 → 小事 → 家庭」摸上去。失败语义与 `contextForThing` 一致。
   */
  async contextForReminder(userId: bigint, reminderId: bigint): Promise<FamilyMemberContext> {
    const reminder = await this.prisma.thingReminder.findUnique({
      where: { id: reminderId },
      select: { thingId: true },
    });
    if (!reminder) throw BusinessException.notFound('这条提醒');

    return this.things.contextForThing(userId, reminder.thingId);
  }

  // =============================================================
  // 内部
  // =============================================================

  /** 确认是本家庭在册成员，返回 id 与 userId（下发要按用户维度） */
  private async assertMember(
    familyId: bigint,
    memberId: number,
  ): Promise<{ id: bigint; userId: bigint }> {
    const m = await this.prisma.familyMember.findFirst({
      where: { id: BigInt(memberId), familyId, status: MEMBER_ACTIVE },
      select: { id: true, userId: true },
    });
    if (!m) throw BusinessException.invalidParam('选的人不在这个家里哦');
    return m;
  }

  private async familyNameOf(familyId: bigint): Promise<string> {
    const f = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { name: true },
    });
    return f?.name ?? '这个家';
  }

  /**
   * 订阅消息剩余额度（辅助通道）。没配模板 ID 时返回 null ——
   * 这时前端不该显示「还有几条」这种没意义的数字。
   */
  private async quotaRemaining(userId: bigint): Promise<number | null> {
    const kind = subKindOf(NotifyType.REMINDER);
    if (!kind) return null;
    const templateId = this.quota.templateIdOf(kind);
    if (!templateId) return null;
    return this.quota.remaining(userId, templateId);
  }

  private parseRemindAt(raw: string): Date {
    if (!isBeijingDateTime(raw)) throw BusinessException.invalidParam('提醒时间格式不对');
    const d = parseBeijingDateTime(raw);
    if (!d) throw BusinessException.invalidParam('提醒时间格式不对');
    return d;
  }
}

// ---------------------------------------------------------------
// 枚举转换（集中一处，避免散落数字）
// ---------------------------------------------------------------

/** 数字渠道 → 接口字符串 */
function channelName(v: number): string {
  return dbToEnum(NotifyChannel, v) ?? 'IN_APP';
}

function requireRemindType(v: string): number {
  const n = enumToDb(RemindType, v);
  if (n === undefined) throw BusinessException.invalidParam('提醒方式不对');
  return n;
}

function requireRecurrenceType(v: string | undefined): number {
  if (v === undefined) return RecurrenceType.NONE;
  const n = enumToDb(RecurrenceType, v);
  if (n === undefined) throw BusinessException.invalidParam('重复方式不对');
  return n;
}

function requireReminderStatus(v: string): number {
  const n = enumToDb(ReminderStatus, v);
  if (n === undefined) throw BusinessException.invalidParam('状态不对');
  return n;
}

/** 空值不下发（保持列默认 null），避免写进一个 JSON `null` */
function toJson(v: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (v == null) return undefined;
  return v as Prisma.InputJsonValue;
}
