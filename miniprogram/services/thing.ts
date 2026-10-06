/**
 * 小事（派活 / 叮一下）接口（docs/02 §四）
 *
 * 路径与 `server/src/modules/thing/thing.controller.ts` 一一对应。
 *
 * ⚠️ **`familyId` 有两种传法**，别搞混：
 *   - 列表 / 创建 / 今日汇总 → 显式传（query 或 body），走 `FamilyMemberGuard`
 *   - 详情 / 编辑 / 完成 / 取消 / 重开 → **不传**，后端顺着「小事 → 家庭」自己反查
 *     这样前端不会造出「familyId 与小事不一致」的请求。
 */

import type {
  CompleteThingResponse,
  CreateThingRequest,
  CreateThingResponse,
  ListThingsQuery,
  ListThingsResponse,
  ThingDetail,
  TodaySummary,
  UpdateThingRequest,
} from '@shared/dto/thing';
import { get, patch, post } from './request';

/** 创建小事（派活 / 叮一下）。返回详情，可直接跳 P10。 */
export function create(data: CreateThingRequest): Promise<CreateThingResponse> {
  return post<CreateThingResponse>('/family-things', { ...data });
}

/**
 * 小事列表。
 *
 * `scope` 决定「谁的小事」：ALL（家里全部可见的）/ MINE（我派的）/ ASSIGNED_TO_ME（派给我的）。
 * P11 的三个筛选 Tab 就对应这三个值。
 */
export function list(query: ListThingsQuery): Promise<ListThingsResponse> {
  return get<ListThingsResponse>('/family-things', { ...query });
}

/** 首页「今天家里有什么事」（P01 一次拉全） */
export function today(familyId: number): Promise<TodaySummary> {
  return get<TodaySummary>('/family-things/today', { familyId });
}

/** 小事详情 */
export function detail(thingId: number): Promise<ThingDetail> {
  return get<ThingDetail>(`/family-things/${thingId}`);
}

/** 编辑小事。`reminders` 传了就全量替换（旧提醒会被取消，不物理删）。 */
export function update(thingId: number, data: UpdateThingRequest): Promise<ThingDetail> {
  return patch<ThingDetail>(`/family-things/${thingId}`, { ...data });
}

/** 搞定啦 ✓ —— 触发完成回执给发起人 */
export function complete(thingId: number): Promise<CompleteThingResponse> {
  return post<CompleteThingResponse>(`/family-things/${thingId}/complete`);
}

/** 取消这件事（逻辑删除，历史保留） */
export function cancel(thingId: number): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/family-things/${thingId}/cancel`);
}

/** 重新打开（已完成 / 已取消的都能回到待完成） */
export function reopen(thingId: number): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/family-things/${thingId}/reopen`);
}
