#!/usr/bin/env node
/**
 * 通道一（公众号模板消息）连通性测试 —— **直连微信 API，不经过本仓库后端**。
 *
 * 2026-11-12 改造：以前这个脚本打的是 Cloudflare Worker 的 `/wxsend`，
 * Worker 再去调微信。现在后端直连，脚本也就跟着直连 ——
 * 它验证的正是后端上线后要走的那同一条链路，**在本地就能提前定性**。
 *
 * 用法（三个值都必填，都在测试号后台 / 云托管环境变量里）：
 *   MP_ACCOUNT_APPID=<测试号 appID> \
 *   MP_ACCOUNT_SECRET=xxxxxxxx \
 *   MP_TEMPLATE_REMINDER=vE7zU... \
 *   RECEIVER=<某个已关注测试号的 openid> \
 *   node tools/test-mp-template.mjs
 *
 * 想验「能不能跳进小程序」（PRD 假设 A6），再加：
 *   MP_APPID=<小程序 appID>
 *
 * ⚠️ 这个脚本发的是**真消息**，会出现在 RECEIVER 的微信里，不是干跑。
 * ⚠️ 本地跑必须走能出到 `api.weixin.qq.com` 的网络；出口 IP 变了会撞 40164。
 */

const APPID = process.env.MP_ACCOUNT_APPID;
const SECRET = process.env.MP_ACCOUNT_SECRET;
const TEMPLATE_ID = process.env.MP_TEMPLATE_REMINDER || process.env.MP_TEMPLATE_TASK;
const RECEIVER = process.env.RECEIVER;
const MP_APPID = process.env.MP_APPID || '';
const MP_PAGEPATH = process.env.MP_PAGEPATH || 'pages/index/index';
const LANDING = process.env.MP_LANDING_URL || '';

const API = 'https://api.weixin.qq.com/cgi-bin';

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

const missing = [];
if (!APPID) missing.push('MP_ACCOUNT_APPID');
if (!SECRET) missing.push('MP_ACCOUNT_SECRET');
if (!TEMPLATE_ID) missing.push('MP_TEMPLATE_REMINDER（或 MP_TEMPLATE_TASK）');
if (!RECEIVER) missing.push('RECEIVER');
if (missing.length) {
  bad(`缺少 ${missing.join(' / ')}`);
  info(
    '示例：MP_ACCOUNT_APPID=... MP_ACCOUNT_SECRET=... MP_TEMPLATE_REMINDER=... RECEIVER=oY_... \\',
  );
  info('      node tools/test-mp-template.mjs');
  info('openid 从测试号后台「用户列表」里复制（关注了才在里面）');
  process.exit(1);
}
ok(`公众号 appID：${APPID.slice(0, 6)}***`);
ok(`模板 ID：${TEMPLATE_ID}`);
info(`接收人：${RECEIVER.slice(0, 4)}***${RECEIVER.slice(-4)}`);
if (MP_APPID) ok(`将带上 miniprogram 字段：${MP_APPID} → ${MP_PAGEPATH}`);
else warn('未配置 MP_APPID，本次不测「点开直接跳小程序」（假设 A6）');

// ---------- 第一步：拿 access_token ----------
step('拿 access_token（stable_token）');

let token;
try {
  const res = await fetch(`${API}/stable_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: APPID,
      secret: SECRET,
      force_refresh: false,
    }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json();
  if (!data.access_token) {
    bad(`拿不到 token：errcode=${data.errcode} errmsg=${data.errmsg}`);
    explain(data.errcode);
    process.exit(1);
  }
  token = data.access_token;
  ok(`拿到 token（有效期 ${data.expires_in}s，微信侧同一凭据重复取是同一个）`);
} catch (err) {
  bad(`请求失败：${err.message}`);
  info('这一步打的是 api.weixin.qq.com —— 不通就是本机网络/代理问题，与后端部署无关');
  process.exit(1);
}

// ---------- 第二步：发一条模板消息 ----------
step('发送测试消息');

const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
const body = {
  touser: RECEIVER,
  template_id: TEMPLATE_ID,
  data: {
    first: { value: '家有小事 · 链路测试' },
    remark: { value: '如果你在微信里收到这条，说明通道一已经通了 😊' },
  },
  client_msg_id: `probe-${Date.now()}`,
};
if (MP_APPID) body.miniprogram = { appid: MP_APPID, pagepath: MP_PAGEPATH };
if (LANDING) {
  const sep = LANDING.includes('?') ? '&' : '?';
  body.url = `${LANDING}${sep}message=${encodeURIComponent('链路测试')}&date=${encodeURIComponent(now)}&kind=REMINDER`;
}

console.log(`${c.dim}   请求体：${JSON.stringify(body)}${c.reset}`);

let sendStatus;
let sendJson;
try {
  const res = await fetch(`${API}/message/template/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  sendStatus = res.status;
  sendJson = await res.json();
} catch (err) {
  bad(`发送请求失败：${err.message}`);
  process.exit(1);
}

// ---------- 结果解读 ----------
step('结果');

console.log(`${c.dim}   HTTP ${sendStatus}${c.reset}`);
console.log(`${c.dim}   ${JSON.stringify(sendJson)}${c.reset}\n`);

if (sendJson.errcode === 0) {
  ok('已受理，去微信看看收到没有');
  info('· 点一下能直接进小程序 → miniprogram 字段生效（假设 A6 成立）');
  info('· 点开是中转页网页 → miniprogram 未生效，走小程序码长按识别');
  info('· 点开什么都没发生 → miniprogram 和 url 都没生效，需要配 MP_LANDING_URL / MP_QRCODE_URL');
  process.exit(0);
}

bad(`微信拒绝：errcode=${sendJson.errcode} errmsg=${sendJson.errmsg}`);
explain(sendJson.errcode);
process.exit(1);

/** 错误码 → 一句能动手的话 */
function explain(errcode) {
  switch (errcode) {
    case 40164:
      info('出口 IP 不在公众号「IP 白名单」里 —— 去 mp 后台把白名单清空或加上当前出口 IP');
      info('⚠️ 云托管容器出口 IP 不固定，直连这条路的白名单要么放开，要么换成固定出口');
      break;
    case 40013:
    case 40001:
    case 41001:
      info('appID / appsecret 不对（注意是**公众号**那一对，不是小程序的）');
      break;
    case 43004:
      info('接收人没关注这个公众号（或已取关）—— 让对方重新扫码关注测试号');
      break;
    case 40003:
      info('touser 不是这个公众号下的 openid —— 去测试号后台「用户列表」复制');
      break;
    case 47003:
      info('模板字段对不上。本脚本发的是 first / remark，');
      info('后台模板内容必须长这样（原文以 server/src/modules/notify/notify.templates.ts 为准）：');
      info('    {{first.DATA}}');
      info('    ...');
      info('    {{remark.DATA}}');
      break;
    case 45009:
      info('接口调用超限（测试号也有限速）—— 稍后再试');
      break;
    default:
      info('微信没给明确解释，把 errcode 记到 docs/08 的排错表里再来');
  }
}
