import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FamilyThing, ThingReminder } from '@prisma/client';
import {
  RecurrenceType,
  RemindType,
  ReminderStatus,
  ThingStatus,
  ThingType,
  ThingVisibility,
  dbToEnum,
  enumToDb,
} from '@shared/enums';
import type {
  CompleteThingResponse,
  ListThingsResponse,
  RecurrenceConfig,
  ThingDetail,
  ThingListItem,
  ThingMemberBrief,
  ThingStatusValue,
  ThingTypeValue,
  ThingVisibilityValue,
  TodaySummary,
} from '@shared/dto/thing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotifyService } from '../notify/notify.service';
import { FamiliesService } from '../families/families.service';
import { ContentSecurityService } from '../wechat/content-security.service';
import { BusinessException } from '../../common/errors/business.exception';
import {
  beijingDayRange,
  formatDateRequired,
  formatDateTime,
  formatDateTimeRequired,
  formatTimeOfDay,
  parseBeijingDateTime,
  toNumber,
  toNumberRequired,
} from '../../common/serialize/beijing-time';
import type { FamilyMemberContext } from '../families/family-context';
import type {
  CreateThingDto,
  ListThingsQueryDto,
  ReminderInputDto,
  UpdateThingDto,
} from './dto/thing.dto';
import { isBeijingDateTime } from './dto/thing.dto';
import { nextOccurrence, nextOccurrenceAfter } from './recurrence';

/** 列表默认每页条数 */
const DEFAULT_PAGE_SIZE = 20;
/** 列表每页上限 —— 防止前端传 10000 把库拖垮 */
const MAX_PAGE_SIZE = 50;
/** 一条小事最多挂多少条提醒 */
const MAX_REMINDERS = 20;
/** 「在册成员」的状态值（family_members.status = 1） */
const MEMBER_ACTIVE = 1;

/**
 * 小事（派活 / 叮一下）的业务逻辑 —— docs/02 §四。
 *
 * 三条贯穿全文件的纪律：
 *   ① **隐私过滤在 SQL 层做**。`visibility=RELATED` 的小事，非创建人/执行人
 *      在 `where` 里就被排除，不是查出来再过滤 —— 后者一旦有人漏写 if 就泄了。
 *   ② **不做物理删除**。取消是 `status=3`，历史留着。
 *   ③ **推送失败不阻塞用户操作**。通知是「尽力而为」，异常只记日志。
 *
 * 内容安全（M2-B9）在**写库之前**做：检测不通过要能整体拦下，
 * 不留半条数据；策略（拦什么、放什么）统一在 `ContentSecurityService`。
 */
