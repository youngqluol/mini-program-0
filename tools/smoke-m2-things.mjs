#!/usr/bin/env node
/**
 * M2 真实链路端到端冒烟测试 —— 小事域（派活 / 叮一下）
 * =============================================================
 *
 * 为什么需要它：
 *   小事模块（docs/02 §四）是整个产品的骨架 —— 吃啥呢 → 派活 → 叮一下 →
 *   完成 → 留个念，后半段全压在这组接口上。其中三类东西**编译期完全查不出来**：
 *     ① 隐私过滤（`visibility=RELATED` 必须对无关成员不可见）
 *     ② 权限边界（创建人 / 执行人 / 创建者三种身份能干什么）
 *     ③ 状态机（PENDING → COMPLETED / CANCELLED，以及完成回执）
 *   这些只能打真接口验。
 *
 * 它做三件事：
 *   1. 通过 Prisma Client 建夹具：一个家庭 + 三个用户（owner / 成员 / 非成员）
 *   2. 用 node:crypto 手写 HS256 JWT（payload 与 AuthService.signToken 一致）
 *   3. 串行打小事域全部接口 + 边界用例，逐条断言返回体的 `code` 与字段形状
 *
 * 用法：
 *   ① 起服务：cd server && pnpm run build && TZ=Asia/Shanghai node dist/server/src/main.js
 *   ② 跑：node tools/smoke-m2-things.mjs
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

const U1 = 'smoke_u1'; // 家庭创建者 · 阿爸
const U2 = 'smoke_u2'; // 普通成员 · 阿妈（多处充当执行人）
const U3 = 'smoke_u3'; // 非成员 · 路人
const U4 = 'smoke_u4'; // 普通成员 · 阿公（既非创建者也非执行人，专门用来验 40301）
const ALL_OPENIDS = [U1, U2, U3, U4];

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

/**
 * 重建夹具。
 *
 * 与 M1 冒烟同样的取舍：夹具层用 `deleteMany` 做物理删除。
 * 业务代码不物理删除，但测试必须可重复运行。
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
      const things = await prisma.familyThing.findMany({
        where: { familyId: { in: staleFamilyIds } },
        select: { id: true },
      });
      const thingIds = things.map((t) => t.id);
      if (thingIds.length > 0) {
        await prisma.thingReminder.deleteMany({ where: { thingId: { in: thingIds } } });
        await prisma.notificationLog.deleteMany({ where: { thingId: { in: thingIds } } });
        await prisma.familyThing.deleteMany({ where: { id: { in: thingIds } } });
      }
      await prisma.notificationLog.deleteMany({
        where: { userId: { in: staleUserIds } },
      });
      await prisma.familyInvite.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.familyMember.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.family.deleteMany({ where: { id: { in: staleFamilyIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: staleUserIds } } });
  }

  const nicknames = { [U1]: '阿明', [U2]: '阿红', [U3]: '路人', [U4]: '老陈' };
  const userIds = {};
  for (const openid of ALL_OPENIDS) {
    const user = await prisma.user.create({
      data: { openid, nickname: nicknames[openid], status: 1, lastLoginAt: new Date() },
      select: { id: true },
    });
    userIds[openid] = user.id;
  }

  const family = await prisma.family.create({
    data: { name: '冒烟测试之家', status: 1 },
    select: { id: true },
  });
  const owner = await prisma.familyMember.create({
    data: { familyId: family.id, userId: userIds[U1], roleName: '阿爸', status: 1 },
    select: { id: true },
  });
  await prisma.family.update({
    where: { id: family.id },
    data: { ownerMemberId: owner.id },
  });
  const member2 = await prisma.familyMember.create({
    data: { familyId: family.id, userId: userIds[U2], roleName: '阿妈', status: 1 },
    select: { id: true },
  });
  const member4 = await prisma.familyMember.create({
    data: { familyId: family.id, userId: userIds[U4], roleName: '阿公', status: 1 },
    select: { id: true },
  });

  return {
    familyId: Number(family.id),
    ownerMemberId: Number(owner.id),
    member2Id: Number(member2.id),
    member4Id: Number(member4.id),
    u1: Number(userIds[U1]),
    u2: Number(userIds[U2]),
    u3: Number(userIds[U3]),
    u4: Number(userIds[U4]),
  };
}

// =============================================================
// JWT 与 HTTP
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
// 时间工具（与 server 的 beijing-time.ts 同口径）
// =============================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const pad = (n) => (n < 10 ? `0${n}` : String(n));

/** 北京时间「今天 + hh:mm」 → "YYYY-MM-DD HH:mm:ss" */
function todayAt(hour, minute) {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(hour)}:${pad(minute)}:00`;
}

/** 北京时间「今天 - 1 天 + hh:mm」（用于造「已过期」） */
function yesterdayAt(hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(hour)}:${pad(minute)}:00`;
}

// =============================================================
// 主流程
// =============================================================

