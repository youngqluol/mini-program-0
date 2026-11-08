/**
 * 云托管专用调用通道（`wx.cloud.callContainer`）的薄封装。
 *
 * 为什么需要它：
 *   微信云托管的默认域名 `*.run.tcloudbase.com` **只能用于接口测试**，
 *   小程序后台不允许把它配成 `request` / `uploadFile` 合法域名。
 *   `callContainer` 走微信内部网关，不需要配服务器域名，也不会消耗公网流量。
 *
 * 硬限制：
 *   - 基础库 2.23.0+（小程序后台「设置 → 功能设置 → 基础库最低版本」）
 *   - 请求体 ≤ 100 KiB，**不能传图片/文件**
 *   - 仅限被云托管环境授权的小程序使用
 *
 * 类型说明：
 *   `miniprogram-api-typings` 目前没有包含 `wx.cloud.callContainer`，
 *   这里用最小接口 + `unknown` 收窄，避免在业务代码里写 `any`。
 */

import { CLOUD_RUN_ENV_ID, CLOUD_RUN_SERVICE } from '../config';

export interface CloudContainerResponse<T> {
  statusCode: number;
  data: T;
  header?: Record<string, string>;
}

export interface CloudContainerFailure {
  errMsg?: string;
  errCode?: number;
}

interface CloudContainerOptions {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  header?: Record<string, string>;
  data?: Record<string, unknown>;
}

interface CloudContainerApi {
  init(options: { env: string; traceUser?: boolean }): void;
  callContainer<T>(
    options: CloudContainerOptions & {
      config: { env: string };
      success: (res: CloudContainerResponse<T>) => void;
      fail: (err: CloudContainerFailure) => void;
    },
  ): void;
}

let initialized = false;

/** 取全局 `wx.cloud`；基础库不支持时返回 null，不抛异常 */
function getCloudApi(): CloudContainerApi | null {
  const holder = wx as unknown as { cloud?: CloudContainerApi };
  return holder.cloud ?? null;
}

/**
 * 初始化 `wx.cloud`。
 *
 * **幂等**、**不抛异常**：初始化失败返回 false，真正的失败会在
 * `callContainer()` 时以明确的错误返回，不拖垮启动流程。
 */
export function initCloudRun(): boolean {
  if (initialized) return true;

  const cloud = getCloudApi();
  if (!cloud) return false;

  try {
    cloud.init({ env: CLOUD_RUN_ENV_ID, traceUser: true });
    initialized = true;
    return true;
  } catch (e) {
    // 失败路径保留原始错误，便于真机排查；正常路径不打印
    console.warn('[cloud-container] wx.cloud 初始化失败', e);
    return false;
  }
}

/** 当前运行环境是否具备调用能力（基础库是否暴露了 wx.cloud） */
export function isCloudRunAvailable(): boolean {
  return getCloudApi() !== null;
}

/**
 * 调用云托管服务。
 *
 * `path` 是容器内路径（本项目统一 `/api/...`）；
 * 服务名通过 `X-WX-SERVICE` 指定，环境通过 `config.env` 指定。
 */
export function callContainer<T>(
  options: CloudContainerOptions,
): Promise<CloudContainerResponse<T>> {
  const cloud = getCloudApi();
  if (!cloud) {
    const failure: CloudContainerFailure = {
      errMsg: '当前微信版本不支持云托管调用，请升级微信后重试',
    };
    return Promise.reject(failure);
  }

  if (!initialized) initCloudRun();

  return new Promise<CloudContainerResponse<T>>((resolve, reject) => {
    cloud.callContainer<T>({
      ...options,
      config: { env: CLOUD_RUN_ENV_ID },
      header: {
        'X-WX-SERVICE': CLOUD_RUN_SERVICE,
        ...(options.header ?? {}),
      },
      success: resolve,
      fail: (err) => {
        // 失败路径保留原始错误（基础库 / 环境 ID / 授权问题都靠它定位）
        console.warn('[cloud-container] callContainer 失败', err);
        reject(err);
      },
    });
  });
}
