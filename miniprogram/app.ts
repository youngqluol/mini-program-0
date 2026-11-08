/**
 * 应用入口
 *
 * 这里刻意保持很薄：
 *   - **不做网络请求** —— 冷启动不阻塞首屏，登录交给启动路由守卫按需触发
 *   - **不存业务数据** —— 登录态在 `stores/user.ts`，环境配置在 `config.ts`，
 *     `globalData` 只放「排查用」的启动时间戳
 */

import { USE_CLOUD_CONTAINER } from './config';
import { initCloudRun } from './services/cloud-container';
import { restore } from './stores/user';
import { initCloud } from './utils/cloud';

App<IAppOption>({
  globalData: {
    launchAt: 0,
  },

  onLaunch() {
    this.globalData.launchAt = Date.now();

    // 装配云服务客户端（幂等，失败也不影响启动）。
    // 放在最前面：它只做内存里的装配，不发网络请求，不会拖慢首屏。
    initCloud();

    // 体验版 / 正式版走云托管专用通道；失败不拦启动，
    // 第一次请求会拿到明确的错误（含 errMsg），便于定位授权/基础库问题。
    if (USE_CLOUD_CONTAINER) initCloudRun();

    // 同步从本地缓存恢复登录态（不校验有效性）。
    // token 若已失效，第一次请求会拿到 40100，由 request 层静默重登后重放 ——
    // 比在启动时多发一次「校验请求」更省一次往返。
    restore();
  },
});
