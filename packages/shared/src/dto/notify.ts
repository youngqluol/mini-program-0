/**
 * 通知相关的共享类型。
 *
 * 枚举统一放在 `enums.ts`，这里只放通知特有的 DTO 与文案。
 * 对应表：`notification_logs`（见 db/schema.sql）
 * 完整方案：docs/08-wxpush推送集成方案.md
 */

import { NotifyChannel, NotifyStatus, NotifyType } from '../enums';

// ---------------------------------------------------------------
// 送达结果：给「发起人」看的三档反馈（PRD 6.5.6）
// ---------------------------------------------------------------

/**
 * 发起人视角的送达结果。
 *
 * ⚠️ 必须分三档而不是两档：「有条件的成功」如果不讲清楚条件，
 *    发起人会以为对方已经收到了，反而制造误会。
 */
export enum DeliveryResult {
  /** 已下发到对方微信 */
  SENT = 'SENT',
  /** 有额度限制，已转为站内消息 */
  NO_QUOTA = 'NO_QUOTA',
  /** 对方还没绑定微信提醒 */
  NOT_BOUND = 'NOT_BOUND',
  /** 发送失败 */
  FAILED = 'FAILED',
}

/**
 * 送达结果对应的 toast 文案。
 * `{name}` 会被替换成接收人的家庭称谓（阿妈 / 阿爸 / 阿公 ...）。
 *
 * ⚠️ 文案纪律：禁止出现「逾期 / 超时 / 待办 / 催办 / 未完成」（PRD 31.3），
 *    也禁止出现机制词「绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号」
 *    （AGENTS.md §6）—— 用户只需要知道「微信提醒 开 / 关」。
 */
export const DELIVERY_TOAST: Record<DeliveryResult, string> = {
  [DeliveryResult.SENT]: '已经叮到{name}啦 🔔',
  [DeliveryResult.NO_QUOTA]: '已记下，{name}再开一次微信提醒就能收到',
  [DeliveryResult.NOT_BOUND]: '已记下，{name}还没开微信提醒，打开小程序就能看到',
  [DeliveryResult.FAILED]: '没叮成功，稍后再试',
};

/** 用家庭称谓替换文案占位符 */
export function formatDeliveryToast(result: DeliveryResult, roleName: string): string {
  return DELIVERY_TOAST[result].replace(/\{name\}/g, roleName);
}

// ---------------------------------------------------------------
// 通知内容
// ---------------------------------------------------------------

/** 一条待发送的通知 */
export interface NotifyPayload {
  type: NotifyType;
  /** 通知标题 */
  title: string;
  /** 通知正文（纯文本，站内消息直接展示） */
  content: string;
  /**
   * 公众号模板数据。字段名必须与公众号后台的模板**严格一致**，
   * 否则微信返回 47003。
   *
   * `null` 表示该通知类型**没有对应的公众号模板**（例如「加入家庭」），
   * 此时通道一会直接跳过、降级到订阅消息 / 站内消息 —— 这是正常路径。
   */
  templateData?: Record<string, { value: string }> | null;
}

/** 通知记录（`GET /notifications` 的返回项，docs/02 §9.1） */
export interface NotificationItem {
  id: number;
  /** 接口层传字符串，不传数字魔法值 */
  type: keyof typeof NotifyType;
  title: string;
  content: string;
  /** 实际使用的发送渠道 —— 前端据此告诉发起人「到底叮到了没有」 */
  channel: keyof typeof NotifyChannel;
  status: keyof typeof NotifyStatus;
  /** 关联小事 ID，点击可跳详情 */
  thingId: number | null;
  isRead: boolean;
  /** "YYYY-MM-DD HH:mm:ss"（北京时间） */
  createdAt: string;
}

// ---------------------------------------------------------------
// 微信提醒绑定（「我的 → 微信提醒」页）
// ---------------------------------------------------------------

/** 绑定状态（docs/02 §9.4） */
export interface MpBindStatus {
  /** 是否已绑定公众号提醒 */
  bound: boolean;
  /** 绑定时间 "YYYY-MM-DD HH:mm:ss"（北京时间） */
  boundAt?: string;
  /** 是否处于「等待用户发绑定码」的状态 */
  pending: boolean;
  /** 待使用的绑定码，仅 pending 时有值 */
  bindCode?: string;
  /** 绑定码过期时间 "YYYY-MM-DD HH:mm:ss"（北京时间） */
  bindCodeExpireAt?: string;
}

/** 绑定码长度 */
export const MP_BIND_CODE_LENGTH = 6;
