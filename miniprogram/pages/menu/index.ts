/**
 * P02 · 吃啥呢（Tab 2）
 *
 * 只回答一个问题：**今天吃什么**。决定完，可以顺手派个活。
 *
 * 五条刻意的判断：
 *
 * 1. **只在 `onLoad` 随机一次，不在 `onShow`。** Tab 页切走再切回来不会重建，
 *    所以 `onLoad` 只跑一次 —— 这正是我们要的：用户挑到一半去看了眼「家里」，
 *    回来不该发现菜换了。而「最近吃过」要在 `onShow` 刷新（可能刚在别处记了一餐）。
 *
 * 2. **`mealType` 由当前时刻推断**（`inferMealType`），不写死 `DINNER`。
 *    后端的「一荤一素一汤」只在晚餐时凑（docs/02 §6.1），而且这一餐会记进
 *    `meal_records` —— 早上打开却记成晚饭，会让「最近吃过」乱掉。
 *
 * 3. **确认层是自己写的底部面板，不是 `wx.showActionSheet`。**
 *    后者最多 6 个选项，家里人多一点就选不全；而且它没法在选项上方
 *    排一栏「这一餐是什么」。面板里也**不写「今晚吃：…」这句话** ——
 *    那句话由后端在 `POST /menu/decide` 的响应里给（`summary`），
 *    前端自己拼的话，两处措辞迟早不一致。
 *
 * 4. **空池子（一条菜谱都没有）是一个单独的形态**，不是「列表为空」。
 *    `poolSize === 0` 说明系统菜谱 + 家庭菜谱都被排除光了（或真的没有），
 *    这时给的是「去添加」的引导，而不是一张写着「？」的卡片。
 *
 * 5. **「换一个」有一个最短动画时长。** 本地库很快，请求 30ms 就回来了 ——
 *    卡片会「闪一下」而不是「翻一下」。所以刻意等一个最短时间，
 *    让动画看得见（这是**感知**问题，不是性能问题）。
 *
 * ⚠️ 「就吃这个」派活成功后**不自动跳详情**（docs/03 说「可选」）：
 *    用户刚决定吃什么，把他甩到另一个页面是打断。toast 说清楚了就够了，
 *    想看细节去首页点。
 */

import type { FamilyMember } from '@shared/dto/family';
import type { MealItemInput, MealTypeValue } from '@shared/dto/menu';
import * as familyApi from '../../services/family';
import * as menuApi from '../../services/menu';
import * as userStore from '../../stores/user';
import type { AssignChoice, DishCardView, RecentMealRow } from '../../utils/menu-view';
import {
  assignDoneToast,
  buildAssignChoices,
  buildDishCards,
  buildRecentMealRow,
  inferMealType,
} from '../../utils/menu-view';
import { guardEntry } from '../../utils/route';
import { toast, toastError } from '../../utils/toast';

