/**
 * 全局类型声明
 *
 * `miniprogram-api-typings` 提供 wx / App / Page / Component 等全局 API 类型，
 * 这里补充项目自己的全局类型。
 */

interface IAppOption {
  globalData: {
    /**
     * 冷启动时间戳（毫秒）。
     *
     * ⚠️ `globalData` 只放**排查用**的数据。业务状态一律走 store：
     *    登录态 → `stores/user.ts`；环境配置 → `config.ts`。
     *    往 globalData 里塞业务数据会让「谁改了它」变得不可追踪。
     */
    launchAt: number;
  };
}
