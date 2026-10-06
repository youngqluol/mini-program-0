/**
 * P06 · 加入家庭（M1-F8）
 *
 * 两个入口进同一页：
 *   ① 家人分享的卡片 → `onLoad` 的 query 里带 `code`
 *   ② 用户手动输码（或从 P05 点「去加入」过来）
 *
 * 页面有两个状态：
 *   `input`   —— 输邀请码
 *   `confirm` —— 预览家庭信息 + 填我的称谓
 *
 * 为什么先预览再填称谓：用户拿到一个码，并不知道是谁给的、哪个家。
 * 让他先看到「阿爸邀请你加入『我们家』」，再决定叫什么 —— 这一步的信息
 * 比多一次点击重要得多。
 */

import type { InvitePreview } from '@shared/dto/family';
import { ROLE_SUGGESTIONS } from '../../constants/roles';
import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { goHome } from '../../utils/route';
import { toast, toastError } from '../../utils/toast';

type Step = 'input' | 'confirm';

Page({
  data: {
    step: 'input' as Step,
    inviteCode: '',
    roleName: '',
    roleSuggestions: ROLE_SUGGESTIONS,
    /** 预览结果；`step === 'confirm'` 时必然非空 */
    preview: null as InvitePreview | null,
    loading: false,
    accepting: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    // 从分享卡片进来时已经带码，直接查预览，省掉用户手输
    const code = query.code ? String(query.code).toUpperCase() : '';
    if (code) {
      this.setData({ inviteCode: code });
      void this.loadPreview();
    }
  },

  onCodeInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    // 邀请码字符集不含小写，统一转大写免得用户以为输错了
    this.setData({ inviteCode: e.detail.value.toUpperCase() });
  },

  onRoleInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ roleName: e.detail.value });
  },

  onPickRole(e: WechatMiniprogram.TouchEvent) {
    this.setData({ roleName: e.currentTarget.dataset.role as string });
  },

  /** 查邀请码预览 → 进 confirm 态 */
  async loadPreview() {
    if (this.data.loading) return;

    const code = this.data.inviteCode.trim().toUpperCase();
    if (!code) {
      toast('输入家人给你的邀请码');
      return;
    }

    this.setData({ loading: true });

    let preview: InvitePreview;
    try {
      preview = await familyApi.previewInvite(code);
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
      return;
    }

    this.setData({ loading: false });

    // 已经在这个家里了：不用再走加入流程，直接回首页
    if (preview.alreadyMember) {
      toast('你已经在这个家里啦');
      goHome();
      return;
    }

    if (preview.status !== 'VALID') {
      toast(
        preview.status === 'USED'
          ? '这个邀请码已经用过了，让家人重新发一个'
          : '这个邀请码过期啦，让家人重新发一个',
      );
      return;
    }

    this.setData({ step: 'confirm', preview });
  },

  /** 接受邀请加入 */
  async onAccept() {
    if (this.data.accepting) return;

    const preview = this.data.preview;
    if (!preview) return;

    const roleName = this.data.roleName.trim();
    if (!roleName) {
      toast('写一下你在家里叫什么');
      return;
    }

    this.setData({ accepting: true });

    try {
      const res = await familyApi.acceptInvite(preview.inviteCode, { roleName });

      userStore.addFamily({
        familyId: res.familyId,
        familyName: res.familyName,
        memberId: res.memberId,
        roleName: res.roleName,
      });

      goHome();
    } catch (e) {
      // 称谓重复时后端返回 40900「这个称谓家里已经有人用啦，换一个吧」，
      // 直接透出即可 —— 用户看得懂，也知道下一步该做什么
      this.setData({ accepting: false });
      toastError(e);
    }
  },

  /** 换个码重输 */
  onBackToInput() {
    this.setData({ step: 'input', preview: null, roleName: '' });
  },
});
