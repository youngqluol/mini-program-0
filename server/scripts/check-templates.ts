/**
 * 通知模板字段自检（公众号模板 + 小程序订阅消息）。
 *
 * 为什么需要它：
 *   微信模板消息的 `data` 字段名必须与**后台模板**完全一致。
 *   字段少了 → 直接返回 `47003`，而且报错信息几乎无法定位（不告诉你是哪个字段）。
 *   这个脚本把「代码实际产出的字段」与「模板规格里声明的字段」逐项比对，
 *   把问题拦在推送之前，而不是等到手机上收不到消息才发现。
 *
 * 两套模板都查：
 *   - 公众号模板消息（`MP_TEMPLATE_*`，测试号后台自建，字段名可自定义）
 *   - 小程序订阅消息（`WX_TEMPLATE_*`，公共模板库，字段名定死 thing1/time23…）
 *
 * 用法：
 *   cd server && pnpm run check:templates
 *
 * 退出码：0 = 全部对齐；1 = 有不匹配（可直接用于 CI / pre-commit）。
 */
import { NotifyType } from '@shared/enums';
import {
  MP_TEMPLATE_SPECS,
  MpTemplateKind,
  buildTemplate,
  validateTemplateData,
  type TemplateContext,
} from '../src/modules/notify/notify.templates';
import {
  SUB_TEMPLATE_KINDS,
  SUB_TEMPLATE_SPECS,
  SubTemplateKind,
  THING_MAX_LEN,
  buildSubscribeData,
  subKindOf,
  validateSubscribeData,
} from '../src/modules/notify/subscribe.templates';

interface Case {
  type: NotifyType;
  mpKind: MpTemplateKind;
  subKind: SubTemplateKind;
  label: string;
}

const CASES: Case[] = [
  {
    type: NotifyType.TASK_ASSIGNED,
    mpKind: MpTemplateKind.TASK,
    subKind: SubTemplateKind.TASK,
    label: '派活',
  },
  {
    type: NotifyType.REMINDER,
    mpKind: MpTemplateKind.REMINDER,
    subKind: SubTemplateKind.REMINDER,
    label: '叮一下',
  },
  {
    type: NotifyType.TASK_DONE,
    mpKind: MpTemplateKind.DONE,
    subKind: SubTemplateKind.DONE,
    label: '完成回执',
  },
];

/** 用一组覆盖所有字段的假数据跑一遍 */
const CTX: TemplateContext = {
  roleName: '阿爸',
  familyName: '我们家',
  thingTitle: '记得买酱油',
  thingContent: '下班路上顺手带一瓶',
  fromRoleName: '阿妈',
  dueAt: new Date(),
  remindAt: new Date(),
  doneAt: new Date(),
  doneByRoleName: '阿爸',
};

let failed = 0;

const fail = (msg: string) => {
  console.error(`❌ ${msg}`);
  failed += 1;
};

// ===============================================================
// 一、公众号模板消息
// ===============================================================

console.log('=== 一、公众号模板字段自检（主力通道 / wxpush）===\n');

for (const c of CASES) {
  const spec = MP_TEMPLATE_SPECS[c.mpKind];
  const built = buildTemplate(c.type, CTX);

  if (built.mpKind !== c.mpKind) {
    fail(`${c.label}：mpKind 期望 ${c.mpKind}，实际 ${built.mpKind}`);
    continue;
  }

  const result = validateTemplateData(c.mpKind, built.templateData);
  if (!result.ok) {
    fail(`${c.label}（${spec.name}）字段不匹配 —— 微信会返回 47003`);
    if (result.missing.length) console.error(`   代码缺少字段: ${result.missing.join(', ')}`);
    if (result.extra.length) console.error(`   代码多余字段: ${result.extra.join(', ')}`);
    continue;
  }

  console.log(`✅ ${c.label}（${spec.name}）`);
  console.log(`   字段: ${spec.fields.join(' / ')}`);
  console.log(`   环境变量: ${spec.envKey}`);
}

// 没有对应模板的类型，必须 mpKind = null（走降级，不是错误）
for (const type of [NotifyType.JOIN_FAMILY, NotifyType.SYSTEM]) {
  const built = buildTemplate(type, CTX);
  const name = NotifyType[type];
  if (built.mpKind !== null) {
    fail(`${name} 不应有公众号模板，实际 ${built.mpKind}`);
  } else {
    console.log(`✅ ${name} 无对应模板 → 正常降级到订阅消息 / 站内`);
  }
}

// ===============================================================
// 二、小程序订阅消息
// ===============================================================

console.log('\n\n=== 二、订阅消息字段自检（辅助通道 / 公共模板库）===\n');

for (const c of CASES) {
  const spec = SUB_TEMPLATE_SPECS[c.subKind];
  const built = buildTemplate(c.type, CTX);

  if (built.subKind !== c.subKind) {
    fail(`${c.label}：subKind 期望 ${c.subKind}，实际 ${built.subKind}`);
    continue;
  }

  const result = validateSubscribeData(c.subKind, built.subTemplateData);
  if (!result.ok) {
    fail(`${c.label}（${spec.name}）字段不匹配 —— 微信会返回 47003`);
    if (result.missing.length) console.error(`   代码缺少字段: ${result.missing.join(', ')}`);
    if (result.extra.length) console.error(`   代码多余字段: ${result.extra.join(', ')}`);
    if (result.invalid.length) console.error(`   值不合规: ${result.invalid.join('；')}`);
    continue;
  }

  console.log(`✅ ${c.label}（${spec.name}｜模板编号 ${spec.number}）`);
  console.log(
    `   字段: ${spec.fields
      .map((f) => `${f}(${spec.labels[f]}/${spec.fieldTypes[f]})`)
      .join(' / ')}`,
  );
  console.log(`   环境变量: ${spec.envKey}`);
  console.log(`   跳转: ${spec.page}`);
}

