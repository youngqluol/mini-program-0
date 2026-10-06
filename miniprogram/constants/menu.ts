/**
 * 吃啥呢的展示元数据（分类 / 餐次）
 *
 * ## 为什么这里要「镜像」一份 MENU_CATEGORY
 *
 * 小程序端**不能 import `@shared` 的运行时值** —— 微信开发者工具的 TS 编译
 * 只做类型擦除、不解析 tsconfig 的 `paths`，`import { 值 }` 会在运行时
 * `MODULE_NOT_FOUND`（见 `tools/check-shared.mjs` 头部说明）。
 * 所以分类列表必须在 `miniprogram/` 下重新写一份，由 `check-shared.mjs`
 * 与 `packages/shared/src/enums.ts` 逐字比对，防止两边漂移。
 *
 * ## 两个容易搞错的地方
 *
 * ① **分类不是纯展示标签，改它会改推荐行为。** 后端「一荤一素一汤」的组合
 *    就是靠分类算的（家常菜=荤 / 素菜=素 / 汤+主食=第三道 / 外食不参与）。
 *    P17 的分类下拉直接用这份顺序，**不要重排**。
 *
 * ② **系统菜谱没有 `id`**，接口上恒为 `null`（它们在代码常量里，不在库里）。
 *    所以 P17 里系统菜谱不可编辑、不可启停，靠 `canEdit` 判断。
 *
 * 文案纪律（AGENTS.md §6）：这里每个词都会出现在用户眼前，不许出现
 * 「待办 / 逾期 / 审批 / 流程」这类词。
 */

import type { MealTypeValue } from '@shared/dto/menu';

/**
 * 菜谱分类。
 *
 * ⚠️ **与 `packages/shared/src/enums.ts` 的 `MENU_CATEGORY` 必须逐字一致**
 * （键名、值、声明顺序）。改动后跑 `pnpm run check` —— `check-shared.mjs`
 * 会把两边逐个比对，不一致直接失败。
 */
export const MENU_CATEGORY = {
  /** 家常菜 —— 组合里的「荤」 */
  HOME: '家常菜',
  /** 素菜 —— 组合里的「素」 */
  VEGGIE: '素菜',
  SOUP: '汤',
  STAPLE: '主食',
  /** 外食 —— 不参与「一荤一素一汤」组合 */
  DINING_OUT: '外食',
} as const;

/** 分类的可选值，顺序 = 界面展示顺序（`<picker>` 的 range 直接用） */
export const MENU_CATEGORY_OPTIONS: string[] = [
  MENU_CATEGORY.HOME,
  MENU_CATEGORY.VEGGIE,
  MENU_CATEGORY.SOUP,
  MENU_CATEGORY.STAPLE,
  MENU_CATEGORY.DINING_OUT,
];

/**
 * 分类 → emoji。
 *
 * 装粉彩 squircle 色块（docs/07），所以只用**一个** emoji，
 * 不要写成「🍖 家常菜」—— 卡片上已经有分类文字了。
 */
export const CATEGORY_EMOJI: Record<string, string> = {
  [MENU_CATEGORY.HOME]: '🍖',
  [MENU_CATEGORY.VEGGIE]: '🥬',
  [MENU_CATEGORY.SOUP]: '🍲',
  [MENU_CATEGORY.STAPLE]: '🍚',
  [MENU_CATEGORY.DINING_OUT]: '🍜',
};

/** 分类取不到时的兜底 emoji —— 中性，不假装知道是荤是素 */
export const CATEGORY_EMOJI_FALLBACK = '🍽️';

/**
 * 餐次短名 —— 用在「最近吃过」那一行（`9/27 晚`）。
 *
 * `OTHER` 刻意是空串：说「9/27 其他」比不说更让人费解。
 */
export const MEAL_TYPE_SHORT: Record<MealTypeValue, string> = {
  BREAKFAST: '早',
  LUNCH: '午',
  DINNER: '晚',
  OTHER: '',
};

/**
 * 餐次的口语说法 —— 用在「已经派给阿妈啦，**今晚**有口福～」这类句子里。
 *
 * 与 `MEAL_TYPE_SHORT` 分开两张表：那张是**贴在日期后面**的（`9/27 晚`），
 * 这张是**嵌进句子里**的。合并的话，`OTHER` 得同时满足「不要说话」
 * 和「说『这顿』」两种要求，做不到。
 *
 * `DINNER` 用「今晚」而不是「晚饭」—— 派活发生在晚饭前，
 * 家里人说的是「今晚有口福」，不是「晚饭有口福」。
 */
export const MEAL_TYPE_WORD: Record<MealTypeValue, string> = {
  BREAKFAST: '早饭',
  LUNCH: '午饭',
  DINNER: '今晚',
  OTHER: '这顿',
};

/** P02 空池子（一条菜谱都没有）时的引导文案 */
export const NO_DISH_HINT = '还没有菜谱，先去加几个吧';
