import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Public, CurrentUser } from '../../common/decorators/current-user.decorator';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { MpBindService } from '../wechat/mp-bind.service';
import { MpBindStatus } from '@shared/dto/notify';

class ManualBindDto {
  /** 用户 ID（字符串传，避免前端 JS 大整数精度问题） */
  @IsString()
  userId!: string;

  /** 公众号 openid */
  @IsString()
  @Length(10, 64)
  mpOpenid!: string;
}

/**
 * 微信提醒绑定接口（docs/02 §9.4–9.6）。
 *
 * 全局前缀 `/api`，因此实际路径为：
 *   GET    /api/notify/mp-bind/status
 *   POST   /api/notify/mp-bind/code
 *   DELETE /api/notify/mp-bind
 *   POST   /api/notify/internal/bind-mp-openid   （内部，需 X-Internal-Secret）
 *
 * 前三个走全局 JwtGuard（AppModule 注册），所以这里不用写 @UseGuards。
 */
@Controller('notify')
export class NotifyController {
  constructor(private readonly mpBind: MpBindService) {}

  /** 查询「我的 → 微信提醒」页的绑定状态 */
  @Get('mp-bind/status')
  async status(@CurrentUser('userId') userId: bigint): Promise<MpBindStatus> {
    return this.mpBind.getStatus(userId);
  }

  /** 生成绑定码（页面上会同时展示测试号二维码） */
  @Post('mp-bind/code')
  async createCode(@CurrentUser('userId') userId: bigint): Promise<MpBindStatus> {
    return this.mpBind.createBindCode(userId);
  }

  /** 关闭微信提醒 */
  @Delete('mp-bind')
  async unbind(@CurrentUser('userId') userId: bigint): Promise<{ ok: true }> {
    await this.mpBind.unbind(userId);
    return { ok: true };
  }

  /**
   * 保底方案：管理员手工录入 openid。
   *
   * 只在家人极少、暂时不想做回调时使用（方案文档 5.3）。
   * ⚠️ 必须 `@Public()` 跳过全局 JWT 守卫 —— 调用方是运维脚本，
   *    没有用户 token，安全性由 InternalSecretGuard 的共享密钥保证。
   */
  @Post('internal/bind-mp-openid')
  @Public()
  @UseGuards(InternalSecretGuard)
  async bindManually(@Body() dto: ManualBindDto): Promise<{ ok: true }> {
    await this.mpBind.bindManually(BigInt(dto.userId), dto.mpOpenid);
    return { ok: true };
  }
}
