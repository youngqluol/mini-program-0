/**
 * P10 · 小事详情（M2-F9）
 *
 * 一屏说清「这是谁的事、什么时候、要不要提醒、谁能看见」，
 * 底部只给**当前这个人此刻真能做的**那一个主操作。
 *
 * 四条刻意的判断：
 *
 * 1. **按角色决定主操作，而不是一律给「搞定啦」**（docs/03 P10）。
 *    不是执行人却看到一个能按的「搞定啦」，按下去只会吃一次 403；
 *    与其让用户撞一次墙，不如一开始就不给这个按钮 ——
 *    所以旁观者看到的是置灰的状态条，不是灰按钮。
 *    判断逻辑全在 `utils/thing-view.ts` 的 `buildThingDetailView()` 里（纯函数）。
 *
 * 2. **每个动作之后整页重拉，而不是就地打补丁。**
 *    完成一件小事会连带取消它下面所有未发出的提醒。只改本地 `status`
 *    会让「🔔 明天 17:30 提醒阿爸」留在一件已经做完的事上 ——
 *    这种自相矛盾比多一次请求贵得多。
 *
 * 3. **主操作槽位满宽，次操作放到下面一行。**
 *    docs/03 的草图把「取消」摆在「搞定啦」右边。实机上不行：
 *    一是「已完成 · 18:05 由阿爸完成」这种长文案会和按钮抢宽度，
 *    二是破坏性动作紧挨主按钮容易误点。改成上下两行后，
 *    文案再长也不会挤，误点概率也降下来。
 *
 * 4. **toast 只说状态条说不出来的事。**
 *    「搞定啦」按下去以后状态条已经变成「已完成 · 18:05 由阿爸完成」了，
 *    再弹一句「搞定啦」是重复。只有「顺手生成了下一次」这种状态条
 *    表达不了的信息，才值得再弹一下。
 *
 * ⚠️ 「我」是谁取自 `userStore.getCurrentFamily().memberId`。
 *    V0.1 只有一个家庭，够了；V0.2 开放家庭切换后，
 *    得先确认这条小事属于哪个家庭，再取那个家庭里的 memberId。
 */

import type { ThingDetail } from '@shared/dto/thing';
import * as thingApi from '../../services/thing';
import * as userStore from '../../stores/user';
import { guardEntry } from '../../utils/route';
import { buildThingDetailView, type DetailMainTone } from '../../utils/thing-view';
import { confirmSheet, toast, toastError } from '../../utils/toast';

Page({
  data: {
    thingId: 0,
    detail: null as ThingDetail | null,
    loading: true,

    typeEmoji: '',
    typeLabel: '',
    title: '',
    peopleText: '',
    dueText: '',
    reminderText: '',
    content: '',
    visibilityText: '',

    mainTone: 'idle' as DetailMainTone,
    mainText: '',
    subAction: '' as '' | 'CANCEL' | 'REOPEN',

    /** 有请求在路上：挡住重复点击 */
    acting: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (!guardEntry()) return;

    const thingId = Number(query.id);
    if (!thingId) {
      toast('没找到这件事');
      wx.navigateBack();
      return;
    }

    this.setData({ thingId });
    void this.load();
  },

  async load() {
    try {
      const detail = await thingApi.detail(this.data.thingId);
      const family = userStore.getCurrentFamily();
      const view = buildThingDetailView(detail, family ? family.memberId : 0);
      this.setData({ detail, loading: false, ...view });
    } catch (e) {
      this.setData({ loading: false, detail: null });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 三个动作
  // ---------------------------------------------------------------

  async onComplete() {
    if (this.data.acting || this.data.mainTone !== 'primary') return;

    this.setData({ acting: true });
    try {
      const res = await thingApi.complete(this.data.thingId);
      await this.load();
      // 状态条已经说了「已完成」，只在它说不出来的事上再补一句
      if (res.nextThingId) toast('搞定啦，下一次的也记好了');
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  async onCancel() {
    if (this.data.acting || this.data.subAction !== 'CANCEL') return;

    const ok = await confirmSheet({
      message: '取消后还能重新打开，记录都会留着',
      actionText: '确认取消',
    });
    if (!ok) return;

    this.setData({ acting: true });
    try {
      await thingApi.cancel(this.data.thingId);
      await this.load();
      toast('已经取消啦，记录还留着');
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  async onReopen() {
    if (this.data.acting || this.data.subAction !== 'REOPEN') return;

    this.setData({ acting: true });
    try {
      await thingApi.reopen(this.data.thingId);
      await this.load();
      toast('又打开啦，接着弄');
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  /**
   * 「📖 记个念 →」（PRD §19.2）。
   *
   * 把 `thingId` 与**标题**一起带过去：P18 要用标题做预填正文
   * （「买牛奶 搞定啦」）和顶部那行「来自 🎯 买牛奶」。
   * 标题走 URL 参数而不是让 P18 再查一次接口 —— 这一页手里本来就有，
   * 而多一次请求就多一次「查不到标题时那行标注显示什么」的分支。
   *
   * ⚠️ 标题要 `encodeURIComponent`：菜名/活名里可能有 `&`、`#`、空格，
   *    不编码会把 URL 拆坏（`?thingTitle=买&牛奶` → 后半截丢了）。
   */
  onMemory() {
    const title = encodeURIComponent(this.data.title || '');
    wx.navigateTo({ url: `/pages/memory/create?thingId=${this.data.thingId}&thingTitle=${title}` });
  },
});