// 没有对应订阅模板的类型，必须 subKind = null
for (const type of [NotifyType.JOIN_FAMILY, NotifyType.SYSTEM]) {
  const built = buildTemplate(type, CTX);
  const name = NotifyType[type];
  if (built.subKind !== null) {
    fail(`${name} 不应有订阅消息模板，实际 ${built.subKind}`);
  } else {
    console.log(`✅ ${name} 无对应订阅模板 → 正常降级到站内消息`);
  }
}

// --- 边界：thing 类型超长必须被截断，而不是原样发出去 ---
console.log('\n--- 边界检查 ---');

const LONG = '这是一条特别特别长的小事标题需要被截断成二十个字符以内否则微信会报错';
const longBuilt = buildTemplate(NotifyType.TASK_ASSIGNED, {
  ...CTX,
  thingTitle: LONG,
  thingContent: LONG,
});
for (const field of ['thing1', 'thing4']) {
  const v = longBuilt.subTemplateData?.[field]?.value ?? '';
  if (v.length > THING_MAX_LEN) {
    fail(`${field} 超长未截断（${v.length} > ${THING_MAX_LEN}）`);
  } else {
    console.log(`✅ ${field} 超长已截断为 ${v.length} 字：「${v}」`);
  }
}

// --- 边界：派活不设时间 → 订阅消息必须发不出去（已知产品缺口，不是 bug）---
const noTimeBuilt = buildTemplate(NotifyType.TASK_ASSIGNED, { ...CTX, dueAt: undefined });
if (noTimeBuilt.subTemplateData !== null || noTimeBuilt.subKind !== null) {
  fail('派活不设时间时，订阅消息应为 null（time23 必填，硬填会 47003）');
} else {
  console.log(
    '✅ 派活不设时间 → 订阅消息 subTemplateData = null（通道二自动跳过，降级站内）',
  );
  console.log('   ⚠️ 已知产品缺口，见 docs/未来需求池.md');
}
// 但公众号模板仍然要有 —— 主力通道不受影响
if (!noTimeBuilt.templateData) {
  fail('派活不设时间时，公众号模板不应受影响');
} else {
  console.log('✅ 派活不设时间 → 公众号模板照常产出（主力通道不受影响）');
}

// --- 边界：time 字段格式必须是 yyyy-MM-dd HH:mm ---
const timeFields: string[] = [];
for (const kind of SUB_TEMPLATE_KINDS) {
  const data = buildSubscribeData(kind, CTX);
  for (const [field, type] of Object.entries(SUB_TEMPLATE_SPECS[kind].fieldTypes)) {
    if (type !== 'time') continue;
    const v = data?.[field]?.value ?? '';
    timeFields.push(`${field}=${v}`);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) {
      fail(`${field} 时间格式不是 yyyy-MM-dd HH:mm：「${v}」`);
    }
  }
}
console.log(`✅ time 字段格式全部合规：${timeFields.join(' / ')}`);

// --- 交叉检查：subKindOf 与 buildTemplate 的映射必须一致 ---
for (const c of CASES) {
  if (subKindOf(c.type) !== c.subKind) {
    fail(`subKindOf(${NotifyType[c.type]}) 期望 ${c.subKind}，实际 ${subKindOf(c.type)}`);
  }
}

// ===============================================================
// 三、可直接粘贴到后台的内容
// ===============================================================

console.log('\n\n=== 三、可直接粘贴到「测试号后台 → 模板消息接口 → 新增测试模板」 ===');
for (const kind of Object.values(MpTemplateKind)) {
  const spec = MP_TEMPLATE_SPECS[kind];
  console.log(`\n【模板标题】${spec.name}`);
  console.log(`【模板内容】\n${spec.body}`);
  console.log(`【对应环境变量】${spec.envKey}`);
}

console.log(
  '\n\n=== 四、订阅消息后台对照表（公共模板库，只能挑选不能自建）===\n' +
    '| 场景 | 模板标题 | 模板编号 | 环境变量 | 字段 |\n' +
    '| --- | --- | --- | --- | --- |',
);
const subScene: Record<SubTemplateKind, string> = {
  [SubTemplateKind.TASK]: '派活',
  [SubTemplateKind.REMINDER]: '叮一下',
  [SubTemplateKind.DONE]: '完成回执',
};
for (const kind of SUB_TEMPLATE_KINDS) {
  const spec = SUB_TEMPLATE_SPECS[kind];
  console.log(
    `| ${subScene[kind]} | ${spec.name} | ${spec.number} | \`${spec.envKey}\` | ${spec.fields.join(' / ')} |`,
  );
}

console.log(`\n${failed === 0 ? '✅ 全部对齐' : `❌ ${failed} 处不匹配`}`);
process.exit(failed === 0 ? 0 : 1);
