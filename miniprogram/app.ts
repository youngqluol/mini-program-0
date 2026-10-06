/**
 * 应用入口
 *
 * 这里刻意保持很薄：
 *   - **不做网络请求** —— 冷启动不阻塞首屏，登录交给启动路由守卫按需触发
 *   - **不存业务数据** —— 登录态在 `stores/user.ts`，环境配置在 `config.ts`，
 *     `globalData` 只放「排查用」的启动时间戳
 */

import { restore } from './stores/user';

App<IAppOption>({
  globalData: {
    launchAt: 0,
  },

  onLaunch() {
    this.globalData.launchAt = Date.now();

    // 同步从本地缓存恢复登录态（不校验有效性）。
    // token 若已失效，第一次请求会拿到 40100，由 request 层静默重登后重放 ——
    // 比在启动时多发一次「校验请求」更省一次往返。
    restore();
  },
});
