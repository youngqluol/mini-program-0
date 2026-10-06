import { Controller, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/current-user.decorator';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { SchedulerService } from './scheduler.service';
import type { CompensateResult, TickResult } from './scheduler.service';

/**
 * 内部调度接口（docs/02 §十）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST /api/internal/scheduler/tick        每分钟一次
 *   POST /api/internal/scheduler/compensate  每天一次
 *
 * ⚠️ 必须 `@Public()` 跳过全局 JWT 守卫 —— 调用方是云托管 Cron，
 *    没有用户 token，安全性由 `InternalSecretGuard` 的共享密钥保证
 *    （`X-Internal-Secret: <INTERNAL_CRON_SECRET>`）。
 *
 * 为什么两个都是 POST：它们是**会产生副作用**的动作（真发消息、改状态），
 * 不是查询。Cron 配成 GET 也行，但用 POST 能在日志 / 网关层面一眼区分。
 */
@Controller('internal/scheduler')
@Public()
@UseGuards(InternalSecretGuard)
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  /** 提醒调度心跳（M2-B20）。建议 Cron：`* * * * *` */
  @Post('tick')
  async tick(): Promise<TickResult> {
    return this.scheduler.tick();
  }

  /** 补偿任务（M2-B22）。建议 Cron：`0 3 * * *`（每天凌晨 3 点） */
  @Post('compensate')
  async compensate(): Promise<CompensateResult> {
    return this.scheduler.compensate();
  }
}
