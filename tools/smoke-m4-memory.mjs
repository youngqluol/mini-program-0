#!/usr/bin/env node
/**
 * M4 真实链路端到端冒烟测试 —— 留个念域（上传 / 发布 / 时间线 / 详情 / 编辑 / 删除）
 * ============================================================================
 *
 * 为什么需要它：
 *   「留个念」有四类东西**编译期完全查不出来**：
 *     ① 隐私过滤（`visibility=PRIVATE` 只有发布者能看见）—— 漏了就是数据泄露，
 *        而且**不报错**，只是别人多看到一条
 *     ② 游标分页（用 `id` 而不是 `created_at`，见 docs/02 §7.2）——
 *        用时间戳翻页会在「同一秒发两条」时静默漏记录，本地单条测试永远碰不到
 *     ③ 逻辑删除的边界（`status=0` 之后列表 / 详情 / 再次编辑各自该回什么）
 *     ④ 图片地址来源校验、`thingId` 必须指向**已完成**的小事
 *   这些只能打真接口验。
 *
 * 它做四件事：
 *   1. 通过 Prisma Client 建夹具：两个家庭 + 若干用户 + 已完成/未完成的小事
 *   2. 用 node:crypto 手写 HS256 JWT（payload 与 AuthService.signToken 一致）
 *   3. 串行打留个念的五个接口 + 边界用例，逐条断言 `code` 与字段形状
 *   4. 用 Prisma 直接回查库，验证「逻辑删除到底删干净了没有、附件行还在不在」
 *
 * 用法：
 *   ① 起服务（带新代码）：cd server && PORT=3100 TZ=Asia/Shanghai \
 *        npx --no-install ts-node -r tsconfig-paths/register src/main.ts
 *      或走构建产物：cd server && pnpm run build && TZ=Asia/Shanghai node dist/server/src/main.js
 *   ② 跑：SMOKE_BASE_URL=http://127.0.0.1:3100 node tools/smoke-m4-memory.mjs
 *
 * 环境变量：
 *   SMOKE_BASE_URL   默认 http://127.0.0.1:3000
 *
 * 为什么数据库夹具走 Prisma 而不是 `docker exec mysql`：
 *   WorkBuddy 沙箱 hook 了 Node 的 child_process，**任何**子进程创建都直接
 *   EBUSY（连 `node -v` 都起不来）。Prisma 6 默认用 N-API library 引擎，
 *   不 spawn 子进程，所以在沙箱里依然能连库。
 *
 * ⚠️ 只对**本地开发库**生效。脚本会物理删除 openid 以 `smoke_mem` 开头的用户
 *    及其家庭数据 —— 业务代码坚持不做物理删除，但测试夹具必须可重复运行。
 *
 * ⚠️ 图片上传那条链路依赖腾讯云 COS 凭证（server/.env 第 8 节）。
 *    没配时**不是失败**，而是「跳过并记一条 note」—— 校验路径仍然全测，
 *    因为它们都在写桶之前就返回了。配好之后同一个脚本会自动把
 *    真实上传 + 回读校验也跑起来，不需要改脚本。
 */

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

// 用 smoke_mem 前缀与 M2（smoke_u）/ M3（smoke_m）冒烟脚本隔开，可同时存在
const A1 = 'smoke_mem_a1'; // 甲家创建者 · 阿爸
const A2 = 'smoke_mem_a2'; // 甲家成员 · 阿妈
const B1 = 'smoke_mem_b1'; // 乙家创建者 · 老李（验跨家庭越权）
const C1 = 'smoke_mem_c1'; // 非成员 · 路人
const ALL_OPENIDS = [A1, A2, B1, C1];

/** 时间线默认每页条数 —— 与 `memory.dto.ts` 的 `MEMORY_DEFAULT_LIMIT` 一致 */
const MEMORY_DEFAULT_LIMIT = 20;
/** 一条记录最多几张图 —— 与 `@shared` 的 `MEMORY_MAX_ATTACHMENTS` 一致 */
const MAX_ATTACHMENTS = 9;
/** 正文上限 —— 与 `@shared` 的 `MEMORY_CONTENT_MAX` 一致 */
const CONTENT_MAX = 1000;

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

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return check(name, a === e, `期望 ${e}，实得 ${a}`);
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

