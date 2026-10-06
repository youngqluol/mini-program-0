/**
 * P01 · 家里（Tab 1）
 *
 * 骨架阶段：只渲染静态结构 + 空状态，数据接入在 M1 完成。
 * 页面职责（见 docs/03）：打开就知道「今天家里有什么事」。
 */
Page({
  data: {
    familyName: '我们家',
  },

  /** 🔔 叮一下 —— P08 */
  onNudge() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' })
  },

  /** 🎯 派活 —— P09 */
  onAssign() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' })
  },

  /** 去开启微信提醒 —— P21 */
  onOpenNotifySetting() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' })
  },
})