async function main() {
  console.log('M2 端到端冒烟测试 · 小事域（派活 / 叮一下）');
  console.log(`目标服务：${BASE}`);

  // ---------- 0. 服务可达 ----------
  phase('0. 服务与基础设施');
  const health = await api('GET', '/api/health');
  expectCode('GET /api/health 返回 ok', health, 0);
  check('数据库连通 db=true', health.body?.data?.db === true);
  check('Redis 连通 redis=true', health.body?.data?.redis === true);

  // ---------- 1. 夹具 ----------
  phase('1. 准备测试夹具');
  const fx = await resetFixtures();
  console.log(
    `  家庭=${fx.familyId}  阿爸(owner)=${fx.ownerMemberId}  阿妈=${fx.member2Id}  阿公=${fx.member4Id}`,
  );
  const t1 = tokenFor(fx.u1, U1);
  const t2 = tokenFor(fx.u2, U2);
  const t3 = tokenFor(fx.u3, U3);
  const t4 = tokenFor(fx.u4, U4);

  // ---------- 2. 鉴权与入参 ----------
  phase('2. 鉴权与入参边界');
  expectCode('无 token 访问 /family-things → 40100', await api('GET', '/api/family-things'), 40100);
  expectCode(
    '无 token 创建小事 → 40100',
    await api('POST', '/api/family-things', { body: { familyId: fx.familyId } }),
    40100,
  );

  // ---------- 3. 创建派活 ----------
  phase('3. 创建派活（TASK）');
  expectCode(
    '缺 title → 40001',
    await api('POST', '/api/family-things', {
      token: t1,
      body: { familyId: fx.familyId, type: 'TASK', assigneeMemberId: fx.member2Id },
    }),
    40001,
  );
  expectCode(
    '缺 assigneeMemberId → 40001',
    await api('POST', '/api/family-things', {
      token: t1,
      body: { familyId: fx.familyId, type: 'TASK', title: '买菜' },
    }),
    40001,
  );
  expectCode(
    'title 超 200 字 → 40001',
    await api('POST', '/api/family-things', {
      token: t1,
      body: {
        familyId: fx.familyId,
        type: 'TASK',
        title: '买'.repeat(201),
        assigneeMemberId: fx.member2Id,
      },
    }),
    40001,
  );
  expectCode(
    'type 非法值 → 40001',
    await api('POST', '/api/family-things', {
      token: t1,
      body: { familyId: fx.familyId, type: 'HOMEWORK', title: '写作业', assigneeMemberId: fx.member2Id },
    }),
    40001,
  );
  expectCode(
    '派给不在这个家的人 → 40001',
    await api('POST', '/api/family-things', {
      token: t1,
      body: { familyId: fx.familyId, type: 'TASK', title: '买菜', assigneeMemberId: 99999999 },
    }),
    40001,
  );
  expectCode(
    '非成员往这个家派活 → 40300',
    await api('POST', '/api/family-things', {
      token: t3,
      body: { familyId: fx.familyId, type: 'TASK', title: '我来派', assigneeMemberId: fx.member2Id },
    }),
    40300,
  );

  const dueToday = todayAt(18, 0);
  const taskCreated = await api('POST', '/api/family-things', {
    token: t1,
    body: {
      familyId: fx.familyId,
      type: 'TASK',
      title: '今晚买菜',
      content: '楼下超市，买两盒牛奶',
      assigneeMemberId: fx.member2Id,
      dueAt: dueToday,
      reminders: [{ remindType: 'SCHEDULED', remindAt: todayAt(17, 30) }],
    },
  });
  expectCode('POST /family-things 创建派活', taskCreated, 0);
  const task = taskCreated.body?.data ?? {};
  const taskId = task.id;
  check('返回 id 为正整数', Number.isInteger(taskId) && taskId > 0, String(taskId));
  check('type=TASK', task.type === 'TASK', String(task.type));
  check('status=PENDING', task.status === 'PENDING', String(task.status));
  check('visibility 默认 FAMILY', task.visibility === 'FAMILY', String(task.visibility));
  check('creator 是阿爸', task.creator?.roleName === '阿爸', String(task.creator?.roleName));
  check('assignee 是阿妈', task.assignee?.roleName === '阿妈', String(task.assignee?.roleName));
  check('dueAt 回北京时间格式', task.dueAt === dueToday, String(task.dueAt));
  check('hasReminder=true', task.hasReminder === true);
  check('nextRemindAt 为北京时间格式', DATE_RE.test(task.nextRemindAt ?? ''), String(task.nextRemindAt));
  check(
    'isOverdue 与「此刻是否已过要求时间」一致',
    task.isOverdue === Date.now() > new Date(`${dueToday.replace(' ', 'T')}+08:00`).getTime(),
    `isOverdue=${task.isOverdue} dueAt=${dueToday}`,
  );
  check('createdAt 为北京时间格式', DATE_RE.test(task.createdAt ?? ''), String(task.createdAt));
  check('reminders 长度 1', Array.isArray(task.reminders) && task.reminders.length === 1);
  check(
    'reminder.status=PENDING',
    task.reminders?.[0]?.status === 'PENDING',
    String(task.reminders?.[0]?.status),
  );
  check(
    'reminder.remindType=SCHEDULED',
    task.reminders?.[0]?.remindType === 'SCHEDULED',
    String(task.reminders?.[0]?.remindType),
  );
  check('completedAt=null', task.completedAt === null);
  check('cancelledAt=null', task.cancelledAt === null);

  expectCode(
    '定时提醒缺 remindAt → 40001',
    await api('POST', '/api/family-things', {
      token: t1,
      body: {
        familyId: fx.familyId,
        type: 'TASK',
        title: '缺时间的提醒',
        assigneeMemberId: fx.member2Id,
        reminders: [{ remindType: 'SCHEDULED' }],
      },
    }),
    40001,
  );

  // 派活通知应写进 notification_logs（给阿妈）
  const assignLog = await prisma.notificationLog.findFirst({
    where: { thingId: BigInt(taskId), type: 1 },
    orderBy: { id: 'desc' },
  });
  check('派活通知已写 notification_logs（type=TASK_ASSIGNED）', assignLog != null);
  check('通知接收人是阿妈（userId）', Number(assignLog?.userId) === fx.u2, String(assignLog?.userId));
  check(
    '未开微信提醒时降级为站内消息（channel=IN_APP）',
    assignLog?.channel === 2,
    String(assignLog?.channel),
  );
  check(
    '降级状态为 NOT_BOUND(5)',
    assignLog?.status === 5,
    String(assignLog?.status),
  );

  // ---------- 4. 创建叮一下（立即） ----------
  phase('4. 创建叮一下（REMINDER · 立即叮）');
  const nudgeCreated = await api('POST', '/api/family-things', {
    token: t1,
    body: {
      familyId: fx.familyId,
      type: 'REMINDER',
      title: '记得拿快递',
      assigneeMemberId: fx.member2Id,
      reminders: [{ remindType: 'NOW' }],
    },
  });
  expectCode('POST /family-things 创建叮一下', nudgeCreated, 0);
  const nudge = nudgeCreated.body?.data ?? {};
  check('type=REMINDER', nudge.type === 'REMINDER', String(nudge.type));
  check('visibility 默认 RELATED', nudge.visibility === 'RELATED', String(nudge.visibility));
  check('dueAt=null（立即叮不要求时间）', nudge.dueAt === null, String(nudge.dueAt));
  check(
    '立即叮的提醒已置 SENT',
    nudge.reminders?.[0]?.status === 'SENT',
    String(nudge.reminders?.[0]?.status),
  );
  check('sentCount=1', nudge.reminders?.[0]?.sentCount === 1, String(nudge.reminders?.[0]?.sentCount));
  check('hasReminder=false（已发完，没有待发提醒）', nudge.hasReminder === false);

  const nudgeLog = await prisma.notificationLog.findFirst({
    where: { thingId: BigInt(nudge.id), type: 2 },
    orderBy: { id: 'desc' },
  });
  check('叮一下通知已写 notification_logs（type=REMINDER）', nudgeLog != null);

  // 自己给自己叮：不产生派活通知，但产生叮一下通知
  const selfNudge = await api('POST', '/api/family-things', {
    token: t1,
    body: {
      familyId: fx.familyId,
      type: 'REMINDER',
      title: '自己记一下',
      assigneeMemberId: fx.ownerMemberId,
      reminders: [{ remindType: 'NOW' }],
    },
  });
  expectCode('自己给自己叮一下', selfNudge, 0);
  const selfTaskLogs = await prisma.notificationLog.findMany({
    where: { thingId: BigInt(selfNudge.body?.data?.id), type: 1 },
  });
  check('自己给自己派活不发通知', selfTaskLogs.length === 0, String(selfTaskLogs.length));

  // ---------- 5. 隐私过滤 ----------
  phase('5. 隐私过滤（visibility=RELATED）');
  // 「自己记一下」是 RELATED 且只有阿爸参与 → 阿妈（同家成员）不该看见
  const u2DetailOnRelated = await api('GET', `/api/family-things/${selfNudge.body?.data?.id}`, {
    token: t2,
  });
  expectCode('无关成员读 RELATED 小事详情 → 40400（不泄露存在性）', u2DetailOnRelated, 40400);

  const u2List = await api('GET', `/api/family-things?familyId=${fx.familyId}`, { token: t2 });
  expectCode('阿妈读小事列表', u2List, 0);
  const u2Ids = (u2List.body?.data?.list ?? []).map((x) => x.id);
  check('列表里不含无关的 RELATED 小事', !u2Ids.includes(selfNudge.body?.data?.id));
  check('列表里含派给阿妈的派活', u2Ids.includes(taskId));
  check('列表里含叮阿妈的提醒', u2Ids.includes(nudge.id));

  const u3Detail = await api('GET', `/api/family-things/${taskId}`, { token: t3 });
  expectCode('非成员读小事详情 → 40300', u3Detail, 40300);
  const u3List = await api('GET', `/api/family-things?familyId=${fx.familyId}`, { token: t3 });
  expectCode('非成员读小事列表 → 40300', u3List, 40300);

  expectCode(
    '不存在的小事 → 40400',
    await api('GET', '/api/family-things/99999999', { token: t1 }),
    40400,
  );
  expectCode('小事 id 非数字 → 40001', await api('GET', '/api/family-things/abc', { token: t1 }), 40001);

  // ---------- 6. 列表筛选 ----------
  phase('6. 列表筛选');
  const onlyTask = await api('GET', `/api/family-things?familyId=${fx.familyId}&type=TASK`, {
    token: t1,
  });
  check(
    'type=TASK 只返回派活',
    (onlyTask.body?.data?.list ?? []).every((x) => x.type === 'TASK'),
  );
  const onlyReminder = await api(
    'GET',
    `/api/family-things?familyId=${fx.familyId}&type=REMINDER`,
    { token: t1 },
  );
  check(
    'type=REMINDER 只返回叮一下',
    (onlyReminder.body?.data?.list ?? []).every((x) => x.type === 'REMINDER'),
  );

  const assignedToMe = await api(
    'GET',
    `/api/family-things?familyId=${fx.familyId}&scope=ASSIGNED_TO_ME`,
    { token: t2 },
  );
  check(
    'scope=ASSIGNED_TO_ME 只返回派给我的',
    (assignedToMe.body?.data?.list ?? []).every((x) => x.assignee?.roleName === '阿妈'),
  );

  const mine = await api('GET', `/api/family-things?familyId=${fx.familyId}&scope=MINE`, {
    token: t1,
  });
  check(
    'scope=MINE 只返回我发起的',
    (mine.body?.data?.list ?? []).every((x) => x.creator?.roleName === '阿爸'),
  );

  const byKeyword = await api(
    'GET',
    `/api/family-things?familyId=${fx.familyId}&keyword=${encodeURIComponent('买菜')}`,
    { token: t1 },
  );
  check(
    'keyword 命中标题',
    (byKeyword.body?.data?.list ?? []).length >= 1 &&
      (byKeyword.body?.data?.list ?? []).every((x) => x.title.includes('买菜')),
  );

  const paged = await api('GET', `/api/family-things?familyId=${fx.familyId}&pageSize=1`, {
    token: t1,
  });
  check('pageSize=1 只返回 1 条', (paged.body?.data?.list ?? []).length === 1);
  check('返回 hasMore 字段', typeof paged.body?.data?.hasMore === 'boolean');
  check('返回 total 字段', Number.isInteger(paged.body?.data?.total));

  // ---------- 7. 编辑 ----------
  phase('7. 编辑（M2-B14）');
  expectCode(
    '非创建者（阿妈）编辑 → 40301',
    await api('PATCH', `/api/family-things/${taskId}`, { token: t2, body: { title: '我改的' } }),
    40301,
  );
  expectCode(
    '创建者编辑别人的小事（阿爸是 owner）→ 0',
    await api('PATCH', `/api/family-things/${nudge.id}`, { token: t1, body: { title: '拿快递呀' } }),
    0,
  );

  const edited = await api('PATCH', `/api/family-things/${taskId}`, {
    token: t1,
    body: {
      title: '今晚买菜和面包',
      dueAt: todayAt(19, 0),
      reminders: [{ remindType: 'SCHEDULED', remindAt: todayAt(18, 30) }],
    },
  });
  expectCode('创建者编辑成功', edited, 0);
  check('标题已更新', edited.body?.data?.title === '今晚买菜和面包', String(edited.body?.data?.title));
  check('dueAt 已更新', edited.body?.data?.dueAt === todayAt(19, 0), String(edited.body?.data?.dueAt));
  const remindersAfterEdit = edited.body?.data?.reminders ?? [];
  check(
    'reminders 共 2 条（1 条已取消 + 1 条待发）',
    remindersAfterEdit.length === 2,
    String(remindersAfterEdit.length),
  );
  const pendingRem = remindersAfterEdit.find((r) => r.status === 'PENDING');
  check(
    '新提醒 remindAt 已更新',
    pendingRem?.remindAt === todayAt(18, 30),
    String(pendingRem?.remindAt),
  );
  check(
    '旧提醒被置为 CANCELLED（不物理删）',
    remindersAfterEdit.filter((r) => r.status === 'CANCELLED').length === 1,
    JSON.stringify(remindersAfterEdit.map((r) => r.status)),
  );
  check('hasReminder 仍为 true', edited.body?.data?.hasReminder === true);

  // ---------- 8. 完成 ----------
  phase('8. 完成小事（M2-B15）');
  expectCode(
    '同家成员但既非执行人也非创建者（阿公）→ 40301',
    await api('POST', `/api/family-things/${taskId}/complete`, { token: t4 }),
    40301,
  );

  const completed = await api('POST', `/api/family-things/${taskId}/complete`, { token: t2 });
  expectCode('执行人（阿妈）完成成功', completed, 0);
  check('status=COMPLETED', completed.body?.data?.status === 'COMPLETED');
  check(
    'completedAt 为北京时间格式',
    DATE_RE.test(completed.body?.data?.completedAt ?? ''),
    String(completed.body?.data?.completedAt),
  );
  check('completedBy 是阿妈', completed.body?.data?.completedBy?.roleName === '阿妈');
  check('nextThingId=null（非重复小事）', completed.body?.data?.nextThingId === null);

  const doneLog = await prisma.notificationLog.findFirst({
    where: { thingId: BigInt(taskId), type: 3 },
    orderBy: { id: 'desc' },
  });
  check('完成回执已发给创建人（type=TASK_DONE）', doneLog != null);
  check('完成回执接收人是阿爸', Number(doneLog?.userId) === fx.u1, String(doneLog?.userId));

  const pendingAfterDone = await prisma.thingReminder.findMany({
    where: { thingId: BigInt(taskId), status: 1 },
  });
  check('完成后没有残留的待发提醒', pendingAfterDone.length === 0, String(pendingAfterDone.length));

  expectCode(
    '重复完成 → 40900',
    await api('POST', `/api/family-things/${taskId}/complete`, { token: t2 }),
    40900,
  );

  // 家庭创建者也能替家人说「搞定啦」（docs/02 §4.5 权限：执行人本人，或家庭创建者）
  const forOwner = await api('POST', '/api/family-things', {
    token: t1,
    body: {
      familyId: fx.familyId,
      type: 'TASK',
      title: '让创建者来收尾',
      assigneeMemberId: fx.member2Id,
    },
  });
  const ownerCompletedId = forOwner.body?.data?.id;
  expectCode(
    '家庭创建者替执行人完成 → 0',
    await api('POST', `/api/family-things/${ownerCompletedId}/complete`, { token: t1 }),
    0,
  );

  // ---------- 9. 今日汇总 ----------
  phase('9. 首页今日汇总（M2-B12）');
  const today = await api('GET', `/api/family-things/today?familyId=${fx.familyId}`, { token: t1 });
  expectCode('GET /family-things/today', today, 0);
  const t = today.body?.data ?? {};
  check('date 为 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? ''), String(t.date));
  check('tasks 是数组', Array.isArray(t.tasks));
  check('reminders 是数组', Array.isArray(t.reminders));
  check('stats.todayTotal 为数字', Number.isInteger(t.stats?.todayTotal), String(t.stats?.todayTotal));
  check('stats.todayDone 为数字', Number.isInteger(t.stats?.todayDone), String(t.stats?.todayDone));
  check('stats.overdue 为数字', Number.isInteger(t.stats?.overdue), String(t.stats?.overdue));
  check('今日完成数 ≥ 1（刚完成的那条）', (t.stats?.todayDone ?? 0) >= 1, String(t.stats?.todayDone));
  const todayReminder = (t.reminders ?? []).find((r) => r.id === nudge.id);
  check('今日提醒里含刚创建的叮一下', todayReminder != null);
  check('今日提醒 time 为 HH:mm', /^\d{2}:\d{2}$/.test(todayReminder?.time ?? ''), String(todayReminder?.time));

  // ---------- 10. 过期与取消 / 重开 ----------
  phase('10. 过期、取消、重新打开（M2-B16）');
  const overdue = await api('POST', '/api/family-things', {
    token: t1,
    body: {
      familyId: fx.familyId,
      type: 'TASK',
      title: '昨天就该做的事',
      assigneeMemberId: fx.member2Id,
      dueAt: yesterdayAt(12, 0),
    },
  });
  expectCode('创建一条已过期的小事', overdue, 0);
  check('isOverdue=true', overdue.body?.data?.isOverdue === true);

  expectCode(
    '非创建者（阿妈）取消 → 40301',
    await api('POST', `/api/family-things/${overdue.body?.data?.id}/cancel`, { token: t2 }),
    40301,
  );
  expectCode(
    '同家成员但非创建者（阿公）取消 → 40301',
    await api('POST', `/api/family-things/${overdue.body?.data?.id}/cancel`, { token: t4 }),
    40301,
  );
  expectCode(
    '同家成员但非创建者（阿公）编辑 → 40301',
    await api('PATCH', `/api/family-things/${overdue.body?.data?.id}`, {
      token: t4,
      body: { title: '我改一下' },
    }),
    40301,
  );
  expectCode(
    '创建者取消成功',
    await api('POST', `/api/family-things/${overdue.body?.data?.id}/cancel`, { token: t1 }),
    0,
  );
  const cancelled = await api('GET', `/api/family-things/${overdue.body?.data?.id}`, { token: t1 });
  check('status=CANCELLED', cancelled.body?.data?.status === 'CANCELLED');
  check(
    'cancelledAt 为北京时间格式',
    DATE_RE.test(cancelled.body?.data?.cancelledAt ?? ''),
    String(cancelled.body?.data?.cancelledAt),
  );
  expectCode(
    '取消后编辑 → 40900',
    await api('PATCH', `/api/family-things/${overdue.body?.data?.id}`, {
      token: t1,
      body: { title: '还能改吗' },
    }),
    40900,
  );

  const defaultList = await api('GET', `/api/family-things?familyId=${fx.familyId}`, { token: t1 });
  check(
    '不传 status 时列表不含已取消的小事',
    !(defaultList.body?.data?.list ?? []).some((x) => x.id === overdue.body?.data?.id),
  );
  const cancelledList = await api(
    'GET',
    `/api/family-things?familyId=${fx.familyId}&status=CANCELLED`,
    { token: t1 },
  );
  check(
    'status=CANCELLED 能查到它',
    (cancelledList.body?.data?.list ?? []).some((x) => x.id === overdue.body?.data?.id),
  );

  expectCode(
    '重新打开成功',
    await api('POST', `/api/family-things/${overdue.body?.data?.id}/reopen`, { token: t1 }),
    0,
  );
  const reopened = await api('GET', `/api/family-things/${overdue.body?.data?.id}`, { token: t1 });
  check('reopen 后 status=PENDING', reopened.body?.data?.status === 'PENDING');
  check('reopen 后 cancelledAt=null', reopened.body?.data?.cancelledAt === null);

  expectCode(
    '重开已完成的小事也成功',
    await api('POST', `/api/family-things/${taskId}/reopen`, { token: t1 }),
    0,
  );
  const reopenedDone = await api('GET', `/api/family-things/${taskId}`, { token: t1 });
  check('重开后 completedAt=null', reopenedDone.body?.data?.completedAt === null);
  check('重开后 completedBy=null', reopenedDone.body?.data?.completedBy === null);

  // ---------- 11. 提醒：立即叮一下 / 收件箱 / 加取消 ----------
  phase('11. 提醒模块（M2-B17 / M2-B24 / docs/02 §5.1 / §5.2）');
  const selfNudgeReminderId = selfNudge.body?.data?.reminders?.[0]?.id;

  expectCode(
    'nudge 既没有 thingId 也没有 content → 40001',
    await api('POST', '/api/reminders/nudge', {
      token: t1,
      body: { familyId: fx.familyId, recipientMemberId: fx.member2Id },
    }),
    40001,
  );
  expectCode(
    'nudge 叮一个不在这个家的人 → 40001',
    await api('POST', '/api/reminders/nudge', {
      token: t1,
      body: { familyId: fx.familyId, recipientMemberId: 99999999, content: '喂' },
    }),
    40001,
  );
  expectCode(
    'nudge 非成员调用 → 40300',
    await api('POST', '/api/reminders/nudge', {
      token: t3,
      body: { familyId: fx.familyId, recipientMemberId: fx.member2Id, content: '喂' },
    }),
    40300,
  );

  const nudged = await api('POST', '/api/reminders/nudge', {
    token: t1,
    body: { familyId: fx.familyId, recipientMemberId: fx.member2Id, content: '顺路带瓶酱油' },
  });
  expectCode('nudge 纯叮一下（自动建 REMINDER 小事）', nudged, 0);
  const nd = nudged.body?.data ?? {};
  check('返回 thingId 与 reminderId', Number.isInteger(nd.thingId) && Number.isInteger(nd.reminderId));
  check(
    'deliveryStatus=NOT_BOUND（对方没开微信提醒）',
    nd.deliveryStatus === 'NOT_BOUND',
    String(nd.deliveryStatus),
  );
  check('deliveryChannel=IN_APP（站内兜底）', nd.deliveryChannel === 'IN_APP', String(nd.deliveryChannel));
  check(
    'quotaRemaining 为数字或 null',
    nd.quotaRemaining === null || Number.isInteger(nd.quotaRemaining),
    String(nd.quotaRemaining),
  );

  const nudgedThing = await api('GET', `/api/family-things/${nd.thingId}`, { token: t1 });
  check('自动建的小事 type=REMINDER', nudgedThing.body?.data?.type === 'REMINDER');
  check('自动建的小事 visibility=RELATED', nudgedThing.body?.data?.visibility === 'RELATED');
  check('自动建的小事 title 取 content', nudgedThing.body?.data?.title === '顺路带瓶酱油');
  check('自动建的小事 assignee 是阿妈', nudgedThing.body?.data?.assignee?.roleName === '阿妈');

  const nudgeLog2 = await prisma.notificationLog.findFirst({
    where: { thingId: BigInt(nd.thingId), type: 2 },
  });
  check('nudge 也写了 notification_logs', nudgeLog2 != null);

  const nudgedOnExisting = await api('POST', '/api/reminders/nudge', {
    token: t1,
    body: { familyId: fx.familyId, recipientMemberId: fx.member2Id, thingId: nudge.id },
  });
  expectCode('nudge 关联已有小事', nudgedOnExisting, 0);
  check('返回的 thingId 就是那条小事', nudgedOnExisting.body?.data?.thingId === nudge.id);

  expectCode(
    'nudge 一条已完成的小事 → 40900',
    await api('POST', '/api/reminders/nudge', {
      token: t1,
      body: { familyId: fx.familyId, recipientMemberId: fx.member2Id, thingId: ownerCompletedId },
    }),
    40900,
  );

  // 收件箱
  const inbox2 = await api('GET', `/api/reminders/inbox?familyId=${fx.familyId}`, { token: t2 });
  expectCode('GET /reminders/inbox（阿妈）', inbox2, 0);
  const inboxList = inbox2.body?.data?.list ?? [];
  check('收件箱含刚叮给阿妈的那条', inboxList.some((x) => x.thingId === nd.thingId));
  check('收件箱 unreadCount > 0', (inbox2.body?.data?.unreadCount ?? 0) > 0);
  const inboxRow = inboxList.find((x) => x.thingId === nd.thingId) ?? {};
  check('收件箱条目 fromRoleName=阿爸', inboxRow.fromRoleName === '阿爸', String(inboxRow.fromRoleName));
  check('收件箱条目 isRead=false', inboxRow.isRead === false);
  check('收件箱条目 remindAt 为北京时间格式', DATE_RE.test(inboxRow.remindAt ?? ''), String(inboxRow.remindAt));

  const inbox1 = await api('GET', `/api/reminders/inbox?familyId=${fx.familyId}`, { token: t1 });
  check(
    '阿爸的收件箱里没有叮给阿妈的那条',
    !(inbox1.body?.data?.list ?? []).some((x) => x.thingId === nd.thingId),
  );

  const unreadBefore = inbox2.body?.data?.unreadCount ?? 0;
  expectCode(
    '标记已读',
    await api('POST', `/api/reminders/inbox/${inboxRow.id}/read`, { token: t2 }),
    0,
  );
  const inboxAfter = await api('GET', `/api/reminders/inbox?familyId=${fx.familyId}`, { token: t2 });
  const readRow = (inboxAfter.body?.data?.list ?? []).find((x) => x.id === inboxRow.id) ?? {};
  check('标记后 isRead=true', readRow.isRead === true);
  check(
    '标记后 unreadCount 少 1',
    inboxAfter.body?.data?.unreadCount === unreadBefore - 1,
    `${unreadBefore} → ${inboxAfter.body?.data?.unreadCount}`,
  );
  expectCode(
    '重复标记（幂等）',
    await api('POST', `/api/reminders/inbox/${inboxRow.id}/read`, { token: t2 }),
    0,
  );
  expectCode(
    '标记别人收到的提醒 → 40400',
    await api('POST', `/api/reminders/inbox/${selfNudgeReminderId}/read`, { token: t2 }),
    40400,
  );
  expectCode(
    '提醒 id 非数字 → 40001',
    await api('POST', '/api/reminders/inbox/abc/read', { token: t2 }),
    40001,
  );

  // 给已有小事加 / 取消提醒
  const reminderHost = await api('POST', '/api/family-things', {
    token: t1,
    body: {
      familyId: fx.familyId,
      type: 'TASK',
      title: '拿来加提醒的活',
      assigneeMemberId: fx.member2Id,
    },
  });
  const hostId = reminderHost.body?.data?.id;

  expectCode(
    '加提醒缺 remindAt 的 SCHEDULED → 40001',
    await api('POST', `/api/family-things/${hostId}/reminders`, {
      token: t1,
      body: { remindType: 'SCHEDULED' },
    }),
    40001,
  );
  expectCode(
    '同家成员但非创建者（阿公）加提醒 → 40301',
    await api('POST', `/api/family-things/${hostId}/reminders`, {
      token: t4,
      body: { remindType: 'SCHEDULED', remindAt: todayAt(20, 0) },
    }),
    40301,
  );

  const added = await api('POST', `/api/family-things/${hostId}/reminders`, {
    token: t1,
    body: { remindType: 'SCHEDULED', remindAt: todayAt(20, 0) },
  });
  expectCode('创建者给小事补一条提醒', added, 0);
  check(
    '返回更新后的小事详情（reminders 多一条）',
    (added.body?.data?.reminders ?? []).length === 1,
    String((added.body?.data?.reminders ?? []).length),
  );
  check('hasReminder=true', added.body?.data?.hasReminder === true);
  const addedReminderId = added.body?.data?.reminders?.[0]?.id;
  check(
    '新提醒接收人默认取执行人（阿妈）',
    (await api('GET', `/api/reminders/inbox?familyId=${fx.familyId}`, { token: t2 })).body?.data?.list?.some(
      (x) => x.id === addedReminderId,
    ) === true,
  );

  expectCode(
    '同家成员但非创建者（阿公）取消提醒 → 40301',
    await api('DELETE', `/api/reminders/${addedReminderId}`, { token: t4 }),
    40301,
  );
  expectCode(
    '接收人本人（阿妈）可以取消叮自己的提醒',
    await api('DELETE', `/api/reminders/${addedReminderId}`, { token: t2 }),
    0,
  );
  const afterCancel = await api('GET', `/api/family-things/${hostId}`, { token: t1 });
  check(
    '取消后该条提醒 status=CANCELLED',
    afterCancel.body?.data?.reminders?.find((r) => r.id === addedReminderId)?.status === 'CANCELLED',
  );
  check('取消后 hasReminder=false', afterCancel.body?.data?.hasReminder === false);
  expectCode(
    '取消不存在的提醒 → 40400',
    await api('DELETE', '/api/reminders/99999999', { token: t1 }),
    40400,
  );

  // ---------- 12. 消息中心 + 我的称谓 ----------
  phase('12. 消息中心（M2-B25）与我的称谓（M2-B26）');
  expectCode('无 token 读消息中心 → 40100', await api('GET', '/api/notifications'), 40100);

  const notif1 = await api('GET', '/api/notifications', { token: t1 });
  expectCode('GET /notifications（阿爸）', notif1, 0);
  const nList = notif1.body?.data?.list ?? [];
  check('列表非空（阿爸收到过完成回执）', nList.length > 0, String(nList.length));
  check('unreadCount > 0', (notif1.body?.data?.unreadCount ?? 0) > 0);
  check('返回分页字段', Number.isInteger(notif1.body?.data?.page) && Number.isInteger(notif1.body?.data?.total));
  check('hasMore 为布尔', typeof notif1.body?.data?.hasMore === 'boolean');
  const nItem = nList[0] ?? {};
  check('条目含 channel / status / isRead', 'channel' in nItem && 'status' in nItem && 'isRead' in nItem);
  check('条目 createdAt 为北京时间格式', DATE_RE.test(nItem.createdAt ?? ''), String(nItem.createdAt));
  check(
    '条目 type 是字符串枚举',
    ['TASK_ASSIGNED', 'REMINDER', 'TASK_DONE', 'JOIN_FAMILY', 'SYSTEM'].includes(nItem.type),
    String(nItem.type),
  );
  check(
    '条目 channel 是字符串枚举',
    ['SUBSCRIBE', 'IN_APP', 'MP_TEMPLATE'].includes(nItem.channel),
    String(nItem.channel),
  );

  const notifDone = await api('GET', '/api/notifications?type=TASK_DONE', { token: t1 });
  expectCode('type=TASK_DONE 筛选', notifDone, 0);
  check(
    '筛选后只剩 TASK_DONE',
    (notifDone.body?.data?.list ?? []).every((x) => x.type === 'TASK_DONE') &&
      (notifDone.body?.data?.list ?? []).length > 0,
  );
  expectCode(
    'type 非法值 → 40001',
    await api('GET', '/api/notifications?type=BOGUS', { token: t1 }),
    40001,
  );

  const unread = await api('GET', '/api/notifications/unread-count', { token: t1 });
  expectCode('GET /notifications/unread-count', unread, 0);
  check(
    '未读数与列表里的 unreadCount 一致',
    unread.body?.data?.unreadCount === notif1.body?.data?.unreadCount,
    `${unread.body?.data?.unreadCount} vs ${notif1.body?.data?.unreadCount}`,
  );

  const readAll = await api('POST', '/api/notifications/read-all', { token: t1 });
  expectCode('POST /notifications/read-all', readAll, 0);
  check('全部已读有更新条数', (readAll.body?.data?.updated ?? 0) >= 1, String(readAll.body?.data?.updated));
  const unreadAfter = await api('GET', '/api/notifications/unread-count', { token: t1 });
  check('全部已读后未读数归零', unreadAfter.body?.data?.unreadCount === 0);
  const notifAfter = await api('GET', '/api/notifications', { token: t1 });
  check('全部已读后 isRead 全为 true', (notifAfter.body?.data?.list ?? []).every((x) => x.isRead === true));
  expectCode(
    '重复全部已读（幂等）',
    await api('POST', '/api/notifications/read-all', { token: t1 }),
    0,
  );
  check(
    '阿妈的消息中心与阿爸的相互独立',
    (await api('GET', '/api/notifications', { token: t2 })).body?.data?.unreadCount > 0,
  );

  const me2 = await api('GET', `/api/families/${fx.familyId}/members/me`, { token: t2 });
  expectCode('GET /families/:id/members/me（阿妈）', me2, 0);
  check('返回 roleName=阿妈', me2.body?.data?.roleName === '阿妈', String(me2.body?.data?.roleName));
  check('返回 memberId 正确', me2.body?.data?.memberId === fx.member2Id);
  check('阿妈 isOwner=false', me2.body?.data?.isOwner === false);
  check('joinedAt 为北京时间格式', DATE_RE.test(me2.body?.data?.joinedAt ?? ''));

  const me1 = await api('GET', `/api/families/${fx.familyId}/members/me`, { token: t1 });
  check('阿爸 roleName=阿爸', me1.body?.data?.roleName === '阿爸');
  check('阿爸 isOwner=true', me1.body?.data?.isOwner === true);
  expectCode(
    '非成员读我的称谓 → 40300',
    await api('GET', `/api/families/${fx.familyId}/members/me`, { token: t3 }),
    40300,
  );

  // ---------- 13. 观察项 ----------
  phase('13. 观察项（非阻塞）');
  note('立即叮（remindType=NOW）在创建流程内同步下发，并把该条提醒置 SENT。');
  note('  若将来改为「入队后由调度器发」，这里的行为会变，冒烟脚本需同步调整。');
  note('定时提醒的 next_remind_at 已写好，但**调度器尚未实现**（M2-B20），到点不会真发。');
  note('三档 deliveryStatus 目前只会出现 NOT_BOUND —— 因为没开微信提醒（mp_openid 为空）。');
  note('  等推送通道打通（M0-V1/V2）后，同一条 nudge 应返回 SENT + MP_TEMPLATE。');
  note('内容安全（M2-B9）**本脚本验的是 fail-open 路径**：夹具 openid 是造的假值，');
  note('  微信必然回 40003，于是走「判不了 → 放行」。所以这里只能保证「不误拦、不阻塞」，');
  note('  验不了「违规被拦」。要看真实结论用 `node tools/probe-seccheck.mjs`（唯一能看到 suggest 的方式）。');
  note('  确认链路真的被调用：跑完看服务日志里的 `[ContentSecurityService] 内容安全判不了，放行`。');

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
