import { Module } from '@nestjs/common';
import { ThingModule } from '../thing/thing.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

/**
 * 调度器模块（M2-B20 / B21 / B22）。
 *
 * 依赖：
 *   - `ThingModule` —— 借 `ReminderService` 的 `fireDueReminder`（下发到点提醒）
 *     与 `retryReminderNotification`（补偿重发）。
 *     「怎么发」在那边，「什么时候发」在这里。
 *   - `RedisService` / `PrismaService` —— 全局模块，无需 import
 *
 * 为什么单独一个模块而不是塞进 thing：调度是**入口**（云托管 Cron 打进来的），
 * 与「用户操作」是两条完全不同的触发路径。放在一起会让 thing 模块
 * 同时承担「被用户调用」和「被定时器调用」两种职责，权限模型也不一样
 *（调度接口走共享密钥，不走 JWT）。
 */
@Module({
  imports: [ThingModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
