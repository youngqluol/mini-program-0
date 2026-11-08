#!/usr/bin/env node
/**
 * 云托管「手动上传代码包」打包器
 * =============================================================
 *
 * 用途：把仓库打成**云托管能直接构建的最小代码包**。
 *
 * 云托管的代码来源有五条路（GitHub / GitLab / Gitee / 手动上传代码包 / 拉取镜像）。
 * 走「手动上传代码包」时有两个硬约束：
 *
 *   ① **`README` 里写的「代码 zip 不超过 2 MiB」** —— 而本仓库
 *      （排除依赖后）约 4.8 MB，**原样打包一定传不上去**。
 *      必须裁掉「后端镜像根本用不到」的目录：小程序、原型、文档、
 *      建表脚本、自检工具、推送 Worker。
 *
 *   ② **包根 = Docker 构建上下文** —— 所以包根必须放 `.dockerignore` 和
 *      `Dockerfile`（**都在仓库根**，云托管只扫包根找 Dockerfile），
 *      且必须包含 Dockerfile 里所有 COPY 源
 *      （`package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` /
 *      `server` / `packages/shared`）。
 *
 * ⚠️ 关键设计：**包内容 = 仓库减去 `.dockerignore` 的忽略项**，
 *    不另写一份「要打哪些目录」的清单。
 *    理由：清单会漂移 —— 以后往 `.dockerignore` 加规则、或 Dockerfile
 *    多 COPY 一个目录，手写清单不会跟着变，而云端构建失败时你人在控制台，
 *    排查链路比本地长得多。让 `.dockerignore` 当**唯一事实来源**，
 *    本地 Docker 构建和云端代码包走的是同一套规则，行为天然一致。
 *
 * 用法：
 *   node tools/pack-deploy.mjs                 # 产出到 ../jyss-deploy-artifacts/
 *   node tools/pack-deploy.mjs --out D:/x.zip  # 指定输出文件
 *
 * 自检：产出的包会逐一核对 Dockerfile 的 COPY 源是否都在包内；
 *       体积超过 2 MiB 会**明确报错**（而不是等你上传时被拒）。
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'Dockerfile';
const IGNORE_FILE = '.dockerignore';

/** 云托管代码包上限：2 MiB（超过会被控制台直接拒收） */
const SIZE_LIMIT = 2 * 1024 * 1024;

/** 走目录时无条件跳过的名字 —— 与忽略规则一致，且能避免遍历几十万个依赖文件 */
const PRUNE_DIRS = new Set(['.git', 'node_modules']);

// -------------------------------------------------------------
// 一、解析 .dockerignore（与 tools/check-docker.mjs 同一套语义）
// -------------------------------------------------------------

function toRegExp(pattern) {
  const p = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const anchored = p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1;
        if (p[i + 1] === '/') i += 1;
        re += '(?:.*/)?';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  const body = anchored ? re : `(?:.*/)?${re}`;
  return new RegExp(`^${body}(?:/.*)?$`);
}

function parseIgnore(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = negated ? line.slice(1) : line;
    rules.push({ negated, pattern, re: toRegExp(pattern) });
  }
  return rules;
}

/** 最后一条命中的规则胜出 —— 与 Docker 语义一致 */
function isIgnored(rules, relPath) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
}

// -------------------------------------------------------------
// 二、收集要打包的文件
// -------------------------------------------------------------

function walk(dir, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (PRUNE_DIRS.has(ent.name)) continue;
    const abs = join(dir, ent.name);
    // 符号链接一律跳过：pnpm 的 node_modules 里全是链接，
    // 而且 zip 存链接语义各家实现不一致，跳过最稳。
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      walk(abs, out);
    } else if (ent.isFile()) {
      out.push(relative(ROOT, abs).split(sep).join('/'));
    }
  }
}

// -------------------------------------------------------------
// 三、ZIP 写入（零依赖：zlib 负责 deflate，这里手写容器格式）
// -------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 固定时间戳，让**同样输入产出字节一致的 zip** ——
 * 便于比对「这次发的包和上次差在哪」，也让脚本可被断言式测试。
 * DOS 时间从 1980 年起算：2026-01-01 00:00:00。
 */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // 标志位：文件名为 UTF-8
    local.writeUInt16LE(8, 8); // 压缩方法：deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度
    parts.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // 中央目录头签名
    cd.writeUInt16LE(20, 4); // 创建者版本
    cd.writeUInt16LE(20, 6); // 解压所需版本
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // 扩展字段
    cd.writeUInt16LE(0, 32); // 注释
    cd.writeUInt16LE(0, 34); // 起始磁盘号
    cd.writeUInt16LE(0, 36); // 内部属性
    cd.writeUInt32LE(0, 38); // 外部属性
    cd.writeUInt32LE(offset, 42); // 本地文件头偏移
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocd]);
}

