#!/usr/bin/env node
/**
 * M1 真实链路端到端冒烟测试 —— 认证 + 家庭域（docs/05 §三）
 * =============================================================
 *
 * 为什么需要它：
 *   M1 后端的 12 条家庭接口此前只在「无数据库」的降级状态下被点过
 *   （那时 /api/health 返回 db:false），等于没验。数据库打通之后，
 *   必须真实跑一遍「建家 → 邀请 → 加入 → 权限边界 → 退出 → 解散」，
 *   否则接口层的 bug 会一路潜伏到小程序联调才炸，而那时排查成本高得多。
 *
 * 它做三件事：
 *   1. 通过 Prisma Client 往本地 MySQL 建三个测试用户（openid 前缀 `smoke_`，可重复运行）
 *   2. 用 node:crypto 手写 HS256 JWT —— payload 与 AuthService.signToken 一致
 *      （`{ sub: Number(userId), openid }`，sub 必须是 number，bigint 会抛）
 *   3. 串行打 12 条接口 + 一批边界用例，逐条断言返回体的 `code`
 *
 * 用法：
 *   ① 起服务：cd server && pnpm run build && TZ=Asia/Shanghai node dist/server/src/main.js
 *   ② 跑：node tools/smoke-m1.mjs
 *
 * 环境变量：
 *   SMOKE_BASE_URL   默认 http://127.0.0.1:3000
 *
 * 为什么数据库夹具走 Prisma 而不是 `docker exec mysql`：
 *   WorkBuddy 沙箱 hook 了 Node 的 child_process，**任何**子进程创建都直接
 *   EBUSY（连 `node -v` 都起不来）。Prisma 6 默认用 N-API library 引擎，
 *   不 spawn 子进程，所以在沙箱里依然能连库。
 *
 * ⚠️ 只对**本地开发库**生效。脚本会物理删除 openid 以 `smoke_` 开头的用户
 *    及其家庭数据 —— 业务代码坚持不做物理删除，但测试夹具必须可重复运行。
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

const U1 = 'smoke_u1'; // 创建者
const U2 = 'smoke_u2'; // 被邀请的人
const U3 = 'smoke_u3'; // 纯路人（非成员）
const ALL_OPENIDS = [U1, U2, U3];

// =============================================================
// 结果收集
// =============================================================

let passed = 0;
const failures = [];
const notes = [];

function phase(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(2, 62 - title.length))}`);
}

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  return ok;
}

/** 断言响应体的 code（业务错误码是 docs/02 §1.2 的契约） */
function expectCode(name, res, code) {
  const actual = res.body?.code;
  const msg = res.body?.message ?? res.body?.raw ?? '';
  return check(name, actual === code, `期望 code=${code}，实得 ${actual} (HTTP ${res.status}) ${msg}`);
}

function note(text) {
  notes.push(text);
  console.log(`  note  ${text}`);
}

// =============================================================
// .env 与数据库
// =============================================================

function readEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = readEnv(resolve(ROOT, 'server/.env'));
if (!env.JWT_SECRET) {
  console.error('server/.env 里没有 JWT_SECRET，无法签发测试 token');
  process.exit(2);
}

// -------------------------------------------------------------
// 数据库夹具 —— 走 Prisma Client，不走 `docker exec mysql`
// -------------------------------------------------------------
//
// 为什么不用命令行调 mysql：WorkBuddy 沙箱 hook 了 Node 的 child_process，
// **任何**子进程创建都直接 EBUSY（连 `node -v` 都起不来）。
// 而 Prisma 6 默认用 N-API library 引擎，不 spawn 子进程，所以能正常工作。
//
// 复用 server 侧已生成的 client，不额外装依赖。
process.env.DATABASE_URL = env.DATABASE_URL;

const require_ = createRequire(import.meta.url);
let PrismaClientCtor;
try {
  ({ PrismaClient: PrismaClientCtor } = require_(
    resolve(ROOT, 'server/node_modules/@prisma/client'),
  ));
} catch (e) {
  console.error(
    '加载 @prisma/client 失败，先跑一次 `cd server && pnpm install && pnpm run prisma:generate`',
  );
  throw e;
}

const prisma = new PrismaClientCtor();

/**
 * 重建夹具。
 *
 * ⚠️ 这里用 `deleteMany` 做**物理删除**，与「全库不做物理 DELETE」的业务纪律
 *    并不冲突 —— 那条纪律约束的是业务代码，而测试夹具必须可重复运行，
 *    否则第二次跑就会撞 uk_family_user / uk_invite_code。
 *    删除范围严格限定在 openid 以 `smoke_` 开头的用户及其家庭。
 */
