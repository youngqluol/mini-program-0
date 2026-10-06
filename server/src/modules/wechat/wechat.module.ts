import { Module } from '@nestjs/common';
import { WechatService } from './wechat.service';
import { MpBindService } from './mp-bind.service';
import { MpCallbackController } from './mp-callback.controller';

/**
 * 微信开放能力模块。
 *
 * 装的东西：
 *   - `WechatService`     code2Session / access_token / 订阅消息下发
 *   - `MpBindService`     小程序用户 ↔ 公众号 openid 的绑定
 *   - `MpCallbackController` 微信公众号（测试号）消息回调
 *
 * 为什么 `MpBindService` 放在这里而不是 notify：它的本质是
 * 「拿公众号 openid」，属于微信侧能力；notify 只是**用**它。
 * 这样依赖方向是 notify → wechat，不会成环。
 */
@Module({
  controllers: [MpCallbackController],
  providers: [WechatService, MpBindService],
  exports: [WechatService, MpBindService],
})
export class WechatModule {}
