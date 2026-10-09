/**
 * 环境变量校验与类型化配置。
 *
 * 设计取舍：
 *   - `ConfigModule` 用 `isGlobal: true`，各处直接 `config.get('WXPUSH_URL')`
 *     读**扁平**的环境变量名。所以这里不做 namespace 嵌套 —— 嵌套会让
 *     已有代码里的 `config.get('XXX')` 全部失效。
 *   - 校验分两档：
 *       **缺失即启动失败**（essential）：缺了根本跑不起来，早失败好过运行期 500
 *       **缺失只告警**（optional）：本地开发可能还没配，不该拦住启动
 */

/** 缺了就启动失败 —— 这些是跑起来的最低要求 */
const ESSENTIAL_KEYS = [
  'DATABASE_URL',
  'WX_APPID',
  'WX_SECRET',
  'JWT_SECRET',
] as const;

/**
 * 缺失只告警 —— 对应的功能会**自动降级**，不影响启动。
 * 例如没配 WXPUSH_* 时，通知通道一会跳过，走订阅消息 / 站内消息。
 */
const OPTIONAL_KEYS = [
  'WXPUSH_URL',
  'WXPUSH_TOKEN',
  'MP_TEMPLATE_TASK',
  'MP_TEMPLATE_REMINDER',
  'MP_TEMPLATE_DONE',
  'MP_CALLBACK_TOKEN',
  // 订阅消息（辅助通道）—— 三个模板已在小程序后台建好（M0-15），
  // 没配的话通道二会自动跳过，只走公众号模板 + 站内消息
  'WX_TEMPLATE_TASK',
  'WX_TEMPLATE_NUDGE',
  'WX_TEMPLATE_DONE',
  'COS_BUCKET',
  'COS_REGION',
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
  // ⚠️ **这一条不是「优雅降级」，是「核心功能静默死掉」**，必须单独警惕：
  //    没配它 → `InternalSecretGuard` 一律拒绝（这是对的，不能留后门）→
  //    云托管 Cron 打进来的 tick 全 403 → **提醒永远不会发出去**（站内兜底也不会写，
  //    因为写入发生在 dispatch 里），而服务照常启动、接口照常 200。
  //    它原本不在这两个清单里，于是漏配时**连一行 warn 都没有** ——
  //    放进来至少能出现在启动日志里（docs/06 §5.15 要求逐条对）。
  'INTERNAL_CRON_SECRET',
] as const;

export interface ValidatedEnv {
  [key: string]: string | undefined;
}

/**
 * 由 `ConfigModule.forRoot({ validate })` 调用。
 *
 * 返回值会作为最终配置对象。这里直接透传原始环境变量（扁平），
 * 只做「必填检查 + 告警」。
 */
export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const env = config as ValidatedEnv;
  const missing: string[] = [];

  for (const key of ESSENTIAL_KEYS) {
    const v = env[key];
    if (v == null || String(v).trim() === '') missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `缺少必需的环境变量：${missing.join(', ')}\n` +
        '请参考 server/.env.example 补齐后重启。',
    );
  }

  const warnings: string[] = [];
  for (const key of OPTIONAL_KEYS) {
    const v = env[key];
    if (v == null || String(v).trim() === '') warnings.push(key);
  }

  if (warnings.length > 0) {
    // 用 console 而不是 Logger：此刻 Nest 的日志系统还没起来
    console.warn(
      `[env] 以下环境变量未配置，相关功能会自动降级（不影响启动）：\n  ${warnings.join('\n  ')}`,
    );
  }

  return env;
}

/** 常用配置的类型化读取，避免各处 `Number(config.get('PORT'))` 重复写 */
export function readAppConfig(env: ValidatedEnv) {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 3000),
    isProd: env.NODE_ENV === 'production',
  };
}
