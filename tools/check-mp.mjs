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
 *   - `usingComponents` 路径写错 → 整个页面白屏，且报错指向组件而不是那一行
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
 *   ⑧ components/ 下每个组件的四件套齐全，index.ts 里有 `Component(` 调用，
 *      index.wxml 的绑定同样校验（组件写错了和页面写错了一样难查）
 *   ⑨ 所有 `usingComponents` 指向的组件真实存在
 *   ⑩ 未读角标挂的 Tab 下标与 app.json 的 tabBar 一致（挂错了不报错，只会挂到别的 Tab 上）
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MP = join(ROOT, 'miniprogram');

const problems = [];
const stats = { pages: 0, components: 0, files: 0, bindings: 0, json: 0, refs: 0 };

function fail(msg) {
  problems.push(msg);
}

function readText(rel) {
  return readFileSync(join(MP, rel), 'utf8');
}

function isFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function exists(rel) {
  return isFile(join(MP, rel));
}

/** 递归列出 miniprogram 下所有匹配后缀的文件（相对 MP 的 POSIX 路径） */
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
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

/** wxml 里的事件绑定：bindtap / bind:tap / catchtap / catch:tap */
const BIND_RE = /(?:bind|catch)[:]?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g;

/**
 * 校验 wxml 里的事件绑定在 ts 里有没有对应方法。
 *
 * 这是整个脚本最值钱的一项：绑定名写错**不会报错**，用户点下去毫无反应，
 * 开发时也看不出来（页面渲染得好好的）。
 */
function checkBindings(wxmlRel, tsRel, wxml, ts) {
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
// ⑩ 未读角标挂的 Tab 下标
// =============================================================
//
// `wx.setTabBarBadge` 只认**下标**，而 `utils/tab-badge.ts` 把「我的」的下标写死了。
// 调 Tab 顺序时忘了同步 → 角标悄悄挂到「留个念」上，不报错、也不白屏，
// 只有用户会觉得「消息红点怎么在那一栏」。

const MINE_PAGE = 'pages/mine/index';
const BADGE_SRC = 'utils/tab-badge.ts';

if (exists(BADGE_SRC)) {
  const src = readText(BADGE_SRC);
  const m = /MINE_TAB_INDEX\s*=\s*(\d+)/.exec(src);
  if (!m) {
    fail(`${BADGE_SRC} 里找不到 MINE_TAB_INDEX 的定义（这个检查需要同步）`);
  } else {
    const declared = Number(m[1]);
    const actual = tabList.findIndex((item) => item.pagePath === MINE_PAGE);
    if (actual < 0) {
      fail(`app.json 的 tabBar 里没有「${MINE_PAGE}」—— 未读角标无处可挂`);
    } else if (declared !== actual) {
      fail(
        `${BADGE_SRC} 的 MINE_TAB_INDEX = ${declared}，但「${MINE_PAGE}」在 app.json 的 ` +
          `tabBar 里是第 ${actual + 1} 项（下标 ${actual}）—— 角标会挂到别的 Tab 上，且不会报错`,
      );
    }
  }
}

// =============================================================
// ⑤⑥⑦ 逐页检查
// =============================================================

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

  checkBindings(wxmlRel, tsRel, wxml, ts);
}

// =============================================================
// ⑧ 组件
// =============================================================
//
// 组件目录约定与页面不同：**一个组件一个目录**，入口固定叫 index.*
// （页面是扁平文件 pages/<模块>/<页面>.ts，别把两套记混，见 docs/04 §5.1）

const COMPONENTS_DIR = join(MP, 'components');

/** 找出 components/ 下所有「含 index.json 的目录」 */
function findComponents(dir, out = [], depth = 0) {
  if (!existsSync(dir) || depth > 2) return out;
  const names = readdirSync(dir);
  if (names.includes('index.json')) {
    out.push(relative(MP, dir).split('\\').join('/'));
    return out; // 组件目录内部不再递归
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findComponents(full, out, depth + 1);
  }
  return out;
}

const components = findComponents(COMPONENTS_DIR);

for (const comp of components) {
  stats.components += 1;

  for (const ext of REQUIRED_EXT) {
    const rel = `${comp}/index${ext}`;
    stats.files += 1;
    if (!exists(rel)) fail(`组件文件缺失：${rel}（${comp} 会白屏）`);
  }
  if (!exists(`${comp}/index.wxss`)) {
    fail(`组件样式缺失：${comp}/index.wxss（约定每个组件都建 wxss）`);
  }

  const jsonRel = `${comp}/index.json`;
  if (exists(jsonRel)) {
    try {
      const json = JSON.parse(readText(jsonRel));
      stats.json += 1;
      if (json.component !== true) {
        fail(`${jsonRel} 里缺少 "component": true（会被当成页面处理）`);
      }
    } catch (e) {
      fail(`${jsonRel} 不是合法 JSON：${e.message}`);
    }
  }

  const tsRel = `${comp}/index.ts`;
  const wxmlRel = `${comp}/index.wxml`;
  if (!exists(tsRel) || !exists(wxmlRel)) continue;

  const ts = readText(tsRel);
  if (!/\bComponent\s*\(/.test(ts)) {
    fail(`${tsRel} 里没有 Component( 调用`);
  }

  checkBindings(wxmlRel, tsRel, readText(wxmlRel), ts);
}

// =============================================================
// ⑨ usingComponents 指向的组件是否存在
// =============================================================
//
// 路径写错的表现是「整个页面白屏」，报错还指向组件而不是那一行 json，
// 非常难查。这里提前把每个引用解析一遍。

const jsonOwners = [...walk(join(MP, 'pages'), ['.json']), ...walk(COMPONENTS_DIR, ['.json'])];

for (const owner of jsonOwners) {
  let json;
  try {
    json = JSON.parse(readText(owner));
  } catch {
    continue; // json 合法性已在 ⑤ / ⑧ 报过
  }

  const uc = json.usingComponents;
  if (!uc || typeof uc !== 'object') continue;

  for (const [name, spec] of Object.entries(uc)) {
    if (typeof spec !== 'string' || spec === '') continue;
    // 插件与 npm 包不在本仓库里，交给构建工具去解析
    if (spec.startsWith('plugin://')) continue;
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;

    stats.refs += 1;

    const base = spec.startsWith('/') ? join(MP, spec) : resolve(dirname(join(MP, owner)), spec);

    const missing = ['.ts', '.wxml', '.json'].filter((ext) => !isFile(base + ext));
    if (missing.length > 0) {
      fail(
        `${owner} 里 usingComponents 的「${name}」指向 ${spec}，` +
          `缺少 ${missing.join(' / ')}（页面会白屏）`,
      );
    }
  }
}

// =============================================================
// 汇总
// =============================================================

console.log(
  `扫描：${stats.pages} 个页面 / ${stats.components} 个组件 / ${stats.files} 个必备文件 / ` +
    `${stats.json} 个合法 json / ${stats.bindings} 处事件绑定 / ${stats.refs} 处组件引用`,
);

if (problems.length > 0) {
  console.error(`\n❌ 小程序端自查失败：${problems.length} 个问题\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
  process.exit(1);
}

console.log('✅ 小程序端自查通过');
