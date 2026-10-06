/**
 * 提醒接口（docs/02 §五）
 *
 * 路径与 `server/src/modules/thing/reminder.controller.ts` 一一对应。
 *
 * ⚠️ 同样是两种 `familyId` 传法：
 *   - `nudge` / `inbox` → 显式传（body 或 query）
 *   - `markInboxRead` / `cancelReminder` / `addReminder` → **不传**，后端从资源反查
 */

import type { InboxResponse, NudgeRequest, NudgeResponse, ThingDetail } from '@shared/dto/thing';
import type { AddReminderRequest, ReminderStatusValue } from '@shared/dto/thing';
import { del, get, post } from './request';

/**
 * 立即叮一下。
 *
 * 两种用法：带 `thingId` 给已有小事补一次提醒；不带则现场建一条叮一下。
 *
 * 返回的 `deliveryStatus` 是**给发起人看的三档结果**，不要统一成「成功」——
 * 「叮到了」/「对方没开微信提醒」/「额度用完了已转站内」必须分清，
 * 否则发起人会按错误的提示去操作（PRD 6.5.6）。文案见 `@shared/dto/notify` 的
 * `formatDeliveryToast()`。
 */
export function nudge(data: NudgeRequest): Promise<NudgeResponse> {
  return post<NudgeResponse>('/reminders/nudge', { ...data });
}

/** 我的待提醒（站内兜底通道）。`status` 不传则返回「未取消」的全部。 */
export function inbox(familyId: number, status?: ReminderStatusValue): Promise<InboxResponse> {
  const query: Record<string, unknown> = { familyId };
  if (status) query.status = status;
  return get<InboxResponse>('/reminders/inbox', query);
}

/** 标记收件箱某条已读。只能标记发给我的那一条。 */
export function markInboxRead(reminderId: number): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/reminders/inbox/${reminderId}/read`);
}

/** 给已有小事补一条提醒。返回更新后的小事详情。 */
export function addReminder(
  thingId: number,
  data: AddReminderRequest,
): Promise<ThingDetail> {
  return post<ThingDetail>(`/family-things/${thingId}/reminders`, { ...data });
}

/** 取消一条提醒。接收人本人 / 小事发起人 / 家庭创建者都能取消。 */
export function cancelReminder(reminderId: number): Promise<{ ok: true }> {
  return del<{ ok: true }>(`/reminders/${reminderId}`);
}
