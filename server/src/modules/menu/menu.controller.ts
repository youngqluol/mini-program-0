import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { FamilyMemberCtx } from '../families/decorators/family-member.decorator';
import { FamilyMemberGuard } from '../families/guards/family-member.guard';
import type { FamilyMemberContext } from '../families/family-context';
import type {
  DecideMenuResponse,
  ListMenuItemsResponse,
  RandomMenuResponse,
  RecentMealGroup,
} from '@shared/dto/menu';
import { MenuService } from './menu.service';
import {
  DecideMenuDto,
  ListMenuItemsQueryDto,
  RandomMenuQueryDto,
  RecentMealsQueryDto,
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
 * **全部挂 `FamilyMemberGuard`**：吃啥呢的每个接口都以家庭为边界
 * （池子 = 系统菜谱 + **本家庭**菜谱），所以家庭上下文必须有，
 * 而且 `familyId` 都能从 query / body 直接读到，不需要反查。
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
}
