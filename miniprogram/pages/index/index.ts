/**
 * P01 · 家里（Tab 1）
 *
 * 页面只回答一个问题：**今天家里有什么事**（docs/03 P01）。
 * 首页不承担通知归档（消息中心在「我的」Tab），也不做家庭管理入口。
 *
 * 四条刻意的判断：
 *
 * 1. **用 `onShow` 拉数据，不用 `onLoad`。** 从 P08 / P09 / P10 返回时都要刷新 ——
 *    刚派出去的活没出现在首页，或者刚做完的事还挂在「待完成」，
 *    都会被当成 bug（而且很难复现，因为只在「返回」这条路上出现）。
 *
 * 2. **接口给的 `stats.overdue`（过期未完成数）刻意不显示。**
 *    「今天有 2 件事已经过了时间」是一句催办话 —— AGENTS.md §6 的禁用词
 *    里就有「逾期」。单条小事上那个变红的时间是**信息**（这件事本来定在几点），
 *    聚合成一个数字挂出来就变成**监督**了。产品纪律是「只提醒，不监督」。
 *
 * 3. **骨架屏不用转圈**（docs/03 P01 状态）。转圈只说明「在忙」，
 *    骨架块还能顺带说明「马上会出来什么形状的东西」。
 *
 * 4. **两个区块标题不用 emoji。** docs/03 的草图里写了 🔔 / 🎯，但
 *    docs/07 与 `app.wxss` 的 `.section-title` 明确约定「粉色小竖条，不用 emoji」——
 *    草图上的 emoji 是速记，不是设计。卡片自己已经有类型 emoji 了。
 *
 * ⚠️ **「未开微信提醒」提示条（M2-F3）本次不做。**
 *    docs/03 要求它出现在「**别人**没开微信提醒」时，但
 *    `GET /notify/mp-bind/status` 只回**我自己**的状态，
 *    后端没有「家庭成员谁开了」的接口 —— 这个条件现在算不出来。
 *    另外它要跳 P21 微信提醒页（M2-F1），那一页也还没做。
 *    与其挂一个点了没反应的条，不如先不挂。已记入 `docs/未来需求池.md`。
 *
 * ⚠️ 「留个念」那张卡片现在只能显示占位文案 —— 留念模块（M4）还没有接口。
 */

import type { TodaySummary } from '@shared/dto/thing';
import * as thingApi from '../../services/thing';
import * as userStore from '../../stores/user';
import type { ThingCardItem, TodayRowView } from '../../utils/thing-view';
import { buildTodayReminderRow, fromTodayTask } from '../../utils/thing-view';
import { guardEntry } from '../../utils/route';
import { describeMonthDayWeek } from '../../utils/time';
import { toast, toastError } from '../../utils/toast';

/** 留念模块（M4）还没做，这里先说实话 */
const NO_MEMORY_YET = '还没有记录';

Page({
  data: {
    familyId: 0,
    myMemberId: 0,
    familyName: '',
    dateLine: '今天家里有什么小事？',

    loading: true,
    /** 今天确实一件小事都没有 —— 显示引导，而不是两个空区块 */
    quiet: false,

    reminderRows: [] as TodayRowView[],
    taskRows: [] as ThingCardItem[],

    memoryPreview: NO_MEMORY_YET,
  },

  onShow() {
    // 启动路由守卫（M1-F5）：没登录 → P04；没家庭 → P05 引导页。
    // 被拦下时不再渲染本页内容。
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    if (!family) return;

    this.setData({
      familyId: family.familyId,
      myMemberId: family.memberId,
      familyName: family.familyName,
    });
    void this.load();
  },

  /** 下拉刷新（docs/03 P01） */
  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    try {
      const summary = await thingApi.today(this.data.familyId);
      this.apply(summary);
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
  },

  apply(summary: TodaySummary) {
    const dateLine = describeMonthDayWeek(summary.date);

    this.setData({
      loading: false,
      dateLine: dateLine ? `${dateLine} · 今天家里有什么小事？` : '今天家里有什么小事？',
      quiet: summary.reminders.length === 0 && summary.tasks.length === 0,
      reminderRows: summary.reminders.map((r) => buildTodayReminderRow(r, this.data.myMemberId)),
      taskRows: summary.tasks.map(fromTodayTask),
    });
  },

  // ---------------------------------------------------------------
  // 跳转
  // ---------------------------------------------------------------

  /** 🔔 叮一下 —— P08 */
  onNudge() {
    wx.navigateTo({ url: '/pages/nudge/create' });
  },

  /** 🎯 派个活 —— P09 */
  onAssign() {
    wx.navigateTo({ url: '/pages/task/create' });
  },

  /** 两个「更多」都进「我的小事」，只是落在不同筛选上 */
  onMoreReminders() {
    wx.navigateTo({ url: '/pages/thing/mine?tab=ASSIGNED_TO_ME' });
  },

  onMoreTasks() {
    wx.navigateTo({ url: '/pages/thing/mine?tab=MINE' });
  },

  /** 吃啥呢是 Tab 页，只能 switchTab（navigateTo 跳不过去） */
  onMenu() {
    wx.switchTab({ url: '/pages/menu/index' });
  },

  onMemory() {
    wx.switchTab({ url: '/pages/memory/index' });
  },

  onOpenThing(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    wx.navigateTo({ url: `/pages/thing/detail?id=${e.detail.id}` });
  },

  // ---------------------------------------------------------------
  // 快速完成（docs/03 P01：提醒条目右侧 ✓）
  // ---------------------------------------------------------------

  async onCompleteReminder(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const id = e.detail.id;
    const index = this.data.reminderRows.findIndex((row) => row.id === id);
    // 不是执行人的行压根没有那个圈，走到这里说明数据对不上，直接不管
    if (index < 0 || !this.data.reminderRows[index].canCheck) return;

    // 先就地置灰再重拉：网络慢的时候，这一下是「点上了」和「点不动」的区别
    this.setData({ [`reminderRows[${index}].card.done`]: true });

    try {
      await thingApi.complete(id);
      await this.load();
    } catch (e) {
      // 失败就把灰改回来，别让界面停在一个没发生过的状态上
      this.setData({ [`reminderRows[${index}].card.done`]: false });
      toastError(e);
      return;
    }

    toast('搞定啦');
  },
});
