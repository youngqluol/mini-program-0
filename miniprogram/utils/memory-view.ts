/**
 * 留个念 → 展示模型（P03 时间线卡片 · P18 发布页 · P19 详情 · P01 预览卡片）
 *
 * 与 `thing-view.ts` / `menu-view.ts` 同一个理由：后端的 `MemoryItem` 是**数据**，
 * 页面上要的是**文字**。如果 P03 与 P19 各自把 `createdAt` 切一遍、
 * 各自拼一次「来自 🎯 xx」，两处的措辞迟早不一致。
 *
 * 所以：**归一化只做一次**，页面只负责「取数据 → setData → 绑事件」。
 *
 * ⚠️ 这里所有函数都是**纯函数**（不读时钟、不发请求），
 *    好让 `tools/test-view.mjs` 把边界情况钉住。
 */

import type { MemoryItem, MemoryThingRef, MemoryVisibilityValue } from '@shared/dto/memory';
import { MEMORY_LIMITS } from '../constants/memory';

/**
 * 一条记录最多显示几张图。
 *
 * **从镜像常量取**，不在这里再写一个 `9` —— 后端限制、前端九宫格、
 * 后端 DTO 校验必须永远同步（见 `constants/memory.ts` 头部）。
 */
export const MAX_PHOTO_GRID = MEMORY_LIMITS.MAX_ATTACHMENTS;

/** 首页预览卡片上那句话的长度上限 —— 再长就被卡片截掉了 */
const PREVIEW_MAX = 18;

// =============================================================
// 日期与时间
// =============================================================

/**
 * `"2026-09-28"` → `"2026.09.28"`（docs/03 P03 的草图用的就是点号）。
 *
 * 为什么不像「最近吃过」那样省掉年份：时间线是**长期**的，
 * 一条三年前的记录写「9/28」会让人以为是今年。
 * 格式不认识时原样透出，不吞掉 —— 宁可显示得丑，也不要显示成空。
 */
export function describeMemoryDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  return m ? `${m[1]}.${m[2]}.${m[3]}` : date || '';
}

/** `"2026-09-28 19:32:00"` → `"19:32"`。卡片右下角那行「阿妈 · 19:32」用 */
export function describeMemoryTime(createdAt: string): string {
  const m = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.exec(createdAt || '');
  return m ? m[0].slice(11, 16) : '';
}

/**
 * 头像为空时的兜底 —— 取称谓首字。
 *
 * 与 `member-picker` 的写法一致：`'家'` 而不是空字符串。
 * 家里人的称谓至少有一个字（后端强制非空），所以这里几乎不会走到兜底。
 */
export function initialOf(roleName: string): string {
  const name = (roleName || '').trim();
  return name ? name.slice(0, 1) : '家';
}

// =============================================================
// 可见范围
// =============================================================

/**
 * 可见范围的人话。
 *
 * ⚠️ **不要写成「公开 / 私密」** —— 那听起来像是在跟陌生人比。
 * 这里只有两种人：家里人，和自己。
 */
export function describeVisibility(v: MemoryVisibilityValue): string {
  return v === 'PRIVATE' ? '只有我' : '家里人都能看到';
}

export interface VisibilityOption {
  value: MemoryVisibilityValue;
  label: string;
  /** 选中后那行小字解释 —— 让用户不用猜「家里人都能看到」包不包括自己 */
  hint: string;
}

/** P18 底部的「谁能看见？」两个选项。顺序固定：先说常见的那个 */
export function buildVisibilityOptions(): VisibilityOption[] {
  return [
    { value: 'FAMILY', label: '家里人都能看到', hint: '阿爸、阿妈他们都能翻到这条' },
    { value: 'PRIVATE', label: '只有我', hint: '只存在你自己的时间线里' },
  ];
}

// =============================================================
// 「完成纪念」的关联标注
// =============================================================

/**
 * 详情页底部那行极淡的标注（PRD §19.3）：`来自 🎯 买牛奶`。
 *
 * 独立留念返回**空串**（那一行整个不渲染）。
 *
 * ⚠️ 时间线上**不做视觉区分** —— 一旦区分，时间线就滑向「任务日志」，
 *    违背 PRD §18.1 的定位。所以只有详情页用这个函数。
 */
export function describeThingRef(thing: MemoryThingRef | null): string {
  if (!thing || !thing.title) return '';
  return `来自 🎯 ${thing.title}`;
}

// =============================================================
// P03 时间线卡片
// =============================================================

export interface MemoryCardView {
  id: number;
  /** `"2026.09.28"` */
  dateText: string;
  /** `"19:32"` */
  timeText: string;
  content: string;
  /** 九宫格里要显示的图片 URL（最多 9 张） */
  photos: string[];
  /** 超过 9 张时的「+N」（后端已限制 9，这里是防御性保留） */
  moreCount: number;
  creatorName: string;
  avatarUrl: string;
  /** 头像为空时的兜底字 */
  avatarText: string;
  /** 是不是我发的 —— 决定要不要显示「···」 */
  isMine: boolean;
  /** 仅自己可见 —— 卡片上给一个小标记，免得用户以为别人也看得到 */
  isPrivate: boolean;
}

