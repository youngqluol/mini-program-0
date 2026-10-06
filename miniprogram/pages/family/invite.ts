/**
 * P15 · 邀请成员（M1-F12 + 分享链路 M1-F9）
 *
 * 进页面就生成一个新邀请码 —— 不做「点按钮才生成」。
 * 用户来这一页的目的只有一个：把人拉进来。多一次点击没有任何收益，
 * 而且提前生成才能让「分享给家人」这个按钮天然可用。
 *
 * 分享走 `onShareAppMessage`（M1-F9）：
 *   小程序**不允许**自己拼一个分享链接直接发，必须由用户点「转发」按钮
 *   或右上角菜单触发。所以这里的做法是：把后端给的 `sharePath`
 *   （`pages/family/join?code=A7K2M9`）交给分享卡片，家人点开就带着码进来。
 */

import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { describeExpire } from '../../utils/time';
import { toast, toastError } from '../../utils/toast';

Page({
  data: {
    familyId: 0,
    familyName: '',
    inviteCode: '',
    /** 人话版的过期时间，例如「3 天后过期」 */
    expireText: '',
    /** 分享卡片要用的路径，由后端给出（与 docs/03 的 P06 路径一致） */
    sharePath: '',
    loading: true,
  },

  onLoad() {
    const family = userStore.getCurrentFamily();
    if (!family) {
      wx.redirectTo({ url: '/pages/family/create' });
      return;
    }

    this.setData({ familyId: family.familyId, familyName: family.familyName });
    void this.createInvite();
  },

  async createInvite() {
    this.setData({ loading: true });
    try {
      const res = await familyApi.createInvite(this.data.familyId, { expireInHours: 72 });
      this.setData({
        inviteCode: res.inviteCode,
        expireText: describeExpire(res.expireAt),
        sharePath: res.sharePath,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
  },

  /** 转发给家人（M1-F9）。只有用户点转发/右上角菜单才会触发。 */
  onShareAppMessage() {
    const fallbackPath = `/pages/family/join?code=${this.data.inviteCode}`;
    return {
      title: `邀请你加入「${this.data.familyName}」`,
      path: this.data.sharePath || fallbackPath,
    };
  },

  /** 分享到朋友圈（小程序支持时的额外入口） */
  onShareTimeline() {
    return {
      title: `邀请你加入「${this.data.familyName}」`,
      query: `code=${this.data.inviteCode}`,
    };
  },

  onCopyCode() {
    if (!this.data.inviteCode) return;
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => toast('邀请码已经复制啦'),
    });
  },

  onRefreshCode() {
    if (this.data.loading) return;
    void this.createInvite();
  },
});
