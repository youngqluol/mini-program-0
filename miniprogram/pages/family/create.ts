/**
 * P05 · 创建家庭（M1-F6）
 *
 * 新用户登录后的第一个落点（docs/03 §4.2）。一页填完两件事：
 *   - 家庭名称（例如「我们家」）
 *   - 我在这个家里的称谓（例如「阿爸」）
 *
 * 为什么称谓和家庭名放在同一页，而不是拆成「先建家、再设称谓」两步：
 *   创建家庭是个**一次性的引导动作**，用户此刻的耐心最短。能一屏问完的
 *   就不该拆成两屏 —— 多一步就多一次流失。
 *
 * ⚠️ 称谓属于「用户 × 家庭」这个关系，不属于用户（见 docs/核心数据模型）。
 *    所以这里是「我在**这个家**里叫什么」，不是「我的昵称」。
 */

import { ROLE_SUGGESTIONS } from '../../constants/roles';
import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { goHome } from '../../utils/route';
import { toast, toastError } from '../../utils/toast';

Page({
  data: {
    familyName: '',
    roleName: '',
    roleSuggestions: ROLE_SUGGESTIONS,
    submitting: false,
  },

  onFamilyNameInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ familyName: e.detail.value });
  },

  onRoleNameInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ roleName: e.detail.value });
  },

  /** 点常见称谓直接填入 */
  onPickRole(e: WechatMiniprogram.TouchEvent) {
    const role = e.currentTarget.dataset.role as string;
    this.setData({ roleName: role });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const familyName = this.data.familyName.trim();
    const roleName = this.data.roleName.trim();

    if (!familyName) {
      toast('给家起个名字吧');
      return;
    }
    if (!roleName) {
      toast('写一下你在家里叫什么');
      return;
    }

    this.setData({ submitting: true });

    try {
      const res = await familyApi.createFamily({ familyName, roleName });

      // 本地先把新家庭挂上（省一次网络往返），再回首页。
      // 首页抬头直接读 store，不等 `GET /families` 返回。
      userStore.addFamily({
        familyId: res.familyId,
        familyName: res.familyName,
        memberId: res.memberId,
        roleName: res.roleName,
      });

      goHome();
    } catch (e) {
      toastError(e);
      this.setData({ submitting: false });
    }
  },

  /** 已经有家人建好了家 → 去 P06 输邀请码 */
  onJoinFamily() {
    wx.redirectTo({ url: '/pages/family/join' });
  },
});
