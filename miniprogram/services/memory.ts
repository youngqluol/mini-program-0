/**
 * 留个念接口（docs/02 §七）
 *
 * 路径与 `server/src/modules/memory/memory.controller.ts` 一一对应。
 *
 * ⚠️ **三个 `:id` 路由不传 `familyId`。** URL 与 body 里都没有这个字段 ——
 * 后端顺着「记录 → 家庭」自己反查（`MemoryService.contextForMemory`），
 * 这样前端不会造出「familyId 与记录不一致」的请求。时间线点进详情时，
 * 手里只有记录 ID，本来也拿不到第二个值去对。
 *
 * ⚠️ **`PATCH` 没有 `attachments`。** V0.1 的图片是不可变的：
 * 发错了只能删掉重发（原因见 `@shared/dto/memory` 的 `UpdateMemoryRequest`）。
 */

import type {
  ListMemoriesResponse,
  MemoryAttachmentInput,
  MemoryItem,
  MemoryVisibilityValue,
} from '@shared/dto/memory';
import type { UploadImageResponse, UploadSceneValue } from '@shared/dto/upload';
import { del, get, patch, post, upload } from './request';

/** 发布一条记录（P18）。正文与图片**至少给一样**，后端会判 */
export function create(data: {
  familyId: number;
  content?: string;
  visibility?: MemoryVisibilityValue;
  attachments?: MemoryAttachmentInput[];
  /** 「完成纪念」才传（PRD §19.2） */
  thingId?: number | null;
}): Promise<MemoryItem> {
  return post<MemoryItem>('/memories', { ...data });
}

/**
 * 家庭时间线（P03）。
 *
 * `cursor` 是**上一页最后一条的 `id`**（不是时间戳）—— 见
 * `server/src/modules/memory/dto/memory.dto.ts` 里为什么不能用时间戳。
 */
export function list(query: {
  familyId: number;
  cursor?: number;
  limit?: number;
}): Promise<ListMemoriesResponse> {
  return get<ListMemoriesResponse>('/memories', { ...query });
}

/** 记录详情（P19） */
export function detail(id: number): Promise<MemoryItem> {
  return get<MemoryItem>(`/memories/${id}`);
}

/** 编辑记录（仅发布者）。只改正文与可见范围 —— 图片改不了 */
export function update(
  id: number,
  data: { content?: string; visibility?: MemoryVisibilityValue },
): Promise<MemoryItem> {
  return patch<MemoryItem>(`/memories/${id}`, { ...data });
}

/** 删除记录（仅发布者）。逻辑删除，家里其他人也就看不到了 */
export function remove(id: number): Promise<{ id: number }> {
  return del<{ id: number }>(`/memories/${id}`);
}

// ---------------------------------------------------------------
// 图片上传（M4-4）
// ---------------------------------------------------------------

/**
 * 上传一张图片，拿回可访问的 URL。
 *
 * ⚠️ `scene` 必填：它决定对象存储里的目录前缀（`memories/` / `avatars/` / `menus/`）。
 *    不传的话后端会回 40001，而不是猜一个。
 *
 * @param filePath `wx.chooseMedia` 给的 `tempFilePath`
 * @param onProgress 进度回调（0–100），用来在缩略图上画进度
 */
export function uploadImage(
  filePath: string,
  scene: UploadSceneValue,
  onProgress?: (percent: number) => void,
): Promise<UploadImageResponse> {
  return upload<UploadImageResponse>('/upload/image', filePath, { scene }, onProgress);
}
