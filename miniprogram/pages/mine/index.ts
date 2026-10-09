/**
 * P20 · 我的（Tab 4）—— M2-F2
 *
 * 个人与家庭管理中枢（docs/03）。这里承载的是「低频但必须有」的东西：
 * 家庭管理、消息中心。它们不该占首页的黄金位置，也不能藏得找不到。
 *
 * v0.2 变更：家庭模块入口从「首页右上角」整体搬到这里。
 * 「切换家庭」在 V0.1 隐藏，位置已预留给 V0.2，放开入口即可、不动结构。
 *
 * 四条刻意的判断：
 *
 * 1. **未读角标在 `onShow` 里刷**（`syncUnreadBadge`）。我的未读数只会因为
 *    **别人**做了事而变化，本地没有任何触发点 —— 想实时只能轮询，不值当。
 *    「打开我的 Tab 时是最新的」已经够用。
 *
 * 2. **三项网络请求各自独立失败。** 成员数、未读数、家庭身份互不依赖，
 *    任何一个挂了都不该让整页空白 —— 拿不到的那一项**保持上一次的样子**。
 *    尤其是角标：请求失败时清掉角标，等于把「有未读」这个事实抹掉了。
 *
 * 3. **创建者看不到「退出家庭」按钮**（判据在 `utils/mine-view.ts`）。
 *    后端会拒绝创建者退出，给一个点了就报错的按钮是差交互；
 *    换成一行说明，告诉他真正的出口在「家庭设置」。
 *
 * 4. **微信提醒这一行随 M2-F1 一起加。** 它要跳 P21 —— 那一页做出来之前不挂，
 *    因为「挂一个点了没反应的入口，比暂时不挂更糟」（和首页 M2-F3 同一个道理）。
 *
 * ⚠️ 「关于 / 隐私政策 / 注销账号」现在的露出情况（**三样都在了**）：
 *    · **关于** —— 一直有（一个只读弹窗）。
 *    · **隐私政策** —— ✅ 跳 P22 `pages/mine/privacy`。提审的硬性要求
 *      （`docs/06` §八），内容是一份静态文本，不需要后端。
 *    · **注销账号** —— ✅ 已露出（v0.2.11），跳**两步确认**后调
 *      `DELETE /auth/account`。提审的硬性要求（`docs/06` §4.6）。
 *      口径是「认人的抹掉，家里的事留下但不再署名」，完整表见
 *      `server/src/modules/auth/account.service.ts` 的文件头。
 *
 * 关于注销那两步确认为什么不能省：它是**全 App 唯一不可逆**的动作 ——
 * 退出家庭、解散家庭都只是「家里的事」，人还在；注销是「这个人没了」。
 * 第一步把后果说清楚（提审要求「注销后数据有明确的处理说明」），
 * 第二步要求把「注销」两个字**打出来**，让手停一下。
 */

import * as authApi from '../../services/auth';
import * as familyApi from '../../services/family';
import * as notifyApi from '../../services/notify';
import * as userStore from '../../stores/user';
import type {
  LeaveRowView,
  MineProfileView,
  NotifyRowView,
  UnreadBadgeView,
} from '../../utils/mine-view';
import {
  buildLeaveRow,
  buildMineProfile,
  buildUnreadBadge,
  buildWechatNotifyRow,
} from '../../utils/mine-view';
import { goCreateFamily, goLogin, guardEntry } from '../../utils/route';
import { syncUnreadBadge } from '../../utils/tab-badge';
import { confirm, confirmWithText, toast, toastError } from '../../utils/toast';

/** 「关于」弹窗里的一句话 —— 说清这是个什么工具，不吹功能 */
const ABOUT_TEXT = '给家里人用的小工具：叮一下、派个活、商量吃啥、留个念。\n\nv0.1';

/**
 * 注销前的后果说明（第一步确认的正文）。
 *
 * **必须具体到「哪几样会没、哪几样会留」。** 提审要求「注销后数据有明确的
 * 处理说明」，一句「注销后数据将被清除」既过不了审、也让用户没法判断。
 * 同时这也是对家里其他人的交代：他们会看到历史记录上署名人变了。
 */
const DELETE_WARNING =
  '注销之后就不能回头了：\n\n' +
  '· 你填过的昵称、头像、微信提醒会一起清掉\n' +
  '· 家里以前的事都留着，但不再显示是你写的\n' +
  '· 还没发出去的提醒会取消\n' +
  '· 用同一个微信再进来，是一个全新的空账号\n\n' +
  '详细说明在「隐私政策」里。';

/** 第二步要求用户原样打出来的两个字 */
const DELETE_CONFIRM_WORD = '注销';

