import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { NotifyModule } from '../notify/notify.module';
import { ThingController } from './thing.controller';
import { ThingService } from './thing.service';

/**
 * 小事模块（派活 / 叮一下）。
 *
 * 依赖：
 *   - `FamiliesModule` —— 借 `FamilyMemberGuard`（家庭上下文校验）与
 *     `FamiliesService`（从小事反查家庭时判定成员身份）
 *   - `NotifyModule`   —— 借 `NotifyService` 下发派活通知 / 叮一下 / 完成回执
 *
 * 依赖方向保持单向：thing → families、thing → notify，两者都不反向依赖 thing。
 * `ThingService` 对外导出，供后续的 reminder / menu（一键派活）模块复用。
 */
@Module({
  imports: [FamiliesModule, NotifyModule],
  controllers: [ThingController],
  providers: [ThingService],
  exports: [ThingService],
})
export class ThingModule {}
