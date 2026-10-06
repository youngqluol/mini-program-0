import { Transform, Type, type TransformFnParams } from 'class-transformer';

/**
 * 宽松布尔值 → 真布尔值。
 *
 * ⚠️ **不要直接写 `@Transform(toQueryBoolean)`，用 `@ParseBoolean()`。**
 * 直接写的话，在全局 `enableImplicitConversion: true` 下**这个函数根本
 * 拿不到原始字符串**，见下面「为什么必须配 `@Type(() => String)`」。
 * 保留 `export` 只是为了让 `@ParseBoolean()` 引用它。
 *
 * ## 为什么不能写 `@Type(() => Boolean)`
 *
 * 查询参数到手时**永远是字符串**。`@Type(() => Boolean)` 实际执行的是
 * `Boolean('false')` —— 而**非空字符串一律为真**，于是
 * `?excludeRecent=false` 会变成 `true`。这是个「看起来生效、实际反了」的坑：
 * 参数传了、校验过了、代码跑了，只有行为是错的，而且**不报错**。
 * 而且它只在「显式传 false」时才暴露 —— 不传时走默认值，一切正常，
 * 所以很难在开发期碰到。
 *
 * ## 取值规则
 *
 * - 真：`true` / `1` / `yes`（大小写不敏感）
 * - 假：`false` / `0` / `no`
 * - 空串、`null`、`undefined`、**以及任何不认识的写法** → 返回 `undefined`
 *
 * 不认识的写法**当没传**、走 DTO 的默认值，而不是猜一个。
 * 猜错的代价是行为静默改变；当没传的代价只是用了默认值。
 */
export function toQueryBoolean({ value }: TransformFnParams): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;

  const s = String(value).trim().toLowerCase();
  if (s === '') return undefined;
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return undefined;
}

/**
 * DTO 里的布尔字段装饰器 —— **必须用它，不要手写 `@Transform(toQueryBoolean)`**。
 *
 * 用法：
 * ```ts
 * @IsOptional()
 * @ParseBoolean()
 * @IsBoolean({ message: '这个开关不对' })
 * excludeRecent?: boolean;
 * ```
 *
 * ## 为什么必须配 `@Type(() => String)`
 *
 * 因为全局 `ValidationPipe` 开了 `enableImplicitConversion: true`
 * （`app.module.ts`），而 `@IsBoolean` 字段的 TS 类型是 `boolean`，
 * 反射出来的 `design:type` 就是 `Boolean` —— class-transformer 会**先**按它
 * 隐式转换，**后**才跑我们的 `@Transform`：
 *
 * ```js
 * // class-transformer/cjs/TransformOperationExecutor.js（PLAIN_TO_CLASS 分支）
 * finalValue = this.transform(subSource, subValue, type, ...);      // ← 隐式转换在这里
 * finalValue = this.applyCustomTransformations(finalValue, ...);    // ← @Transform 才在这里
 * ```
 *
 * 于是 `'false'` 先被 `Boolean('false')` 变成 **`true`**，
 * `toQueryBoolean` 收到的已经是个布尔 `true`（函数里 `typeof === 'boolean'` 直接返回），
 * 原始字符串**丢了** —— 结果就是 `?excludeRecent=false` 静默地等于 `true`。
 *
 * 这个坑**实测过**：M3 冒烟脚本里 `excludeRecent=false` 与 `=0` 都无效，
 * `poolSize` 恒等于「排除之后」的值。加上 `@Type(() => String)` 后
 * 类型元数据变成 `String`，隐式转换只做 `String(value)`（字符串原样），
 * `toQueryBoolean` 这才拿得到 `'false'`。
 *
 * ## 为什么不干脆去掉 `enableImplicitConversion`
 *
 * 因为项目里有一批数字字段（`report-subscribe-quota.dto.ts` 的 `count`、
 * `create-invite.dto.ts` 的 `expireInHours`、`thing.dto.ts` 的 `pageSize` …）
 * **没写 `@Type(() => Number)`**，正是靠这个全局开关把 `'5'` 转成 `5`。
 * 关掉它会让那些接口的 `@IsInt` 直接报错 —— 那是更大的破坏面。
 * 所以选择在**本地**堵住布尔这一处。
 *
 * ## 对 `null` / `undefined` 是安全的
 *
 * `@Type(() => String)` 走的是 class-transformer 的标量分支，那里显式写了
 * `if (value === null || value === undefined) return value;` —— 不碰空值，
 * 于是 `@IsOptional()` 仍然正常生效。
 *
 * 顺带一提：body 里的布尔字段（JSON 传的是**真布尔**）本不受影响，
 * 但一并挂上 `@ParseBoolean()` 更稳 —— 将来若有人把接口从 body 挪到 query，
 * 或者客户端把 `false` 序列化成了字符串，行为都不会静默改变。
 */
export function ParseBoolean(): PropertyDecorator {
  return (target: object, key: string | symbol): void => {
    Type(() => String)(target, key);
    Transform(toQueryBoolean)(target, key);
  };
}

/**
 * 可空的数字 ID —— `null` / `undefined` / **空串** 一律成 `null`。
 *
 * ## 为什么不能只用 `@Type(() => Number)`
 *
 * 实测（class-transformer 0.5 + class-validator 0.14）：
 *
 * | 输入 | `@Type(() => Number)` | 本函数 |
 * | --- | --- | --- |
 * | `null` | `null` ✅ | `null` |
 * | `undefined` | `undefined` ✅ | `null` |
 * | `''` | **`0`** ❌ | `null` |
 * | `5` / `'7'` | `5` / `7` ✅ | 同 |
 * | `'abc'` | `NaN` → 校验报错 ✅ | `NaN` → 校验报错 |
 *
 * 也就是说 `@Type` 对 `null` 是安全的（它不碰 `null`/`undefined`），
 * **坑在空串**：`Number('') === 0`，于是 `@Min(1)` 报「参数不对」——
 * 可前端传空串的本意是「没选」，不是「选了第 0 号」。
 * 系统菜谱的 `menuItemId` 恰恰允许为空（它是可选的线索字段），
 * 所以这里必须显式把空串收敛成 `null`。
 *
 * 解析不了的写法（`'abc'`）**原样返回**，交给校验器报错 ——
 * 不静默当成 `null`，否则「传错了」会变成「没传」，是更难查的问题。
 */
export function toNullableNumber({ value }: TransformFnParams): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (s === '') return null;
  // 解析不了得到 NaN —— 原样返回，让 `@IsInt` / `@Min` 报错
  return Number(s);
}
