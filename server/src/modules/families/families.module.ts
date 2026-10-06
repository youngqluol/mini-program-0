import { Module } from '@nestjs/common';
import { FamiliesService } from './families.service';
import { FamiliesController } from './families.controller';
import { FamilyMemberGuard } from './guards/family-member.guard';
import { OwnerOnlyGuard } from './guards/owner-only.guard';

/**
 * 家庭模块。
 *
 * `FamiliesService` 对外导出 —— auth 模块登录时要顺带返回「我的家庭列表」，
 * 依赖方向是 auth → families（families 不反向依赖 auth），不会成环。
 */
@Module({
  controllers: [FamiliesController],
  providers: [FamiliesService, FamilyMemberGuard, OwnerOnlyGuard],
  exports: [FamiliesService],
})
export class FamiliesModule {}
