#!/usr/bin/env node
/**
 * M5 真实链路端到端冒烟测试 —— 注销账号（docs/02 §2.6 / docs/06 §4.6）
 * =============================================================
 *
 * 为什么需要它：
 *   注销是**全项目唯一不可逆**的操作。别处写错了顶多是「没生效」，
 *   这里写错了是「数据没了」或者更糟 —— 「该没的没没」。
 *   而且它的三个失败模式都不显眼：
 *     ① 创建者注销后家庭没人接手 → 家里其他人打不开这个家
 *     ② 只把成员置为「已退出」，但调度器不看成员状态 → 注销之后还在叮他
 *     ③ 匿名化写成「一条 updateMany 全改」→ 早就退出过的那段历史被改了退出时间
 *   这三条单靠读代码看不出来，必须打真库。
 *
 * 它验证的是**口径**，不是接口能不能通：
 *   「认人的抹掉，家里的事留下但不再署名」——
 *   每一行断言都对应 `server/src/modules/auth/account.service.ts` 文件头那张表。
 *
 * 用法：
 *   ① 起服务：cd server && pnpm run build && TZ=Asia/Shanghai node dist/server/src/main.js
 *   ② 跑：pnpm run smoke:m5
 *
 * 环境变量：
 *   SMOKE_BASE_URL   默认 http://127.0.0.1:3000
 *
 * ⚠️ 只对**本地开发库**生效。夹具用户 openid 前缀 `smoke5_`，
 *    每次运行前先物理清掉上一轮的，保证可重复运行。
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

const PREFIX = 'smoke5_';
const A_OPENID = `${PREFIX}a`; // 被注销的人
const B_OPENID = `${PREFIX}b`; // F1 里最早加入 → 应接任创建者
const C_OPENID = `${PREFIX}c`; // F1 里较晚加入
const ALL_OPENIDS = [A_OPENID, B_OPENID, C_OPENID];

/** 早就退出过的那个成员关系的原始退出时间 —— 断言它**不被改写** */
const OLD_LEFT_AT = new Date('2026-01-15T02:30:00.000Z');

/** 注销后 family_members.role_name 的占位称谓（与 account.service.ts 一致） */
const ANON_ROLE = '已注销的家人';

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
  // sub 必须是 number：JWT 是 JSON，bigint 直接 JSON.stringify 会抛
  // （与 AuthService.signToken 的 `sub: Number(userId)` 一致）
  return signJwt({ sub: Number(userId), openid, iat: now, exp: now + 3600 }, env.JWT_SECRET);
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
// 夹具：清理 + 重建
// =============================================================

