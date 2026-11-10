/**
 * 请求封装（M1-F2）
 *
 * 页面里**禁止直接调 `wx.request`**（docs/04 §5.2），一律走这里。
 *
 * 它负责四件事：
 *   ① 拼 URL、带 `Authorization: Bearer <token>`
 *   ② 拆统一响应体 `{ code, message, data }` —— 成功直接返回 `data`，
 *      失败抛一个带 `code` 的 `Error`（页面 `catch (e) { toastError(e) }` 即可）
 *   ③ **401 静默重登后重放请求**：用户无感知，避免「点一下就跳登录页」
 *   ④ 网络层失败（超时 / 域名不合法）也归一成同样的错误形状，页面不用分辨
 *
 * 关于并发：多个请求同时收到 401 时，**只触发一次重登**，其余等这一次的结果
 * （见 `ensureRelogin`）。否则冷启动时会连发好几个 `wx.login`。
 *
 * 关于类型：`import type` 的模块会被编译期完全擦除，运行时不需要它存在 ——
 * 这是小程序端唯一能安全引用 `@shared` 的形式。详见 `constants/error-code.ts` 头部说明。
 */

import type { ApiResponse } from '@shared/dto/common';
import {
  API_PREFIX,
  BASE_URL,
  REQUEST_TIMEOUT,
  UPLOAD_TIMEOUT,
  USE_CLOUD_CONTAINER,
} from '../config';
import { ErrorCode, NETWORK_ERROR_MESSAGE, RELOGIN_CODES } from '../constants/error-code';
import { storage } from '../utils/storage';
import { callContainer } from './cloud-container';
import { uploadImageToCloudStorage } from './cloud-storage';
import type { CloudContainerFailure } from './cloud-container';
import type { UploadImageResult, UploadSceneValue } from '@shared/dto/upload';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 带业务错误码的异常。页面可以 `if ((e as ApiError).code === ErrorCode.CONFLICT)` 分支处理。 */
export interface ApiError extends Error {
  code: number;
  /** 原始网络错误（只用于排查，不展示给用户） */
  detail?: string;
}

export interface RequestOptions {
  /** 相对路径，如 `/families`；也允许传完整 URL（预留，调试用） */
  url: string;
  method?: HttpMethod;
  /** GET 会被序列化成 query string；POST/PATCH 作为 JSON body */
  data?: Record<string, unknown>;
  /** 是否需要登录态。默认 true；只有 `POST /auth/login` 传 false */
  auth?: boolean;
}

// =============================================================
// 静默重登
// =============================================================

type ReloginHandler = () => Promise<boolean>;

let reloginHandler: ReloginHandler | null = null;
let reloginInflight: Promise<boolean> | null = null;

/**
 * 注册「静默重登」的实现。
 *
 * 由 `stores/user.ts` 在模块加载时注入 —— 反过来 request 不 import store，
 * 避免两者循环依赖（store 要用 request 调接口，request 要用 store 重登）。
 */
export function setReloginHandler(handler: ReloginHandler): void {
  reloginHandler = handler;
}

/** 并发去重：同一时刻只跑一次重登 */
function ensureRelogin(): Promise<boolean> {
  if (reloginInflight) return reloginInflight;

  const handler = reloginHandler;
  if (!handler) return Promise.resolve(false);

  const done = (ok: boolean): boolean => {
    reloginInflight = null;
    return ok;
  };

  reloginInflight = Promise.resolve()
    .then(() => handler())
    .then(
      (ok) => done(Boolean(ok)),
      () => done(false),
    );

  return reloginInflight;
}

// =============================================================
// 底层发送
// =============================================================

function createApiError(code: number, message: string, detail?: string): ApiError {
  // 刻意不用 `class X extends Error`：经过 Babel 降级后 `instanceof` 会失效，
  // 这里只挂一个 code 字段，形状简单且稳定。
  const err = new Error(message) as ApiError;
  err.code = code;
  if (detail) err.detail = detail;
  return err;
}

function networkMessage(errMsg: string): string {
  if (errMsg.indexOf('timeout') >= 0) return '网络有点慢，再试一次';
  return NETWORK_ERROR_MESSAGE;
}

