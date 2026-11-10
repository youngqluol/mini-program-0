/**
 * 云托管对象存储 —— 小程序端直传通道（体验版 / 正式版）
 *
 * ## 为什么是它
 *
 * 业务请求走 `wx.cloud.callContainer`，而那条通道**请求体上限 100KiB**，
 * 图片根本塞不进去（原来这里是一个明确的「图片上传暂未开通」拒绝）。
 * 另一条常规解法「后端签 COS 临时密钥让前端直传自己的桶」也走不通：
 * 云托管托管的那个桶不在腾讯云 COS 控制台里，服务端要碰它得走
 * `/_/cos/*`，而那依赖「开放接口服务」—— 它会在容器里旁挂自签证书，
 * 正是 2026-11-09 登录失败（`50001`）的根因，**不能再打开**（见 docs/06 §5.F）。
 *
 * 剩下的唯一干净路子：云托管**自带对象存储**（开通环境时自动开通，底层就是
 * 腾讯云 COS），小程序端 `wx.cloud.uploadFile` 直接写进去 ——
 * **免密钥**、**不受 100KiB 限制**、走的还是 `wx.cloud.init({env})` 那条已授权通道，
 * 不新增任何合法域名要求。
 *
 * ## 代价（必须知道）
 *
 * 字节**不经过后端**，所以后端 `POST /upload/image` 那三步全部不参与：
 *
 * ```text
 * ① 文件头嗅探（防 .exe 改名成 .png）  → 没了，只剩前端按扩展名粗判
 * ② 图片内容安全 img_sec_check         → 没了（记进 docs/未来需求池.md）
 * ③ 尺寸解析供九宫格占位               → 换成本机 wx.getImageInfo，读不出就给 null
 * ```
 *
 * 兜底在服务端写入时：`MemoryService.assertAttachmentsOwnedByUs()` 会核对
 * `cloud://` 前缀（`STORAGE_CLOUD_PREFIX`），防止有人把外域图片地址塞进留念。
 * 单张 5MB 上限在选图处拦（`pages/memory/create.ts`）—— 直传通道上后端拦不到。
 *
 * 开发版**不走这里**，仍然 `wx.uploadFile` 打本机后端的 `/upload/image`，
 * 三步一样不少。
 */

import { CLOUD_RUN_ENV_ID } from '../config';
import { ErrorCode, NETWORK_ERROR_MESSAGE } from '../constants/error-code';
import { todayDate } from '../utils/time';
import { initCloudRun } from './cloud-container';
import type { ApiError } from './request';
import type { UploadImageResult, UploadSceneValue } from '@shared/dto/upload';

/** 场景 → 桶里的目录前缀。**与后端 `object-key.ts` 的 `SCENE_DIR` 同值** */
const SCENE_DIR: Record<UploadSceneValue, string> = {
  AVATAR: 'avatars',
  MEMORY: 'memories',
  MENU: 'menus',
};

/** 允许的扩展名（与 `UPLOAD_ALLOWED_IMAGE_TYPES` 一一对应，GIF 刻意不在内） */
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];

interface UploadTask {
  onProgressUpdate?(cb: (res: { progress: number }) => void): void;
}

interface CloudStorageApi {
  uploadFile(options: {
    cloudPath: string;
    filePath: string;
    config: { env: string };
    success: (res: { fileID: string }) => void;
    fail: (err: { errMsg?: string; errCode?: number }) => void;
  }): UploadTask;
}

function getStorageApi(): CloudStorageApi | null {
  const holder = wx as unknown as { cloud?: CloudStorageApi };
  return holder.cloud ?? null;
}

function uploadError(message: string, detail?: string): ApiError {
  const err = new Error(message) as ApiError;
  err.code = ErrorCode.INTERNAL_ERROR;
  if (detail) err.detail = detail;
  return err;
}

/** 32 位十六进制随机串。小程序端没有 `node:crypto`，两次独立取样拼起来够用 */
function randomHex(): string {
  let out = '';
  while (out.length < 32) {
    out += Math.random().toString(16).slice(2);
  }
  return out.slice(0, 32);
}

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot < 0 ? '' : filePath.slice(dot + 1).toLowerCase();
}

/**
 * `memories/2026/11/<32 位随机十六进制>.jpg`
 *
 * 目录形状**与后端 `object-key.ts` 一致**（场景 + 年/月 + 随机串）：
 * 年月用北京时间（`todayDate()` 已按北京时间格式化），随机串保证地址猜不出来。
 */
function buildCloudPath(scene: UploadSceneValue, ext: string): string {
  const ym = todayDate().slice(0, 7); // `YYYY-MM`
  return `${SCENE_DIR[scene]}/${ym.slice(0, 4)}/${ym.slice(5, 7)}/${randomHex()}.${ext}`;
}

/** 本机读图片宽高；读不出就是 `null`，不编造（与后端同一条口径） */
function readLocalSize(filePath: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success: (res) => resolve({ width: res.width, height: res.height }),
      fail: () => resolve({ width: null, height: null }),
    });
  });
}

/**
 * 直传一张图片。
 *
 * @param filePath   `wx.chooseMedia` 给的 `tempFilePath`
 * @param scene      决定目录前缀
 * @param onProgress 进度回调（0–100）
 */
export async function uploadImageToCloudStorage(
  filePath: string,
  scene: UploadSceneValue,
  onProgress?: (percent: number) => void,
): Promise<UploadImageResult> {
  const cloud = getStorageApi();
  if (!cloud || typeof cloud.uploadFile !== 'function') {
    throw uploadError('当前微信版本不支持图片上传，请升级微信后重试', 'wx.cloud.uploadFile 不可用');
  }

  const ext = extOf(filePath);
  if (ALLOWED_EXT.indexOf(ext) < 0) {
    throw uploadError('只认得 jpg、png、webp 的图片', `扩展名=${ext || '(无)'}`);
  }

  // 云托管环境装配过才能传；没装配（极老的启动路径）这里补一次，幂等
  if (!initCloudRun()) {
    throw uploadError(NETWORK_ERROR_MESSAGE, 'wx.cloud 未初始化');
  }

  const cloudPath = buildCloudPath(scene, ext);

  const fileID = await new Promise<string>((resolve, reject) => {
    try {
      const task = cloud.uploadFile({
        cloudPath,
        filePath,
        config: { env: CLOUD_RUN_ENV_ID },
        success: (res) => {
          if (res && res.fileID) resolve(res.fileID);
          else reject(uploadError('图片没传上去，再试一次', '没有拿到文件地址'));
        },
        fail: (err) => {
          // `errMsg` 里最有价值的两种：权限没开、环境 ID 不对
          reject(uploadError('图片没传上去，再试一次', err && err.errMsg));
        },
      });

      // `onProgressUpdate` 不是所有基础库版本都有 —— 拿不到进度不影响上传
      if (onProgress && typeof task.onProgressUpdate === 'function') {
        task.onProgressUpdate((p) => onProgress(p.progress));
      }
    } catch (e) {
      reject(uploadError('图片没传上去，再试一次', e instanceof Error ? e.message : ''));
    }
  });

  const size = await readLocalSize(filePath);
  return {
    fileUrl: fileID,
    fileType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`,
    // 直传拿不到字节数（`chooseMedia` 那份 size 在这一层没有），**不猜**
    width: size.width,
    height: size.height,
  };
}
