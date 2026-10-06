import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseBigInt } from '../../common/pipes/parse-bigint.pipe';
import { FamilyMemberCtx } from '../families/decorators/family-member.decorator';
import { FamilyMemberGuard } from '../families/guards/family-member.guard';
import type { FamilyMemberContext } from '../families/family-context';
import type {
  CompleteThingResponse,
  ListThingsResponse,
  ThingDetail,
  TodaySummary,
} from '@shared/dto/thing';
import { ThingService } from './thing.service';
import { CreateThingDto, ListThingsQueryDto, UpdateThingDto } from './dto/thing.dto';

/**
 * 小事模块（docs/02 §四）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST   /api/family-things                     创建（派活 / 叮一下）
 *   GET    /api/family-things                     列表（含隐私过滤）
 *   GET    /api/family-things/today               首页今日汇总
 *   GET    /api/family-things/:id                 详情
 *   PATCH  /api/family-things/:id                 编辑
 *   POST   /api/family-things/:id/complete        搞定啦
 *   POST   /api/family-things/:id/cancel          取消
 *   POST   /api/family-things/:id/reopen          重新打开
 *
 * 两种「家庭上下文」的取法，按接口形态分：
 *   - **familyId 能从请求里读到**（创建/列表/今日）→ 挂 `FamilyMemberGuard`，
 *     由它解析并校验成员身份，再通过 `@FamilyMemberCtx()` 取上下文。
 *   - **只有小事 ID**（详情/编辑/完成/取消/重开）→ familyId 得**从小事反查**。
 *     这时用 `ThingService.contextForThing()`：先拿小事的 familyId，
 *     再确认当前用户是那家的成员。多一步查询，换「前端不用传 familyId」。
 *
 * ⚠️ `@Get('today')` 必须写在 `@Get(':id')` **前面**：Nest 按声明顺序匹配路由，
 *    否则 `/today` 会被 `:id` 吃掉，然后 `parseBigInt` 报「这件小事不对」。
 */
@Controller('family-things')
export class ThingController {
  constructor(private readonly things: ThingService) {}

  /** 创建小事（M2-B10） */
  @Post()
  @UseGuards(FamilyMemberGuard)
  async create(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: CreateThingDto,
  ): Promise<ThingDetail> {
    return this.things.create(ctx, dto);
  }

  /** 小事列表（M2-B11） */
  @Get()
  @UseGuards(FamilyMemberGuard)
  async list(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query() query: ListThingsQueryDto,
  ): Promise<ListThingsResponse> {
    return this.things.list(ctx, query);
  }

  /** 首页今日汇总（M2-B12）—— 必须排在 `:id` 之前 */
  @Get('today')
  @UseGuards(FamilyMemberGuard)
  async today(@FamilyMemberCtx() ctx: FamilyMemberContext): Promise<TodaySummary> {
    return this.things.today(ctx);
  }

  /** 小事详情（M2-B13） */
  @Get(':id')
  async detail(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这件小事')) id: bigint,
  ): Promise<ThingDetail> {
    const ctx = await this.things.contextForThing(userId, id);
    return this.things.detail(ctx, id);
  }

  /** 编辑小事（M2-B14） */
  @Patch(':id')
  async update(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这件小事')) id: bigint,
    @Body() dto: UpdateThingDto,
  ): Promise<ThingDetail> {
    const ctx = await this.things.contextForThing(userId, id);
    return this.things.update(ctx, id, dto);
  }

  /** 完成小事（M2-B15） */
  @Post(':id/complete')
  async complete(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这件小事')) id: bigint,
  ): Promise<CompleteThingResponse> {
    const ctx = await this.things.contextForThing(userId, id);
    return this.things.complete(ctx, id);
  }

  /** 取消小事（M2-B16） */
  @Post(':id/cancel')
  async cancel(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这件小事')) id: bigint,
  ): Promise<{ ok: true }> {
    const ctx = await this.things.contextForThing(userId, id);
    await this.things.cancel(ctx, id);
    return { ok: true };
  }

  /** 重新打开（M2-B16） */
  @Post(':id/reopen')
  async reopen(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这件小事')) id: bigint,
  ): Promise<{ ok: true }> {
    const ctx = await this.things.contextForThing(userId, id);
    await this.things.reopen(ctx, id);
    return { ok: true };
  }
}
