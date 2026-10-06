#!/usr/bin/env node
/**
 * wxpush 连通性测试脚本
 * ------------------------------------------------------------
 * 部署完 Cloudflare Worker 之后，先用这个脚本确认链路通不通，
 * 再去改后端代码。能少排查很多问题。
 *
 * 用法：
 *   WXPUSH_URL=https://your-worker.workers.dev \
 *   WXPUSH_TOKEN=your_api_token \
 *   node tools/test-wxpush.mjs
 *
 * 可选环境变量：
 *   MP_APPID      小程序 AppID（配置后模板消息点击直达小程序）
 *   MP_PAGEPATH   小程序页面路径，默认 pages/index/index
 *   RECEIVER      接收人 openid，不传则用 Worker 上的 WX_USERID
 *
 * 示例：
 *   WXPUSH_URL=https://xxx.workers.dev WXPUSH_TOKEN=abc123 \
 *   MP_APPID=wx1234567890abcdef \
 *   node tools/test-wxpush.mjs
 */

const URL_BASE = process.env.WXPUSH_URL;
const TOKEN = process.env.WXPUSH_TOKEN;
const MP_APPID = process.env.MP_APPID || '';
const MP_PAGEPATH = process.env.MP_PAGEPATH || 'pages/index/index';
const RECEIVER = process.env.RECEIVER || '';

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

// ---------- 参数检查 ----------
step('检查配置');

if (!URL_BASE) {
  bad('缺少 WXPUSH_URL');
  info('示例：WXPUSH_URL=https://your-worker.workers.dev node tools/test-wxpush.mjs');
  process.exit(1);
}
if (!TOKEN) {
  bad('缺少 WXPUSH_TOKEN（就是 Worker 上配的 API_TOKEN）');
  process.exit(1);
}

const endpoint = `${URL_BASE.replace(/\/+$/, '')}/wxsend`;
ok(`推送地址：${endpoint}`);
info(`API Token：${TOKEN.slice(0, 4)}****${TOKEN.slice(-2)}`);
if (MP_APPID) {
  ok(`将尝试跳转小程序：${MP_APPID} → ${MP_PAGEPATH}`);
} else {
  warn('未配置 MP_APPID，本次不会带小程序跳转');
  info('想测试跳转，加上 MP_APPID=wx... 再跑一次');
}
if (RECEIVER) info(`指定接收人：${RECEIVER}`);

// ---------- 组装请求 ----------
step('发送测试消息');

const now = new Date();
const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

const payload = {
  title: '家有小事 · 链路测试',
  content: `如果你在微信里收到这条消息，说明推送链路已经通了。（${hhmm}）`,
};

if (RECEIVER) payload.userid = RECEIVER;
if (MP_APPID) {
  payload.miniprogram_appid = MP_APPID;
  payload.miniprogram_pagepath = MP_PAGEPATH;
}

console.log(`${c.dim}   请求体：${JSON.stringify(payload)}${c.reset}`);

let res;
let text;
try {
  res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN,
    },
    body: JSON.stringify(payload),
  });
  text = await res.text();
} catch (err) {
  bad(`请求失败：${err.message}`);
  info('检查 Worker 地址是否正确、网络是否可达');
  process.exit(1);
}

// ---------- 结果解读 ----------
step('结果');

console.log(`${c.dim}   HTTP ${res.status}${c.reset}`);
console.log(`${c.dim}   ${text}${c.reset}\n`);

let body = {};
try {
  body = JSON.parse(text);
} catch {
  /* 忽略 */
}

if (res.ok) {
  ok('推送成功，去微信看看有没有收到消息');
  if (MP_APPID) {
    info('顺便确认：点击消息是直接跳小程序，还是跳到了中转页？');
    info('· 直接跳小程序 → miniprogram 字段生效，公众号已关联小程序');
    info('· 跳到中转页   → miniprogram 未生效，需要走 MP_URL_LINK / 小程序码 方案');
  }
  process.exit(0);
}

// 失败分支：给出可操作的排查建议
const msg = body.msg || text;

if (res.status === 403 || /Invalid token/i.test(msg)) {
  bad('Token 不对');
  info('Worker 设置 → 变量 → API_TOKEN，两边必须完全一致');
} else if (res.status === 400) {
  bad('参数缺失');
  info('title / content / token 三个是必填的');
} else if (res.status === 500 && /Missing required environment variables/i.test(msg)) {
  bad('Worker 环境变量没配全');
  info('至少需要：WX_APPID、WX_SECRET、WX_USERID、WX_TEMPLATE_ID');
} else if (/access token/i.test(msg)) {
  bad('拿不到 access_token');
  info('常见原因：');
  info('  1. WX_APPID / WX_SECRET 填错（注意是「公众号」的，不是小程序的）');
  info('  2. 测试号长期不活跃被回收 → 重新扫码登录测试号后台确认');
  info('  3. Worker 出口 IP 被限流');
} else if (/47003|invalid.*data|参数/i.test(msg)) {
  bad('模板字段不匹配（错误码 47003）');
  info('模板里的字段名必须和代码里传的 data 一致');
  info('wxpush 默认传的是 { title, content }，');
  info('所以测试号里建的模板必须长这样：');
  info('    {{title.DATA}}');
  info('    {{content.DATA}}');
  info('如果你的模板字段是 first / keyword1，需要用 data 参数自定义：');
  info('    {"data": "{\\"first\\":{\\"value\\":\\"标题\\"},\\"keyword1\\":{\\"value\\":\\"内容\\"}}"');
} else if (/43004|require subscribe|未关注/i.test(msg)) {
  bad('接收人没有关注这个公众号');
  info('让家人先扫码关注测试号，再重试');
} else if (/40001|invalid credential/i.test(msg)) {
  bad('凭证失效');
  info('WX_SECRET 可能填错了，或者测试号被重置过');
} else {
  bad('推送失败');
  info('去 Cloudflare Worker 的「日志」里看详细堆栈');
}

process.exit(1);