function send<T>(
  url: string,
  method: HttpMethod,
  data: Record<string, unknown> | undefined,
  withAuth: boolean,
): Promise<ApiResponse<T>> {
  return new Promise<ApiResponse<T>>((resolve, reject) => {
    const header: Record<string, string> = { 'content-type': 'application/json' };
    const token = storage.getToken();
    if (withAuth && token) header.Authorization = `Bearer ${token}`;

    wx.request({
      url,
      // ⚠️ 微信的类型定义里 `method` 不含 PATCH（官方文档也只列了
      //    OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT），但底层 HTTP 支持，
      //    实测可用。这里断言一次，别在业务代码里到处写 any。
      method: method as WechatMiniprogram.RequestOption['method'],
      data,
      header,
      timeout: REQUEST_TIMEOUT,
      success: (res) => {
        const body = res.data as ApiResponse<T> | undefined;
        if (!body || typeof body.code !== 'number') {
          // 走到了非本项目的响应（网关错误页 / 代理拦截），归一成服务端异常
          reject(createApiError(ErrorCode.INTERNAL_ERROR, '出了点小问题，再试一次'));
          return;
        }
        resolve(body);
      },
      fail: (err) => {
        reject(createApiError(ErrorCode.INTERNAL_ERROR, networkMessage(err.errMsg ?? '')));
      },
    });
  });
}

// =============================================================
// 云托管专用通道（wx.cloud.callContainer）
// =============================================================

/** GET 参数序列化。项目里的 GET 参数都是扁平标量，不需要处理嵌套对象。 */
function toQuery(data?: Record<string, unknown>): string {
  if (!data) return '';
  const parts: string[] = [];
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/**
 * 通过云托管内部网关发送请求。
 *
 * 与 `wx.request` 的差异：
 *   - 不需要服务器合法域名（这正是选它的原因）
 *   - 请求体 ≤ 100KiB，不能传文件
 *   - 返回结构与 `wx.request` 类似，但 `data` 可能是字符串，需要自己解析
 */
function sendByContainer<T>(
  path: string,
  method: HttpMethod,
  data: Record<string, unknown> | undefined,
  withAuth: boolean,
): Promise<ApiResponse<T>> {
  const header: Record<string, string> = { 'content-type': 'application/json' };
  const token = storage.getToken();
  if (withAuth && token) header.Authorization = `Bearer ${token}`;

  const isGet = method === 'GET';

  return callContainer<ApiResponse<T> | string>({
    path: isGet ? `${path}${toQuery(data)}` : path,
    method,
    header,
    data: isGet ? undefined : data,
  }).then(
    (res) => {
      let body: ApiResponse<T> | undefined;
      if (typeof res.data === 'string') {
        try {
          body = JSON.parse(res.data) as ApiResponse<T>;
        } catch {
          body = undefined;
        }
      } else {
        body = res.data as ApiResponse<T> | undefined;
      }

      if (!body || typeof body.code !== 'number') {
        // 走到了非本项目的响应（网关错误页 / 授权失败），归一成服务端异常
        throw createApiError(ErrorCode.INTERNAL_ERROR, '出了点小问题，再试一次');
      }
      return body;
    },
    (err: CloudContainerFailure) => {
      const raw = err?.errMsg ?? '';
      throw createApiError(ErrorCode.INTERNAL_ERROR, networkMessage(raw), raw);
    },
  );
}

// =============================================================
// 对外入口
// =============================================================

export function request<T>(options: RequestOptions): Promise<T> {
  return doRequest<T>(options, false);
}

async function doRequest<T>(options: RequestOptions, retried: boolean): Promise<T> {
  const method = options.method ?? 'GET';
  const withAuth = options.auth !== false;
  const isAbsolute = /^https?:\/\//.test(options.url);
  const path = `${API_PREFIX}${options.url}`;
  const url = isAbsolute ? options.url : `${BASE_URL}${path}`;

  const body =
    USE_CLOUD_CONTAINER && !isAbsolute
      ? await sendByContainer<T>(path, method, options.data, withAuth)
      : await send<T>(url, method, options.data, withAuth);

  if (body.code === ErrorCode.OK) {
    return body.data as T;
  }

  // 登录态失效：静默重登一次，然后**原样重放**这次请求。
  // 只重放一次 —— 重登后还是 401，说明不是登录态的问题，直接抛给页面。
  if (withAuth && !retried && RELOGIN_CODES.indexOf(body.code) >= 0) {
    const ok = await ensureRelogin();
    if (ok) return doRequest<T>(options, true);
  }

  throw createApiError(body.code, body.message || '出了点小问题，再试一次');
}

export function get<T>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'GET', data });
}

export function post<T>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'POST', data });
}

export function patch<T>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'PATCH', data });
}

export function del<T>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'DELETE', data });
}

