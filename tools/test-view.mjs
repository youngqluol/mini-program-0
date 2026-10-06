/**
 * 展示模型的行为断言（`miniprogram/utils/*-view.ts`）
 *
 * 覆盖的纯函数：
 *   - `buildThingDetailView()`     —— P10 详情页
 *   - `buildThingRowView()`        —— P11 列表行（卡片 + 左滑操作）
 *   - `buildTodayReminderRow()`    —— P01 首页「今天的提醒」行（卡片 + 完成圈）
 *   - `buildNoticeView()`          —— P12 消息中心（通知行 + 送达说明）
 *   - `buildMineProfile()` / `buildUnreadBadge()` / `buildLeaveRow()` —— P20「我的」
 *   - `buildWechatNotifyRow()` / `buildWechatNotifyView()` —— P20 的行 + P21 微信提醒页
 *   - `describeExpire()`           —— 相对过期时间（P15 邀请码 / P21 绑定码）
 *
 * 为什么单独测这一层：它们全是纯函数，但分支不少（三种状态 × 我是执行人 /
 * 我是发起人 / 都与我无关 × 有没有提醒），而 `tsc` 只能保证**类型**对，
 * 保证不了「不限时间前完成」这种**语法通顺但意思错**的文案，
 * 也保证不了「谁该看到哪个操作」「这条到底推没推到微信」这类判断。
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

// 产物已落盘，require 进来；临时目录留到脚本结束再删。
// 一次编译同时产出全部模块 —— 加一个 view 文件只是多 require 一行，不用再编一遍。
const thingViewPath = join(outDir, 'miniprogram', 'utils', 'thing-view.js');
const noticeViewPath = join(outDir, 'miniprogram', 'utils', 'notice-view.js');
const mineViewPath = join(outDir, 'miniprogram', 'utils', 'mine-view.js');
const menuViewPath = join(outDir, 'miniprogram', 'utils', 'menu-view.js');
const memoryViewPath = join(outDir, 'miniprogram', 'utils', 'memory-view.js');
const timePath = join(outDir, 'miniprogram', 'utils', 'time.js');

for (const p of [
  thingViewPath,
  noticeViewPath,
  mineViewPath,
  menuViewPath,
  memoryViewPath,
  timePath,
]) {
  if (!existsSync(p)) {
    console.error(`没找到编译产物：${p}`);
    console.error('（大概率是 tsconfig 的 include / rootDir 变了，需要同步这个脚本）');
    rmSync(outDir, { recursive: true, force: true });
    process.exit(1);
  }
}

const { buildThingDetailView, buildThingRowView, buildTodayReminderRow } = require(thingViewPath);
const { buildNoticeView } = require(noticeViewPath);
const {
  buildLeaveRow,
  buildMineProfile,
  buildUnreadBadge,
  buildWechatNotifyRow,
  buildWechatNotifyView,
} = require(mineViewPath);
const {
  assignDoneToast,
  buildAssignChoices,
  buildDishCard,
  buildDishCards,
  buildMenuItemRowView,
  buildRecentMealRow,
  describeMealDate,
  describeMealNames,
  inferMealType,
  splitMenuGroups,
} = require(menuViewPath);
const {
  appendGroups,
  buildMemoryCard,
  buildVisibilityOptions,
  describeLatestMemory,
  describeMemoryDate,
  describeMemoryTime,
  describeThingBanner,
  describeThingRef,
  describeVisibility,
  draftCanPublish,
  editDoneToast,
  emptyTimelineHint,
  groupByDay,
  initialOf,
  photoUploadHint,
  prefillContent,
  publishDoneToast,
} = require(memoryViewPath);
const { describeExpire } = require(timePath);

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
// 13. P12 消息中心：通知行 + 送达说明
// ---------------------------------------------------------------

/** 造一条通知。默认是「叮一下，推到微信了」这个最常见的样子。 */
function notice(over = {}) {
  return {
    id: 70001,
    type: 'REMINDER',
    title: '阿妈 提醒你：拿快递',
    content:
      '阿妈，别忘了这件事\n事项：拿快递\n时间：今天 17:30\n来自：阿妈\n到时候了，提醒你一下～',
    channel: 'MP_TEMPLATE',
    status: 'SENT',
    thingId: 10001,
    isRead: false,
    createdAt: todayAt(17, 30),
    ...over,
  };
}

