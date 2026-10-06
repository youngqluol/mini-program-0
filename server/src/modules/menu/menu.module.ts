import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

/**
 * 吃啥呢模块（M3）。
 *
 * 依赖：
 *   - `FamiliesModule` —— 借 `FamilyMemberGuard` 做家庭上下文校验
 *
 * 数据来源有两处，**都在这个模块里汇合**：
 *   - 系统菜谱：代码常量 `default-menu.ts`（72 条，不入库）
 *   - 家庭菜谱：`menu_items` 表
 * 两者在 `MenuService.buildPool()` 里合成一个池子，随机与排除都作用在它上面。
 *
 * 依赖方向保持单向：menu → families（后续还会 menu → thing，用于一键派活）。
 * `ThingService` 已由 `ThingModule` 导出，正是为这里准备的 ——
 * **一键派活必须复用小事模块的创建逻辑，不能另写一份**（docs/02 §6.8），
 * 否则「派活」的字段口径会在两个入口各长一套。
 */
@Module({
  imports: [FamiliesModule],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
