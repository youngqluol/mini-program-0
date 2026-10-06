/**
 * P08 · 叮一下（M2-F4 / F5）
 *
 * 三步内完成：叮谁 → 叮什么 → 什么时候叮。其余（重复）都是可选项。
 *
 * **两条提交路径**，这是这个页面最需要讲清楚的地方：
 *
 *   「现在就叮」 → `POST /reminders/nudge`
 *     走后端现成的 nudge 链路，会返回 `deliveryStatus` —— 发起人立刻能看到
 *     「到底叮到了没有」（三档，见 PRD 6.5.6）。这是 V0.1 的核心体验。
 *
 *   「定时叮」   → `POST /family-things`（type=REMINDER，带一条 SCHEDULED 提醒）
 *     到点由调度器下发。**当下拿不到送达结果**，所以文案不能装作已经送到了 ——
 *     只说「到点会提醒阿妈」，不说「已经叮到阿妈」。
 *
 * 几个刻意的取舍：
 *
 * 1. **列表里排除自己。** PRD 6.1：「叮一下用于提醒**某个家庭成员**一件事情」。
 *    要给自己记事，走「派活 → 派给我」——那条路有完成状态，语义更准。
 *
 * 2. **切到「现在就叮」时把「重复」清回不重复。** 「立即叮 + 每周」没有意义
 *    （重复的是到点触发，而立即叮没有「点」）。与其发一个后端解释不了的组合，
 *    不如在切换的瞬间就归零。
 *
 * 3. **不传 `visibility`。** 纯叮一下默认 `RELATED`（仅发起人 + 接收人，PRD 6.4），
 *    由后端兜底。前端不传就是不表态，避免和产品默认值两处维护。
 *
 * ⚠️ **已知缺口（M2-F14 未做）**：`NO_QUOTA` 时 docs/03 要求弹半屏引导
 *    「再开一次，帮我把话带到」→ `wx.requestSubscribeMessage`。该能力需要
 *    小程序侧的订阅模板 ID，而模板 ID 目前只在服务端环境变量里，仓库中没有。
 *    现在退化为三档 toast（文案已准确，用户知道该做什么），引导层留待 M2-F14。
 *
 * ⚠️ **已知缺口（无接口）**：docs/03 的「常用短语来自历史 Top 5」在 docs/02 里
 *    **没有对应接口**。已记入 `docs/未来需求池.md`，本次不做。
 */

import type { FamilyMember } from '@shared/dto/family';
import type { RecurrenceConfig, RecurrenceTypeValue } from '@shared/dto/thing';
import { deliveryToast } from '../../constants/delivery';
import * as familyApi from '../../services/family';
import * as reminderApi from '../../services/reminder';
import * as thingApi from '../../services/thing';
import * as userStore from '../../stores/user';
import { guardEntry } from '../../utils/route';
import { toBeijingString } from '../../utils/time';
import { toast, toastError } from '../../utils/toast';

type NudgeMode = 'NOW' | 'SCHEDULED';

/** 定时叮的默认时间：明天早上 7 点（docs/03 P08 稿子里的默认值） */
function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  return toBeijingString(d);
}

Page({
  data: {
    familyId: 0,
    /** 可叮的人 —— 已排除自己 */
    others: [] as FamilyMember[],

    recipientMemberId: 0,
    recipientName: '',

    content: '',
    /** 进入页面自动弹键盘；失焦后置 false，否则每次重渲染都会再弹一次 */
    autoFocus: true,

    mode: 'NOW' as NudgeMode,
    whenAt: '',
    repeatType: 'NONE' as RecurrenceTypeValue,
    repeatConfig: null as RecurrenceConfig | null,

    submitting: false,
  },

  onLoad() {
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    if (!family) return;

    this.setData({ familyId: family.familyId, whenAt: tomorrowMorning() });
    void this.loadMembers();
  },

  async loadMembers() {
    try {
      const members = await familyApi.listMembers(this.data.familyId);
      this.setData({ others: members.filter((m) => !m.isMe) });
    } catch (e) {
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 表单
  // ---------------------------------------------------------------

  onPickRecipient(e: WechatMiniprogram.CustomEvent<{ memberId: number }>) {
    const memberId = e.detail.memberId;
    const hit = this.data.others.filter((m) => m.memberId === memberId)[0];
    this.setData({ recipientMemberId: memberId, recipientName: hit ? hit.roleName : '' });
  },

  onContentInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ content: e.detail.value });
  },

  onContentBlur() {
    this.setData({ autoFocus: false });
  },

  onPickMode(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as NudgeMode;
    if (mode === this.data.mode) return;

    // 「立即叮」没有「到点」，重复无从谈起 —— 切换时归零，不留一个
    // 后端解释不了的组合
    this.setData(mode === 'NOW' ? { mode, repeatType: 'NONE', repeatConfig: null } : { mode });
  },

  onWhenChange(e: WechatMiniprogram.CustomEvent<{ value: string | null }>) {
    this.setData({ whenAt: e.detail.value || '' });
  },

  onRepeatChange(
    e: WechatMiniprogram.CustomEvent<{
      value: RecurrenceTypeValue;
      config: RecurrenceConfig | null;
    }>,
  ) {
    this.setData({ repeatType: e.detail.value, repeatConfig: e.detail.config });
  },

  // ---------------------------------------------------------------
  // 提交
  // ---------------------------------------------------------------

  async onSubmit() {
    if (this.data.submitting) return;

    const content = this.data.content.trim();
    if (!content) {
      toast('要叮什么？写一句吧');
      return;
    }
    if (!this.data.recipientMemberId) {
      toast('选一下叮谁');
      return;
    }

    this.setData({ submitting: true });

    try {
      if (this.data.mode === 'NOW') {
        await this.submitNow(content);
      } else {
        const ok = await this.submitScheduled(content);
        if (!ok) return; // 校验没过，submitScheduled 已把 submitting 复位
      }

      setTimeout(() => wx.navigateBack(), 1400);
    } catch (e) {
      toastError(e);
      this.setData({ submitting: false });
    }
  },

  /** 立即叮 —— 能拿到送达结果，按三档反馈 */
  async submitNow(content: string) {
    const res = await reminderApi.nudge({
      familyId: this.data.familyId,
      recipientMemberId: this.data.recipientMemberId,
      content,
    });

    // 三档文案的唯一定义处是 constants/delivery.ts（镜像自 @shared）
    toast(deliveryToast(res.deliveryStatus, this.data.recipientName), 2500);
  },

  /**
   * 定时叮 —— 到点才发，当下不知道送没送到。
   *
   * 返回 false 表示校验没过（调用方不要再往下走）。
   */
  async submitScheduled(content: string): Promise<boolean> {
    const whenAt = this.data.whenAt;
    if (!whenAt) {
      toast('选个时间吧');
      this.setData({ submitting: false });
      return false;
    }

    const repeating = this.data.repeatType !== 'NONE' && this.data.repeatConfig !== null;

    await thingApi.create({
      familyId: this.data.familyId,
      type: 'REMINDER',
      title: content,
      assigneeMemberId: this.data.recipientMemberId,
      dueAt: whenAt,
      recurrenceType: repeating ? this.data.repeatType : 'NONE',
      recurrenceConfig: repeating ? this.data.repeatConfig : null,
      // 叮一下的 dueAt 就是「要叮的时刻」，提醒与它同刻
      reminders: [{ remindType: 'SCHEDULED', remindAt: whenAt }],
    });

    // 还没到点，别说「已经叮到」——那是承诺一件还没发生的事
    toast(`到点会提醒${this.data.recipientName}的 🔔`);
    return true;
  },
});
