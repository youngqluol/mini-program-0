/**
 * 留个念的数量上限 —— **镜像**（第 4 份）
 *
 * ## 为什么必须再写一份
 *
 * 微信开发者工具的 TypeScript 编译插件由 `@babel/plugin-transform-typescript`
 * 实现，**只做类型擦除，不解析 tsconfig 的 `paths`**。于是小程序端：
 *
 *   `import type { X } from '@shared/...'`  → 整条被擦除，运行时安全 ✓
 *   `import { X } from '@shared'`           → 保留 `require('@shared')`，运行时崩 ✗
 *
 * 所以**类型可以引 shared，运行时的值必须在 `miniprogram/` 下重新定义一份**。
 * 权威来源：`packages/shared/src/dto/memory.ts` 的 `MEMORY_LIMITS`。
 *
 * ## 漂移了会怎样（为什么值得防）
 *
 * 这两个数字两边都用得上：后端拿它做 DTO 校验（超了回 40001），
 * 前端拿它做**输入框的 `maxlength` 与九宫格上限**。
 * 一旦漂移，用户会看到「明明还能再选一张，怎么发不出去」——
 * 或者更糟：前端放行、后端拒绝，报错文案指向的内容看起来完全正常。
 * `tools/check-shared.mjs` 就是这道防线（`pnpm run check:shared`）。
 *
 * ⚠️ 这里刻意**只有数字**，没有任何文案 —— 文案属于展示层，
 *    放在 `utils/memory-view.ts` 里（那里的函数是纯函数，可被 test-view 钉住）。
 */
export const MEMORY_LIMITS = {
  /** 一条记录最多几张图 */
  MAX_ATTACHMENTS: 9,
  /** 正文最长多少字 */
  CONTENT_MAX: 1000,
} as const;