Page({
  data: {
    profile: { nickname: '我', roleLine: '', hasFamily: false } as MineProfileView,
    familyName: '',
    /** 「3 位成员」；拿不到时是空串（不编一个 0 出来） */
    memberCountText: '',

    unread: { show: false, text: '' } as UnreadBadgeView,
    wechat: { text: '还没开', warn: true } as NotifyRowView,
    leave: { show: true, hint: '' } as LeaveRowView,

    /** 有请求在路上：挡住重复点「退出家庭」 */
    acting: false,
  },

  onShow() {
    if (!guardEntry()) return;
    this.refresh();
  },

  /** 从 store 同步的部分：同步、立即渲染，不等网络 */
  refresh() {
    const family = userStore.getCurrentFamily();
    this.setData({
      profile: buildMineProfile(userStore.getState().user, family),
      familyName: family ? family.familyName : '',
    });
    void this.load();
  },

  /**
   * 要联网的三件事。`getDetail` 只为拿 `memberCount` 与 `isOwner` ——
   * store 里存的是 `MyFamilyBrief`，刻意不含这两个字段（见 `stores/user.ts` 顶部）。
   */
  async load() {
    const family = userStore.getCurrentFamily();
    if (!family) return;

    const [detail, unread, mp] = await Promise.all([
      familyApi.getDetail(family.familyId).catch(() => null),
      notifyApi.unreadCount().catch(() => null),
      notifyApi.getMpBindStatus().catch(() => null),
    ]);

    if (detail) {
      this.setData({
        memberCountText: `${detail.memberCount} 位成员`,
        leave: buildLeaveRow(detail.isOwner),
      });
    }

    // 拿不到未读数就保持上一次的样子 —— 清掉等于把「有未读」这件事抹掉
    if (unread) {
      this.setData({ unread: buildUnreadBadge(unread.unreadCount) });
      syncUnreadBadge(unread.unreadCount);
    }

    if (mp) this.setData({ wechat: buildWechatNotifyRow(mp.bound) });
  },

  // ---------------------------------------------------------------
  // 家庭
  // ---------------------------------------------------------------

  onFamilyInfo() {
    wx.navigateTo({ url: '/pages/family/index' });
  },

  onMembers() {
    wx.navigateTo({ url: '/pages/family/members' });
  },

  onInvite() {
    wx.navigateTo({ url: '/pages/family/invite' });
  },

  onSetting() {
    wx.navigateTo({ url: '/pages/family/setting' });
  },

  // ---------------------------------------------------------------
  // 消息与提醒
  // ---------------------------------------------------------------

  onNotice() {
    wx.navigateTo({ url: '/pages/notice/index' });
  },

  onWechatNotify() {
    wx.navigateTo({ url: '/pages/mine/wechat-notify' });
  },

  // ---------------------------------------------------------------
  // 其他
  // ---------------------------------------------------------------

  onAbout() {
    wx.showModal({
      title: '家有小事',
      content: ABOUT_TEXT,
      showCancel: false,
      confirmText: '知道啦',
    });
  },

  /** 隐私政策（P22）—— 静态文本页，不依赖后端 */
  onPrivacy() {
    wx.navigateTo({ url: '/pages/mine/privacy' });
  },

  /**
   * 注销账号（P20「其他」→ `DELETE /auth/account`，docs/02 §2.6）。
   *
   * **两步确认，刻意不做成一步。**
   *   第一步 `confirm()`：把后果逐条说清楚（提审要求「注销后数据有明确的
   *     处理说明」）。这一步是**信息**，让用户知道自己要放弃什么。
   *   第二步 `confirmWithText()`：要求把「注销」两个字打出来。这一步是**刹车** ——
   *     连点两下「确定」太顺了，打字能让人真的停一下。和「解散家庭」同一套重量。
   *
   * 成功后 `logout()` + `goLogin()`（reLaunch 清空页面栈）：账号已经没了，
   * 本地那份登录态必须立刻作废，否则用户按返回还能翻回一个失效的页面。
   */
  async onDeleteAccount() {
    if (this.data.acting) return;

    const known = await confirm({
      title: '注销账号？',
      content: DELETE_WARNING,
      confirmText: '继续',
    });
    if (!known) return;

    const typed = await confirmWithText({
      title: '真的要注销吗',
      placeholder: `输入「${DELETE_CONFIRM_WORD}」两个字`,
      expect: DELETE_CONFIRM_WORD,
      confirmText: '注销',
      mismatchMessage: '没对上，先不注销了',
    });
    if (!typed) return;

    this.setData({ acting: true });
    try {
      await authApi.deleteAccount();
    } catch (e) {
      this.setData({ acting: false });
      toastError(e);
      return;
    }

    // 角标要在 reLaunch 之前摘掉：tabBar 是全局的，
    // 留着它会让登录页底下挂一个别人家的未读数
    syncUnreadBadge(0);
    userStore.logout();
    goLogin();
  },

  // ---------------------------------------------------------------
  // 退出家庭
  // ---------------------------------------------------------------

  async onLeave() {
    const family = userStore.getCurrentFamily();
    if (!family || this.data.acting || !this.data.leave.show) return;

    const ok = await confirm({
      title: `退出「${family.familyName}」？`,
      content: '退出后你就看不到这个家的小事了，之前的内容都还在。',
      confirmText: '退出',
    });
    if (!ok) return;

    this.setData({ acting: true });
    try {
      await familyApi.leaveFamily(family.familyId);
    } catch (e) {
      this.setData({ acting: false });
      toastError(e);
      return;
    }

    this.setData({ acting: false });
    userStore.removeFamily(family.familyId);

    // 退掉最后一个家之后，「我的」这一页已经没有意义了 —— 直接去创建 / 加入的引导。
    // 不能只靠 `guardEntry()` 兜：那要等下一次 onShow，中间会空着半屏。
    if (userStore.needsFamilySetup()) {
      goCreateFamily();
      return;
    }

    toast('已经退出了');
    this.refresh();
  },
});
