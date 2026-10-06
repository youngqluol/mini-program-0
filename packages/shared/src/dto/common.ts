/**
 * 通用出入参类型（docs/02 §1.1 / §1.3）。
 */

/** 统一响应体 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
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

/** 游标分页请求参数（家庭记录时间线用，避免翻页错乱） */
export interface CursorQuery {
  /** 上一页最后一条的 createdAt 时间戳（毫秒） */
  cursor?: number;
  /** 本页条数 */
  limit?: number;
}

/** 游标分页响应体 */
export interface CursorResult<T> {
  list: T[];
  /** 下一页游标；为 null 表示没有更多了 */
  nextCursor: number | null;
  hasMore: boolean;
}

/** 分页参数默认值与上限（前后端共用，避免两边各写一套） */
export const PAGE_DEFAULT_SIZE = 20;
export const PAGE_MAX_SIZE = 50;
