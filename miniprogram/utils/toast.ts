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

/** 轻量 loading（会自动配一个 hide） */
export function showLoading(title = '稍等一下'): void {
  wx.showLoading({ title, mask: true });
}

export function hideLoading(): void {
  wx.hideLoading();
}
