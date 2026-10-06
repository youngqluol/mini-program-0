/**
 * P12 · 消息中心（M2-F13）
 *
 * 入口：「我的」Tab → 消息与提醒 → 消息中心（行上带未读数）。
 *
 * 未读数还会以角标形式挂在底部「我的」Tab 上 —— 那件事在 P20 的 `onShow` 里做
 * （`utils/tab-badge.ts`），不在这一页。
 *
 * 这一页是「三层兜底」的最后一道（PRD 6.5.2）：所有通知**无条件**写进这里、
 * 永不失败。所以它宁可朴素也不能缺 —— 微信没响、人也没问，
 * 至少打开小程序还看得到。
 *
 * 四条刻意的判断：
 *
 * 1. **不带 `familyId`。** 消息中心是**跨家庭**的统一收件箱：同一个人可能在
 *    「我们家」和「爸妈家」里都有事。后端三个接口也都只认 userId
 *    （`notifications.controller.ts` 顶部写明了理由）。
 *
 * 2. **送达说明只在「没推到微信」时才显示**（判据在 `utils/notice-view.ts`）。
 *    推到微信的不显示 —— 微信已经响过了，再说一句「已发到微信」是废话。
 *
 * 3. **「全部已读」之后就地改本地状态，不整页重拉。** 项目常规纪律是
 *    「动作之后重拉」（完成一件小事会连带取消它下面所有提醒），但已读
 *    **没有任何连带副作用**，重拉只会让列表闪一下、还可能把刚加载的
 *    第三页收回第一页。这是那条纪律的例外，理由记在这里。
 *
 * 4. **点开一条不会把它变成已读。** 后端没有「单条已读」接口
 *    （docs/02 §9 只有 `read-all`），本地置灰只会让用户下次进来发现
 *    「怎么又未读了」。宁可如实显示 —— 缺口已记入 `docs/未来需求池.md`。
 */

import * as notifyApi from '../../services/notify';
import type { NoticeView } from '../../utils/notice-view';
import { buildNoticeView } from '../../utils/notice-view';
import { guardEntry } from '../../utils/route';
import { toast, toastError } from '../../utils/toast';

const PAGE_SIZE = 20;

Page({
  data: {
    rows: [] as NoticeView[],
    unreadCount: 0,

    page: 0,
    hasMore: false,
    loading: false,
    /** 区分「还没加载」与「加载完但是空的」—— 首屏不能闪一下空状态 */
    loaded: false,

    /** 有请求在路上：挡住重复点「全部已读」 */
    acting: false,
  },

  /**
   * 用 `onShow` 拉第一页：从 P10 详情页返回时要反映刚才的跳转。
   *
   * 守卫用 `guardEntry()`（要求有家庭）而不是「只要求登录」：消息中心本身
   * 是用户维度的、不需要家庭，但 V0.1 的入口在「我的」Tab，能走到这儿的用户
   * 必然有家庭 —— 不为了一个现在不可能出现的分支新增一个守卫函数。
   */
  onShow() {
    if (!guardEntry()) return;
    void this.reload();
  },

  /** 上拉加载下一页 */
  onReachBottom() {
    void this.loadMore();
  },

  // ---------------------------------------------------------------
  // 取数
  // ---------------------------------------------------------------

  async reload() {
    this.setData({ loading: true });
    try {
      const res = await notifyApi.listNotifications({ page: 1, pageSize: PAGE_SIZE });
      this.setData({
        rows: res.list.map(buildNoticeView),
        unreadCount: res.unreadCount,
        page: 1,
        hasMore: res.hasMore,
        loading: false,
        loaded: true,
      });
    } catch (e) {
      this.setData({ loading: false, loaded: true });
      toastError(e);
    }
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;

    const next = this.data.page + 1;
    this.setData({ loading: true });

    try {
      const res = await notifyApi.listNotifications({ page: next, pageSize: PAGE_SIZE });
      this.setData({
        rows: this.data.rows.concat(res.list.map(buildNoticeView)),
        // 列表顺带返回 unreadCount，不用再打一次角标接口
        unreadCount: res.unreadCount,
        page: next,
        hasMore: res.hasMore,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 交互
  // ---------------------------------------------------------------

  /** 点条目 → 跳对应小事。没有关联小事的（加入家庭 / 系统通知）不跳 */
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const row = this.data.rows[Number(e.currentTarget.dataset.index)];
    if (!row || row.thingId == null) return;
    wx.navigateTo({ url: `/pages/thing/detail?id=${row.thingId}` });
  },

  async onReadAll() {
    if (this.data.acting || this.data.unreadCount === 0) return;

    this.setData({ acting: true });
    try {
      await notifyApi.readAll();
    } catch (e) {
      this.setData({ acting: false });
      toastError(e);
      return;
    }

    // 已读没有连带副作用，就地清掉即可 —— 不重拉（理由见文件头第 3 条）
    this.setData({
      acting: false,
      unreadCount: 0,
      rows: this.data.rows.map((r) => ({ ...r, isRead: true })),
    });
    toast('都看过啦');
  },
});
