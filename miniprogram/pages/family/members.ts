/**
 * P14 · 家庭成员（M1-F11）
 *
 * 列表展示每个家人的**称谓**（不是昵称）—— 消息文案里用的就是称谓，
 * 用户看到「阿妈」比看到「红红」更容易对上号。
 *
 * 两个操作：
 *   - 点自己那一条 → 跳 P07 改称谓
 *   - 创建者长按别人 → 移出家庭（二次确认，提示历史保留）
 *
 * ⚠️ 长按对非创建者**静默无反应**：不给「你没权限」的提示，
 *    因为家庭里不该出现权限话术（AGENTS.md §6）。他压根看不到这个操作存在。
 *
 * 成员右侧的「微信提醒状态」在 M2 接入（需要查询对方的绑定状态）。
 */

import type { FamilyMember } from '@shared/dto/family';
import * as familyApi from '../../services/family';
import * as userStore from '../../stores/user';
import { confirm, toast, toastError } from '../../utils/toast';

/** dataset 里的布尔值在不同基础库版本下可能是 boolean 或字符串，统一收口 */
function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

Page({
  data: {
    familyId: 0,
    members: [] as FamilyMember[],
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
      const members = await familyApi.listMembers(this.data.familyId);
      this.setData({ members, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
  },

  onMemberTap(e: WechatMiniprogram.TouchEvent) {
    const isMe = asBool(e.currentTarget.dataset.isMe);
    if (isMe) {
      wx.navigateTo({ url: '/pages/family/set-role' });
      return;
    }
    // 点别人：M2 会跳「他的小事」列表，M1 先不响应
  },

  async onMemberLongPress(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset;
    const memberId = Number(ds.memberId);
    const isMe = asBool(ds.isMe);
    const isOwner = asBool(ds.isOwner);

    const meRow = this.data.members.filter((m) => m.isMe)[0];
    const iAmOwner = !!meRow && meRow.isOwner;

    // 非创建者没有管理动作；不能移除自己；不能移除创建者
    if (!iAmOwner || isMe || isOwner) return;

    const target = this.data.members.filter((m) => m.memberId === memberId)[0];
    const who = target ? target.roleName : '这位家人';

    const ok = await confirm({
      title: `把${who}移出家庭？`,
      content: '他之前记过的事都会留着，以后还能再加回来',
      confirmText: '移出',
    });
    if (!ok) return;

    try {
      await familyApi.removeMember(this.data.familyId, memberId);
      toast(`已经把${who}移出了`);
      void this.load();
    } catch (err) {
      toastError(err);
    }
  },
});
