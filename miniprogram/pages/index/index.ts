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
 * 5. **隐私提示只做「首次进入主动提示」，不接管 `onNeedPrivacyAuthorization`。**
 *    微信自己有官方隐私弹窗兜底，接管只会多出一套要自己维护的边界逻辑。
 *    详细理由见 `checkPrivacy()` 的注释。
 *
 * ⚠️ **「未开微信提醒」提示条（M2-F3）本次不做。**
 *    docs/03 要求它出现在「**别人**没开微信提醒」时，但
 *    `GET /notify/mp-bind/status` 只回**我自己**的状态，
 *    后端没有「家庭成员谁开了」的接口 —— 这个条件现在算不出来。
 *    另外它要跳 P21 微信提醒页（M2-F1），那一页也还没做。
 *    与其挂一个点了没反应的条，不如先不挂。已记入 `docs/未来需求池.md`。
 *
 * ⚠️ 「留个念」那张卡片的副标题是**最新一条记录**（M4-11）。
 *    只取一条（`limit=1`）—— 首页不该为了一个副标题拉一整页时间线。
 *    拉不到时**保持**上一次的文案，不清空：副标题闪一下比显示旧内容更糟。
 */

import type { TodaySummary } from '@shared/dto/thing';
import * as memoryApi from '../../services/memory';
import * as thingApi from '../../services/thing';
import * as userStore from '../../stores/user';
import type { ThingCardItem, TodayRowView } from '../../utils/thing-view';
import { buildTodayReminderRow, fromTodayTask } from '../../utils/thing-view';
import { describeLatestMemory } from '../../utils/memory-view';
import { guardEntry } from '../../utils/route';
import { describeMonthDayWeek } from '../../utils/time';
import { toast, toastError } from '../../utils/toast';

/** 拉不到留念时的兜底文案（与 `describeLatestMemory(null)` 一致） */
const NO_MEMORY_YET = '还没有记录';

/**
 * 本次启动是否已经检查过隐私协议。
 *
 * 放**模块级**而不是 `data`：`data` 会随页面卸载重置，而这里要表达的是
 * 「本次启动内不再打扰」—— 用户拒绝过之后，每切一次 Tab 都弹一遍很糟。
 * 小程序启动时模块只求值一次，所以这个变量天然就是「每次启动一份」。
 */
let privacyChecked = false;

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

    /** 隐私提示弹窗是否显示（M5-5） */
    showPrivacy: false,
    /** 后台配置的那份指引的名称。微信返回时**自带书名号** */
    privacyContractName: '',
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
    void this.loadMemoryPreview();
    this.checkPrivacy();
  },

  /** 下拉刷新（docs/03 P01） */
  async onPullDownRefresh() {
    await Promise.all([this.load(), this.loadMemoryPreview()]);
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

  /**
   * 「留个念」最新一条（M4-11）。
   *
   * `limit: 1` + 后端按 id 倒序 = 最新那条。
   * 失败时**什么都不改**（见文件头）—— 一个副标题不值得弹 toast 打扰用户。
   */
  async loadMemoryPreview() {
    try {
      const res = await memoryApi.list({ familyId: this.data.familyId, limit: 1 });
      this.setData({ memoryPreview: describeLatestMemory(res.list[0] ?? null) });
    } catch {
      // 静默：副标题拉不到不该在首页弹提示
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

  // ---------------------------------------------------------------
  // 隐私协议提示（M5-5）
  // ---------------------------------------------------------------

  /**
   * 首次进入时主动提示隐私协议。
   *
   * **为什么做**（微信本身有官方弹窗兜底，不做也能跑）：
   *   官方弹窗只在**用户真正触发隐私接口**的那一刻才弹 —— 也就是他点
   *   「选图片」的时候。首次进来是看不到任何提示的，而提审自查清单里
   *   明确要求「首次进入有隐私协议弹窗」（docs/06 §八）。主动提示一次，
   *   用户才知道自己同意的是什么。
   *
   * **为什么不接管 `wx.onNeedPrivacyAuthorization`**：
   *   接管了就得自己实现一套弹窗、还要处理「多个隐私接口同时调用」这类边界。
   *   不接管时微信会自动弹官方弹窗兜底，效果一致、代码为零。
   *   所以这里只做「首次进入主动提示」，其余场景交给官方弹窗。
   *
   * **为什么放在 `guardEntry()` 之后**：被守卫踢走时页面会立刻卸载，
   *   而 `wx.getPrivacySetting` 是异步的 —— 回调回来再 `setData` 就打在了
   *   已卸载的页面上。登录 / 建家完成后回到首页会重新触发 `onShow`，
   *   那时再提示，路径不会断。
   */
  checkPrivacy() {
    if (privacyChecked) return;
    privacyChecked = true;

    wx.getPrivacySetting({
      success: (res) => {
        if (!res.needAuthorization) return;
        this.setData({
          showPrivacy: true,
          // 微信返回的名称自带书名号。取不到时兜一个，避免拼出
          // 「同意隐私保护指引」这种没有书名号的半句话（合规文案不能有歧义）
          privacyContractName: res.privacyContractName || '《隐私保护指引》',
        });
      },
      // 基础库 < 2.32.3 没有这个接口，fail 是预期内的：
      // 那种版本下微信的官方隐私弹窗照样兜底，静默即可，不打扰用户。
      fail: () => {},
    });
  },

  /** 用户点了「同意」—— 微信已在 `open-type` 里同步过状态，这里只需收起弹窗 */
  onAgreePrivacy() {
    this.setData({ showPrivacy: false });
  },

  /**
   * 点遮罩收起。
   *
   * 给用户一条退路：不同意也照样能用「家里」「吃啥呢」这些不碰隐私的功能。
   * 等他真要用相册时，微信的官方弹窗会再问一次。
   */
  onDismissPrivacy() {
    this.setData({ showPrivacy: false });
  },

  /** 打开后台配置的那份《用户隐私保护指引》 */
  onOpenPrivacy() {
    wx.openPrivacyContract({});
  },
});
