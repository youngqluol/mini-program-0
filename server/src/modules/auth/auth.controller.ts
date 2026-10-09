import { Body, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ReportSubscribeQuotaDto } from './dto/report-subscribe-quota.dto';
import { CurrentUser, Public } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import type {
  AuthUser,
  LoginResponse,
  RefreshTokenResponse,
  SubscribeQuotaResponse,
} from '@shared/dto/auth';

/**
 * 认证模块（docs/02 §二）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST  /api/auth/login              微信登录（**唯一不需要 token 的接口**）
 *   POST  /api/auth/refresh            续期 token
 *   PATCH /api/auth/profile            更新个人资料
 *   POST  /api/auth/subscribe-quota    上报订阅授权结果
 *   GET   /api/auth/subscribe-quota    查询订阅额度
 *   DELETE /api/auth/account           注销账号（合规必需，docs/02 §2.6）
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  /**
   * 微信登录（M1-B5）。
   *
   * 这是全项目唯一标了 `@Public()` 的业务接口 —— 其他所有接口
   * 都默认要求登录（见 AppModule 的全局 JwtGuard）。
   */
  @Post('login')
  @Public()
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto);
  }

  /** 续期 token（M1-B15）。前端拿到 40101 时先试这个，失败再重新登录。 */
  @Post('refresh')
  async refresh(@CurrentUser() user: CurrentUserPayload): Promise<RefreshTokenResponse> {
    return this.auth.refresh(user.userId, user.openid);
  }

  /** 更新个人资料 */
  @Patch('profile')
  async updateProfile(
    @CurrentUser('userId') userId: bigint,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.auth.updateProfile(userId, dto);
  }

  /**
   * 上报订阅授权结果（docs/02 §2.4）。
   *
   * 前端在 `wx.requestSubscribeMessage` 的成功回调里调用 —— 顺手收集授权，
   * 而不是单独弹一次授权框（PRD 6.5.2）。
   */
  @Post('subscribe-quota')
  async reportSubscribeQuota(
    @CurrentUser('userId') userId: bigint,
    @Body() dto: ReportSubscribeQuotaDto,
  ): Promise<SubscribeQuotaResponse> {
    return this.auth.reportSubscribeQuota(userId, dto);
  }

  /** 查询订阅额度（docs/02 §2.5） */
  @Get('subscribe-quota')
  async getSubscribeQuota(
    @CurrentUser('userId') userId: bigint,
  ): Promise<SubscribeQuotaResponse> {
    return this.auth.getSubscribeQuota(userId);
  }

  /**
   * 注销账号（docs/02 §2.6）。
   *
   * 用 `DELETE /auth/account` 而不是 `POST /auth/logout` 那种写法：
   * 注销**不可逆**，方法名要让人一眼看出这一点。
   *
   * 幂等（重复调用不报错），理由见 `AccountService.deleteAccount`。
   * 只认 token 里的 `userId` —— **不接受客户端指定要注销谁**：
   * 这是一个「自己删自己」的接口，任何入参都可能变成越权入口。
   */
  @Delete('account')
  async deleteAccount(@CurrentUser('userId') userId: bigint): Promise<{ ok: true }> {
    await this.account.deleteAccount(userId);
    return { ok: true };
  }
}
