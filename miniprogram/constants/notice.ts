/**
 * 通知的展示元数据（类型 emoji / 类型名 / 送达说明）
 *
 * 与 `constants/thing.ts` 同源的理由：同一个「🔔 叮一下」在消息中心、
 * P10 详情、以后的「我的」Tab 角标都会出现，散落几份就会漂移成
 * 「叮一下 / 提醒 / 叮」。**唯一来源放这里。**
 *
 * ⚠️ `Record<NotificationItem['type'], …>` 会强制把 5 个键写全 ——
 *    后端加了新类型而这里忘了补，`tsc` 直接报错，不需要额外的校验脚本。
 *
 * ⚠️ 文案纪律（AGENTS.md §6）：这里的每一个字都会出现在用户眼前。
 *    机制词「绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号」
 *    一个都不能有。
 */

import type { NotificationItem } from '@shared/dto/notify';

export interface NoticeTypeMeta {
  /** 列表左侧的类型 emoji */
  emoji: string;
  /** 类型名。列表里不单独显示（emoji 已经表达），留给无障碍与将来的筛选用 */
  label: string;
}

export const NOTICE_TYPE_META: Record<NotificationItem['type'], NoticeTypeMeta> = {
  TASK_ASSIGNED: { emoji: '🎯', label: '派活' },
  REMINDER: { emoji: '🔔', label: '叮一下' },
  TASK_DONE: { emoji: '❤️', label: '搞定了' },
  JOIN_FAMILY: { emoji: '🏠', label: '家庭' },
  SYSTEM: { emoji: '📢', label: '通知' },
};

/** 类型 emoji 取不到时的兜底 —— 绝不把 `undefined` 渲染出来 */
export const NOTICE_FALLBACK_META: NoticeTypeMeta = { emoji: '📢', label: '通知' };

/**
 * 「这条为什么没在微信里收到」。
 *
 * ⚠️ **只在没能发到微信时才显示。** 正常推到微信的不显示 ——
 *    微信已经响过了，再说一句「已发到微信」是废话。
 *
 * ⚠️ **视角是收件人**：消息中心是**收件箱**，里面的每一条都是发给「我」的。
 *    所以这里回答的是「我为什么没在微信里收到」，
 *    而不是「对方收到了没有」—— 后者是**发起人**关心的事，
 *    它的出口在 P08 的三档 toast（`@shared/dto/notify` 的 `DELIVERY_TOAST`）。
 *
 * ⚠️ 说「只在小程序里」而不是「仅站内」：`站内` 是机制词。
 *    也不用「没推到微信」这种被动语态 —— 用户不知道是谁在推。
 */
export const NOTICE_DELIVERY_TEXT: Record<NotificationItem['status'], string> = {
  /** 走到这里说明渠道不是微信（见 `WECHAT_CHANNELS`）—— 只写了站内 */
  SENT: '只在小程序里',
  /** 落库后进程挂了留下的幽灵记录；补偿任务会把它收尾成 FAILED */
  PENDING: '发送中',
  /** 所有通道都失败 */
  FAILED: '没发出去',
  /** 微信提醒的额度用完了，这次降级到站内 */
  NO_QUOTA: '没发到微信',
  /** 收件人自己还没开微信提醒 —— 说清原因，不做「去哪开」的承诺（P21 还没做） */
  NOT_BOUND: '还没开微信提醒',
};

/**
 * 算「真的推到微信了」的渠道。
 *
 * 判据必须**同时看 channel 和 status**：`SENT` 只说明「这次发送成功了」，
 * 而 `IN_APP` 的 `SENT` 意思是「只写进了站内」。
 * 只看 status 会把「只在小程序里」说成「已发到微信」—— 一句安静的假话。
 */
export const WECHAT_CHANNELS: ReadonlyArray<NotificationItem['channel']> = [
  'MP_TEMPLATE',
  'SUBSCRIBE',
];
