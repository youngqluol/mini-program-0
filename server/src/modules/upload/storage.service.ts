import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@shared';
import { BusinessException } from '../../common/errors/business.exception';
import { buildCosAuthorization } from './cos-sign';

/**
 * 对象存储（腾讯云 COS）—— 只做两件事：**把一段二进制写进桶里**、
 * **告诉别人桶的公开前缀是什么**。
 *
 * ## 为什么不用 `cos-nodejs-sdk-v5`
 *
 * 我们只用到 `PUT Object` 一个动作。SDK 会带进十几个传递依赖，
 * 而签名本身是 HMAC-SHA1 + SHA1 的固定四步（`cos-sign.ts`，有官方示例自检）。
 * 少一个依赖就少一份要跟着升级的攻击面。
 *
 * ## 为什么配置缺失时**直接报错**，而不是降级
 *
 * 内容安全检测判不了可以放行（那是**辅助能力**，见 `ContentSecurityService`），
 * 但存储是**核心能力** —— 存不下就是存不下，没有「先假装成功」这个选项。
 * 假装成功会让用户以为照片发出去了，实际什么都没有，比直接失败恶劣得多。
 *
 * 所以这里：日志里把**缺哪个变量**写清楚（给运维），
 * 回给用户的仍是一句人话（50000 的通用文案）。
 *
 * ## 部署注意
 *
 * 微信云托管的容器文件系统是**临时的**（重新部署即清空），
 * 所以**不能**退化成「写到本地磁盘」—— 那不是降级，那是丢数据。
 */

/** 一次 PUT 用一次签名，60 秒足够（签名只在这一个请求里有效） */
const COS_SIGN_EXPIRES_IN = 60;

/** 上传超时。5MB 图片在移动网络下要留足时间 */
const COS_TIMEOUT_MS = 15_000;

interface CosConfig {
  bucket: string;
  region: string;
  secretId: string;
  secretKey: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /**
   * 配置读一次就缓存。
   *
   * 两个理由：① 环境变量运行期不会变；
   * ② `publicBaseUrl()` 会被「每条留念的每个附件」调用，不缓存就会
   *    在未配置时把同一条 error 日志刷满（也会让配置读取变成热点）。
   * `undefined` = 还没读过，`null` = 读过且不完整。
   */
  private configCache: CosConfig | null | undefined;

  constructor(private readonly config: ConfigService) {}

  /**
   * 桶的公开访问前缀，形如 `https://mybucket-1250000000.cos.ap-shanghai.myqcloud.com`。
   *
   * 给「留个念」用来**校验附件 URL 确实来自我们自己的桶** ——
   * 否则任何人可以把任意外部 URL（追踪像素、别人的图）塞进留念。
   * 未配置存储时返回 `null`，由调用方决定怎么处理。
   */
  publicBaseUrl(): string | null {
    const cos = this.readConfig();
    return cos ? `https://${cos.bucket}.cos.${cos.region}.myqcloud.com` : null;
  }

  /**
   * 写一张图片进桶，返回可公开访问的 URL。
   *
   * @param key  对象 key，形如 `memories/2026/10/xxx.jpg`（见 `object-key.ts`）
   * @param body 图片二进制
   * @param mime 服务端嗅探出的真实 MIME
   */
  async putImage(key: string, body: Buffer, mime: string): Promise<string> {
    const cos = this.readConfig();
    if (!cos) throw new BusinessException(ErrorCode.INTERNAL_ERROR);

    // COS 的桶名带 APPID 后缀（`mybucket-1250000000`），所以域名是
    // `<桶名>.cos.<地域>.myqcloud.com`，而不是再拼一次 APPID
    const host = `${cos.bucket}.cos.${cos.region}.myqcloud.com`;
    const pathname = `/${key}`;

    const { authorization } = buildCosAuthorization({
      secretId: cos.secretId,
      secretKey: cos.secretKey,
      method: 'PUT',
      pathname,
      // **只签 host**：官方明确「不需要处理全部头部，可按需筛选」，
      // 签得越少，能写错的地方越少（Content-Type 不参与签名也能正常上传）
      headers: { host },
      expiresIn: COS_SIGN_EXPIRES_IN,
    });

    let res: Response;
    try {
      res = await fetch(`https://${host}${pathname}`, {
        method: 'PUT',
        headers: { Authorization: authorization, 'Content-Type': mime },
        body,
        signal: AbortSignal.timeout(COS_TIMEOUT_MS),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`COS 上传网络异常 key=${key}: ${msg}`);
      throw new BusinessException(ErrorCode.INTERNAL_ERROR);
    }

    if (!res.ok) {
      // COS 的错误体是 XML，`<Code>SignatureDoesNotMatch</Code>` 那一行最有价值。
      // 原文进日志（排查用），**一个字都不回给用户**。
      const text = await res.text().catch(() => '');
      this.logger.error(`COS 上传失败 key=${key} status=${res.status} body=${text.slice(0, 300)}`);
      throw new BusinessException(ErrorCode.INTERNAL_ERROR);
    }

    return `https://${host}${pathname}`;
  }

  /** 读一次配置（带缓存）。四个变量缺任何一个都视为「没配」，并把缺的那个写进日志 */
  private readConfig(): CosConfig | null {
    if (this.configCache !== undefined) return this.configCache;

    const bucket = this.config.get<string>('COS_BUCKET')?.trim() ?? '';
    const region = this.config.get<string>('COS_REGION')?.trim() ?? '';
    const secretId = this.config.get<string>('COS_SECRET_ID')?.trim() ?? '';
    const secretKey = this.config.get<string>('COS_SECRET_KEY')?.trim() ?? '';

    const missing = (
      [
        ['COS_BUCKET', bucket],
        ['COS_REGION', region],
        ['COS_SECRET_ID', secretId],
        ['COS_SECRET_KEY', secretKey],
      ] as const
    )
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (missing.length > 0) {
      this.logger.error(
        `对象存储未配置，缺：${missing.join(' / ')}（见 server/.env.example 第 8 节）`,
      );
      this.configCache = null;
      return null;
    }

    this.configCache = { bucket, region, secretId, secretKey };
    return this.configCache;
  }
}
