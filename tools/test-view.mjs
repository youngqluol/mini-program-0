/**
 * 小事展示模型的行为断言（`miniprogram/utils/thing-view.ts`）
 *
 * 覆盖三个纯函数：
 *   - `buildThingDetailView()`     —— P10 详情页
 *   - `buildThingRowView()`        —— P11 列表行（卡片 + 左滑操作）
 *   - `buildTodayReminderRow()`    —— P01 首页「今天的提醒」行（卡片 + 完成圈）
 *
 * 为什么单独测这一层：它们全是纯函数，但分支不少（三种状态 × 我是执行人 /
 * 我是发起人 / 都与我无关 × 有没有提醒），而 `tsc` 只能保证**类型**对，
 * 保证不了「不限时间前完成」这种**语法通顺但意思错**的文案，
 * 也保证不了「谁该看到哪个操作」这种**权限判断**。
 * 这两类错误都只有跑到线上被人看见才会发现 —— 所以在本地拦一下。
 *
 * 实现方式：小程序端是 TypeScript，node 不能直接 require。这里用仓库里
 * 已有的 `typescript`（devDependency）把 `miniprogram/` 编译到系统临时目录，
 * 再 require 编译产物。**不新增任何依赖**，也不往仓库里写产物。
 *
 * ⚠️ 编译走 **TypeScript 编译器 API（进程内）**，不 spawn `tsc`：
 *    本机的执行环境会拦子进程（`EBUSY` / Windows 上对 `.cmd` 是 `EINVAL`），
 *    而在进程内跑既不依赖 shell，也省掉一次进程启动。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = resolve(import.meta.dirname, '..');
const MP_DIR = join(ROOT, 'miniprogram');

const require = createRequire(import.meta.url);
const ts = require('typescript');

// ---------------------------------------------------------------
// 编译（进程内，用 miniprogram/tsconfig.json 的配置）
// ---------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'jyss-view-test-'));

const configPath = join(MP_DIR, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(
    `读不到 ${configPath}：${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
  );
  process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  MP_DIR,
  { outDir, sourceMap: false },
  configPath,
);

const program = ts.createProgram(parsed.fileNames, parsed.options);
const emitResult = program.emit();
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .concat(emitResult.diagnostics)
  .filter((d) => d.category === ts.DiagnosticCategory.Error);

if (diagnostics.length > 0) {
  console.error(`编译小程序端失败（${diagnostics.length} 个错误）：`);
  for (const d of diagnostics.slice(0, 10)) {
    const file = d.file
      ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
      : '';
    console.error(`  ${file} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

const viewPath = join(outDir, 'miniprogram', 'utils', 'thing-view.js');

if (!existsSync(viewPath)) {
  console.error(`没找到编译产物：${viewPath}`);
  console.error('（大概率是 tsconfig 的 include / rootDir 变了，需要同步这个脚本）');
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

// 产物已落盘，require 进来；临时目录留到脚本结束再删
const { buildThingDetailView, buildThingRowView, buildTodayReminderRow } = require(viewPath);

// ---------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

/** 相对今天第 offset 天的某个时刻，格式与后端一致 */
function at(offsetDays, hh, mm) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` + `${pad(hh)}:${pad(mm)}:00`
  );
}

/** 从「今天 00:00」往后的分钟数，用来造一个「一定是今天」的时刻 */
function todayAt(hh, mm) {
  return at(0, hh, mm);
}

const ME_MA = 20002; // 阿妈（发起人）
const ME_BA = 20001; // 阿爸（执行人）
const ME_SON = 20003; // 小明（与这件事无关）

function member(memberId, roleName) {
  return { memberId, roleName, avatarUrl: null };
}

/** 造一条小事详情。默认值挑的是「派活 + 有提醒」这个最常见的样子。 */
function thing(over = {}) {
  return {
    id: 10001,
    type: 'TASK',
    title: '买牛奶',
    content: null,
    status: 'PENDING',
    visibility: 'FAMILY',
    dueAt: at(1, 18, 0),
    creator: member(ME_MA, '阿妈'),
    assignee: member(ME_BA, '阿爸'),
    hasReminder: true,
    nextRemindAt: at(1, 17, 30),
    isOverdue: false,
    createdAt: todayAt(10, 0),
    reminders: [
      {
        id: 40001,
        remindType: 'SCHEDULED',
        remindAt: at(1, 17, 30),
        recurrenceType: 'NONE',
        status: 'PENDING',
        sentCount: 0,
        lastSentAt: null,
      },
    ],
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    updatedAt: todayAt(10, 0),
    ...over,
  };
}

// ---------------------------------------------------------------
// 断言
// ---------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures.push({ name, actual, expected });
}

/** 断言「以某个片段结尾」—— 用于带「今天 / 明天」前缀、前缀由时间工具算的文案 */
function checkEndsWith(name, actual, suffix) {
  check(name, typeof actual === 'string' && actual.endsWith(suffix), true);
}

/** 断言「以某个片段开头」 */
function checkStartsWith(name, actual, prefix) {
  check(name, typeof actual === 'string' && actual.startsWith(prefix), true);
}

// ---------------------------------------------------------------
// 1. 待完成 · 我是执行人 —— 唯一该看到「搞定啦」的情况
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(thing(), ME_BA);
  check('执行人 主操作形态', v.mainTone, 'primary');
  check('执行人 主操作文案', v.mainText, '搞定啦 ✓');
  check('执行人 没有次操作（取消只有发起人能做）', v.subAction, '');
  check('执行人 人员行', v.peopleText, '阿妈 → 阿爸');
  checkStartsWith('执行人 要求时间前缀', v.dueText, '明天 ');
  checkEndsWith('执行人 要求时间后缀', v.dueText, '18:00 前完成');
  check('执行人 提醒行', v.reminderText, '🔔 17:30 提醒阿爸');
  check('执行人 可见范围', v.visibilityText, '家里人都能看到');
}

// ---------------------------------------------------------------
// 2. 待完成 · 我是发起人（不是执行人）—— 只能取消，不能替人完成
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(thing(), ME_MA);
  check('发起人 主操作形态是状态不是按钮', v.mainTone, 'idle');
  check('发起人 主操作文案是状态', v.mainText, '待完成');
  check('发起人 次操作', v.subAction, 'CANCEL');
}

// ---------------------------------------------------------------
// 3. 待完成 · 与我无关 —— 两个操作都不给
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(thing(), ME_SON);
  check('旁观者 主操作形态', v.mainTone, 'idle');
  check('旁观者 主操作文案', v.mainText, '待完成');
  check('旁观者 没有次操作', v.subAction, '');
}

// ---------------------------------------------------------------
// 4. 已完成 · 发起人能重新打开
// ---------------------------------------------------------------

{
  const t = thing({
    status: 'COMPLETED',
    completedAt: todayAt(18, 5),
    completedBy: member(ME_BA, '阿爸'),
    reminders: [
      {
        id: 40001,
        remindType: 'SCHEDULED',
        remindAt: at(1, 17, 30),
        recurrenceType: 'NONE',
        status: 'CANCELLED',
        sentCount: 0,
        lastSentAt: null,
      },
    ],
  });

  const asCreator = buildThingDetailView(t, ME_MA);
  check('已完成 主操作形态', asCreator.mainTone, 'done');
  check('已完成 主操作文案', asCreator.mainText, '已完成 · 18:05 由阿爸完成');
  check('已完成 次操作', asCreator.subAction, 'REOPEN');
  check('已完成 不再说提醒（提醒已随完成一起取消）', asCreator.reminderText, '');

  const asAssignee = buildThingDetailView(t, ME_BA);
  check('已完成 · 执行人看不到重新打开', asAssignee.subAction, '');
}

// ---------------------------------------------------------------
// 5. 已取消
// ---------------------------------------------------------------

{
  const t = thing({
    status: 'CANCELLED',
    cancelledAt: at(-1, 12, 0),
    reminders: [],
  });
  const v = buildThingDetailView(t, ME_MA);
  check('已取消 主操作形态', v.mainTone, 'cancelled');
  check('已取消 主操作文案', v.mainText, '已取消 · 昨天 12:00');
  check('已取消 次操作', v.subAction, 'REOPEN');
}

// ---------------------------------------------------------------
// 6. 不限时间 —— 这里最容易写出「不限时间前完成」这种病句
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(thing({ dueAt: null, reminders: [] }), ME_BA);
  check('不限时间 派活', v.dueText, '不限时间');
  check('不限时间 没有提醒行', v.reminderText, '');
}

// ---------------------------------------------------------------
// 7. 叮一下：小事时间就是提醒时间，不要再把时刻说第二遍
// ---------------------------------------------------------------

{
  const when = at(1, 7, 0);
  const v = buildThingDetailView(
    thing({
      type: 'REMINDER',
      title: '送小明上学',
      visibility: 'RELATED',
      dueAt: when,
      reminders: [
        {
          id: 40002,
          remindType: 'SCHEDULED',
          remindAt: when,
          recurrenceType: 'NONE',
          status: 'PENDING',
          sentCount: 0,
          lastSentAt: null,
        },
      ],
    }),
    ME_BA,
  );
  check('叮一下 类型文案', v.typeLabel, '叮一下');
  check('叮一下 时间行不带「前完成」', v.dueText.endsWith('前完成'), false);
  check('叮一下 提醒行不重复时刻', v.reminderText, '🔔 到时候会提醒阿爸');
  check('叮一下 只有我俩可见（我是执行人，对方是发起人）', v.visibilityText, '只有我和阿妈能看到');
}

// ---------------------------------------------------------------
// 8. 自己给自己派活 + 仅我俩可见 —— 「只有我俩」这时是假话
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(
    thing({
      visibility: 'RELATED',
      creator: member(ME_MA, '阿妈'),
      assignee: member(ME_MA, '阿妈'),
    }),
    ME_MA,
  );
  check('自派 人员行不出现箭头', v.peopleText, '阿妈');
  check('自派 可见范围说「我自己」', v.visibilityText, '只有我自己能看到');
  check('自派 我既是执行人也是发起人', v.mainTone, 'primary');
  check('自派 可以取消', v.subAction, 'CANCEL');
}

// ---------------------------------------------------------------
// 9. 没有执行人 / 已经提醒过 / 立即叮
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(thing({ assignee: null, reminders: [] }), ME_MA);
  check('没执行人 人员行', v.peopleText, '阿妈');
  check('没执行人 不说「前完成」以外的假话', v.dueText.endsWith('前完成'), true);

  const sent = buildThingDetailView(
    thing({
      reminders: [
        {
          id: 40003,
          remindType: 'SCHEDULED',
          remindAt: at(0, 9, 0),
          recurrenceType: 'NONE',
          status: 'SENT',
          sentCount: 1,
          lastSentAt: todayAt(9, 0),
        },
      ],
    }),
    ME_BA,
  );
  check('已提醒过 提醒行', sent.reminderText, '🔔 已经提醒过阿爸了');

  const now = buildThingDetailView(
    thing({
      reminders: [
        {
          id: 40004,
          remindType: 'NOW',
          remindAt: null,
          recurrenceType: 'NONE',
          status: 'PENDING',
          sentCount: 0,
          lastSentAt: null,
        },
      ],
    }),
    ME_BA,
  );
  check('立即叮 不编造时刻', now.reminderText, '🔔 到时候会提醒阿爸');
}

// ---------------------------------------------------------------
// 10. 备注透传（含换行）
// ---------------------------------------------------------------

{
  const v = buildThingDetailView(thing({ content: '楼下超市\n买两盒' }), ME_BA);
  check('备注原样透传', v.content, '楼下超市\n买两盒');

  const empty = buildThingDetailView(thing({ content: null }), ME_BA);
  check('没有备注时是空串（页面据此隐藏整块）', empty.content, '');
}

// ---------------------------------------------------------------
// 11. P11 列表行：卡片 + 左滑操作
// ---------------------------------------------------------------

/** 把 actions 压成 "COMPLETE,CANCEL" 这样的串，断言起来一目了然 */
function keysOf(row) {
  return row.actions.map((a) => a.key).join(',');
}

{
  const mine = thing();

  check('行 · 我是执行人 → 只能完成', keysOf(buildThingRowView(mine, ME_BA)), 'COMPLETE');
  check('行 · 我是发起人 → 只能取消', keysOf(buildThingRowView(mine, ME_MA)), 'CANCEL');
  check(
    '行 · 与我无关 → 不可滑（空数组，不是滑开空抽屉）',
    keysOf(buildThingRowView(mine, ME_SON)),
    '',
  );

  const selfAssigned = thing({
    creator: member(ME_MA, '阿妈'),
    assignee: member(ME_MA, '阿妈'),
  });
  check(
    '行 · 自己派给自己 → 完成 + 取消',
    keysOf(buildThingRowView(selfAssigned, ME_MA)),
    'COMPLETE,CANCEL',
  );
  check(
    '行 · 取消是破坏性操作，要单独染色',
    buildThingRowView(selfAssigned, ME_MA).actions[1].tone,
    'danger',
  );

  const done = thing({
    status: 'COMPLETED',
    completedAt: todayAt(18, 5),
    completedBy: member(ME_BA, '阿爸'),
  });
  check('行 · 已完成 + 我派的 → 重新打开', keysOf(buildThingRowView(done, ME_MA)), 'REOPEN');
  check('行 · 已完成 + 只是执行人 → 不可滑', keysOf(buildThingRowView(done, ME_BA)), '');

  const cancelled = thing({ status: 'CANCELLED', cancelledAt: at(-1, 12, 0) });
  check(
    '行 · 已取消 + 我派的 → 也能重新打开',
    keysOf(buildThingRowView(cancelled, ME_MA)),
    'REOPEN',
  );

  // 卡片部分必须和 `fromThingListItem` 完全一致 —— 行视图只是多包了一层操作
  const row = buildThingRowView(mine, ME_BA);
  check('行 · wx:key 用的 id', row.id, mine.id);
  check('行 · 卡片 id', row.card.id, mine.id);
  check('行 · 卡片标题', row.card.title, '买牛奶');
  check('行 · 卡片执行人', row.card.assigneeName, '阿爸');
  check('行 · 卡片未完成不置灰', row.card.done, false);
  check(
    '行 · 卡片时间用 describeDue 口径（列表要带「明天」才不歧义）',
    row.card.timeText.startsWith('明天 '),
    true,
  );
}

// ---------------------------------------------------------------
// 12. P01 首页：今天的提醒行（卡片 + 要不要给完成圈）
// ---------------------------------------------------------------

/** 造一条今日提醒。`time` 是后端已经格式化好的 "HH:mm" */
function todayReminder(over = {}) {
  return {
    id: 50001,
    title: '接孩子',
    time: '17:30',
    assignee: member(ME_BA, '阿爸'),
    status: 'PENDING',
    ...over,
  };
}

{
  const row = buildTodayReminderRow(todayReminder(), ME_BA);

  check('提醒行 · wx:key 用的 id', row.id, 50001);
  check('提醒行 · 卡片 id', row.card.id, 50001);
  check('提醒行 · 卡片是提醒类型', row.card.type, 'REMINDER');
  check(
    '提醒行 · 时间直接用后端的 HH:mm（这一区块全是今天的，再说「今天」是废话）',
    row.card.timeText,
    '17:30',
  );

  check('提醒行 · 我是执行人 → 给完成圈', row.canCheck, true);
  check(
    '提醒行 · 我只是发起人 → 不给完成圈（点下去就是一次 403）',
    buildTodayReminderRow(todayReminder(), ME_MA).canCheck,
    false,
  );
  check(
    '提醒行 · 谁都不是 → 不给完成圈',
    buildTodayReminderRow(todayReminder(), ME_SON).canCheck,
    false,
  );

  const noOne = buildTodayReminderRow(todayReminder({ assignee: null }), ME_BA);
  check('提醒行 · 没执行人时圈也不给（不能因为「谁都不是」就人人可点）', noOne.canCheck, false);
  check('提醒行 · 没执行人时的称谓说实话', noOne.card.assigneeName, '还没人接');

  check(
    '提醒行 · 已完成 → 卡片置灰',
    buildTodayReminderRow(todayReminder({ status: 'COMPLETED' }), ME_BA).card.done,
    true,
  );
}

// ---------------------------------------------------------------
// 结果
// ---------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length === 0) {
  console.log(`✅ 小事展示模型校验通过：${passed} 项断言`);
  process.exit(0);
}

console.error(
  `❌ 小事展示模型有 ${failures.length} 项不符合预期（共 ${passed + failures.length} 项）：\n`,
);
for (const f of failures) {
  console.error(`  · ${f.name}`);
  console.error(`      期望：${JSON.stringify(f.expected)}`);
  console.error(`      实际：${JSON.stringify(f.actual)}`);
}
process.exit(1);