/** 一次抽几道菜（docs/03 P02：晚餐尽量凑「一荤一素一汤」） */
const RANDOM_COUNT = 3;
/** 「换一个」的最短动画时长（ms）—— 比它快就等一会儿，别让卡片闪一下 */
const MIN_ROLL_MS = 320;
/** 最近吃过的回溯天数（与后端默认一致） */
const RECENT_DAYS = 7;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    familyId: 0,
    myMemberId: 0,
    mealType: 'DINNER' as MealTypeValue,

    loading: true,
    loaded: false,
    /** 池子里一条菜都没有 —— 显示引导，而不是一张「？」卡片 */
    emptyPool: false,

    cards: [] as DishCardView[],
    cardIndex: 0,
    /** 正在重新随机 —— 页面据此播翻转动画并挡住重复点击 */
    rolling: false,
    /** 排除最近 3 天之后的池子大小（后端给的），空状态判断用 */
    poolSize: 0,

    recentRows: [] as RecentMealRow[],

    members: [] as FamilyMember[],

    // ---- 底部确认层 ----
    sheetOpen: false,
    /** 面板抬头：这一餐的菜名（顿号连接） */
    sheetNames: '',
    sheetChoices: [] as AssignChoice[],
    /** 有请求在路上：挡住重复点击 */
    acting: false,
  },

  onLoad() {
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    if (!family) return;

    this.setData({
      familyId: family.familyId,
      myMemberId: family.memberId,
      mealType: inferMealType(new Date()),
    });

    void this.loadMembers();
    void this.roll();
    void this.loadRecent();
  },

  /** 从别处回来时「最近吃过」可能变了（比如刚在首页记了一餐） */
  onShow() {
    if (!this.data.familyId) return;
    void this.loadRecent();
  },

  /** 下拉刷新：重新抽一次，并刷新最近吃过 */
  async onPullDownRefresh() {
    await Promise.all([this.roll(), this.loadRecent()]);
    wx.stopPullDownRefresh();
  },

  async loadMembers() {
    try {
      const members = await familyApi.listMembers(this.data.familyId);
      this.setData({ members });
    } catch (e) {
      // 成员列表只服务于「派给谁」，拉不到不该挡住「今天吃什么」
      toastError(e);
    }
  },

  async loadRecent() {
    try {
      const groups = await menuApi.recent({
        familyId: this.data.familyId,
        days: RECENT_DAYS,
      });
      this.setData({ recentRows: groups.map(buildRecentMealRow) });
    } catch (e) {
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 随机
  // ---------------------------------------------------------------

  async roll() {
    if (this.data.rolling) return;
    this.setData({ rolling: true });

    try {
      // 最短动画时长与请求并行等 —— 请求快就等动画，请求慢就以请求为准
      const [res] = await Promise.all([
        menuApi.random({
          familyId: this.data.familyId,
          count: RANDOM_COUNT,
          mealType: this.data.mealType,
          // 默认就是 true，显式写出来是为了让「排除最近吃过的」这条产品规则
          // 在代码里看得见（它不在页面上，是个隐形规则）
          excludeRecent: true,
        }),
        delay(MIN_ROLL_MS),
      ]);

      const cards = buildDishCards(res.items);
      this.setData({
        loading: false,
        loaded: true,
        cards,
        cardIndex: 0,
        poolSize: res.poolSize,
        emptyPool: res.poolSize === 0,
        rolling: false,
      });
    } catch (e) {
      this.setData({ loading: false, loaded: true, rolling: false });
      toastError(e);
    }
  },

  /** swiper 换了卡片 —— 圆点跟着走 */
  onCardChange(e: WechatMiniprogram.SwiperChange) {
    this.setData({ cardIndex: e.detail.current });
  },

  // ---------------------------------------------------------------
  // 就吃这个
  // ---------------------------------------------------------------

  onOpenSheet() {
    if (this.data.cards.length === 0) {
      toast('先点「换一个」抽一道吧');
      return;
    }

    this.setData({
      sheetOpen: true,
      // 顿号连接（不是间隔号）—— 这里是在说「这一餐有这几道菜」，
      // 与「最近吃过」里并列历史记录的「 · 」是两种语气
      sheetNames: this.data.cards.map((c) => c.name).join('、'),
      sheetChoices: buildAssignChoices(this.data.members, this.data.myMemberId),
    });
  },

  onCloseSheet() {
    if (this.data.acting) return;
    this.setData({ sheetOpen: false });
  },

  /** 确认层里点了一项：`skip` = 只记录，`assign` = 记录 + 派活 */
  async onPickChoice(e: WechatMiniprogram.TouchEvent) {
    if (this.data.acting) return;

    const memberId = Number(e.currentTarget.dataset.memberId) || 0;
    const kind = String(e.currentTarget.dataset.kind);

    if (kind === 'skip') {
      await this.recordOnly();
      return;
    }
    await this.assignTo(memberId);
  },

  /** 这一餐的菜，转成接口入参。系统菜谱的 `id` 是 null，原样传 */
  mealItems(): MealItemInput[] {
    return this.data.cards.map((c) => ({ menuItemId: c.id, name: c.name }));
  },

  async recordOnly() {
    this.setData({ acting: true });
    try {
      const res = await menuApi.decide({
        familyId: this.data.familyId,
        mealType: this.data.mealType,
        items: this.mealItems(),
      });
      this.setData({ sheetOpen: false });
      // 原样透出后端那句话（「今晚吃：番茄炒蛋、炒青菜」），前端不自己拼
      toast(res.summary);
      await this.loadRecent();
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  async assignTo(memberId: number) {
    if (!memberId) return;

    this.setData({ acting: true });
    try {
      await menuApi.decideAndAssign({
        familyId: this.data.familyId,
        mealType: this.data.mealType,
        items: this.mealItems(),
        assigneeMemberId: memberId,
      });

      const target = this.data.members.filter((m) => m.memberId === memberId)[0];
      const isSelf = target ? target.isMe === true : memberId === this.data.myMemberId;
      this.setData({ sheetOpen: false });
      toast(assignDoneToast(target ? target.roleName : '他', isSelf, this.data.mealType));
      await this.loadRecent();
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  // ---------------------------------------------------------------
  // 跳转
  // ---------------------------------------------------------------

  /** 菜谱管理（P17）。空状态下的「去添加」也走这里 */
  onManage() {
    wx.navigateTo({ url: '/pages/menu/manage' });
  },
});