export function buildMemoryCard(item: MemoryItem): MemoryCardView {
  const attachments = item.attachments || [];
  const creator = item.creator || { memberId: 0, roleName: '家人', avatarUrl: null };

  return {
    id: item.id,
    dateText: describeMemoryDate(item.date),
    timeText: describeMemoryTime(item.createdAt),
    content: item.content || '',
    photos: attachments.slice(0, MAX_PHOTO_GRID).map((a) => a.fileUrl),
    moreCount: Math.max(0, attachments.length - MAX_PHOTO_GRID),
    creatorName: creator.roleName,
    avatarUrl: creator.avatarUrl || '',
    avatarText: initialOf(creator.roleName),
    isMine: item.isMine === true,
    isPrivate: item.visibility === 'PRIVATE',
  };
}

export interface MemoryDayGroup {
  /** `"2026.09.28"` */
  dateText: string;
  items: MemoryCardView[];
}

/**
 * 按「日」分组（docs/03 P03：按日期分组，时间倒序）。
 *
 * **顺序照搬接口**（后端已按 id 倒序 = 时间倒序），这里只做分组、不排序 ——
 * 前端再排一次只会制造不一致。
 */
export function groupByDay(items: MemoryItem[]): MemoryDayGroup[] {
  const groups: MemoryDayGroup[] = [];
  let current: MemoryDayGroup | null = null;

  (items || []).forEach((item) => {
    const dateText = describeMemoryDate(item.date);
    if (!current || current.dateText !== dateText) {
      current = { dateText, items: [] };
      groups.push(current);
    }
    current.items.push(buildMemoryCard(item));
  });

  return groups;
}

/**
 * 把新一页的分组并进已有分组 —— **只在边界上合并同一天**。
 *
 * 为什么需要它：分页会把同一天拆到两页（第一页末尾是 9/26，第二页开头也是 9/26）。
 * 直接把新分组追加到数组末尾，时间线上就会出现**两个「2026.09.26」**。
 * 而这一点在本地测试里很容易漏 —— 数据少的时候一页就装完了，
 * 只有真的翻到边界才会看到。
 *
 * 只比**边界那一组**，不做全量去重：接口保证了「不重复、不遗漏」，
 * 前端再全量扫一遍只会掩盖接口的问题。
 */
export function appendGroups(
  existing: MemoryDayGroup[],
  incoming: MemoryDayGroup[],
): MemoryDayGroup[] {
  if (!existing || existing.length === 0) return incoming || [];
  if (!incoming || incoming.length === 0) return existing;

  const merged = existing.slice();
  const last = merged[merged.length - 1];
  const first = incoming[0];

  if (last.dateText === first.dateText) {
    merged[merged.length - 1] = {
      dateText: last.dateText,
      items: last.items.concat(first.items),
    };
    return merged.concat(incoming.slice(1));
  }

  return merged.concat(incoming);
}

// =============================================================
// P18 发布页
// =============================================================

/** 草稿（页面 data 里那几项）能不能发 */
export function draftCanPublish(draft: { content: string; photoCount: number }): boolean {
  const text = (draft.content || '').trim();
  return text.length > 0 || draft.photoCount > 0;
}

/** 发布成功后的 toast。私密那一条要说清「别人看不到」，否则用户会不放心 */
export function publishDoneToast(visibility: MemoryVisibilityValue): string {
  return visibility === 'PRIVATE' ? '记下啦，只有你自己能看到' : '记下啦～';
}

/** 编辑保存后的 toast。与发布分开，因为编辑不该再说「记下啦」 */
export function editDoneToast(): string {
  return '改好啦';
}

/**
 * 有图片没传上去时的提示。
 *
 * 说清「第几张」和「怎么办」—— 只说「上传失败」用户只能全删重来。
 */
export function photoUploadHint(failedCount: number): string {
  if (failedCount <= 0) return '';
  return failedCount === 1
    ? '有 1 张没传上去，点它重试'
    : `有 ${failedCount} 张没传上去，点它们重试`;
}

/** 发布页顶部「来自 🎯 买牛奶」那个关联标记（PRD §19.2 的预填） */
export function describeThingBanner(thingTitle: string): string {
  return thingTitle ? `来自 🎯 ${thingTitle}` : '';
}

/**
 * 「完成纪念」的正文预填：`买牛奶 搞定啦`（PRD §19.2）。
 *
 * 可改 —— 这只是省一次打字，不是固定格式。
 */
export function prefillContent(thingTitle: string): string {
  const title = (thingTitle || '').trim();
  return title ? `${title} 搞定啦` : '';
}

// =============================================================
// 空状态与首页预览
// =============================================================

/** P03 的空状态（docs/03 P03 原文） */
export function emptyTimelineHint(): string {
  return '这里还空空的，记点什么吧 📖';
}

/**
 * P01 那张「留个念」跳转卡片的副标题（M4-11）。
 *
 * 没有记录时说「还没有记录」；有的话用最新一条 ——
 * 卡片上放不下整段，截断到 `PREVIEW_MAX` 个字并加省略号。
 * 只有图片没有文字时**不拼一个空句子**，直接说「记了一张照片」。
 */
export function describeLatestMemory(item: MemoryItem | null): string {
  if (!item) return '还没有记录';

  const who = (item.creator && item.creator.roleName) || '家人';
  const text = (item.content || '').trim();

  if (!text) {
    const n = (item.attachments || []).length;
    return n > 0 ? `${who}记了 ${n} 张照片` : `${who}记了一笔`;
  }

  const short = text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
  return `${who}：${short}`;
}
