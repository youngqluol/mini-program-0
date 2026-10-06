import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EnabledStatus } from '@shared/enums';
import type {
  AuthUser,
  LoginResponse,
  RefreshTokenResponse,
  SubscribeQuotaResponse,
} from '@shared/dto/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatService } from '../wechat/wechat.service';
import { FamiliesService } from '../families/families.service';
import { SubscribeQuotaService } from '../notify/subscribe-quota.service';
import { BusinessException } from '../../common/errors/business.exception';
import { parseDurationSeconds } from '../../common/utils/duration';
import { toNumberRequired } from '../../common/serialize/beijing-time';
import type { LoginDto } from './dto/login.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ReportSubscribeQuotaDto } from './dto/report-subscribe-quota.dto';

/** JWT 默认有效期 7 天（与 .env.example 的 JWT_EXPIRES_IN 一致） */
const DEFAULT_JWT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * 认证服务（docs/02 §二）。
 *
 * 登录流程：`wx.login` 的 code → code2Session 换 openid → upsert 用户
 *          → 签发 JWT → 顺带返回「我的家庭列表」。
 *
 * 为什么登录要顺带返回家庭列表：小程序冷启动时只发**一个**请求就能决定
 * 跳哪个页面（登录页 / 引导页 / 首页），省掉一次串行等待。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly wechat: WechatService,
    private readonly families: FamiliesService,
    private readonly quota: SubscribeQuotaService,
  ) {}

  /** 微信登录（M1-B5） */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const { openid } = await this.wechat.code2Session(dto.code);
    const user = await this.upsertUser(openid, dto);

    const mine = await this.families.listMine(user.id);

    return {
      token: await this.signToken(user.id, openid),
      expiresIn: this.expiresInSeconds,
      user: toAuthUser(user),
      // 只返回登录场景需要的字段（docs/02 §2.1），别把列表接口的形状搬过来
      families: mine.map((f) => ({
        familyId: f.familyId,
        familyName: f.familyName,
        memberId: f.memberId,
        roleName: f.roleName,
      })),
      currentFamilyId: mine[0]?.familyId ?? null,
    };
  }

  /** 续期 token（M1-B15）。守卫已经验过旧 token，这里只负责重新签发。 */
  async refresh(userId: bigint, openid: string): Promise<RefreshTokenResponse> {
    return {
      token: await this.signToken(userId, openid),
      expiresIn: this.expiresInSeconds,
    };
  }

  /** 更新个人资料（docs/02 §2.3） */
  async updateProfile(userId: bigint, dto: UpdateProfileDto): Promise<AuthUser> {
    const data: { nickname?: string; avatarUrl?: string } = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;

    if (Object.keys(data).length === 0) {
      const current = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!current) throw BusinessException.notFound('用户');
      return toAuthUser(current);
    }

    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return toAuthUser(user);
  }

  // -------------------------------------------------------------
  // 订阅消息额度（docs/02 §2.4 / §2.5）
  // -------------------------------------------------------------

  /**
   * 上报订阅授权结果。
   *
   * ⚠️ 只接受**我们自己的**模板 ID。否则任何人都能拿任意字符串
   *    往 Redis 里灌 key，额度池就变成了一个无上限的键值垃圾场。
   */
  async reportSubscribeQuota(
    userId: bigint,
    dto: ReportSubscribeQuotaDto,
  ): Promise<SubscribeQuotaResponse> {
    if (!this.quota.kindOfTemplateId(dto.templateId)) {
      throw BusinessException.invalidParam('模板 ID 不认识，可能是小程序版本太旧了');
    }

    await this.quota.grant(userId, dto.templateId, dto.count);
    return this.quota.snapshot(userId);
  }

  /** 查询订阅额度（docs/02 §2.5）—— 前端额度不足时展示「再开一次微信提醒」引导 */
  async getSubscribeQuota(userId: bigint): Promise<SubscribeQuotaResponse> {
    return this.quota.snapshot(userId);
  }

  // -------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------

  private get expiresInSeconds(): number {
    return parseDurationSeconds(
      this.config.get<string>('JWT_EXPIRES_IN'),
      DEFAULT_JWT_TTL_SECONDS,
    );
  }

  private async signToken(userId: bigint, openid: string): Promise<string> {
    return this.jwt.signAsync({
      // ⚠️ sub 用 number：JWT 是 JSON，bigint 序列化会直接抛
      sub: Number(userId),
      openid,
    });
  }

  /**
   * 首次登录即注册。
   *
   * 昵称/头像用「有值才覆盖」的策略：微信现在不返回昵称头像，
   * 用户在小程序里手动设置过一次之后，不该被下一次登录清空。
   */
  private async upsertUser(openid: string, dto: LoginDto) {
    const user = await this.prisma.user.upsert({
      where: { openid },
      create: {
        openid,
        nickname: dto.nickname ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        status: EnabledStatus.ENABLED,
        lastLoginAt: new Date(),
      },
      update: {
        lastLoginAt: new Date(),
        ...(dto.nickname ? { nickname: dto.nickname } : {}),
        ...(dto.avatarUrl ? { avatarUrl: dto.avatarUrl } : {}),
      },
    });

    if (user.status !== EnabledStatus.ENABLED) {
      // 不解释具体原因，避免「怎么解封」这类追问；家庭场景极少触发
      throw BusinessException.forbidden('这个账号暂时用不了，联系一下家里人就知道了');
    }

    return user;
  }
}

function toAuthUser(user: {
  id: bigint;
  nickname: string | null;
  avatarUrl: string | null;
}): AuthUser {
  return {
    id: toNumberRequired(user.id),
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
  };
}
