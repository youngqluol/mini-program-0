import { Module } from '@nestjs/common';
import { WxpushClient } from './wxpush.client';
import { NotifyService } from './notify.service';
import { NotifyController } from './notify.controller';
import { SUBSCRIBE_MESSAGE_PORT } from './subscribe-message.port';
import { SubscribeMessageAdapter } from './subscribe-message.adapter';
import { SubscribeQuotaService } from './subscribe-quota.service';
import { WechatModule } from '../wechat/wechat.module';

/**
 * 通知模块 —— 三通道降级全部收在这里。
 *
 * 装的东西：
 *   - `WxpushClient`            通道一：公众号模板消息（主力，走 Cloudflare Worker）
 *   - `SubscribeMessageAdapter` 通道二：小程序订阅消息（辅助，实现 SubscribeMessagePort）
 *   - `SubscribeQuotaService`   通道二的额度池（Redis 记账）
 *   - `NotifyService`           通道选择 + 降级 + 写 notification_logs
 *
 * 依赖：
 *   - `PrismaService` / `RedisService`：全局模块，无需 import
 *   - `WechatModule`：借用 `WechatService` 的 HTTP 能力（code2Session / access_token /
 *     订阅消息下发）与 `MpBindService`（绑定接口用）
 *
 * 为什么订阅消息的**实现**也放在 notify 而不是 wechat：
 *   这样整条订阅消息链路（模板定义 → 额度池 → 下发 → 降级）都在一个模块里，
 *   依赖方向保持 notify → wechat 单向，不会成环。
 *
 * 对外暴露 `NotifyService`（发通知）与 `SubscribeQuotaService`（AuthController
 * 上报/查询订阅额度用），供 thing / reminder / family / auth 模块调用。
 */
@Module({
  imports: [WechatModule],
  controllers: [NotifyController],
  providers: [
    WxpushClient,
    NotifyService,
    SubscribeQuotaService,
    SubscribeMessageAdapter,
    {
      // 真实实现 —— 早期这里是「永远返回 false」的占位，
      // 等三个订阅消息模板申请下来后才换成适配器（M0-15）。
      provide: SUBSCRIBE_MESSAGE_PORT,
      useExisting: SubscribeMessageAdapter,
    },
  ],
  exports: [NotifyService, WxpushClient, SubscribeQuotaService],
})
export class NotifyModule {}