{
  const row = buildNoticeView(notice());

  check('通知 · id', row.id, 70001);
  check('通知 · 类型 emoji 来自 NOTICE_TYPE_META', row.emoji, '🔔');
  check('通知 · 类型名', row.typeLabel, '叮一下');
  check('通知 · 标题原样透出（后端已经带上事项名）', row.title, '阿妈 提醒你：拿快递');
  check('通知 · 时间要带「今天」才不歧义', row.timeText, '今天 17:30');
  check('通知 · 未读', row.isRead, false);
  check('通知 · 关联小事，可跳详情', row.thingId, 10001);

  // 送到微信了就不显示标签 —— 微信已经响过了，再说一句「已发到微信」是废话
  check('送达 · 推到微信 → 不显示标签', row.deliveryText, '');
  check(
    '送达 · 订阅消息也算推到微信',
    buildNoticeView(notice({ channel: 'SUBSCRIBE' })).deliveryText,
    '',
  );

  // 只在「没推到微信」时才给一句话 —— 那才是用户会疑惑的场景（「怎么没响？」）
  check(
    '送达 · 还没开微信提醒 → 说清原因',
    buildNoticeView(notice({ channel: 'IN_APP', status: 'NOT_BOUND' })).deliveryText,
    '还没开微信提醒',
  );
  check(
    '送达 · 额度用完 → 没发到微信',
    buildNoticeView(notice({ channel: 'IN_APP', status: 'NO_QUOTA' })).deliveryText,
    '没发到微信',
  );
  check(
    '送达 · 发送失败 → 没发出去',
    buildNoticeView(notice({ channel: 'IN_APP', status: 'FAILED' })).deliveryText,
    '没发出去',
  );
  check(
    '送达 · 幽灵记录（PENDING）→ 发送中',
    buildNoticeView(notice({ channel: 'IN_APP', status: 'PENDING' })).deliveryText,
    '发送中',
  );
  // 这一条挡的是那句「安静的假话」：只看 status 会把「只写了站内」说成「已发到微信」
  check(
    '送达 · 站内渠道 + SENT ≠ 推到微信（必须同时看 channel）',
    buildNoticeView(notice({ channel: 'IN_APP', status: 'SENT' })).deliveryText,
    '只在小程序里',
  );

  // 列表里靠 emoji 区分类型，五个撞在一起就白做了
  const emojis = ['TASK_ASSIGNED', 'REMINDER', 'TASK_DONE', 'JOIN_FAMILY', 'SYSTEM'].map(
    (type) => buildNoticeView(notice({ type })).emoji,
  );
  check('通知 · 五种类型各有自己的 emoji', new Set(emojis).size, 5);

  // 「加入家庭」「系统通知」没有关联小事，点了不该跳
  check(
    '通知 · 没有关联小事时 thingId 为 null（页面据此不给跳转）',
    buildNoticeView(notice({ type: 'JOIN_FAMILY', thingId: null })).thingId,
    null,
  );

  // 后端先加了新类型、小程序还没发版 —— 不能把 undefined 渲染出来
  const unknown = buildNoticeView(notice({ type: 'SOMETHING_NEW' }));
  check('通知 · 没见过的类型有兜底 emoji', unknown.emoji, '📢');
  check('通知 · 没见过的类型有兜底名字', unknown.typeLabel, '通知');
}

// ---------------------------------------------------------------
// 14. P20「我的」：抬头 / 未读角标 / 退出家庭
// ---------------------------------------------------------------

/** 造一个「我加入的家庭」简要信息（`MyFamilyBrief`） */
function brief(over = {}) {
  return { familyId: 30001, familyName: '我们家', memberId: 20001, roleName: '阿爸', ...over };
}

/** 造一个登录用户（`AuthUser`）。默认**没有昵称** —— 昵称授权还没做，这是常态。 */
function authUser(over = {}) {
  return { id: 1, nickname: null, avatarUrl: null, ...over };
}

{
  // 常态：昵称拿不到，大字那行就是称谓；小字那行**不再重复**它
  const noNickname = buildMineProfile(authUser(), brief());
  check('抬头 · 没昵称时用家庭称谓', noNickname.nickname, '阿爸');
  check('抬头 · 没昵称时不把称谓说两遍', noNickname.roleLine, '在我们家');
  check('抬头 · 有家庭', noNickname.hasFamily, true);

  // 将来补上昵称授权之后的样子
  const withNickname = buildMineProfile(authUser({ nickname: '老王' }), brief());
  check('抬头 · 有昵称时用昵称', withNickname.nickname, '老王');
  check('抬头 · 有昵称时小字报「家庭 · 称谓」', withNickname.roleLine, '在我们家 · 阿爸');

  // 昵称恰好等于称谓 —— 和「没昵称」是同一个结果，不该重复
  check(
    '抬头 · 昵称和称谓相同时也不重复',
    buildMineProfile(authUser({ nickname: '阿爸' }), brief()).roleLine,
    '在我们家',
  );

  // 全是空白的昵称不能当成有昵称（否则大字那行会是空的）
  check(
    '抬头 · 空白昵称退回称谓',
    buildMineProfile(authUser({ nickname: '   ' }), brief()).nickname,
    '阿爸',
  );

  // 守卫理论上不会让这一页在没有家庭时渲染出来，但纯函数不该依赖调用方的自觉
  const noFamily = buildMineProfile(null, null);
  check('抬头 · 没有家庭时的大字', noFamily.nickname, '我');
  check('抬头 · 没有家庭时的小字是空串', noFamily.roleLine, '');
  check('抬头 · 没有家庭', noFamily.hasFamily, false);
}

