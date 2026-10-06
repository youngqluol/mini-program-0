import { NotifyType } from '@shared/enums';
import {
  buildSubscribeData,
  SubTemplateKind,
  subKindOf,
} from './subscribe.templates';

/**
 * 通知文案组装。
 *
 * ⚠️ 这里是**产品文案的唯一定义处**，不要在别处再写一遍。
 *
 * 文案纪律（PRD 3.5 / 31.3）：
 *   ✅ 有人情味：「阿妈，有个活儿到你啦～」
 *   ❌ 机械通知：「您有任务待完成」
 *   ❌ 禁止出现：逾期、超时、待办、审批、流程、KPI、催办、监督、绩效
 */

// ---------------------------------------------------------------
// 公众号模板定义
// ---------------------------------------------------------------

/**
 * 公众号模板种类 —— 与「微信公众平台接口测试号」后台的模板一一对应。
 *
 * ⚠️ **字段名必须与后台模板内容严格一致，否则微信返回 47003。**
 *    下面 `body` 里的内容就是**应该粘贴到后台的模板内容原文**，
 *    两边由这里统一约束，不要各写各的。
 */
export enum MpTemplateKind {
  /** 待办事项提醒（派活用） */
  TASK = 'TASK',
  /** 备忘事项提醒（叮一下用） */
  REMINDER = 'REMINDER',
  /** 日程任务完成提醒（完成回执用） */
  DONE = 'DONE',
}

export interface MpTemplateSpec {
  /** 后台模板标题（仅作文档与排查用） */
  name: string;
  /** 从哪个环境变量读模板 ID */
  envKey: string;
  /** 该模板要求的字段名 */
  fields: readonly string[];
  /** 后台「模板内容」应粘贴的原文 */
  body: string;
}

export const MP_TEMPLATE_SPECS: Record<MpTemplateKind, MpTemplateSpec> = {
  [MpTemplateKind.TASK]: {
    name: '待办事项提醒',
    envKey: 'MP_TEMPLATE_TASK',
    fields: ['first', 'keyword1', 'keyword2', 'keyword3', 'keyword4', 'remark'],
    body: [
      '{{first.DATA}}',
      '事项主题：{{keyword1.DATA}}',
      '事项描述：{{keyword2.DATA}}',
      '提醒对象：{{keyword3.DATA}}',
      '提醒时间：{{keyword4.DATA}}',
      '{{remark.DATA}}',
    ].join('\n'),
  },

  [MpTemplateKind.REMINDER]: {
    name: '备忘事项提醒',
    envKey: 'MP_TEMPLATE_REMINDER',
    fields: ['first', 'keyword1', 'keyword2', 'keyword3', 'remark'],
    body: [
      '{{first.DATA}}',
      '备忘事项：{{keyword1.DATA}}',
      '事项时间：{{keyword2.DATA}}',
      '相关人员：{{keyword3.DATA}}',
      '{{remark.DATA}}',
    ].join('\n'),
  },

  [MpTemplateKind.DONE]: {
    name: '日程任务完成提醒',
    envKey: 'MP_TEMPLATE_DONE',
    fields: ['first', 'keyword1', 'keyword2', 'keyword3', 'remark'],
    body: [
      '{{first.DATA}}',
      '备忘事项：{{keyword1.DATA}}',
      '完成人：{{keyword2.DATA}}',
      '完成时间：{{keyword3.DATA}}',
      '{{remark.DATA}}',
    ].join('\n'),
  },
};

/**
 * 通知类型 → 公众号模板种类。
 *
 * 返回 `null` 表示**该类型没有对应的公众号模板**，通道一会直接跳过、
 * 降级到订阅消息 / 站内消息（这是正常路径，不是错误）。
 */
export function mpKindOf(type: NotifyType): MpTemplateKind | null {
  switch (type) {
    case NotifyType.TASK_ASSIGNED:
      return MpTemplateKind.TASK;
    case NotifyType.REMINDER:
      return MpTemplateKind.REMINDER;
    case NotifyType.TASK_DONE:
      return MpTemplateKind.DONE;
    // 加入家庭 / 系统通知：没有对应模板，走订阅消息 + 站内
    default:
      return null;
  }
}

