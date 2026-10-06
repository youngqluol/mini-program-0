/**
 * P04 · 授权登录（docs/03 页面清单）
 *
 * 这一页出现在**冷启动没有登录态**的时候。
 *
 * 为什么不做成「静默登录、用户无感」：`wx.login` 确实不需要用户点同意，
 * 但家庭类产品第一次进来必须有一步「我知道我要开始用了」的仪式感 ——
 * 否则用户会困惑「我的微信怎么被读了」。这一步不弹任何授权框，
 * 只是把「开始」这个动作交给用户。
 */

import * as userStore from '../../stores/user';
import { goAfterLogin } from '../../utils/route';
import { toastError } from '../../utils/toast';

Page({
  data: {
    loading: false,
  },

  async onLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      await userStore.login();
      goAfterLogin();
    } catch (e) {
      toastError(e);
      this.setData({ loading: false });
    }
  },
});
