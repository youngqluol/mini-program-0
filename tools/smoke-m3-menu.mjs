#!/usr/bin/env node
/**
 * M3 真实链路端到端冒烟测试 —— 吃啥呢域（随机 / 菜谱 / 决定 / 最近吃过）
 * ============================================================================
 *
 * 为什么需要它：
 *   吃啥呢是「小事闭环」的起点（吃啥呢 → 派活 → 叮一下 → 完成 → 留个念），
 *   而它有三类东西**编译期完全查不出来**：
 *     ① 池子的构成（系统菜谱常量 + 本家庭菜谱，且**只含启用的**）
 *     ② 「排除最近吃过的」——判据是**菜名**而不是 id，容易漏、容易误伤
 *     ③ 跨家庭越权（拿别人家的 menuItemId 记自己的用餐记录）
 *   这些只能打真接口验。
 *
 * 它做四件事：
 *   1. 通过 Prisma Client 建夹具：两个家庭 + 若干用户 + 两份菜谱 + 用餐记录
 *   2. 用 node:crypto 手写 HS256 JWT（payload 与 AuthService.signToken 一致）
 *   3. 串行打吃啥呢的四个读接口 + 边界用例，逐条断言 `code` 与字段形状
 *   4. 用 Prisma 直接回查库，验证「写进去的到底是不是这些」
 *
 * 用法：
 *   ① 起服务（带新代码）：cd server && PORT=3100 TZ=Asia/Shanghai \
 *        npx --no-install ts-node -r tsconfig-paths/register src/main.ts
 *      或走构建产物：cd server && pnpm run build && TZ=Asia/Shanghai node dist/server/src/main.js
 *   ② 跑：SMOKE_BASE_URL=http://127.0.0.1:3100 node tools/smoke-m3-menu.mjs
 *
 * 环境变量：
 *   SMOKE_BASE_URL   默认 http://127.0.0.1:3000
 *
 * 为什么数据库夹具走 Prisma 而不是 `docker exec mysql`：
 *   WorkBuddy 沙箱 hook 了 Node 的 child_process，**任何**子进程创建都直接
 *   EBUSY（连 `node -v` 都起不来）。Prisma 6 默认用 N-API library 引擎，
 *   不 spawn 子进程，所以在沙箱里依然能连库。
 *
 * ⚠️ 只对**本地开发库**生效。脚本会物理删除 openid 以 `smoke_m` 开头的用户
 *    及其家庭数据 —— 业务代码坚持不做物理删除，但测试夹具必须可重复运行。
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

// 用 smoke_m 前缀与 M2 冒烟脚本（smoke_u）隔开，两者可同时存在、互不干扰
const M1 = 'smoke_m1'; // 甲家创建者 · 阿爸
const M2 = 'smoke_m2'; // 甲家成员 · 阿妈（多处充当执行人）
const M3 = 'smoke_m3'; // 非成员 · 路人
const M4 = 'smoke_m4'; // 甲家成员 · 阿公
const M5 = 'smoke_m5'; // 乙家创建者 · 老李（用于验跨家庭越权）
const ALL_OPENIDS = [M1, M2, M3, M4, M5];

/** 系统菜谱条数 —— 与 `default-menu.ts` 的「共 72 条」一致 */
const SYSTEM_DISH_COUNT = 72;

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
  return check(
    name,
    actual === code,
    `期望 code=${code}，实得 ${actual} (HTTP ${res.status}) ${msg}`,
  );
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

