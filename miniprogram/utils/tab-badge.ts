/**
 * 底部 Tab 的未读角标
 *
 * 单独一个文件是因为它有**副作用**（调 `wx.*`），而 `mine-view.ts` 必须保持纯函数
 * —— 纯函数才能被 `tools/test-view.mjs` 断言。
 *
 * ⚠️ **只在「我的」Tab 的 `onShow` 里刷新。** 理由：我的未读数只会因为
 *    **别人**做了事而变化，本地没有任何触发点 —— 想实时只能轮询，不值当。
 *    「打开我的 Tab 时是最新的」已经够用（首页本来就会显示今天的事）。
 */

import { buildUnreadBadge } from './mine-view';

/**
 * 「我的」在 `app.json` 的 `tabBar.list` 里排第 4（下标 3）。
 *
 * ⚠️ 这个数字与 `app.json` 是**跨文件耦合**：调 Tab 顺序时这里要跟着改，
 *    挂错 Tab **不会报错**，只会悄悄地把角标挂到「留个念」上。
 *    `tools/check-mp.mjs` 的检查项 ⑩ 专门盯这个。
 */
const MINE_TAB_INDEX = 3;

/**
 * 同步未读角标。
 *
 * `count = 0` 时要**显式移除**：不调用 remove 的话，角标会一直停在最后一个数字上
 * （用户看完消息回到「我的」，还挂着一个「3」）。
 *
 * 失败静默 —— tabBar 还没就绪时调用会失败，那不是错误，也没有用户能做的动作。
 */
export function syncUnreadBadge(count: number): void {
  const badge = buildUnreadBadge(count);
  const quiet = { fail: (): void => undefined };

  if (badge.show) {
    wx.setTabBarBadge({ index: MINE_TAB_INDEX, text: badge.text, ...quiet });
  } else {
    wx.removeTabBarBadge({ index: MINE_TAB_INDEX, ...quiet });
  }
}
