/**
 * 小事卡片（P01 首页 / P11 我的小事 共用）
 *
 * 纯展示组件：不读 store、不发请求、不认识后端 DTO。
 * `item` 一律来自 `utils/thing-view.ts` 的归一化函数 —— 页面负责把
 * `ThingListItem` / `TodayTask` / `TodayReminder` 转成同一种形状。
 *
 * ⚠️ 事件名为什么不叫 `tap`：自定义组件里 `triggerEvent('tap')` 会和原生 tap
 *    冒泡撞车 —— 页面写 `bindtap` 会收到两次回调。所以用 `click`。
 *
 * 事件：
 *   click    → { id }  点了卡片本身（页面据此跳 P10 详情）
 *   complete → { id }  点了右侧快速完成（仅 variant="today" 且 showCheck）
 */

interface CardItem {
  id: number;
  /** 已完成 / 已取消 —— 置灰且不允许再点完成 */
  done?: boolean;
}

Component({
  properties: {
    /** `ThingCardItem`（见 utils/thing-view.ts） */
    item: { type: Object, value: {} },
    /** `'list'` 列表形态 / `'today'` 首页形态 */
    variant: { type: String, value: 'list' },
    /** 右侧是否给一个「快速完成」的圈（首页用） */
    showCheck: { type: Boolean, value: false },
    /** 右侧是否显示「待完成 / 已完成」文案（首页派活区块用） */
    showStatus: { type: Boolean, value: false },
  },

  methods: {
    onClick() {
      const item = this.data.item as CardItem;
      if (!item || !item.id) return;
      this.triggerEvent('click', { id: item.id });
    },

    /** 只有「还没做完」才允许点完成 —— 已完成的不该再抛一次请求 */
    onComplete() {
      const item = this.data.item as CardItem;
      if (!item || !item.id || item.done) return;
      this.triggerEvent('complete', { id: item.id });
    },
  },
});
