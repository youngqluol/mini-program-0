import { IsIn } from 'class-validator';
import { UploadScene } from '@shared';

/**
 * 上传模块 DTO（docs/02 §八）。
 *
 * ⚠️ 这里的字段来自 **multipart 表单**，不是 JSON —— 所以全是字符串。
 *    `scene` 不做 `@Type(() => ...)` 转换，直接按字符串校验。
 */

/** 场景可选值 —— 从 `@shared` 的 `UploadScene` 取，不在这里重写一遍 */
const SCENES = Object.values(UploadScene);

/** `POST /upload/image` 的表单字段（除文件本身） */
export class UploadImageDto {
  /**
   * 上传场景。决定对象存储里的目录前缀（`avatars/` / `memories/` / `menus/`）。
   *
   * 为什么必填而不是给默认值：目录前缀是运维排查的线索，
   * 也是将来配生命周期规则的依据。给个「默认 MEMORY」会让头像悄悄
   * 落进留念目录，且**没有任何报错**。
   */
  @IsIn(SCENES, { message: '上传场景不对' })
  scene!: (typeof SCENES)[number];
}
