#!/usr/bin/env node
/**
 * 订阅消息链路实探脚本
 * ------------------------------------------------------------
 * 和 `tools/test-wxpush.mjs` 对称：那个探通道一（公众号模板消息），
 * 这个探通道二（小程序订阅消息）。
 *
 * 什么时候用：
 *   ① 部署后第一次打通订阅消息 —— 确认 appid/secret 能换到 access_token
 *   ② 报 47003 时 —— 这是**唯一**能看到微信原始报错的方式
 *      （服务端只会记一条 warn 日志，而且 47003 不告诉你哪个字段错了）
 *   ③ 换了模板 ID 之后 —— 确认新模板的字段名与代码里的一致
 *
 * 用法：
 *   node tools/probe-subscribe.mjs <openid> [TASK|REMINDER|DONE]
 *
 * 也可以从环境变量读：
 *   OPENID=oXXXX node tools/probe-subscribe.mjs TASK
 *
 * 模板 ID 与字段定义从 `server/.env` 和
 * `server/src/modules/notify/subscribe.templates.ts` 保持一致，
 * **改了模板记得两边一起改**（`pnpm run check:templates` 会帮你核对）。
 *
 * ⚠️ 这个脚本会真的发一条消息给指定 openid。额度是消耗掉的，别乱刷。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ---------- 读 server/.env ----------
function loadEnv() {
  const path = resolve(ROOT, 'server/.env');
  if (!existsSync(path)) {
    bad(`找不到 ${path}`);
    info('先按 server/.env.example 建一份 server/.env');
    process.exit(1);
  }

  const env = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ---------- 模板定义（与 subscribe.templates.ts 对齐）----------
const TEMPLATES = {
  TASK: {
    envKey: 'WX_TEMPLATE_TASK',
    name: '待办事项提醒',
    number: '2983',
    page: 'pages/thing/detail',
    data: {
      thing1: { value: '记得买酱油' },
      thing4: { value: '下班路上顺手带一瓶' },
      thing22: { value: '阿爸' },
      time23: { value: null }, // 运行时填当前时间
    },
  },
  REMINDER: {
    envKey: 'WX_TEMPLATE_NUDGE',
    name: '备忘事项提醒',
    number: '10938',
    page: 'pages/thing/detail',
    data: {
      thing3: { value: '接阿公去体检' },
      time10: { value: null },
      thing6: { value: '阿妈 → 阿爸' },
    },
  },
  DONE: {
    envKey: 'WX_TEMPLATE_DONE',
    name: '日程任务完成提醒',
    number: '77364',
    page: 'pages/thing/detail',
    data: {
      thing1: { value: '记得买酱油' },
      thing2: { value: '阿爸' },
      time3: { value: null },
    },
  },
};

/** 订阅消息 `time` 字段只认 `yyyy-MM-dd HH:mm`（不是「今天 18:00」） */
function subTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

// ---------- 参数 ----------
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let openid = args[0] || process.env.OPENID || '';
let kind = (args[1] || process.env.KIND || 'TASK').toUpperCase();

if (args[0]?.toUpperCase() in TEMPLATES) {
  // 只传了一个参数且是模板名 —— 当成 kind，openid 从环境变量取
  kind = args[0].toUpperCase();
  openid = process.env.OPENID || '';
}

const env = loadEnv();

step('检查配置');

if (!openid) {
  bad('缺少 openid');
  info('用法：node tools/probe-subscribe.mjs <openid> [TASK|REMINDER|DONE]');
  info('openid 是**小程序**的（不是公众号的）—— 可在小程序里 console.log 拿到');
  process.exit(1);
}

if (!(kind in TEMPLATES)) {
  bad(`模板种类只能是 TASK / REMINDER / DONE，收到「${kind}」`);
  process.exit(1);
}

const appid = env.WX_APPID;
const secret = env.WX_SECRET;
const tpl = TEMPLATES[kind];
const templateId = env[tpl.envKey];

if (!appid || !secret) {
  bad('server/.env 里缺 WX_APPID / WX_SECRET');
  process.exit(1);
}
if (!templateId) {
  bad(`server/.env 里 ${tpl.envKey} 是空的`);
  info(`这是「${tpl.name}」（模板编号 ${tpl.number}）的模板 ID，去小程序后台复制`);
  process.exit(1);
}

