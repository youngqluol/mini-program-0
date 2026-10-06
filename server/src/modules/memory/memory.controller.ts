import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FamilyMemberCtx } from '../families/decorators/family-member.decorator';
import { FamilyMemberGuard } from '../families/guards/family-member.guard';
import type { FamilyMemberContext } from '../families/family-context';
import { parseBigInt } from '../../common/pipes/parse-bigint.pipe';
import type { ListMemoriesResponse, MemoryItem } from '@shared/dto/memory';
import { MemoryService } from './memory.service';
import { CreateMemoryDto, ListMemoriesQueryDto, UpdateMemoryDto } from './dto/memory.dto';

/**
 * 留个念模块（docs/02 §七）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST   /api/memories        发布记录（M4-5）
 *   GET    /api/memories        家庭时间线，游标分页 + 隐私过滤（M4-6）
 *   GET    /api/memories/:id    记录详情（M4-7）
 *   PATCH  /api/memories/:id    编辑记录，仅发布者（M4-7）
 *   DELETE /api/memories/:id    删除记录，仅发布者，逻辑删除（M4-7）
 *
 * **`POST` / `GET /memories` 挂 `FamilyMemberGuard`**（`familyId` 在 body / query 里），
 * **三个 `:id` 路由不挂** —— 它们的 URL 与 body 里都没有 `familyId`，
 * 守卫无从下手。改由 `MemoryService.contextForMemory` 从**记录本身**反查家庭，
 * 与小事模块的 `PATCH /family-things/:id`、吃啥呢的 `PATCH /menu/items/:id`
 * 是同一个模式。
 *
 * ⚠️ **`GET /memories/:id` 也走反查**（而不是挂守卫 + 传 familyId）：
 *    时间线点进详情时，前端手里只有记录 ID。要求它同时带上 familyId，
 *    就多了一个「必须与记录一致」的参数 —— 不一致时该信谁？
 *    让服务端从记录反查，这个问题不存在。
 *
 * ⚠️ **数据权限过滤必须在服务端做**（AGENTS.md 铁律）：
 *    「这条记录能不能给我看」「我能不能改它」全部由 `MemoryService` 判，
 *    前端传什么都不改变结论。
 */
@Controller('memories')
export class MemoryController {
  constructor(private readonly memories: MemoryService) {}

  /** 发布记录（M4-5） */
  @Post()
  @UseGuards(FamilyMemberGuard)
  async create(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: CreateMemoryDto,
  ): Promise<MemoryItem> {
    return this.memories.create(ctx, dto);
  }

  /** 家庭时间线（M4-6） */
  @Get()
  @UseGuards(FamilyMemberGuard)
  async list(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query() query: ListMemoriesQueryDto,
  ): Promise<ListMemoriesResponse> {
    return this.memories.list(ctx, query);
  }

  /** 记录详情（M4-7） */
  @Get(':id')
  async detail(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这条记录')) id: bigint,
  ): Promise<MemoryItem> {
    const ctx = await this.memories.contextForMemory(userId, id);
    return this.memories.detail(ctx, id);
  }

  /** 编辑记录（M4-7）—— 仅发布者，只改正文与可见范围 */
  @Patch(':id')
  async update(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这条记录')) id: bigint,
    @Body() dto: UpdateMemoryDto,
  ): Promise<MemoryItem> {
    const ctx = await this.memories.contextForMemory(userId, id);
    return this.memories.update(ctx, id, dto);
  }

  /** 删除记录（M4-7）—— 仅发布者，逻辑删除（`status=0`） */
  @Delete(':id')
  async remove(
    @CurrentUser('userId') userId: bigint,
    @Param('id', parseBigInt('这条记录')) id: bigint,
  ): Promise<{ id: number }> {
    const ctx = await this.memories.contextForMemory(userId, id);
    return this.memories.remove(ctx, id);
  }
}
