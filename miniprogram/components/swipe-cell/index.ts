/**
 * 左滑露出操作（P11 我的小事；P12 消息中心以后也能用）
 *
 * 为什么抽成组件，而不是在页面里手写 touch：
 *
 * 1. **横滑与竖滚必须仲裁。** 手指斜着划时，得先判出用户到底想滚列表还是想滑开
 *    这一行 —— 判错了要么列表滚不动，要么一滚就把好几行都滑开了。
 *    判据是「位移先超过 6px 的那个方向」（见 `onTouchMove`），
 *    一旦定为纵向就彻底不管，把滚动还给页面。
 *
 * 2. **同一时刻只允许开一行。** 所以「哪一行开着」由**页面**持有（`openId`），
 *    组件只回答「我这一行该不该开着」—— 受控组件。否则每行各自记状态，
 *    开第二行时没人去关第一行，最后满屏都是开着的抽屉。
 *
 * 3. **`actions` 为空就完全不响应手势。** 一行没有任何能做的事时，
 *    滑开一个空抽屉比滑不动更让人困惑。
 *
 * 事件：
 *   open   → { id }       这一行被滑开（页面据此关掉别的行）
 *   close  → { id }       这一行被滑回去
 *   action → { key, id }  点了某个操作
 *
 * ⚠️ 用 `bindtouchmove` 而不是 `catchtouchmove`：后者会吃掉事件，
 *    列表就再也滚不动了。宁可让横滑时列表轻微跟动一下。
 */

/** 每个操作按钮的宽度（px）—— 与 index.wxss 里的 `.swipe__action` 必须一致 */
const ACTION_WIDTH = 84;

/** 判定「用户到底想干什么」的最小位移（px）。太小会把抖动当滑动 */
const AXIS_THRESHOLD = 6;

type Axis = '' | 'x' | 'y';

Component({
  properties: {
    /** 这一行的标识（传小事 ID） */
    itemId: { type: Number, value: 0 },
    /** 当前被滑开的那一行；0 表示都关着 */
    openId: { type: Number, value: 0 },
    /** `ThingRowAction[]`：`[{ key, label, tone }]` */
    actions: { type: Array, value: [] },
  },

  data: {
    /** 抽屉总宽，等于操作个数 × 单个宽度 */
    width: 0,
    /** 内容区横向位移，0 表示关着 */
    offset: 0,
    /** 手指正在横滑 —— 期间关掉 transition，否则跟手会「追不上」 */
    dragging: false,

    // ---- 手势中间态 ----
    // 放进 `data` 而不是挂 `this.xxx`：小程序组件的 TS 类型里没有自定义实例字段的
    // 位置，挂 `this` 要么编译不过，要么得把 Component 的四个泛型全写出来（很吵）。
    // 这几个字段不参与渲染，多两次 setData 的代价可以忽略。
    touchStartX: 0,
    touchStartY: 0,
    touchStartOffset: 0,
    /** 方向判定结果：'' 还没定 / 'x' 横滑 / 'y' 竖滚 */
    touchAxis: '' as Axis,
  },

  observers: {
    'openId, itemId, actions'(openId: number, itemId: number, actions: unknown[]) {
      // 正在拖的时候别插队改 offset，否则手指底下那一行会突然跳
      if (this.data.dragging) return;
      const width = (actions || []).length * ACTION_WIDTH;
      this.setData({ width, offset: openId === itemId ? -width : 0 });
    },
  },

  methods: {
    onTouchStart(e: WechatMiniprogram.TouchEvent) {
      if (this.data.width === 0) return;
      const touch = e.touches[0];
      this.setData({
        touchStartX: touch.clientX,
        touchStartY: touch.clientY,
        touchStartOffset: this.data.offset,
        touchAxis: '',
      });
    },

    onTouchMove(e: WechatMiniprogram.TouchEvent) {
      if (this.data.width === 0 || this.data.touchAxis === 'y') return;
      const touch = e.touches[0];
      const dx = touch.clientX - this.data.touchStartX;
      const dy = touch.clientY - this.data.touchStartY;

      // 方向还没定：等位移够大再判，判成纵向就再也不管（把滚动还给页面）
      if (this.data.touchAxis === '') {
        if (Math.abs(dx) < AXIS_THRESHOLD && Math.abs(dy) < AXIS_THRESHOLD) return;
        const axis: Axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        this.setData({ touchAxis: axis });
        if (axis === 'y') return;
      }

      // 只往左拉；往右最多收回到 0（不做出「拉出右边」的手感）
      let next = this.data.touchStartOffset + dx;
      if (next > 0) next = 0;
      if (next < -this.data.width) next = -this.data.width;

      this.setData({ offset: next, dragging: true });
    },

    onTouchEnd() {
      if (this.data.touchAxis !== 'x') {
        this.setData({ touchAxis: '' });
        return;
      }

      // 过半就吸附到打开，否则弹回去 —— 不给「停在中间」这种半吊子状态
      const opened = this.data.offset < -this.data.width / 2;
      this.setData({
        offset: opened ? -this.data.width : 0,
        dragging: false,
        touchAxis: '',
      });
      this.triggerEvent(opened ? 'open' : 'close', { id: this.data.itemId });
    },

    onAction(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('action', {
        key: e.currentTarget.dataset.key,
        id: this.data.itemId,
      });
    },
  },
});
