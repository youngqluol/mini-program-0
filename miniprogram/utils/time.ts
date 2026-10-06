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
