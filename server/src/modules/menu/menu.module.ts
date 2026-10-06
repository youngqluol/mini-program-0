import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { ThingModule } from '../thing/thing.module';
import { WechatModule } from '../wechat/wechat.module';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

/**
 * 吃啥呢模块（M3）。
 *
 * 依赖：
 *   - `FamiliesModule` —— 借 `FamilyMemberGuard` 做家庭上下文校验
 *   - `ThingModule`    —— 借 `ThingService` 做「一键派活」（M3-7）。
 *     它已导出 `prepareThing` / `insertThing` / `dispatchCreatedThing` 三段，
 *     分别对应「事务外准备」「事务内写入」「提交后通知」。
 *   - `WechatModule`   —— 借 `ContentSecurityService` 做菜名的内容安全
 *
 * 数据来源有两处，**都在这个模块里汇合**：
 *   - 系统菜谱：代码常量 `default-menu.ts`（72 条，不入库）
 *   - 家庭菜谱：`menu_items` 表
 * 两者在 `MenuService.buildPool()` 里合成一个池子（按菜名去重、家庭版优先），
 * 随机与排除都作用在它上面。
 *
 * 依赖方向保持单向：menu → families / thing / wechat，三者都不反向依赖 menu。
 * ⚠️ **一键派活必须复用 `ThingService`，不能另写一份**（docs/02 §6.8）——
 * 否则「派活」的字段口径（可见性默认值、`title` 措辞、提醒的组装方式）
 * 会在两个入口各长一套，迟早不一致。
 */
@Module({
  imports: [FamiliesModule, ThingModule, WechatModule],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
