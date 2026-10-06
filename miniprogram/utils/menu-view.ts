/**
 * 吃啥呢 → 展示模型（P02 随机卡片 / 最近吃过 / 底部确认层 · P17 菜谱行）
 *
 * 与 `thing-view.ts` 同一个理由：后端给了三种形状（随机推荐 / 列表行 / 最近吃过），
 * 字段名不同、语义相同。如果页面各自拼展示字段，「分类没有时怎么显示」
 * 「系统菜谱为什么不能改」就会在 P02 与 P17 各写一遍，然后慢慢漂移。
 *
 * 所以：**归一化只做一次**，页面只负责「取数据 → setData → 绑事件」。
 *
 * ⚠️ 这里所有函数都是**纯函数**（`inferMealType` 要传 `now`，不自己读时钟），
 *    好让 `tools/test-view.mjs` 能把边界情况钉住。
 */

import type {
  MealTypeValue,
  MenuItemBrief,
  MenuItemRow,
  MenuSourceValue,
  RecentMealGroup,
} from '@shared/dto/menu';
import {
  CATEGORY_EMOJI,
  CATEGORY_EMOJI_FALLBACK,
  MEAL_TYPE_SHORT,
  MEAL_TYPE_WORD,
} from '../constants/menu';

/** 分类 → emoji，取不到时用中性兜底（不假装知道是荤是素） */
function emojiOf(category: string): string {
  return CATEGORY_EMOJI[category] || CATEGORY_EMOJI_FALLBACK;
}

// =============================================================
// P02 随机卡片
// =============================================================

export interface DishCardView {
  name: string;
  /** 分类文字；没有分类时是空串（卡片上那一行就不显示） */
  category: string;
  emoji: string;
  /** 系统菜谱恒为 `null` */
  id: number | null;
  source: MenuSourceValue;
}

export function buildDishCard(item: MenuItemBrief): DishCardView {
  const category = (item.category || '').trim();
  return {
    name: item.name,
    category,
    emoji: emojiOf(category),
    id: item.id,
    source: item.source,
  };
}

export function buildDishCards(items: MenuItemBrief[]): DishCardView[] {
  return (items || []).map(buildDishCard);
}

// =============================================================
// P02 最近吃过
// =============================================================

export interface RecentMealRow {
  /** 「9/27 晚」 */
  dateText: string;
  /** 「红烧肉 · 紫菜蛋花汤」 */
  namesText: string;
}

/**
 * 菜名之间用 ` · ` 连接（与 docs/03 P02 的草图一致）。
 *
 * 用间隔号而不是顿号：顿号读起来是「同一道菜里的几种东西」，
 * 间隔号读起来是「并列的几道菜」—— 这里正是后者。
 */
export function describeMealNames(names: string[]): string {
  return (names || []).filter((n) => !!n).join(' · ');
}

/**
 * 「9/27 晚」。
 *
 * 刻意不带年份（最近吃过最多看 90 天，跨年的那几天写「1/3」也不会歧义）；
 * `OTHER` 餐次没有短名，就只说日期，不说「9/27 其他」。
 * 日期格式不认识时原样透出，不吞掉。
 */
export function describeMealDate(mealDate: string, mealType: MealTypeValue): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mealDate || '');
  const md = m ? `${Number(m[2])}/${Number(m[3])}` : mealDate || '';
  const short = MEAL_TYPE_SHORT[mealType] || '';
  return [md, short].filter(Boolean).join(' ');
}

export function buildRecentMealRow(group: RecentMealGroup): RecentMealRow {
  return {
    dateText: describeMealDate(group.mealDate, group.mealType),
    namesText: describeMealNames(group.names),
  };
}

// =============================================================
// P02 「就吃这个」的底部确认层
// =============================================================

export interface AssignChoice {
  /** `0` 表示「不用派，自己解决」 */
  memberId: number;
  label: string;
  kind: 'assign' | 'skip';
}

/**
 * 确认层的选项。
 *
 * **刻意用页面自己的底部面板，而不是 `wx.showActionSheet`** ——
 * 后者最多 6 个选项，家庭成员一多就选不全（而且它没法在选项上方
 * 排一栏「这一餐是什么」）。所以这里返回一个**普通数组**，
 * 页面用 `wx:for` 渲染，成员数不受限。
 *
 * 顺序就是家庭成员顺序（与 P08 / P09 的成员选择器一致），
 * 最后一项固定是「不用派，自己解决」。
 */
export function buildAssignChoices(
  members: Array<{ memberId: number; roleName: string }>,
  myMemberId: number,
): AssignChoice[] {
  const choices: AssignChoice[] = (members || []).map((m) => ({
    memberId: m.memberId,
    // 派给自己时不说「派给阿爸」—— 那会让人以为在派给别的长辈
    label: m.memberId === myMemberId ? '我自己来' : `派给${m.roleName}`,
    kind: 'assign' as const,
  }));

  choices.push({ memberId: 0, label: '不用派，自己解决', kind: 'skip' });
  return choices;
}

