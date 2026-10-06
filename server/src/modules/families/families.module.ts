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
 *
 * 两个守卫也导出：thing / reminder 等模块的控制器同样要挂在「家庭成员」上下文上，
 * 而守卫依赖 `FamiliesService`（家庭上下文判定逻辑只该有一处）。
 * 与其在别的模块里重复 new 一份，不如让它们 import 这里。
 */
@Module({
  controllers: [FamiliesController],
  providers: [FamiliesService, FamilyMemberGuard, OwnerOnlyGuard],
  exports: [FamiliesService, FamilyMemberGuard, OwnerOnlyGuard],
})
export class FamiliesModule {}
