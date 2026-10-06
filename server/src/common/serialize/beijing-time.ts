/**
 * 北京时间格式化 —— **接口层唯一的时间出口**。
 *
 * 为什么这样做（改之前先读 docs/01 §4.3）：
 *
 *   Prisma 的 MySQL 连接器不支持连接串里的 `?timezone=+08:00`
 *   （prisma/orm#29517 至今 open），它固定按 UTC 处理 DATETIME：
 *     写 → 按 UTC 格式化字符串落库
 *     读 → 把库里的串无条件当作 UTC，构造带 Z 的 Date
 *   所以「应用写 → Prisma 读」是自洽的，读回来的 Date 是**正确的时间点**。
 *
 *   而 Node 进程设了 `TZ=Asia/Shanghai`，因此对这个 Date 调本地 getter
 *   （getFullYear / getHours ...）拿到的**就是北京时间**，不需要任何换算。
 *
 *   结论：存储层统一 UTC，北京时间只在这里格式化一次。
 *   业务代码里**不要**再出现 `toISOString()` 或手写时间格式化。
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "YYYY-MM-DD HH:mm:ss"（北京时间）。入参为空返回 null，便于直接塞进 DTO。 */
export function formatDateTime(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 同 `formatDateTime`，但用于**必填**字段，返回值非 null。 */
export function formatDateTimeRequired(d: Date): string {
  return formatDateTime(d) as string;
}

/**
 * "YYYY-MM-DD"（北京时间）。
 *
 * 对 `@db.Date` 字段（如 `meal_records.meal_date`）同样适用：
 * Prisma 会返回 UTC 零点的 Date，+08:00 下本地仍是同一天，日期部分正确。
 */
export function formatDate(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 同 `formatDate`，但用于必填字段。 */
export function formatDateRequired(d: Date): string {
  return formatDate(d) as string;
}

/**
 * 把前端传来的 `"YYYY-MM-DD HH:mm:ss"` 解析成 Date。
 *
 * ⚠️ 必须手动拼 `+08:00`：`new Date('2026-09-20 10:00:00')` 在 V8 里
 *    会按**本地时区**解析，看起来能用，但一旦部署环境的 TZ 不是
 *    Asia/Shanghai 就会静默错 8 小时。显式带偏移量才稳。
 */
export function parseBeijingDateTime(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec ?? '00'}+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 把前端传来的 `"YYYY-MM-DD"` 解析成 UTC 零点的 Date（对应 `@db.Date` 列） */
export function parseBeijingDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Prisma 的 BIGINT 主键 → 接口层用的 number。
 *
 * 家庭应用的 ID 量级远不到 `Number.MAX_SAFE_INTEGER`，转 number 是安全的，
 * 而且前端少一层字符串处理。（若将来真的溢出，再改成字符串。）
 */
export function toNumber(v: bigint | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === 'number' ? v : Number(v);
}

/** 同 `toNumber`，但用于必填字段。 */
export function toNumberRequired(v: bigint | number): number {
  return typeof v === 'number' ? v : Number(v);
}

/**
 * 北京时间「今天」的起止区间 —— `[今日 00:00:00, 明日 00:00:00)`。
 *
 * 用 `[start, end)` 半开区间而不是 `[start, end]`：SQL 里写
 * `dueAt >= start AND dueAt < end` 就够，不用管毫秒，也不会把
 * 次日 00:00:00.000 误算进今天。
 *
 * 依赖进程 `TZ=Asia/Shanghai`（项目约定，见 docs/01 §4.3）——
 * `new Date(y, m, d)` 走本地时区，在 +08:00 下得到的就是北京时间的当天零点。
 */
export function beijingDayRange(at: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, 0, 0, 0, 0);
  return { start, end };
}

/** 北京时间 "HH:mm"（用于「今日提醒」这类只显示时刻的场景） */
export function formatTimeOfDay(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 北京时间「今天 + `dayOffset` 天」的零点。
 *
 * `beijingDayRange()` 只回答「今天」，而「最近 3 天吃过的」这类窗口需要往前推 ——
 * 用 `new Date(y, m, d + dayOffset)` 而不是 `getTime() - n * 86400000`：
 * 前者由 Date 自己处理跨月跨年，后者要自己算闰年。中国不实行夏令时，
 * 两种写法结果一样，但前者更难写错。
 */
export function beijingDayStartOffset(dayOffset: number, at: Date = new Date()): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + dayOffset, 0, 0, 0, 0);
}
