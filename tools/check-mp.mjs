#!/usr/bin/env node
/**
 * 小程序端静态自查
 * =============================================================
 *
 * 为什么需要它：小程序有一类错误**编译不报、tsc 也不报**，只在运行时暴露，
 * 而且暴露得很安静：
 *   - 页面文件少一个（比如忘了建 .json）→ 开发者工具白屏，不告诉你是哪个文件
 *   - `bindtap="onSubmit"` 而 ts 里方法叫 `onSubmmit` → 点了没反应，控制台无提示
 *   - 写了页面但忘了在 `app.json` 注册 → 文件在那儿，但路由跳不过去
 *
 * 这个脚本把这些都提前拦下来。跑法：node tools/check-mp.mjs
 *
 * 检查项：
 *   ① app.json 可解析，pages 数组非空
 *   ② pages 里每个页面的 .ts / .wxml / .json 都存在（.wxss 建议存在）
 *   ③ pages/ 下每个 .ts 都在 app.json 注册了（防止「写了页面忘了注册」）
 *   ④ tabBar 的每个 pagePath 都在 pages 里
 *   ⑤ 每个页面 .json 是合法 JSON
 *   ⑥ wxml 里 `bind*=` / `catch*=` 绑定的方法名，在对应 .ts 里确实存在
 *   ⑦ 页面 .ts 里有 `Page(` 调用
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MP = join(ROOT, 'miniprogram');

const problems = [];
const stats = { pages: 0, files: 0, bindings: 0, json: 0 };

function fail(msg) {
  problems.push(msg);
}

function readText(rel) {
  return readFileSync(join(MP, rel), 'utf8');
}

function exists(rel) {
  try {
    return statSync(join(MP, rel)).isFile();
  } catch {
    return false;
  }
}

/** 递归列出 miniprogram 下所有匹配后缀的文件（相对 MP 的 POSIX 路径） */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(relative(MP, full).split('\\').join('/'));
    }
  }
  return out;
}

// =============================================================
// ① app.json
// =============================================================

let app;
try {
  app = JSON.parse(readText('app.json'));
} catch (e) {
  console.error(`❌ app.json 解析失败：${e.message}`);
  process.exit(1);
}

const pages = Array.isArray(app.pages) ? app.pages : [];
if (pages.length === 0) {
  console.error('❌ app.json 的 pages 为空');
  process.exit(1);
}

// =============================================================
// ② 页面四件套
// =============================================================

const REQUIRED_EXT = ['.ts', '.wxml', '.json'];
const SUGGESTED_EXT = ['.wxss'];

for (const page of pages) {
  stats.pages += 1;

  for (const ext of REQUIRED_EXT) {
    const rel = `${page}${ext}`;
    stats.files += 1;
    if (!exists(rel)) fail(`页面文件缺失：${rel}（app.json 注册了 ${page}）`);
  }

  for (const ext of SUGGESTED_EXT) {
    const rel = `${page}${ext}`;
    if (!exists(rel)) fail(`页面样式缺失：${rel}（约定每个页面都建 wxss）`);
  }
}

// =============================================================
// ③ 反向：pages/ 下有没有未注册的页面
// =============================================================

const allTs = walk(join(MP, 'pages'), ['.ts']);
const registered = new Set(pages);

for (const rel of allTs) {
  const route = rel.replace(/\.ts$/, '');
  if (!registered.has(route)) {
    fail(`页面未注册：${rel} 没有出现在 app.json 的 pages 里（路由跳不过去）`);
  }
}

// =============================================================
// ④ tabBar
// =============================================================

const tabList = app.tabBar && Array.isArray(app.tabBar.list) ? app.tabBar.list : [];
for (const item of tabList) {
  if (!item.pagePath) {
    fail('tabBar 有一项没有 pagePath');
    continue;
  }
  if (!registered.has(item.pagePath)) {
    fail(`tabBar 的 pagePath「${item.pagePath}」不在 app.json 的 pages 里`);
  }
}

// =============================================================
// ⑤⑥⑦ 逐页检查
// =============================================================

/** wxml 里的事件绑定：bindtap / bind:tap / catchtap / catch:tap */
const BIND_RE = /(?:bind|catch)[:]?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g;

for (const page of pages) {
  const jsonRel = `${page}.json`;
  if (exists(jsonRel)) {
    try {
      JSON.parse(readText(jsonRel));
      stats.json += 1;
    } catch (e) {
      fail(`${jsonRel} 不是合法 JSON：${e.message}`);
    }
  }

  const tsRel = `${page}.ts`;
  const wxmlRel = `${page}.wxml`;
  if (!exists(tsRel) || !exists(wxmlRel)) continue;

  const ts = readText(tsRel);
  const wxml = readText(wxmlRel);

  if (!/\bPage\s*\(/.test(ts) && !/\bComponent\s*\(/.test(ts)) {
    fail(`${tsRel} 里没有 Page( 或 Component( 调用`);
  }

  const re = new RegExp(BIND_RE.source, BIND_RE.flags);
  let m;
  const seen = new Set();
  while ((m = re.exec(wxml)) !== null) {
    const handler = m[1].trim();
    if (!handler || seen.has(handler)) continue;
    seen.add(handler);
    stats.bindings += 1;

    // ts 里的方法定义：`onFoo(` 或 `async onFoo(`，也兼容 `onFoo:`
    const defined =
      new RegExp(`(?:async\\s+)?\\b${handler}\\s*\\(`).test(ts) ||
      new RegExp(`\\b${handler}\\s*:`).test(ts);

    if (!defined) {
      fail(`${wxmlRel} 绑定了 ${handler}，但 ${tsRel} 里找不到这个方法（点了不会有反应）`);
    }
  }
}

// =============================================================
// 汇总
// =============================================================

console.log(
  `扫描：${stats.pages} 个页面 / ${stats.files} 个必备文件 / ` +
    `${stats.json} 个合法 json / ${stats.bindings} 处事件绑定`,
);

if (problems.length > 0) {
  console.error(`\n❌ 小程序端自查失败：${problems.length} 个问题\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
  process.exit(1);
}

console.log('✅ 小程序端自查通过');
