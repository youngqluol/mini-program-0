/**
 * 全局类型声明
 *
 * `miniprogram-api-typings` 提供 wx / App / Page / Component 等全局 API 类型，
 * 这里补充项目自己的全局类型。
 */

interface IAppOption {
  globalData: {
    /** 登录态 token；未登录为空串 */
    token: string
    /** 当前家庭 ID；未加入任何家庭时为 undefined */
    currentFamilyId?: number
    /** 后端 baseURL（本地开发指向 http://localhost:3000） */
    baseUrl: string
  }
}