{
  // 0 条 = 不显示。显式移除角标，而不是显示一个「0」
  const zero = buildUnreadBadge(0);
  check('角标 · 0 条不显示', zero.show, false);
  check('角标 · 0 条文案是空串', zero.text, '');
  check('角标 · 负数也不显示', buildUnreadBadge(-3).show, false);

  check('角标 · 1 条', buildUnreadBadge(1).text, '1');
  check('角标 · 99 条仍是精确值', buildUnreadBadge(99).text, '99');

  // 微信的 tabBar 角标最多显示 4 个字符，再多会截成看不懂的样子 —— 自己先说「99+」
  check('角标 · 100 条改说 99+', buildUnreadBadge(100).text, '99+');
  check('角标 · 上千条也是 99+', buildUnreadBadge(9999).text, '99+');
  check('角标 · 99+ 时仍然显示', buildUnreadBadge(100).show, true);

  // 向下取整，不能四舍五入 —— 2.7 条未读不该显示成 3 条
  check('角标 · 小数向下取整', buildUnreadBadge(2.7).text, '2');
}

{
  // 非创建者：给按钮
  const member = buildLeaveRow(false);
  check('退出家庭 · 成员能看到按钮', member.show, true);
  check('退出家庭 · 成员不需要那行说明', member.hint, '');

  // 创建者：后端会拒绝他退出，所以不给按钮，换成一行说明
  const owner = buildLeaveRow(true);
  check('退出家庭 · 创建者没有按钮', owner.show, false);
  check('退出家庭 · 创建者看得到说明', owner.hint.length > 0, true);
  check('退出家庭 · 说明指向真正的出口', owner.hint.indexOf('家庭设置') >= 0, true);
  // 后端那句报错里有「转给别人」，但 V0.1 没有转让功能 —— 界面不能跟着说
  check('退出家庭 · 不承诺「转给别人」这个不存在的出口', owner.hint.indexOf('转给') >= 0, false);
}

// ---------------------------------------------------------------
// 15. P20 的「微信提醒」行 + P21 微信提醒页
// ---------------------------------------------------------------

/**
 * 一个「还剩 n 分钟**多一点**」的时刻，格式与后端一致。
 *
 * ⚠️ 必须留那半分钟余量：`describeExpire()` 是**向下取整**的，
 *    而这里造出的时刻到断言执行之间会过去几毫秒 —— 正好卡在整分钟上
 *    会算成「n-1 分钟」（第一版就踩了这个，期望 9 实际 8）。
 */
