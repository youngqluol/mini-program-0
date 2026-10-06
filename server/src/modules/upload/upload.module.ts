import { Module } from '@nestjs/common';
import { WechatModule } from '../wechat/wechat.module';
import { StorageService } from './storage.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

/**
 * 上传模块（M4-2 / M4-4）。
 *
 * 依赖 `WechatModule` 是为了拿 `ContentSecurityService`（图片内容安全），
 * 而 `ContentSecurityService` 自己要 `PrismaService`（查用户 openid）——
 * 图片检测那条路径其实用不到 openid，但文本检测用，所以整体一起注入。
 */
@Module({
  imports: [WechatModule],
  controllers: [UploadController],
  providers: [UploadService, StorageService],
  // 导出 StorageService：`MemoryService` 要用 `publicBaseUrl()`
  // 校验留念附件确实来自我们自己的桶（见该类注释）
  exports: [StorageService],
})
export class UploadModule {}
