/**
 * 上传模块出入参（docs/02 §八）。
 *
 * V0.1 只支持图片（PRD §18.2：单张 ≤ 5MB，仅 jpg / png / webp）。
 * **视频不做** —— `memory_attachments` 的注释里写明了这一条。
 *
 * 上限与白名单放在 shared 而不是各写一份：
 * 前端要在选图时**先拦一道**（省一次白跑的网络请求与流量），
 * 后端要**再拦一道**（前端那道是体验，不是安全边界）。
 */

import type { UploadScene } from '../enums';

/** 接口层的上传场景字符串：`'AVATAR' | 'MEMORY' | 'MENU'` */
export type UploadSceneValue = `${UploadScene}`;

/** 单张图片大小上限（字节）：5MB */
export const UPLOAD_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 允许的图片 MIME 类型。
 *
 * ⚠️ 这**不是**安全边界 —— multipart 里的 `Content-Type` 由客户端给，
 * 想伪造随时能伪造。真正的判据是**文件头的魔术字节**（服务端嗅探），
 * 这份清单只用来回答「客户端自称是什么、我们就按什么回显」。
 */
export const UPLOAD_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** `POST /upload/image` 响应（docs/02 §8.1） */
export interface UploadImageResponse {
  /** 可公开访问的 URL */
  fileUrl: string;
  /** 例如 `image/jpeg`。以**服务端嗅探出的真实类型**为准，不采信客户端 */
  fileType: string;
  /** 字节 */
  fileSize: number;
  /** 解不出来时为 `null` —— 不编造尺寸 */
  width: number | null;
  height: number | null;
}
