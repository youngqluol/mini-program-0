#!/usr/bin/env node
/**
 * 内容安全（msgSecCheck）实探脚本 —— M2-B9
 * ------------------------------------------------------------
 * 和 `tools/probe-subscribe.mjs` 对称：那个探订阅消息，这个探文本内容安全。
 *
 * 什么时候用：
 *   ① 第一次确认这个小程序能不能调 `security.msgSecCheck`
 *      —— 个人主体 / 未开通的账号会返回 `48001 api unauthorized`，
 *         此时服务端只会记一条 warn 然后**放行**（fail-open），
 *         从日志里看不出到底是「没权限」还是「网络抖动」。
 *   ② 验证「违规内容真的会被拦」—— 服务端拦下来只回 40002，
 *         看不到微信给的 `suggest` / `label`。这是**唯一**能看到原始结论的方式。
 *   ③ 排查误判 —— 传一段被误伤的正常文案，看 label 是多少。
 *
 * 用法：
 *   node tools/probe-seccheck.mjs                       # 用库里最近登录的用户 + 一段正常文案
 *   node tools/probe-seccheck.mjs --text="今晚吃火锅"     # 指定文案
 *   node tools/probe-seccheck.mjs --openid=oXXXX         # 指定 openid
 *   node tools/probe-seccheck.mjs --text="<你自己准备的违规样本>"
 *
 * ⚠️ 脚本**不含**任何违规词 —— 要验「拦得住」，请自己传一段违规文案进来。
 *    这个仓库不该留那种字符串。
 *
 * 退出码：0 微信给出了结论 / 1 判不了（网络、凭证、无权限）
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 输出工具 ----------
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};
const ok = (m) => console.log(`${c.green}✅ ${m}${c.reset}`);
const bad = (m) => console.log(`${c.red}❌ ${m}${c.reset}`);
const warn = (m) => console.log(`${c.yellow}⚠️  ${m}${c.reset}`);
const info = (m) => console.log(`${c.dim}   ${m}${c.reset}`);
const step = (m) => console.log(`\n${c.cyan}${c.bold}▸ ${m}${c.reset}`);

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const argOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

const DEFAULT_TEXT = '明天记得买牛奶和鸡蛋';

// ---------- 读 server/.env ----------
function readEnv(path) {
  const env = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return env;
}

const envPath = resolve(ROOT, 'server/.env');
if (!existsSync(envPath)) {
  bad(`找不到 ${envPath}`);
  info('先按 server/.env.example 建一份 server/.env');
  process.exit(1);
}
const env = readEnv(envPath);

if (!env.WX_APPID || !env.WX_SECRET) {
  bad('server/.env 里缺 WX_APPID / WX_SECRET，换不到 access_token');
  process.exit(1);
}

// ---------- openid ----------
async function resolveOpenid() {
  const fromArg = argOf('openid') ?? process.env.OPENID;
  if (fromArg) {
    info(`openid 来自命令行/环境变量：${mask(fromArg)}`);
    return fromArg;
  }

  process.env.DATABASE_URL = env.DATABASE_URL;
  const require_ = createRequire(import.meta.url);
  let PrismaClientCtor;
  try {
    ({ PrismaClient: PrismaClientCtor } = require_(
      resolve(ROOT, 'server/node_modules/@prisma/client'),
    ));
  } catch (e) {
    bad('加载 @prisma/client 失败，先跑 `cd server && pnpm install && pnpm run prisma:generate`');
    throw e;
  }

  const prisma = new PrismaClientCtor();
  try {
    // 取最近登录的**真实**用户。
    // 冒烟夹具造的 openid（`smoke_xxx`，8 字符）不是微信的，
    // 传过去必然 40003 —— 那验的是「请求形状对不对」，验不了结论。
    const candidates = await prisma.user.findMany({
      where: { openid: { not: '' } },
      orderBy: { lastLoginAt: 'desc' },
      take: 50,
      select: { openid: true, nickname: true },
    });
    const user = candidates.find((u) => isRealOpenid(u.openid));
    if (!user) {
      bad(`库里的 ${candidates.length} 个 openid 都是测试夹具，没有真实微信 openid`);
      info('用 --openid= 指定一个真实的，或者用小程序真机登录一次');
      info('（假 openid 只能验到 40003，说明凭证与请求形状 OK，但看不到 suggest）');
      process.exit(1);
    }
    info(`openid 取自库里最近登录的真实用户（${user.nickname ?? '未设昵称'}）：${mask(user.openid)}`);
    return user.openid;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 像不像微信发的 openid。
 *
 * 判据是「长度 ≥ 20 且不以 `smoke_` 开头」—— 真实 openid 是 28 字符的
 * base64url 串。不写死 28 是为了换 appid / 换主体时不用改脚本。
 */
