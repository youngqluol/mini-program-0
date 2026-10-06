#!/usr/bin/env node
/**
 * check-links.mjs —— Markdown 内部链接校验
 *
 * 为什么需要它：
 *   本项目文档多、交叉引用密（docs/01~08 + 产品需求文档 + 数据模型 + 数据库设计 + AGENTS.md + README.md）。
 *   一旦移动 / 重命名某个文档，散落各处的相对路径会静默失效——Markdown 不会报错，
 *   但读者点进去就是 404。这个脚本把它们一次性揪出来。
 *
 * 用法：
 *   node tools/check-links.mjs
 *
 * 行为：
 *   - 递归扫描仓库内所有 .md（跳过 node_modules / .git / .workbuddy-ai）
 *   - 校验 [文本](目标) 形式的链接，解析为绝对路径后检查文件是否存在
 *   - 跳过 http(s) / mailto / 纯锚点(#)
 *   - 发现失效链接时以非 0 退出码结束，可直接用于 CI 或 pre-commit
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy-ai', 'dist', 'build']);

/** 递归收集所有 .md 文件 */
function collectMarkdownFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectMarkdownFiles(path.join(dir, entry.name), acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

/** 从一段 markdown 文本里抽出所有链接目标 */
function extractTargets(source) {
  const targets = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = re.exec(source)) !== null) targets.push(match[1]);
  return targets;
}

const files = collectMarkdownFiles(ROOT);
const broken = [];
let checked = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const fromDir = path.dirname(file);

  for (const raw of extractTargets(source)) {
    // 外部链接与页内锚点不检查
    if (/^(https?:|mailto:|tel:|#)/i.test(raw)) continue;

    checked += 1;

    const withoutAnchor = decodeURIComponent(raw.split('#')[0]);
    if (!withoutAnchor) continue; // 形如 (#section)

    const resolved = path.resolve(fromDir, withoutAnchor);
    if (!fs.existsSync(resolved)) {
      broken.push({ file: path.relative(ROOT, file), raw });
    }
  }
}

if (broken.length === 0) {
  console.log(`✅ 链接校验通过：${files.length} 个 Markdown 文件，${checked} 个内部链接，0 失效`);
  process.exit(0);
}

console.error(`❌ 发现 ${broken.length} 个失效链接（共检查 ${checked} 个）：\n`);
for (const { file, raw } of broken) {
  console.error(`   ${file}\n     └─ 指向不存在的位置: ${raw}\n`);
}
console.error('提示：文档移动 / 重命名后，记得同步所有引用它的地方（见 AGENTS.md §10 文档同步规则）。');
process.exit(1);
