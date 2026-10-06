import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FamilyMemberCtx } from '../families/decorators/family-member.decorator';
import { FamilyMemberGuard } from '../families/guards/family-member.guard';
import type { FamilyMemberContext } from '../families/family-context';
import { parseBigInt } from '../../common/pipes/parse-bigint.pipe';
import type {
  DecideAndAssignResponse,
  DecideMenuResponse,
  ListMenuItemsResponse,
  MenuItemRow,
  RandomMenuResponse,
  RecentMealGroup,
} from '@shared/dto/menu';
import { MenuService } from './menu.service';
import {
  CreateMenuItemDto,
  DecideAndAssignDto,
  DecideMenuDto,
  ListMenuItemsQueryDto,
  RandomMenuQueryDto,
  RecentMealsQueryDto,
  SetMenuItemEnabledDto,
  UpdateMenuItemDto,
} from './dto/menu.dto';

/**
 * 吃啥呢模块（docs/02 §六）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   GET    /api/menu/random             随机推荐（P02 的「换一个」）
 *   GET    /api/menu/items              菜谱列表（P17）
 *   POST   /api/menu/decide             确认吃什么（只记录）
 *   GET    /api/menu/recent             最近吃过
 *   POST   /api/menu/decide-and-assign  决定 + 一键派活（M3-7）
 *   POST   /api/menu/items              新增家庭菜谱（M3-5）
 *   PATCH  /api/menu/items/:id          改家庭菜谱（M3-5）
 *   PATCH  /api/menu/items/:id/enabled  启停家庭菜谱（M3-5）
 *
 * **除两个 `PATCH /items/:id` 之外，全部挂 `FamilyMemberGuard`**：
 * 吃啥呢的每个接口都以家庭为边界（池子 = 系统菜谱 + **本家庭**菜谱），
 * 所以家庭上下文必须有，而 `familyId` 都能从 query / body 直接读到，不需要反查。
 *
 * ⚠️ **两个 `PATCH /items/:id` 是例外**：它们的 URL 与 body 里都没有 `familyId`
 * （body 只有 `name` / `category` / `imageUrl`），守卫无从下手。
 * 改由 `MenuService.contextForItem(userId, id)` 从**菜谱本身**反查家庭 ——
 * 与小事模块的 `PATCH /family-things/:id` 同一个模式。
 *
 * ⚠️ **数据权限过滤必须在服务端做**（AGENTS.md 铁律）：
 * 「这个菜谱是不是我家的」由 `MenuService` 在写库前校验，
 * 前端传什么 `familyId` 都不改变这个判断。
 */
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** 随机推荐（M3-3） */
  @Get('random')
  @UseGuards(FamilyMemberGuard)
  async random(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query() query: RandomMenuQueryDto,
  ): Promise<RandomMenuResponse> {
    return this.menu.random(ctx, query);
  }

  /** 菜谱列表（M3-4） */
  @Get('items')
  @UseGuards(FamilyMemberGuard)
  async items(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query() query: ListMenuItemsQueryDto,
  ): Promise<ListMenuItemsResponse> {
    return this.menu.list(ctx, query);
  }

  /** 最近吃过（M3-8）—— 必须排在 `items/:id` 之前（若有） */
  @Get('recent')
  @UseGuards(FamilyMemberGuard)
  async recent(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query() query: RecentMealsQueryDto,
  ): Promise<RecentMealGroup[]> {
    return this.menu.recent(ctx, query);
  }

  /** 确认吃什么（M3-6）—— 只记录，不派活 */
  @Post('decide')
  @UseGuards(FamilyMemberGuard)
  async decide(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: DecideMenuDto,
  ): Promise<DecideMenuResponse> {
    return this.menu.decide(ctx, dto);
  }

  /** 一键派活（M3-7）—— 记录 + 派活 + 提醒，一个事务 */
  @Post('decide-and-assign')
  @UseGuards(FamilyMemberGuard)
  async decideAndAssign(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: DecideAndAssignDto,
  ): Promise<DecideAndAssignResponse> {
    return this.menu.decideAndAssign(ctx, dto);
  }

  /** 新增家庭菜谱（M3-5） */
  @Post('items')
  @UseGuards(FamilyMemberGuard)
  async createItem(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: CreateMenuItemDto,
  ): Promise<MenuItemRow> {
    return this.menu.createItem(ctx, dto);
  }

  /**
   * 改家庭菜谱（M3-5）。
   *
   * ⚠️ **刻意不挂 `FamilyMemberGuard`**：URL 与 body 里都没有 `familyId`
   * （body 只有 `name` / `category` / `imageUrl`），守卫拿不到家庭上下文。
   * 改由 `contextForItem` 从**菜谱本身**反查 —— 菜谱自己就知道属于哪个家。
   * 这与小事模块的 `PATCH /family-things/:id` 是同一个模式。
   */
  @Patch('items/:id')
  async updateItem(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这道菜谱')) id: bigint,
    @Body() dto: UpdateMenuItemDto,
  ): Promise<MenuItemRow> {
    const ctx = await this.menu.contextForItem(userId, id);
    return this.menu.updateItem(ctx, id, dto);
  }

  /** 停用 / 启用家庭菜谱（M3-5）—— 同上，靠 `contextForItem` 反查 */
  @Patch('items/:id/enabled')
  async setItemEnabled(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这道菜谱')) id: bigint,
    @Body() dto: SetMenuItemEnabledDto,
  ): Promise<MenuItemRow> {
    const ctx = await this.menu.contextForItem(userId, id);
    return this.menu.setItemEnabled(ctx, id, dto.enabled);
  }
}
