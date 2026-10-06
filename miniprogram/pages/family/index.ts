/**
 * P13 · 家庭信息（M1-F10）
 *
 * 家庭模块的枢纽页：成员 / 邀请 / 设置三个入口都从这里进。
 *
 * 入口在「我的」Tab（v0.2 从首页右上角搬过来的），不在底部 Tab 里 ——
 * 家庭管理是低频操作，不该占黄金位置，但也不能藏得找不到。
 *
 * ⚠️ familyId 一律从 store 取，不走页面参数。V0.1 只有一个家庭，
 *    传参只会多一处可能传错的地方。V0.2 支持多家庭切换时再改为显式传。
 */

import type { FamilyDetail } from '@shared/dto/family';
import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { toastError } from '../../utils/toast';

Page({
  data: {
    familyId: 0,
    detail: null as FamilyDetail | null,
    loading: true,
  },

  onShow() {
    const family = userStore.getCurrentFamily();
    if (!family) {
      wx.redirectTo({ url: '/pages/family/create' });
      return;
    }

    this.setData({ familyId: family.familyId });
    void this.load();
  },

  async load() {
    try {
      const detail = await familyApi.getDetail(this.data.familyId);
      this.setData({ detail, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
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

  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },
});
