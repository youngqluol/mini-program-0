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

console.log(
  failed === 0
    ? `\n${files.length} 个文件全部通过语法校验`
    : `\n${failed} / ${files.length} 个文件有语法错误`,
);
process.exit(failed === 0 ? 0 : 1);
