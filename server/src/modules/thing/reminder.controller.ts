import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseBigInt } from '../../common/pipes/parse-bigint.pipe';
import { FamilyMemberCtx } from '../families/decorators/family-member.decorator';
import { FamilyMemberGuard } from '../families/guards/family-member.guard';
import type { FamilyMemberContext } from '../families/family-context';
import type { InboxResponse, NudgeResponse, ThingDetail } from '@shared/dto/thing';
import { ReminderService } from './reminder.service';
import { ThingService } from './thing.service';
import { AddReminderDto, InboxQueryDto, NudgeDto } from './dto/reminder.dto';

/**
 * 提醒模块（docs/02 §五）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST   /api/reminders/nudge                     立即叮一下
 *   GET    /api/reminders/inbox                     我的待提醒（收件箱兜底）
 *   POST   /api/reminders/inbox/:id/read            标记已读
 *   DELETE /api/reminders/:id                       取消一条提醒
 *   POST   /api/family-things/:thingId/reminders    给已有小事补一条提醒
 *
 * 为什么这个控制器**不带** `@Controller('reminders')` 前缀：
 * 「给小事加提醒」的路径挂在 `/family-things/:thingId/reminders` 下 ——
 * 它是小事的子资源，按 docs/02 就该在那儿。用一个空前缀的控制器
 * 把两组路径收在同一个文件里，比拆成两个控制器更好读。
 *
 * 家庭上下文的取法沿用小事模块的约定：
 *   familyId 能从请求读到的（nudge / inbox）→ `FamilyMemberGuard`
 *   URL 里只有资源 ID 的（read / delete / add）→ 顺着「资源 → 小事 → 家庭」反查
 */
@Controller()
export class ReminderController {
  constructor(
    private readonly reminders: ReminderService,
    private readonly things: ThingService,
  ) {}

  /** 立即叮一下（M2-B17） */
  @Post('reminders/nudge')
  @UseGuards(FamilyMemberGuard)
  async nudge(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: NudgeDto,
  ): Promise<NudgeResponse> {
    return this.reminders.nudge(ctx, dto);
  }

  /** 我的待提醒（M2-B24） */
  @Get('reminders/inbox')
  @UseGuards(FamilyMemberGuard)
  async inbox(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query() query: InboxQueryDto,
  ): Promise<InboxResponse> {
    return this.reminders.inbox(ctx, query);
  }

  /** 标记收件箱某条已读（docs/02 §5.5） */
  @Post('reminders/inbox/:id/read')
  async markRead(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这条提醒')) id: bigint,
  ): Promise<{ ok: true }> {
    const ctx = await this.reminders.contextForReminder(userId, id);
    await this.reminders.markInboxRead(ctx, id);
    return { ok: true };
  }

  /** 取消一条提醒（docs/02 §5.2） */
  @Delete('reminders/:id')
  async cancel(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这条提醒')) id: bigint,
  ): Promise<{ ok: true }> {
    await this.reminders.cancelReminder(userId, id);
    return { ok: true };
  }

  /** 给已有小事补一条提醒（docs/02 §5.1），返回更新后的小事详情 */
  @Post('family-things/:thingId/reminders')
  async add(
    @CurrentUser('userId') userId: bigint,
    @Param('thingId', parseBigInt('这件小事')) thingId: bigint,
    @Body() dto: AddReminderDto,
  ): Promise<ThingDetail> {
    const ctx = await this.things.contextForThing(userId, thingId);
    return this.reminders.addReminder(ctx, thingId, dto);
  }
}