/** 对象存储是否配好 —— 决定「真实上传」那几条是跑还是跳过 */
const COS_READY = Boolean(
  env.COS_BUCKET?.trim() &&
  env.COS_REGION?.trim() &&
  env.COS_SECRET_ID?.trim() &&
  env.COS_SECRET_KEY?.trim(),
);
/** 桶的公开前缀，用来断言 `fileUrl` 确实来自本桶 */
const COS_BASE_URL = COS_READY
  ? `https://${env.COS_BUCKET.trim()}.cos.${env.COS_REGION.trim()}.myqcloud.com`
  : '';

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
// JWT
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
    signal: AbortSignal.timeout(20000),
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

/** multipart 上传 —— 字段名固定 `file` + `scene`（docs/02 §8.1） */
async function upload({ token, bytes, filename = 'a.png', type = 'image/png', scene }) {
  const form = new FormData();
  if (scene !== undefined) form.append('scene', scene);
  if (bytes) form.append('file', new Blob([new Uint8Array(bytes)], { type }), filename);

  const res = await fetch(`${BASE}/api/upload/image`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
    signal: AbortSignal.timeout(30000),
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
// 图片构造
// =============================================================

/**
 * 造一张**真 PNG**（不是只有文件头的假货）：
 * 签名 + IHDR + IDAT（deflate 过的全透明扫描线）+ IEND。
 *
 * 为什么值得用 `node:zlib` 真造一张：只有文件头的 buffer 虽然能过我们自己的
 * 嗅探，但上传到 COS 之后回读、或者将来有人在浏览器里打开那个 URL，
 * 就露馅了。真 PNG 让「上传 → 回读 → 字节一致」这条断言有意义。
 */
function makePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 RGBA
  // 10/11/12 保持 0：压缩方式 / 过滤方式 / 非隔行

  // 每行 = 1 字节过滤类型 + width × 4 字节 RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 一张 64×48 的真 PNG，重复用 */
const PNG = makePng(64, 48);

// =============================================================
// 夹具
// =============================================================

/** 夹具里存下来的 ID —— 后面的断言要用 */
const F = {};

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
      // 留个念的两张表：先附件后记录（逻辑上是父子）
      const memories = await prisma.familyMemory.findMany({
        where: { familyId: { in: staleFamilyIds } },
        select: { id: true },
      });
      const memoryIds = memories.map((m) => m.id);
      if (memoryIds.length > 0) {
        await prisma.memoryAttachment.deleteMany({ where: { memoryId: { in: memoryIds } } });
        await prisma.familyMemory.deleteMany({ where: { id: { in: memoryIds } } });
      }

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

      await prisma.mealRecord.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.menuItem.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.notificationLog.deleteMany({ where: { userId: { in: staleUserIds } } });
      await prisma.familyInvite.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.familyMember.deleteMany({ where: { familyId: { in: staleFamilyIds } } });
      await prisma.family.deleteMany({ where: { id: { in: staleFamilyIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: staleUserIds } } });
  }

  const nicknames = { [A1]: '阿明', [A2]: '阿红', [B1]: '老李', [C1]: '路人' };
  const userIds = {};
  for (const openid of ALL_OPENIDS) {
    const user = await prisma.user.create({
      data: { openid, nickname: nicknames[openid], status: 1, lastLoginAt: new Date() },
      select: { id: true },
    });
    userIds[openid] = user.id;
  }

  // ---- 甲家：阿爸（创建者）/ 阿妈 ----
  const famA = await prisma.family.create({
    data: { name: '甲家', status: 1 },
    select: { id: true },
  });
  const ownerA = await prisma.familyMember.create({
    data: { familyId: famA.id, userId: userIds[A1], roleName: '阿爸', status: 1 },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: famA.id }, data: { ownerMemberId: ownerA.id } });
  const memberA2 = await prisma.familyMember.create({
    data: { familyId: famA.id, userId: userIds[A2], roleName: '阿妈', status: 1 },
    select: { id: true },
  });

  // ---- 乙家：老李（创建者）—— 用于验跨家庭越权 ----
  const famB = await prisma.family.create({
    data: { name: '乙家', status: 1 },
    select: { id: true },
  });
  const ownerB = await prisma.familyMember.create({
    data: { familyId: famB.id, userId: userIds[B1], roleName: '老李', status: 1 },
    select: { id: true },
  });
  await prisma.family.update({ where: { id: famB.id }, data: { ownerMemberId: ownerB.id } });

  // ---- 小事：甲家已完成（给「完成纪念」用）----
  const doneThing = await prisma.familyThing.create({
    data: {
      familyId: famA.id,
      type: 1,
      title: '买牛奶',
      assigneeMemberId: ownerA.id,
      creatorMemberId: ownerA.id,
      visibility: 1,
      status: 2, // COMPLETED
      completedAt: new Date(),
      completedByMemberId: ownerA.id,
    },
    select: { id: true },
  });

  // ---- 小事：甲家未完成（验「没做完不能记」）----
  const pendingThing = await prisma.familyThing.create({
    data: {
      familyId: famA.id,
      type: 1,
      title: '倒垃圾',
      assigneeMemberId: ownerA.id,
      creatorMemberId: ownerA.id,
      visibility: 1,
      status: 1, // PENDING
    },
    select: { id: true },
  });

  // ---- 小事：乙家已完成（验跨家庭 thingId）----
  const otherThing = await prisma.familyThing.create({
    data: {
      familyId: famB.id,
      type: 1,
      title: '别人家的活',
      assigneeMemberId: ownerB.id,
      creatorMemberId: ownerB.id,
      visibility: 1,
      status: 2,
      completedAt: new Date(),
      completedByMemberId: ownerB.id,
    },
    select: { id: true },
  });

  Object.assign(F, {
    famA: famA.id,
    famB: famB.id,
    ownerA: ownerA.id,
    memberA2: memberA2.id,
    ownerB: ownerB.id,
    doneThing: doneThing.id,
    pendingThing: pendingThing.id,
    otherThing: otherThing.id,
    tokenA1: tokenFor(userIds[A1], A1),
    tokenA2: tokenFor(userIds[A2], A2),
    tokenB1: tokenFor(userIds[B1], B1),
    tokenC1: tokenFor(userIds[C1], C1),
  });
}

