/**
 * P11 · 我的小事（M2-F10）
 *
 * 三个 Tab 回答三个不同的问题（docs/03 P11）：
 *
 *   | Tab      | scope            | status    | 在问什么 |
 *   | 派给我的 | ASSIGNED_TO_ME   | 待完成     | 我手上还有什么 |
 *   | 我派的   | MINE             | 待完成     | 我托出去的事办得怎么样了 |
 *   | 都完成   | ALL              | COMPLETED | 那些已经办完的，翻一翻 |
 *
 * 第一、二个 Tab 底下再给一个「待完成 / 全部」的筛子 —— 派出去的活，
 * 「全部」才看得到自己派过什么；只给「待完成」会让人以为派完就没了。
 * 第三个 Tab 已经锁死了 `status=COMPLETED`，所以那个筛子不显示。
 *
 * 三条实现判断：
 *
 * 1. **用 `onShow` 拉第一页，不用 `onLoad`。** 从 P10 详情页返回时列表必须刷新 ——
 *    用户刚在详情里点了「搞定啦」，回来还看到它挂在「待完成」就是 bug。
 *    代价：已经上拉加载了三页的，回来会收回到第一页。数据正确优先于位置保留。
 *
 * 2. **左滑露出的操作由 `utils/thing-view.ts` 的 `buildThingRowView()` 算，
 *    页面不判权限。** 与 P10 详情页同一套规则（执行人 / 发起人），
 *    只是形态不同：详情页给一个主操作，列表给一排短标签。
 *    权限算错的后果很具体 —— 点一下就是一次 403 toast。
 *
 * 3. **点开着的卡片 = 先收回去，不跳详情。** 这是用户对「已滑开的行」的
 *    默认预期；直接跳走会让人觉得点错了。
 *
 * 4. **`?tab=` 决定落在哪个 Tab。** P01 首页两个区块的「更多 ›」都跳这一页，
 *    只是要落在不同筛选上（提醒 → 派给我的；派活 → 我派的）。
 *    不读这个参数的话，两处「更多」会跳到同一个 Tab —— 用户会觉得
 *    「首页明明写着『最近的活』，怎么点进来是『派给我的』」。
 */

import type { ListThingsQuery } from '@shared/dto/thing';
import * as thingApi from '../../services/thing';
import * as userStore from '../../stores/user';
import type { ThingRowView } from '../../utils/thing-view';
import { buildThingRowView } from '../../utils/thing-view';
import { guardEntry } from '../../utils/route';
import { confirmSheet, toast, toastError, toastOk } from '../../utils/toast';

type TabKey = 'ASSIGNED_TO_ME' | 'MINE' | 'DONE';

interface TabOption {
  key: TabKey;
  label: string;
}

const TABS: TabOption[] = [
  { key: 'ASSIGNED_TO_ME', label: '派给我的' },
  { key: 'MINE', label: '我派的' },
  { key: 'DONE', label: '都完成' },
];

/** 第一、二个 Tab 底下的状态筛子。「全部」= 不传 status（后端语义：全部未取消） */
const STATUS_OPTIONS: Array<{ key: 'PENDING' | 'ALL'; label: string }> = [
  { key: 'PENDING', label: '待完成' },
  { key: 'ALL', label: '全部' },
];

const PAGE_SIZE = 20;

/** 每个 Tab 的空状态文案 —— 说清楚「为什么这里是空的」 */
const EMPTY_TEXT: Record<TabKey, { emoji: string; title: string; hint: string }> = {
  ASSIGNED_TO_ME: { emoji: '🌿', title: '手上没有活儿', hint: '家里人都很轻松' },
  MINE: { emoji: '📮', title: '你还没派过活', hint: '有事了，就派一个' },
  DONE: { emoji: '🗂️', title: '还没有办完的事', hint: '做完的会留在这里' },
};

