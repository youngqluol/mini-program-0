/**
 * 送达结果文案 —— **小程序侧镜像**
 *
 * ⚠️⚠️ 权威来源是 `packages/shared/src/dto/notify.ts` 的 `DELIVERY_TOAST`。
 *      改那边必须同步改这里。一致性由 `node tools/check-shared.mjs` 校验
 *      （会逐条比对文案字符串，改一个字就会红）。
 *
 * 为什么不能直接 `import { formatDeliveryToast } from '@shared/dto/notify'`：
 *   见 `constants/error-code.ts` 顶部的说明 —— 小程序端的 TS 编译
 *   **只做类型擦除，不解析 tsconfig 的 paths**，运行时的值必须在本地定义。
 *
 * ⚠️ 文案纪律（AGENTS.md §6）：禁止出现「绑定 / 授权 / 公众号 / openid /
 *    订阅 / 模板消息 / 测试号」。用户只需要知道「微信提醒 开 / 关」。
 *
 * 为什么必须分三档而不是「成功 / 失败」：
 *   NO_QUOTA 和 NOT_BOUND 都是「没送到微信」，但**该做什么完全相反** ——
 *   前者是让对方再开一次微信提醒，后者是对方压根还没开。
 *   混成一句「发送失败」，发起人会按错误的提示去操作（PRD 6.5.6）。
 */

export const DELIVERY_TOAST = {
  /** 已下发到对方微信（通道 ① 公众号模板 或 ② 订阅消息） */
  SENT: '已经叮到{name}啦 🔔',
  /** 额度不足，已转为站内消息 */
  NO_QUOTA: '已记下，{name}再开一次微信提醒就能收到',
  /** 对方还没开微信提醒 */
  NOT_BOUND: '已记下，{name}还没开微信提醒，打开小程序就能看到',
  /** 所有通道都失败 */
  FAILED: '没叮成功，稍后再试',
} as const;

export type DeliveryResultValue = keyof typeof DELIVERY_TOAST;

/**
 * 后端返回了没见过的送达结果时的兜底。
 *
 * 不猜、也不说「失败」：`notification_logs` 是**无条件写入**的（站内兜底是
 * 产品承诺），所以「已记下，打开小程序能看到」在任何情况下都成立。
 */
const UNKNOWN_DELIVERY = '已记下，{name}打开小程序就能看到';

/** 把 `{name}` 换成接收人的家庭称谓（阿妈 / 阿爸 / 阿公 …） */
export function deliveryToast(status: string, roleName: string): string {
  const template: string = (DELIVERY_TOAST as Record<string, string>)[status] ?? UNKNOWN_DELIVERY;
  return template.replace(/\{name\}/g, roleName);
}