/** 走接口发一条记录，返回 `data`（失败则抛，让脚本立刻停下 —— 夹具不该静默错） */
async function createMemory(payload, token = F.tokenA1) {
  const res = await api('POST', '/api/memories', {
    token,
    body: { familyId: Number(F.famA), ...payload },
  });
  if (res.body?.code !== 0) {
    throw new Error(`夹具创建留念失败：${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

// =============================================================
// 主流程
// =============================================================

async function main() {
  console.log(`目标：${BASE}`);
  console.log(
    `对象存储：${COS_READY ? `已配置（${COS_BASE_URL}）` : '**未配置** —— 真实上传那几条会跳过'}`,
  );
  await resetFixtures();

  // -----------------------------------------------------------
  phase('第 1 节 上传图片（POST /api/upload/image）');
  // -----------------------------------------------------------

  let r = await upload({ token: null, bytes: PNG, scene: 'MEMORY' });
  check('未登录 → 401 / 40100', r.status === 401 && r.body?.code === 40100, JSON.stringify(r.body));

  r = await upload({ token: F.tokenA1, bytes: null, scene: 'MEMORY' });
  expectCode('没有文件 → 40001', r, 40001);

  r = await upload({ token: F.tokenA1, bytes: PNG, scene: 'NOPE' });
  check(
    '场景非法 → 40001 且文案指向场景',
    r.body?.code === 40001 && /场景/.test(r.body?.message ?? ''),
    JSON.stringify(r.body),
  );

  r = await upload({ token: F.tokenA1, bytes: PNG });
  expectCode('缺 scene → 40001', r, 40001);

  r = await upload({
    token: F.tokenA1,
    bytes: Buffer.from('#!/bin/sh\necho 我不是图片\n', 'utf8'),
    filename: 'fake.png',
    type: 'image/png',
    scene: 'MEMORY',
  });
  check(
    '把脚本改名成 .png 上传 → 40001（**不看客户端自称的 MIME**）',
    r.body?.code === 40001 && /jpg/.test(r.body?.message ?? ''),
    JSON.stringify(r.body),
  );

  // 超过 5MB：**文件头仍然是真的 PNG**，只是后面塞满不可压缩的数据，
  // 这样「超限」是唯一被拒的理由（而不是「类型不对」先被拦下）
  const big = Buffer.concat([makePng(64, 48).subarray(0, 33), Buffer.alloc(6 * 1024 * 1024, 0x5a)]);
  r = await upload({ token: F.tokenA1, bytes: big, scene: 'MEMORY' });
  check(
    '6MB → 40001 且文案是中文的「太大」',
    r.body?.code === 40001 && /大/.test(r.body?.message ?? ''),
    JSON.stringify(r.body),
  );

  let uploaded = null;
  if (COS_READY) {
    r = await upload({ token: F.tokenA1, bytes: PNG, scene: 'MEMORY' });
    check('真 PNG → 200', r.body?.code === 0, JSON.stringify(r.body));
    if (r.body?.code === 0) {
      uploaded = r.body.data;
      check(
        'fileUrl 落在本桶的 memories/ 前缀下',
        uploaded.fileUrl.startsWith(`${COS_BASE_URL}/memories/`),
        uploaded.fileUrl,
      );
      eq('fileType 回的是嗅探出的 image/png', uploaded.fileType, 'image/png');
      eq('fileSize 与实际字节一致', uploaded.fileSize, PNG.length);
      eq('width', uploaded.width, 64);
      eq('height', uploaded.height, 48);

      // 回读：桶里的字节必须与上传的一模一样（签名对了才会有 200）
      const back = await fetch(uploaded.fileUrl, { signal: AbortSignal.timeout(20000) });
      const bytes = Buffer.from(await back.arrayBuffer());
      check('回读 fileUrl → 200', back.status === 200, `HTTP ${back.status}`);
      check(
        '回读字节与上传一致',
        bytes.length === PNG.length &&
          createHash('sha1').update(bytes).digest('hex') ===
            createHash('sha1').update(PNG).digest('hex'),
        `${bytes.length} vs ${PNG.length}`,
      );
    }
  } else {
    r = await upload({ token: F.tokenA1, bytes: PNG, scene: 'MEMORY' });
    check(
      '合法 PNG + COS 未配置 → 50000（**明确报错，不假装成功**）',
      r.body?.code === 50000,
      JSON.stringify(r.body),
    );
    note('对象存储未配置，跳过「真实上传 + 回读」与「外域图片地址被拒」两条断言。');
    note('  配好 server/.env 第 8 节的四个 COS_* 变量后重跑本脚本即可自动补上。');
  }

  // -----------------------------------------------------------
  phase('第 2 节 发布记录（POST /api/memories）');
  // -----------------------------------------------------------

  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: { familyId: Number(F.famA), content: '宝宝今天第一次自己穿鞋。' },
  });
  expectCode('只有正文 → 0', r, 0);
  const m1 = r.body?.data;
  eq('默认可见范围是 FAMILY', m1?.visibility, 'FAMILY');
  eq('没有图片时 attachments 是空数组（不是 null）', m1?.attachments, []);
  eq('独立留念的 thing 是 null', m1?.thing, null);
  eq('isMine 为 true（自己发的）', m1?.isMine, true);
  check('date 是 "YYYY-MM-DD"', /^\d{4}-\d{2}-\d{2}$/.test(m1?.date ?? ''), m1?.date);
  check(
    'createdAt 是 "YYYY-MM-DD HH:mm:ss"',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(m1?.createdAt ?? ''),
    m1?.createdAt,
  );
  eq('creator 用的是家庭称谓而不是微信昵称', m1?.creator?.roleName, '阿爸');

  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: { familyId: Number(F.famA), content: '   ' },
  });
  expectCode('正文只有空格、也没有图片 → 40001', r, 40001);

  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: { familyId: Number(F.famA), content: 'x'.repeat(CONTENT_MAX + 1) },
  });
  expectCode(`正文超 ${CONTENT_MAX} 字 → 40001`, r, 40001);

  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: {
      familyId: Number(F.famA),
      content: '太多图了',
      attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
        fileUrl: `${COS_BASE_URL || 'https://example.com'}/memories/2026/10/${i}.png`,
      })),
    },
  });
  expectCode(`超过 ${MAX_ATTACHMENTS} 张 → 40001`, r, 40001);

  r = await api('POST', '/api/memories', {
    token: F.tokenC1,
    body: { familyId: Number(F.famA), content: '我不是这个家的人' },
  });
  expectCode('非成员发到甲家 → 40300', r, 40300);

  // thingId 的三种情况
  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: { familyId: Number(F.famA), content: '还没做完就记', thingId: Number(F.pendingThing) },
  });
  check(
    'thingId 指向**未完成**的小事 → 40001',
    r.body?.code === 40001 && /做完/.test(r.body?.message ?? ''),
    JSON.stringify(r.body),
  );

  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: { familyId: Number(F.famA), content: '别人家的活', thingId: Number(F.otherThing) },
  });
  expectCode('thingId 指向**别人家**的小事 → 40400（不透露存在性）', r, 40400);

  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: {
      familyId: Number(F.famA),
      content: '买牛奶 搞定啦',
      thingId: Number(F.doneThing),
      visibility: 'FAMILY',
    },
  });
  expectCode('thingId 指向已完成的小事 → 0', r, 0);
  const mThing = r.body?.data;
  eq('thing.id 回显', mThing?.thing?.id, Number(F.doneThing));
  eq('thing.title 回显（P19 底部那行标注要用）', mThing?.thing?.title, '买牛奶');

  // 私密记录（后面隐私过滤要用）
  const mPrivate = await createMemory({ content: '只有我自己看得见', visibility: 'PRIVATE' });

  // 带图片（外域地址）
  r = await api('POST', '/api/memories', {
    token: F.tokenA1,
    body: {
      familyId: Number(F.famA),
      content: '外域图片',
      attachments: [{ fileUrl: 'https://evil.example.com/track.png' }],
    },
  });
  if (COS_READY) {
    check('图片地址不在本桶 → 40001', r.body?.code === 40001, JSON.stringify(r.body));
  } else {
    expectCode('对象存储未配置 → 地址来源校验被跳过（放行）', r, 0);
  }

  // 正常带图（用本桶地址，或未配置时的任意地址）
  const attachUrl = (n) => `${COS_BASE_URL || 'https://example.com'}/memories/2026/10/pic${n}.png`;
  const mWithPics = await createMemory({
    content: '一家人第一次一起包饺子。',
    attachments: [
      {
        fileUrl: attachUrl(1),
        fileType: 'image/png',
        fileSize: 91,
        width: 64,
        height: 48,
        sortNo: 1,
      },
      {
        fileUrl: attachUrl(2),
        fileType: 'image/png',
        fileSize: 91,
        width: 48,
        height: 64,
        sortNo: 0,
      },
    ],
  });
  eq('两张图都写进去了', mWithPics.attachments.length, 2);
  eq(
    '附件按 sortNo 排序（不是插入顺序）',
    mWithPics.attachments.map((a) => a.fileUrl),
    [attachUrl(2), attachUrl(1)],
  );
  eq(
    'width/height 原样回显',
    [mWithPics.attachments[0].width, mWithPics.attachments[0].height],
    [48, 64],
  );
  eq(
    '附件只回 id/fileUrl/width/height（不回 fileType/fileSize/sortNo）',
    Object.keys(mWithPics.attachments[0]).sort(),
    ['fileUrl', 'height', 'id', 'width'],
  );

  // -----------------------------------------------------------
  phase('第 3 节 时间线（GET /api/memories）');
  // -----------------------------------------------------------

  r = await api('GET', `/api/memories?familyId=${F.famA}&limit=50`, { token: F.tokenA1 });
  expectCode('阿爸拉时间线 → 0', r, 0);
  const allA1 = r.body?.data?.list ?? [];
  eq('hasMore 为 false（一页装得下）', r.body?.data?.hasMore, false);
  eq('nextCursor 为 null', r.body?.data?.nextCursor, null);
  check(
    '按 id 倒序（最新在前）',
    allA1[0]?.id > allA1[allA1.length - 1]?.id,
    `${allA1[0]?.id} … ${allA1[allA1.length - 1]?.id}`,
  );
  check(
    '阿爸能看到自己那条私密记录',
    allA1.some((x) => x.id === mPrivate.id),
    `私密记录 id=${mPrivate.id}`,
  );

  r = await api('GET', `/api/memories?familyId=${F.famA}&limit=50`, { token: F.tokenA2 });
  const allA2 = r.body?.data?.list ?? [];
  check(
    '阿妈**看不到**阿爸的私密记录（隐私过滤）',
    !allA2.some((x) => x.id === mPrivate.id),
    `列表里有 ${allA2.length} 条`,
  );
  check(
    '阿妈能看到阿爸的家庭可见记录',
    allA2.some((x) => x.id === m1.id),
  );
  check(
    '阿妈的列表里 isMine 全是 false（没有一条是她发的）',
    allA2.every((x) => x.isMine === false),
  );

  r = await api('GET', `/api/memories?familyId=${F.famB}&limit=50`, { token: F.tokenB1 });
  eq('老李拉乙家时间线 → 空（跨家庭不串数据）', r.body?.data?.list?.length, 0);

  r = await api('GET', `/api/memories?familyId=${F.famA}&limit=50`, { token: F.tokenC1 });
  expectCode('非成员拉甲家时间线 → 40300', r, 40300);

  // 游标分页：limit=2 逐页翻，必须**无重复、无遗漏**
  const seen = [];
  let cursor = null;
  let pages = 0;
  let paginationOk = true;
  let paginationDetail = '';
  for (;;) {
    const q = `/api/memories?familyId=${F.famA}&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
    const page = await api('GET', q, { token: F.tokenA1 });
    if (page.body?.code !== 0) {
      paginationOk = false;
      paginationDetail = JSON.stringify(page.body);
      break;
    }
    const list = page.body.data.list;
    if (list.length > 2) {
      paginationOk = false;
      paginationDetail = `limit=2 却返回了 ${list.length} 条`;
      break;
    }
    seen.push(...list.map((x) => x.id));
    cursor = page.body.data.nextCursor;
    pages += 1;
    if (!page.body.data.hasMore) {
      if (cursor !== null) {
        paginationOk = false;
        paginationDetail = 'hasMore=false 但 nextCursor 不为 null';
      }
      break;
    }
    if (cursor == null) {
      paginationOk = false;
      paginationDetail = 'hasMore=true 但 nextCursor 为 null';
      break;
    }
    if (pages > 50) {
      paginationOk = false;
      paginationDetail = '翻页超过 50 次，疑似死循环';
      break;
    }
  }
  check('游标翻页能走到尽头', paginationOk, paginationDetail);
  eq('翻页无重复', new Set(seen).size, seen.length);
  eq('翻页拿到的条数与一次拉完一致', seen.length, allA1.length);
  eq(
    '翻页顺序与一次拉完完全一致',
    seen,
    allA1.map((x) => x.id),
  );
  note(`  分页实测：${allA1.length} 条记录、每页 2 条、共 ${pages} 页。`);
  note('  游标用 id 而不是 created_at —— created_at 是 DATETIME(0)（秒精度），');
  note('  同一秒发两条时用时间戳翻页会静默漏记录。上面这些记录就是同一秒创建的。');

  // -----------------------------------------------------------
  phase('第 4 节 详情（GET /api/memories/:id）');
  // -----------------------------------------------------------

  r = await api('GET', `/api/memories/${m1.id}`, { token: F.tokenA2 });
  expectCode('阿妈看阿爸的家庭可见记录 → 0', r, 0);
  eq('详情里 isMine 对阿妈是 false', r.body?.data?.isMine, false);

  r = await api('GET', `/api/memories/${mPrivate.id}`, { token: F.tokenA2 });
  expectCode('阿妈看阿爸的**私密**记录 → 40400（不是 40300）', r, 40400);
  note('  用 40400 而不是 40300：40300 等于告诉对方「这里有一条你看不到的东西」。');

  r = await api('GET', `/api/memories/${m1.id}`, { token: F.tokenB1 });
  expectCode('老李看甲家的记录 → 40300（不是这个家的人）', r, 40300);

  r = await api('GET', '/api/memories/999999999', { token: F.tokenA1 });
  expectCode('不存在的 id → 40400', r, 40400);

  r = await api('GET', '/api/memories/abc', { token: F.tokenA1 });
  expectCode('id 不是数字 → 40001（不是 50000）', r, 40001);

  // -----------------------------------------------------------
  phase('第 5 节 编辑（PATCH /api/memories/:id）');
  // -----------------------------------------------------------

  r = await api('PATCH', `/api/memories/${m1.id}`, {
    token: F.tokenA2,
    body: { content: '我要改别人发的' },
  });
  check('阿妈改阿爸的 → 40301', r.body?.code === 40301, JSON.stringify(r.body));

  r = await api('PATCH', `/api/memories/${m1.id}`, {
    token: F.tokenA1,
    body: { content: '宝宝今天第一次自己穿鞋，还自己系了鞋带。' },
  });
  expectCode('阿爸改自己的 → 0', r, 0);
  eq('正文已更新', r.body?.data?.content, '宝宝今天第一次自己穿鞋，还自己系了鞋带。');
  eq('id 没变（是更新不是新建）', r.body?.data?.id, m1.id);

  r = await api('PATCH', `/api/memories/${m1.id}`, { token: F.tokenA1, body: {} });
  expectCode('空 body → 0（只传要改的字段，什么都不传就什么都不改）', r, 0);
  eq('正文没被清空', r.body?.data?.content, '宝宝今天第一次自己穿鞋，还自己系了鞋带。');

  r = await api('PATCH', `/api/memories/${m1.id}`, {
    token: F.tokenA1,
    body: { visibility: 'PRIVATE' },
  });
  expectCode('改成仅自己可见 → 0', r, 0);
  eq('visibility 已变', r.body?.data?.visibility, 'PRIVATE');

  r = await api('GET', `/api/memories?familyId=${F.famA}&limit=50`, { token: F.tokenA2 });
  check('改私密后从阿妈的列表里消失', !(r.body?.data?.list ?? []).some((x) => x.id === m1.id));

  r = await api('PATCH', `/api/memories/${m1.id}`, {
    token: F.tokenA1,
    body: { visibility: 'FAMILY' },
  });
  eq('改回家庭可见', r.body?.data?.visibility, 'FAMILY');

  r = await api('PATCH', `/api/memories/${m1.id}`, {
    token: F.tokenA1,
    body: { content: '   ' },
  });
  check(
    '把正文改成纯空格 → 40001（**DTO 的 @IsNotEmpty 拦不住这个**：它判的是未 trim 的值）',
    r.body?.code === 40001,
    JSON.stringify(r.body),
  );
  note('  这条是冒烟脚本真的抓到的 bug：服务端 trim 后落库成了空正文，');
  note('  时间线上会出现一张什么都没有的空白卡片。现在规则统一在 service 里判。');

  // 但「有图片」时正文可以为空 —— 与 create 的口径一致
  const mPicOnly = await createMemory({
    content: '先写点字',
    attachments: [{ fileUrl: attachUrl(9) }],
  });
  r = await api('PATCH', `/api/memories/${mPicOnly.id}`, {
    token: F.tokenA1,
    body: { content: '' },
  });
  expectCode('有图片时可以把正文清空（图片也算内容）', r, 0);
  eq('正文确实空了', r.body?.data?.content, '');
  eq('图片还在', r.body?.data?.attachments?.length, 1);

  r = await api('PATCH', `/api/memories/${m1.id}`, {
    token: F.tokenA1,
    body: { visibility: 'NOPE' },
  });
  expectCode('可见范围非法 → 40001', r, 40001);

  // -----------------------------------------------------------
  phase('第 6 节 删除（DELETE /api/memories/:id）');
  // -----------------------------------------------------------

  r = await api('DELETE', `/api/memories/${mWithPics.id}`, { token: F.tokenA2 });
  check('阿妈删阿爸的 → 40301', r.body?.code === 40301, JSON.stringify(r.body));

  r = await api('DELETE', `/api/memories/${mWithPics.id}`, { token: F.tokenA1 });
  expectCode('阿爸删自己的 → 0', r, 0);
  eq('返回被删的 id', r.body?.data?.id, mWithPics.id);

  r = await api('GET', `/api/memories/${mWithPics.id}`, { token: F.tokenA1 });
  expectCode('删后看详情 → 40400', r, 40400);

  r = await api('DELETE', `/api/memories/${mWithPics.id}`, { token: F.tokenA1 });
  expectCode('重复删 → 40400（不是 0）', r, 40400);

  r = await api('GET', `/api/memories?familyId=${F.famA}&limit=50`, { token: F.tokenA1 });
  check('删后不在时间线里', !(r.body?.data?.list ?? []).some((x) => x.id === mWithPics.id));

  // -----------------------------------------------------------
  phase('第 7 节 回查数据库（逻辑删除的证据）');
  // -----------------------------------------------------------

  const dbMemory = await prisma.familyMemory.findUnique({
    where: { id: BigInt(mWithPics.id) },
    select: { status: true, content: true, visibility: true },
  });
  eq('family_memories.status = 0（逻辑删除，行还在）', dbMemory?.status, 0);
  eq('正文没被清空（历史保留）', dbMemory?.content, '一家人第一次一起包饺子。');

  const dbAttachments = await prisma.memoryAttachment.findMany({
    where: { memoryId: BigInt(mWithPics.id) },
    select: { id: true, sortNo: true },
  });
  eq('附件行**仍在**（没有物理删除，符合 AGENTS.md 铁律）', dbAttachments.length, 2);
  eq(
    '附件的 sortNo 落库正确',
    dbAttachments.map((a) => a.sortNo).sort((x, y) => x - y),
    [0, 1],
  );

  const dbThing = await prisma.familyMemory.findUnique({
    where: { id: BigInt(mThing.id) },
    select: { thingId: true },
  });
  eq('完成纪念的 thing_id 落库正确', Number(dbThing?.thingId), Number(F.doneThing));

  const privateRows = await prisma.familyMemory.findMany({
    where: { familyId: BigInt(F.famA), visibility: 2 },
    select: { id: true },
  });
  eq('库里 visibility=2 的记录有 1 条（就是那条私密的）', privateRows.length, 1);

  // -----------------------------------------------------------
  phase('说明与观察项');
  // -----------------------------------------------------------

  note('图片是**不可变**的：PATCH 没有 attachments 字段。');
  note('  原因：「全库不做物理 DELETE」，而 memory_attachments 没有状态位 ——');
  note('  无法逻辑删除旧行，所以 V0.1 发错图只能删掉重发。见 docs/未来需求池.md。');
  note('内容安全检测（CONTENT_SECURITY_ENABLED=true 时）在**事务之外**：');
  note('  检测失败要能整体回滚，不留半条数据。本地用无效 openid 时微信会判不了，');
  note('  走 fail-open 放行（warn 日志），所以上面这些写入能成功 —— 这是设计，不是漏测。');
  note('图片内容安全用的是 1.0 版同步接口（微信 2021-09 起推荐 mediaCheckAsync）：');
  note('  它有 1MB 上限，超限的图**检测不了**、fail-open 放行。P18 用 compressed 选图规避。');
}

// =============================================================
// 入口
// =============================================================

try {
  await main();
} catch (e) {
  console.error('\n脚本异常终止：', e);
  failures.push({ name: '脚本异常终止', detail: String(e?.message ?? e) });
}

console.log(`\n${'='.repeat(66)}`);
if (failures.length === 0) {
  console.log(`通过 ${passed} 项，失败 0 项`);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  · ${f.name}${f.detail ? `  ← ${f.detail}` : ''}`);
}
console.log('='.repeat(66));

await prisma.$disconnect();
process.exit(failures.length === 0 ? 0 : 1);