/**
 * 派活成功后的 toast。
 *
 * 派给自己与派给别人的说法不一样 —— 后者才有「送到了」这层意思
 * （与 P09 的 `doneToast()` 同一套判断）。
 */
export function assignDoneToast(
  roleName: string,
  isSelf: boolean,
  mealType: MealTypeValue,
): string {
  if (isSelf) return '自己的饭，记下啦～';
  return `已经派给${roleName}啦，${MEAL_TYPE_WORD[mealType] || '这顿'}有口福～`;
}

// =============================================================
// 这一餐是哪一餐
// =============================================================

/**
 * 按当前时刻猜这一餐 —— 决定随机时要不要凑「一荤一素一汤」，
 * 也决定记进 `meal_records` 的餐次。
 *
 * 边界是**刻意拍的**（不是从需求推出来的），只求「符合直觉」：
 * 10 点前算早饭，15 点前算午饭，21 点前算晚饭，之后算「其他」。
 * 传 `now` 而不是自己读时钟 —— 否则 `test-view.mjs` 没法钉住边界。
 */
export function inferMealType(now: Date): MealTypeValue {
  const h = now.getHours();
  if (h < 10) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  if (h < 21) return 'DINNER';
  return 'OTHER';
}

// =============================================================
// P17 菜谱行
// =============================================================

export type MenuRowActionKey = 'EDIT' | 'TOGGLE';

export interface MenuRowAction {
  key: MenuRowActionKey;
  label: string;
  tone: 'normal' | 'danger';
}

export interface MenuItemRowView {
  /** `wx:key` 用。系统菜谱没有 id，用 `s:` + 菜名（系统库内菜名唯一，编译器强制） */
  key: string;
  /** 系统菜谱为 `0`（`swipe-cell` 的 `itemId` 是 Number，不接受 null） */
  id: number;
  name: string;
  category: string;
  emoji: string;
  source: MenuSourceValue;
  enabled: boolean;
  canEdit: boolean;
  /** 停用后整行置灰 —— 它还在列表里（否则用户找不到它去重新启用），只是不进随机池 */
  dim: boolean;
  /** 左滑露出的操作；**空数组表示这一行不可滑** */
  actions: MenuRowAction[];
}

/**
 * P17 的一行。
 *
 * ⚠️ **系统菜谱（`canEdit=false`）没有 `id`，也就没有任何操作** ——
 * 它们不在库里，改不了、也停不了。给它们一个滑不动的抽屉不如直接不给，
 * 所以 `actions` 是空数组（`swipe-cell` 见到空数组会完全不响应手势）。
 *
 * 「删除」这个词刻意不用：停用是**可逆**的，而且记录（`meal_records`）都留着，
 * 叫「删除」会让用户以为这道菜的历史也没了。
 */
export function buildMenuItemRowView(row: MenuItemRow): MenuItemRowView {
  const category = (row.category || '').trim();
  const canEdit = row.canEdit === true && row.id != null;

  const actions: MenuRowAction[] = [];
  if (canEdit) {
    // 「编辑」而不是「改名」：点进去既能改名字也能改分类，
    // 只写「改名」会让用户以为分类改不了
    actions.push({ key: 'EDIT', label: '编辑', tone: 'normal' });
    actions.push({
      key: 'TOGGLE',
      label: row.enabled ? '停用' : '启用',
      // 停用会把它从随机池里拿掉，算「有后果」的操作，单独染色
      tone: row.enabled ? 'danger' : 'normal',
    });
  }

  return {
    key: row.id != null ? `f:${row.id}` : `s:${row.name}`,
    id: row.id ?? 0,
    name: row.name,
    category,
    emoji: emojiOf(category),
    source: row.source,
    enabled: row.enabled,
    canEdit,
    dim: !row.enabled,
    actions,
  };
}

/**
 * 拆成「系统菜谱 / 我家菜谱」两组。
 *
 * **顺序照搬接口**（docs/02 §6.2：系统在前按分类分组、家庭在后按 `sort_no`）——
 * 后端已经排好了，前端再排一次只会制造不一致。这里只做分组，不排序。
 */
export function splitMenuGroups(rows: MenuItemRow[]): {
  system: MenuItemRowView[];
  family: MenuItemRowView[];
} {
  const system: MenuItemRowView[] = [];
  const family: MenuItemRowView[] = [];

  (rows || []).forEach((row) => {
    const view = buildMenuItemRowView(row);
    (row.source === 'SYSTEM' ? system : family).push(view);
  });

  return { system, family };
}