/** 北京时间「今天」的日期串 */
const pad = (n) => (n < 10 ? `0${n}` : String(n));
function beijingToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 北京时间「今天 + offset 天」的日期串（offset 可为负） */
function beijingDayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 重建夹具。
 *
 * 与 M2 冒烟同样的取舍：夹具层用 `deleteMany` 做物理删除。
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
      // 吃啥呢的两张表先清（meal_records.menu_item_id 逻辑上指向 menu_items）
      await prisma.mealRecord.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.menuItem.deleteMany({ where: { familyId: { in: staleFamilyIds } } });

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
      await prisma.notificationLog.deleteMany({ where: { userId: { in: staleUserIds } } });
      await prisma.familyInvite.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.familyMember.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.family.deleteMany({ where: { id: { in: staleFamilyIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: staleUserIds } } });
  }

  const nicknames = { [M1]: '阿明', [M2]: '阿红', [M3]: '路人', [M4]: '老陈', [M5]: '老李' };
  const userIds = {};
  for (const openid of ALL_OPENIDS) {
    const user = await prisma.user.create({
      data: { openid, nickname: nicknames[openid], status: 1, lastLoginAt: new Date() },
      select: { id: true },
    });
    userIds[openid] = user.id;
  }

  // ---- 甲家：阿爸（创建者）/ 阿妈 / 阿公 ----
  const famA = await prisma.family.create({
    data: { name: '甲家', status: 1 },
    select: { id: true },
  });
  const ownerA = await prisma.familyMember.create({
    data: { familyId: famA.id, userId: userIds[M1], roleName: '阿爸', status: 1 },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: famA.id }, data: { ownerMemberId: ownerA.id } });
  const memberA2 = await prisma.familyMember.create({
    data: { familyId: famA.id, userId: userIds[M2], roleName: '阿妈', status: 1 },
    select: { id: true },
  });
  const memberA4 = await prisma.familyMember.create({
    data: { familyId: famA.id, userId: userIds[M4], roleName: '阿公', status: 1 },
    select: { id: true },
  });

  // ---- 乙家：老李（用于验跨家庭越权） ----
  const famB = await prisma.family.create({
    data: { name: '乙家', status: 1 },
    select: { id: true },
  });
  const ownerB = await prisma.familyMember.create({
    data: { familyId: famB.id, userId: userIds[M5], roleName: '老李', status: 1 },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: famB.id }, data: { ownerMemberId: ownerB.id } });

  // ---- 甲家菜谱：4 条启用 + 1 条停用 ----
  const dishA = {};
  const famDishes = [
    ['妈妈牌红烧肉', '家常菜', 1, 1],
    ['秘制凉拌菜', '素菜', 1, 2],
    ['老火例汤', '汤', 1, 3],
    ['外婆蛋炒饭', '主食', 1, 4],
    ['（已停用）隔夜菜', '家常菜', 0, 5],
  ];
  for (const [name, category, enabled, sortNo] of famDishes) {
    const row = await prisma.menuItem.create({
      data: {
        familyId: famA.id,
        name,
        category,
        enabled,
        sortNo,
        createdByMemberId: ownerA.id,
      },
      select: { id: true },
    });
    dishA[name] = Number(row.id);
  }

  // ---- 乙家菜谱：1 条（专门用来验「拿别人家的 menuItemId」） ----
  const dishB = await prisma.menuItem.create({
    data: {
      familyId: famB.id,
      name: '乙家私房菜',
      category: '家常菜',
      enabled: 1,
      sortNo: 1,
      createdByMemberId: ownerB.id,
    },
    select: { id: true },
  });

  return {
    familyA: Number(famA.id),
    familyB: Number(famB.id),
    ownerA: Number(ownerA.id),
    memberA2: Number(memberA2.id),
    memberA4: Number(memberA4.id),
    ownerB: Number(ownerB.id),
    dishA,
    dishB: Number(dishB.id),
    m1: Number(userIds[M1]),
    m2: Number(userIds[M2]),
    m3: Number(userIds[M3]),
    m4: Number(userIds[M4]),
    m5: Number(userIds[M5]),
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

async function api(method, path, { token, body, headers: extraHeaders } = {}) {
  const headers = { ...(extraHeaders ?? {}) };
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

async function main() {
  console.log('M3 端到端冒烟测试 · 吃啥呢域（随机 / 菜谱 / 决定 / 最近吃过）');
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
    `  甲家=${fx.familyA}（阿爸=${fx.ownerA} 阿妈=${fx.memberA2} 阿公=${fx.memberA4}）  乙家=${fx.familyB}`,
  );
  const t1 = tokenFor(fx.m1, M1);
  const t2 = tokenFor(fx.m2, M2);
  const t3 = tokenFor(fx.m3, M3);
  const t4 = tokenFor(fx.m4, M4);
  const t5 = tokenFor(fx.m5, M5);

  // ---------- 2. 鉴权与家庭边界 ----------
  phase('2. 鉴权与家庭边界');
  expectCode('无 token 抽菜 → 40100', await api('GET', '/api/menu/random?familyId=1'), 40100);
  expectCode('无 token 读菜谱 → 40100', await api('GET', '/api/menu/items?familyId=1'), 40100);
  expectCode(
    '无 token 记一顿 → 40100',
    await api('POST', '/api/menu/decide', { body: { familyId: 1, mealType: 'DINNER', items: [] } }),
    40100,
  );

  expectCode(
    '不传 familyId 抽菜 → 40001（守卫兜住）',
    await api('GET', '/api/menu/random', { token: t1 }),
    40001,
  );
  expectCode(
    '非成员抽菜 → 40300',
    await api('GET', `/api/menu/random?familyId=${fx.familyA}`, { token: t3 }),
    40300,
  );
  expectCode(
    '非成员读菜谱 → 40300',
    await api('GET', `/api/menu/items?familyId=${fx.familyA}`, { token: t3 }),
    40300,
  );
  expectCode(
    '非成员记一顿 → 40300',
    await api('POST', '/api/menu/decide', {
      token: t3,
      body: { familyId: fx.familyA, mealType: 'DINNER', items: [{ name: '蹭饭' }] },
    }),
    40300,
  );
  expectCode(
    '乙家的人读甲家菜谱 → 40300',
    await api('GET', `/api/menu/items?familyId=${fx.familyA}`, { token: t5 }),
    40300,
  );
  expectCode(
    'familyId 不存在 → 40300',
    await api('GET', '/api/menu/random?familyId=99999999', { token: t1 }),
    40300,
  );

  // ---------- 3. 菜谱列表（M3-4） ----------
  phase('3. 菜谱列表 GET /menu/items');
  // 默认 pageSize=50，而「系统 72 + 家庭 5 = 77」一页装不下 ——
  // 所以这里显式要 200，拿全量再断言。默认分页行为单独在下面验。
  const all = await api('GET', `/api/menu/items?familyId=${fx.familyA}&pageSize=200`, {
    token: t1,
  });
  expectCode('GET /menu/items', all, 0);
  const rows = all.body?.data?.list ?? [];
  const systemRows = rows.filter((r) => r.source === 'SYSTEM');
  const familyRows = rows.filter((r) => r.source === 'FAMILY');

  check(
    `系统菜谱共 ${SYSTEM_DISH_COUNT} 条`,
    systemRows.length === SYSTEM_DISH_COUNT,
    String(systemRows.length),
  );
  check('家庭菜谱共 5 条（含 1 条停用）', familyRows.length === 5, String(familyRows.length));
  check(
    'total = 系统 + 家庭',
    all.body?.data?.total === SYSTEM_DISH_COUNT + 5,
    String(all.body?.data?.total),
  );
  check('系统菜谱排在前（合并顺序）', rows[0]?.source === 'SYSTEM', String(rows[0]?.source));
  check(
    'page=1 / pageSize 按请求返回',
    all.body?.data?.page === 1 && all.body?.data?.pageSize === 200,
  );
  check('hasMore=false（一页装得下）', all.body?.data?.hasMore === false);

  check(
    '系统菜谱 id 恒为 null',
    systemRows.every((r) => r.id === null),
    JSON.stringify(systemRows.filter((r) => r.id !== null).slice(0, 3)),
  );
  check(
    '系统菜谱 canEdit=false',
    systemRows.every((r) => r.canEdit === false),
  );
  check(
    '系统菜谱 enabled=true',
    systemRows.every((r) => r.enabled === true),
  );
  check(
    '家庭菜谱 id 是正整数',
    familyRows.every((r) => Number.isInteger(r.id) && r.id > 0),
    JSON.stringify(familyRows.map((r) => r.id)),
  );
  check(
    '家庭菜谱 canEdit=true',
    familyRows.every((r) => r.canEdit === true),
  );
  check(
    '家庭菜谱按 sort_no 排序（妈妈牌红烧肉 → 隔夜菜）',
    familyRows[0]?.name === '妈妈牌红烧肉' && familyRows[4]?.name === '（已停用）隔夜菜',
    JSON.stringify(familyRows.map((r) => r.name)),
  );
  check(
    '停用的菜谱**仍然返回**，只是 enabled=false',
    familyRows.find((r) => r.name === '（已停用）隔夜菜')?.enabled === false,
  );
  check(
    '分类字段是中文枚举值',
    systemRows.every((r) => ['家常菜', '素菜', '汤', '主食', '外食'].includes(r.category)),
    JSON.stringify([...new Set(systemRows.map((r) => r.category))]),
  );

  const veggieOnly = await api(
    'GET',
    `/api/menu/items?familyId=${fx.familyA}&category=${encodeURIComponent('素菜')}`,
    { token: t1 },
  );
  expectCode('category=素菜 筛选', veggieOnly, 0);
  check(
    'category 筛选后只剩素菜',
    (veggieOnly.body?.data?.list ?? []).every((r) => r.category === '素菜'),
  );
  check(
    'category 筛选后 total=17（16 系统 + 1 家庭）',
    veggieOnly.body?.data?.total === 17,
    String(veggieOnly.body?.data?.total),
  );

  const byKeyword = await api(
    'GET',
    `/api/menu/items?familyId=${fx.familyA}&keyword=${encodeURIComponent('红烧')}`,
    { token: t1 },
  );
  expectCode('keyword=红烧 筛选', byKeyword, 0);
  const kwRows = byKeyword.body?.data?.list ?? [];
  check('keyword 命中数 ≥ 4', kwRows.length >= 4, String(kwRows.length));
  check(
    'keyword 筛选后每条都含关键词',
    kwRows.every((r) => r.name.includes('红烧')),
    JSON.stringify(kwRows.map((r) => r.name)),
  );
  check(
    'keyword 同时命中系统与家庭菜谱',
    kwRows.some((r) => r.source === 'SYSTEM') && kwRows.some((r) => r.source === 'FAMILY'),
  );

  const paged = await api('GET', `/api/menu/items?familyId=${fx.familyA}&page=2&pageSize=10`, {
    token: t1,
  });
  expectCode('分页 page=2&pageSize=10', paged, 0);
  check('第二页返回 10 条', (paged.body?.data?.list ?? []).length === 10);
  check('第二页 hasMore=true', paged.body?.data?.hasMore === true);
  check('第二页 total 不变', paged.body?.data?.total === SYSTEM_DISH_COUNT + 5);

  const defaultPage = await api('GET', `/api/menu/items?familyId=${fx.familyA}`, { token: t1 });
  check(
    '不传分页时 pageSize 默认 50',
    defaultPage.body?.data?.pageSize === 50 && (defaultPage.body?.data?.list ?? []).length === 50,
    `${defaultPage.body?.data?.pageSize} / ${(defaultPage.body?.data?.list ?? []).length}`,
  );
  check('不传分页时 hasMore=true（77 > 50）', defaultPage.body?.data?.hasMore === true);

  expectCode(
    'category 非法值 → 40001',
    await api('GET', `/api/menu/items?familyId=${fx.familyA}&category=甜点`, { token: t1 }),
    40001,
  );
  expectCode(
    'pageSize 超 200 → 40001',
    await api('GET', `/api/menu/items?familyId=${fx.familyA}&pageSize=201`, { token: t1 }),
    40001,
  );
  expectCode(
    'page=0 → 40001',
    await api('GET', `/api/menu/items?familyId=${fx.familyA}&page=0`, { token: t1 }),
    40001,
  );
  expectCode(
    'keyword 超 50 字 → 40001',
    await api('GET', `/api/menu/items?familyId=${fx.familyA}&keyword=${'菜'.repeat(51)}`, {
      token: t1,
    }),
    40001,
  );

  // ---------- 4. 随机推荐（M3-3） ----------
  phase('4. 随机推荐 GET /menu/random');

  const poolAll = await api('GET', `/api/menu/random?familyId=${fx.familyA}&excludeRecent=false`, {
    token: t1,
  });
  expectCode('GET /menu/random（不排除最近）', poolAll, 0);
  const poolSizeAll = poolAll.body?.data?.poolSize;
  check(
    'poolSize = 系统 72 + 启用家庭 4（停用的不进池子）',
    poolSizeAll === SYSTEM_DISH_COUNT + 4,
    String(poolSizeAll),
  );
  check('默认抽 1 道', (poolAll.body?.data?.items ?? []).length === 1);
  check(
    '抽中的菜字段齐全（id/name/category/imageUrl/source）',
    ['id', 'name', 'category', 'imageUrl', 'source'].every(
      (k) => k in (poolAll.body?.data?.items?.[0] ?? {}),
    ),
    JSON.stringify(poolAll.body?.data?.items?.[0]),
  );

  const combo = await api(
    'GET',
    `/api/menu/random?familyId=${fx.familyA}&count=3&mealType=DINNER&excludeRecent=false`,
    { token: t1 },
  );
  expectCode('count=3&mealType=DINNER', combo, 0);
  const comboItems = combo.body?.data?.items ?? [];
  check('抽到 3 道', comboItems.length === 3, String(comboItems.length));
  check(
    '3 道互不重复',
    new Set(comboItems.map((x) => x.name)).size === 3,
    JSON.stringify(comboItems.map((x) => x.name)),
  );
  const comboCats = comboItems.map((x) => x.category);
  check(
    '晚餐 3 道 = 一荤一素一汤/主食（组合搭配）',
    comboCats.includes('家常菜') &&
      comboCats.includes('素菜') &&
      (comboCats.includes('汤') || comboCats.includes('主食')),
    JSON.stringify(comboCats),
  );

  // 「外食」不参与组合 —— 反复抽 3 道，外食不该出现在组合结果里
  let sawDiningOutInCombo = false;
  for (let i = 0; i < 25; i += 1) {
    const r = await api(
      'GET',
      `/api/menu/random?familyId=${fx.familyA}&count=3&mealType=DINNER&excludeRecent=false`,
      { token: t1 },
    );
    if ((r.body?.data?.items ?? []).some((x) => x.category === '外食')) {
      sawDiningOutInCombo = true;
      break;
    }
  }
  check('「外食」不参与组合搭配', sawDiningOutInCombo === false);

  // 限定分类 → 不做组合，只在这个分类里抽
  const soup = await api(
    'GET',
    `/api/menu/random?familyId=${fx.familyA}&category=${encodeURIComponent('汤')}&count=5&excludeRecent=false`,
    { token: t1 },
  );
  expectCode('category=汤&count=5', soup, 0);
  check(
    '限定分类后池子只剩该分类（11 系统 + 1 家庭）',
    soup.body?.data?.poolSize === 12,
    String(soup.body?.data?.poolSize),
  );
  check(
    '限定分类后抽到的都是汤',
    (soup.body?.data?.items ?? []).every((x) => x.category === '汤'),
    JSON.stringify((soup.body?.data?.items ?? []).map((x) => x.category)),
  );
  check('抽到 5 道（池子够）', (soup.body?.data?.items ?? []).length === 5);

  // 池子不够时「少给」而不是报错
  const tooMany = await api(
    'GET',
    `/api/menu/random?familyId=${fx.familyA}&category=${encodeURIComponent('外食')}&count=5&excludeRecent=false`,
    { token: t1 },
  );
  check(
    '池子只有 8 道时抽 5 道 → 正常返回 5 道',
    (tooMany.body?.data?.items ?? []).length === 5,
    String((tooMany.body?.data?.items ?? []).length),
  );

  expectCode(
    'count=6 超上限 → 40001',
    await api('GET', `/api/menu/random?familyId=${fx.familyA}&count=6`, { token: t1 }),
    40001,
  );
  expectCode(
    'count=0 → 40001',
    await api('GET', `/api/menu/random?familyId=${fx.familyA}&count=0`, { token: t1 }),
    40001,
  );
  expectCode(
    'mealType 非法 → 40001',
    await api('GET', `/api/menu/random?familyId=${fx.familyA}&mealType=BRUNCH`, { token: t1 }),
    40001,
  );

  // 乙家池子只有 1 道家庭菜 + 72 系统菜，且**不含甲家的菜**
  const poolB = await api('GET', `/api/menu/random?familyId=${fx.familyB}&excludeRecent=false`, {
    token: t5,
  });
  expectCode('乙家抽菜', poolB, 0);
  check(
    '乙家池子 = 72 系统 + 1 自家（不含甲家的 4 道）',
    poolB.body?.data?.poolSize === SYSTEM_DISH_COUNT + 1,
    String(poolB.body?.data?.poolSize),
  );

  // ---------- 5. 决定吃什么（M3-6） ----------
  phase('5. 决定吃什么 POST /menu/decide');
  const today = beijingToday();

  expectCode(
    'items 空数组 → 40001',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: { familyId: fx.familyA, mealType: 'DINNER', items: [] },
    }),
    40001,
  );
  expectCode(
    'items 超过 8 道 → 40001',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: {
        familyId: fx.familyA,
        mealType: 'DINNER',
        items: Array.from({ length: 9 }, (_, i) => ({ name: `菜${i}` })),
      },
    }),
    40001,
  );
  expectCode(
    '菜名为空 → 40001',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: { familyId: fx.familyA, mealType: 'DINNER', items: [{ name: '   ' }] },
    }),
    40001,
  );
  expectCode(
    'mealType 非法 → 40001',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: { familyId: fx.familyA, mealType: 'BRUNCH', items: [{ name: '番茄炒蛋' }] },
    }),
    40001,
  );
  expectCode(
    '日期格式不对 → 40001',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: {
        familyId: fx.familyA,
        mealDate: '2026/09/20',
        mealType: 'DINNER',
        items: [{ name: '番茄炒蛋' }],
      },
    }),
    40001,
  );

  const decided1 = await api('POST', '/api/menu/decide', {
    token: t1,
    body: { familyId: fx.familyA, mealType: 'DINNER', items: [{ name: '番茄炒蛋' }] },
  });
  expectCode('记一顿（系统菜谱，无 menuItemId）', decided1, 0);
  check(
    '返回 mealRecordIds 长度 1',
    (decided1.body?.data?.mealRecordIds ?? []).length === 1,
    JSON.stringify(decided1.body?.data?.mealRecordIds),
  );
  check(
    'summary = 「今晚吃：番茄炒蛋」',
    decided1.body?.data?.summary === '今晚吃：番茄炒蛋',
    String(decided1.body?.data?.summary),
  );

  const decided2 = await api('POST', '/api/menu/decide', {
    token: t1,
    body: {
      familyId: fx.familyA,
      mealType: 'DINNER',
      items: [
        { menuItemId: fx.dishA['妈妈牌红烧肉'], name: '妈妈牌红烧肉' },
        { name: '紫菜蛋花汤' },
      ],
    },
  });
  expectCode('记一顿（家庭菜谱 + 系统菜谱混合）', decided2, 0);
  check(
    'summary 是「今晚吃：A、B」',
    decided2.body?.data?.summary === '今晚吃：妈妈牌红烧肉、紫菜蛋花汤',
    String(decided2.body?.data?.summary),
  );

  // 空串 menuItemId 应当被当成「没选」而不是「第 0 号」
  const decidedBlank = await api('POST', '/api/menu/decide', {
    token: t1,
    body: {
      familyId: fx.familyA,
      mealType: 'LUNCH',
      items: [{ menuItemId: '', name: '番茄鸡蛋面' }],
    },
  });
  expectCode('menuItemId 传空串 → 当作没传（不报 40001）', decidedBlank, 0);
  check(
    'summary 用「午饭吃」前缀',
    decidedBlank.body?.data?.summary === '午饭吃：番茄鸡蛋面',
    String(decidedBlank.body?.data?.summary),
  );

  // 菜名以请求为准（历史快照），首尾空白要去掉
  const decidedTrim = await api('POST', '/api/menu/decide', {
    token: t1,
    body: { familyId: fx.familyA, mealType: 'BREAKFAST', items: [{ name: '  小米粥  ' }] },
  });
  expectCode('记一顿（菜名带空白）', decidedTrim, 0);

  expectCode(
    '拿**别家**的 menuItemId → 40001（越权被服务端挡住）',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: {
        familyId: fx.familyA,
        mealType: 'DINNER',
        items: [{ menuItemId: fx.dishB, name: '乙家私房菜' }],
      },
    }),
    40001,
  );
  expectCode(
    'menuItemId 是负数 → 40001',
    await api('POST', '/api/menu/decide', {
      token: t1,
      body: { familyId: fx.familyA, mealType: 'DINNER', items: [{ menuItemId: -1, name: '鬼菜' }] },
    }),
    40001,
  );

  // 直接回查库
  const dbToday = await prisma.mealRecord.findMany({
    where: { familyId: BigInt(fx.familyA), mealDate: new Date(`${today}T00:00:00.000Z`) },
    select: { name: true, mealType: true, menuItemId: true, createdByMemberId: true },
  });
  check('今天的用餐记录已落库', dbToday.length >= 4, String(dbToday.length));
  check(
    '菜名快照与请求一致（带空白的那条已 trim）',
    dbToday.some((r) => r.name === '小米粥'),
    JSON.stringify(dbToday.map((r) => r.name)),
  );
  check(
    '系统菜谱记录的 menu_item_id 为 null',
    dbToday.find((r) => r.name === '番茄炒蛋')?.menuItemId === null,
  );
  check(
    '家庭菜谱记录的 menu_item_id 指向本家菜谱',
    Number(dbToday.find((r) => r.name === '妈妈牌红烧肉')?.menuItemId) === fx.dishA['妈妈牌红烧肉'],
    String(dbToday.find((r) => r.name === '妈妈牌红烧肉')?.menuItemId),
  );
  check(
    '记录人取当前成员（阿爸）',
    dbToday.every((r) => Number(r.createdByMemberId) === fx.ownerA),
  );
  check(
    '餐次按 TINYINT 落库（晚餐=3）',
    dbToday.filter((r) => r.mealType === 3).length >= 3,
    JSON.stringify(dbToday.map((r) => r.mealType)),
  );

  // ---------- 6. 最近吃过（M3-8） ----------
  phase('6. 最近吃过 GET /menu/recent');
  const recent = await api('GET', `/api/menu/recent?familyId=${fx.familyA}`, { token: t1 });
  expectCode('GET /menu/recent', recent, 0);
  const groups = recent.body?.data ?? [];
  check('返回数组（按日期 + 餐次归组）', Array.isArray(groups));
  check('第一组是今天', groups[0]?.mealDate === today, String(groups[0]?.mealDate));
  check(
    '同一天里晚餐排在最前（meal_type desc）',
    groups[0]?.mealType === 'DINNER',
    String(groups[0]?.mealType),
  );
  const dinnerGroup = groups.find((g) => g.mealDate === today && g.mealType === 'DINNER');
  check(
    '今天的晚餐组含刚记的三道菜',
    ['番茄炒蛋', '妈妈牌红烧肉', '紫菜蛋花汤'].every((n) => (dinnerGroup?.names ?? []).includes(n)),
    JSON.stringify(dinnerGroup?.names),
  );
  check(
    '归组字段齐全（mealDate/mealType/names）',
    groups.every(
      (g) =>
        typeof g.mealDate === 'string' && typeof g.mealType === 'string' && Array.isArray(g.names),
    ),
  );
  check(
    '同一组里不会出现两个相同 mealType',
    new Set(groups.map((g) => `${g.mealDate}|${g.mealType}`)).size === groups.length,
  );

  const recentB = await api('GET', `/api/menu/recent?familyId=${fx.familyB}`, { token: t5 });
  expectCode('乙家最近吃过', recentB, 0);
  check(
    '乙家看不到甲家的用餐记录（家庭隔离）',
    (recentB.body?.data ?? []).length === 0,
    String((recentB.body?.data ?? []).length),
  );

  // ---------- 7. 「排除最近吃过的」真的生效 ----------
  phase('7. 排除最近吃过的（按菜名比对）');
  const poolExcl = await api('GET', `/api/menu/random?familyId=${fx.familyA}`, { token: t1 });
  expectCode('GET /menu/random（默认排除最近 3 天）', poolExcl, 0);
  // ⚠️ 「小米粥」不在这家的池子里（既不是系统菜谱，也不是他家菜谱），
  //    所以它虽然进了 meal_records，却不会让 poolSize 变小 —— 只该验「抽不到」。
  const eatenInPool = ['番茄炒蛋', '妈妈牌红烧肉', '紫菜蛋花汤', '番茄鸡蛋面'];
  const eatenNotInPool = ['小米粥'];
  check(
    'poolSize 恰好少了「今天吃过的、且在池子里的」那些菜',
    poolExcl.body?.data?.poolSize === poolSizeAll - eatenInPool.length,
    `${poolSizeAll} → ${poolExcl.body?.data?.poolSize}（期望少 ${eatenInPool.length}）`,
  );

  let leaked = null;
  for (let i = 0; i < 60; i += 1) {
    const r = await api('GET', `/api/menu/random?familyId=${fx.familyA}&count=5`, { token: t1 });
    const hit = (r.body?.data?.items ?? []).find((x) =>
      [...eatenInPool, ...eatenNotInPool].includes(x.name),
    );
    if (hit) {
      leaked = hit.name;
      break;
    }
  }
  check('连抽 60 次都不会抽到最近吃过的菜', leaked === null, String(leaked));

  // ⚠️ 这一条是**回归测试**：全局 enableImplicitConversion 曾让
  //    `excludeRecent=false` 静默等于 `true`（详见 query.util.ts 的 ParseBoolean）。
  //    断言方式是比对 poolSize —— 不依赖随机结果，才能稳定抓到这类静默失效。
  const notExcluded = await api(
    'GET',
    `/api/menu/random?familyId=${fx.familyA}&count=5&excludeRecent=false`,
    { token: t1 },
  );
  expectCode('excludeRecent=false 正常返回', notExcluded, 0);
  check(
    'excludeRecent=false 时池子恢复满（回归：布尔参数必须真的生效）',
    notExcluded.body?.data?.poolSize === poolSizeAll,
    `期望 ${poolSizeAll}，实得 ${notExcluded.body?.data?.poolSize}`,
  );
  const notExcludedZero = await api(
    'GET',
    `/api/menu/random?familyId=${fx.familyA}&excludeRecent=0`,
    { token: t1 },
  );
  check(
    'excludeRecent=0 同样被解析成 false',
    notExcludedZero.body?.data?.poolSize === poolSizeAll,
    String(notExcludedZero.body?.data?.poolSize),
  );
  const excludedTrue = await api(
    'GET',
    `/api/menu/random?familyId=${fx.familyA}&excludeRecent=true`,
    { token: t1 },
  );
  check(
    'excludeRecent=true 明确排除（池子变小）',
    excludedTrue.body?.data?.poolSize === poolSizeAll - eatenInPool.length,
    String(excludedTrue.body?.data?.poolSize),
  );
  const garbage = await api('GET', `/api/menu/random?familyId=${fx.familyA}&excludeRecent=maybe`, {
    token: t1,
  });
  expectCode('excludeRecent 传垃圾值 → 不报错', garbage, 0);
  check(
    '垃圾值当「没传」→ 走默认值 true（不猜一个布尔）',
    garbage.body?.data?.poolSize === poolSizeAll - eatenInPool.length,
    String(garbage.body?.data?.poolSize),
  );

  // ---------- 8. 观察项 ----------
  phase('8. 观察项（非阻塞）');
  note('「排除最近吃过的」判据是**菜名**，不是 id —— 所以改名 = 新增一道菜，');
  note('  旧的 meal_records 仍留改名前的快照（这正是历史快照想要的行为）。');
  note('随机是**真随机**：同一条件下连抽两次结果可能不同，脚本因此用 poolSize 与');
  note('  「连抽 N 次都不出现」这类**不依赖单次结果**的方式断言。');
  note('「一荤一素一汤」是**尽量**而非硬要求：池子里凑不齐三类时退回随机不重复抽，');
  note('  所以断言写成「包含三类」而不是「恰好三类」。');
  note('系统菜谱共 72 条是 `default-menu.ts` 里的显式不变量；若有意增删，');
  note('  需同步更新本脚本的 SYSTEM_DISH_COUNT 与 docs 里的数字。');

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
