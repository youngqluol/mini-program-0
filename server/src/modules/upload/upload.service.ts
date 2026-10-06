import { Injectable } from '@nestjs/common';
import type { UploadImageResponse, UploadSceneValue } from '@shared';
import { BusinessException } from '../../common/errors/business.exception';
import { ContentSecurityService } from '../wechat/content-security.service';
import { readImageMeta } from './image-meta';
import { buildObjectKey } from './object-key';
import { StorageService } from './storage.service';

/**
 * multer 塞进 `request.file` 的形状 —— **只列我们用到的字段**。
 *
 * 为什么不写 `Express.Multer.File`：项目里没装 `@types/multer`
 * （`multer` 只是运行时依赖，它的类型全项目只有这一处用得上）。
 * 自己声明 5 个字段比引一个 `@types` 包更省事，也把
 * 「我们只依赖这几样」写在了明面上 —— 将来 multer 加字段我们也不受影响。
 *
 * `buffer` 只在 `memoryStorage` 下存在，而 `UploadController` 显式配了它。
 */
export interface UploadedImageFile {
  /** 表单字段名，恒为 `file`（由 `FileInterceptor('file')` 决定） */
  fieldname: string;
  /** 客户端给的文件名。**不可信**，只用于日志 */
  originalname: string;
  /** 客户端自称的 MIME。**不可信**，只用于日志 */
  mimetype: string;
  /** 字节数（由 multer 统计） */
  size: number;
  /** 文件内容 */
  buffer: Buffer;
}

/**
 * 上传模块（docs/02 §八，M4-2 / M4-4）。
 *
 * 四步，顺序**不能换**：
 *
 *   ① **有没有文件** —— 没收到就没什么好说的
 *   ② **认真实类型** —— 嗅探文件头，不信客户端的 `Content-Type`
 *   ③ **内容安全** —— 在**落盘之前**。违规图片永远不进桶，
 *      省掉「发现违规再去删对象」的补偿逻辑（删失败就是永久留痕）
 *   ④ **写对象存储** —— 失败即 50000，**没有降级**
 *
 * 尺寸上限（5MB）不在这里判：它由 multer 的 `limits.fileSize` 在**流式解析时**
 * 就中止，根本不会走到这个方法 —— 那是**传输层**的守卫（保护内存），
 * 不是业务规则。见 `UploadController` 与 `AllExceptionsFilter` 的 413 分支。
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly storage: StorageService,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  /** `POST /upload/image`（docs/02 §8.1） */
  async uploadImage(
    file: UploadedImageFile | undefined,
    scene: UploadSceneValue,
  ): Promise<UploadImageResponse> {
    if (!file?.buffer?.length) {
      throw BusinessException.invalidParam('没收到图片，再选一次吧');
    }

    const meta = readImageMeta(file.buffer);
    if (!meta.mime) {
      // 文案里写清「只认得哪几种」，别让用户猜是哪里不对。
      // 注意**不回**客户端自称的 MIME —— 那正是我们不信的那个值。
      throw BusinessException.invalidParam('只认得 jpg、png、webp 的图片');
    }

    // 落盘前检测（见类注释 ③）
    await this.contentSecurity.assertImageSafe(file.buffer, meta.mime, `上传图片（${scene}）`);

    const key = buildObjectKey(scene, meta.mime);
    const fileUrl = await this.storage.putImage(key, file.buffer, meta.mime);

    return {
      fileUrl,
      // 回**嗅探出的**类型，不是 `file.mimetype`
      fileType: meta.mime,
      fileSize: file.buffer.length,
      // 解不出来就是 null，不编造 —— 前端按原始比例占位，缺了就按正方形
      width: meta.width,
      height: meta.height,
    };
  }
}
