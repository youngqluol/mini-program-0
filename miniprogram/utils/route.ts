/**
 * 启动路由守卫（M1-F5）
 *
 * 小程序没有全局路由钩子，所以守卫写成普通函数，在**需要登录的页面**
 * 的 `onShow` 里调一次。M1 只有首页需要（其余页面都是首页跳过去的）。
 *
 * 三种分支（docs/03 §4.2）：
 *   ① 没有登录态  → P04 授权登录页
 *   ② 登录了但没有任何家庭 → P05 创建家庭（引导页）
 *   ③ 都有        → 正常渲染
 *
 * ⚠️ 判断依据是**本地缓存**的家庭列表，不额外发请求 —— 首屏不该被网络阻塞。
 *    缓存过期的代价是「多走一次引导页」，而不是数据错乱：真的没有家庭时
 *    创建页会正常工作，真的有时 `reloadFamilies()` 会把状态纠回来。
 */

import * as userStore from '../stores/user';

const LOGIN_PAGE = '/pages/login/index';
const CREATE_FAMILY_PAGE = '/pages/family/create';
const HOME_TAB = '/pages/index/index';

/**
 * 入口守卫。返回 `true` 表示可以正常渲染当前页。
 *
 * 用 `redirectTo` 而不是 `navigateTo`：被拦下的页面不该留在返回栈里，
 * 否则用户从登录页返回会回到一个已经决定不展示的页面。
 */
export function guardEntry(): boolean {
  if (!userStore.isLoggedIn()) {
    wx.redirectTo({ url: LOGIN_PAGE });
    return false;
  }

  if (userStore.needsFamilySetup()) {
    wx.redirectTo({ url: CREATE_FAMILY_PAGE });
    return false;
  }

  return true;
}

/** 登录成功后按状态决定去哪（P04 的按钮回调） */
export function goAfterLogin(): void {
  if (userStore.needsFamilySetup()) {
    wx.redirectTo({ url: CREATE_FAMILY_PAGE });
  } else {
    goHome();
  }
}

/** 回首页（创建 / 加入家庭成功后调用） */
export function goHome(): void {
  wx.switchTab({ url: HOME_TAB });
}

/** 去创建家庭页（加入家庭页的「我也要建一个」入口用） */
export function goCreateFamily(): void {
  wx.redirectTo({ url: CREATE_FAMILY_PAGE });
}
