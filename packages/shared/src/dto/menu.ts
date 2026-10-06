/**
 * 吃啥呢模块出入参（docs/02 §六）。
 *
 * ## 两条容易搞错的地方
 *
 * ① **系统菜谱没有 `id`。** 它们存在代码常量里
 *    （`server/src/modules/menu/default-menu.ts`），`menu_items` 表里没有行 ——
 *    所以接口上 `id` 恒为 `null`。前端**不要**拿它去调 `PATCH /menu/items/{id}`，
 *    那是给家庭自定义菜谱用的（用 `canEdit` / `source` 判断）。
 *
 * ② **菜名是系统菜谱的唯一标识。** 因为没有 id，去重、排除最近吃过的、
 *    前端列表的 `wx:key`，全都用菜名。菜名在系统库内保证唯一（编译器强制）。
 *
 * 所有日期时间都是 **"YYYY-MM-DD HH:mm:ss"（北京时间）**，
 * 日期是 **"YYYY-MM-DD"**，由后端 `beijing-time.ts` 统一格式化。
 */

import type { MealType, MenuCategory, MenuSource } from '../enums';

/** 接口层的餐次字符串：`'BREAKFAST' | 'LUNCH' | 'DINNER' | 'OTHER'` */
export type MealTypeValue = keyof typeof MealType;
/** 接口层的菜谱来源字符串（`MenuSource` 是字符串枚举，值与键同名） */
export type MenuSourceValue = `${MenuSource}`;

// ---------------------------------------------------------------
// 随机推荐（docs/02 §6.1）
// ---------------------------------------------------------------

/**
 * 一道菜的**最小**信息 —— 随机推荐卡片用。
 *
 * `id` 为 `null` 表示这是系统菜谱（见文件头 ①）。
 */
export interface MenuItemBrief {
  id: number | null;
  name: string;
  category: MenuCategory | null;
  imageUrl: string | null;
  source: MenuSourceValue;
}

/** `GET /menu/random` 响应 */
export interface RandomMenuResponse {
  /** 抽中的菜，**不重复**。数量 ≤ 请求的 `count`（池子不够时会少给） */
  items: MenuItemBrief[];
  /**
   * 参与抽取的池子大小 —— 是**排除最近 3 天之后**的大小。
   * 前端用它判断「怎么换都是这几道」（池子太小）与空状态。
   */
  poolSize: number;
}

// ---------------------------------------------------------------
// 菜谱列表（docs/02 §6.2）
// ---------------------------------------------------------------

/** 菜谱列表里的一行 —— 比 `MenuItemBrief` 多两个状态位 */
export interface MenuItemRow extends MenuItemBrief {
  /** 停用后**仍然出现在列表里**（否则用户找不到它去重新启用），但不会进随机池 */
  enabled: boolean;
  /** 系统菜谱恒为 `false`。与 `source === 'SYSTEM'` 是同一个判断的两种说法 */
  canEdit: boolean;
}

/** `GET /menu/items` 响应 */
export interface ListMenuItemsResponse {
  /** 系统菜谱在前（按分类分组），家庭菜谱在后 */
  list: MenuItemRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------
// 决定吃什么（docs/02 §6.6 / §6.8）
// ---------------------------------------------------------------

/**
 * 「决定了吃什么」里的一道菜。
 *
 * ⚠️ **`name` 是权威的**：服务端以请求里的 `name` 落库（`meal_records.name` 是历史快照），
 * 不回头查菜谱表取名字 —— 用户看到的就是这个名字，记下来的也该是这个。
 * `menuItemId` 只是可选线索（家庭菜谱才有），传了服务端会校验它属于该家庭。
 */
export interface MealItemInput {
  /** 系统菜谱传 `null` */
  menuItemId: number | null;
  name: string;
}

/** `POST /menu/decide` 响应 */
export interface DecideMenuResponse {
  mealRecordIds: number[];
  /** 给 toast 用的现成句子：「今晚吃：番茄炒蛋、可乐鸡翅」 */
  summary: string;
}

/** `POST /menu/decide-and-assign` 响应 */
export interface DecideAndAssignResponse {
  /** 生成的那条派活的 ID，前端据此跳详情 */
  thingId: number;
  mealRecordIds: number[];
  /** 派活的标题（= 菜名列表），与 `POST /family-things` 的 `title` 口径一致 */
  title: string;
}

// ---------------------------------------------------------------
// 最近吃过（docs/02 §6.7）
// ---------------------------------------------------------------

/** 按「日期 + 餐次」归组的一次用餐 */
export interface RecentMealGroup {
  mealDate: string;
  mealType: MealTypeValue;
  /** 这一餐吃了什么。可能不止一道菜 */
  names: string[];
}