function isRealOpenid(openid) {
  return typeof openid === 'string' && openid.length >= 20 && !openid.startsWith('smoke_');
}

function mask(openid) {
  if (!openid || openid.length <= 8) return '***';
  return `${openid.slice(0, 4)}***${openid.slice(-4)}`;
}

// ---------- 微信调用 ----------
async function getAccessToken() {
  const url =
    'https://api.weixin.qq.com/cgi-bin/token' +
    `?grant_type=client_credential&appid=${encodeURIComponent(env.WX_APPID)}` +
    `&secret=${encodeURIComponent(env.WX_SECRET)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  if (!data.access_token) {
    bad(`换 access_token 失败：errcode=${data.errcode} errmsg=${data.errmsg}`);
    if (data.errcode === 40164) {
      info('40164 = 调用方 IP 不在白名单。到小程序后台「开发管理 → 开发设置 → IP 白名单」加上本机公网 IP');
    }
    process.exit(1);
  }
  ok(`access_token 到手（${String(data.access_token).slice(0, 8)}…，有效期 ${data.expires_in}s）`);
  return data.access_token;
}

async function msgSecCheck(token, { openid, content, scene }) {
  const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 2, openid, scene, content }),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

// ---------- 主流程 ----------
const text = argOf('text') ?? DEFAULT_TEXT;
const scene = Number(argOf('scene') ?? 4);

console.log(`${c.bold}内容安全实探（msgSecCheck v2）${c.reset}`);
info(`待检测文本：${text.length > 60 ? `${text.slice(0, 60)}…（共 ${text.length} 字）` : text}`);
info(`scene=${scene}（4 = 社交日志，本项目用的值）`);

step('1. 换 access_token');
const token = await getAccessToken();

step('2. 调 msgSecCheck');
const openid = await resolveOpenid();
const data = await msgSecCheck(token, { openid, content: text, scene });

console.log(`${c.dim}   原始响应：${JSON.stringify(data)}${c.reset}`);

if (data.errcode === 87014) {
  ok('结论：risky（老接口形态，errcode=87014）—— 服务端会抛 40002');
  process.exit(0);
}

if (data.errcode === 0) {
  const suggest = data.result?.suggest;
  const label = data.result?.label ?? '-';
  if (!suggest) {
    warn('errcode=0 但没有 suggest —— 服务端按「判不了」处理，会放行');
    process.exit(1);
  }
  const verdict =
    suggest === 'risky' ? '违规 → 服务端抛 40002' : suggest === 'review' ? '建议复核 → 服务端放行 + 记日志' : '通过 → 放行';
  ok(`结论：${suggest}（label=${label}）—— ${verdict}`);
  if (data.detail?.length) info(`detail：${JSON.stringify(data.detail)}`);
  if (data.trace_id) info(`trace_id：${data.trace_id}`);
  process.exit(0);
}

// ---------- 判不了 ----------
bad(`判不了：errcode=${data.errcode} errmsg=${data.errmsg}`);
const hint = {
  48001: 'api unauthorized —— 该账号没有内容安全接口权限（个人主体常见），服务端会 fail-open 放行',
  61010: 'openid 不合法 —— v2 要求传真实用户 openid，且用户近期访问过小程序',
  45009: '调用频率超限',
  40001: 'access_token 无效（脚本用的是刚换的，正常不该出现）',
}[data.errcode];
if (hint) info(`errcode ${data.errcode}：${hint}`);
info('服务端的处理：记一条 warn 日志，然后**放行**（宁可漏拦一条，不可让全家用不了）');
process.exit(1);
