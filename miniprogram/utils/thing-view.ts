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
 *
 * P10 详情页的展示模型（`ThingDetailView`）也放这里，理由相同：
 * 它全是纯函数，页面只负责「取数据 → setData → 绑事件」。
 */

import type {
  ThingDetail,
  ThingListItem,
  ThingStatusValue,
  ThingTypeValue,
  TodayReminder,
  TodayTask,
} from '@shared/dto/thing';
import { NO_ASSIGNEE_TEXT, THING_STATUS_LABEL, THING_TYPE_META } from '../constants/thing';
import { describeDue, shortMoment } from './time';

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

/** 首页「今天的提醒」的一行 = 卡片 + 要不要给那个快速完成的圈 */
export interface TodayRowView {
  /** 与 `card.id` 同值，只是为了让 `wx:key` 能直接取 */
  id: number;
  card: ThingCardItem;
  /**
   * 右侧要不要给「快速完成」的圈。
   *
   * 判据与 P10 / P11 完全一致：**只有执行人能完成**。
   * 不是执行人却给一个能点的圈，点下去就是一次 403 toast ——
   * 不如一开始就不给这个圈。
   */
  canCheck: boolean;
}

export function buildTodayReminderRow(item: TodayReminder, myMemberId: number): TodayRowView {
  return {
    id: item.id,
    card: fromTodayReminder(item),
    canCheck: item.assignee != null && item.assignee.memberId === myMemberId,
  };
}

// =============================================================
// P10 详情页展示模型
// =============================================================

/** 主操作槽位的形态：能做的动作 / 只能看状态 */
export type DetailMainTone = 'primary' | 'idle' | 'done' | 'cancelled';

export interface ThingDetailView {
  typeEmoji: string;
  typeLabel: string;
  title: string;
  /** 「阿妈 → 阿爸」；派给自己时只有「阿妈」；没执行人时是「还没人接」 */
  peopleText: string;
  /** 「明天 18:00 前完成」/「不限时间」 */
  dueText: string;
  /** 「🔔 17:30 提醒阿爸」；没有可说的提醒时为空串 */
  reminderText: string;
  /** 备注原文；空串表示没有备注 */
  content: string;
  /** 「家里人都能看到」/「只有我和阿爸能看到」 */
  visibilityText: string;

  mainTone: DetailMainTone;
  /** 主操作槽位的文案 */
  mainText: string;
  /** 次操作：`''` 表示不显示 */
  subAction: '' | 'CANCEL' | 'REOPEN';
}

/**
 * 「要求完成时间」说成人话。
 *
 * 单独写而不是直接 `describeDue() + '前完成'`，两个坑：
 *   ① `describeDue(null)` 是「不限时间」，拼出来会变成「不限时间前完成」——
 *      一句不通的话，所以「不限时间」要单独提前返回；
 *   ② `describeDue()` 内部是「明天 18:00」这种**数字前留空**的写法，
 *      所以「前完成」也要留一个空格（「明天 18:00 前完成」），
 *      否则同一行里一半有空格一半没有，看着像手抖。
 */
function buildDueText(type: ThingTypeValue, dueAt: string | null): string {
  if (!dueAt) return '不限时间';
  return type === 'TASK' ? `${describeDue(dueAt)} 前完成` : describeDue(dueAt);
}

/**
 * 提醒那一行。
 *
 * 只挑**还没发出去**的那条里最早的一条来说 —— 说「最后一条」没有意义，
 * 用户关心的是「下一次什么时候会响」。已经响过的只在没有待发提醒时才提一句。
 */
function buildReminderText(detail: ThingDetail, assigneeName: string): string {
  const alive = detail.reminders
    .filter((r) => r.status === 'PENDING')
    .sort((a, b) => (a.remindAt || '').localeCompare(b.remindAt || ''));

  if (alive.length > 0) {
    const next = alive[0];
    // 立即叮（NOW）没有具体时刻，别硬编一个出来；
    // 叮一下（REMINDER）的「小事时间」本来就是提醒时间，再说一遍时刻是重复的
    if (!next.remindAt || next.remindAt === detail.dueAt) {
      return `🔔 到时候会提醒${assigneeName}`;
    }
    return `🔔 ${shortMoment(next.remindAt, detail.dueAt || '')} 提醒${assigneeName}`;
  }

  // 已完成 / 已取消时提醒会被一并取消 —— 上面已经有状态条了，不再重复说
  if (detail.status !== 'PENDING') return '';

  return detail.reminders.some((r) => r.sentCount > 0) ? `🔔 已经提醒过${assigneeName}了` : '';
}

/**
 * 谁能看见。
 *
 * ⚠️ `RELATED` 的语义是「创建人 + 执行人」，**不是「仅自己」**。
 *    所以自己给自己派活时，可见范围才真的只有一个人 —— 那时候说
 *    「只有我俩」就成了假话，必须换成「只有我自己」。
 */
function buildVisibilityText(detail: ThingDetail, myMemberId: number): string {
  if (detail.visibility === 'FAMILY') return '家里人都能看到';

  const assignee = detail.assignee;
  if (!assignee || assignee.memberId === detail.creator.memberId) return '只有我自己能看到';

  // RELATED 的详情只有创建人或执行人看得到，所以「对方」一定是另一个人
  const other =
    detail.creator.memberId === myMemberId ? assignee.roleName : detail.creator.roleName;
  return `只有我和${other}能看到`;
}

