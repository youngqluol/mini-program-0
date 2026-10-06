import { formatDateTime } from './beijing-time';

/**
 * 把任意对象转成可以安全 `JSON.stringify` 的结构。
 *
 * 为什么需要：
 *   ① Prisma 的 BIGINT 主键是 JS `bigint`，`JSON.stringify` 遇到它**直接抛**
 *      `TypeError: Do not know how to serialize a BigInt` —— 整个接口 500。
 *   ② Date 默认会序列化成 ISO UTC 串（`2026-09-20T02:00:00.000Z`），
 *      与 docs/02 §1.4 约定的 `"YYYY-MM-DD HH:mm:ss"`（北京时间）不符。
 *
 * 这是**安全网**，不是主路径：正常写法是 service 层就用
 * `formatDateTime()` / `toNumber()` 显式转好，DTO 里声明 string / number。
 * 兜底存在的意义是「即使有人漏了，也不会崩、不会发出错格式」。
 */
export function sanitizeForJson(input: unknown, seen = new WeakSet<object>()): unknown {
  if (input === null || input === undefined) return input;

  const t = typeof input;

  // ① bigint → number（家庭应用的 ID 量级不会溢出安全整数）
  if (t === 'bigint') return Number(input as bigint);

  if (t !== 'object') return input;

  // ② Date → 北京时间字符串
  if (input instanceof Date) return formatDateTime(input);

  // ③ 循环引用保护（Prisma 的关联对象可能自引用）
  if (seen.has(input as object)) return undefined;
  seen.add(input as object);

  // ④ 数组
  if (Array.isArray(input)) {
    return input.map((v) => sanitizeForJson(v, seen));
  }

  // ⑤ Buffer / TypedArray 等：原样交给 JSON.stringify 处理
  if (ArrayBuffer.isView(input as ArrayBufferView)) return input;

  // ⑥ 普通对象（含 Prisma 返回的 model 实例）
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const converted = sanitizeForJson(v, seen);
    if (converted !== undefined) out[k] = converted;
  }
  return out;
}