async function resetFixtures() {
  const stale = await prisma.user.findMany({
    where: { openid: { in: ALL_OPENIDS } },
    select: { id: true },
  });
  const staleUserIds = stale.map((u) => u.id);

  if (staleUserIds.length > 0) {
    const staleMembers = await prisma.familyMember.findMany({
      where: { userId: { in: staleUserIds } },
      select: { familyId: true },
    });
    const staleFamilyIds = [...new Set(staleMembers.map((m) => m.familyId))];

    if (staleFamilyIds.length > 0) {
      await prisma.familyInvite.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.familyMember.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.family.deleteMany({ where: { id: { in: staleFamilyIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: staleUserIds } } });
  }

  const nicknames = { [U1]: '阿明', [U2]: '阿红', [U3]: '路人' };
  const byOpenid = {};
  for (const openid of ALL_OPENIDS) {
    const user = await prisma.user.create({
      data: {
        openid,
        nickname: nicknames[openid],
        status: 1,
        lastLoginAt: new Date(),
      },
      select: { id: true },
    });
    byOpenid[openid] = Number(user.id);
  }
  return byOpenid;
}

// =============================================================
// JWT（与 AuthService.signToken 完全一致的 payload 形状）
// =============================================================

function signJwt(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function tokenFor(userId, openid) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: userId, openid, iat: now, exp: now + 3600 }, env.JWT_SECRET);
}

// =============================================================
// HTTP
// =============================================================

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed };
}

// =============================================================
// 主流程
// =============================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