// ---------------------------------------------------------------
// 文案组装
// ---------------------------------------------------------------

export interface TemplateContext {
  /** 接收人的家庭称谓，例如「阿妈」「阿爸」「阿公」 */
  roleName: string;
  /** 家庭名称 */
  familyName?: string;
  /** 事项标题，例如「记得买酱油」 */
  thingTitle?: string;
  /** 事项描述（可选，长文本） */
  thingContent?: string;
  /** 发起人的家庭称谓 */
  fromRoleName?: string;
  /** 要求完成时间（派活） */
  dueAt?: Date;
  /** 提醒时间（叮一下） */
  remindAt?: Date;
  /** 完成时间（完成回执） */
  doneAt?: Date;
  /** 完成人的家庭称谓 */
  doneByRoleName?: string;
}

export interface BuiltTemplate {
  /** 通知标题（站内消息 / 消息中心用） */
  title: string;
  /** 纯文本正文（站内消息用） */
  content: string;
  /** 公众号模板数据；无对应模板时为 null */
  templateData: Record<string, { value: string }> | null;
  /** 公众号模板种类；无对应模板时为 null */
  mpKind: MpTemplateKind | null;
  /**
   * 订阅消息模板数据；**发不出去时为 null**（字段凑不齐，例如派活没设时间）。
   * 通道二据此决定跳过，静默降级到站内消息。
   */
  subTemplateData: Record<string, { value: string }> | null;
  /** 订阅消息模板种类；发不出去或该类型无模板时为 null */
  subKind: SubTemplateKind | null;
}

/**
 * 组装一条通知 —— **公众号模板 + 订阅消息 + 站内文案，一次全出**。
 *
 * 为什么三份一起出：通道选择是 notify.service 的事，而文案是这里的事。
 * 分开组装会让「通道降级」变成「文案重新拼一遍」，两边迟早不一致。
 *
 * 公众号文案结构统一为：
 *   first    —— 有人情味的开头，带上对方称谓
 *   中间字段 —— 事项 / 时间 / 相关人员
 *   remark   —— 结尾，**永远不带催促**
 *
 * 订阅消息的字段名由公共模板库定死，组装逻辑见 `subscribe.templates.ts`；
 * 这里只负责「取哪种模板」和「取到了没有」。
 */
