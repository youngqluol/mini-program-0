/**
 * 通知与「微信提醒」绑定接口（docs/02 §九）
 *
 * 路径与 `server/src/modules/notify/notification.controller.ts` +
 * `notify.controller.ts` 一一对应。
 *
 * ⚠️ **这一组都不带 `familyId`** —— 消息中心是**跨家庭的统一收件箱**，
 *    「微信提醒」是**用户级**开关（一个人开了，在哪个家庭里都能收到）。
 */

import type {
  MpBindStatus,
  NotificationItem,
  NotificationListResponse,
  UnreadCountResponse,
} from '@shared/dto/notify';
import { del, get, post } from './request';

// ---------------------------------------------------------------
// 消息中心（P12）
// ---------------------------------------------------------------

/** 通知列表。`type` 传 `'ALL'` 或不传表示不过滤。 */
export function listNotifications(query?: {
  type?: NotificationItem['type'] | 'ALL';
  page?: number;
  pageSize?: number;
}): Promise<NotificationListResponse> {
  return get<NotificationListResponse>('/notifications', query ? { ...query } : undefined);
}

/**
 * 未读数（给「我的」Tab 角标用）。
 *
 * 单独一个接口而不是「列表顺带返回」：角标每次进 Tab 都要刷新，
 * 为了一个数字拉 20 条通知太浪费。
 */
export function unreadCount(): Promise<UnreadCountResponse> {
  return get<UnreadCountResponse>('/notifications/unread-count');
}

/**
 * 全部已读。幂等：没有未读时返回 `updated: 0`，不报错。
 *
 * ⚠️ 已知缺口：docs/02 §9 只有「全部已读」，**没有单条已读**。
 *    所以点开一条通知不会清角标，只能靠这个接口清掉。
 *    已记入 `docs/未来需求池.md`。
 */
export function readAll(): Promise<{ updated: number }> {
  return post<{ updated: number }>('/notifications/read-all');
}

// ---------------------------------------------------------------
// 微信提醒绑定（P21）
// ---------------------------------------------------------------

/** 查询绑定状态。`pending=true` 表示正在等用户把绑定码发给公众号。 */
export function getMpBindStatus(): Promise<MpBindStatus> {
  return get<MpBindStatus>('/notify/mp-bind/status');
}

/** 生成绑定码（P21 展示二维码 + 6 位数字，每 3 秒轮询状态） */
export function createMpBindCode(): Promise<MpBindStatus> {
  return post<MpBindStatus>('/notify/mp-bind/code');
}

/**
 * 关闭微信提醒。
 *
 * 关闭后所有通知自动降级为「站内消息」，**产品依然完整可用** ——
 * 这不是「关掉功能」，而是「换一种收消息的方式」。文案上不要说得像惩罚。
 */
export function unbindMp(): Promise<{ ok: true }> {
  return del<{ ok: true }>('/notify/mp-bind');
}
