import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { WechatModule } from '../wechat/wechat.module';
import { FamiliesModule } from '../families/families.module';
import { NotifyModule } from '../notify/notify.module';

/**
 * 认证模块。
 *
 * 依赖：
 *   - `JwtService`：由 AppModule 里的 `JwtModule.registerAsync({ global: true })`
 *     提供，所以这里不用再 import
 *   - `WechatModule`：登录要用 code2Session
 *   - `FamiliesModule`：登录要顺带返回「我的家庭列表」
 *   - `NotifyModule`：订阅额度上报/查询接口要用 `SubscribeQuotaService`
 *     （路由挂在 `/auth` 下是 docs/02 的约定，服务本身属于通知通道）
 *
 * `AccountService` 只做注销（docs/02 §2.6），**刻意从 `AuthService` 里拆出来**：
 * 登录/续期是「认身份」，注销是「抹身份」，后者要动 families / thing / notify
 * 四个域的表，塞进 AuthService 会让那个文件同时承担两件不相干的事。
 */
@Module({
  imports: [WechatModule, FamiliesModule, NotifyModule],
  controllers: [AuthController],
  providers: [AuthService, AccountService],
  exports: [AuthService],
})
export class AuthModule {}
