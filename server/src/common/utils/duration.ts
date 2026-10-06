/**
 * 时长字符串 → 秒。
 *
 * 环境变量里的 `JWT_EXPIRES_IN` 写成 `7d` / `12h` / `30m` 更易读，
 * 但接口要返回的是**秒数**（docs/02 §2.1 的 `expiresIn`）。
 * 与其在两处各写一遍 604800，不如解析一次。
 *
 * 支持：`s` 秒 / `m` 分 / `h` 时 / `d` 天 / 纯数字（按秒）。
 * 解析不了就返回兜底值 —— 配置写错不该让服务起不来。
 */
export function parseDurationSeconds(input: string | undefined, fallback: number): number {
  if (!input) return fallback;

  const m = /^(\d+)\s*([smhd])?$/i.exec(input.trim());
  if (!m) return fallback;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallback;

  switch ((m[2] ?? 's').toLowerCase()) {
    case 'd':
      return n * 24 * 60 * 60;
    case 'h':
      return n * 60 * 60;
    case 'm':
      return n * 60;
    default:
      return n;
  }
}