/** 「已完成 · 18:05 由阿爸完成」/「已取消 · 昨天 12:00」 */
function buildStatusText(detail: ThingDetail): string {
  if (detail.status === 'COMPLETED') {
    const at = detail.completedAt ? shortMoment(detail.completedAt) : '';
    const who = detail.completedBy ? `由${detail.completedBy.roleName}完成` : '';
    const tail = [at, who].filter(Boolean).join(' ');
    return tail ? `已完成 · ${tail}` : '已完成';
  }

  if (detail.status === 'CANCELLED') {
    const at = detail.cancelledAt ? shortMoment(detail.cancelledAt) : '';
    return at ? `已取消 · ${at}` : '已取消';
  }

  return '';
}

/**
 * 把后端详情翻译成界面要的一堆平铺字段 —— 页面里不再做任何判断。
 *
 * 权限只认「我是不是执行人 / 我是不是发起人」两种关系。
 * **后端的「家庭创建者也能完成 / 取消」这条兜底刻意不露出**：
 * 那是防止一件事因为执行人退出家庭而永远卡住的数据阀门，
 * 不是产品要主推的动作 —— 「只提醒，不监督」意味着不该把
 * 「我替你点完成」摆在手边。代价见 `docs/未来需求池.md`。
 *
 * @param myMemberId 我在这个家庭里的 memberId；取不到传 0（所有「是不是我」判否）
 */
export function buildThingDetailView(detail: ThingDetail, myMemberId: number): ThingDetailView {
  const meta = THING_TYPE_META[detail.type];
  const assignee = detail.assignee;
  const assigneeName = assignee ? assignee.roleName : NO_ASSIGNEE_TEXT;
  const isAssignee = assignee != null && assignee.memberId === myMemberId;
  const isCreator = detail.creator.memberId === myMemberId;

  const view: ThingDetailView = {
    typeEmoji: meta.emoji,
    typeLabel: meta.label,
    title: detail.title,
    peopleText:
      !assignee || assignee.memberId === detail.creator.memberId
        ? detail.creator.roleName
        : `${detail.creator.roleName} → ${assignee.roleName}`,
    dueText: buildDueText(detail.type, detail.dueAt),
    reminderText: buildReminderText(detail, assigneeName),
    content: detail.content || '',
    visibilityText: buildVisibilityText(detail, myMemberId),
    mainTone: 'idle',
    mainText: '',
    subAction: '',
  };

  if (detail.status === 'PENDING') {
    view.mainTone = isAssignee ? 'primary' : 'idle';
    // 旁观者这里显示的是**状态**，不是「一个按不了的按钮」
    view.mainText = isAssignee ? '搞定啦 ✓' : THING_STATUS_LABEL.PENDING;
    view.subAction = isCreator ? 'CANCEL' : '';
  } else {
    view.mainTone = detail.status === 'COMPLETED' ? 'done' : 'cancelled';
    view.mainText = buildStatusText(detail);
    view.subAction = isCreator ? 'REOPEN' : '';
  }

  return view;
}

// =============================================================
// P11 列表行视图（卡片 + 左滑快捷操作）
// =============================================================

/** 行上能做的快捷操作 */
export type ThingRowActionKey = 'COMPLETE' | 'CANCEL' | 'REOPEN';

export interface ThingRowAction {
  key: ThingRowActionKey;
  label: string;
  /** 破坏性动作单独染色，别和普通操作长一样 */
  tone: 'normal' | 'danger';
}

export interface ThingRowView {
  /** 与 `card.id` 同值，只是为了让 `wx:key` 能直接取 */
  id: number;
  card: ThingCardItem;
  /** 左滑露出的快捷操作；**空数组表示这一行不可滑**（不是「滑了没反应」） */
  actions: ThingRowAction[];
}

/**
 * P11 列表的一行 = 卡片 + 这一行此刻能做的快捷操作。
 *
 * 操作与 P10 详情页同一套权限判断（执行人 / 发起人），只是换了形态：
 * 详情页给一个主操作，列表给一排短标签。
 *
 * 权限规则（与 `server/src/modules/thing/thing.service.ts` 对齐）：
 *   PENDING  → 执行人可「搞定啦」；发起人可「取消」
 *   已结束   → 发起人可「重新打开」
 *
 * 后端还允许**家庭创建者**越过身份操作（数据阀门），这里同样刻意不露出 ——
 * 理由见 P10 的 `buildThingDetailView()`。
 *
 * ⚠️ 返回空 `actions` 时，页面要真的**关掉这一行的左滑能力**，
 *    而不是滑开一个空抽屉。所以 swipe-cell 见到空数组会直接不响应手势。
 */
export function buildThingRowView(item: ThingListItem, myMemberId: number): ThingRowView {
  const isAssignee = item.assignee != null && item.assignee.memberId === myMemberId;
  const isCreator = item.creator.memberId === myMemberId;
  const actions: ThingRowAction[] = [];

  if (item.status === 'PENDING') {
    if (isAssignee) actions.push({ key: 'COMPLETE', label: '搞定啦', tone: 'normal' });
    if (isCreator) actions.push({ key: 'CANCEL', label: '取消', tone: 'danger' });
  } else if (isCreator) {
    actions.push({ key: 'REOPEN', label: '重新打开', tone: 'normal' });
  }

  return { id: item.id, card: fromThingListItem(item), actions };
}
