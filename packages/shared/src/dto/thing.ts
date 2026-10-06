/**
 * 小事模块出入参（docs/02 §四、§五）。
 *
 * 「派活」（TASK）与「叮一下」（REMINDER）共用同一套结构，靠 `type` 区分 ——
 * 它们在数据上本来就是同一张表 `family_things`，只是默认值不同：
 *   TASK     默认 visibility=FAMILY、dueAt 常用
 *   REMINDER 默认 visibility=RELATED、reminders 必带
 *
 * 所有时间字段都是 **"YYYY-MM-DD HH:mm:ss"（北京时间）**，
 * 由后端 `beijing-time.ts` 统一格式化；前端传入时也按同一格式。
 */

import type {
  RecurrenceType,
  RemindType,
  ReminderStatus,
  ThingStatus,
  ThingType,
  ThingVisibility,
} from '../enums';

/** 接口层的小事类型字符串：`'TASK' | 'REMINDER'` */
export type ThingTypeValue = keyof typeof ThingType;
/** 接口层的小事状态字符串 */
export type ThingStatusValue = keyof typeof ThingStatus;
/** 接口层的可见范围字符串 */
export type ThingVisibilityValue = keyof typeof ThingVisibility;
/** 接口层的重复类型字符串 */
export type RecurrenceTypeValue = keyof typeof RecurrenceType;
/** 接口层的提醒类型字符串 */
export type RemindTypeValue = keyof typeof RemindType;
/** 接口层的提醒状态字符串 */
export type ReminderStatusValue = keyof typeof ReminderStatus;

// ---------------------------------------------------------------
// 通用片段
// ---------------------------------------------------------------

/** 小事里出现的成员简写（创建人 / 执行人）。头像可空，前端用称谓首字兜底。 */
export interface ThingMemberBrief {
  memberId: number;
  /** 家庭称谓，例如「阿妈」—— 文案里用它，不用昵称 */
  roleName: string;
  avatarUrl: string | null;
}

/**
 * 重复规则。
 *
 * 存储时是 JSON，这里给一个宽松但有文档的壳：
 *   DAILY   → { time: "09:00" }
 *   WEEKLY  → { weekdays: [1,3,5], time: "20:00" }
 *   MONTHLY → { days: [1,15], time: "08:00" }
 */
export interface RecurrenceConfig {
  /** 触发时刻 "HH:mm" */
  time?: string;
  /** 周几：1=周一 … 7=周日 */
  weekdays?: number[];
  /** 每月几号：1–31 */
  days?: number[];
}

// ---------------------------------------------------------------
// 提醒（things 的子资源）
// ---------------------------------------------------------------

/** 创建 / 编辑小事时内嵌的提醒项（docs/02 §4.1） */
export interface ReminderInput {
  remindType: RemindTypeValue;
  /** 定时叮必填；立即叮（NOW）忽略 */
  remindAt?: string | null;
  recurrenceType?: RecurrenceTypeValue;
  recurrenceConfig?: RecurrenceConfig | null;
  /** 提醒对象；不传则默认取小事的执行人 */
  recipientMemberId?: number | null;
}

/** 小事详情里的提醒项（docs/02 §4.3） */
export interface ReminderItem {
  id: number;
  remindType: RemindTypeValue;
  remindAt: string | null;
  recurrenceType: RecurrenceTypeValue;
  status: ReminderStatusValue;
  sentCount: number;
  lastSentAt: string | null;
}

// ---------------------------------------------------------------
// 小事
// ---------------------------------------------------------------

/** POST /family-things 请求（docs/02 §4.1） */
export interface CreateThingRequest {
  familyId: number;
  type: ThingTypeValue;
  /** 最长 200 字 */
  title: string;
  /** 最长 1000 字 */
  content?: string | null;
  /** 执行人；自己给自己派活传自己的 memberId */
  assigneeMemberId: number;
  /** 不传时：TASK→FAMILY，REMINDER→RELATED */
  visibility?: ThingVisibilityValue;
  /** 不限时间传 null */
  dueAt?: string | null;
  recurrenceType?: RecurrenceTypeValue;
  recurrenceConfig?: RecurrenceConfig | null;
  /** 可传 0..n 条；remindType=NOW 时后端立即下发 */
  reminders?: ReminderInput[];
}

/** PATCH /family-things/{id} 请求（docs/02 §4.4）。只传要改的字段。 */
export interface UpdateThingRequest {
  title?: string;
  content?: string | null;
  assigneeMemberId?: number;
  visibility?: ThingVisibilityValue;
  dueAt?: string | null;
  recurrenceType?: RecurrenceTypeValue;
  recurrenceConfig?: RecurrenceConfig | null;
  /** 传了就**全量替换**该小事下的提醒 */
  reminders?: ReminderInput[];
}