async function wipe() {
  const users = await prisma.user.findMany({
    where: { openid: { startsWith: PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;

  // 家庭范围要比 userIds 宽：A 注销后 openid 变墓碑值、user_id 不变，
  // 但历史上 A 可能已经在别的家庭留下过成员关系 —— 一并按 member 反查。
  const members = await prisma.familyMember.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const memberIds = members.map((m) => m.id);
  const families = await prisma.family.findMany({
    where: {
      OR: [
        { ownerMemberId: { in: memberIds.length ? memberIds : [-1n] } },
        { name: { startsWith: PREFIX } },
      ],
    },
    select: { id: true },
  });
  const familyIds = families.map((f) => f.id);

  const things = familyIds.length
    ? await prisma.familyThing.findMany({
        where: { familyId: { in: familyIds } },
        select: { id: true },
      })
    : [];
  const thingIds = things.map((t) => t.id);
  const memories = familyIds.length
    ? await prisma.familyMemory.findMany({
        where: { familyId: { in: familyIds } },
        select: { id: true },
      })
    : [];
  const memoryIds = memories.map((m) => m.id);

  if (thingIds.length) await prisma.thingReminder.deleteMany({ where: { thingId: { in: thingIds } } });
  if (memoryIds.length)
    await prisma.memoryAttachment.deleteMany({ where: { memoryId: { in: memoryIds } } });
  if (familyIds.length) {
    await prisma.familyInvite.deleteMany({ where: { familyId: { in: familyIds } } });
    await prisma.mealRecord.deleteMany({ where: { familyId: { in: familyIds } } });
    await prisma.menuItem.deleteMany({ where: { familyId: { in: familyIds } } });
    await prisma.familyMemory.deleteMany({ where: { familyId: { in: familyIds } } });
    await prisma.familyThing.deleteMany({ where: { familyId: { in: familyIds } } });
  }
  await prisma.notificationLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.familyMember.deleteMany({ where: { userId: { in: userIds } } });
  if (familyIds.length) await prisma.family.deleteMany({ where: { id: { in: familyIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/**
 * 重建夹具。返回后面断言要用到的所有 id。
 *
 * 场景刻意铺得比较满 —— 注销的问题全在「边界上那几行」：
 *   · F1：三个人，A 是创建者 → 应交接给**最早加入的 B**
 *   · F2：只有 A 一个人 → 应**解散**
 *   · F3：A **早就退出过**的一段关系 → 称谓要匿名化，但 leftAt **不能改**
 */
async function seed() {
  const mkUser = (openid, nickname) =>
    prisma.user.create({
      data: { openid, nickname, status: 1, lastLoginAt: new Date() },
      select: { id: true },
    });

  const ua = await mkUser(A_OPENID, '阿爸');
  const ub = await mkUser(B_OPENID, '阿妈');
  const uc = await mkUser(C_OPENID, '小明');

  const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);

  const f1 = await prisma.family.create({
    data: { name: `${PREFIX}我们家`, status: 1 },
    select: { id: true },
  });
  const f2 = await prisma.family.create({
    data: { name: `${PREFIX}只剩我一个`, status: 1 },
    select: { id: true },
  });
  const f3 = await prisma.family.create({
    data: { name: `${PREFIX}早就退出的家`, status: 1 },
    select: { id: true },
  });

  const m1a = await prisma.familyMember.create({
    data: { familyId: f1.id, userId: ua.id, roleName: '阿爸', status: 1, joinedAt: hoursAgo(72) },
    select: { id: true },
  });
  const m1b = await prisma.familyMember.create({
    data: { familyId: f1.id, userId: ub.id, roleName: '阿妈', status: 1, joinedAt: hoursAgo(48) },
    select: { id: true },
  });
  const m1c = await prisma.familyMember.create({
    data: { familyId: f1.id, userId: uc.id, roleName: '小明', status: 1, joinedAt: hoursAgo(24) },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: f1.id }, data: { ownerMemberId: m1a.id } });

  // F2：A 一个人，他是创建者
  const m2a = await prisma.familyMember.create({
    data: { familyId: f2.id, userId: ua.id, roleName: '阿爸', status: 1, joinedAt: hoursAgo(10) },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: f2.id }, data: { ownerMemberId: m2a.id } });

  // F3：C 是创建者；A 早就在里面待过、又退出了
  const m3c = await prisma.familyMember.create({
    data: { familyId: f3.id, userId: uc.id, roleName: '小明', status: 1, joinedAt: hoursAgo(200) },
    select: { id: true },
  });
  const m3a = await prisma.familyMember.create({
    data: {
      familyId: f3.id,
      userId: ua.id,
      roleName: '阿爸',
      status: 0, // 早就退出
      leftAt: OLD_LEFT_AT,
      joinedAt: hoursAgo(500),
    },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: f3.id }, data: { ownerMemberId: m3c.id } });

  // ---- 小事 / 提醒（验证「没发出去的收掉、发出去的不动」）----
  const thing = await prisma.familyThing.create({
    data: {
      familyId: f1.id,
      creatorMemberId: m1a.id,
      type: 1,
      title: `${PREFIX}买牛奶`,
      assigneeMemberId: m1a.id,
      visibility: 1,
      status: 1,
    },
    select: { id: true },
  });

  const remindPendingMine = await prisma.thingReminder.create({
    data: {
      thingId: thing.id,
      recipientMemberId: m1a.id,
      remindType: 2,
      remindAt: new Date(Date.now() + 3600_000),
      status: 1,
      nextRemindAt: new Date(Date.now() + 3600_000),
    },
    select: { id: true },
  });
  const remindSentMine = await prisma.thingReminder.create({
    data: {
      thingId: thing.id,
      recipientMemberId: m1a.id,
      remindType: 1,
      remindAt: hoursAgo(1),
      status: 2,
      sentCount: 1,
      lastSentAt: hoursAgo(1),
      nextRemindAt: null,
    },
    select: { id: true },
  });
  const remindPendingB = await prisma.thingReminder.create({
    data: {
      thingId: thing.id,
      recipientMemberId: m1b.id,
      remindType: 2,
      remindAt: new Date(Date.now() + 7200_000),
      status: 1,
      nextRemindAt: new Date(Date.now() + 7200_000),
    },
    select: { id: true },
  });

  // ---- 收件箱：A 的两条该被清掉，B 的一条不能动 ----
  const logA1 = await prisma.notificationLog.create({
    data: { userId: ua.id, familyId: f1.id, thingId: thing.id, type: 2, title: '阿妈叮了你一下', channel: 2, status: 2 },
    select: { id: true },
  });
  const logA2 = await prisma.notificationLog.create({
    data: { userId: ua.id, familyId: f1.id, type: 5, title: '随便一条', channel: 2, status: 2 },
    select: { id: true },
  });
  const logB = await prisma.notificationLog.create({
    data: { userId: ub.id, familyId: f1.id, thingId: thing.id, type: 1, title: '阿爸派了个活', channel: 2, status: 2 },
    select: { id: true },
  });

  // ---- 家庭共享内容：这几样必须原样活着 ----
  const memory = await prisma.familyMemory.create({
    data: {
      familyId: f1.id,
      creatorMemberId: m1a.id,
      content: `${PREFIX}今天一家人去了公园`,
      visibility: 1,
      status: 1,
    },
    select: { id: true },
  });
  const meal = await prisma.mealRecord.create({
    data: {
      familyId: f1.id,
      mealDate: new Date('2026-10-01T00:00:00.000Z'),
      mealType: 3,
      name: '番茄炒蛋',
      createdByMemberId: m1a.id,
    },
    select: { id: true },
  });
  const menu = await prisma.menuItem.create({
    data: { familyId: f1.id, name: `${PREFIX}红烧肉`, enabled: 1, createdByMemberId: m1a.id },
    select: { id: true },
  });
  const invite = await prisma.familyInvite.create({
    data: {
      familyId: f1.id,
      inviterMemberId: m1a.id,
      inviteCode: `${PREFIX}code1`,
      status: 1,
    },
    select: { id: true },
  });

  return {
    userIds: { a: ua.id, b: ub.id, c: uc.id },
    familyIds: { f1: f1.id, f2: f2.id, f3: f3.id },
    memberIds: { m1a: m1a.id, m1b: m1b.id, m1c: m1c.id, m2a: m2a.id, m3a: m3a.id, m3c: m3c.id },
    remindIds: {
      pendingMine: remindPendingMine.id,
      sentMine: remindSentMine.id,
      pendingB: remindPendingB.id,
    },
    logIds: { a1: logA1.id, a2: logA2.id, b: logB.id },
    contentIds: { memory: memory.id, meal: meal.id, menu: menu.id, invite: invite.id, thing: thing.id },
  };
}

// =============================================================
// 主流程
// =============================================================

async function main() {
  console.log('M5 端到端冒烟测试 · 注销账号');
  console.log(`目标服务：${BASE}`);

  phase('0. 服务可达');
  const health = await api('GET', '/api/health');
  if (health.body?.code !== 0) {
    console.error(`服务不可达或未就绪：HTTP ${health.status} ${JSON.stringify(health.body).slice(0, 200)}`);
    process.exit(2);
  }
  check('GET /api/health → code 0', true);
  if (health.body.data?.db !== true) {
    console.error('数据库未连通（/api/health 的 db 不是 true），跳过后续断言');
    process.exit(2);
  }

  await wipe();
  const fx = await seed();
  const tokenA = tokenFor(fx.userIds.a, A_OPENID);
  const tokenB = tokenFor(fx.userIds.b, B_OPENID);

  // ---------- 1. 注销前 ----------
  phase('1. 注销前（确认夹具立住了）');
  const before = await api('GET', '/api/families', { token: tokenA });
  expectCode('A 的 token 可用：GET /families → 0', before, 0);
  // 注意是 **2** 不是 3：A 在 F3 里是**早就退出**的成员关系（status=0），
  // `listMine` 只返回有效成员关系，所以 F3 本来就不该出现在他的列表里。
  // 这里顺带验证了「夹具真的铺出了那条历史行，但接口正确地看不见它」。
  const beforeIds = (before.body?.data ?? []).map((f) => f.familyId).sort((x, y) => x - y);
  const expectIds = [Number(fx.familyIds.f1), Number(fx.familyIds.f2)].sort((x, y) => x - y);
  check(
    'A 名下 2 个家（F1 / F2；F3 是早就退出的，不该出现）',
    JSON.stringify(beforeIds) === JSON.stringify(expectIds),
    `期望 ${JSON.stringify(expectIds)}，实得 ${JSON.stringify(beforeIds)}`,
  );

  // ---------- 2. 注销 ----------
  phase('2. DELETE /api/auth/account');
  const del = await api('DELETE', '/api/auth/account', { token: tokenA });
  expectCode('A 注销 → code 0', del, 0);
  check('响应体是 { ok: true }', del.body?.data?.ok === true, JSON.stringify(del.body?.data));

  // ---------- 3. 用户本体：匿名化 + 禁用 + 释放 openid ----------
  phase('3. users 行 —— 个人数据必须清干净');
  const ua = await prisma.user.findUnique({ where: { id: fx.userIds.a } });
  check('status = 0（已禁用）', ua?.status === 0, `实得 ${ua?.status}`);
  check(
    'openid 换成墓碑值 deleted:<id>',
    ua?.openid === `deleted:${fx.userIds.a}`,
    `实得 ${ua?.openid}`,
  );
  check('nickname 已清空', ua?.nickname === null, `实得 ${ua?.nickname}`);
  check('avatarUrl 已清空', ua?.avatarUrl === null, `实得 ${ua?.avatarUrl}`);
  check('unionid 已清空', ua?.unionid === null, `实得 ${ua?.unionid}`);
  check('mpOpenid 已清空（= 微信提醒解绑）', ua?.mpOpenid === null, `实得 ${ua?.mpOpenid}`);
  check('mpBoundAt 已清空', ua?.mpBoundAt === null, `实得 ${ua?.mpBoundAt}`);
  check('lastLoginAt 已清空', ua?.lastLoginAt === null, `实得 ${ua?.lastLoginAt}`);

  // ---------- 4. 成员关系：退出 + 匿名化，且不篡改历史 ----------
  phase('4. family_members —— 退出 + 匿名化');
  const rows = await prisma.familyMember.findMany({
    where: { userId: fx.userIds.a },
    orderBy: { id: 'asc' },
  });
  check('A 的成员关系一行都没被删（3 条）', rows.length === 3, `实得 ${rows.length}`);
  check(
    '全部 status = 0（已退出）',
    rows.every((r) => r.status === 0),
    rows.map((r) => r.status).join(','),
  );
  check(
    `全部 role_name 匿名化为「${ANON_ROLE}」`,
    rows.every((r) => r.roleName === ANON_ROLE),
    rows.map((r) => r.roleName).join(','),
  );

  const f3Row = rows.find((r) => r.familyId === fx.familyIds.f3);
  check(
    '⚠️ 早就退出过的关系：leftAt 未被改写（历史没被篡改）',
    f3Row?.leftAt?.getTime() === OLD_LEFT_AT.getTime(),
    `期望 ${OLD_LEFT_AT.toISOString()}，实得 ${f3Row?.leftAt?.toISOString()}`,
  );

  // ---------- 5. 创建者交接 / 解散 ----------
  phase('5. families —— 交接与解散');
  const f1 = await prisma.family.findUnique({ where: { id: fx.familyIds.f1 } });
  const f2 = await prisma.family.findUnique({ where: { id: fx.familyIds.f2 } });
  const f3 = await prisma.family.findUnique({ where: { id: fx.familyIds.f3 } });

  check(
    'F1 创建者交接给**最早加入的** B（不是较晚的 C）',
    f1?.ownerMemberId === fx.memberIds.m1b,
    `期望 memberId=${fx.memberIds.m1b}，实得 ${f1?.ownerMemberId}`,
  );
  check('F1 家庭本身还在（status = 1）', f1?.status === 1, `实得 ${f1?.status}`);
  check(
    'F2 只剩 A 一人 → 已解散（status = 0）',
    f2?.status === 0,
    `实得 ${f2?.status}`,
  );
  const othersInF3 = await prisma.familyMember.findMany({
    where: { familyId: fx.familyIds.f3, status: 1 },
    select: { id: true },
  });
  check('F3 是 C 的家，不受影响（C 仍是有效成员）', othersInF3.length === 1 && othersInF3[0].id === fx.memberIds.m3c);
  check('F3 家庭状态未被改动', f3?.status === 1, `实得 ${f3?.status}`);

  // ---------- 6. 提醒：未发出的收掉，已发出的不动 ----------
  phase('6. thing_reminders —— 不能再叮一个已经注销的人');
  const rPending = await prisma.thingReminder.findUnique({ where: { id: fx.remindIds.pendingMine } });
  const rSent = await prisma.thingReminder.findUnique({ where: { id: fx.remindIds.sentMine } });
  const rB = await prisma.thingReminder.findUnique({ where: { id: fx.remindIds.pendingB } });

  check('发给 A 的**未发出**提醒 → 已取消（status = 3）', rPending?.status === 3, `实得 ${rPending?.status}`);
  check('它的 nextRemindAt 被清空（调度器不会再扫到）', rPending?.nextRemindAt === null, `实得 ${rPending?.nextRemindAt}`);
  check(
    '发给 A 的**已发出**提醒不动（status 仍为 2，留痕）',
    rSent?.status === 2 && rSent?.sentCount === 1,
    `实得 status=${rSent?.status} sentCount=${rSent?.sentCount}`,
  );
  check(
    '发给 **B** 的未发出提醒**不能**被误伤（status 仍为 1）',
    rB?.status === 1 && rB?.nextRemindAt != null,
    `实得 status=${rB?.status} nextRemindAt=${rB?.nextRemindAt}`,
  );

  // ---------- 7. 收件箱：物理删除（全库唯一例外）----------
  phase('7. notification_logs —— 物理删除，但只删他自己的');
  const logsA = await prisma.notificationLog.count({ where: { userId: fx.userIds.a } });
  const logB = await prisma.notificationLog.findUnique({ where: { id: fx.logIds.b } });
  check('A 的收件箱已清空（0 条）', logsA === 0, `实得 ${logsA}`);
  check('B 的通知日志原样保留', logB != null && logB.title === '阿爸派了个活');

  // ---------- 8. 家庭共享内容：一行都不能少 ----------
  phase('8. 家里的事 —— 全部保留（这是「历史要留着」的底线）');
  const memory = await prisma.familyMemory.findUnique({ where: { id: fx.contentIds.memory } });
  const meal = await prisma.mealRecord.findUnique({ where: { id: fx.contentIds.meal } });
  const menu = await prisma.menuItem.findUnique({ where: { id: fx.contentIds.menu } });
  const invite = await prisma.familyInvite.findUnique({ where: { id: fx.contentIds.invite } });
  const thing = await prisma.familyThing.findUnique({ where: { id: fx.contentIds.thing } });

  check('留个念（family_memories）还在', memory?.content === `${PREFIX}今天一家人去了公园`);
  check('吃啥呢（meal_records）还在', meal?.name === '番茄炒蛋');
  check('自定义菜谱（menu_items）还在', menu?.name === `${PREFIX}红烧肉`);
  check('邀请记录（family_invites）还在', invite?.inviteCode === `${PREFIX}code1`);
  check('派活（family_things）还在', thing?.title === `${PREFIX}买牛奶`);
  check(
    '以上记录的 creator/created_by 指针**未被改动**（历史仍能追到那个成员行）',
    memory?.creatorMemberId === fx.memberIds.m1a &&
      meal?.createdByMemberId === fx.memberIds.m1a &&
      menu?.createdByMemberId === fx.memberIds.m1a &&
      thing?.creatorMemberId === fx.memberIds.m1a,
  );

  // ---------- 9. 旧 token 必须立刻失效 ----------
  phase('9. 旧 token 立即失效（JwtGuard 的账号状态检查）');
  const afterOld = await api('GET', '/api/families', { token: tokenA });
  expectCode('拿旧 token 访问 → 40100（未登录，触发静默重登）', afterOld, 40100);
  check('HTTP 状态码是 401', afterOld.status === 401, `实得 ${afterOld.status}`);

  const secondDel = await api('DELETE', '/api/auth/account', { token: tokenA });
  expectCode('重复注销 → 也是 40100（已被守卫挡下，不会二次执行）', secondDel, 40100);

  const uaAfter = await prisma.user.findUnique({ where: { id: fx.userIds.a } });
  check(
    '二次请求没有把 openid 再改一次（墓碑值稳定）',
    uaAfter?.openid === `deleted:${fx.userIds.a}`,
    `实得 ${uaAfter?.openid}`,
  );

  // ---------- 10. 别人不受影响 ----------
  phase('10. 其他家人不受影响');
  const bBefore = await api('GET', '/api/families', { token: tokenB });
  expectCode('B 的 token 照常可用', bBefore, 0);
  const bFamilies = bBefore.body?.data ?? [];
  check(
    'B 仍在 F1 里，且现在显示为创建者',
    bFamilies.length === 1 && bFamilies[0]?.familyId === Number(fx.familyIds.f1) && bFamilies[0]?.isOwner === true,
    JSON.stringify(bFamilies).slice(0, 160),
  );

  // ---------- 11. 同一个微信再登进来 = 全新空账号 ----------
  phase('11. 墓碑值不会和真实 openid 撞车');
  const collide = await prisma.user.findFirst({
    where: { openid: `deleted:${fx.userIds.a}` },
    select: { id: true },
  });
  check('墓碑值唯一命中 A 自己那一行（没有第二个人用它）', collide?.id === fx.userIds.a);
  note('注销后同一个微信再登录 → openid 命中不了墓碑值 → 新建一个干净账号（无家庭）。');
  note('这正是「注销」该有的语义：不是「登回原来那个号」，而是「从零开始」。');

  // ---------- 12. 清理 ----------
  phase('12. 清理夹具');
  await wipe();
  check('夹具已清空', true);

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
