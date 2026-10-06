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
import { API_PREFIX, BASE_URL, REQUEST_TIMEOUT } from '../config';
import { ErrorCode, NETWORK_ERROR_MESSAGE, RELOGIN_CODES } from '../constants/error-code';
import { storage } from '../utils/storage';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 带业务错误码的异常。页面可以 `if ((e as ApiError).code === ErrorCode.CONFLICT)` 分支处理。 */
export interface ApiError extends Error {
  code: number;
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

function createApiError(code: number, message: string): ApiError {
  // 刻意不用 `class X extends Error`：经过 Babel 降级后 `instanceof` 会失效，
  // 这里只挂一个 code 字段，形状简单且稳定。
  const err = new Error(message) as ApiError;
  err.code = code;
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
// 对外入口
// =============================================================

export function request<T>(options: RequestOptions): Promise<T> {
  return doRequest<T>(options, false);
}

async function doRequest<T>(options: RequestOptions, retried: boolean): Promise<T> {
  const method = options.method ?? 'GET';
  const withAuth = options.auth !== false;
  const url = /^https?:\/\//.test(options.url)
    ? options.url
    : `${BASE_URL}${API_PREFIX}${options.url}`;

  const body = await send<T>(url, method, options.data, withAuth);

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
