import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { InviteStatus, MemberStatus, EnabledStatus } from '@shared/enums';
import type {
  AcceptInviteResponse,
  CreateFamilyRequest,
  CreateFamilyResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  FamilyDetail,
  FamilyMember,
  InvitePreview,
  MyFamily,
  MyMembership,
  UpdateMyRoleRequest,
} from '@shared/dto/family';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/errors/business.exception';
import { formatDateTimeRequired, toNumberRequired } from '../../common/serialize/beijing-time';

/** 邀请码默认有效期（小时） */
const INVITE_DEFAULT_HOURS = 72;
/** 邀请码有效期上限（小时）—— 防止生成「永久有效」的码 */
const INVITE_MAX_HOURS = 24 * 30;

/** 邀请码字符集：去掉 0/O/1/I/L 这些容易看错的字符（用户要手抄/口述） */
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const INVITE_CODE_LENGTH = 6;

/**
 * 家庭与成员的业务逻辑。
 *
 * 三条贯穿全文件的纪律：
 *   ① **权限过滤在服务端做**。任何查询都带上 `familyId`，绝不信任前端传的归属。
 *   ② **不做物理删除**。退出/移除/解散全部是状态位（status=0）。
 *   ③ **文案有人情味**。异常消息是给家人看的，不是给开发者看的。
 */
