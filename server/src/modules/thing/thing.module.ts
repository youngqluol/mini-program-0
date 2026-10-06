import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { NotifyModule } from '../notify/notify.module';
import { ThingController } from './thing.controller';
import { ReminderController } from './reminder.controller';
import { ThingService } from './thing.service';
import { ReminderService } from './reminder.service';

/**
 * 小事模块（派活 / 叮一下）+ 提醒模块。
 *
 * 依赖：
 *   - `FamiliesModule` —— 借 `FamilyMemberGuard`（家庭上下文校验）与
 *     `FamiliesService`（从小事反查家庭时判定成员身份）
 *   - `NotifyModule`   —— 借 `NotifyService` 下发派活通知 / 叮一下 / 完成回执，
 *     借 `SubscribeQuotaService` 回「还剩几条额度」给前端
 *
 * 依赖方向保持单向：thing → families、thing → notify，两者都不反向依赖 thing。
 * `ThingService` 对外导出，供后续的 menu（一键派活）模块复用。
 *
 * 提醒的控制器与小事放在同一个模块，是因为它们共用同一套权限与上下文推导
 * （`ThingService.loadVisibleThing` / `contextForThing`）——
 * 拆成两个模块会立刻需要把这两个方法互相导出，反而更绕。
 */
@Module({
  imports: [FamiliesModule, NotifyModule],
  controllers: [ThingController, ReminderController],
  providers: [ThingService, ReminderService],
  exports: [ThingService, ReminderService],
})
export class ThingModule {}
