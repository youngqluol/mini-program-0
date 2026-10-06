/**
 * P20 · 我的（Tab 4）
 *
 * 个人与家庭管理中枢（docs/03）。
 *
 * 这里承载的是「低频但必须有」的东西：消息中心、微信提醒、家庭管理。
 * 它们不该占首页黄金位置，也不能藏得找不到。
 *
 * v0.2 变更：家庭模块入口从「首页右上角」整体搬到这里。
 * 「切换家庭」在 V0.1 隐藏，位置已预留给 V0.2，放开入口即可、不动结构。
 */

import * as userStore from '../../stores/user';
import { toast } from '../../utils/toast';

Page({
  data: {
    nickname: '',
    /** 「在我们家 · 阿爸」 */
    roleLine: '',
    familyName: '',
    /** 「3 位成员」 */
    memberCountText: '',
    hasFamily: false,
  },

  onShow() {
    const state = userStore.getState();
    const family = userStore.getCurrentFamily();

    this.setData({
      nickname:
        state.user && state.user.nickname ? state.user.nickname : family ? family.roleName : '我',
      roleLine: family ? `在${family.familyName} · ${family.roleName}` : '',
      familyName: family ? family.familyName : '',
      hasFamily: !!family,
    });

    if (family) void this.loadMemberCount(family.familyId);
  },

  /** 成员数单独拉一次 —— store 里存的是简要信息，没有 memberCount */
  async loadMemberCount(familyId: number) {
    try {
      const list = await userStore.reloadFamilies();
      const mine = list.filter((f) => f.familyId === familyId)[0];
      if (mine) this.setData({ memberCountText: `${mine.memberCount} 位成员` });
    } catch {
      // 拿不到数量不影响主流程，静默忽略
    }
  },

  // -------------------------------------------------------------
  // 家庭
  // -------------------------------------------------------------

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

  // -------------------------------------------------------------
  // 消息与提醒（M2 接入）
  // -------------------------------------------------------------

  onNotice() {
    toast('消息中心正在做，很快就好');
  },

  onWechatNotify() {
    toast('微信提醒正在做，很快就好');
  },

  onAbout() {
    toast('家有小事 · v0.1');
  },
});