Page({
  data: {
    familyId: 0,
    myMemberId: 0,

    tabs: TABS,
    tab: 'ASSIGNED_TO_ME' as TabKey,

    statusLabels: STATUS_OPTIONS.map((o) => o.label),
    statusIndex: 0,
    statusLabel: STATUS_OPTIONS[0].label,
    /** 第三个 Tab 自己锁死了状态，不需要再筛 */
    showStatusFilter: true,

    rows: [] as ThingRowView[],
    page: 0,
    hasMore: false,
    loading: false,
    /** 是否已经加载过至少一次 —— 用来区分「还没加载」和「加载完但是空的」 */
    loaded: false,

    /** 当前被滑开的那一行；0 表示都关着。受控给 swipe-cell */
    openId: 0,

    /** 有请求在路上：挡住重复点击 */
    acting: false,

    emptyEmoji: EMPTY_TEXT.ASSIGNED_TO_ME.emoji,
    emptyTitle: EMPTY_TEXT.ASSIGNED_TO_ME.title,
    emptyHint: EMPTY_TEXT.ASSIGNED_TO_ME.hint,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (!guardEntry()) return;
    const family = userStore.getCurrentFamily();
    if (!family) return;

    // 首页两个「更多 ›」都跳这里，靠 ?tab= 决定落在哪个 Tab。
    // 参数不认识就退回第一个 Tab —— 不能因为一个错链接白屏。
    const tab = TABS.some((t) => t.key === query.tab) ? (query.tab as TabKey) : TABS[0].key;
    const empty = EMPTY_TEXT[tab];

    this.setData({
      familyId: family.familyId,
      myMemberId: family.memberId,
      tab,
      showStatusFilter: tab !== 'DONE',
      emptyEmoji: empty.emoji,
      emptyTitle: empty.title,
      emptyHint: empty.hint,
    });
  },

  /** 每次显示都重拉第一页 —— 从详情页返回时列表必须反映刚才那次操作 */
  onShow() {
    if (!this.data.familyId) return;
    void this.reload();
  },

  /** 上拉加载下一页（docs/03 P11） */
  onReachBottom() {
    void this.loadMore();
  },

  // ---------------------------------------------------------------
  // 取数
  // ---------------------------------------------------------------

  buildQuery(page: number): ListThingsQuery {
    const query: ListThingsQuery = {
      familyId: this.data.familyId,
      page,
      pageSize: PAGE_SIZE,
    };

    if (this.data.tab === 'DONE') {
      query.scope = 'ALL';
      query.status = 'COMPLETED';
      return query;
    }

    query.scope = this.data.tab;
    const status = STATUS_OPTIONS[this.data.statusIndex].key;
    if (status !== 'ALL') query.status = status;
    return query;
  },

  async reload() {
    // 记下这次请求用的筛选条件：响应回来时对一下，不一致就说明它已经过期
    const tab = this.data.tab;
    const statusIndex = this.data.statusIndex;

    this.setData({ loading: true, openId: 0 });

    try {
      const res = await thingApi.list(this.buildQuery(1));
      if (this.isStale(tab, statusIndex)) return;
      this.setData({
        rows: res.list.map((item) => buildThingRowView(item, this.data.myMemberId)),
        page: 1,
        hasMore: res.hasMore,
        loading: false,
        loaded: true,
      });
    } catch (e) {
      if (this.isStale(tab, statusIndex)) return;
      this.setData({ loading: false, loaded: true });
      toastError(e);
    }
  },

  /**
   * 这次响应是不是已经过期了。
   *
   * 不判这一下，快速连点两个 Tab 时先发的那次可能后到 —— 结果就是
   * 「Tab 高亮着『都完成』，列表里却是『派给我的』」，而且没有任何报错。
   */
  isStale(tab: TabKey, statusIndex: number): boolean {
    return tab !== this.data.tab || statusIndex !== this.data.statusIndex;
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;

    const tab = this.data.tab;
    const statusIndex = this.data.statusIndex;
    const next = this.data.page + 1;

    this.setData({ loading: true });

    try {
      const res = await thingApi.list(this.buildQuery(next));
      // 过期，或者中间已经被一次 reload 接上了（那就不该再往后拼）
      if (this.isStale(tab, statusIndex) || this.data.page !== next - 1) return;
      const more = res.list.map((item) => buildThingRowView(item, this.data.myMemberId));
      this.setData({
        rows: this.data.rows.concat(more),
        page: next,
        hasMore: res.hasMore,
        loading: false,
      });
    } catch (e) {
      if (this.isStale(tab, statusIndex)) return;
      this.setData({ loading: false });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 筛选
  // ---------------------------------------------------------------

  onPickTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as TabKey;
    if (tab === this.data.tab) return;

    const empty = EMPTY_TEXT[tab];
    this.setData({
      tab,
      showStatusFilter: tab !== 'DONE',
      emptyEmoji: empty.emoji,
      emptyTitle: empty.title,
      emptyHint: empty.hint,
    });
    void this.reload();
  },

  onStatusChange(e: WechatMiniprogram.PickerChange) {
    const statusIndex = Number(e.detail.value);
    this.setData({
      statusIndex,
      statusLabel: STATUS_OPTIONS[statusIndex].label,
    });
    void this.reload();
  },

  // ---------------------------------------------------------------
  // 行交互
  // ---------------------------------------------------------------

  onRowOpen(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    this.setData({ openId: e.detail.id });
  },

  onRowClose(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    // 只有「当前开着的那一行」收回去时才清空，避免把刚滑开的另一行也关掉
    if (this.data.openId === e.detail.id) this.setData({ openId: 0 });
  },

  /** 点卡片：开着就先收回去；关着才跳详情 */
  onRowClick(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    const id = e.detail.id;
    if (this.data.openId === id) {
      this.setData({ openId: 0 });
      return;
    }
    wx.navigateTo({ url: `/pages/thing/detail?id=${id}` });
  },

  async onRowAction(e: WechatMiniprogram.CustomEvent<{ key: string; id: number }>) {
    if (this.data.acting) return;

    const { key, id } = e.detail;
    this.setData({ openId: 0 });

    if (key === 'COMPLETE') {
      await this.complete(id);
      return;
    }
    if (key === 'CANCEL') {
      await this.cancel(id);
      return;
    }
    if (key === 'REOPEN') {
      await this.reopen(id);
    }
  },

  // ---------------------------------------------------------------
  // 三个动作（与 P10 详情页同一套接口与文案）
  // ---------------------------------------------------------------

  async complete(id: number) {
    this.setData({ acting: true });
    try {
      await thingApi.complete(id);
      await this.reload();
      toastOk('搞定啦');
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  async cancel(id: number) {
    const ok = await confirmSheet({
      message: '取消后还能重新打开，记录都会留着',
      actionText: '确认取消',
    });
    if (!ok) return;

    this.setData({ acting: true });
    try {
      await thingApi.cancel(id);
      await this.reload();
      toast('已经取消啦，记录还留着');
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  async reopen(id: number) {
    this.setData({ acting: true });
    try {
      await thingApi.reopen(id);
      await this.reload();
      toast('又打开啦，接着弄');
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },
});