/** GET /family-things 列表项（docs/02 §4.2） */
export interface ThingListItem {
  id: number;
  type: ThingTypeValue;
  title: string;
  content: string | null;
  status: ThingStatusValue;
  visibility: ThingVisibilityValue;
  dueAt: string | null;
  creator: ThingMemberBrief;
  assignee: ThingMemberBrief | null;
  /** 是否还有待发送的提醒 */
  hasReminder: boolean;
  /** 下一条提醒时间；没有则为 null */
  nextRemindAt: string | null;
  /** 已过要求时间且仍未完成 */
  isOverdue: boolean;
  createdAt: string;
}

/** GET /family-things/{id} 详情（docs/02 §4.3）= 列表项 + 提醒与状态时间 */
export interface ThingDetail extends ThingListItem {
  reminders: ReminderItem[];
  completedAt: string | null;
  completedBy: ThingMemberBrief | null;
  cancelledAt: string | null;
  updatedAt: string;
}

/** POST /family-things 响应 = 详情 */
export type CreateThingResponse = ThingDetail;
/** POST /family-things/{id}/complete 响应（docs/02 §4.5） */
export interface CompleteThingResponse {
  id: number;
  status: ThingStatusValue;
  completedAt: string | null;
  completedBy: ThingMemberBrief | null;
  /** 重复任务生成的下一条实例 ID；无则 null */
  nextThingId: number | null;
}

/** GET /family-things 列表查询（docs/02 §4.2） */
export interface ListThingsQuery {
  familyId: number;
  type?: ThingTypeValue;
  status?: ThingStatusValue;
  assigneeMemberId?: number;
  /** ALL（默认）/ MINE（我创建的）/ ASSIGNED_TO_ME（派给我的） */
  scope?: 'ALL' | 'MINE' | 'ASSIGNED_TO_ME';
  startDate?: string;
  endDate?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** GET /family-things 列表响应 */
export interface ListThingsResponse {
  list: ThingListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------
// 首页今日汇总（docs/02 §4.8）
// ---------------------------------------------------------------

/** 今日提醒条目 */
export interface TodayReminder {
  id: number;
  title: string;
  /** "HH:mm" */
  time: string;
  assignee: ThingMemberBrief | null;
  status: ThingStatusValue;
}

/** 今日派活条目 */
export interface TodayTask {
  id: number;
  title: string;
  assignee: ThingMemberBrief | null;
  dueAt: string | null;
  status: ThingStatusValue;
}

/** 今日计数 */
export interface TodayStats {
  /** 今天该做的事总数 */
  todayTotal: number;
  /** 今天已完成数 */
  todayDone: number;
  /** 已过期未完成数 */
  overdue: number;
}

/** GET /family-things/today 响应 */
export interface TodaySummary {
  /** "YYYY-MM-DD" */
  date: string;
  reminders: TodayReminder[];
  tasks: TodayTask[];
  stats: TodayStats;
}

// ---------------------------------------------------------------
// 立即叮一下（docs/02 §5.3）
// ---------------------------------------------------------------

/** POST /reminders/nudge 请求 */
export interface NudgeRequest {
  familyId: number;
  /** 叮谁 */
  recipientMemberId: number;
  /** 叮的内容；关联已有小事时可省略 */
  content?: string;
  /** 关联的小事；纯叮一下时省略 */
  thingId?: number;
}

/** POST /reminders/nudge 响应 */
export interface NudgeResponse {
  thingId: number;
  reminderId: number;
  /** SENT / NO_QUOTA / NOT_BOUND / FAILED，见 dto/notify.ts 的 DeliveryResult */
  deliveryStatus: string;
  /** MP_TEMPLATE / SUBSCRIBE / IN_APP */
  deliveryChannel: string;
  /** 辅助通道剩余额度；不适用时为 null */
  quotaRemaining: number | null;
}

// ---------------------------------------------------------------
// 提醒收件箱（docs/02 §5.4 / §5.5）—— 站内消息兜底通道
// ---------------------------------------------------------------

/** GET /reminders/inbox 列表项 */
export interface InboxItem {
  id: number;
  thingId: number;
  title: string;
  content: string | null;
  /** 是谁叮的（发起人在家庭里的称谓） */
  fromRoleName: string;
  remindAt: string | null;
  isRead: boolean;
}

/** GET /reminders/inbox 响应 */
export interface InboxResponse {
  list: InboxItem[];
  /** 未读条数，供「我的」Tab 角标 */
  unreadCount: number;
}

/** POST /family-things/{thingId}/reminders 请求（docs/02 §5.1） */
export interface AddReminderRequest {
  recipientMemberId?: number;
  remindType: RemindTypeValue;
  remindAt?: string | null;
  recurrenceType?: RecurrenceTypeValue;
  recurrenceConfig?: RecurrenceConfig | null;
}
