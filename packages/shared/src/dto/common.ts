/**
 * 通用出入参类型（docs/02 §1.1 / §1.3）。
 */

/** 统一响应体 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

/**
 * 家庭成员简写 —— **跨模块共用的一种形状**。
 *
 * 只带「文案与头像会用到」的三样：成员 ID、家庭称谓、头像。
 * 小事（`ThingMemberBrief`）与留个念（`MemoryCreatorBrief`）都是它的别名 ——
 * 两个模块各写一份结构相同的接口，改一处忘一处时编译器不会报错，
 * 所以这里只留一个定义（与「枚举只有一个来源」是同一条纪律）。
 *
 * ⚠️ **`roleName` 是家庭称谓（「阿妈」），不是微信昵称。**
 * 文案里一律用称谓 —— 家人才知道谁是谁（PRD §31 术语表）。
 * 需要昵称请用 `FamilyMember`（那是成员管理页的形状）。
 *
 * `avatarUrl` 可为空，前端用称谓首字兜底。
 */
export interface MemberBrief {
  memberId: number;
  /** 家庭称谓，例如「阿妈」 */
  roleName: string;
  avatarUrl: string | null;
}

/** 分页请求参数 */
export interface PageQuery {
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数，默认 20，最大 50 */
  pageSize?: number;
}

/** 分页响应体 */
export interface PageResult<T> {
  list: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * 游标分页请求参数（家庭记录时间线用，避免翻页错乱）。
 *
 * ⚠️ **游标是「上一页最后一条的 `id`」，不是时间戳。**
 *    `family_memories.created_at` 是 `DATETIME(0)`（**秒**精度），
 *    同一秒里发两条就会有相同的时间戳，用 `created_at < cursor` 翻页会
 *    **静默漏掉**并列的那几条。`id` 自增且唯一，天然没有这个问题。
 *    详见 docs/02 §7.2。
 */
export interface CursorQuery {
  /** 上一页最后一条的 `id` */
  cursor?: number;
  /** 本页条数 */
  limit?: number;
}

/** 游标分页响应体 */
export interface CursorResult<T> {
  list: T[];
  /** 下一页游标（同上：是 `id`）；为 null 表示没有更多了 */
  nextCursor: number | null;
  hasMore: boolean;
}

/** 分页参数默认值与上限（前后端共用，避免两边各写一套） */
export const PAGE_DEFAULT_SIZE = 20;
export const PAGE_MAX_SIZE = 50;
