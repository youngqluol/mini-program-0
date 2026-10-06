import { Module } from '@nestjs/common';
import { FamiliesModule } from '../families/families.module';
import { UploadModule } from '../upload/upload.module';
import { WechatModule } from '../wechat/wechat.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

/**
 * 留个念模块（M4-5 ~ M4-7）。
 *
 * 三个依赖各有明确用途：
 *   `FamiliesModule` —— 反查成员上下文、取家庭创建者（与别的业务模块一致）
 *   `WechatModule`   —— `ContentSecurityService` 做正文的内容安全
 *   `UploadModule`   —— `StorageService.publicBaseUrl()` 校验图片地址来自本桶
 */
@Module({
  imports: [FamiliesModule, WechatModule, UploadModule],
  controllers: [MemoryController],
  providers: [MemoryService],
})
export class MemoryModule {}
