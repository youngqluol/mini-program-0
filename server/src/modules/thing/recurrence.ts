import { RecurrenceType } from '@shared/enums';
import type { RecurrenceConfig } from '@shared/dto/thing';

/**
 * 重复规则 → 下一次触发时刻。
 *
 * 只服务两个地方：
 *   ① 创建/编辑小事时算 `thing_reminders.next_remind_at`
 *   ② 调度器发完一条后，算下一条该在什么时候
 *
 * 约定（与 docs/02 §4.1 的 `recurrenceConfig` 一致）：
 *   DAILY   → { time: "09:00" }                  每天 09:00
 *   WEEKLY  → { weekdays: [1,3,5], time: "20:00" } 每周一三五 20:00（1=周一 … 7=周日）
 *   MONTHLY → { days: [1,15], time: "08:00" }     每月 1、15 号 08:00
 *
 * ⚠️ 全程按**北京时间**（进程 TZ=Asia/Shanghai）计算，与存储层的 UTC 无关 ——
 *    「每天 09:00」指的是家里的墙上时间，不是 UTC 09:00。
 *    返回的是正确的**时间点**（Date），Prisma 写库时会自己按 UTC 落盘。
 *
 * 返回 `null` 表示「不再重复」（NONE，或规则里没有可用字段）。
 */
export function nextOccurrence(
  recurrenceType: number,
  config: RecurrenceConfig | null | undefined,
  from: Date = new Date(),
): Date | null {
  if (recurrenceType === RecurrenceType.NONE || recurrenceType === undefined) return null;
  if (!config) return null;

  const [hour, minute] = parseTimeOfDay(config.time);
  if (hour == null || minute == null) return null;

  switch (recurrenceType) {
    case RecurrenceType.DAILY:
      return nextDaily(hour, minute, from);

    case RecurrenceType.WEEKLY: {
      const weekdays = normalizeWeekdays(config.weekdays);
      if (weekdays.length === 0) return null;
      return nextWeekly(weekdays, hour, minute, from);
    }

    case RecurrenceType.MONTHLY: {
      const days = normalizeMonthDays(config.days);
      if (days.length === 0) return null;
      return nextMonthly(days, hour, minute, from);
    }

    default:
      // CUSTOM 尚未开放（docs/05 归到 V0.2）
      return null;
  }
}

/**
 * 由「基准时间 + 重复规则」推出下一次时间，**严格晚于** `from`。
 * 用于生成重复小事的下一条实例（docs/02 §4.5）。
 */
export function nextOccurrenceAfter(
  recurrenceType: number,
  config: RecurrenceConfig | null | undefined,
  base: Date,
  from: Date = new Date(),
): Date | null {
  // 先从基准时间推一次；若仍早于「现在」，就再从「现在」推一次
  const first = nextOccurrence(recurrenceType, config, base);
  if (!first) return null;
  if (first.getTime() > from.getTime()) return first;
  return nextOccurrence(recurrenceType, config, from);
}

// ---------------------------------------------------------------
// 各频率实现
// ---------------------------------------------------------------

function nextDaily(hour: number, minute: number, from: Date): Date | null {
  const candidate = atTime(from, hour, minute);
  if (candidate.getTime() > from.getTime()) return candidate;
  const next = new Date(candidate);
  next.setDate(next.getDate() + 1);
  return next;
}

function nextWeekly(weekdays: number[], hour: number, minute: number, from: Date): Date | null {
  // 最多往后找 7 天，一定能命中
  for (let i = 0; i <= 7; i++) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);
    if (!weekdays.includes(isoWeekday(day))) continue;

    const candidate = atTime(day, hour, minute);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return null;
}

function nextMonthly(days: number[], hour: number, minute: number, from: Date): Date | null {
  // 往后找 13 个月，覆盖「本月已过 + 跨年」
  for (let i = 0; i <= 13; i++) {
    const monthCursor = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (const d of days) {
      if (d > daysInMonth) continue; // 2 月没有 30 号，跳过
      const candidate = new Date(year, month, d, hour, minute, 0, 0);
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

/** 在 `base` 这一天的 `hour:minute` */
function atTime(base: Date, hour: number, minute: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
}

/** JS 的 `getDay()` 是 0=周日；本项目的规则用 1=周一 … 7=周日 */
function isoWeekday(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

/** "09:00" → [9, 0]；非法返回 [null, null] */
function parseTimeOfDay(s: string | undefined): [number | null, number | null] {
  if (typeof s !== 'string') return [null, null];
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return [null, null];
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return [null, null];
  return [hour, minute];
}

function normalizeWeekdays(input: number[] | undefined): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort(
    (a, b) => a - b,
  );
}

function normalizeMonthDays(input: number[] | undefined): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((n) => Number.isInteger(n) && n >= 1 && n <= 31))].sort(
    (a, b) => a - b,
  );
}
