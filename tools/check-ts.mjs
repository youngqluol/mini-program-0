// 用 Node 内置的 TS 类型剥离能力做语法校验（无需安装 typescript）
//
// 用法：  node tools/check-ts.mjs
//
// 覆盖范围：packages/shared 与 server 下的全部 .ts 文件。
// 只做语法校验，不做类型检查（类型检查需要真正的 tsc，见 pnpm typecheck）。
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const ROOTS = ['packages', 'server', 'miniprogram'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'miniprogram_npm']);

/** 递归收集 .ts 文件 */
function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => collect(r)).sort();

if (files.length === 0) {
  console.log('没有找到 .ts 文件');
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
  try {
    stripTypeScriptTypes(fs.readFileSync(f, 'utf8'), { mode: 'transform', sourceUrl: f });
    console.log('OK   ' + rel);
  } catch (e) {
    failed++;
    console.log('FAIL ' + rel + '\n     ' + e.message.split('\n')[0]);
  }
}

// =============================================================
// 小程序端不许 import `@shared` 的**运行时值**
// =============================================================
//
// 微信开发者工具的 TS 插件由 `@babel/plugin-transform-typescript` 实现，
// **只做类型擦除，不解析 tsconfig 的 `paths`**：
//
//   `import type { X } from '@shared/...'`  → 整条被擦除，运行时安全 ✓
//   `import { X } from '@shared'`           → 保留 `require('@shared')`，运行时崩 ✗
//
// ⚠️ **这个错误在开发者工具里不报错、在类型检查里也不报错** ——
//    类型是对的，只有真机（或模拟器）跑到那一行才会 `module not found`。
//    所以必须在这里静态拦下。运行时的值请在 `miniprogram/` 下再定义一份，
//    并由 `tools/check-shared.mjs` 防漂移。
//
// 只查「有花括号且不带 `type` 关键字」的具名导入；`import '@shared/x'`
// 这种副作用导入与 `import * as ns` 同样危险，一并算上。
const SHARED_RUNTIME_IMPORT = /^\s*import\s+(?!type\b)(?:[^'"]*?from\s+)?['"](@shared[^'"]*)['"]/gm;

const violations = [];
for (const f of files) {
  const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
  if (!rel.startsWith('miniprogram/')) continue;

  const src = fs.readFileSync(f, 'utf8');
  const re = new RegExp(SHARED_RUNTIME_IMPORT.source, SHARED_RUNTIME_IMPORT.flags);
  let m;
  while ((m = re.exec(src)) !== null) {
    violations.push({ rel, line: src.slice(0, m.index).split('\n').length, spec: m[1] });
  }
}

if (violations.length > 0) {
  console.error('\n❌ 小程序端引用了 @shared 的运行时值（只允许 `import type`）：');
  for (const v of violations) {
    console.error(`   ${v.rel}:${v.line}  ← ${v.spec}`);
  }
  console.error(
    '\n   微信开发者工具不解析 tsconfig 的 paths，这行会在真机上 module not found。\n' +
      '   做法：类型继续从 @shared 引（`import type`），运行时的值在\n' +
      '   miniprogram/constants/ 下再定义一份，并加进 tools/check-shared.mjs 的 PAIRS。',
  );
  failed += violations.length;
}

console.log(
  failed === 0
    ? `\n${files.length} 个文件全部通过语法校验`
    : `\n${failed} 处问题（语法错误 + @shared 运行时引用）`,
);
process.exit(failed === 0 ? 0 : 1);