async function main() {
  console.log('M1 端到端冒烟测试 · 认证 + 家庭域');
  console.log(`目标服务：${BASE}`);

  // ---------- 0. 服务可达 ----------
  phase('0. 服务与基础设施');
  const health = await api('GET', '/api/health');
  expectCode('GET /api/health 返回 ok', health, 0);
  check('数据库连通 db=true', health.body?.data?.db === true, JSON.stringify(health.body?.data));
  check('Redis 连通 redis=true', health.body?.data?.redis === true);

  // ---------- 1. 夹具 ----------
  phase('1. 准备测试夹具');
  const ids = await resetFixtures();
  console.log(`  用户：${U1}=${ids[U1]}  ${U2}=${ids[U2]}  ${U3}=${ids[U3]}`);
  const t1 = tokenFor(ids[U1], U1);
  const t2 = tokenFor(ids[U2], U2);
  const t3 = tokenFor(ids[U3], U3);

  // ---------- 2. 鉴权边界 ----------
  phase('2. 鉴权边界');
  expectCode('无 token 访问 /families → 40100', await api('GET', '/api/families'), 40100);
  expectCode(
    '伪造 token 访问 /families → 40100',
    await api('GET', '/api/families', { token: 'not.a.jwt' }),
    40100,
  );
  const refreshed = await api('POST', '/api/auth/refresh', { token: t1 });
  expectCode('POST /auth/refresh 续期成功', refreshed, 0);
  const t1b = refreshed.body?.data?.token;
  check('续期返回新 token', typeof t1b === 'string' && t1b.split('.').length === 3);

  // ---------- 3. 建家 ----------
  phase('3. U1 创建家庭');
  const emptyList = await api('GET', '/api/families', { token: t1 });
  expectCode('U1 我的家庭列表（空）', emptyList, 0);
  check('空列表长度为 0', Array.isArray(emptyList.body?.data) && emptyList.body.data.length === 0);

  expectCode(
    'POST /families 缺 roleName → 40001',
    await api('POST', '/api/families', { token: t1, body: { familyName: '没称谓的家' } }),
    40001,
  );
  expectCode(
    'POST /families 家庭名超 50 字 → 40001',
    await api('POST', '/api/families', {
      token: t1,
      body: { familyName: '家'.repeat(51), roleName: '阿爸' },
    }),
    40001,
  );

  const created = await api('POST', '/api/families', {
    token: t1,
    body: { familyName: '冒烟测试之家', roleName: '阿爸' },
  });
  expectCode('POST /families 建家成功', created, 0);
  const family = created.body?.data ?? {};
  const familyId = family.familyId;
  check('返回 familyId / memberId / ownerMemberId', Number.isInteger(familyId) && familyId > 0);
  check('创建者即 owner（ownerMemberId === memberId）', family.ownerMemberId === family.memberId);
  check('称谓正确落库', family.roleName === '阿爸', String(family.roleName));

  const myList = await api('GET', '/api/families', { token: t1 });
  expectCode('U1 我的家庭列表（1 个）', myList, 0);
  const mine = myList.body?.data?.[0] ?? {};
  check('列表项 isOwner=true', mine.isOwner === true);
  check('列表项 memberCount=1', mine.memberCount === 1, String(mine.memberCount));

  const detail = await api('GET', `/api/families/${familyId}`, { token: t1 });
  expectCode('GET /families/:id 详情', detail, 0);
  check('详情 familyName 正确', detail.body?.data?.familyName === '冒烟测试之家');
  check(
    '详情 createdAt 为北京时间格式',
    DATE_RE.test(detail.body?.data?.createdAt ?? ''),
    String(detail.body?.data?.createdAt),
  );

  const members1 = await api('GET', `/api/families/${familyId}/members`, { token: t1 });
  expectCode('GET /families/:id/members', members1, 0);
  const m1 = members1.body?.data ?? [];
  check('成员数 = 1', m1.length === 1, String(m1.length));
  check('自己那条 isMe=true 且 isOwner=true', m1[0]?.isMe === true && m1[0]?.isOwner === true);
  check('成员 status=ACTIVE', m1[0]?.status === 'ACTIVE', String(m1[0]?.status));
  check('成员 joinedAt 为北京时间格式', DATE_RE.test(m1[0]?.joinedAt ?? ''), String(m1[0]?.joinedAt));
  check('成员昵称已带出', m1[0]?.nickname === '阿明', String(m1[0]?.nickname));

  // ---------- 4. 非成员越权 ----------
  phase('4. 非成员越权（服务端权限过滤）');
  expectCode(
    'U3（非成员）读家庭详情 → 40300',
    await api('GET', `/api/families/${familyId}`, { token: t3 }),
    40300,
  );
  expectCode(
    'U3（非成员）读成员列表 → 40300',
    await api('GET', `/api/families/${familyId}/members`, { token: t3 }),
    40300,
  );
  expectCode(
    'U3（非成员）生成邀请码 → 40300',
    await api('POST', `/api/families/${familyId}/invites`, { token: t3, body: {} }),
    40300,
  );
  expectCode(
    'U3（非成员）改家庭名 → 40300',
    await api('PATCH', `/api/families/${familyId}`, { token: t3, body: { familyName: '我改了' } }),
    40300,
  );
  expectCode(
    'familyId 非数字 → 40001',
    await api('GET', '/api/families/abc', { token: t1 }),
    40001,
  );

  // ---------- 5. 邀请码 ----------
  phase('5. 邀请码生成与预览');
  expectCode(
    'POST /invites expireInHours=9999 超上限 → 40001',
    await api('POST', `/api/families/${familyId}/invites`, {
      token: t1,
      body: { expireInHours: 9999 },
    }),
    40001,
  );

  const invite = await api('POST', `/api/families/${familyId}/invites`, {
    token: t1,
    body: { expireInHours: 24 },
  });
  expectCode('POST /invites 生成邀请码', invite, 0);
  const inviteCode = invite.body?.data?.inviteCode;
  check('邀请码为 6 位', typeof inviteCode === 'string' && inviteCode.length === 6, String(inviteCode));
  check(
    '邀请码字符集不含易混字符 0/O/1/I/L',
    typeof inviteCode === 'string' && /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(inviteCode),
    String(inviteCode),
  );
  check(
    'sharePath 指向 P06 加入家庭页',
    invite.body?.data?.sharePath === `pages/family/join?code=${inviteCode}`,
    String(invite.body?.data?.sharePath),
  );
  check(
    'expireAt 为北京时间格式',
    DATE_RE.test(invite.body?.data?.expireAt ?? ''),
    String(invite.body?.data?.expireAt),
  );

  const preview = await api('GET', `/api/families/invites/${inviteCode}`, { token: t2 });
  expectCode('U2 预览邀请码（无需是成员）', preview, 0);
  check('预览 familyName 正确', preview.body?.data?.familyName === '冒烟测试之家');
  check('预览 inviterRoleName=阿爸', preview.body?.data?.inviterRoleName === '阿爸');
  check('预览 alreadyMember=false', preview.body?.data?.alreadyMember === false);
  check('预览 status=VALID', preview.body?.data?.status === 'VALID', String(preview.body?.data?.status));
  check('预览 memberCount=1', preview.body?.data?.memberCount === 1);

  const previewSelf = await api('GET', `/api/families/invites/${inviteCode}`, { token: t1 });
  check('U1（已在家庭）预览 alreadyMember=true', previewSelf.body?.data?.alreadyMember === true);

  expectCode(
    '不存在的邀请码 → 40400',
    await api('GET', '/api/families/invites/ZZZZZZ', { token: t2 }),
    40400,
  );

  // ---------- 6. 加入 ----------
  phase('6. U2 接受邀请加入');
  expectCode(
    'accept 缺 roleName → 40001',
    await api('POST', `/api/families/invites/${inviteCode}/accept`, { token: t2, body: {} }),
    40001,
  );
  expectCode(
    'U1（已在家庭）用自己家的码 → 40900',
    await api('POST', `/api/families/invites/${inviteCode}/accept`, {
      token: t1,
      body: { roleName: '阿妈' },
    }),
    40900,
  );

  const accepted = await api('POST', `/api/families/invites/${inviteCode}/accept`, {
    token: t2,
    body: { roleName: '阿妈' },
  });
  expectCode('U2 接受邀请成功', accepted, 0);
  check('返回的 familyId 与邀请一致', accepted.body?.data?.familyId === familyId);
  check('返回 roleName=阿妈', accepted.body?.data?.roleName === '阿妈');
  const u2MemberId = accepted.body?.data?.memberId;

  expectCode(
    '同一邀请码重复使用 → 40900',
    await api('POST', `/api/families/invites/${inviteCode}/accept`, {
      token: t3,
      body: { roleName: '阿公' },
    }),
    40900,
  );

  const members2 = await api('GET', `/api/families/${familyId}/members`, { token: t1 });
  check('加入后成员数 = 2', members2.body?.data?.length === 2, String(members2.body?.data?.length));
  const u2Row = members2.body?.data?.find((m) => m.roleName === '阿妈') ?? {};
  check('U2 那条 isMe 对 U1 而言为 false', u2Row.isMe === false);

  const u2List = await api('GET', '/api/families', { token: t2 });
  check('U2 我的家庭列表 = 1 个', u2List.body?.data?.length === 1, String(u2List.body?.data?.length));
  check('U2 列表项 isOwner=false', u2List.body?.data?.[0]?.isOwner === false);

  // ---------- 7. 创建者权限与称谓唯一 ----------
  phase('7. 创建者权限与称谓唯一性');
  expectCode(
    'U2（非创建者）改家庭名 → 40301',
    await api('PATCH', `/api/families/${familyId}`, { token: t2, body: { familyName: '我说了算' } }),
    40301,
  );
  expectCode(
    'U2（非创建者）解散家庭 → 40301',
    await api('DELETE', `/api/families/${familyId}`, { token: t2 }),
    40301,
  );

  const renamed = await api('PATCH', `/api/families/${familyId}`, {
    token: t1,
    body: { familyName: '冒烟测试之家·改' },
  });
  expectCode('U1（创建者）改家庭名成功', renamed, 0);
  const detail2 = await api('GET', `/api/families/${familyId}`, { token: t1 });
  check('家庭名已更新', detail2.body?.data?.familyName === '冒烟测试之家·改');

  expectCode(
    'U2 改成已被占用的称谓 → 40900',
    await api('PATCH', `/api/families/${familyId}/members/me`, {
      token: t2,
      body: { roleName: '阿爸' },
    }),
    40900,
  );
  expectCode(
    'U2 改成自己的称谓（不算冲突）',
    await api('PATCH', `/api/families/${familyId}/members/me`, {
      token: t2,
      body: { roleName: '阿妈' },
    }),
    0,
  );

  // ---------- 8. 退出 ----------
  phase('8. 退出家庭');
  expectCode(
    'U1（创建者）退出 → 40001',
    await api('POST', `/api/families/${familyId}/leave`, { token: t1 }),
    40001,
  );
  expectCode(
    'U2 退出成功',
    await api('POST', `/api/families/${familyId}/leave`, { token: t2 }),
    0,
  );
  const u2ListAfter = await api('GET', '/api/families', { token: t2 });
  check('U2 退出后我的家庭列表为空', u2ListAfter.body?.data?.length === 0);
  expectCode(
    'U2 退出后再读成员列表 → 40300',
    await api('GET', `/api/families/${familyId}/members`, { token: t2 }),
    40300,
  );

  const membersActive = await api('GET', `/api/families/${familyId}/members`, { token: t1 });
  check('默认不返回已退出成员', membersActive.body?.data?.length === 1);
  const membersAll = await api(
    'GET',
    `/api/families/${familyId}/members?includeLeft=true`,
    { token: t1 },
  );
  check('includeLeft=true 返回 2 条', membersAll.body?.data?.length === 2, String(membersAll.body?.data?.length));
  const leftRow = membersAll.body?.data?.find((m) => m.status === 'LEFT') ?? {};
  check('已退出那条 status=LEFT', leftRow.status === 'LEFT');

  // ---------- 9. 退出后重新加入（复用原记录） ----------
  phase('9. 退出后凭新码重新加入');
  const invite2 = await api('POST', `/api/families/${familyId}/invites`, {
    token: t1,
    body: { expireInHours: 1 },
  });
  const code2 = invite2.body?.data?.inviteCode;
  const rejoin = await api('POST', `/api/families/invites/${code2}/accept`, {
    token: t2,
    body: { roleName: '阿妈' },
  });
  expectCode('U2 用新码重新加入', rejoin, 0);
  check(
    '复用原成员记录（memberId 不变，保留历史）',
    rejoin.body?.data?.memberId === u2MemberId,
    `原 ${u2MemberId} → 现 ${rejoin.body?.data?.memberId}`,
  );

  // ---------- 10. 移除成员 ----------
  phase('10. 移除成员');
  expectCode(
    'U1 移除自己 → 40001',
    await api('DELETE', `/api/families/${familyId}/members/${family.ownerMemberId}`, { token: t1 }),
    40001,
  );
  expectCode(
    'U1 移除 U2 成功',
    await api('DELETE', `/api/families/${familyId}/members/${rejoin.body?.data?.memberId}`, {
      token: t1,
    }),
    0,
  );
  const afterRemove = await api('GET', `/api/families/${familyId}/members`, { token: t1 });
  check('移除后成员数 = 1', afterRemove.body?.data?.length === 1);

  // ---------- 11. 解散 ----------
  phase('11. 解散家庭');
  expectCode(
    'U1（创建者）解散成功',
    await api('DELETE', `/api/families/${familyId}`, { token: t1 }),
    0,
  );
  const listAfterDissolve = await api('GET', '/api/families', { token: t1 });
  check('解散后我的家庭列表为空', listAfterDissolve.body?.data?.length === 0);
  expectCode(
    '解散后读详情 → 40400',
    await api('GET', `/api/families/${familyId}`, { token: t1 }),
    40400,
  );

  // ---------- 12. 订阅额度 ----------
  phase('12. 订阅消息额度（Redis 通道）');
  const quota0 = await api('GET', '/api/auth/subscribe-quota', { token: t1 });
  expectCode('GET /auth/subscribe-quota', quota0, 0);
  check(
    '返回三个通道的额度快照',
    quota0.body?.data !== null && typeof quota0.body?.data === 'object',
    JSON.stringify(quota0.body?.data)?.slice(0, 120),
  );
  expectCode(
    '上报未知模板 ID → 40001（白名单挡住）',
    await api('POST', '/api/auth/subscribe-quota', {
      token: t1,
      body: { templateId: 'attacker-supplied-id', count: 9999 },
    }),
    40001,
  );
  expectCode(
    '上报真实模板 ID 成功',
    await api('POST', '/api/auth/subscribe-quota', {
      token: t1,
      body: { templateId: env.WX_TEMPLATE_TASK, count: 1 },
    }),
    0,
  );

  // ---------- 13. 资料 ----------
  phase('13. 个人资料');
  const profile = await api('PATCH', '/api/auth/profile', {
    token: t1,
    body: { nickname: '阿明（冒烟）' },
  });
  expectCode('PATCH /auth/profile 改昵称', profile, 0);
  check('昵称已更新', profile.body?.data?.nickname === '阿明（冒烟）');

  // ---------- 14. 观察项 ----------
  phase('14. 观察项（非阻塞）');
  note('解散家庭后 family_members 仍是 ACTIVE —— dissolve() 只改 families.status。');
  note('  用户视角无影响（listMine 过滤家庭状态），但成员记录与实际不一致，M2 前可考虑一并置 LEFT。');

  const wxLogin = await api('POST', '/api/auth/login', { body: { code: 'smoke-invalid-code' } });
  if (wxLogin.body?.code === 50001) {
    note('POST /auth/login 传无效 code → 50001（微信接口调用失败），错误映射正确。');
  } else if (wxLogin.body?.code === 0) {
    note('POST /auth/login 意外成功 —— 检查 WechatService 是否走了 mock。');
  } else {
    note(
      `POST /auth/login 传无效 code → code=${wxLogin.body?.code} ${wxLogin.body?.message ?? ''}（外网不可达时属预期）`,
    );
  }

  // ---------- 汇总 ----------
  console.log(`\n${'='.repeat(66)}`);
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  · ${f.name}${f.detail ? `  ← ${f.detail}` : ''}`);
  }
  console.log('='.repeat(66));

  await prisma.$disconnect();
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error('\n冒烟测试异常中断：');
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* 忽略 */
  }
  process.exitCode = 1;
});
