/**
 * 把一次 `fetch()` 失败展开成一句能定性的日志。
 *
 * `fetch()` 的失败分两类，形态不一样（实测）：
 *   · **超时** → `TimeoutError: The operation was aborted due to timeout`，没有 `cause`；
 *   · **连接没建立** → `TypeError: fetch failed`，原因全在 `cause` 的 `code` + `message` 里
 *     （DNS：`ENOTFOUND getaddrinfo ...`；TCP：`ETIMEDOUT connect ...`；
 *     证书：`DEPTH_ZERO_SELF_SIGNED_CERT self-signed certificate`）。
 *
 * 只打 `e.message` 时后三类在日志里长得一模一样，而它们在云托管上的
 * 处理手段完全不同，所以这里把 `cause` 摊平。（`syscall` / `hostname` 不打：
 * 实测它们总是已经出现在 `cause.message` 里了。）
 */
export function describeFetchFailure(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  const detail = cause ? [cause.code, cause.message].filter(Boolean).join(' ') : '';
  return detail ? `${e.name}: ${e.message} <- ${detail}` : `${e.name}: ${e.message}`;
}
