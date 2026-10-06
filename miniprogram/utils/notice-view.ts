/**
 * 通知 → 列表行的展示模型（P12 消息中心）
 *
 * 与 `thing-view.ts` 同源的理由：页面只负责「取数据 → setData → 绑事件」，
 * 「后端字段怎么变成界面上的字」全收在这一层的纯函数里 —— 好处是**可断言**。
 *
 * 这一层最容易出的错不是崩，而是**说错话**：
 *   · 渠道文案的视角搞反 —— 消息中心是收件箱，说的是「我为什么没收到」，
 *     不是「对方收到了没有」；
 *   · 只看 `status` 不看 `channel` —— 会把「只写进了站内」说成「已发到微信」；
 *   · 时间不写「今天」—— 列表里相邻两条可能跨天，只写「17:30」没法定位。
 * 这三条都在 `tools/test-view.mjs` 里有断言。
 */

import type { NotificationItem } from '@shared/dto/notify';
import {
  NOTICE_DELIVERY_TEXT,
  NOTICE_FALLBACK_META,
  NOTICE_TYPE_META,
  WECHAT_CHANNELS,
  type NoticeTypeMeta,
} from '../constants/notice';
import { describeMoment } from './time';

export interface NoticeView {
  id: number;
  /** 列表左侧的类型 emoji */
  emoji: string;
  /** 类型名（叮一下 / 派活 / 搞定了 …） */
  typeLabel: string;
  /**
   * 一句话摘要。
   *
   * 后端保证它带上了「是什么事」（见 `notify.templates.ts` 的 `withWhat`）——
   * 否则列表里每一条都长一样，用户只能挨个点进去看。
   */
  title: string;
  /** `今天 17:30` / `昨天 18:05` / `09-20 10:00` */
  timeText: string;
  isRead: boolean;
  /** 关联小事；**null = 这条点不动**（「加入家庭」「系统通知」都没有关联小事） */
  thingId: number | null;
  /** 送达说明；**空串表示正常推到微信了**，页面据此不显示标签 */
  deliveryText: string;
}

/**
 * 一行通知。
 *
 * 刻意**不把 `content` 放进视图**：它是多行正文（「阿妈，有个活儿到你啦～\n
 * 事项：买酱油\n…」），列表放不下，而 `title` 已经是一句完整的话。
 * 等哪天做了「通知详情页」再把 content 取出来 —— 现在放进视图只是死字段。
 */
export function buildNoticeView(item: NotificationItem): NoticeView {
  // 类型系统说 `item.type` 一定是那 5 个之一，但后端可能先加了新类型而
  // 小程序还没发版 —— 那时 `NOTICE_TYPE_META[type]` 是 undefined，
  // 不兜底就会把 `undefined` 渲染到界面上。
  const meta: NoticeTypeMeta | undefined = NOTICE_TYPE_META[item.type];
  const typeMeta = meta ?? NOTICE_FALLBACK_META;

  return {
    id: item.id,
    emoji: typeMeta.emoji,
    typeLabel: typeMeta.label,
    title: item.title,
    timeText: describeMoment(item.createdAt),
    isRead: item.isRead,
    thingId: item.thingId,
    deliveryText: deliveryTextOf(item),
  };
}

/**
 * 「这条是怎么送到我这儿的」。
 *
 * 返回**空串 = 真的推到微信了**，不用多说 —— 页面据此不显示标签。
 * 只在没推到微信时才给一句话，因为那才是用户会疑惑的场景（「怎么没响？」）。
 */
function deliveryTextOf(item: NotificationItem): string {
  if (item.status === 'SENT' && WECHAT_CHANNELS.includes(item.channel)) return '';
  return NOTICE_DELIVERY_TEXT[item.status] ?? '只在小程序里';
}
