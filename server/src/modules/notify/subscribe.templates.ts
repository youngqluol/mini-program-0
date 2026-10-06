import { NotifyType } from '@shared/enums';
// ⚠️ 必须是 `import type`：notify.templates.ts 会**值导入**本文件，
//    这里若值导入回去就成了运行时循环依赖。类型导入编译后被完全擦除，安全。
import type { TemplateContext } from './notify.templates';

/**
 * 小程序订阅消息模板定义 —— 与「mp.weixin.qq.com → 功能 → 订阅消息」后台一一对应。
 *
 * ⚠️ **与 `notify.templates.ts` 里的公众号模板完全不是一回事，不要互相抄：**
 *
 *   | 维度 | 订阅消息（本文件） | 公众号模板消息（notify.templates.ts） |
 *   | --- | --- | --- |
 *   | 后台在哪 | 小程序后台 `mp.weixin.qq.com` | 公众号（测试号）后台 |
 *   | 字段名 | **由公共模板库定死**（`thing1` / `time23`） | 可完全自定义（`first` / `keyword1`） |
 *   | 接收人 | **小程序 openid** | **公众号 openid**（两者无法互推） |
 *   | 额度 | 一次性，1 次授权 = 1 条 | 关注即可无限次 |
 *   | 环境变量 | `WX_TEMPLATE_*` | `MP_TEMPLATE_*` |
 *   | 用途 | 辅助通道（有额度就用） | 主力通道（wxpush） |
 *
 * 字段名错一个字母、少一个字段，微信都只回一个 `47003`，
 * **且不告诉你是哪个字段** —— 所以字段名只能从后台模板详情里抄，不能凭记忆写。
 *
 * 后台对照表（2026-10-06 建立，共 3 个）：
 *
 * | 场景 | 模板标题 | 模板编号 | 环境变量 | 字段 |
 * | --- | --- | --- | --- | --- |
 * | 派活 | 待办事项提醒 | 2983 | `WX_TEMPLATE_TASK` | thing1 / thing4 / thing22 / time23 |
 * | 叮一下 | 备忘事项提醒 | 10938 | `WX_TEMPLATE_NUDGE` | thing3 / time10 / thing6 |
 * | 完成回执 | 日程任务完成提醒 | 77364 | `WX_TEMPLATE_DONE` | thing1 / thing2 / time3 |
 */

// ---------------------------------------------------------------
// 模板规格
// ---------------------------------------------------------------

export enum SubTemplateKind {
  /** 待办事项提醒（派活用） */
  TASK = 'TASK',
  /** 备忘事项提醒（叮一下用） */
  REMINDER = 'REMINDER',
  /** 日程任务完成提醒（完成回执用） */
  DONE = 'DONE',
}

/**
 * 订阅消息字段类型 —— 决定微信侧的校验规则，也决定我们这边的组装方式。
 *
 * 本项目只用到 `thing` 与 `time` 两种：
 *   - `thing`  文本，**最多 20 个字符**，超长报 47003
 *   - `time`   时间，只接受 `yyyy-MM-dd HH:mm` 或 `yyyy年MM月dd日 HH:mm` 两种写法
 */
export type SubFieldType = 'thing' | 'time';

export interface SubTemplateSpec {
  /**
   * 后台模板标题 —— **只用于排查，绝不要给用户看**。
   *
   * ⚠️ 微信公共模板库给的标题里有禁用词（「待办事项提醒」的「待办事项」、
   *    「日程任务完成提醒」的「完成提醒」），而 AGENTS.md §6 明确禁止
   *    用户界面出现「待办事项」。所以对外一律用下面的 `displayName`。
   */
  name: string;
  /** 给用户看的名字（`templateName` 字段）—— 用产品自己的话，不带禁用词 */
  displayName: string;
  /** 后台「模板编号」（排查用，对不上就说明后台换了模板） */
  number: string;
  /** 从哪个环境变量读模板 ID */
  envKey: string;
  /** 该模板要求的字段名，**顺序与后台一致** */
  fields: readonly string[];
  /** 每个字段的类型 */
  fieldTypes: Record<string, SubFieldType>;
  /** 字段的中文含义（自检脚本打印对照表用） */
  labels: Record<string, string>;
  /**
   * 缺了就发不出去的字段。
   *
   * 之所以要单独列：微信对 `thing` 空值只是显示空白，但对 `time` 空值直接报错，
   * 而业务上「没有时间」是**合法**的（派活可以不设时间）。
   */
  required: readonly string[];
  /** 点击消息跳转的页面路径（不含 query） */
  page: string;
}

/** `thing` 类型字段的字符上限 —— 微信硬限制，超长直接 47003 */
export const THING_MAX_LEN = 20;

