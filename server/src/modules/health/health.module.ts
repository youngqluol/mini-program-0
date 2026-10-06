import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** 健康检查模块。无 controller 之外的东西，也不导出任何服务。 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
