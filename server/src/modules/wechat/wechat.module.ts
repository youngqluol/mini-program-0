import { Module } from '@nestjs/common';
import { WechatService } from './wechat.service';
import { ContentSecurityService } from './content-security.service';
import { MpBindService } from './mp-bind.service';
import { MpCallbackController } from './mp-callback.controller';

/**
 * 微信开放能力模块。
 *
 * 装的东西：
 *   - `WechatService`     code2Session / access_token / 订阅消息下发 / 内容安全检测
 *   - `ContentSecurityService` 用户输入文本的放行策略（全项目唯一策略点）
 *   - `MpBindService`     小程序用户 ↔ 公众号 openid 的绑定
 *   - `MpCallbackController` 微信公众号（测试号）消息回调
 *
 * 为什么 `MpBindService` 放在这里而不是 notify：它的本质是
 * 「拿公众号 openid」，属于微信侧能力；notify 只是**用**它。
 * 这样依赖方向是 notify → wechat，不会成环。
 *
 * 为什么 `ContentSecurityService` 也在这里：它包装的是微信的 `msgSecCheck`，
 * 和 `WechatService` 一样属于「微信侧能力」；thing / memory 模块只是**用**它。
 * 策略（拦什么、放什么）写在服务里而不是散在调用点 —— 见该类注释。
 */
@Module({
  controllers: [MpCallbackController],
  providers: [WechatService, ContentSecurityService, MpBindService],
  exports: [WechatService, ContentSecurityService, MpBindService],
})
export class WechatModule {}