function expiresInMinutes(n) {
  const d = new Date(Date.now() + (n + 0.5) * 60000);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

{
  // P20 的行
  const on = buildWechatNotifyRow(true);
  check('提醒行 · 开了就说「已开启」', on.text, '已开启');
  check('提醒行 · 开了不染色', on.warn, false);

  const off = buildWechatNotifyRow(false);
  check('提醒行 · 没开就说「还没开」', off.text, '还没开');
  check('提醒行 · 没开要染色（这是一件还没做的事）', off.warn, true);
}

{
  // P21 已开启
  const boundAt = expiresInMinutes(-30);
  const on = buildWechatNotifyView({ bound: true, boundAt, pending: false });
  check('微信提醒 · 已开启的形态', on.mode, 'ON');
  check('微信提醒 · 已开启带时间', on.boundAtText.endsWith(' 开启'), true);
  check('微信提醒 · 已开启不带数字', on.codeText, '');
  check('微信提醒 · 已开启 hasCode 为假', on.hasCode, false);

  // 后端理论上一定给 boundAt，但拿不到时不能说「 开启」这种半句话
  const noAt = buildWechatNotifyView({ bound: true, pending: false });
  check('微信提醒 · 拿不到开启时间时说整句', noAt.boundAtText, '已经开启');
}

{
  // P21 还没开：六位数字要分组，用户是要照着打字的
  const setup = buildWechatNotifyView({
    bound: false,
    pending: true,
    bindCode: '735241',
    bindCodeExpireAt: expiresInMinutes(9),
  });
  check('微信提醒 · 还没开的形态', setup.mode, 'SETUP');
  check('微信提醒 · 六位数字按 3+3 分组', setup.codeText, '735 241');
  check('微信提醒 · 有数字', setup.hasCode, true);
  check('微信提醒 · 带过期时间', setup.expireText, '9 分钟后过期');

  // 不足 3 位 / 正好 3 位 / 超过 3 位都不能多出空格
  check(
    '分组 · 3 位不加空格',
    buildWechatNotifyView({ bound: false, pending: true, bindCode: '123' }).codeText,
    '123',
  );
  check(
    '分组 · 8 位按 3+3+2',
    buildWechatNotifyView({ bound: false, pending: true, bindCode: '12345678' }).codeText,
    '123 456 78',
  );

  // 后端还没生成出数字（或生成失败）时，页面不该渲染「②」那一块
  const noCode = buildWechatNotifyView({ bound: false, pending: false });
  check('微信提醒 · 没有数字时 hasCode 为假', noCode.hasCode, false);
  check('微信提醒 · 没有数字时文案是空串', noCode.codeText, '');
}

{
  // describeExpire 的三档。改动它会影响 P15（邀请码 72 小时）—— 一起钉住
  check('过期 · 9 分钟', describeExpire(expiresInMinutes(9)), '9 分钟后过期');
  check('过期 · 3 小时', describeExpire(expiresInMinutes(180)), '3 小时后过期');
  check('过期 · 3 天', describeExpire(expiresInMinutes(4320)), '3 天后过期');
  // 不足 1 分钟也说「1 分钟」—— 说「0 分钟后过期」等于告诉用户已经没了
  check('过期 · 不到 1 分钟也说 1 分钟', describeExpire(expiresInMinutes(0)), '1 分钟后过期');
  check('过期 · 已经过去了', describeExpire(expiresInMinutes(-1)), '已经过期了');
}

// ---------------------------------------------------------------
// 吃啥呢 · P02 随机卡片 / 最近吃过 / 确认层 / P17 菜谱行
// （miniprogram/utils/menu-view.ts）
// ---------------------------------------------------------------

{
  // --- 随机卡片 ---
  const sys = buildDishCard({
    id: null,
    name: '番茄炒蛋',
    category: '家常菜',
    imageUrl: null,
    source: 'SYSTEM',
  });
  check('吃啥呢 · 家常菜的 emoji', sys.emoji, '🍖');
  check('吃啥呢 · 分类文字照常透出', sys.category, '家常菜');
  check('吃啥呢 · 系统菜 id 为 null', sys.id, null);
  check(
    '吃啥呢 · 家庭菜带真实 id',
    buildDishCard({
      id: 30012,
      name: '可乐鸡翅',
      category: '家常菜',
      imageUrl: null,
      source: 'FAMILY',
    }).id,
    30012,
  );

  // 分类为空 / null / 只有空格 → 空串 + 兜底 emoji（不假装知道是荤是素）
  const noCat = buildDishCard({
    id: null,
    name: '随便',
    category: null,
    imageUrl: null,
    source: 'SYSTEM',
  });
  check('吃啥呢 · 没有分类时分类文字为空串', noCat.category, '');
  check('吃啥呢 · 没有分类时用兜底 emoji', noCat.emoji, '🍽️');
  check(
    '吃啥呢 · 分类只有空格也算没有',
    buildDishCard({
      id: 1,
      name: '随便',
      category: '  ',
      imageUrl: null,
      source: 'FAMILY',
    }).category,
    '',
  );

  // 分类是后端新加的、镜像还没跟上 → 兜底 emoji，不能崩、也不能吞掉文字
  const unknownCat = buildDishCard({
    id: 1,
    name: '新菜',
    category: '凉菜',
    imageUrl: null,
    source: 'FAMILY',
  });
  check('吃啥呢 · 不认识的分类用兜底 emoji', unknownCat.emoji, '🍽️');
  check('吃啥呢 · 不认识的分类文字照常透出', unknownCat.category, '凉菜');

  check('吃啥呢 · 空数组映射为空数组', JSON.stringify(buildDishCards([])), '[]');
  check('吃啥呢 · 传 undefined 不崩', JSON.stringify(buildDishCards(undefined)), '[]');
  check(
    '吃啥呢 · 三道菜映射成三张卡',
    buildDishCards([
      { id: null, name: 'a', category: null, imageUrl: null, source: 'SYSTEM' },
      { id: null, name: 'b', category: null, imageUrl: null, source: 'SYSTEM' },
      { id: null, name: 'c', category: null, imageUrl: null, source: 'SYSTEM' },
    ]).length,
    3,
  );

  // --- 最近吃过 ---
  check(
    '吃啥呢 · 菜名用间隔号连接',
    describeMealNames(['红烧肉', '紫菜蛋花汤']),
    '红烧肉 · 紫菜蛋花汤',
  );
  check('吃啥呢 · 单道菜不加分隔号', describeMealNames(['饺子']), '饺子');
  check('吃啥呢 · 空数组是空串', describeMealNames([]), '');
  check('吃啥呢 · 菜名里的空值被丢掉', describeMealNames(['饺子', '', null]), '饺子');

  check('吃啥呢 · 日期 + 晚餐', describeMealDate('2026-09-27', 'DINNER'), '9/27 晚');
  check('吃啥呢 · 日期 + 早餐', describeMealDate('2026-10-06', 'BREAKFAST'), '10/6 早');
  // 月 / 日不补零 —— 「9/27」而不是「09/27」（docs/03 P02 的草图）
  check('吃啥呢 · 月日不补零', describeMealDate('2026-01-05', 'LUNCH'), '1/5 午');
  // OTHER 没有短名，只说日期，不说「9/27 其他」
  check('吃啥呢 · OTHER 只说日期', describeMealDate('2026-09-27', 'OTHER'), '9/27');
  // 格式不认识时原样透出，不吞掉
  check('吃啥呢 · 认不出的日期原样透出', describeMealDate('2026/09/27', 'DINNER'), '2026/09/27 晚');
  check('吃啥呢 · 空日期只剩餐次', describeMealDate('', 'DINNER'), '晚');

  const recent = buildRecentMealRow({
    mealDate: '2026-09-27',
    mealType: 'DINNER',
    names: ['红烧肉', '紫菜蛋花汤'],
  });
  check('吃啥呢 · 最近吃过日期行', recent.dateText, '9/27 晚');
  check('吃啥呢 · 最近吃过菜名行', recent.namesText, '红烧肉 · 紫菜蛋花汤');
}

{
  // --- 确认层（「就吃这个」的底部面板）---
  const members = [
    { memberId: 20001, roleName: '阿爸' },
    { memberId: 20002, roleName: '阿妈' },
    { memberId: 20003, roleName: '小明' },
  ];
  const choices = buildAssignChoices(members, 20002);

  check('吃啥呢 · 选项数 = 成员数 + 1', choices.length, 4);
  check('吃啥呢 · 第一项是派给阿爸', choices[0].label, '派给阿爸');
  check('吃啥呢 · 自己显示成「我自己来」', choices[1].label, '我自己来');
  check('吃啥呢 · 自己那一项仍是派活', choices[1].kind, 'assign');
  check('吃啥呢 · 最后一项是不用派', choices[3].label, '不用派，自己解决');
  check('吃啥呢 · 不用派的 memberId 是 0', choices[3].memberId, 0);
  check('吃啥呢 · 不用派的 kind 是 skip', choices[3].kind, 'skip');
  // 顺序就是成员顺序 —— 与 P08 / P09 的成员选择器一致，不重排
  check(
    '吃啥呢 · 顺序就是成员顺序',
    choices.map((c) => c.memberId).join(','),
    '20001,20002,20003,0',
  );

  const solo = buildAssignChoices([{ memberId: 1, roleName: '我' }], 1);
  check('吃啥呢 · 一个人时只有两项', solo.length, 2);
  check('吃啥呢 · 一个人时第一项是我自己来', solo[0].label, '我自己来');

  // 成员接口挂了 / 返回空 —— 至少还能「不用派」，不能崩
  const none = buildAssignChoices([], 1);
  check('吃啥呢 · 没有成员时只剩不用派', none.length, 1);
  check('吃啥呢 · 没有成员时那一项是不用派', none[0].label, '不用派，自己解决');

  // 派活成功后的 toast。DINNER 用「今晚」—— 与 docs/03 P02 的文案一致
  check(
    '吃啥呢 · 派给别人（晚餐）',
    assignDoneToast('阿妈', false, 'DINNER'),
    '已经派给阿妈啦，今晚有口福～',
  );
  check(
    '吃啥呢 · 派给别人（午饭）',
    assignDoneToast('阿妈', false, 'LUNCH'),
    '已经派给阿妈啦，午饭有口福～',
  );
  check('吃啥呢 · 派给自己', assignDoneToast('阿爸', true, 'DINNER'), '自己的饭，记下啦～');
}

{
  // --- 这一餐是哪一餐（决定要不要凑「一荤一素一汤」、以及记进 meal_records 的餐次）---
  const clockAt = (h) => {
    const d = new Date();
    d.setHours(h, 30, 0, 0);
    return d;
  };

  check('吃啥呢 · 0 点算早饭', inferMealType(clockAt(0)), 'BREAKFAST');
  check('吃啥呢 · 7 点算早饭', inferMealType(clockAt(7)), 'BREAKFAST');
  check('吃啥呢 · 9:30 还算早饭', inferMealType(clockAt(9)), 'BREAKFAST');
  check('吃啥呢 · 10 点算午饭', inferMealType(clockAt(10)), 'LUNCH');
  check('吃啥呢 · 14:30 还算午饭', inferMealType(clockAt(14)), 'LUNCH');
  check('吃啥呢 · 15 点算晚饭', inferMealType(clockAt(15)), 'DINNER');
  check('吃啥呢 · 20:30 还算晚饭', inferMealType(clockAt(20)), 'DINNER');
  check('吃啥呢 · 21 点算其他', inferMealType(clockAt(21)), 'OTHER');
  check('吃啥呢 · 23 点算其他', inferMealType(clockAt(23)), 'OTHER');
}

{
  // --- P17 菜谱行 ---
  const sysRow = buildMenuItemRowView({
    id: null,
    name: '番茄炒蛋',
    category: '家常菜',
    imageUrl: null,
    source: 'SYSTEM',
    enabled: true,
    canEdit: false,
  });
  check('P17 · 系统菜不可编辑', sysRow.canEdit, false);
  check('P17 · 系统菜没有任何操作（滑不动）', sysRow.actions.length, 0);
  check('P17 · 系统菜 id 落成 0（swipe-cell 只收 Number）', sysRow.id, 0);
  check('P17 · 系统菜的 key 用菜名', sysRow.key, 's:番茄炒蛋');
  check('P17 · 启用中的系统菜不置灰', sysRow.dim, false);

  const onRow = buildMenuItemRowView({
    id: 30012,
    name: '可乐鸡翅',
    category: '家常菜',
    imageUrl: null,
    source: 'FAMILY',
    enabled: true,
    canEdit: true,
  });
  check('P17 · 家庭菜可编辑', onRow.canEdit, true);
  check('P17 · 家庭菜的 key 用 id', onRow.key, 'f:30012');
  check('P17 · 家庭菜有两个操作', onRow.actions.map((a) => a.label).join(','), '编辑,停用');
  check('P17 · 停用是危险色', onRow.actions[1].tone, 'danger');
  check('P17 · 启用中的家庭菜不置灰', onRow.dim, false);

  const offRow = buildMenuItemRowView({
    id: 30012,
    name: '可乐鸡翅',
    category: '家常菜',
    imageUrl: null,
    source: 'FAMILY',
    enabled: false,
    canEdit: true,
  });
  check('P17 · 停用后置灰', offRow.dim, true);
  check('P17 · 停用后操作变成「启用」', offRow.actions[1].label, '启用');
  check('P17 · 启用不是危险色', offRow.actions[1].tone, 'normal');

  // `canEdit` 与 `id` 必须同时成立 —— 声称可编辑却没有 id 是数据异常，宁可不给操作
  const weird = buildMenuItemRowView({
    id: null,
    name: '怪东西',
    category: null,
    imageUrl: null,
    source: 'FAMILY',
    enabled: true,
    canEdit: true,
  });
  check('P17 · 声称可编辑但没有 id → 不给操作', weird.actions.length, 0);
  check('P17 · 声称可编辑但没有 id → canEdit 落成 false', weird.canEdit, false);

  // 分组：顺序照搬接口，只分组不排序
  const groups = splitMenuGroups([
    {
      id: null,
      name: 'S1',
      category: null,
      imageUrl: null,
      source: 'SYSTEM',
      enabled: true,
      canEdit: false,
    },
    {
      id: 11,
      name: 'F1',
      category: null,
      imageUrl: null,
      source: 'FAMILY',
      enabled: true,
      canEdit: true,
    },
    {
      id: null,
      name: 'S2',
      category: null,
      imageUrl: null,
      source: 'SYSTEM',
      enabled: true,
      canEdit: false,
    },
    {
      id: 12,
      name: 'F2',
      category: null,
      imageUrl: null,
      source: 'FAMILY',
      enabled: false,
      canEdit: true,
    },
  ]);
  check('P17 · 系统组 2 条', groups.system.length, 2);
  check('P17 · 家庭组 2 条', groups.family.length, 2);
  check('P17 · 系统组保持接口顺序', groups.system.map((r) => r.name).join(','), 'S1,S2');
  check('P17 · 家庭组保持接口顺序', groups.family.map((r) => r.name).join(','), 'F1,F2');

  const emptyGroups = splitMenuGroups([]);
  check('P17 · 空列表两组都空', emptyGroups.system.length + emptyGroups.family.length, 0);
}

// ---------------------------------------------------------------
// 留个念（miniprogram/utils/memory-view.ts）
// ---------------------------------------------------------------

{
  /** 造一条 `MemoryItem`，只覆盖关心的字段 */
  const mem = (over) => ({
    id: 1,
    date: '2026-09-28',
    content: '宝宝今天第一次自己穿鞋。',
    visibility: 'FAMILY',
    creator: { memberId: 20002, roleName: '阿妈', avatarUrl: null },
    attachments: [],
    thing: null,
    isMine: false,
    createdAt: '2026-09-28 19:32:00',
    ...over,
  });
  /** 造 n 张附件 */
  const pics = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      fileUrl: `https://x/${i}.jpg`,
      width: 1,
      height: 1,
    }));

  // ---- 日期与时间 ----
  check('留个念 · "2026-09-28" → "2026.09.28"', describeMemoryDate('2026-09-28'), '2026.09.28');
  check('留个念 · 日期格式不认识时原样透出', describeMemoryDate('2026/09/28'), '2026/09/28');
  check('留个念 · 空日期不炸', describeMemoryDate(''), '');
  check('留个念 · createdAt → "19:32"', describeMemoryTime('2026-09-28 19:32:00'), '19:32');
  check('留个念 · createdAt 缺时刻时给空串', describeMemoryTime('2026-09-28'), '');

  // ---- 头像兜底 ----
  check('留个念 · 头像兜底取称谓首字', initialOf('阿妈'), '阿');
  check('留个念 · 空称谓兜底成「家」', initialOf(''), '家');

  // ---- 可见范围 ----
  check('留个念 · FAMILY 的人话', describeVisibility('FAMILY'), '家里人都能看到');
  check('留个念 · PRIVATE 的人话', describeVisibility('PRIVATE'), '只有我');
  check(
    '留个念 · 可见范围选项顺序固定',
    buildVisibilityOptions()
      .map((o) => o.value)
      .join(','),
    'FAMILY,PRIVATE',
  );

  // ---- 「完成纪念」的标注 ----
  check('留个念 · 完成纪念的标注', describeThingRef({ id: 9, title: '买牛奶' }), '来自 🎯 买牛奶');
  check('留个念 · 独立留念没有标注', describeThingRef(null), '');
  check('留个念 · 关联标题为空时不拼半句', describeThingRef({ id: 9, title: '' }), '');

  // ---- 卡片 ----
  const card = buildMemoryCard(mem());
  check('留个念 · 卡片日期', card.dateText, '2026.09.28');
  check('留个念 · 卡片时刻', card.timeText, '19:32');
  check('留个念 · 头像为空时 avatarUrl 是空串（不是 null）', card.avatarUrl, '');
  check('留个念 · 头像兜底字', card.avatarText, '阿');
  check('留个念 · 家庭可见不带私密标记', card.isPrivate, false);
  check('留个念 · 私密记录带标记', buildMemoryCard(mem({ visibility: 'PRIVATE' })).isPrivate, true);
  check('留个念 · 正文原样透出', card.content, '宝宝今天第一次自己穿鞋。');
  check('留个念 · isMine 直接取后端给的', buildMemoryCard(mem({ isMine: true })).isMine, true);

  // 九宫格上限：后端限制 9 张，前端是**防御性**的兜底
  const many = buildMemoryCard(mem({ attachments: pics(12) }));
  check('留个念 · 九宫格最多显示 9 张', many.photos.length, 9);
  check('留个念 · 超出的张数进 moreCount', many.moreCount, 3);
  check(
    '留个念 · 刚好 9 张时 moreCount 为 0',
    buildMemoryCard(mem({ attachments: pics(9) })).moreCount,
    0,
  );
  check('留个念 · 没有图片时 photos 是空数组', card.photos.length, 0);

  // 字段缺失也不能炸（后端换形状时页面不该白屏）
  check('留个念 · creator 缺失时不炸', buildMemoryCard(mem({ creator: null })).creatorName, '家人');
  check(
    '留个念 · attachments 缺失时不炸',
    buildMemoryCard(mem({ attachments: null })).photos.length,
    0,
  );

  // ---- 按日分组 ----
  const groups = groupByDay([
    mem({ id: 3, date: '2026-09-28' }),
    mem({ id: 2, date: '2026-09-28' }),
    mem({ id: 1, date: '2026-09-26' }),
  ]);
  check('留个念 · 分组数（两天 → 两组）', groups.length, 2);
  check('留个念 · 第一组日期', groups[0].dateText, '2026.09.28');
  check('留个念 · 第一组条数', groups[0].items.length, 2);
  check('留个念 · 第二组条数', groups[1].items.length, 1);
  check('留个念 · 组内顺序照搬接口（不重排）', groups[0].items.map((i) => i.id).join(','), '3,2');
  check('留个念 · 空列表 → 空分组', groupByDay([]).length, 0);

  // ---- 加载更多时合并边界那一天 ----
  const page1 = groupByDay([mem({ id: 5, date: '2026-09-28' })]);
  const page2 = groupByDay([
    mem({ id: 4, date: '2026-09-28' }),
    mem({ id: 3, date: '2026-09-26' }),
  ]);
  const merged = appendGroups(page1, page2);
  check('留个念 · 边界同一天要合并成一组（否则会出现两个 09.28）', merged.length, 2);
  check('留个念 · 合并后第一条日期', merged[0].dateText, '2026.09.28');
  check('留个念 · 合并后第一条含两条', merged[0].items.length, 2);
  check('留个念 · 合并后第二条是另一天', merged[1].dateText, '2026.09.26');
  check(
    '留个念 · 边界不同天就各自成组',
    appendGroups(page1, groupByDay([mem({ date: '2026-09-20' })])).length,
    2,
  );
  check('留个念 · appendGroups 不改动入参', page1.length, 1);
  check('留个念 · appendGroups 首参为空时直接返回新页', appendGroups([], page2).length, 2);
  check('留个念 · appendGroups 新页为空时保持原样', appendGroups(page1, []).length, 1);

  // ---- 发布页 ----
  check('留个念 · 只有空格不能发', draftCanPublish({ content: '   ', photoCount: 0 }), false);
  check('留个念 · 有正文就能发', draftCanPublish({ content: '哈', photoCount: 0 }), true);
  check('留个念 · 只有图片也能发', draftCanPublish({ content: '', photoCount: 1 }), true);
  check('留个念 · 都没有不能发', draftCanPublish({ content: '', photoCount: 0 }), false);
  check(
    '留个念 · 私密发布的 toast 要说清别人看不到',
    publishDoneToast('PRIVATE'),
    '记下啦，只有你自己能看到',
  );
  check('留个念 · 家庭可见的 toast', publishDoneToast('FAMILY'), '记下啦～');
  check('留个念 · 编辑的 toast 不说「记下啦」', editDoneToast(), '改好啦');
  check('留个念 · 没有失败图时不给提示', photoUploadHint(0), '');
  check('留个念 · 一张失败', photoUploadHint(1), '有 1 张没传上去，点它重试');
  check('留个念 · 多张失败', photoUploadHint(3), '有 3 张没传上去，点它们重试');
  check('留个念 · 完成纪念的预填正文', prefillContent('买牛奶'), '买牛奶 搞定啦');
  check('留个念 · 没有标题就不预填', prefillContent(''), '');
  check('留个念 · 关联标记（P18 顶部那行）', describeThingBanner('买牛奶'), '来自 🎯 买牛奶');
  check('留个念 · 没有关联时标记为空', describeThingBanner(''), '');

  // ---- 空状态与首页预览 ----
  check('留个念 · 空状态文案', emptyTimelineHint(), '这里还空空的，记点什么吧 📖');
  check('留个念 · 没有记录时的预览', describeLatestMemory(null), '还没有记录');
  check(
    '留个念 · 预览 = 称谓 + 正文',
    describeLatestMemory(mem()),
    '阿妈：宝宝今天第一次自己穿鞋。',
  );
  check(
    '留个念 · 预览超长要截断加省略号（23 字 → 18 字 + …）',
    describeLatestMemory(mem({ content: '一二三四五六七八九十一二三四五六七八九十一二三' })),
    '阿妈：一二三四五六七八九十一二三四五六七八…',
  );
  check(
    '留个念 · 只有图片的预览不说空话',
    describeLatestMemory(mem({ content: '', attachments: pics(2) })),
    '阿妈记了 2 张照片',
  );
  check(
    '留个念 · 称谓缺失时的预览兜底',
    describeLatestMemory(mem({ creator: { memberId: 0, roleName: '', avatarUrl: null } })),
    '家人：宝宝今天第一次自己穿鞋。',
  );
}

// ---------------------------------------------------------------
// 结果
// ---------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length === 0) {
  console.log(`✅ 展示模型校验通过：${passed} 项断言`);
  process.exit(0);
}

console.error(
  `❌ 展示模型有 ${failures.length} 项不符合预期（共 ${passed + failures.length} 项）：\n`,
);
for (const f of failures) {
  console.error(`  · ${f.name}`);
  console.error(`      期望：${JSON.stringify(f.expected)}`);
  console.error(`      实际：${JSON.stringify(f.actual)}`);
}
process.exit(1);
