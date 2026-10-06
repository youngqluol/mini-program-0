#!/usr/bin/env node
/**
 * 共享常量一致性校验
 * =============================================================
 *
 * 背景：微信开发者工具的 TypeScript 编译插件由 `@babel/plugin-transform-typescript`
 * 实现，官方文档写明它「仅仅是移除了 ts 代码中类型声明等信息」——
 * **只做类型擦除，不解析 tsconfig 的 paths**。
 *
 * 于是小程序端出现一条硬约束：
 *   `import type { X } from '@shared/...'`  → 整条被擦除，运行时安全 ✓
 *   `import { X } from '@shared'`           → 保留 require('@shared')，运行时崩 ✗
 *
 * 结论：**类型可以引 shared，运行时的值必须在 `miniprogram/` 下重新定义一份。**
 * 那就有漂移风险 —— 这个脚本就是那道防线：把镜像与权威来源逐个比对。
 *
 * 用法：node tools/check-shared.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每个条目 = 一份镜像。
 *
 * `source` 是权威来源，`mirror` 是副本；
 * `sourceBlock` / `mirrorBlock` 是各自的块起始标记（从它开始截到第一个行首 `}`）——
 * 两边写法不同是刻意的：权威来源用 `enum`，镜像用 `as const` 对象
 * （Babel 的 TS 插件默认不转换 `enum`，见镜像文件头部说明）；
 * `sourcePattern` / `mirrorPattern` 分别从各自块里抠出「键 → 数值」。
 */
const PAIRS = [
  {
    name: 'ErrorCode',
    source: 'packages/shared/src/error-codes.ts',
    mirror: 'miniprogram/constants/error-code.ts',
    sourceBlock: 'export enum ErrorCode {',
    mirrorBlock: 'export const ErrorCode = {',
    sourcePattern: /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm,
    mirrorPattern: /^\s*([A-Z][A-Z0-9_]*)\s*:\s*(\d+)\s*,/gm,
  },
];

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function sliceBlock(src, marker, file) {
  const start = src.indexOf(marker);
  if (start < 0) {
    throw new Error(`${file} 里找不到块起始标记「${marker}」`);
  }
  const end = src.indexOf('\n}', start);
  if (end < 0) {
    throw new Error(`${file} 里「${marker}」没有找到收尾的 }`);
  }
  return src.slice(start, end);
}

function extract(block, pattern) {
  const out = new Map();
  // 每次都用新的正则实例：带 g 标志的 RegExp 有 lastIndex 状态，复用会漏匹配
  const re = new RegExp(pattern.source, pattern.flags);
  let m;
  while ((m = re.exec(block)) !== null) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

let failed = 0;
let checked = 0;

for (const pair of PAIRS) {
  let src;
  let mir;
  try {
    src = extract(
      sliceBlock(read(pair.source), pair.sourceBlock, pair.source),
      pair.sourcePattern,
    );
    mir = extract(
      sliceBlock(read(pair.mirror), pair.mirrorBlock, pair.mirror),
      pair.mirrorPattern,
    );
  } catch (e) {
    console.error(`❌ ${pair.name}：${e.message}`);
    failed += 1;
    continue;
  }

  if (src.size === 0) {
    console.error(`❌ ${pair.name}：从 ${pair.source} 里没解析出任何成员（正则或格式变了？）`);
    failed += 1;
    continue;
  }

  const problems = [];

  for (const [key, value] of src) {
    if (!mir.has(key)) {
      problems.push(`  缺少 ${key} = ${value}（${pair.mirror} 里没有这个成员）`);
    } else if (mir.get(key) !== value) {
      problems.push(`  ${key} 数值不一致：权威来源 ${value}，镜像 ${mir.get(key)}`);
    }
  }
  for (const [key, value] of mir) {
    if (!src.has(key)) {
      problems.push(`  多余 ${key} = ${value}（${pair.source} 里没有这个成员）`);
    }
  }

  checked += src.size;

  if (problems.length > 0) {
    failed += 1;
    console.error(`❌ ${pair.name} 不一致（${pair.source} ↔ ${pair.mirror}）：`);
    problems.forEach((p) => console.error(p));
  } else {
    console.log(`  ok  ${pair.name}：${src.size} 个成员一致`);
  }
}

if (failed > 0) {
  console.error(`\n❌ 共享常量校验失败：${failed} 处不一致`);
  console.error('   镜像文件的权威来源见各自头部注释。改权威来源必须同步改镜像。');
  process.exit(1);
}

console.log(`✅ 共享常量校验通过：${PAIRS.length} 份镜像，共 ${checked} 个成员一致`);
