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
import { parseBigInt } from '../../common/pipes/parse-bigint.pipe';
import { FamiliesService } from './families.service';
import { FamilyMemberGuard } from './guards/family-member.guard';
import { OwnerOnlyGuard } from './guards/owner-only.guard';
import { FamilyMemberCtx } from './decorators/family-member.decorator';
import type { FamilyMemberContext } from './family-context';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { UpdateMyRoleDto } from './dto/update-my-role.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import type {
  AcceptInviteResponse,
  CreateFamilyResponse,
  CreateInviteResponse,
  FamilyDetail,
  FamilyMember,
  InvitePreview,
  MyFamily,
} from '@shared/dto/family';

/**
 * 家庭模块（docs/02 §三）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST   /api/families                              创建家庭
 *   GET    /api/families                              我的家庭列表
 *   GET    /api/families/:familyId                    家庭详情
 *   PATCH  /api/families/:familyId                    改家庭名（仅创建者）
 *   DELETE /api/families/:familyId                    解散家庭（仅创建者）
 *   GET    /api/families/:familyId/members            成员列表
 *   PATCH  /api/families/:familyId/members/me         改我的称谓
 *   DELETE /api/families/:familyId/members/:memberId  移除成员（仅创建者）
 *   POST   /api/families/:familyId/leave              退出家庭
 *   POST   /api/families/:familyId/invites            生成邀请码
 *   GET    /api/families/invites/:inviteCode          邀请码预览（加入前）
 *   POST   /api/families/invites/:inviteCode/accept   接受邀请
 *
 * 全部需要登录（全局 JwtGuard）；带 `:familyId` 的额外要求是家庭成员。
 */
@Controller('families')
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  // -------------------------------------------------------------
  // 邀请码 —— 刻意放在最前面：这两条**不要求**已是成员
  // -------------------------------------------------------------

  /** 邀请码预览（M1-B12） */
  @Get('invites/:inviteCode')
  async previewInvite(
    @Param('inviteCode') inviteCode: string,
    @CurrentUser('userId') userId: bigint,
  ): Promise<InvitePreview> {
    return this.families.previewInvite(inviteCode, userId);
  }

  /** 接受邀请加入家庭（M1-B13） */
  @Post('invites/:inviteCode/accept')
  async acceptInvite(
    @Param('inviteCode') inviteCode: string,
    @CurrentUser('userId') userId: bigint,
    @Body() dto: AcceptInviteDto,
  ): Promise<AcceptInviteResponse> {
    return this.families.acceptInvite(inviteCode, userId, dto.roleName);
  }

  // -------------------------------------------------------------
  // 家庭
  // -------------------------------------------------------------

  /** 创建家庭（M1-B7） */
  @Post()
  async create(
    @CurrentUser('userId') userId: bigint,
    @Body() dto: CreateFamilyDto,
  ): Promise<CreateFamilyResponse> {
    return this.families.create(userId, dto);
  }

  /** 我的家庭列表（M1-B8） */
  @Get()
  async listMine(@CurrentUser('userId') userId: bigint): Promise<MyFamily[]> {
    return this.families.listMine(userId);
  }

  /** 家庭详情（docs/02 §3.3） */
  @Get(':familyId')
  @UseGuards(FamilyMemberGuard)
  async detail(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
  ): Promise<FamilyDetail> {
    return this.families.getDetail(ctx.familyId, ctx.memberId);
  }

  /** 改家庭名（仅创建者） */
  @Patch(':familyId')
  @UseGuards(FamilyMemberGuard, OwnerOnlyGuard)
  async updateName(
    @FamilyMemberCtx('familyId') familyId: bigint,
    @Body() dto: UpdateFamilyDto,
  ): Promise<{ ok: true }> {
    await this.families.updateName(familyId, dto.familyName);
    return { ok: true };
  }

  /** 解散家庭（仅创建者，逻辑删除） */
  @Delete(':familyId')
  @UseGuards(FamilyMemberGuard, OwnerOnlyGuard)
  async dissolve(
    @FamilyMemberCtx('familyId') familyId: bigint,
  ): Promise<{ ok: true }> {
    await this.families.dissolve(familyId);
    return { ok: true };
  }

  // -------------------------------------------------------------
  // 成员
  // -------------------------------------------------------------

  /** 成员列表（M1-B9） */
  @Get(':familyId/members')
  @UseGuards(FamilyMemberGuard)
  async listMembers(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Query('includeLeft') includeLeft?: string,
  ): Promise<FamilyMember[]> {
    return this.families.listMembers(
      ctx.familyId,
      ctx.memberId,
      includeLeft === 'true',
    );
  }

  /** 改我的称谓（M1-B14） */
  @Patch(':familyId/members/me')
  @UseGuards(FamilyMemberGuard)
  async updateMyRole(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: UpdateMyRoleDto,
  ): Promise<{ ok: true }> {
    await this.families.updateMyRole(ctx.familyId, ctx.memberId, dto);
    return { ok: true };
  }

  /** 移除成员（仅创建者，逻辑删除） */
  @Delete(':familyId/members/:memberId')
  @UseGuards(FamilyMemberGuard, OwnerOnlyGuard)
  async removeMember(
    @FamilyMemberCtx('familyId') familyId: bigint,
    @Param('memberId', parseBigInt('成员')) memberId: bigint,
  ): Promise<{ ok: true }> {
    await this.families.removeMember(familyId, memberId);
    return { ok: true };
  }

  /** 退出家庭（创建者不可直接退） */
  @Post(':familyId/leave')
  @UseGuards(FamilyMemberGuard)
  async leave(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
  ): Promise<{ ok: true }> {
    await this.families.leave(ctx.familyId, ctx.memberId);
    return { ok: true };
  }

  // -------------------------------------------------------------
  // 邀请
  // -------------------------------------------------------------

  /** 生成邀请码（M1-B11） */
  @Post(':familyId/invites')
  @UseGuards(FamilyMemberGuard)
  async createInvite(
    @FamilyMemberCtx() ctx: FamilyMemberContext,
    @Body() dto: CreateInviteDto,
  ): Promise<CreateInviteResponse> {
    return this.families.createInvite(ctx.familyId, ctx.memberId, dto);
  }
}
