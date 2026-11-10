#!/usr/bin/env node
/**
 * 生成底部 Tab 图标（`ui/tabbar/*.svg` → `miniprogram/assets/tabbar/*.png`）。
 *
 * ## 为什么要有这个脚本，而不是把 PNG 直接扔进仓库
 *
 * Tab 图标有 **8 张**（4 个 Tab × 未激活 / 激活），它们除了颜色之外**形状完全一样**。
 * 手改一次颜色要重出 4 张图，改一次形状要重出 8 张 —— 这种活不该靠手工，
 * 而且「图」和「颜色令牌」一旦漂移，肉眼在开发者工具里很难看出来。
 *
 * 所以：**SVG 是唯一的设计来源**（`ui/tabbar/`，人类直接可读可改），
 * PNG 是产物（`miniprogram/assets/tabbar/`，小程序只认本地位图的 PNG）。
 * 改了 SVG 就重跑本脚本。
 *
 * ## 为什么用 qlmanage + sips，而不是装一个图像库
 *
 * 仓库的原则是**不为了一个小需求加依赖**（`pnpm-workspace.yaml` 里连 sharp 都没有）。
 * macOS 自带这两件够用：
 *
 * ```text
 * qlmanage -t -s 324   QuickLook 把 SVG 渲染成 324×324 PNG（4 倍超采样）
 * sips -z 81 81        缩到微信建议的 81×81（缩放自带抗锯齿）
 * ```
 *
 * 先超采样再缩小，是为了 81×81 上直接渲染时圆角和斜线会出现的锯齿。
 *
 * ⚠️ **只在 macOS 上能跑**（这两个命令是系统自带的）。图标是设计资产，
 *    产物已在仓库里，改 SVG 的人需要一台 Mac；CI 不跑这个脚本。
 *
 * ## 两条硬约束（微信文档里的限制，脚本会核对）
 *
 * - 尺寸 **81×81**（建议值；不是硬性，但 22px 显示 + 3 倍 DPR 刚好）
 * - 单张 **≤ 40KB**，超了小程序打包会直接报错
 *
 * 用法：`node tools/gen-tab-icons.mjs`
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC_DIR = 'ui/tabbar';
const OUT_DIR = 'miniprogram/assets/tabbar';
const SIZE = 81;
const SUPERSAMPLE = 4; // 先按 4 倍渲染再缩小，边缘才不锯齿
const BIG = SIZE * SUPERSAMPLE;
const MAX_BYTES = 40 * 1024;

/** 与 `docs/07` §6.10 同源：未激活 `--ink-3`，激活 `--brand-ink` */
const COLORS = {
  off: '#9B9B9B',
  on: '#F97E9B',
};

/** SVG 源里写死的颜色 —— 脚本按状态替换它，不在源文件里留模板变量 */
const SOURCE_COLOR = '#9B9B9B';

const ICONS = [
  { name: 'home', page: 'pages/index/index', text: '家里' },
  { name: 'dish', page: 'pages/menu/index', text: '吃啥呢' },
  { name: 'book', page: 'pages/memory/index', text: '留个念' },
  { name: 'me', page: 'pages/mine/index', text: '我的' },
];

// -------------------------------------------------------------
// 前置检查：两条系统命令都必须在
// -------------------------------------------------------------

for (const tool of ['qlmanage', 'sips']) {
  try {
    execFileSync('sh', ['-c', `command -v ${tool} >/dev/null`]);
  } catch {
    console.error(`❌ 找不到 ${tool} —— 这个脚本依赖 macOS 自带的 qlmanage / sips。`);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// 生成

const work = join(tmpdir(), `jyss-tab-icons-${process.pid}`);
mkdirSync(work, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const rows = [];
let failed = false;

for (const icon of ICONS) {
  const srcPath = join(SRC_DIR, `${icon.name}.svg`);
  if (!existsSync(srcPath)) {
    console.error(`❌ 缺少 SVG 源：${srcPath}`);
    failed = true;
    continue;
  }
  const source = readFileSync(srcPath, 'utf8');
  if (!source.includes(SOURCE_COLOR)) {
    console.error(`❌ ${srcPath} 里没有 ${SOURCE_COLOR}（脚本靠替换这个颜色出两种状态）`);
    failed = true;
    continue;
  }

  for (const state of ['off', 'on']) {
    const svg = source
      .split(SOURCE_COLOR)
      .join(COLORS[state])
      // ⚠️ 必须改**声明的尺寸**而不是只把 `-s` 调大：qlmanage 的 `-s` 是缩略图的
      //    **画布上限**，矢量并不会因此放大 —— 只调 -s 会得到「小图标贴在左上角、
      //    四周全是透明留白」，缩小后图标就没了。声明成 4 倍尺寸（viewBox 不变），
      //    它才真的按 4 倍光栅化，缩回 81×81 时边缘才是抗锯齿的。
      .replace(/width="\d+" height="\d+"/, `width="${BIG}" height="${BIG}"`);
    const svgPath = join(work, `${icon.name}-${state}.svg`);
    const rawPng = join(work, `${icon.name}-${state}.svg.png`);
    const outPath = join(OUT_DIR, `${icon.name}-${state}.png`);

    writeFileSync(svgPath, svg, 'utf8');
    // qlmanage 的输出文件名固定是「<输入名>.png」，落在 -o 指定的目录里
    execFileSync('qlmanage', ['-t', '-s', String(BIG), '-o', work, svgPath], {
      stdio: 'ignore',
    });
    if (!existsSync(rawPng)) {
      console.error(`❌ ${icon.name}-${state}：qlmanage 没有产出 PNG`);
      failed = true;
      continue;
    }
    execFileSync('sips', ['-z', String(SIZE), String(SIZE), rawPng, '--out', outPath], {
      stdio: 'ignore',
    });

    const size = statSync(outPath).size;
    const over = size > MAX_BYTES;
    if (over) failed = true;
    rows.push(
      `${over ? '❌' : '✅'} ${outPath}  ${SIZE}×${SIZE}  ${(size / 1024).toFixed(1)} KB` +
        (over ? '  超过微信的 40KB 上限' : ''),
    );
  }
}

rmSync(work, { recursive: true, force: true });

console.log(rows.join('\n'));
console.log(
  `\nTab 图标：${ICONS.length} 个形状 × 2 种状态 = ${rows.length} 张` +
    `（源在 ${SRC_DIR}/，改完 SVG 重跑本脚本）`,
);

if (failed) process.exit(1);

// -------------------------------------------------------------
// 顺手核对 app.json 有没有把 8 张图都填上
// -------------------------------------------------------------
// 这一步不判失败：图标没填时小程序照样能跑（只是 Tab 只有文字），
// 但「图都生成了却忘了填」是最容易漏的一种收尾，提示一句成本很低。

const appJsonPath = 'miniprogram/app.json';
if (existsSync(appJsonPath)) {
  const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const list = (app.tabBar && app.tabBar.list) || [];
  const missing = [];
  for (let i = 0; i < ICONS.length; i++) {
    const item = list[i] || {};
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (!item[key] || !existsSync(join('miniprogram', item[key]))) {
        missing.push(`${ICONS[i].text} 的 ${key}`);
      }
    }
  }
  if (missing.length) {
    console.log(`\n⚠️ app.json 的 tabBar 还没填全：${missing.join('、')}`);
  } else {
    console.log('\n✅ app.json 的 tabBar 八张图标都已填上');
  }
}
