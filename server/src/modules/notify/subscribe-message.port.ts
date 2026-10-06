/**
 * 订阅消息通道端口。
 *
 * 为什么要有这层接口：`notify` 模块负责**通道选择与降级**，
 * 但它不该知道「订阅消息怎么发」。真实实现是 `SubscribeMessageAdapter`
 * （调微信 `subscribe/send` + 管理 Redis 额度池），notify.service 只依赖这个契约。
 *
 * 好处：notify 模块可以脱离微信单独测试；订阅消息通道没接通时，
 * 换成「永远返回 false」的实现即可，主流程自动降级到站内消息。
 *
 * ⚠️ `templateData` 由 `notify.templates.ts` 组装好再传进来，
 *    实现方**不要**自己拼字段名 —— 文案与模板的唯一定义处在 notify 侧。
 */
import type { NotifyType } from '@shared/enums';

export interface SubscribeMessagePort {
  /**
   * 该用户在该类通知上是否还有订阅额度。
   *
   * 这是 `send()` 的**前置快筛**：额度为 0 时直接返回，省掉一次查
   * `users.openid` 的数据库往返。真正的扣减在 `send()` 里原子完成，
   * 所以这里读到脏数据也不会多发。
   */
  hasQuota(userId: bigint, type: NotifyType): Promise<boolean>;

  /**
   * 下发一条订阅消息，返回是否成功。
   *
   * ⚠️ 实现方**不得抛异常**：订阅消息是辅助通道，
   *    失败必须能安静降级到站内消息。
   */
  send(params: {
    userId: bigint;
    /** 通知类型 —— 实现方据此选择对应的订阅消息模板 */
    type: NotifyType;
    /** 已组装好的模板数据，字段名与后台模板严格一致 */
    templateData: Record<string, { value: string }>;
    /** 点击消息跳转的页面（含 query） */
    page?: string;
    title: string;
    content: string;
    thingId?: bigint;
  }): Promise<boolean>;
}

export const SUBSCRIBE_MESSAGE_PORT = Symbol('SUBSCRIBE_MESSAGE_PORT');
