/**
 * P07 · 设置称谓（M1-F7）
 *
 * 两处进得来：
 *   - P14 家庭成员页点自己那一条
 *   - 以后「我的」Tab 的快捷入口
 *
 * 为什么单独一页而不是弹窗：称谓是**家庭内唯一**的（重名会让
 * 「阿妈，有个活儿到你啦」指不清是谁），所以需要一整块空间来做
 * 输入 + 常见称谓选择 + 冲突提示。弹窗放不下这些。
 *
 * 冲突由后端兜底（40900「这个称谓家里已经有人用啦，换一个吧」），
 * 前端不预判 —— 前端拿不到实时的全家称谓，预判只会产生假阳性。
 */

import { ROLE_SUGGESTIONS } from '../../constants/roles';
import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { toast, toastError } from '../../utils/toast';

Page({
  data: {
    familyId: 0,
    familyName: '',
    roleName: '',
    roleSuggestions: ROLE_SUGGESTIONS,
    saving: false,
  },

  onLoad() {
    const family = userStore.getCurrentFamily();
    if (!family) {
      wx.redirectTo({ url: '/pages/family/create' });
      return;
    }

    this.setData({
      familyId: family.familyId,
      familyName: family.familyName,
      roleName: family.roleName,
    });
  },

  onRoleInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ roleName: e.detail.value });
  },

  onPickRole(e: WechatMiniprogram.TouchEvent) {
    this.setData({ roleName: e.currentTarget.dataset.role as string });
  },

  async onSave() {
    if (this.data.saving) return;

    const roleName = this.data.roleName.trim();
    if (!roleName) {
      toast('写一下你在家里叫什么');
      return;
    }

    this.setData({ saving: true });

    try {
      await familyApi.updateMyRole(this.data.familyId, { roleName });
      // 称谓散落在多处（store 里的 families、成员列表、首页抬头），拉一次对齐
      await userStore.reloadFamilies();
      toast('改好啦');
      setTimeout(() => wx.navigateBack(), 700);
    } catch (e) {
      this.setData({ saving: false });
      toastError(e);
    }
  },
});
