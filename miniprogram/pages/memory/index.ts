/**
 * P03 · 留个念（Tab 3）
 *
 * 一家人的私人时间线（PRD §18.1：**不是朋友圈**）。
 *
 * 四条刻意的判断：
 *
 * 1. **用 `onShow` 拉第一页。** 从 P18 发布页返回时必须刷新 ——
 *    刚发的那条没出现在时间线上，用户会以为没发出去，然后再发一遍。
 *    代价：已经上拉加载了三页的，回来会收回到第一页（与 P11 同一条取舍，
 *    数据正确优先于位置保留）。
 *
 * 2. **分组在「加载更多」时要合并边界那一天**（`appendGroups`）。
 *    分页会把同一天拆到两页，直接追加会出现两个「2026.09.26」。
 *
 * 3. **「完成纪念」与「独立留念」在时间线上不做视觉区分**（PRD §19.3）。
 *    一旦区分，时间线就滑向「任务日志」。关联只在 P19 详情页底部
 *    用一行极淡的字说一次。
 *
 * 4. **「···」只在自己的记录上出现。** 判断用后端给的 `isMine`，
 *    不在前端拿 `creator.memberId` 与自己的比 —— 后者要在每个页面
 *    先取一次「我的身份」，多家庭切换时还容易比错人。
 *
 * ⚠️ 时间线**不做**「未读 / 新消息」这类东西。它是相册，不是收件箱。
 */

import * as memoryApi from '../../services/memory';
import * as userStore from '../../stores/user';
import type { MemoryDayGroup } from '../../utils/memory-view';
import { appendGroups, emptyTimelineHint, groupByDay } from '../../utils/memory-view';
import { guardEntry } from '../../utils/route';
import { toastError, toastOk } from '../../utils/toast';

/** 每页条数。与后端默认一致 */
const PAGE_SIZE = 20;

Page({
  data: {
    familyId: 0,

    loading: true,
    /** 首屏加载完了（不管有没有数据）—— 空状态与骨架屏的分界 */
    loaded: false,
    /** 正在加载下一页 */
    loadingMore: false,

    groups: [] as MemoryDayGroup[],
    hasMore: false,
    /** 下一页游标 = 已加载的最后一条 id。`0` 表示从头开始 */
    cursor: 0,

    emptyHint: emptyTimelineHint(),
  },

  onShow() {
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    if (!family) return;

    this.setData({ familyId: family.familyId });
    void this.reload();
  },

  /** 下拉刷新（docs/03 P03） */
  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  /** 上拉加载更多（docs/03 P03） */
  async onReachBottom() {
    await this.loadMore();
  },

  // ---------------------------------------------------------------
  // 取数
  // ---------------------------------------------------------------

  /** 从头拉第一页。每次 `onShow` 都走这里 —— 见文件头 ① */
  async reload() {
    try {
      const res = await memoryApi.list({ familyId: this.data.familyId, limit: PAGE_SIZE });
      this.setData({
        loading: false,
        loaded: true,
        groups: groupByDay(res.list),
        hasMore: res.hasMore,
        cursor: res.nextCursor ?? 0,
      });
    } catch (e) {
      this.setData({ loading: false, loaded: true });
      toastError(e);
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || !this.data.cursor) return;

    this.setData({ loadingMore: true });
    try {
      const res = await memoryApi.list({
        familyId: this.data.familyId,
        cursor: this.data.cursor,
        limit: PAGE_SIZE,
      });
      this.setData({
        groups: appendGroups(this.data.groups, groupByDay(res.list)),
        hasMore: res.hasMore,
        cursor: res.nextCursor ?? 0,
        loadingMore: false,
      });
    } catch (e) {
      this.setData({ loadingMore: false });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 交互
  // ---------------------------------------------------------------

  /** 点卡片 → P19 详情 */
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    if (!id) return;
    wx.navigateTo({ url: `/pages/memory/detail?id=${id}` });
  },

  /** 点九宫格里的一张 → 全屏预览，可以左右滑 */
  onPreview(e: WechatMiniprogram.TouchEvent) {
    const urls = (e.currentTarget.dataset.urls as string[]) || [];
    const index = Number(e.currentTarget.dataset.index) || 0;
    if (urls.length === 0) return;
    wx.previewImage({ urls, current: urls[index] });
  },

  /** 记一件 —— P18 */
  onCreate() {
    wx.navigateTo({ url: '/pages/memory/create' });
  },

  /** 自己那条记录右上角的「···」 */
  onMore(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    if (!id) return;

    wx.showActionSheet({
      itemList: ['改一改', '删掉'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/memory/detail?id=${id}&edit=1` });
        } else if (res.tapIndex === 1) {
          void this.remove(id);
        }
      },
      // 点「取消」或点遮罩都走 fail —— 都是「不继续」，不是错误
      fail: () => undefined,
    });
  },

  async remove(id: number) {
    const yes = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删掉这条？',
        content: '删了就翻不到了，家里其他人也看不到了。',
        confirmText: '删掉',
        cancelText: '再想想',
        confirmColor: '#F2637B',
        success: (r) => resolve(Boolean(r.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!yes) return;

    try {
      await memoryApi.remove(id);
      toastOk('删掉啦');
      await this.reload();
    } catch (e) {
      toastError(e);
    }
  },
});
