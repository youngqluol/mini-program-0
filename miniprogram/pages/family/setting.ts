/**
 * P16 · 家庭设置（M1-F13）
 *
 * 三项操作，按身份分流：
 *   - 创建者：改家庭名、解散家庭
 *   - 非创建者：退出家庭
 *
 * 为什么没有「转让创建者」：V0.1 刻意不做（AGENTS.md §6 铁律 —— 家庭里只有
 * 「成员」和「创建者」两种身份，不搞权限矩阵）。创建者要退出，先解散。
 *
 * 解散与退出都是**逻辑删除**：`families.status = 0` / `family_members.status = 0`，
 * 历史的小事与留念都留着（PRD 第二十一章）。
 */

import type { FamilyDetail } from '@shared/dto/family';
import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { goAfterLogin } from '../../utils/route';
import { confirm, confirmWithText, toast, toastError } from '../../utils/toast';

Page({
  data: {
    familyId: 0,
    detail: null as FamilyDetail | null,
    loading: true,

    /** 是否处于「改家庭名」编辑态 */
    editingName: false,
    nameDraft: '',
    saving: false,
    acting: false,
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

  // -------------------------------------------------------------
  // 改家庭名
  // -------------------------------------------------------------

  onEditName() {
    const detail = this.data.detail;
    if (!detail) return;
    this.setData({ editingName: true, nameDraft: detail.familyName });
  },

  onNameInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ nameDraft: e.detail.value });
  },

  onCancelEditName() {
    this.setData({ editingName: false, nameDraft: '' });
  },

  async onSaveName() {
    if (this.data.saving) return;

    const name = this.data.nameDraft.trim();
    if (!name) {
      toast('家庭名不能空着');
      return;
    }

    this.setData({ saving: true });

    try {
      await familyApi.updateFamilyName(this.data.familyId, { familyName: name });
      // 家庭名同时存在于 store 与多处页面抬头，拉一次列表对齐最省心
      await userStore.reloadFamilies();
      this.setData({ editingName: false, saving: false });
      toast('改好啦');
      void this.load();
    } catch (e) {
      this.setData({ saving: false });
      toastError(e);
    }
  },

  // -------------------------------------------------------------
  // 解散家庭（仅创建者）
  // -------------------------------------------------------------

  async onDissolve() {
    if (this.data.acting) return;

    const detail = this.data.detail;
    if (!detail) return;

    const ok = await confirmWithText({
      title: '解散家庭',
      placeholder: `输入「${detail.familyName}」确认`,
      expect: detail.familyName,
      confirmText: '解散',
      mismatchMessage: '名字没对上，先不解散了',
    });
    if (!ok) return;

    this.setData({ acting: true });

    try {
      await familyApi.dissolveFamily(this.data.familyId);
      userStore.removeFamily(this.data.familyId);
      toast('家庭已解散，记录都留着');
      goAfterLogin();
    } catch (e) {
      this.setData({ acting: false });
      toastError(e);
    }
  },

  // -------------------------------------------------------------
  // 退出家庭（非创建者）
  // -------------------------------------------------------------

  async onLeave() {
    if (this.data.acting) return;

    const ok = await confirm({
      title: '退出这个家？',
      content: '你记过的事都会留着，以后还能再加回来',
      confirmText: '退出',
    });
    if (!ok) return;

    this.setData({ acting: true });

    try {
      await familyApi.leaveFamily(this.data.familyId);
      userStore.removeFamily(this.data.familyId);
      toast('已经退出啦');
      goAfterLogin();
    } catch (e) {
      this.setData({ acting: false });
      toastError(e);
    }
  },
});