ok(`小程序 AppID：${appid}`);
ok(`模板：${tpl.name}（编号 ${tpl.number}）← ${tpl.envKey}`);
info(`模板 ID：${templateId.slice(0, 8)}****${templateId.slice(-4)}`);
info(`接收人 openid：${openid.slice(0, 6)}****${openid.slice(-4)}`);
info(`跳转页面：${tpl.page}`);

// ---------- 换 access_token ----------
step('获取 access_token');

const tokenUrl =
  `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
  `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;

let tokenRes;
try {
  tokenRes = await (await fetch(tokenUrl, { signal: AbortSignal.timeout(8000) })).json();
} catch (e) {
  bad(`请求失败：${e.message}`);
  info('检查网络，或当前环境是否走了代理');
  process.exit(1);
}

if (!tokenRes.access_token) {
  bad(`拿不到 access_token：errcode=${tokenRes.errcode} errmsg=${tokenRes.errmsg}`);
  info('常见原因：');
  info('  1. WX_APPID / WX_SECRET 填错（注意要**小程序**的，不是公众号的）');
  info('  2. 当前出口 IP 不在小程序的 IP 白名单里（小程序默认不校验，云托管才有）');
  info('  3. 调用频率超限（2000 次/天）');
  process.exit(1);
}

ok(`access_token 拿到（${tokenRes.expires_in}s 有效）`);

// ---------- 组装并发送 ----------
step('发送订阅消息');

const data = structuredClone(tpl.data);
for (const v of Object.values(data)) {
  if (v.value === null) v.value = subTime();
}

const payload = {
  touser: openid,
  template_id: templateId,
  page: tpl.page,
  data,
};

console.log(`${c.dim}   data = ${JSON.stringify(data)}${c.reset}`);

const sendUrl =
  `https://api.weixin.qq.com/cgi-bin/message/subscribe/send` +
  `?access_token=${encodeURIComponent(tokenRes.access_token)}`;

let sendRes;
try {
  sendRes = await (
    await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })
  ).json();
} catch (e) {
  bad(`请求失败：${e.message}`);
  process.exit(1);
}

// ---------- 结果解读 ----------
step('结果');

console.log(`${c.dim}   ${JSON.stringify(sendRes)}${c.reset}\n`);

if (sendRes.errcode === 0) {
  ok('发送成功，去微信看看有没有收到');
  info('收到 → 通道二打通了');
  info('没收到 → 检查是不是开了「消息免打扰」，或者刚授权的额度已被别处用掉');
  process.exit(0);
}

switch (sendRes.errcode) {
  case 43101:
    bad('用户没有订阅额度（或已拒收）');
    info('这是**正常情况**，不是 bug —— 订阅消息是一次性的，1 次授权只能收 1 条');
    info('让用户在小程序里重新触发一次 requestSubscribeMessage 授权');
    info('对应服务端行为：本地额度归零，降级到站内消息');
    break;

  case 47003:
    bad('模板字段不匹配（47003）—— 微信不会告诉你哪个字段错了');
    info(`当前模板「${tpl.name}」（编号 ${tpl.number}）代码传的字段：`);
    info(`   ${Object.keys(data).join(' / ')}`);
    info('去小程序后台打开这个模板，逐字对照字段名：');
    info('  · 字段名要一模一样（thing1 不是 thing01，也不是 thing_1）');
    info('  · thing 类型最多 20 个字符，超长也报 47003');
    info('  · time 类型只认 yyyy-MM-dd HH:mm 或 yyyy年MM月dd日 HH:mm');
    info('  · 模板 ID 要与模板对得上（贴错了模板 ID 也会报这个）');
    break;

  case 40003:
  case 40037:
    bad('openid 无效或用户不存在');
    info('确认传的是**小程序** openid —— 公众号 openid 发不了订阅消息');
    break;

  case 40001:
  case 42001:
    bad('access_token 失效');
    info('重跑一次即可；若反复出现，检查 WX_SECRET 是否被重置过');
    break;

  case 45009:
    bad('接口调用超限');
    info('access_token 获取上限 2000 次/天，等等再试');
    break;

  case 41030:
    bad('page 路径不存在');
    info(`当前传的是 ${tpl.page}，确认小程序里有这个页面且已发布`);
    break;

  default:
    bad(`发送失败：errcode=${sendRes.errcode} errmsg=${sendRes.errmsg}`);
    info('查微信官方错误码文档：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/');
}

process.exit(1);
