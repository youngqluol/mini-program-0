/**
 * 留个念模块出入参（docs/02 §七）。
 *
 * 两种「念」在数据上是**同一张表** `family_memories`，靠 `thing_id` 区分
 * （PRD 第十九章）：
 *   独立留念   `thingId = null`   —— 随手记一笔
 *   完成纪念   `thingId = 小事ID` —— 完成一件小事后顺手记一笔
 *
 * 产品纪律（PRD §18.1）：**这不是朋友圈**，是「属于一家人的私人时间线」。
 * 所以这里没有点赞 / 评论 / 关注 / 转发，接口上也不预留它们的字段。
 *
 * 所有时间字段都是 **"YYYY-MM-DD HH:mm:ss"（北京时间）**，日期是 **"YYYY-MM-DD"**，
 * 由后端 `beijing-time.ts` 统一格式化。
 */

import type { MemoryVisibility } from '../enums';
import type { MemberBrief } from './common';

/** 接口层的可见范围字符串：`'FAMILY' | 'PRIVATE'` */
export type MemoryVisibilityValue = keyof typeof MemoryVisibility;

/** 一条记录最多几张图 —— 与 P18 的九宫格一致（PRD §18.2） */
export const MEMORY_MAX_ATTACHMENTS = 9;
/** 正文最长多少字 —— 家庭随笔，不是写文章 */
export const MEMORY_CONTENT_MAX = 1000;

// ---------------------------------------------------------------
// 图片
// ---------------------------------------------------------------

/**
 * 发布 / 编辑时提交的一张图 —— 直接照抄 `POST /upload/image` 的响应
 * （`fileUrl` / `fileType` / `fileSize` / `width` / `height`）。
 *
 * ⚠️ **服务端只信 `fileUrl` 里的 key 属于本家庭前缀**，不重新下载校验。
 * 图片在进这里之前已经过 `imgSecCheck`（见 upload 模块）——
 * 重复检测既慢又改变不了结论。
 */
export interface MemoryAttachmentInput {
  fileUrl: string;
  /** 例如 `image/jpeg` */
  fileType?: string | null;
  /** 字节 */
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  /** 展示顺序，从 0 开始；不传时按数组下标 */
  sortNo?: number;
}

/** 时间线 / 详情里回显的一张图 */
export interface MemoryAttachmentBrief {
  id: number;
  fileUrl: string;
  /** 可能为 `null` —— 服务端解不出图片尺寸时**不编造**（见 upload 模块） */
  width: number | null;
  height: number | null;
}

// ---------------------------------------------------------------
// 记录
// ---------------------------------------------------------------

/**
 * 「完成纪念」关联的那件小事 —— 详情页底部那行极淡的标注（PRD §19.3）。
 *
 * 只给 `id` 与 `title`：那行字是「来自 🎯 买牛奶」，
 * 时间线上**不做视觉区分**（一旦区分就滑向「任务日志」）。
 */
export interface MemoryThingRef {
  id: number;
  title: string;
}

/**
 * 时间线里的一条记录 = 详情（两者形状相同）。
 *
 * 为什么不做成「列表项 / 详情」两层：列表本来就要回显全部图片与全文
 * （P03 的卡片里正文和九宫格都在），详情不比它多任何一个字段 ——
 * 多一层类型只会多一层「哪个字段该出现在哪」的争论。
 */
export interface MemoryItem {
  id: number;
  /** "YYYY-MM-DD"（北京时间）。时间线按它分组 */
  date: string;
  content: string;
  visibility: MemoryVisibilityValue;
  creator: MemberBrief;
  attachments: MemoryAttachmentBrief[];
  /** 完成纪念才有；独立留念为 `null` */
  thing: MemoryThingRef | null;
  /**
   * 是不是我发的 —— **服务端算**。
   *
   * 前端拿 `creator.memberId` 与自己的 memberId 比也能得出，但那要求
   * 每个页面都先取一次「我的身份」，多家庭切换时还容易比错人。
   * 编辑 / 删除入口的显示条件就是它（P03 / P19）。
   */
  isMine: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------
// 接口出入参
// ---------------------------------------------------------------

/** `POST /memories` 请求（docs/02 §7.1） */
export interface CreateMemoryRequest {
  familyId: number;
  /** 最长 `MEMORY_CONTENT_MAX` 字；与图片**至少给一样** */
  content?: string;
  /** 不传 = `FAMILY`（家庭可见） */
  visibility?: MemoryVisibilityValue;
  /** 最多 `MEMORY_MAX_ATTACHMENTS` 张 */
  attachments?: MemoryAttachmentInput[];
  /** 「完成纪念」才传（PRD §19.2） */
  thingId?: number | null;
}

/** `PATCH /memories/{id}` 请求（docs/02 §7.4）。只传要改的字段。 */
export interface UpdateMemoryRequest {
  content?: string;
  visibility?: MemoryVisibilityValue;
  /** 传了就**全量替换**该记录的图片；不传则原样保留 */
  attachments?: MemoryAttachmentInput[];
}

/** `GET /memories` 查询（docs/02 §7.2） */
export interface ListMemoriesQuery {
  familyId: number;
  /** 上一页最后一条的 `createdAt` 时间戳（毫秒） */
  cursor?: number;
  limit?: number;
}

/** `GET /memories` 响应 */
export interface ListMemoriesResponse {
  list: MemoryItem[];
  /** 下一页游标；为 `null` 表示没有更多了 */
  nextCursor: number | null;
  hasMore: boolean;
}

/** `POST /memories` 响应 = 详情 */
export type CreateMemoryResponse = MemoryItem;
