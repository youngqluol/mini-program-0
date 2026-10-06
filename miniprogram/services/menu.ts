/**
 * 吃啥呢接口（docs/02 §六）
 *
 * 路径与 `server/src/modules/menu/menu.controller.ts` 一一对应。
 *
 * ⚠️ **两个 `PATCH /items/:id` 不传 `familyId`。** URL 与 body 里都没有这个字段 ——
 * 后端顺着「菜谱 → 家庭」自己反查（`MenuService.contextForItem`），
 * 这样前端不会造出「familyId 与菜谱不一致」的请求。
 * 其余接口都以家庭为边界，`familyId` 显式传。
 *
 * ⚠️ **系统菜谱没有 `id`（恒为 `null`）**，不能拿它去调这两个 PATCH ——
 * 用 `canEdit` / `source` 判断（见 `@shared/dto/menu` 文件头）。
 */

import type {
  DecideAndAssignResponse,
  DecideMenuResponse,
  ListMenuItemsResponse,
  MealItemInput,
  MenuItemRow,
  RandomMenuResponse,
  RecentMealGroup,
} from '@shared/dto/menu';
import type { MealTypeValue } from '@shared/dto/menu';
import { get, patch, post } from './request';

/** 随机推荐（P02 的「换一个」/ 进入页面自动抽一次） */
export function random(query: {
  familyId: number;
  /** 晚餐传 3 让后端尽量凑「一荤一素一汤」 */
  count?: number;
  mealType?: MealTypeValue;
  category?: string;
  /** 默认 `true`：排除最近 3 天吃过的 */
  excludeRecent?: boolean;
}): Promise<RandomMenuResponse> {
  return get<RandomMenuResponse>('/menu/random', { ...query });
}

/** 菜谱列表（P17）。返回「系统菜谱 + 本家庭菜谱」的合集 */
export function items(query: {
  familyId: number;
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListMenuItemsResponse> {
  return get<ListMenuItemsResponse>('/menu/items', { ...query });
}

/** 最近吃过（P02 下方区块） */
export function recent(query: { familyId: number; days?: number }): Promise<RecentMealGroup[]> {
  return get<RecentMealGroup[]>('/menu/recent', { ...query });
}

/** 只记下「今天吃什么」，不派活（P02 的「不用派，自己解决」） */
export function decide(data: {
  familyId: number;
  mealDate?: string;
  mealType: MealTypeValue;
  items: MealItemInput[];
}): Promise<DecideMenuResponse> {
  return post<DecideMenuResponse>('/menu/decide', { ...data });
}

/** 记下吃什么 + 顺手派个活（P02 的「派给 XX」）。三件事一个事务 */
export function decideAndAssign(data: {
  familyId: number;
  mealDate?: string;
  mealType: MealTypeValue;
  items: MealItemInput[];
  assigneeMemberId: number;
  dueAt?: string | null;
  withReminder?: boolean;
  remindAt?: string | null;
}): Promise<DecideAndAssignResponse> {
  return post<DecideAndAssignResponse>('/menu/decide-and-assign', { ...data });
}

/** 新增家庭菜谱（P17 的「+ 添加」） */
export function createItem(data: {
  familyId: number;
  name: string;
  category?: string | null;
  imageUrl?: string | null;
}): Promise<MenuItemRow> {
  return post<MenuItemRow>('/menu/items', { ...data });
}

/** 改家庭菜谱（只传要改的字段）。⚠️ 不传 `familyId` —— 后端由菜谱反查 */
export function updateItem(
  itemId: number,
  data: { name?: string; category?: string | null; imageUrl?: string | null },
): Promise<MenuItemRow> {
  return patch<MenuItemRow>(`/menu/items/${itemId}`, { ...data });
}

/** 停用 / 启用家庭菜谱。停用后仍在列表里，只是不进随机池 */
export function setItemEnabled(itemId: number, enabled: boolean): Promise<MenuItemRow> {
  return patch<MenuItemRow>(`/menu/items/${itemId}/enabled`, { enabled });
}
