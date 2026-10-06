import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UPLOAD_MAX_IMAGE_BYTES } from '@shared';
import type { UploadImageResponse } from '@shared';
import { UploadImageDto } from './dto/upload.dto';
import { UploadService } from './upload.service';
import type { UploadedImageFile } from './upload.service';

/**
 * 上传模块（docs/02 §八）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   POST /api/upload/image   上传一张图片（multipart/form-data）
 *
 * 鉴权：**只有全局 `JwtGuard`（要登录），不挂 `FamilyMemberGuard`**。
 * 为什么不需要家庭上下文：这一步只是「把一张图存进桶里换回一个 URL」，
 * 它不知道也不该知道这张图将来属于哪个家庭 ——
 * 「这张图能不能进这条留念」由 `POST /memories` 在写入时校验
 * （见 `MemoryService`，那里会检查 URL 前缀属于本家庭）。
 * 提前在守卫里要 `familyId`，只会让「先传图再选可见范围」的 P18 多绕一圈。
 */
@Controller('upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  /**
   * 上传图片（M4-4）。
   *
   * ⚠️ `storage: memoryStorage()` 是**显式写的，不是默认值**。
   *    multer 恰好默认就是内存存储，但一旦哪个版本改了默认（或有人
   *    加了全局 `MulterModule.register({ dest })`），`file.buffer`
   *    会变成 `undefined` —— 而错误会表现为「图片类型不对」，
   *    排查方向完全错。显式写下来，这个坑就不存在了。
   *
   * ⚠️ `limits.fileSize` 是**传输层的硬上限**，在流式解析时就中止超限上传，
   *    不会把 5MB+ 的数据先读进内存再判断。它是保护内存的守卫，
   *    不是业务规则 —— 所以业务层不再重复判一次（那会变成永远走不到的死代码）。
   *    超限时 multer 抛 `PayloadTooLargeException`(413)，
   *    由 `AllExceptionsFilter` 归一到 40001 并换成中文文案。
   */
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: UPLOAD_MAX_IMAGE_BYTES,
        files: 1,
        // 表单里只有 scene 一个非文件字段；给一点余量但不放开
        fields: 4,
      },
    }),
  )
  async image(
    @UploadedFile() file: UploadedImageFile,
    @Body() dto: UploadImageDto,
  ): Promise<UploadImageResponse> {
    return this.upload.uploadImage(file, dto.scene);
  }
}