// =============================================================
// 文件上传（M4-4）
// =============================================================

/** 后端上传端点。**只有开发版走它**；体验版/正式版由 `cloud-storage.ts` 直传云托管对象存储 */
const UPLOAD_IMAGE_PATH = '/upload/image';

/**
 * 上传一张图片。两条通道，页面层无感知：
 *
 * ```text
 * 开发版           → wx.uploadFile  multipart 打本机后端 /upload/image
 * 体验版/正式版     → wx.cloud.uploadFile 直传云托管对象存储（免密钥、不受 100KiB 限制）
 * ```
 *
 * ⚠️ **必须走这里，而不是页面里直接 `wx.uploadFile` / `wx.cloud.uploadFile`** ——
 *    理由与「页面禁止直接 `wx.request`」完全一样：拼地址、带 token、
 *    拆响应体、401 静默重登、错误归一，这五件事只写一遍。
 *
 * 后端那条通道上三个与 `wx.request` 不同的坑：
 *
 * ① **`res.data` 是字符串，不是对象。** `wx.uploadFile` 不做 JSON 解析
 *    （因为响应可能真的是二进制），必须自己 `JSON.parse`。
 * ② **失败也要看 HTTP 状态码。** `success` 回调在 4xx / 5xx 时同样会进 ——
 *    它只表示「请求发出去了」。真正判断成败的是响应体里的 `code`
 *    （与后端「HTTP 一律 200、业务结果看 code」的约定正好合上）。
 * ③ **超时给到 60s**（`UPLOAD_TIMEOUT`）。图片可能有好几 MB。
 *
 * @param filePath 本地临时文件路径（`wx.chooseMedia` 给的 `tempFilePath`）
 * @param scene    决定存进桶里的目录前缀（`memories/` / `avatars/` / `menus/`）
 * @param onProgress 进度回调（0–100）。用来在 P18 的缩略图上画进度条
 */
export function uploadImage(
  filePath: string,
  scene: UploadSceneValue,
  onProgress?: (percent: number) => void,
): Promise<UploadImageResult> {
  if (USE_CLOUD_CONTAINER) return uploadImageToCloudStorage(filePath, scene, onProgress);
  return doUploadImage(filePath, scene, onProgress, false);
}

function sendUpload<T>(
  url: string,
  filePath: string,
  formData: Record<string, string> | undefined,
  onProgress: ((percent: number) => void) | undefined,
): Promise<ApiResponse<T>> {
  return new Promise<ApiResponse<T>>((resolve, reject) => {
    const header: Record<string, string> = {};
    const token = storage.getToken();
    if (token) header.Authorization = `Bearer ${token}`;

    const task = wx.uploadFile({
      url,
      filePath,
      // 字段名与后端 `FileInterceptor('file')` 必须一致（docs/02 §8.1）
      name: 'file',
      formData,
      header,
      timeout: UPLOAD_TIMEOUT,
      success: (res) => {
        let body: ApiResponse<T> | undefined;
        try {
          body = JSON.parse(res.data) as ApiResponse<T>;
        } catch {
          body = undefined;
        }
        if (!body || typeof body.code !== 'number') {
          reject(createApiError(ErrorCode.INTERNAL_ERROR, '图片没传上去，再试一次'));
          return;
        }
        resolve(body);
      },
      fail: (err) => {
        reject(createApiError(ErrorCode.INTERNAL_ERROR, networkMessage(err.errMsg ?? '')));
      },
    });

    // `onProgressUpdate` 不是所有基础库版本都有 —— 拿不到进度不影响上传
    if (onProgress && task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((p) => onProgress(p.progress));
    }
  });
}

async function doUploadImage(
  filePath: string,
  scene: UploadSceneValue,
  onProgress: ((percent: number) => void) | undefined,
  retried: boolean,
): Promise<UploadImageResult> {
  const full = `${BASE_URL}${API_PREFIX}${UPLOAD_IMAGE_PATH}`;
  const body = await sendUpload<UploadImageResult>(full, filePath, { scene }, onProgress);

  if (body.code === ErrorCode.OK) return body.data as UploadImageResult;

  // 与 `doRequest` 同一条：登录态失效就静默重登一次再原样重放
  if (!retried && RELOGIN_CODES.indexOf(body.code) >= 0) {
    const ok = await ensureRelogin();
    if (ok) return doUploadImage(filePath, scene, onProgress, true);
  }

  throw createApiError(body.code, body.message || '图片没传上去，再试一次');
}
