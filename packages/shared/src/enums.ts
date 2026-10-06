/**
 * 全局枚举定义 —— 前后端共享的唯一来源。
 *
 * 铁律（docs/04 第四章）：
 *   数据库存 TINYINT，接口传字符串。
 *   转换只在 repository 层做一次，前端代码里写 `status === ThingStatus.PENDING`
 *   而不是 `status === 1`。
 *
 * 每个枚举的数值必须与 `db/schema.sql` 的 COMMENT 严格一致。
 */

// ---------------------------------------------------------------
// 小事（派活 / 叮一下）
// ---------------------------------------------------------------

/** `family_things.type` */
export enum ThingType {
  /** 🎯 派活 */
  TASK = 1,
  /** 🔔 叮一下 */
  REMINDER = 2,
}

/** `family_things.status` */
export enum ThingStatus {
  PENDING = 1,
  COMPLETED = 2,
  CANCELLED = 3,
}

/** `family_things.visibility` —— 小事的可见范围 */
export enum ThingVisibility {
  /** 全家庭可见 */
  FAMILY = 1,
  /** 仅创建人 + 执行人可见（叮一下默认） */
  RELATED = 2,
}

/** `family_things.recurrence_type` / `thing_reminders.recurrence_type` */
export enum RecurrenceType {
  NONE = 0,
  DAILY = 1,
  WEEKLY = 2,
  MONTHLY = 3,
  /** V0.2 开放 */
  CUSTOM = 4,
}

// ---------------------------------------------------------------
// 提醒
// ---------------------------------------------------------------

/** `thing_reminders.remind_type` */
export enum RemindType {
  /** 立即叮 */
  NOW = 1,
  /** 定时叮 */
  SCHEDULED = 2,
}

/** `thing_reminders.status` */
export enum ReminderStatus {
  PENDING = 1,
  SENT = 2,
  CANCELLED = 3,
}

// ---------------------------------------------------------------
// 家庭
// ---------------------------------------------------------------

/** `family_members.status` */
export enum MemberStatus {
  ACTIVE = 1,
  LEFT = 0,
}

/** `family_invites.status` */
export enum InviteStatus {
  VALID = 1,
  USED = 2,
  EXPIRED = 3,
  CANCELLED = 4,
}

/** `users.status` / `families.status` / `menu_items.enabled` */
export enum EnabledStatus {
  DISABLED = 0,
  ENABLED = 1,
}

// ---------------------------------------------------------------
// 吃啥呢
// ---------------------------------------------------------------

/** `meal_records.meal_type` */
export enum MealType {
  BREAKFAST = 1,
  LUNCH = 2,
  DINNER = 3,
  OTHER = 4,
}

/**
 * 菜谱来源（接口字段 `source`）—— **不入库**，由 `menu_items.family_id` 是否为 NULL 推导。
 *
 * ⚠️ 系统菜谱是**代码常量**（`server/src/modules/menu/default-menu.ts`），
 * `menu_items` 表里没有它们的行 —— 所以系统菜谱在接口上 **`id` 恒为 `null`**。
 * 详见 docs/02 §6.1。
 */
export enum MenuSource {
  /** 系统默认菜谱（代码常量，PRD §16.4） */
  SYSTEM = 'SYSTEM',
  /** 家庭自定义菜谱（`menu_items.family_id` 非空） */
  FAMILY = 'FAMILY',
}

// ---------------------------------------------------------------
// 留个念
// ---------------------------------------------------------------

/** `family_memories.visibility` —— 注意与 ThingVisibility 语义不同 */
export enum MemoryVisibility {
  /** 家庭可见 */
  FAMILY = 1,
  /** 仅自己可见 */
  PRIVATE = 2,
}

/** `family_memories.status` */
export enum MemoryStatus {
  DELETED = 0,
  NORMAL = 1,
}

// ---------------------------------------------------------------
// 通知（详见 docs/08-wxpush推送集成方案.md）
// ---------------------------------------------------------------

/** `notification_logs.type` */
export enum NotifyType {
  TASK_ASSIGNED = 1,
  REMINDER = 2,
  TASK_DONE = 3,
  JOIN_FAMILY = 4,
  SYSTEM = 5,
}

/**
 * `notification_logs.channel` —— 发送渠道。
 *
 * V0.1 降级顺序：MP_TEMPLATE → SUBSCRIBE → IN_APP（永不失败）
 */
export enum NotifyChannel {
  /** 微信小程序订阅消息（一次性，1 授权 = 1 条） */
  SUBSCRIBE = 1,
  /** 站内消息 */
  IN_APP = 2,
  /** 公众号模板消息（wxpush，V0.1 验证期主力） */
  MP_TEMPLATE = 3,
}

/** `notification_logs.status` */
export enum NotifyStatus {
  PENDING = 1,
  SENT = 2,
  FAILED = 3,
  /** 无订阅额度，已跳过 */
  NO_QUOTA = 4,
  /** 未绑定微信提醒，已跳过 */
  NOT_BOUND = 5,
}

// ---------------------------------------------------------------
// 上传
// ---------------------------------------------------------------

/** 上传场景（docs/02 §8.1） */
export enum UploadScene {
  AVATAR = 'AVATAR',
  MEMORY = 'MEMORY',
  MENU = 'MENU',
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

/**
 * 把接口传来的字符串枚举转成数据库 TINYINT。
 * 只在 repository 层调用。
 */
export function enumToDb<T extends Record<string, string | number>>(
  enumObj: T,
  value: string,
): number | undefined {
  const v = (enumObj as Record<string, string | number>)[value];
  return typeof v === 'number' ? v : undefined;
}

/** 把数据库 TINYINT 转回接口要传的字符串枚举名。 */
export function dbToEnum<T extends Record<string, string | number>>(
  enumObj: T,
  value: number,
): string | undefined {
  const hit = Object.entries(enumObj).find(([, v]) => v === value);
  return hit?.[0];
}
