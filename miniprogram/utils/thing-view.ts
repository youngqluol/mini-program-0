/**
 * 小事 → 卡片展示模型
 *
 * 为什么要有这一层：后端给了三种形状的小事（`ThingListItem` / `TodayTask` /
 * `TodayReminder`），它们字段名不同、语义相同。如果每个页面各自拼展示字段，
 * 「要求时间怎么念」「执行人取不到怎么显示」就会在首页、列表、详情各写一遍，
 * 然后慢慢漂移成三种说法。
 *
 * 所以：**归一化只做一次**，`thing-card` 组件只认 `ThingCardItem`。
 * 组件保持纯展示，不认识任何后端 DTO。
 */

import type {
  ThingListItem,
  ThingStatusValue,
  ThingTypeValue,
  TodayReminder,
  TodayTask,
} from '@shared/dto/thing';
import { NO_ASSIGNEE_TEXT, THING_STATUS_LABEL, THING_TYPE_META } from '../constants/thing';
import { describeDue } from './time';

export interface ThingCardItem {
  id: number;
  type: ThingTypeValue;
  /** 类型 emoji（🎯 / 🔔），从 THING_TYPE_META 取 */
  emoji: string;
  title: string;
  status: ThingStatusValue;
  /** 「待完成 / 已完成 / 已取消」 */
  statusLabel: string;
  /** 是否已经不需要再做了（已完成或已取消）—— 卡片据此置灰 */
  done: boolean;
  /** 卡片右侧/左侧的主时间文案：「今天 18:00」/「17:30」/「不限时间」 */
  timeText: string;
  /** 执行人的家庭称谓；取不到时用中性兜底，不显示「失败」 */
  assigneeName: string;
  /**
   * 已过要求时间且仍未完成。
   *
   * ⚠️ **可选**：只有 `ThingListItem` 带这个字段，今日汇总没有。
   *    不要给「不知道」的情况填 `false` —— 那会把「未知」说成「没晚」。
   */
  isOverdue?: boolean;
  /** 是否还有待发送的提醒。同样只有列表/详情带，今日汇总没有。 */
  hasReminder?: boolean;
}

/** `GET /family-things` 列表项 / `GET /family-things/{id}` 详情 */
export function fromThingListItem(item: ThingListItem): ThingCardItem {
  return {
    id: item.id,
    type: item.type,
    emoji: THING_TYPE_META[item.type].emoji,
    title: item.title,
    status: item.status,
    statusLabel: THING_STATUS_LABEL[item.status],
    done: item.status !== 'PENDING',
    timeText: describeDue(item.dueAt),
    assigneeName: item.assignee ? item.assignee.roleName : NO_ASSIGNEE_TEXT,
    isOverdue: item.isOverdue,
    hasReminder: item.hasReminder,
  };
}

/** 首页「最近的活」条目（`TodaySummary.tasks`） */
export function fromTodayTask(task: TodayTask): ThingCardItem {
  return {
    id: task.id,
    type: 'TASK',
    emoji: THING_TYPE_META.TASK.emoji,
    title: task.title,
    status: task.status,
    statusLabel: THING_STATUS_LABEL[task.status],
    done: task.status !== 'PENDING',
    timeText: describeDue(task.dueAt),
    assigneeName: task.assignee ? task.assignee.roleName : NO_ASSIGNEE_TEXT,
  };
}

/**
 * 首页「今天的提醒」条目（`TodaySummary.reminders`）。
 *
 * `time` 后端已经格式化成 `"HH:mm"`，直接当主时间用 —— 不要再走 `describeDue`，
 * 那会把今天的提醒说成「今天 17:30」，在只有今天内容的区块里是废话。
 */
export function fromTodayReminder(reminder: TodayReminder): ThingCardItem {
  return {
    id: reminder.id,
    type: 'REMINDER',
    emoji: THING_TYPE_META.REMINDER.emoji,
    title: reminder.title,
    status: reminder.status,
    statusLabel: THING_STATUS_LABEL[reminder.status],
    done: reminder.status !== 'PENDING',
    timeText: reminder.time,
    assigneeName: reminder.assignee ? reminder.assignee.roleName : NO_ASSIGNEE_TEXT,
  };
}