@Injectable()
export class FamiliesService {
  private readonly logger = new Logger(FamiliesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =============================================================
  // 家庭
  // =============================================================

  /**
   * 创建家庭（M1-B7）。
   *
   * 三步必须在同一个事务里：建 family → 建 member → 回写 owner_member_id。
   * 任何一步失败都整体回滚，避免留下「没有成员的空家庭」这种脏数据。
   */
  async create(userId: bigint, dto: CreateFamilyRequest): Promise<CreateFamilyResponse> {
    const familyName = dto.familyName.trim();
    const roleName = dto.roleName.trim();
    if (!familyName || !roleName) {
      throw BusinessException.invalidParam('家庭名称和称谓都要填哦');
    }

    return this.prisma.$transaction(async (tx) => {
      const family = await tx.family.create({
        data: { name: familyName, status: EnabledStatus.ENABLED },
      });

      const member = await tx.familyMember.create({
        data: {
          familyId: family.id,
          userId,
          roleName,
          status: MemberStatus.ACTIVE,
        },
      });

      await tx.family.update({
        where: { id: family.id },
        data: { ownerMemberId: member.id },
      });

      this.logger.log(`用户 ${userId} 创建家庭 ${family.id}「${familyName}」`);

      return {
        familyId: toNumberRequired(family.id),
        familyName: family.name,
        memberId: toNumberRequired(member.id),
        roleName: member.roleName,
        ownerMemberId: toNumberRequired(member.id),
      };
    });
  }

  /** 我的家庭列表（M1-B8）。只返回**正常状态**的家庭。 */
  async listMine(userId: bigint): Promise<MyFamily[]> {
    const memberships = await this.prisma.familyMember.findMany({
      where: { userId, status: MemberStatus.ACTIVE },
      orderBy: { joinedAt: 'asc' },
    });
    if (memberships.length === 0) return [];

    const families = await this.prisma.family.findMany({
      where: {
        id: { in: memberships.map((m) => m.familyId) },
        status: EnabledStatus.ENABLED,
      },
    });
    const familyById = new Map(families.map((f) => [f.id, f]));

    const counts = await this.countMembers(families.map((f) => f.id));

    return memberships.flatMap((m) => {
      const family = familyById.get(m.familyId);
      if (!family) return []; // 家庭已解散，跳过
      return [
        {
          familyId: toNumberRequired(family.id),
          familyName: family.name,
          memberId: toNumberRequired(m.id),
          roleName: m.roleName,
          isOwner: family.ownerMemberId === m.id,
          memberCount: counts.get(m.familyId) ?? 0,
        },
      ];
    });
  }

  /** 家庭详情（docs/02 §3.3） */
  async getDetail(familyId: bigint, currentMemberId: bigint): Promise<FamilyDetail> {
    const family = await this.prisma.family.findFirst({
      where: { id: familyId, status: EnabledStatus.ENABLED },
    });
    if (!family) throw BusinessException.notFound('家庭');

    const counts = await this.countMembers([familyId]);

    return {
      familyId: toNumberRequired(family.id),
      familyName: family.name,
      ownerMemberId: family.ownerMemberId != null ? Number(family.ownerMemberId) : null,
      isOwner: family.ownerMemberId === currentMemberId,
      memberCount: counts.get(familyId) ?? 0,
      createdAt: formatDateTimeRequired(family.createdAt),
    };
  }

  /** 修改家庭名称（docs/02 §3.4）。仅创建者。 */
  async updateName(familyId: bigint, familyName: string): Promise<void> {
    const name = familyName.trim();
    if (!name) throw BusinessException.invalidParam('家庭名称不能为空');

    await this.prisma.family.update({
      where: { id: familyId },
      data: { name },
    });
  }

  /**
   * 解散家庭（docs/02 §3.9）。仅创建者。
   *
   * 只置 `status=0`，**不删任何数据** —— 历史的小事与留念要留着。
   */
  async dissolve(familyId: bigint): Promise<void> {
    await this.prisma.family.update({
      where: { id: familyId },
      data: { status: EnabledStatus.DISABLED },
    });
    this.logger.log(`家庭 ${familyId} 已解散（数据保留）`);
  }

  // =============================================================
  // 成员
  // =============================================================

  /** 家庭成员列表（M1-B9）。已退出的默认不返回。 */
  async listMembers(
    familyId: bigint,
    currentMemberId: bigint,
    includeLeft = false,
  ): Promise<FamilyMember[]> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { ownerMemberId: true },
    });

    const members = await this.prisma.familyMember.findMany({
      where: {
        familyId,
        ...(includeLeft ? {} : { status: MemberStatus.ACTIVE }),
      },
      orderBy: [{ status: 'desc' }, { joinedAt: 'asc' }],
    });
    if (members.length === 0) return [];

    // 两次查询代替 relation include（见 prisma/schema.prisma 头部说明）
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, nickname: true, avatarUrl: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return members.map((m) => {
      const user = userById.get(m.userId);
      return {
        memberId: toNumberRequired(m.id),
        userId: toNumberRequired(m.userId),
        roleName: m.roleName,
        nickname: user?.nickname ?? null,
        avatarUrl: user?.avatarUrl ?? null,
        isOwner: family?.ownerMemberId === m.id,
        isMe: m.id === currentMemberId,
        status: m.status === MemberStatus.ACTIVE ? 'ACTIVE' : 'LEFT',
        joinedAt: formatDateTimeRequired(m.joinedAt),
      };
    });
  }

  /**
   * 我的身份（M2-B26）。
   *
   * 消息文案要用**家庭称谓**而不是微信昵称，前端也需要在「我的」页面
   * 与首页抬头显示「阿妈」这样的称谓 —— 这个接口就是那个直读入口。
   */
  async myMembership(familyId: bigint, memberId: bigint): Promise<MyMembership> {
    const member = await this.prisma.familyMember.findFirst({
      where: { id: memberId, familyId, status: MemberStatus.ACTIVE },
    });
    if (!member) throw BusinessException.notMember();

    const ownerMemberId = await this.ownerMemberIdOf(familyId);

    return {
      familyId: toNumberRequired(familyId),
      memberId: toNumberRequired(member.id),
      roleName: member.roleName,
      isOwner: ownerMemberId != null && ownerMemberId === member.id,
      joinedAt: formatDateTimeRequired(member.joinedAt),
    };
  }

  /**
   * 修改我的家庭称谓（M1-B14）。
   *
   * 称谓在家庭内必须唯一 —— 否则「阿妈，有个活儿到你啦」就指不清是谁了。
   * 数据库没建 `uk_family_role` 唯一索引（历史数据可能重复），
   * 因此在服务端查重；并发下极小概率漏过，但家庭场景不值得为此加锁。
   */
  async updateMyRole(familyId: bigint, memberId: bigint, dto: UpdateMyRoleRequest): Promise<void> {
    const roleName = dto.roleName.trim();
    if (!roleName) throw BusinessException.invalidParam('称谓不能为空');

    const duplicated = await this.prisma.familyMember.findFirst({
      where: {
        familyId,
        roleName,
        status: MemberStatus.ACTIVE,
        NOT: { id: memberId },
      },
      select: { id: true },
    });
    if (duplicated) {
      throw BusinessException.conflict('这个称谓家里已经有人用啦，换一个吧');
    }

    await this.prisma.familyMember.update({
      where: { id: memberId },
      data: { roleName },
    });
  }

  /**
   * 移除成员（docs/02 §3.7）。仅创建者，且不能移除自己。
   * **不物理删除**：置 `status=0` + `left_at`，历史数据保留。
   */
  async removeMember(familyId: bigint, targetMemberId: bigint): Promise<void> {
    if (targetMemberId === (await this.ownerMemberIdOf(familyId))) {
      throw BusinessException.invalidParam('不能移除自己，想解散的话去家庭设置');
    }

    await this.prisma.familyMember.updateMany({
      where: { id: targetMemberId, familyId, status: MemberStatus.ACTIVE },
      data: { status: MemberStatus.LEFT, leftAt: new Date() },
    });
  }

  /** 退出家庭（docs/02 §3.8）。创建者不能直接退，需先转让或解散。 */
  async leave(familyId: bigint, memberId: bigint): Promise<void> {
    const ownerId = await this.ownerMemberIdOf(familyId);
    if (ownerId === memberId) {
      throw BusinessException.invalidParam('你是这个家的创建者，得先解散或者转给别人');
    }

    await this.prisma.familyMember.update({
      where: { id: memberId },
      data: { status: MemberStatus.LEFT, leftAt: new Date() },
    });
  }

  // =============================================================
  // 邀请
  // =============================================================

  /** 生成邀请码（M1-B11）。 */
  async createInvite(
    familyId: bigint,
    inviterMemberId: bigint,
    dto: CreateInviteRequest,
  ): Promise<CreateInviteResponse> {
    const hours = clamp(dto.expireInHours ?? INVITE_DEFAULT_HOURS, 1, INVITE_MAX_HOURS);
    const expireAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    // invite_code 有唯一索引，撞码时重试（36^6 ≈ 21 亿，实际几乎不会撞）
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = randomCode();
      try {
        const invite = await this.prisma.familyInvite.create({
          data: {
            familyId,
            inviterMemberId,
            inviteCode,
            expireAt,
            status: InviteStatus.VALID,
          },
        });

        return {
          inviteId: toNumberRequired(invite.id),
          inviteCode: invite.inviteCode,
          expireAt: formatDateTimeRequired(expireAt),
          // 路径与 docs/03 的页面清单一致（P06）
          sharePath: `pages/family/join?code=${invite.inviteCode}`,
        };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        this.logger.warn(`邀请码撞码，重试第 ${attempt + 1} 次`);
      }
    }

    throw BusinessException.conflict('邀请码没生成出来，稍后再试一次～');
  }

  /**
   * 邀请码预览（M1-B12）。**加入前**看家庭信息用。
   *
   * ⚠️ 这个接口不要求「已是成员」，否则就没法加入了。
   *    但它必须登录 —— 不然任何人拿到码就能查家庭名。
   */
  async previewInvite(inviteCode: string, userId: bigint): Promise<InvitePreview> {
    const invite = await this.prisma.familyInvite.findUnique({
      where: { inviteCode },
    });
    if (!invite) throw BusinessException.notFound('邀请码');

    const family = await this.prisma.family.findUnique({
      where: { id: invite.familyId },
      select: { id: true, name: true, status: true },
    });
    if (!family || family.status !== EnabledStatus.ENABLED) {
      throw BusinessException.notFound('家庭');
    }

    const inviter = await this.prisma.familyMember.findUnique({
      where: { id: invite.inviterMemberId },
      select: { roleName: true },
    });

    const alreadyMember = await this.isMember(invite.familyId, userId);
    const counts = await this.countMembers([invite.familyId]);

    return {
      inviteCode: invite.inviteCode,
      familyName: family.name,
      inviterRoleName: inviter?.roleName ?? '家人',
      memberCount: counts.get(invite.familyId) ?? 0,
      expireAt: invite.expireAt ? formatDateTimeRequired(invite.expireAt) : null,
      status: this.inviteStatusOf(invite.status, invite.expireAt),
      alreadyMember,
    };
  }

  /**
   * 接受邀请加入家庭（M1-B13）。
   *
   * 事务：建 member → 标记 invite 已用。失败整体回滚，
   * 否则会出现「码被烧了但人没进家」的情况 —— 用户只能重新要一个码。
   */
  async acceptInvite(
    inviteCode: string,
    userId: bigint,
    roleName: string,
  ): Promise<AcceptInviteResponse> {
    const name = roleName.trim();
    if (!name) throw BusinessException.invalidParam('称谓不能为空');

    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.familyInvite.findUnique({ where: { inviteCode } });
      if (!invite) throw BusinessException.notFound('邀请码');

      const status = this.inviteStatusOf(invite.status, invite.expireAt);
      if (status !== 'VALID') {
        throw BusinessException.conflict(
          status === 'USED' ? '这个邀请码已经用过了' : '这个邀请码过期啦，让家人重新发一个',
        );
      }

      const family = await tx.family.findFirst({
        where: { id: invite.familyId, status: EnabledStatus.ENABLED },
      });
      if (!family) throw BusinessException.notFound('家庭');

      const existing = await tx.familyMember.findUnique({
        where: { familyId_userId: { familyId: invite.familyId, userId } },
      });

      // 已经在这个家里（含之前退出过又回来的）
      if (existing && existing.status === MemberStatus.ACTIVE) {
        throw BusinessException.conflict('你已经在这个家里啦');
      }

      const duplicated = await tx.familyMember.findFirst({
        where: {
          familyId: invite.familyId,
          roleName: name,
          status: MemberStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (duplicated) {
        throw BusinessException.conflict('这个称谓家里已经有人用啦，换一个吧');
      }

      const member = existing
        ? // 退出过的成员重新加入：复用原记录，保留历史
          await tx.familyMember.update({
            where: { id: existing.id },
            data: {
              roleName: name,
              status: MemberStatus.ACTIVE,
              joinedAt: new Date(),
              leftAt: null,
            },
          })
        : await tx.familyMember.create({
            data: {
              familyId: invite.familyId,
              userId,
              roleName: name,
              status: MemberStatus.ACTIVE,
            },
          });

      await tx.familyInvite.update({
        where: { id: invite.id },
        data: {
          status: InviteStatus.USED,
          usedAt: new Date(),
          usedByUserId: userId,
          usedByMemberId: member.id,
        },
      });

      this.logger.log(`用户 ${userId} 加入家庭 ${family.id}，称谓「${name}」`);

      return {
        familyId: toNumberRequired(family.id),
        familyName: family.name,
        memberId: toNumberRequired(member.id),
        roleName: member.roleName,
      };
    });
  }

  // =============================================================
  // 供 FamilyMemberGuard 使用
  // =============================================================

  /** 查当前用户在某家庭里的成员记录（仅 ACTIVE） */
  async findActiveMember(familyId: bigint, userId: bigint) {
    return this.prisma.familyMember.findFirst({
      where: { familyId, userId, status: MemberStatus.ACTIVE },
    });
  }

  async ownerMemberIdOf(familyId: bigint): Promise<bigint | null> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { ownerMemberId: true },
    });
    return family?.ownerMemberId ?? null;
  }

  // =============================================================
  // 内部工具
  // =============================================================

  private async isMember(familyId: bigint, userId: bigint): Promise<boolean> {
    const hit = await this.prisma.familyMember.findFirst({
      where: { familyId, userId, status: MemberStatus.ACTIVE },
      select: { id: true },
    });
    return hit != null;
  }

  /** 一次查询统计多个家庭的成员数（避免 N+1） */
  private async countMembers(familyIds: bigint[]): Promise<Map<bigint, number>> {
    if (familyIds.length === 0) return new Map();

    const grouped = await this.prisma.familyMember.groupBy({
      by: ['familyId'],
      where: { familyId: { in: familyIds }, status: MemberStatus.ACTIVE },
      _count: { _all: true },
    });

    return new Map(grouped.map((g) => [g.familyId, g._count._all]));
  }

  /**
   * 邀请码的**实际**状态。
   *
   * 数据库里的 status 可能还是 VALID，但时间已经过了 ——
   * 我们不做定时任务去刷状态（那是过度设计），读的时候顺手判断即可。
   */
  private inviteStatusOf(dbStatus: number, expireAt: Date | null): 'VALID' | 'USED' | 'EXPIRED' | 'CANCELLED' {
    if (dbStatus === InviteStatus.USED) return 'USED';
    if (dbStatus === InviteStatus.CANCELLED) return 'CANCELLED';
    if (expireAt && expireAt.getTime() < Date.now()) return 'EXPIRED';
    if (dbStatus === InviteStatus.EXPIRED) return 'EXPIRED';
    return 'VALID';
  }
}

// ---------------------------------------------------------------
// 模块级工具
// ---------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** 生成不易混淆的邀请码 */
function randomCode(): string {
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
  }
  return out;
}

/** Prisma 的唯一约束冲突（P2002） */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  );
}
