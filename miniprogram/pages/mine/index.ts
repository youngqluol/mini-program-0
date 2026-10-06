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
 * 4. **微信提醒这一行等 M2-F1 一起加。** 它要跳 P21，而 P21 还没做 ——
 *    挂一个点了没反应的入口，比暂时不挂更糟（和首页 M2-F3 的处理同一个道理）。
 *    「还没开微信提醒」这件事目前由 P12 消息中心在送达失败时告诉你。
 *
 * ⚠️ 「关于 / 隐私政策 / 注销账号」里的后两项**这一轮不露出**：
 *    隐私政策需要一份真实的合规文案，注销账号需要后端的删除链路
 *    （全库不做物理 DELETE，注销只能置状态 + 匿名化）。两件都是**上线前**的事，
 *    见 `docs/06-上线前环境准备清单.md` §4.6 / §264，已记入 `docs/未来需求池.md`。
 */

import * as familyApi from '../../services/family';
import * as notifyApi from '../../services/notify';
import * as userStore from '../../stores/user';
import type { LeaveRowView, MineProfileView, UnreadBadgeView } from '../../utils/mine-view';
import { buildLeaveRow, buildMineProfile, buildUnreadBadge } from '../../utils/mine-view';
import { goCreateFamily, guardEntry } from '../../utils/route';
import { syncUnreadBadge } from '../../utils/tab-badge';
import { confirm, toast, toastError } from '../../utils/toast';

/** 「关于」弹窗里的一句话 —— 说清这是个什么工具，不吹功能 */
const ABOUT_TEXT = '给家里人用的小工具：叮一下、派个活、商量吃啥、留个念。\n\nv0.1';

Page({
  data: {
    profile: { nickname: '我', roleLine: '', hasFamily: false } as MineProfileView,
    familyName: '',
    /** 「3 位成员」；拿不到时是空串（不编一个 0 出来） */
    memberCountText: '',

    unread: { show: false, text: '' } as UnreadBadgeView,
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
   * 要联网的两件事。`getDetail` 只为拿 `memberCount` 与 `isOwner` ——
   * store 里存的是 `MyFamilyBrief`，刻意不含这两个字段（见 `stores/user.ts` 顶部）。
   */
  async load() {
    const family = userStore.getCurrentFamily();
    if (!family) return;

    const [detail, unread] = await Promise.all([
      familyApi.getDetail(family.familyId).catch(() => null),
      notifyApi.unreadCount().catch(() => null),
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
