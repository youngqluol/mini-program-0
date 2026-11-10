/**
 * 上传模块出入参（docs/02 §八）。
 *
 * V0.1 只支持图片（PRD §18.2：单张 ≤ 5MB，仅 jpg / png / webp）。
 * **视频不做** —— `memory_attachments` 的注释里写明了这一条。
 *
 * 两条上传通道（见 `UploadImageResult`）：开发版走后端，
 * 体验版/正式版由小程序端直传云托管对象存储。
 */

import type { UploadScene } from '../enums';

/** 接口层的上传场景字符串：`'AVATAR' | 'MEMORY' | 'MENU'` */
export type UploadSceneValue = `${UploadScene}`;

/**
 * 上传上限 —— **权威来源**，两份镜像由 `tools/check-shared.mjs` 钉住：
 *   · `miniprogram/constants/upload.ts`（小程序端 Babel 不解析 `paths`，运行时的值必须各写一份）
 *   · 后端 multer 的 `limits.fileSize` 直接 import 本文件
 */
export const UPLOAD_LIMITS = {
  /** 单张图片大小上限（字节）：5MB */
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
} as const;

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

/**
 * 小程序端拿到的上传结果。
 *
 * 两条通道给的东西不一样，所以**只有 `fileUrl` 是必填**：
 *
 * ```text
 * 开发版          → POST /upload/image    后端嗅探文件头，五个字段都有
 * 体验版/正式版    → wx.cloud.uploadFile   后端没见过这些字节：
 *                                          fileUrl 是云存储的 `cloud://` fileID，
 *                                          类型与尺寸由前端本机读
 * ```
 *
 * ⚠️ 直传那条通道上服务端的「嗅探 / 内容安全 / 尺寸」三步全部**不参与**，
 *    这是选择直传换来的代价，口径与补偿见 docs/02 §8.2 与 docs/未来需求池.md。
 */
export interface UploadImageResult {
  /** 可直接喂给 `<image src>` 的地址：`https://...`（后端）或 `cloud://...`（直传） */
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  /** 读不出来时为 `null` —— 与后端同一条口径，不编造 */
  width?: number | null;
  height?: number | null;
}