export const SUB_TEMPLATE_SPECS: Record<SubTemplateKind, SubTemplateSpec> = {
  [SubTemplateKind.TASK]: {
    name: '待办事项提醒',
    displayName: '派活提醒',
    number: '2983',
    envKey: 'WX_TEMPLATE_TASK',
    fields: ['thing1', 'thing4', 'thing22', 'time23'],
    fieldTypes: { thing1: 'thing', thing4: 'thing', thing22: 'thing', time23: 'time' },
    labels: {
      thing1: '事项主题',
      thing4: '事项描述',
      thing22: '提醒对象',
      time23: '提醒时间',
    },
    // time23 必填 —— 这正是「派活不设时间」时发不出订阅消息的原因
    required: ['thing1', 'time23'],
    page: 'pages/thing/detail',
  },

  [SubTemplateKind.REMINDER]: {
    name: '备忘事项提醒',
    displayName: '叮一下提醒',
    number: '10938',
    envKey: 'WX_TEMPLATE_NUDGE',
    fields: ['thing3', 'time10', 'thing6'],
    fieldTypes: { thing3: 'thing', time10: 'time', thing6: 'thing' },
    labels: {
      thing3: '备忘事项',
      time10: '事项时间',
      thing6: '相关人员',
    },
    required: ['thing3', 'time10'],
    page: 'pages/thing/detail',
  },

  [SubTemplateKind.DONE]: {
    name: '日程任务完成提醒',
    displayName: '完成回执',
    number: '77364',
    envKey: 'WX_TEMPLATE_DONE',
    fields: ['thing1', 'thing2', 'time3'],
    fieldTypes: { thing1: 'thing', thing2: 'thing', time3: 'time' },
    labels: {
      thing1: '备忘事项',
      thing2: '完成人',
      time3: '完成时间',
    },
    required: ['thing1', 'time3'],
    page: 'pages/thing/detail',
  },
};

/** 全部模板种类，按声明顺序 —— 自检脚本与额度池快照按这个顺序遍历 */
export const SUB_TEMPLATE_KINDS: readonly SubTemplateKind[] = [
  SubTemplateKind.TASK,
  SubTemplateKind.REMINDER,
  SubTemplateKind.DONE,
];

/**
 * 通知类型 → 订阅消息模板种类。
 *
 * 返回 `null` 表示**该类型没有对应的订阅消息模板**（例如「加入家庭」「系统通知」），
 * 通道二会直接跳过、降级到站内消息 —— 这是正常路径，不是错误。
 */
export function subKindOf(type: NotifyType): SubTemplateKind | null {
  switch (type) {
    case NotifyType.TASK_ASSIGNED:
      return SubTemplateKind.TASK;
    case NotifyType.REMINDER:
      return SubTemplateKind.REMINDER;
    case NotifyType.TASK_DONE:
      return SubTemplateKind.DONE;
    default:
      return null;
  }
}

// ---------------------------------------------------------------
// 数据组装
// ---------------------------------------------------------------

/**
 * 组装订阅消息的 `data`。
 *
 * @returns `null` 表示**这条订阅消息发不出去**（必填字段凑不齐），
 *          调用方应静默降级到站内消息，**不要**记成发送失败。
 *
 * ⚠️ 已知缺口：`time23` 是必填的 `time` 字段，而 `time` 只接受真实时间，
 *    塞「不限时间」四个字会直接 47003。所以**派活不设时间时，
 *    订阅消息通道一定发不出去**，只能靠公众号模板（主力通道）+ 站内消息兜底。
 *    详见 `docs/未来需求池.md`。
 */
export function buildSubscribeData(
  kind: SubTemplateKind,
  ctx: TemplateContext,
): Record<string, { value: string }> | null {
  const spec = SUB_TEMPLATE_SPECS[kind];
  const raw: Record<string, string> = {};

  switch (kind) {
    // -----------------------------------------------------------
    // 派活：阿妈派给阿爸一个活
    // -----------------------------------------------------------
    case SubTemplateKind.TASK: {
      const time = formatSubTimeOrNull(ctx.dueAt);
      // 不设时间的派活 → 这条通道直接放弃（见上方「已知缺口」）
      if (!time) return null;

      raw.thing1 = ctx.thingTitle || '家里有件小事';
      raw.thing4 =
        ctx.thingContent ||
        (ctx.fromRoleName ? `${ctx.fromRoleName}派给你的活儿` : '没什么特别的，就这一件事');
      raw.thing22 = ctx.roleName;
      raw.time23 = time;
      break;
    }

    // -----------------------------------------------------------
    // 叮一下：到了时间提醒一下
    // 立即叮的 remindAt 就是「现在」，所以这个模板永远发得出去
    // -----------------------------------------------------------
    case SubTemplateKind.REMINDER: {
      raw.thing3 = ctx.thingTitle || '家里有件事';
      raw.time10 = formatSubTimeOrNull(ctx.remindAt) ?? formatSubTime(new Date());
      raw.thing6 = ctx.fromRoleName ? `${ctx.fromRoleName} → ${ctx.roleName}` : ctx.roleName;
      break;
    }

    // -----------------------------------------------------------
    // 完成回执：给发起人一个轻反馈
    // -----------------------------------------------------------
    case SubTemplateKind.DONE: {
      raw.thing1 = ctx.thingTitle || '家里有件事';
      raw.thing2 = ctx.doneByRoleName || ctx.roleName;
      raw.time3 = formatSubTimeOrNull(ctx.doneAt) ?? formatSubTime(new Date());
      break;
    }
  }

  const data = pack(spec, raw);
  return isComplete(spec, data) ? data : null;
}

