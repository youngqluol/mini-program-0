/**
 * 轻提示封装
 *
 * 纪律（AGENTS.md §6）：**面向用户的文案里不许出现技术词与机制词**
 * （绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号 / 待办 / 逾期 …）。
 * 后端返回的 `message` 已经是人话，前端**原样透出**即可，不要在这里二次加工。
 */

/** 从任意异常里抠出给用户看的一句话 */
export function messageOf(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return '出了点小问题，再试一次';
}

/** 一句话提示（默认 2 秒） */
export function toast(title: string, duration = 2000): void {
  wx.showToast({ title, icon: 'none', duration });
}

/** 把异常直接提示出来 —— 页面 catch 里的默认动作 */
export function toastError(e: unknown): void {
  toast(messageOf(e));
}

/** 成功提示（带勾） */
export function toastOk(title: string): void {
  wx.showToast({ title, icon: 'success', duration: 1500 });
}

/** 二次确认。返回用户是否点了确定。 */
export function confirm(options: {
  title: string;
  content?: string;
  confirmText?: string;
  confirmColor?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content ?? '',
      confirmText: options.confirmText ?? '确定',
      cancelText: '再想想',
      confirmColor: options.confirmColor ?? '#F2637B',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

/**
 * 底部操作表式的确认（docs/03 P10 明确要求「底部 ActionSheet」）。
 *
 * 和 `confirm()`（居中弹窗）的区别只有**位置**，但位置就是意思：
 * 从底部升起的操作表读起来是「我正在对这条内容做点什么」，
 * 居中弹窗读起来是「系统在拦你」。低风险但仍需停一下的动作
 * （取消这件事）用前者，用户不会被吓一跳，也仍然停了一下。
 *
 * ⚠️ `wx.showActionSheet` 的选项**不能单独染色**，做不了 iOS 那种红字
 *    「删除」。所以破坏性的语义得靠文案自己说清楚（「确认取消」），
 *    别指望颜色。
 */
export function confirmSheet(options: { message: string; actionText: string }): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showActionSheet({
      alertText: options.message,
      itemList: [options.actionText],
      success: (res) => resolve(res.tapIndex === 0),
      // 点「取消」或点遮罩都会走 fail —— 都是「不继续」，不是错误
      fail: () => resolve(false),
    });
  });
}

/** 轻量 loading（会自动配一个 hide） */
export function showLoading(title = '稍等一下'): void {
  wx.showLoading({ title, mask: true });
}

export function hideLoading(): void {
  wx.hideLoading();
}

/**
 * 危险操作的二次确认 —— 要求用户**把指定文本原样输一遍**。
 *
 * 解散家庭这类操作是不可逆的（数据保留但家没了），一个「确定」按钮太轻。
 * 让用户亲手打出家庭名，是让他停一下、确认自己真的要这么做。
 */
export function confirmWithText(options: {
  title: string;
  placeholder: string;
  /** 要求用户输入的文本 */
  expect: string;
  confirmText?: string;
  mismatchMessage?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      editable: true,
      placeholderText: options.placeholder,
      confirmText: options.confirmText ?? '确定',
      cancelText: '再想想',
      confirmColor: '#F2637B',
      success: (res) => {
        if (!res.confirm) {
          resolve(false);
          return;
        }
        const input = (res.content ?? '').trim();
        if (input !== options.expect) {
          toast(options.mismatchMessage ?? '没对上，先不继续了');
          resolve(false);
          return;
        }
        resolve(true);
      },
      fail: () => resolve(false),
    });
  });
}