@Injectable()
export class ThingService {
  private readonly logger = new Logger(ThingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly families: FamiliesService,
    private readonly notify: NotifyService,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  // =============================================================
  // 创建（M2-B10）
  // =============================================================

  /**
   * 创建小事（派活 / 叮一下）。
   *
   * 事务内一次写 `family_things` + `thing_reminders` ——
   * 不允许出现「小事建好了但提醒丢了」这种半成品。
   * 通知在事务**之外**发：推送失败不该让创建回滚。
   */
  async create(ctx: FamilyMemberContext, dto: CreateThingDto): Promise<ThingDetail> {
    const type = requireThingType(dto.type);
    const title = dto.title.trim();
    if (!title) throw BusinessException.invalidParam('要写点什么呢');
    const content = dto.content?.trim() || null;

    // 内容安全（M2-B9）：写库前拦掉确定违规的内容。
    // 两段**并发**检测 —— 串行会让用户在创建页白等一次往返。
    await Promise.all([
      this.contentSecurity.assertTextSafe(ctx.userId, title, '小事的标题'),
      this.contentSecurity.assertTextSafe(ctx.userId, content, '小事的说明'),
    ]);

    const assignee = await this.assertAssigneeInFamily(ctx.familyId, dto.assigneeMemberId);
    const visibility =
      dto.visibility != null
        ? requireVisibility(dto.visibility)
        : type === ThingType.TASK
          ? ThingVisibility.FAMILY
          : ThingVisibility.RELATED;

    const dueAt = this.parseDueAt(dto.dueAt);
    const recurrenceType = requireRecurrenceType(dto.recurrenceType);
    const reminders = this.normalizeReminders(dto.reminders, assignee.id);

    const created = await this.prisma.$transaction(async (tx) => {
      const thing = await tx.familyThing.create({
        data: {
          familyId: ctx.familyId,
          creatorMemberId: ctx.memberId,
          type,
          title,
          content,
          assigneeMemberId: assignee.id,
          visibility,
          status: ThingStatus.PENDING,
          dueAt,
          recurrenceType,
          recurrenceConfig: toJson(dto.recurrenceConfig),
        },
      });

      await this.insertReminders(tx, thing.id, reminders);

      return thing;
    });

    this.logger.log(`用户 ${ctx.userId} 在家庭 ${ctx.familyId} 创建小事 ${created.id}「${title}」`);

    // 通知是尽力而为：放在事务外，失败只记日志
    await this.dispatchOnCreate(ctx, created, assignee, reminders);

    return this.detail(ctx, created.id);
  }

  // =============================================================
  // 列表（M2-B11）
  // =============================================================

  /** 小事列表，含服务端隐私过滤与多种筛选（docs/02 §4.2） */
  async list(ctx: FamilyMemberContext, query: ListThingsQueryDto): Promise<ListThingsResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = clamp(query.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

    const where = this.buildListWhere(ctx, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.familyThing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.familyThing.count({ where }),
    ]);

    const [briefs, reminderInfo] = await Promise.all([
      this.memberBriefs(rows.flatMap((r) => [r.creatorMemberId, r.assigneeMemberId])),
      this.pendingReminderInfo(rows.map((r) => r.id)),
    ]);

    return {
      list: rows.map((r) => this.toListItem(r, briefs, reminderInfo)),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  // =============================================================
  // 详情（M2-B13）
  // =============================================================

  /** 小事详情（docs/02 §4.3） */
  async detail(ctx: FamilyMemberContext, thingId: bigint): Promise<ThingDetail> {
    const thing = await this.loadVisibleThing(ctx, thingId);

    const [briefs, reminders] = await Promise.all([
      this.memberBriefs([
        thing.creatorMemberId,
        thing.assigneeMemberId,
        thing.completedByMemberId,
      ]),
      this.prisma.thingReminder.findMany({
        where: { thingId: thing.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return this.toDetail(thing, briefs, reminders);
  }

  // =============================================================
  // 编辑（M2-B14）
  // =============================================================

  /**
   * 编辑小事（docs/02 §4.4）。权限：创建人或家庭创建者。
   *
   * `reminders` 传了就**全量替换**：旧提醒置 `status=3`（取消，不物理删），
   * 再建新的。这样前端不用做 diff，少一类 bug。
   */
  async update(
    ctx: FamilyMemberContext,
    thingId: bigint,
    dto: UpdateThingDto,
  ): Promise<ThingDetail> {
    const thing = await this.loadVisibleThing(ctx, thingId);
    this.assertCanEdit(ctx, thing);

    if (thing.status === ThingStatus.CANCELLED) {
      throw BusinessException.conflict('这件小事已经取消啦，不能改了');
    }

    const data: Prisma.FamilyThingUpdateInput = {};

    const nextTitle = dto.title !== undefined ? dto.title.trim() : undefined;
    if (nextTitle !== undefined) {
      if (!nextTitle) throw BusinessException.invalidParam('标题不能空着');
      data.title = nextTitle;
    }
    // null 表示「用户清空了说明」，undefined 表示「没传这个字段」—— 两者不能混
    const nextContent = dto.content !== undefined ? dto.content?.trim() || null : undefined;
    if (nextContent !== undefined) data.content = nextContent;

    // 内容安全（M2-B9）：只检测**本次真的改了**的字段，不为没动的字段白跑一次微信
    await Promise.all([
      ...(nextTitle !== undefined
        ? [this.contentSecurity.assertTextSafe(ctx.userId, nextTitle, '小事的标题')]
        : []),
      ...(nextContent !== undefined
        ? [this.contentSecurity.assertTextSafe(ctx.userId, nextContent, '小事的说明')]
        : []),
    ]);

    if (dto.dueAt !== undefined) data.dueAt = this.parseDueAt(dto.dueAt);
    if (dto.visibility !== undefined) data.visibility = requireVisibility(dto.visibility);
    if (dto.recurrenceType !== undefined) {
      data.recurrenceType = requireRecurrenceType(dto.recurrenceType);
    }
    if (dto.recurrenceConfig !== undefined) data.recurrenceConfig = toJson(dto.recurrenceConfig);

    let nextAssigneeId = thing.assigneeMemberId ?? thing.creatorMemberId;
    if (dto.assigneeMemberId !== undefined) {
      const assignee = await this.assertAssigneeInFamily(ctx.familyId, dto.assigneeMemberId);
      data.assigneeMemberId = assignee.id;
      nextAssigneeId = assignee.id;
    }

    const replaceReminders = dto.reminders !== undefined;
    const reminders = replaceReminders
      ? this.normalizeReminders(dto.reminders, nextAssigneeId)
      : [];

    await this.prisma.$transaction(async (tx) => {
      await tx.familyThing.update({ where: { id: thing.id }, data });

      if (replaceReminders) {
        // 旧的只「取消」，不删 —— 发送历史要留着
        await tx.thingReminder.updateMany({
          where: { thingId: thing.id, status: ReminderStatus.PENDING },
          data: { status: ReminderStatus.CANCELLED },
        });
        await this.insertReminders(tx, thing.id, reminders);
      }
    });

    return this.detail(ctx, thing.id);
  }

  // =============================================================
  // 完成（M2-B15）
  // =============================================================

  /**
   * 完成小事（docs/02 §4.5）。权限：执行人本人或家庭创建者。
   *
   * 副作用三件：
   *   ① 置 `status=2` + `completed_at` / `completed_by_member_id`
   *   ② 未发出的提醒全部取消（人都做完了，不用再叮）
   *   ③ 创建人 ≠ 完成人 → 给创建人发「完成回执」
   *
   * 另：若这条小事设了重复规则，顺手生成下一条实例，`nextThingId` 返回它。
   */
  async complete(ctx: FamilyMemberContext, thingId: bigint): Promise<CompleteThingResponse> {
    const thing = await this.loadVisibleThing(ctx, thingId);

    if (thing.status === ThingStatus.COMPLETED) {
      throw BusinessException.conflict('这件事已经弄好啦');
    }
    if (thing.status === ThingStatus.CANCELLED) {
      throw BusinessException.conflict('这件小事已经取消啦');
    }

    const isAssignee = thing.assigneeMemberId != null && thing.assigneeMemberId === ctx.memberId;
    if (!isAssignee && !ctx.isOwner) {
      throw BusinessException.forbidden('这件事不是你的，只有交给你的人才能说搞定');
    }

    const now = new Date();

    const { completed, nextThingId } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.familyThing.update({
        where: { id: thing.id },
        data: {
          status: ThingStatus.COMPLETED,
          completedAt: now,
          completedByMemberId: ctx.memberId,
        },
      });

      await tx.thingReminder.updateMany({
        where: { thingId: thing.id, status: ReminderStatus.PENDING },
        data: { status: ReminderStatus.CANCELLED },
      });

      const nextId = await this.spawnNextOccurrence(tx, updated);
      return { completed: updated, nextThingId: nextId };
    });

    // 完成回执：只有「别人帮我弄完了」才通知，自己弄完自己不用告诉自己
    if (completed.creatorMemberId !== ctx.memberId) {
      await this.safeNotify(async () => {
        const creatorUserId = await this.userIdOfMember(completed.creatorMemberId);
        if (creatorUserId == null) return;

        const [familyName, doneByRoleName, creatorRoleName] = await Promise.all([
          this.familyName(completed.familyId),
          this.roleNameOfMember(ctx.memberId),
          this.roleNameOfMember(completed.creatorMemberId),
        ]);

        await this.notify.notifyTaskDone({
          userId: creatorUserId,
          familyId: completed.familyId,
          thingId: completed.id,
          ctx: {
            roleName: creatorRoleName,
            familyName,
            thingTitle: completed.title,
            doneByRoleName,
            doneAt: now,
          },
        });
      });
    }

    const briefs = await this.memberBriefs([completed.completedByMemberId]);

    return {
      id: toNumberRequired(completed.id),
      status: requireThingStatusName(completed.status),
      completedAt: formatDateTime(completed.completedAt),
      completedBy: completed.completedByMemberId
        ? (briefs.get(completed.completedByMemberId) ?? null)
        : null,
      nextThingId: toNumber(nextThingId),
    };
  }

  // =============================================================
  // 取消 / 重新打开（M2-B16）
  // =============================================================

  /** 取消小事（docs/02 §4.6）。权限：创建人或家庭创建者。 */
  async cancel(ctx: FamilyMemberContext, thingId: bigint): Promise<void> {
    const thing = await this.loadVisibleThing(ctx, thingId);
    this.assertCanEdit(ctx, thing);

    if (thing.status === ThingStatus.CANCELLED) return; // 幂等

    await this.prisma.$transaction(async (tx) => {
      await tx.familyThing.update({
        where: { id: thing.id },
        data: { status: ThingStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.thingReminder.updateMany({
        where: { thingId: thing.id, status: ReminderStatus.PENDING },
        data: { status: ReminderStatus.CANCELLED },
      });
    });
  }

  /** 重新打开（docs/02 §4.7）：COMPLETED / CANCELLED → PENDING。 */
  async reopen(ctx: FamilyMemberContext, thingId: bigint): Promise<void> {
    const thing = await this.loadVisibleThing(ctx, thingId);
    this.assertCanEdit(ctx, thing);

    if (thing.status === ThingStatus.PENDING) return; // 幂等

    await this.prisma.familyThing.update({
      where: { id: thing.id },
      data: {
        status: ThingStatus.PENDING,
        completedAt: null,
        completedByMemberId: null,
        cancelledAt: null,
      },
    });
  }

  // =============================================================
  // 首页今日汇总（M2-B12）
  // =============================================================

  /**
   * 一次请求拿齐「今日提醒 + 今日派活 + 计数」（docs/02 §4.8）。
   *
   * 为什么单独开一个接口：首页如果并发 3 个请求，弱网下会出现
   * 「提醒回来了、派活还在转」的割裂感，还多耗 2 次 RTT。
   *
   * 「今天」的判据两类各自取：
   *   - **派活**看 `due_at`（要求什么时候做完）
   *   - **叮一下**看 `thing_reminders.next_remind_at`（什么时候叮）
   *     光看 `due_at` 会漏掉「只设了提醒时间、没设要求时间」的叮一下 ——
   *     而那种恰恰是最常见的用法。
   *
   * `stats` 的口径（三者互相独立，别硬凑成加法关系）：
   *   todayTotal = 今天列出来的提醒数 + 派活数
   *   todayDone  = 要求时间在今天的、已完成的小事数
   *   overdue    = 要求时间已过、仍未完成的小事数（不限今天）
   */
  async today(ctx: FamilyMemberContext): Promise<TodaySummary> {
    const now = new Date();
    const { start, end } = beijingDayRange(now);
    const privacy = this.privacyFilter(ctx);
    const dayScope: Prisma.FamilyThingWhereInput = { dueAt: { gte: start, lt: end } };

    // 今天「有提醒动作」的提醒 —— 两类都算：
    //   · 还没发、今天会发的（`next_remind_at` 落在今天）
    //   · 已经发过的立即叮（`remind_at` 落在今天）
    // 后者也要列出来：事情叮过了不等于做完了，对方打开小程序还得看得见。
    // `next_remind_at` 上有 idx_next_remind，这次扫描是走索引的
    // （调度器到点扫描用的是同一个索引）。
    const firing = await this.prisma.thingReminder.findMany({
      where: {
        OR: [
          { status: ReminderStatus.PENDING, nextRemindAt: { gte: start, lt: end } },
          { remindAt: { gte: start, lt: end } },
        ],
      },
      select: { thingId: true, nextRemindAt: true, remindAt: true },
    });
    const firingAt = new Map<bigint, Date>();
    for (const r of firing) {
      const at = r.nextRemindAt ?? r.remindAt;
      if (!at) continue;
      const prev = firingAt.get(r.thingId);
      if (!prev || at < prev) firingAt.set(r.thingId, at);
    }
    const firingThingIds = [...firingAt.keys()];

    const [reminderRows, taskRows, todayDone, overdue] = await Promise.all([
      this.prisma.familyThing.findMany({
        where: {
          AND: [
            privacy,
            { familyId: ctx.familyId },
            { type: ThingType.REMINDER },
            { status: ThingStatus.PENDING },
            { OR: [dayScope, { id: { in: firingThingIds } }] },
          ],
        },
        orderBy: { dueAt: 'asc' },
      }),
      this.prisma.familyThing.findMany({
        where: {
          AND: [
            privacy,
            { familyId: ctx.familyId },
            { type: ThingType.TASK },
            { status: { not: ThingStatus.CANCELLED } },
            dayScope,
          ],
        },
        orderBy: { dueAt: 'asc' },
      }),
      this.prisma.familyThing.count({
        where: {
          AND: [privacy, { familyId: ctx.familyId }, { status: ThingStatus.COMPLETED }, dayScope],
        },
      }),
      this.prisma.familyThing.count({
        where: {
          AND: [
            privacy,
            { familyId: ctx.familyId },
            { status: ThingStatus.PENDING },
            { dueAt: { lt: now } },
          ],
        },
      }),
    ]);

    const briefs = await this.memberBriefs(
      [...reminderRows, ...taskRows].map((r) => r.assigneeMemberId),
    );

    /** 叮一下显示哪个时刻：优先 dueAt，其次今天会响的那条提醒 */
    const timeOf = (row: FamilyThing): string => {
      const fromDue = row.dueAt && row.dueAt >= start && row.dueAt < end
        ? formatTimeOfDay(row.dueAt)
        : null;
      return fromDue ?? formatTimeOfDay(firingAt.get(row.id) ?? null) ?? '--:--';
    };

    return {
      date: formatDateRequired(now),
      reminders: reminderRows.map((r) => ({
        id: toNumberRequired(r.id),
        title: r.title,
        time: timeOf(r),
        assignee: r.assigneeMemberId ? (briefs.get(r.assigneeMemberId) ?? null) : null,
        status: requireThingStatusName(r.status),
      })),
      tasks: taskRows.map((r) => ({
        id: toNumberRequired(r.id),
        title: r.title,
        assignee: r.assigneeMemberId ? (briefs.get(r.assigneeMemberId) ?? null) : null,
        dueAt: formatDateTime(r.dueAt),
        status: requireThingStatusName(r.status),
      })),
      stats: {
        todayTotal: reminderRows.length + taskRows.length,
        todayDone,
        overdue,
      },
    };
  }

  // =============================================================
  // 供提醒模块复用
  // =============================================================

  /**
   * 由「小事 ID」反查家庭上下文 —— 给那些 URL 里**没有 familyId** 的接口用
   * （详情 / 编辑 / 完成 / 取消 / 重开）。
   *
   * 为什么不要求前端在 URL 里带上 familyId：小事自己就知道属于哪个家，
   * 让前端多传一个「必须与小事一致」的参数，只会多一类对不上的 bug。
   *
   * 失败语义（与 docs/02 §4.3 一致）：
   *   小事不存在            → 40400
   *   小事存在但我不是成员  → 40300（**不是** 404 —— 这里不涉及隐私内容，
   *                          只是「你不在这个家」，给准确的原因更好排查）
   */
  async contextForThing(userId: bigint, thingId: bigint): Promise<FamilyMemberContext> {
    const thing = await this.prisma.familyThing.findUnique({
      where: { id: thingId },
      select: { familyId: true },
    });
    if (!thing) throw BusinessException.notFound('这件小事');

    const member = await this.families.findActiveMember(thing.familyId, userId);
    if (!member) throw BusinessException.notMember();

    const ownerMemberId = await this.families.ownerMemberIdOf(thing.familyId);
    return {
      familyId: thing.familyId,
      memberId: member.id,
      userId,
      roleName: member.roleName,
      isOwner: ownerMemberId != null && ownerMemberId === member.id,
    };
  }

  /** 取一条**当前用户可见**的小事；不可见时按 404 处理（不泄露存在性） */
  async loadVisibleThing(ctx: FamilyMemberContext, thingId: bigint): Promise<FamilyThing> {
    const thing = await this.prisma.familyThing.findFirst({
      where: { id: thingId, familyId: ctx.familyId },
    });
    if (!thing) throw BusinessException.notFound('这件小事');

    const related = thing.visibility === ThingVisibility.RELATED;
    const involved =
      thing.creatorMemberId === ctx.memberId || thing.assigneeMemberId === ctx.memberId;
    if (related && !involved) {
      // 刻意报「找不到」而不是「没权限」：后者等于告诉对方「有这么件事」
      throw BusinessException.notFound('这件小事');
    }
    return thing;
  }

  /** 取一个家庭成员的称谓；不存在返回「家人」 */
  async roleNameOfMember(memberId: bigint): Promise<string> {
    const m = await this.prisma.familyMember.findUnique({
      where: { id: memberId },
      select: { roleName: true },
    });
    return m?.roleName ?? '家人';
  }

  /** 取一个成员的 userId（通知要按用户维度发） */
  async userIdOfMember(memberId: bigint): Promise<bigint | null> {
    const m = await this.prisma.familyMember.findUnique({
      where: { id: memberId },
      select: { userId: true },
    });
    return m?.userId ?? null;
  }

  // =============================================================
  // 内部：查询构造
  // =============================================================

  /** 隐私过滤片段 —— 列表与今日汇总共用，保证「看不见的到处都看不见」 */
  private privacyFilter(ctx: FamilyMemberContext): Prisma.FamilyThingWhereInput {
    return {
      OR: [
        { visibility: ThingVisibility.FAMILY },
        { creatorMemberId: ctx.memberId },
        { assigneeMemberId: ctx.memberId },
      ],
    };
  }

  private buildListWhere(
    ctx: FamilyMemberContext,
    query: ListThingsQueryDto,
  ): Prisma.FamilyThingWhereInput {
    const and: Prisma.FamilyThingWhereInput[] = [
      this.privacyFilter(ctx),
      { familyId: ctx.familyId },
    ];

    if (query.type) and.push({ type: requireThingType(query.type) });

    if (query.status) {
      and.push({ status: requireThingStatus(query.status) });
    } else {
      // 不传 status：默认不返回已取消的
      and.push({ status: { not: ThingStatus.CANCELLED } });
    }

    if (query.assigneeMemberId) and.push({ assigneeMemberId: BigInt(query.assigneeMemberId) });

    if (query.scope === 'MINE') and.push({ creatorMemberId: ctx.memberId });
    if (query.scope === 'ASSIGNED_TO_ME') and.push({ assigneeMemberId: ctx.memberId });

    const start = query.startDate ? parseDayStart(query.startDate) : null;
    const end = query.endDate ? parseDayEnd(query.endDate) : null;
    if (start || end) {
      const range: Prisma.DateTimeFilter = {};
      if (start) range.gte = start;
      if (end) range.lt = end;
      // 有要求时间的按 dueAt 筛；没有要求时间的按创建时间兜进来，
      // 否则「今天」视图会漏掉那些没设时间的活
      and.push({ OR: [{ dueAt: range }, { dueAt: null, createdAt: range }] });
    }

    if (query.keyword?.trim()) {
      and.push({ title: { contains: query.keyword.trim() } });
    }

    return { AND: and };
  }

  // =============================================================
  // 内部：写入
  // =============================================================

  /**
   * 把 DTO 里的提醒项规整成「可落库」的形状，并做一次集中校验。
   * 校验放在这里而不是 DTO：`remindAt` 的合法性依赖 `remindType`，是跨字段规则。
   */
  private normalizeReminders(
    input: ReminderInputDto[] | undefined,
    defaultRecipientId: bigint,
  ): NormalizedReminder[] {
    if (!input || input.length === 0) return [];
    if (input.length > MAX_REMINDERS) {
      throw BusinessException.invalidParam(`一条小事最多挂 ${MAX_REMINDERS} 个提醒`);
    }

    return input.map((r) => {
      const remindType = requireRemindType(r.remindType);
      const remindAt = r.remindAt ? this.parseRemindAt(r.remindAt) : null;

      if (remindType === RemindType.SCHEDULED && remindAt == null) {
        throw BusinessException.invalidParam('定时提醒要选个时间哦');
      }

      return {
        recipientMemberId: r.recipientMemberId ? BigInt(r.recipientMemberId) : defaultRecipientId,
        remindType,
        remindAt,
        recurrenceType: requireRecurrenceType(r.recurrenceType),
        recurrenceConfig: r.recurrenceConfig ?? null,
      };
    });
  }

  /** 批量插入提醒，并算好 `next_remind_at`（调度器扫描用） */
  private async insertReminders(
    tx: Prisma.TransactionClient,
    thingId: bigint,
    reminders: NormalizedReminder[],
  ): Promise<void> {
    if (reminders.length === 0) return;

    const now = new Date();
    for (const r of reminders) {
      // 立即叮：`remindAt` 记下**实际提醒时刻**（就是现在），
      // `next_remind_at` 也先写「现在」——创建流程会立刻下发，之后置为 null。
      // 记下 remindAt 是为了让「今日提醒」能把已经叮过、但对方还没处理的事也列出来。
      const isNow = r.remindType === RemindType.NOW;
      const remindAt = r.remindAt ?? (isNow ? now : null);

      await tx.thingReminder.create({
        data: {
          thingId,
          recipientMemberId: r.recipientMemberId,
          remindType: r.remindType,
          remindAt,
          recurrenceType: r.recurrenceType,
          recurrenceConfig: toJson(r.recurrenceConfig),
          status: ReminderStatus.PENDING,
          nextRemindAt: isNow ? now : r.remindAt,
        },
      });
    }
  }

  /**
   * 重复小事完成后，生成下一条实例（docs/02 §4.5）。
   *
   * 只在 `recurrenceType != NONE` 时发生 —— 默认 NONE，所以这条路径
   * 对普通小事完全无感（V0.1 的「每天重复」本身也在未来需求池里）。
   */
  private async spawnNextOccurrence(
    tx: Prisma.TransactionClient,
    done: FamilyThing,
  ): Promise<bigint | null> {
    if (done.recurrenceType === RecurrenceType.NONE) return null;

    const config = done.recurrenceConfig as RecurrenceConfig | null;
    const base = done.dueAt ?? new Date();
    const nextDue = nextOccurrenceAfter(done.recurrenceType, config, base, new Date());
    if (!nextDue) return null;

    const next = await tx.familyThing.create({
      data: {
        familyId: done.familyId,
        creatorMemberId: done.creatorMemberId,
        type: done.type,
        title: done.title,
        content: done.content,
        assigneeMemberId: done.assigneeMemberId,
        visibility: done.visibility,
        status: ThingStatus.PENDING,
        dueAt: nextDue,
        recurrenceType: done.recurrenceType,
        recurrenceConfig: toJson(config),
        sourceThingId: done.id,
      },
    });

    // 把原提醒整体平移到新时间点：保持「提前多久提醒」的相对关系
    const oldReminders = await tx.thingReminder.findMany({ where: { thingId: done.id } });
    const shiftMs = nextDue.getTime() - base.getTime();

    for (const r of oldReminders) {
      if (r.remindType !== RemindType.SCHEDULED) continue;

      const shifted = r.remindAt ? new Date(r.remindAt.getTime() + shiftMs) : null;
      const nextAt =
        r.recurrenceType === RecurrenceType.NONE
          ? shifted
          : nextOccurrence(r.recurrenceType, r.recurrenceConfig as RecurrenceConfig | null, nextDue);

      await tx.thingReminder.create({
        data: {
          thingId: next.id,
          recipientMemberId: r.recipientMemberId,
          remindType: r.remindType,
          remindAt: shifted,
          recurrenceType: r.recurrenceType,
          recurrenceConfig: toJson(r.recurrenceConfig as RecurrenceConfig | null),
          status: ReminderStatus.PENDING,
          nextRemindAt: nextAt,
        },
      });
    }

    return next.id;
  }

  // =============================================================
  // 内部：通知
  // =============================================================

  /** 创建后的通知：派活通知 + 立即叮一下（后者即时下发） */
  private async dispatchOnCreate(
    ctx: FamilyMemberContext,
    thing: FamilyThing,
    assignee: { id: bigint; userId: bigint },
    reminders: NormalizedReminder[],
  ): Promise<void> {
    const familyName = await this.familyName(ctx.familyId);
    const creatorRoleName = ctx.roleName;

    // 派活：交给别人时通知对方（自己派给自己不必通知）
    if (thing.type === ThingType.TASK && assignee.id !== ctx.memberId) {
      await this.safeNotify(async () => {
        await this.notify.notifyTaskAssigned({
          userId: assignee.userId,
          familyId: ctx.familyId,
          thingId: thing.id,
          ctx: {
            roleName: await this.roleNameOfMember(assignee.id),
            familyName,
            thingTitle: thing.title,
            thingContent: thing.content ?? undefined,
            fromRoleName: creatorRoleName,
            dueAt: thing.dueAt ?? undefined,
          },
        });
      });
    }

    // 立即叮：创建时就发出去，并把该条提醒置为已发送
    const nowReminders = reminders.filter((r) => r.remindType === RemindType.NOW);
    if (nowReminders.length === 0) return;

    const now = new Date();
    for (const r of nowReminders) {
      const recipientUserId = await this.userIdOfMember(r.recipientMemberId);
      if (recipientUserId != null) {
        await this.safeNotify(async () => {
          await this.notify.notifyReminder({
            userId: recipientUserId,
            familyId: ctx.familyId,
            thingId: thing.id,
            ctx: {
              roleName: await this.roleNameOfMember(r.recipientMemberId),
              familyName,
              thingTitle: thing.title,
              thingContent: thing.content ?? undefined,
              fromRoleName: creatorRoleName,
              remindAt: now,
            },
          });
        });
      }

      await this.prisma.thingReminder.updateMany({
        where: {
          thingId: thing.id,
          recipientMemberId: r.recipientMemberId,
          remindType: RemindType.NOW,
          status: ReminderStatus.PENDING,
        },
        data: { status: ReminderStatus.SENT, sentCount: 1, lastSentAt: now, nextRemindAt: null },
      });
    }
  }

  /** 通知失败绝不能影响主流程 —— 只记日志 */
  private async safeNotify(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(`通知下发失败（已忽略）：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // =============================================================
  // 内部：装配 DTO
  // =============================================================

  private toListItem(
    row: FamilyThing,
    briefs: Map<bigint, ThingMemberBrief>,
    reminderInfo: Map<bigint, { has: boolean; next: Date | null }>,
  ): ThingListItem {
    const info = reminderInfo.get(row.id);
    return {
      id: toNumberRequired(row.id),
      type: requireThingTypeName(row.type),
      title: row.title,
      content: row.content,
      status: requireThingStatusName(row.status),
      visibility: requireVisibilityName(row.visibility),
      dueAt: formatDateTime(row.dueAt),
      creator: briefs.get(row.creatorMemberId) ?? unknownMember(row.creatorMemberId),
      assignee: row.assigneeMemberId ? (briefs.get(row.assigneeMemberId) ?? null) : null,
      hasReminder: info?.has ?? false,
      nextRemindAt: formatDateTime(info?.next ?? null),
      isOverdue: isOverdue(row, new Date()),
      createdAt: formatDateTimeRequired(row.createdAt),
    };
  }

  private toDetail(
    row: FamilyThing,
    briefs: Map<bigint, ThingMemberBrief>,
    reminders: ThingReminder[],
  ): ThingDetail {
    const pending = reminders.filter((r) => r.status === ReminderStatus.PENDING);
    const nextAt = pending.reduce<Date | null>((acc, r) => {
      if (!r.nextRemindAt) return acc;
      return !acc || r.nextRemindAt < acc ? r.nextRemindAt : acc;
    }, null);

    return {
      ...this.toListItem(
        row,
        briefs,
        new Map([[row.id, { has: pending.length > 0, next: nextAt }]]),
      ),
      reminders: reminders.map((r) => ({
        id: toNumberRequired(r.id),
        remindType: requireRemindTypeName(r.remindType),
        remindAt: formatDateTime(r.remindAt),
        recurrenceType: requireRecurrenceTypeName(r.recurrenceType),
        status: requireReminderStatusName(r.status),
        sentCount: r.sentCount,
        lastSentAt: formatDateTime(r.lastSentAt),
      })),
      completedAt: formatDateTime(row.completedAt),
      completedBy: row.completedByMemberId ? (briefs.get(row.completedByMemberId) ?? null) : null,
      cancelledAt: formatDateTime(row.cancelledAt),
      updatedAt: formatDateTimeRequired(row.updatedAt),
    };
  }

  // =============================================================
  // 内部：取数
  // =============================================================

  /**
   * 批量取成员简写（称谓 + 头像），一次两条查询，不做 N+1。
   * 对提醒模块公开 —— 收件箱也要把「谁叮的」显示成称谓。
   */
  async memberBriefs(
    memberIds: (bigint | null | undefined)[],
  ): Promise<Map<bigint, ThingMemberBrief>> {
    const ids = [...new Set(memberIds.filter((v): v is bigint => v != null).map(String))].map((s) =>
      BigInt(s),
    );
    if (ids.length === 0) return new Map();

    const members = await this.prisma.familyMember.findMany({
      where: { id: { in: ids } },
      select: { id: true, roleName: true, userId: true },
    });
    if (members.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, avatarUrl: true },
    });
    const avatarById = new Map(users.map((u) => [u.id, u.avatarUrl]));

    return new Map(
      members.map((m) => [
        m.id,
        {
          memberId: toNumberRequired(m.id),
          roleName: m.roleName,
          avatarUrl: avatarById.get(m.userId) ?? null,
        } satisfies ThingMemberBrief,
      ]),
    );
  }

  /** 一次查出多条小事的「有没有待发提醒 / 下一条什么时候」 */
  private async pendingReminderInfo(
    thingIds: bigint[],
  ): Promise<Map<bigint, { has: boolean; next: Date | null }>> {
    const out = new Map<bigint, { has: boolean; next: Date | null }>();
    if (thingIds.length === 0) return out;

    const rows = await this.prisma.thingReminder.findMany({
      where: { thingId: { in: thingIds }, status: ReminderStatus.PENDING },
      select: { thingId: true, nextRemindAt: true },
    });

    for (const r of rows) {
      const prev = out.get(r.thingId);
      const next =
        r.nextRemindAt && (!prev?.next || r.nextRemindAt < prev.next)
          ? r.nextRemindAt
          : (prev?.next ?? null);
      out.set(r.thingId, { has: true, next });
    }
    return out;
  }

  private async familyName(familyId: bigint): Promise<string> {
    const f = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { name: true },
    });
    return f?.name ?? '这个家';
  }

  /** 确认执行人是本家庭的**在册成员** —— 否则能把活派给外人的 memberId */
  private async assertAssigneeInFamily(
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

  /** 只有创建人或家庭创建者能改 / 取消 */
  private assertCanEdit(ctx: FamilyMemberContext, thing: FamilyThing): void {
    if (thing.creatorMemberId !== ctx.memberId && !ctx.isOwner) {
      throw BusinessException.forbidden('这件事不是你发起的，改不了');
    }
  }

  // =============================================================
  // 内部：时间解析
  // =============================================================

  private parseDueAt(raw: string | null | undefined): Date | null {
    if (raw == null || raw === '') return null;
    if (!isBeijingDateTime(raw)) throw BusinessException.invalidParam('时间格式不对');
    const d = parseBeijingDateTime(raw);
    if (!d) throw BusinessException.invalidParam('时间格式不对');
    return d;
  }

  private parseRemindAt(raw: string): Date {
    if (!isBeijingDateTime(raw)) throw BusinessException.invalidParam('提醒时间格式不对');
    const d = parseBeijingDateTime(raw);
    if (!d) throw BusinessException.invalidParam('提醒时间格式不对');
    return d;
  }
}

// ---------------------------------------------------------------
// 类型与模块级工具
// ---------------------------------------------------------------

/** 规整后的提醒项（DTO → 落库形状） */
interface NormalizedReminder {
  recipientMemberId: bigint;
  remindType: number;
  remindAt: Date | null;
  recurrenceType: number;
  recurrenceConfig: RecurrenceConfig | null;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toJson(v: RecurrenceConfig | null | undefined): Prisma.InputJsonValue | undefined {
  if (v == null) return undefined;
  return v as Prisma.InputJsonValue;
}

function isOverdue(row: FamilyThing, now: Date): boolean {
  return (
    row.status === ThingStatus.PENDING && row.dueAt != null && row.dueAt.getTime() < now.getTime()
  );
}

/** "YYYY-MM-DD" → 当天 00:00:00（北京时间） */
function parseDayStart(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/** "YYYY-MM-DD" → **次日** 00:00:00（北京时间），配合 `<` 使用 */
function parseDayEnd(s: string): Date | null {
  const start = parseDayStart(s);
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
}

/** 成员被移除后仍可能出现在历史小事里 —— 给个不崩的占位 */
function unknownMember(memberId: bigint): ThingMemberBrief {
  return { memberId: toNumberRequired(memberId), roleName: '家人', avatarUrl: null };
}

// ---------------------------------------------------------------
// 枚举字符串 ↔ TINYINT（集中一处，避免各处散落数字）
// ---------------------------------------------------------------

function requireThingType(v: string): number {
  const n = enumToDb(ThingType, v);
  if (n === undefined) throw BusinessException.invalidParam('类型只能是派活或叮一下');
  return n;
}

function requireVisibility(v: string): number {
  const n = enumToDb(ThingVisibility, v);
  if (n === undefined) throw BusinessException.invalidParam('可见范围不对');
  return n;
}

function requireRecurrenceType(v: string | undefined): number {
  if (v === undefined) return RecurrenceType.NONE;
  const n = enumToDb(RecurrenceType, v);
  if (n === undefined) throw BusinessException.invalidParam('重复方式不对');
  return n;
}

function requireRemindType(v: string): number {
  const n = enumToDb(RemindType, v);
  if (n === undefined) throw BusinessException.invalidParam('提醒方式不对');
  return n;
}

function requireThingStatus(v: string): number {
  const n = enumToDb(ThingStatus, v);
  if (n === undefined) throw BusinessException.invalidParam('状态不对');
  return n;
}

// 数据库 → 接口字符串。取不到说明数据坏了，宁可报错也不要静默给错值。

function requireThingTypeName(v: number): ThingTypeValue {
  const s = dbToEnum(ThingType, v);
  if (!s) throw new Error(`family_things.type 取值异常：${v}`);
  return s as ThingTypeValue;
}

function requireThingStatusName(v: number): ThingStatusValue {
  const s = dbToEnum(ThingStatus, v);
  if (!s) throw new Error(`family_things.status 取值异常：${v}`);
  return s as ThingStatusValue;
}

function requireVisibilityName(v: number): ThingVisibilityValue {
  const s = dbToEnum(ThingVisibility, v);
  if (!s) throw new Error(`family_things.visibility 取值异常：${v}`);
  return s as ThingVisibilityValue;
}

function requireRemindTypeName(v: number): 'NOW' | 'SCHEDULED' {
  const s = dbToEnum(RemindType, v);
  if (!s) throw new Error(`thing_reminders.remind_type 取值异常：${v}`);
  return s as 'NOW' | 'SCHEDULED';
}

function requireReminderStatusName(v: number): 'PENDING' | 'SENT' | 'CANCELLED' {
  const s = dbToEnum(ReminderStatus, v);
  if (!s) throw new Error(`thing_reminders.status 取值异常：${v}`);
  return s as 'PENDING' | 'SENT' | 'CANCELLED';
}

function requireRecurrenceTypeName(v: number): 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM' {
  const s = dbToEnum(RecurrenceType, v);
  if (!s) throw new Error(`recurrence_type 取值异常：${v}`);
  return s as 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
}
