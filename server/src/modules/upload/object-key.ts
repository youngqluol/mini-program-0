/**
 * 对象存储的 key 生成 —— 纯函数。
 *
 * 形状：`<场景目录>/<年>/<月>/<32 位随机十六进制>.<扩展名>`
 * 例：`memories/2026/10/3f9a...c1.jpg`
 *
 * 为什么按「场景 + 年/月」分目录：
 *   - 场景分目录让桶里的东西一眼能看出用途（头像 / 留念 / 菜谱），
 *     将来要做生命周期规则（比如头像 90 天清理）时不用去猜前缀；
 *   - 年月分目录是对象存储的惯例，控制台按前缀浏览时不会一屏几十万条。
 *
 * 为什么文件名用**随机串**而不是时间戳或原名：
 *   ① 时间戳可猜，别人拿到一个 URL 就能推算相邻的；
 *   ② 原名会带中文、空格、超长、以及 `../` 这类路径穿越字符，
 *      清洗规则越写越长还总漏。随机串一律安全，且天然去重。
 *
 * ⚠️ 年月取的是**北京时间**（进程 `TZ=Asia/Shanghai`，见 docs/01 §4.3）。
 *    这里只是目录名，不影响任何业务判断，但别改成 UTC —— 会和用户
 *    「我是 10 月 1 号凌晨传的，怎么在 9 月目录里」的直觉冲突。
 */

import { randomBytes } from 'node:crypto';
import type { SupportedImageMime } from './image-meta';

/** 上传场景（与 `@shared` 的 `UploadScene` 同值） */
export type SceneDir = 'AVATAR' | 'MEMORY' | 'MENU';

/** 场景 → 桶里的目录前缀 */
const SCENE_DIR: Record<SceneDir, string> = {
  AVATAR: 'avatars',
  MEMORY: 'memories',
  MENU: 'menus',
};

/** MIME → 扩展名。**以服务端嗅探出的 MIME 为准**，不用客户端给的文件名 */
const EXT_BY_MIME: Record<SupportedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * @param scene 上传场景
 * @param mime  服务端嗅探出的真实 MIME
 * @param at    用来取年月的时刻。默认当前时间；**自检要钉住它**
 */
export function buildObjectKey(scene: SceneDir, mime: SupportedImageMime, at = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const name = randomBytes(16).toString('hex');
  return `${SCENE_DIR[scene]}/${year}/${month}/${name}.${EXT_BY_MIME[mime]}`;
}
