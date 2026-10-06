import { IsInt, IsString, Length, Max, Min } from 'class-validator';

/**
 * `POST /api/auth/subscribe-quota` 请求（docs/02 §2.4）。
 *
 * 前端在 `wx.requestSubscribeMessage` 成功回调里**静默**上报，用来给额度池记账。
 * 记账的意义：订阅消息是**一次性**的，不记账就会出现「以为能发、
 * 实际微信回 43101」的假成功。
 *
 * ⚠️ 两个刻意的选择：
 *   ① 每个校验器都写中文 message —— class-validator 的默认文案是英文
 *      （`count must not be greater than 10`），会原样漏出去。
 *   ② 文案用**字段名**而不是「昵称有点长哦」那类口语 ——
 *      这个接口用户看不到，说清是哪个参数对排查更有用；
 *      也顺带避开 AGENTS.md §6 的禁用词（授权 / 绑定 / 订阅…）。
 */
export class ReportSubscribeQuotaDto {
  /** 订阅消息模板 ID（小程序后台公共模板库给的，43 位左右） */
  @IsString({ message: 'templateId 传得不对' })
  @Length(20, 64, { message: 'templateId 长度不对' })
  templateId!: string;

  /**
   * 本次拿到授权的次数。
   *
   * 微信一次 `requestSubscribeMessage` 对单个模板最多 +1，
   * 所以正常只会传 1；上限放到 10 是为了容错，服务端还会再钳一次。
   */
  @IsInt({ message: 'count 得是整数' })
  @Min(1, { message: 'count 至少是 1' })
  @Max(10, { message: 'count 最多是 10' })
  count!: number;
}
