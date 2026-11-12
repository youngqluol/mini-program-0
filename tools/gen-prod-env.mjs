#!/usr/bin/env node
/**
 * 生成云托管「生产环境变量清单」
 * =============================================================
 *
 * 用途：把 `server/.env` 转成一份**可直接粘贴到云托管控制台**的清单。
 *
 * 为什么不直接把 `server/.env` 上传：
 *
 *   ① 里面 `DATABASE_URL` 指向**本机**，线上必须用**内网**地址；
 *   ② `JWT_SECRET` / `INTERNAL_CRON_SECRET` 是**开发值**，生产必须换 ——
 *      尤其 `INTERNAL_CRON_SECRET`，漏配时它不降级而是让提醒功能**静默死掉**
 *      （见 docs/06 §5.B）；
 *   ③ 它带一堆解释性注释，控制台的粘贴框不适合读长注释。
 *
 * 三条铁律：
 *
 *   - **密钥重新生成，绝不复用开发值。** 想保留旧值就显式 `--keep-secrets`。
 *   - **不把密钥打进 stdout。** 终端输出只报路径与统计，文件里才有值。
 *   - **输出在仓库外**（默认 `../jyss-deploy-artifacts/`），免得手滑提交。
 *
 * 用法：
 *   node tools/gen-prod-env.mjs                    # 生成到 ../jyss-deploy-artifacts/env.production.txt
 *   node tools/gen-prod-env.mjs --out D:/env.txt   # 指定输出文件
 *   node tools/gen-prod-env.mjs --keep-secrets     # 不轮换密钥（一般不用）
 *
 * 自检：`.env` 里的键若没被这份清单覆盖，脚本**报错退出** ——
 *       防止以后往 `.env.example` 加了键、而生产清单悄悄漏配。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'server/.env';

/**
 * 生产清单：**顺序即分组顺序**。
 *
 * `kind` 说明这一项的值怎么来：
 *   copy    —— 照抄 `.env`
 *   regen   —— 重新生成（密钥）
 *   preset  —— 固定值（环境相关，与 `.env` 无关）
 *   input   —— 必须由你从控制台填，脚本留占位
 *   empty   —— 留空（COS 等云部署完再补）
 */
const SPEC = [
  {
    group: '基础',
    items: [
      { key: 'NODE_ENV', kind: 'preset', value: 'production' },
      { key: 'PORT', kind: 'preset', value: '3000' },
      { key: 'TZ', kind: 'preset', value: 'Asia/Shanghai' },
    ],
  },
  {
    group: '数据库（用内网地址，从云托管控制台取）',
    items: [
      {
        key: 'DATABASE_URL',
        kind: 'input',
        value: 'mysql://<用户>:<密码>@<内网地址>:3306/family_things',
      },
    ],
  },
  {
    group: '微信小程序',
    items: [
      { key: 'WX_APPID', kind: 'copy' },
      { key: 'WX_SECRET', kind: 'copy', sensitive: true },
      { key: 'WX_ENV_ID', kind: 'copy' },
      {
        key: 'CONTENT_SECURITY_ENABLED',
        kind: 'preset',
        value: 'true',
        note: '生产必须 true —— 用户生成内容过安全检测是审核硬性要求',
      },
    ],
  },
  {
    group: '鉴权（重新生成，不复用开发值）',
    items: [
      { key: 'JWT_SECRET', kind: 'regen', sensitive: true },
      { key: 'JWT_EXPIRES_IN', kind: 'copy' },
      {
        key: 'INTERNAL_CRON_SECRET',
        kind: 'regen',
        sensitive: true,
        note: '漏配时提醒功能静默死掉，服务照常 200 —— 看到 warn 就必须补',
      },
    ],
  },
  {
    group: '订阅消息（辅助通道）',
    items: [
      { key: 'WX_TEMPLATE_TASK', kind: 'copy' },
      { key: 'WX_TEMPLATE_NUDGE', kind: 'copy' },
      { key: 'WX_TEMPLATE_DONE', kind: 'copy' },
    ],
  },
  {
    group: '公众号模板消息（主力通道，后端直连微信 API）',
    items: [
      { key: 'NOTIFY_MP_ENABLED', kind: 'copy' },
      // ⚠️ 这对是**公众号/测试号**的凭据，和 WX_APPID/WX_SECRET（小程序的）是两套
      { key: 'MP_ACCOUNT_APPID', kind: 'copy' },
      { key: 'MP_ACCOUNT_SECRET', kind: 'copy', sensitive: true },
      { key: 'MP_LANDING_URL', kind: 'copy' },
      { key: 'MP_QRCODE_URL', kind: 'copy' },
      { key: 'MP_TEMPLATE_TASK', kind: 'copy' },
      { key: 'MP_TEMPLATE_REMINDER', kind: 'copy' },
      { key: 'MP_TEMPLATE_DONE', kind: 'copy' },
      { key: 'MP_APPID', kind: 'copy' },
      { key: 'MP_PAGEPATH', kind: 'copy' },
      { key: 'MP_CALLBACK_TOKEN', kind: 'copy', sensitive: true },
    ],
  },
  {
    group: '对象存储（体验版走前端直传云托管存储，只有 STORAGE_CLOUD_PREFIX 是生产要的）',
    items: [
      // 真机传一张图，把 fileID 去掉文件名那一段抄进来（见 server/.env.example 第 8 节）
      { key: 'STORAGE_CLOUD_PREFIX', kind: 'empty' },
      // 下面四个只服务于开发版的 `POST /upload/image`，生产可以留空
      { key: 'COS_BUCKET', kind: 'empty' },
      { key: 'COS_REGION', kind: 'empty' },
      { key: 'COS_SECRET_ID', kind: 'empty' },
      { key: 'COS_SECRET_KEY', kind: 'empty' },
    ],
  },
];

