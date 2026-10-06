/**
 * 应用入口
 *
 * ⚠️ 当前是 M1 骨架阶段：只初始化全局状态，**尚未接入登录链路**。
 *    登录（wx.login → POST /auth/login → 存 token）在 M1 的 auth 任务中实现。
 */
App<IAppOption>({
  globalData: {
    token: '',
    currentFamilyId: undefined,
    baseUrl: 'http://localhost:3000',
  },

  onLaunch() {
    // TODO(M1): 读本地缓存的 token → 校验有效性 → 失效则静默重新登录
  },
})
