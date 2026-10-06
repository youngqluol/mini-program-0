/**
 * P20 · 我的（Tab 4）
 *
 * 骨架阶段：静态结构。登录态与家庭数据在 M1 接入。
 *
 * 这里承载的是「低频但必须有」的东西：消息中心、微信提醒开关、
 * 家庭设置、成员管理。它们不该占首页黄金位置，也不能藏得找不到。
 */
Page({
  data: {
    cells: [
      { key: 'notice', emoji: '💬', label: '消息中心', extra: '' },
      { key: 'wechatNotify', emoji: '🔔', label: '微信提醒', extra: '未开启' },
      { key: 'members', emoji: '👨‍👩‍👧', label: '家庭成员', extra: '' },
      { key: 'invite', emoji: '➕', label: '邀请家人', extra: '' },
      { key: 'familySetting', emoji: '⚙️', label: '家庭设置', extra: '' },
    ],
  },

  onCellTap() {
    wx.showToast({ title: '这个功能正在做，很快就好', icon: 'none' })
  },
})
