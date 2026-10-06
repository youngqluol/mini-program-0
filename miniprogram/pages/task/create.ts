/**
 * P09 · 派个活（M2-F6）
 *
 * 一屏问完六件事：干啥 / 派给谁 / 什么时候 / 重复 / 要不要叮一下 / 谁能看见。
 * 拆成多步会让「派个活」这件小事显得很重 —— 而它本来只需要一句话。
 *
 * 几个刻意的取舍：
 *
 * 1. **「什么时候」默认「今天 · 当前时间 + 2 小时」**，但**不由 time-picker 自己兜底**。
 *    组件里空值就是「不限时间」（那是产品的正常选择，不是缺数据）；
 *    「派活默认给个时间」是 P09 这个页面的判断，所以默认值写在这里。
 *    哪天 P08 想要别的默认值，也不用去改组件的语义。
 *
 * 2. **「重复」与「叮一下」都依赖 `dueAt`**：没有时间就推不出「每周六几点」，
 *    也不知道提前多久提醒。所以两者在 `dueAt` 为空时一起置灰 ——
 *    而不是偷偷替用户选一个时间。
 *
 * 3. **`remindAt` 存完整时间串，不存 "HH:mm"**：截止时间在凌晨时，
 *    「提前 30 分钟」会落到前一天。只存时刻就会把提醒丢到错误的日期上。
 *
 * 校验（docs/03 P09）：标题必填；执行人必选。备注可空。
 */

import type { FamilyMember } from '@shared/dto/family';
import type {
  RecurrenceConfig,
  RecurrenceTypeValue,
  ReminderInput,
  ThingVisibilityValue,
} from '@shared/dto/thing';
import * as familyApi from '../../services/family';
import * as thingApi from '../../services/thing';
import * as userStore from '../../stores/user';
import { guardEntry } from '../../utils/route';
import {
  beijingAfterHours,
  hhmmOf,
  parseBeijingTime,
  shortMoment,
  toBeijingString,
} from '../../utils/time';
import { toast, toastError } from '../../utils/toast';

/** 叮一下默认提前多少分钟（docs/03 P09 交互细节 2） */
const REMIND_AHEAD_MINUTES = 30;

interface PickerEvent {
  detail: { value: string };
}

/** 基准时间往前推 n 分钟；解析不了返回空串 */
function minusMinutes(base: string, minutes: number): string {
  const d = parseBeijingTime(base);
  if (!d) return '';
  d.setMinutes(d.getMinutes() - minutes);
  return toBeijingString(d);
}

