/**
 * 时间显示工具
 *
 * ⚠️ **iOS 的真实坑**：`new Date('2026-10-06 12:00:00')` 在 iOS 上返回
 *    `Invalid Date` —— 它只认 `YYYY/MM/DD HH:mm:ss` 或 ISO 8601（带 T 和时区）。
 *    后端统一返回的是 `"YYYY-MM-DD HH:mm:ss"`（北京时间，docs/01 §4.3），
 *    所以在小程序端**必须先把 `-` 换成 `/`** 再解析。
 *    这个坑只在真机 iOS 上暴露，模拟器和安卓都不报错 —— 最容易漏到线上。
 */

/** 把后端的北京时间字符串解析成 Date；解析失败返回 null */
export function parseBeijingTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 把过期时间说成人话：「3 天后过期」。
 *
 * 刻意不显示绝对时间（「10 月 9 日 12:00 过期」）—— 用户真正想知道的是
 * 「我现在还来得及吗」，相对时间才是这个问题的答案。
 */
export function describeExpire(expireAt: string): string {
  const d = parseBeijingTime(expireAt);
  if (!d) return '';

  const ms = d.getTime() - Date.now();
  if (ms <= 0) return '已经过期了';

  const hours = ms / 3600000;
  if (hours < 1) return '1 小时内过期';
  if (hours < 24) return `${Math.floor(hours)} 小时后过期`;
  return `${Math.floor(hours / 24)} 天后过期`;
}

// =============================================================
// 小事的日期 / 时间文案
// =============================================================

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function startOfDay(d: Date): Date {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * 把日期说成「今天 / 明天 / 昨天 / 10-08」。
 *
 * 刻意不说「10 月 8 日 18:00」这种绝对时间 —— 家里人看的是
 * 「这事儿是不是今天的」，相对时间才是答案。
 *
 * 跨年时退回完整日期（「2027-01-05」），否则「01-05」会让人以为是今年。
 */
export function describeDay(value: string): string {
  const d = parseBeijingTime(value);
  if (!d) return '';

  const diffDays = Math.round(
    (startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000,
  );
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays === -1) return '昨天';

  const sameYear = d.getFullYear() === new Date().getFullYear();
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return sameYear ? md : `${d.getFullYear()}-${md}`;
}

/** 「HH:mm」 */
export function hhmmOf(value: string): string {
  const d = parseBeijingTime(value);
  if (!d) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 「要求完成时间」说成人话：`今天 18:00` / `明天 07:00` / `不限时间`。
 *
 * 传 null 表示「不限时间」—— 这是产品上的正常选择，不是缺数据，
 * 所以文案要中性（不能写「未设置」，那听起来像没填完）。
 */
export function describeDue(value: string | null): string {
  if (!value) return '不限时间';
  const time = hhmmOf(value);
  const day = describeDay(value);
  if (!day) return '不限时间';
  return time ? `${day} ${time}` : day;
}

/**
 * 相对某一天的「时刻」：同一天只说 `18:05`，跨天才带上「昨天 18:05」。
 *
 * 用在**成对出现**的时间上 —— 「18:00 前完成」配「17:30 提醒」，
 * 两条都写「今天」是废话，还会把这一行挤长。单说一个时刻的场景
 * 用 `describeDue()`，那个要带上「今天 / 明天」才不至于有歧义。
 *
 * 不传 `base` 就与「今天」比。
 */
export function shortMoment(value: string, base?: string): string {
  const time = hhmmOf(value);
  if (!time) return '';
  const day = describeDay(value);
  if (!day) return time;
  return day === describeDay(base || todayDate()) ? time : `${day} ${time}`;
}

/** Date → 后端要的 `"YYYY-MM-DD HH:mm:ss"`（北京时间） */
export function toBeijingString(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 当前时间往后推 n 小时，返回后端要的字符串。
 *
 * 用途：P09 派活的「今天」默认值（契约是当前时间 + 2 小时）。
 */
export function beijingAfterHours(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return toBeijingString(d);
}

/** 今天的日期 `"YYYY-MM-DD"`（给 `<picker mode="date">` 的 start 用） */
export function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