/** 按 `spec.fields` 的顺序取值，并对 `thing` 类型统一截断 */
function pack(
  spec: SubTemplateSpec,
  raw: Record<string, string>,
): Record<string, { value: string }> {
  const out: Record<string, { value: string }> = {};
  for (const field of spec.fields) {
    const value = raw[field] ?? '';
    out[field] =
      spec.fieldTypes[field] === 'thing'
        ? { value: truncateThing(value) }
        : { value: value || '—' };
  }
  return out;
}

/** 必填字段全部非空、且非占位符才算组装成功 */
function isComplete(
  spec: SubTemplateSpec,
  data: Record<string, { value: string }>,
): boolean {
  return spec.required.every((f) => {
    const v = data[f]?.value;
    return typeof v === 'string' && v.length > 0 && v !== '—';
  });
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

/**
 * `thing` 类型字段的截断。
 *
 * 超长微信报 47003，**不会自动截断**，所以必须我们自己截。
 * 截断时用省略号收尾，保证总长度正好 `max`。
 */
export function truncateThing(s: string, max: number = THING_MAX_LEN): string {
  const v = (s ?? '').trim();
  if (!v) return '—';
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}

/**
 * 格式化成订阅消息 `time` 字段要求的 `yyyy-MM-dd HH:mm`。
 *
 * 全链路统一北京时间（`TZ=Asia/Shanghai`），所以直接用本地 getter，
 * **不要再转 UTC**（存储层才是 UTC，接口层之后一律北京时间）。
 *
 * ⚠️ 微信只认 `yyyy-MM-dd HH:mm` 和 `yyyy年MM月dd日 HH:mm` 两种写法，
 *    所以不要复用 `formatMpTime()` —— 那个产出的是「今天 18:00」这种口语，
 *    给公众号模板用正好，给订阅消息用直接 47003。
 */
export function formatSubTime(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

/** 同上，但入参可空；时间无效时返回 `null`（调用方据此判断「发不出去」） */
export function formatSubTimeOrNull(d: Date | undefined | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return formatSubTime(d);
}

/** 跳转路径，带上小事 ID（订阅消息的 `page` 不支持跳转 tabBar 页） */
export function subPageOf(kind: SubTemplateKind, thingId?: bigint | number | null): string {
  const base = SUB_TEMPLATE_SPECS[kind].page;
  return thingId != null ? `${base}?id=${thingId}` : base;
}

// ---------------------------------------------------------------
// 自检
// ---------------------------------------------------------------

export interface SubValidateResult {
  ok: boolean;
  /** 后台有、代码没产出 */
  missing: string[];
  /** 代码产出、后台没有 */
  extra: string[];
  /** 产出了但不符合微信校验规则的字段 */
  invalid: string[];
}

/**
 * 校验订阅消息数据是否与后台模板完全对齐。
 *
 * 与 `validateTemplateData()` 的区别：这里额外校验**字段类型规则**
 * （`thing` ≤ 20 字、`time` 格式正确），因为订阅消息的模板是公共模板库的，
 * 字段名对了但值超长一样是 47003。
 */
export function validateSubscribeData(
  kind: SubTemplateKind,
  data: Record<string, { value: string }> | null,
): SubValidateResult {
  const spec = SUB_TEMPLATE_SPECS[kind];
  const expected = new Set(spec.fields);
  const actual = new Set(Object.keys(data ?? {}));

  const missing = [...expected].filter((f) => !actual.has(f));
  const extra = [...actual].filter((f) => !expected.has(f));

  const invalid: string[] = [];
  for (const field of spec.fields) {
    const v = data?.[field]?.value ?? '';
    if (spec.fieldTypes[field] === 'thing') {
      if (v.length > THING_MAX_LEN) invalid.push(`${field} 超过 ${THING_MAX_LEN} 字`);
    } else if (spec.fieldTypes[field] === 'time') {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) {
        invalid.push(`${field} 时间格式应为 yyyy-MM-dd HH:mm，实际「${v}」`);
      }
    }
  }

  return { ok: !missing.length && !extra.length && !invalid.length, missing, extra, invalid };
}