Page({
  data: {
    familyId: 0,
    members: [] as FamilyMember[],

    title: '',
    content: '',
    /** 执行人；0 表示还没选 */
    assigneeMemberId: 0,

    /** `''` 表示不限时间 —— 与 time-picker 的契约一致 */
    dueAt: '',
    repeatType: 'NONE' as RecurrenceTypeValue,
    repeatConfig: null as RecurrenceConfig | null,

    remindOn: false,
    /** 完整时间串；提交时用它 */
    remindAt: '',
    /** 时间 picker 的当前值 "HH:mm" */
    remindTime: '',
    /** 给人看的提醒时刻 */
    remindText: '',

    visibility: 'FAMILY' as ThingVisibilityValue,
    submitting: false,
  },

  onLoad() {
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    if (!family) return;

    // 默认「今天 · 当前时间 + 2 小时」，并顺手把叮一下打开
    const dueAt = beijingAfterHours(2);
    this.setData({ familyId: family.familyId, dueAt });
    this.syncRemind(dueAt, true);

    void this.loadMembers();
  },

  async loadMembers() {
    try {
      const members = await familyApi.listMembers(this.data.familyId);
      this.setData({ members });
    } catch (e) {
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 表单
  // ---------------------------------------------------------------

  onTitleInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ title: e.detail.value });
  },

  onContentInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ content: e.detail.value });
  },

  onPickAssignee(e: WechatMiniprogram.CustomEvent<{ memberId: number }>) {
    this.setData({ assigneeMemberId: e.detail.memberId });
  },

  onDueChange(e: WechatMiniprogram.CustomEvent<{ value: string | null }>) {
    const dueAt = e.detail.value || '';
    this.setData({ dueAt });
    this.syncRemind(dueAt, false);
  },

  /**
   * 截止时间变了，提醒时间跟着重算（保持「提前 30 分钟」的关系）。
   *
   * `keepOn` 只用于初次进页面：那时要把开关默认打开；
   * 用户自己改时间时不该把开关又拨回去。
   */
  syncRemind(dueAt: string, keepOn: boolean) {
    if (!dueAt) {
      // 没有截止时间就无从「提前」——开关置灰且关掉，不留一个骗人的开状态
      this.setData({ remindOn: false, remindAt: '', remindTime: '', remindText: '' });
      return;
    }

    const remindAt = minusMinutes(dueAt, REMIND_AHEAD_MINUTES);
    this.setData({
      remindOn: keepOn ? true : this.data.remindOn,
      remindAt,
      remindTime: hhmmOf(remindAt),
      remindText: shortMoment(remindAt, dueAt),
    });
  },

  onRemindToggle(e: WechatMiniprogram.SwitchChange) {
    this.setData({ remindOn: e.detail.value });
  },

  onRemindTime(e: PickerEvent) {
    const time = String(e.detail.value);
    const [h, m] = time.split(':').map(Number);

    // 日期沿用原来那条提醒的（可能是截止时间的前一天）
    const d = parseBeijingTime(this.data.remindAt || this.data.dueAt);
    if (!d || Number.isNaN(h) || Number.isNaN(m)) return;
    d.setHours(h, m, 0, 0);

    const remindAt = toBeijingString(d);
    this.setData({
      remindAt,
      remindTime: time,
      remindText: shortMoment(remindAt, this.data.dueAt),
    });
  },

  onRepeatChange(
    e: WechatMiniprogram.CustomEvent<{
      value: RecurrenceTypeValue;
      config: RecurrenceConfig | null;
    }>,
  ) {
    this.setData({ repeatType: e.detail.value, repeatConfig: e.detail.config });
  },

  onPickVisibility(e: WechatMiniprogram.TouchEvent) {
    this.setData({ visibility: e.currentTarget.dataset.v as ThingVisibilityValue });
  },

  // ---------------------------------------------------------------
  // 提交
  // ---------------------------------------------------------------

  async onSubmit() {
    if (this.data.submitting) return;

    const title = this.data.title.trim();
    if (!title) {
      toast('要干啥呢？写一句吧');
      return;
    }
    if (!this.data.assigneeMemberId) {
      toast('选一下派给谁');
      return;
    }

    const dueAt = this.data.dueAt || null;

    const reminders: ReminderInput[] =
      this.data.remindOn && dueAt && this.data.remindAt
        ? [{ remindType: 'SCHEDULED', remindAt: this.data.remindAt }]
        : [];

    // 没有基准时间就推不出周几 / 几号，规则是空的 —— 与其发一个后端算不出
    // 下一次的规则过去，不如就按「不重复」提交（界面上也已经是这个状态）
    const repeating = this.data.repeatType !== 'NONE' && this.data.repeatConfig !== null;

    this.setData({ submitting: true });

    try {
      await thingApi.create({
        familyId: this.data.familyId,
        type: 'TASK',
        title,
        content: this.data.content.trim() || null,
        assigneeMemberId: this.data.assigneeMemberId,
        visibility: this.data.visibility,
        dueAt,
        recurrenceType: repeating ? this.data.repeatType : 'NONE',
        recurrenceConfig: repeating ? this.data.repeatConfig : null,
        reminders,
      });

      toast(this.doneToast());
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      toastError(e);
      this.setData({ submitting: false });
    }
  },

  /** 派给自己和派给别人的说法不一样 —— 后者才有「送到了」这层意思 */
  doneToast(): string {
    const me = this.data.members.filter((m) => m.memberId === this.data.assigneeMemberId)[0];
    if (me && me.isMe) return '自己的事，记下啦～';
    return `已经把活派给${me ? me.roleName : '他'}啦～`;
  },
});
