/**
 * 小事的展示元数据（emoji / 状态文案）
 *
 * 收口理由：同一个「🎯 派活」在首页、列表、详情、消息中心都会出现，
 * 散落四份就会漂移成「派活 / 派个活 / 派活儿」。**唯一来源放这里。**
 *
 * ⚠️ 文案纪律（AGENTS.md §6）：这里的每一个词都会直接出现在用户眼前，
 *    不许出现「待办 / 逾期 / 超时 / 审批 / 流程」这类词。
 *    `PENDING` 说成「待完成」而不是「待办」—— 前者是状态，后者像工单。
 */

import type { ThingStatusValue, ThingTypeValue } from '@shared/dto/thing';

export interface ThingTypeMeta {
  /** 卡片左侧或标题前的 emoji */
  emoji: string;
  /** 用在标题、详情页顶部的名字 */
  label: string;
}

export const THING_TYPE_META: Record<ThingTypeValue, ThingTypeMeta> = {
  TASK: { emoji: '🎯', label: '派活' },
  REMINDER: { emoji: '🔔', label: '叮一下' },
};

export const THING_STATUS_LABEL: Record<ThingStatusValue, string> = {
  PENDING: '待完成',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

/** 执行人取不到时的兜底文案 —— 中性陈述，不是「失败」 */
export const NO_ASSIGNEE_TEXT = '还没人接';