// -------------------------------------------------------------
// 四、核对 Dockerfile 的 COPY 源都在包里
// -------------------------------------------------------------

function parseCopySources(text) {
  const sources = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    while (line.trimEnd().endsWith('\\') && i + 1 < lines.length) {
      i += 1;
      line = `${line.trimEnd().slice(0, -1)} ${lines[i]}`;
    }
    const m = /^\s*COPY\s+(.*)$/i.exec(line);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/).filter(Boolean);
    if (parts.some((p) => p.startsWith('--from='))) continue; // 跨阶段，源在 builder 镜像里
    const rest = parts.filter((p) => !p.startsWith('--'));
    if (rest.length < 2) continue;
    sources.push(...rest.slice(0, -1));
  }
  return sources;
}

/**
 * 判断 Dockerfile 的某个 COPY 源是否在包内。
 * COPY 源**既可能是文件也可能目录**（`server` / `packages/shared` 都是目录），
 * 所以无通配符时先按文件命中，再按「有文件落在该目录下」判定。
 */
function matchesInPackage(rel, packaged) {
  if (!/[*?[\]]/.test(rel)) {
    return packaged.has(rel) || [...packaged].some((p) => p.startsWith(`${rel}/`));
  }
  const slash = rel.lastIndexOf('/');
  const dir = slash < 0 ? '' : rel.slice(0, slash);
  const base = slash < 0 ? rel : rel.slice(slash + 1);
  const re = new RegExp(
    `^${base
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`,
  );
  return [...packaged].some((p) => {
    const s = p.lastIndexOf('/');
    return (s < 0 ? '' : p.slice(0, s)) === dir && re.test(s < 0 ? p : p.slice(s + 1));
  });
}

// -------------------------------------------------------------
// 五、主流程
// -------------------------------------------------------------

const outArg = process.argv.indexOf('--out');
const outFile =
  outArg >= 0 && process.argv[outArg + 1]
    ? resolve(process.argv[outArg + 1])
    : resolve(ROOT, '..', 'jyss-deploy-artifacts', 'jyss-api-code.zip');

if (!existsSync(resolve(ROOT, IGNORE_FILE))) {
  console.error(`❌ 找不到 ${IGNORE_FILE} —— 它必须在仓库根（构建上下文根）。`);
  process.exit(1);
}
if (!existsSync(resolve(ROOT, DOCKERFILE))) {
  console.error(`❌ 找不到 ${DOCKERFILE}。`);
  process.exit(1);
}

const rules = parseIgnore(readFileSync(resolve(ROOT, IGNORE_FILE), 'utf8'));

const all = [];
walk(ROOT, all);
const files = all.filter((rel) => !isIgnored(rules, rel)).sort();

const absent = parseCopySources(readFileSync(resolve(ROOT, DOCKERFILE), 'utf8')).filter(
  (src) => !matchesInPackage(src, new Set(files)),
);
if (absent.length > 0) {
  console.error('❌ 包内缺少 Dockerfile 需要的 COPY 源：');
  absent.forEach((s) => console.error(`   ${s}`));
  console.error('   多半是 .dockerignore 里有规则误伤了它 —— 这份包的构建一定会失败。');
  process.exit(1);
}

const entries = files.map((rel) => ({ name: rel, data: readFileSync(resolve(ROOT, rel)) }));
const totalRaw = entries.reduce((n, e) => n + e.data.length, 0);
const zip = buildZip(entries);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, zip);

const relOut = relative(ROOT, outFile).split(sep).join('/');
const shown = relOut.startsWith('..') ? outFile : relOut;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

console.log('📦 云托管代码包已生成\n');
console.log(`   输出      ${shown}`);
console.log(`   文件数    ${entries.length}`);
console.log(`   打包前    ${mb(totalRaw)}`);
console.log(`   压缩后    ${mb(zip.length)}${zip.length > SIZE_LIMIT ? '  ⚠️ 超过 2 MiB' : ''}`);
console.log(`   Dockerfile ${DOCKERFILE} 的 COPY 源已全部核对 ✅`);

if (zip.length > SIZE_LIMIT) {
  console.error(
    '\n❌ 超过云托管 2 MiB 上限，上传会被拒。\n' +
      '   往 .dockerignore 里补几条排除规则再重跑（它同时约束本地 Docker 与这份包）。',
  );
  process.exit(1);
}

console.log(
  '\n   控制台里填：Dockerfile 路径 = ' + DOCKERFILE + ' ／ 目标目录 = 留空（根） ／ 端口 = 3000',
);