// -------------------------------------------------------------
// 参数
// -------------------------------------------------------------

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const keepSecrets = argv.includes('--keep-secrets');
const outFile =
  outIdx >= 0 && argv[outIdx + 1]
    ? resolve(argv[outIdx + 1])
    : resolve(ROOT, '..', 'jyss-deploy-artifacts', 'env.production.txt');

// -------------------------------------------------------------
// 读 .env
// -------------------------------------------------------------

if (!existsSync(resolve(ROOT, SRC))) {
  console.error(`❌ 找不到 ${SRC} —— 先 cp server/.env.example server/.env 再填值。`);
  process.exit(1);
}

const dev = new Map();
for (const raw of readFileSync(resolve(ROOT, SRC), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (line === '' || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const val = line.slice(eq + 1).trim();
  // ⚠️ 必须剥掉首尾引号：`.env` 里常写成 `KEY="value"`，而云托管控制台的
  //    环境变量框是**原样取值**的 —— 带着引号粘进去，WX_APPID 就变成
  //    `"wxbc..."`，微信侧直接不认。这类错误在启动日志里只是一行 warn。
  dev.set(line.slice(0, eq).trim(), val.replace(/^(["'])(.*)\1$/, '$2'));
}

// -------------------------------------------------------------
// 防漂移：.env 里的键必须全部被清单覆盖
// -------------------------------------------------------------

const covered = new Set(SPEC.flatMap((g) => g.items.map((i) => i.key)));
const missing = [...dev.keys()].filter((k) => !covered.has(k));
if (missing.length > 0) {
  console.error('❌ 以下 .env 的键没有出现在生产清单里：');
  missing.forEach((k) => console.error(`   ${k}`));
  console.error('   往 tools/gen-prod-env.mjs 的 SPEC 里补上 —— 否则生产环境会悄悄漏配。');
  process.exit(1);
}

// -------------------------------------------------------------
// 生成
// -------------------------------------------------------------

const lines = [
  '# 家有小事 · 云托管生产环境变量',
  `# 生成时间 ${new Date().toISOString()}`,
  `# 来源 ${SRC}（密钥已轮换：${keepSecrets ? '否，保留原值' : '是'}）`,
  '#',
  '# ⚠️ 这个文件含密钥，落在仓库外，不要提交、不要外传。',
  '# ⚠️ DATABASE_URL 必须换成云托管控制台里的【内网】地址。',
  '',
];

let regenCount = 0;
const pending = [];
/** `.env` 里为空、但生产其实要值的项（`empty` 组除外，那组本来就该空） */
const blank = [];

for (const g of SPEC) {
  lines.push(`# ---------- ${g.group} ----------`);
  for (const item of g.items) {
    let value;
    if (item.kind === 'preset' || item.kind === 'input' || item.kind === 'empty') {
      value = item.value ?? '';
    } else if (item.kind === 'regen') {
      if (keepSecrets) {
        value = dev.get(item.key) ?? '';
      } else {
        value = randomBytes(32).toString('hex');
        regenCount += 1;
      }
    } else {
      value = dev.get(item.key) ?? '';
    }

    if (item.kind === 'input') pending.push(item.key);
    if (item.kind === 'empty') pending.push(item.key);
    if (item.kind === 'copy' && value === '') blank.push(item.key);

    lines.push(`${item.key}=${value}`);
    if (item.note) lines.push(`#   ${item.note}`);
  }
  lines.push('');
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join('\n'), 'utf8');

// 云托管控制台支持 JSON 批量编辑：同时产出一份纯 KEY -> VALUE 的 JSON。
// 值一律保持字符串（PORT=3000 也写成 "3000"），避免控制台按数字处理。
const jsonFile = outFile.replace(/\.txt$/i, '.json');
const envObject = {};
for (const line of lines) {
  if (line === '' || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  envObject[line.slice(0, eq)] = line.slice(eq + 1);
}
writeFileSync(jsonFile, `${JSON.stringify(envObject, null, 2)}\n`, 'utf8');

console.log('🔑 生产环境变量清单已生成\n');
console.log(`   文本        ${outFile}`);
console.log(`   JSON        ${jsonFile}`);
console.log(`   变量数      ${covered.size}`);
console.log(`   轮换密钥    ${regenCount} 个${keepSecrets ? '（--keep-secrets，未轮换）' : ''}`);
if (pending.length > 0) {
  console.log(`\n   ⚠️ 还需你手工填的：${pending.join(' / ')}`);
  console.log('      DATABASE_URL 填云托管控制台的内网地址；对象存储那一组等真机传一张图再补。');
}
if (blank.length > 0) {
  console.log(`\n   ⚠️ 这些在 ${SRC} 里是空的，上线前要补：${blank.join(' / ')}`);
  console.log('     （MP_CALLBACK_TOKEN 要等后端部署好、测试号后台能填公网 URL 后才配得上）');
}
