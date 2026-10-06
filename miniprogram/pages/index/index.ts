/**
 * P01 · 家里（Tab 1）
 *
 * 页面职责（docs/03）：打开就知道「今天家里有什么事」。
 * 首页**只负责今天**，不承担通知归档（消息中心在「我的」Tab）。
 *
 * M1 阶段：接入启动路由守卫与家庭抬头。
 * 「今天的小事」列表在 M2 接入。
 */

import * as userStore from '../../stores/user';
import { guardEntry } from '../../utils/route';

Page({
  data: {
    /** 家庭名，用于抬头；未登录 / 未取到时为空串 */
    familyName: '',
  },

  onShow() {
    // 启动路由守卫（M1-F5）：没登录 → P04；没家庭 → P05 引导页。
    // 被拦下时不再渲染本页内容。
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    this.setData({ familyName: family ? family.familyName : '' });
  },

  /** 🔔 叮一下 —— P08 */
  onNudge() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' });
  },

  /** 🎯 派活 —— P09 */
  onAssign() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' });
  },

  /** 去开启微信提醒 —— P21 */
  onOpenNotifySetting() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' });
  },
});
