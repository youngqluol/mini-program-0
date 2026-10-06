/**
 * 「什么时候」选择器（P09 派活）
 *
 * 三档：不限 / 今天 / 指定。
 *
 * 为什么不用一个 `mode="multiSelector"` 搞定：
 *   1. 用户脑子里想的是「今天还是改天」，不是「哪年哪月哪日」——先选语义再选时刻，
 *      比一上来甩一个日期滚轮少想一步
 *   2. 「不限时间」是产品上的正常选择（V0.1 允许派活不设时间），
 *      它不属于任何日期滚轮，必须单独一格
 *
 * ⚠️ 契约：`value` 是后端要的北京时间字符串 `"YYYY-MM-DD HH:mm:ss"`，
 *    空串 / null 表示「不限时间」。组件抛出去的也是同一种格式（或 null）。
 *    日期只认 `"YYYY-MM-DD"`（picker 的原生格式），别在这里塞中文。
 */

import { beijingAfterHours, describeDay, todayDate } from '../../utils/time';

type Segment = 'NONE' | 'TODAY' | 'CUSTOM';

interface SegmentOption {
  key: Segment;
  label: string;
}

const SEGMENTS: SegmentOption[] = [
  { key: 'NONE', label: '不限' },
  { key: 'TODAY', label: '今天' },
  { key: 'CUSTOM', label: '指定' },
];

/** picker 的 change 事件形状（自己声明，不依赖 typings 里具体叫什么名字） */
interface PickerEvent {
  detail: { value: string };
}

/** `"YYYY-MM-DD"` → 「今天 / 明天 / 10-08」 */
function dayText(date: string): string {
  return describeDay(`${date} 00:00:00`) || date;
}

Component({
  properties: {
    /** `"YYYY-MM-DD HH:mm:ss"`（北京时间）；空串表示不限时间 */
    value: { type: String, value: '' },
    /** 小事已完成 / 已取消时置 true，整体只读 */
    disabled: { type: Boolean, value: false },
  },

  data: {
    segments: SEGMENTS,
    segment: 'NONE' as Segment,
    /** 日期 `"YYYY-MM-DD"`，picker 的原生格式 */
    date: '',
    /** 时间 `"HH:mm"` */
    time: '',
    /** 日期的中文显示（今天 / 明天 / 10-08） */
    dateText: '',
    /** 日期 picker 的最早可选日 —— 派活不能派到过去 */
    minDate: '',
    /**
     * 最近一次**由本组件抛出去**的值。
     *
     * 页面拿到 `change` 后一般会 `setData` 回 `value`，于是 observer 又跑一遍。
     * 如果不认这个标记，就会出这种事：用户点「指定」→ 组件把日期默认成今天 →
     * 值回到组件 → observer 一看「日期是今天」→ 把选中项改回「今天」。
     * 用户眼睁睁看着自己点的「指定」跳回去了。
     */
    echo: '',
  },

  lifetimes: {
    attached() {
      // 默认值 = 当前时间 + 2 小时（docs/03 P09 交互细节 1）
      const plus2 = beijingAfterHours(2);
      this.setData({
        minDate: todayDate(),
        date: plus2.slice(0, 10),
        time: plus2.slice(11, 16),
      });
      this.applyValue(this.data.value || '');
    },
  },

  observers: {
    value(next: string) {
      const v = next || '';
      if (v === this.data.echo) return;
      this.applyValue(v);
    },
  },

  methods: {
    /** 把外部的值同步成内部三段状态 */
    applyValue(v: string) {
      if (!v) {
        this.setData({ segment: 'NONE', dateText: '' });
        return;
      }

      const date = v.slice(0, 10);
      const time = v.slice(11, 16);
      this.setData({
        segment: date === todayDate() ? 'TODAY' : 'CUSTOM',
        date,
        time: time || this.data.time,
        dateText: dayText(date),
      });
    },

    onSeg(e: WechatMiniprogram.TouchEvent) {
      if (this.data.disabled) return;

      const seg = e.currentTarget.dataset.seg as Segment;
      if (seg === this.data.segment) return;

      if (seg === 'NONE') {
        this.setData({ segment: 'NONE' });
        this.emit();
        return;
      }

      if (seg === 'TODAY') {
        const plus2 = beijingAfterHours(2);
        const date = plus2.slice(0, 10);
        const time = plus2.slice(11, 16);

        // 23:30 的时候「现在 + 2 小时」已经跨到明天了。
        // 与其显示「今天 01:30」这种假话，不如把选择切到「指定」、把日期摆在明面上。
        const crossed = date !== todayDate();
        this.setData({
          segment: crossed ? 'CUSTOM' : 'TODAY',
          date,
          time,
          dateText: dayText(date),
        });
        this.emit();
        return;
      }

      // CUSTOM：先把日期摆出来（沿用当前值），再由用户去改
      this.setData({ segment: 'CUSTOM', dateText: dayText(this.data.date) });
      this.emit();
    },

    onDate(e: PickerEvent) {
      const date = String(e.detail.value);
      this.setData({ date, dateText: dayText(date) });
      this.emit();
    },

    onTime(e: PickerEvent) {
      this.setData({ time: String(e.detail.value) });
      this.emit();
    },

    /** 内部状态 → 后端格式，抛给页面 */
    emit() {
      const { segment, date, time } = this.data;

      let out = '';
      if (segment === 'TODAY') out = `${todayDate()} ${time}:00`;
      else if (segment === 'CUSTOM') out = `${date} ${time}:00`;

      this.setData({ echo: out });
      this.triggerEvent('change', { value: out === '' ? null : out });
    },
  },
});