export function buildTemplate(type: NotifyType, ctx: TemplateContext): BuiltTemplate {
  const {
    roleName,
    familyName = '',
    thingTitle = '',
    thingContent = '',
    fromRoleName = '',
    doneByRoleName = '',
  } = ctx;

  const mpKind = mpKindOf(type);

  let title = '';
  let content = '';
  let fields: Record<string, string> | null = null;

  switch (type) {
    // -----------------------------------------------------------
    // 派活：阿妈派给阿爸一个活
    // -----------------------------------------------------------
    case NotifyType.TASK_ASSIGNED: {
      const time = formatMpTime(ctx.dueAt) ?? '不限时间';
      const first = `${roleName}，有个活儿到你啦～`;
      const remark = '有空的时候弄一下就行 😊';

      title = '有个活儿到你啦';
      content = [
        first,
        `事项：${thingTitle || '—'}`,
        `时间：${time}`,
        fromRoleName ? `来自：${fromRoleName}` : '',
        remark,
      ]
        .filter(Boolean)
        .join('\n');

      fields = {
        first,
        keyword1: thingTitle || '—',
        keyword2: thingContent || '没什么特别的，就这一件事',
        keyword3: roleName,
        keyword4: time,
        remark,
      };
      break;
    }

    // -----------------------------------------------------------
    // 叮一下：到了时间提醒一下
    // -----------------------------------------------------------
    case NotifyType.REMINDER: {
      const time = formatMpTime(ctx.remindAt) ?? '现在';
      const first = `${roleName}，别忘了这件事`;
      const remark = '到时候了，提醒你一下～';

      title = '提醒你一下';
      content = [
        first,
        `事项：${thingTitle || '—'}`,
        `时间：${time}`,
        fromRoleName ? `来自：${fromRoleName}` : '',
        remark,
      ]
        .filter(Boolean)
        .join('\n');

      fields = {
        first,
        keyword1: thingTitle || '—',
        keyword2: time,
        keyword3: fromRoleName ? `${fromRoleName} → ${roleName}` : roleName,
        remark,
      };
      break;
    }

    // -----------------------------------------------------------
    // 完成回执：给发起人一个轻反馈
    // ⚠️ 是「搞定啦」，不是「任务已完成」
    // -----------------------------------------------------------
    case NotifyType.TASK_DONE: {
      const who = doneByRoleName || roleName;
      const time = formatMpTime(ctx.doneAt) ?? formatMpTime(new Date())!;
      const first = `${who}把「${thingTitle}」弄好啦`;
      const remark = '辛苦啦 🎉';

      title = '有件事弄好啦';
      content = [first, `事项：${thingTitle || '—'}`, `完成人：${who}`, remark]
        .filter(Boolean)
        .join('\n');

      fields = {
        first,
        keyword1: thingTitle || '—',
        keyword2: who,
        keyword3: time,
        remark,
      };
      break;
    }

    // -----------------------------------------------------------
    // 加入家庭 / 系统通知：无公众号模板，只出站内文案
    // -----------------------------------------------------------
    case NotifyType.JOIN_FAMILY: {
      title = '欢迎加入';
      content = [
        `欢迎加入「${familyName || '这个家'}」`,
        fromRoleName ? `邀请人：${fromRoleName}` : '',
        '以后家里的事都在这儿说～',
      ]
        .filter(Boolean)
        .join('\n');
      break;
    }

    case NotifyType.SYSTEM:
    default: {
      title = '家里有个消息';
      content = [`${roleName}，家里有个消息`, thingTitle || '', '有空看一下～']
        .filter(Boolean)
        .join('\n');
      break;
    }
  }

  // 订阅消息的字段名由公共模板库定死（thing1 / time23…），组装逻辑在
  // subscribe.templates.ts。这里只负责「拿哪种模板」，不重复实现。
  const subKind = subKindOf(type);
  const subTemplateData = subKind ? buildSubscribeData(subKind, ctx) : null;

  return {
    title,
    content,
    templateData: fields ? toTemplateData(fields) : null,
    mpKind: fields ? mpKind : null,
    subTemplateData,
    // 数据组装失败（字段凑不齐）时一并把 kind 置空，通道二一眼就能跳过
    subKind: subTemplateData ? subKind : null,
  };
}

// ---------------------------------------------------------------
// 工具
// ---------------------------------------------------------------

function toTemplateData(fields: Record<string, string>): Record<string, { value: string }> {
  const out: Record<string, { value: string }> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = { value: value || '—' };
  }
  return out;
}

/**
 * 校验模板数据是否与后台模板字段完全对齐。
 *
 * 开发期自检用：字段多了会被微信忽略，**少了直接 47003**。
 * 部署后可用它写一个 `/health/templates` 自检接口。
 */
export function validateTemplateData(
  kind: MpTemplateKind,
  data: Record<string, { value: string }> | null,
): { ok: boolean; missing: string[]; extra: string[] } {
  const expected = new Set(MP_TEMPLATE_SPECS[kind].fields);
  const actual = new Set(Object.keys(data ?? {}));
  const missing = [...expected].filter((f) => !actual.has(f));
  const extra = [...actual].filter((f) => !expected.has(f));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/**
 * 把时间格式化成中文口语。
 *
 * 全链路统一北京时间（TZ=Asia/Shanghai），所以直接用本地 getter 即可，不转 UTC。
 *   今天 → 「今天 18:00」
 *   明天 → 「明天 18:00」
 *   其他 → 「10月8日 18:00」
 */
export function formatMpTime(d: Date | undefined | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;

  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();

  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hm}`;

  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
