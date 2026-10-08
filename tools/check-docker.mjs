#!/usr/bin/env node
/**
 * Docker 构建上下文自检
 * =============================================================
 *
 * 背景（踩过的坑）：`server/Dockerfile` 的 COPY 源里有 `package.json`、
 * `pnpm-workspace.yaml`、`packages/shared` —— 说明**构建上下文是仓库根**。
 * 而 Docker 只读**上下文根**的 `.dockerignore`：规则曾经写在
 * `server/.dockerignore` 里，**从未生效过**，而且不报任何错。
 *
 * 不生效的后果不是「多拷几个文件」这么轻：
 *   本机是 Windows，`server/node_modules` 里是 **Windows 版 Prisma query
 *   engine**。Dockerfile 在容器内 `pnpm install` 装好 Linux 版之后，
 *   紧接着的 `COPY server ./server` 会把宿主机那份**原样盖回去** →
 *   容器启动即报「找不到当前平台的 query engine」。
 *   这类错误只在云托管构建时才暴露，本地跑不出来。
 *
 * 这个脚本把两条约束固化成断言：
 *   1. Dockerfile 里每个**同阶段** COPY 的源，在忽略规则过滤后仍然存在；
 *   2. `.dockerignore` 在仓库根、且含两条关键规则（用 `**` 匹配任意层级的
 *      node_modules 与 dist），
 *      同时 `server/.dockerignore` 不存在（存在即说明又放错位置了）。
 *
 * 用法：node tools/check-docker.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'server/Dockerfile';
const IGNORE_FILE = '.dockerignore';

/** 必须存在的忽略规则 —— 少一条就意味着上面那个「Windows 盖 Linux」的坑会重开 */
const REQUIRED_RULES = ['**/node_modules', '**/dist'];

// -------------------------------------------------------------
// 一、解析 .dockerignore
// -------------------------------------------------------------

/**
 * 把一条 .dockerignore 模式编译成正则。
 *
 * 语义按 Docker 的 `patternmatcher` 简化实现（够本项目用）：
 *   `**` 匹配任意层级（含 0 层）、`*` 不跨 `/`、`?` 匹配单个非 `/` 字符；
 *   不含 `/` 的模式匹配任意层级下的同名文件；
 *   模式命中「路径本身**或它的任一父目录**」即视为命中
 *   —— 所以末尾统一补 `(?:/.*)?`。
 */
function toRegExp(pattern) {
  const p = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const anchored = p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1;
        // `**/` 吃掉紧跟的斜杠，否则会要求至少一层目录
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

/** 最后一条命中的规则胜出 —— 与 Docker 的语义一致 */
function isIgnored(rules, relPath) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
}

// -------------------------------------------------------------
// 二、解析 Dockerfile 的 COPY
// -------------------------------------------------------------

/**
 * 抽出所有 COPY 指令。只处理「单行 + 反斜杠续行」两种写法（本项目够用）。
 * 返回 `{ lineNo, from, sources }`：`from` 非空表示跨阶段拷贝 ——
 * 源在 builder 镜像里，**不受 .dockerignore 影响**，要跳过。
 */
function parseCopies(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const lineNo = i + 1;
    while (line.trimEnd().endsWith('\\') && i + 1 < lines.length) {
      i += 1;
      line = `${line.trimEnd().slice(0, -1)} ${lines[i]}`;
    }
    const m = /^\s*COPY\s+(.*)$/i.exec(line);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/).filter(Boolean);
    const flags = parts.filter((p) => p.startsWith('--'));
    const rest = parts.filter((p) => !p.startsWith('--'));
    if (rest.length < 2) continue; // COPY src dest 至少两个参数
    out.push({
      lineNo,
      from: flags.find((f) => f.startsWith('--from=')) ?? '',
      sources: rest.slice(0, -1),
    });
  }
  return out;
}

const hasGlob = (s) => /[*?[\]]/.test(s);

/** 展开 glob。只支持「最后一段含通配符」这一种（`pnpm-lock.yaml*` 就是这种） */
function expandGlob(rel) {
  const slash = rel.lastIndexOf('/');
  const dir = slash < 0 ? '.' : rel.slice(0, slash);
  const base = slash < 0 ? rel : rel.slice(slash + 1);
  const absDir = resolve(ROOT, dir === '.' ? '' : dir);
  if (!existsSync(absDir)) return [];
  const re = new RegExp(
    `^${base
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`,
  );
  return readdirSync(absDir)
    .filter((n) => re.test(n))
    .map((n) => (dir === '.' ? n : `${dir}/${n}`));
}

// -------------------------------------------------------------
// 三、校验
// -------------------------------------------------------------

const problems = [];

// 3.1 忽略文件的位置与内容
let ignoreText = '';
if (!existsSync(resolve(ROOT, IGNORE_FILE))) {
  problems.push(
    `${IGNORE_FILE} 不存在。它**必须在仓库根** —— Docker 只读上下文根的忽略文件，` +
      '放在 server/ 下不会生效。',
  );
} else {
  ignoreText = readFileSync(resolve(ROOT, IGNORE_FILE), 'utf8');
}

if (existsSync(resolve(ROOT, 'server', IGNORE_FILE))) {
  problems.push(
    `server/${IGNORE_FILE} 存在。构建上下文是仓库根，这个位置的忽略文件**从不生效** —— ` +
      '留着只会让人误以为规则起作用了，请删掉。',
  );
}

if (ignoreText) {
  const present = parseIgnore(ignoreText).map((r) => r.pattern);
  for (const need of REQUIRED_RULES) {
    if (!present.includes(need)) {
      problems.push(
        `${IGNORE_FILE} 缺少必需规则「${need}」——` +
          '少了它，宿主机的 node_modules / dist 会被拷进镜像。',
      );
    }
  }
}

// 3.2 Dockerfile 的 COPY 源
const rules = ignoreText ? parseIgnore(ignoreText) : [];
const copies = parseCopies(readFileSync(resolve(ROOT, DOCKERFILE), 'utf8'));
let sameStage = 0;
let skipped = 0;

for (const copy of copies) {
  if (copy.from) {
    skipped += 1;
    continue;
  }
  for (const src of copy.sources) {
    sameStage += 1;
    const matches = hasGlob(src) ? expandGlob(src) : [src];
    if (matches.length === 0) {
      problems.push(`${DOCKERFILE}:${copy.lineNo}  COPY 源「${src}」在上下文里没匹配到任何文件。`);
      continue;
    }
    for (const rel of matches) {
      if (!existsSync(resolve(ROOT, rel))) {
        problems.push(`${DOCKERFILE}:${copy.lineNo}  COPY 源「${rel}」不存在。`);
      } else if (isIgnored(rules, rel)) {
        problems.push(
          `${DOCKERFILE}:${copy.lineNo}  COPY 源「${rel}」被 ${IGNORE_FILE} 排除了 —— ` +
            '构建会在这一步失败。',
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error('❌ Docker 构建上下文有问题：\n');
  problems.forEach((p) => console.error(`   ${p}`));
  console.error(
    '\n   上下文根 = 仓库根，Dockerfile = ' + DOCKERFILE + '（云托管部署时同样这么配）。',
  );
  process.exit(1);
}

console.log(
  `✅ Docker 构建上下文校验通过：${sameStage} 个同阶段 COPY 源全部可用` +
    `（另有 ${skipped} 个跨阶段拷贝，源在 builder 镜像里，不受忽略规则影响）`,
);
