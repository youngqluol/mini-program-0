/**
 * 重复规则选择器（P09 派活 / P08 叮一下 共用）
 *
 * ⚠️ **没有「每天」**：PRD §6.3 把「每天」明确划到 V0.2（一年 365 次，订阅额度
 *    撑不住；且高频重复实质上接近「自动催办」，与「少打扰」原则冲突）。
 *    docs/03 早期稿子里写的「每天 / 每周」是错的，已按 PRD 修正为「每周 / 每月」。
 *
 * 为什么周几 / 几号不单独让用户选：
 *   用户已经用「什么时候」说清了「周六 09:00」。再问一次「周几？」既是重复劳动，
 *   又制造了两次回答不一致的可能（选了周六，周几那栏却点成周一）。
 *   所以这里只做**语义选择**，具体规则从 `baseAt` 推出来，并显示成
 *   「每周六 09:00」让人一眼能核对。
 *
 * 契约：`value` 是 `NONE` / `WEEKLY` / `MONTHLY`；
 *      抛出的 `config` 形如 `{ weekdays: [6], time: "09:00" }`（见 docs/02 §4.1）。
 */

import type { RecurrenceConfig } from '@shared/dto/thing';
import { hhmmOf, parseBeijingTime } from '../../utils/time';

type RecurrenceKey = 'NONE' | 'WEEKLY' | 'MONTHLY';

interface RecurrenceOption {
  key: RecurrenceKey;
  label: string;
}

const OPTIONS: RecurrenceOption[] = [
  { key: 'NONE', label: '不重复' },
  { key: 'WEEKLY', label: '每周' },
  { key: 'MONTHLY', label: '每月' },
];

/** JS 的 `getDay()` 是 0=周日；本项目的规则用 1=周一 … 7=周日（见 recurrence.ts） */
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 基准时间 → 重复规则。推不出来（没时间）返回 null。 */
function buildConfig(key: RecurrenceKey, baseAt: string): RecurrenceConfig | null {
  const d = parseBeijingTime(baseAt);
  if (!d) return null;

  const time = hhmmOf(baseAt);
  if (key === 'WEEKLY') {
    const js = d.getDay();
    return { weekdays: [js === 0 ? 7 : js], time };
  }
  if (key === 'MONTHLY') {
    return { days: [d.getDate()], time };
  }
  return null;
}

/** 规则说成人话：「每周六 09:00」/「每月 8 号 09:00」 */
function buildHint(key: RecurrenceKey, baseAt: string): string {
  if (key === 'NONE') return '';

  const d = parseBeijingTime(baseAt);
  if (!d) return '';

  const time = hhmmOf(baseAt);
  if (key === 'WEEKLY') return `每周${WEEKDAY_CN[d.getDay()]} ${time}`;
  if (key === 'MONTHLY') return `每月 ${d.getDate()} 号 ${time}`;
  return '';
}

Component({
  properties: {
    /** `NONE` / `WEEKLY` / `MONTHLY` */
    value: { type: String, value: 'NONE' },
    /** 基准时间 `"YYYY-MM-DD HH:mm:ss"`；周几 / 几号与时刻都从它推 */
    baseAt: { type: String, value: '' },
    /** 没有基准时间时（不限时间）置 true —— 推不出规则，只能不重复 */
    disabled: { type: Boolean, value: false },
  },

  data: {
    options: OPTIONS,
    hint: '',
    /**
     * 最近一次抛出去的 `值|规则` 指纹。
     *
     * 页面拿到 change 后会 setData 回 value / config，observer 于是再跑一遍；
     * 而 baseAt 变化时本组件**也要主动重抛**（规则是从 baseAt 推的）。
     * 两个方向叠加就会互相触发。用指纹挡住自己抛出去的那一轮。
     */
    echo: '',
  },

  observers: {
    'value, baseAt'(value: string, baseAt: string) {
      const key = (value || 'NONE') as RecurrenceKey;
      this.setData({ hint: buildHint(key, baseAt) });

      // 基准时间变了 → 规则里的周几 / 几号与时刻必须跟着重算。
      // 不重抛的话，页面手里还攥着改时间之前算出来的旧配置。
      if (key === 'NONE') return;

      const config = buildConfig(key, baseAt);
      const stamp = `${key}|${JSON.stringify(config)}`;
      if (stamp === this.data.echo) return;

      this.setData({ echo: stamp });
      this.triggerEvent('change', { value: key, config });
    },
  },

  methods: {
    onPick(e: WechatMiniprogram.TouchEvent) {
      if (this.data.disabled) return;

      const key = e.currentTarget.dataset.key as RecurrenceKey;
      if (key === this.data.value) return;

      const config = buildConfig(key, this.data.baseAt);
      this.setData({ echo: `${key}|${JSON.stringify(config)}` });
      this.triggerEvent('change', { value: key, config });
    },
  },
});
