import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/errors/business.exception';
import { SEC_CHECK_SCENE, WechatService, IMG_SEC_CHECK_MAX_BYTES } from './wechat.service';

/**
 * 用户输入内容的安全检测（M2-B9 文本 / M4-3 图片）—— **全项目唯一的策略点**。
 *
 * 为什么要有这一层，而不是各处直接调 `WechatService.msgSecCheck`：
 *   `msgSecCheck` / `imgSecCheck` 只回答「判出来了没有、判成什么」，
 *   **不决定放不放行**。而「微信判不了的时候放行还是拦截」是个**产品判断**，
 *   必须只写一遍 —— 否则今天这里放行、明天那里拦截，就成了随机行为。
 *
 * 对外只有两个方法，对应两类用户输入：
 *   `assertTextSafe()`  文本 —— 小事标题/内容、留念正文、家庭名、称谓
 *   `assertImageSafe()` 图片 —— 头像、留念配图（M4-3）
 *
 * ── 本层的策略：拦「确定违规」，放「不确定」 ────────────────────
 *
 * | 微信结论 | 处理 | 理由 |
 * | --- | --- | --- |
 * | `risky`（违规） | **拦**，抛 40002 | 审核硬性要求，不能放 |
 * | `review`（建议复核，仅文本有） | 放行 + 记日志 | 家庭场景没有人工复核队列，拦了就是永久损失；且这一档误伤率高 |
 * | `pass` | 放行 | — |
 * | 判不了（网络 / 凭证 / errcode / 超出接口限制） | **放行** + 记 warn | 见下 |
 *
 * **为什么「判不了」要放行（fail-open）**：
 *   微信抖一下、access_token 过期、个人主体没开通这个接口 —— 都会让检测失败。
 *   如果失败就拦截，那么「阿妈，记得买牛奶」也发不出去，
 *   家里人只会觉得「这破小程序又坏了」，而违规内容的实际风险是零
 *   （V0.1 只有自己家用，没有公开传播面）。
 *   所以这里选择：**宁可漏拦一条，不可让全家用不了**。
 *
 * ⚠️ 这个取舍在**公开传播场景下要重新评估**（V1.0 若有分享/广场类功能）。
 */
@Injectable()
export class ContentSecurityService {
  private readonly logger = new Logger(ContentSecurityService.name);

  /** 惰性读一次配置，避免每条小事都查 ConfigService */
  private enabledCache: boolean | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly wechat: WechatService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 断言一段用户输入的文本可以入库。**不通过则抛 40002**。
   *
   * 调用点应当是「写库之前」——检测失败要能整体回滚，不留半条数据。
   *
   * @param userId 发起人（用来查小程序 openid，v2 接口必传）
   * @param text   待检测文本
   * @param what   中文描述，**只用于日志**（如「小事的标题」），帮运维定位是哪段内容出的问题
   */
  async assertTextSafe(
    userId: bigint,
    text: string | null | undefined,
    what: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const content = text?.trim();
    // 空内容不检测：这类输入本来就该被参数校验拦掉，
    // 在这里再报 40002 会把「没填」说成「有敏感词」，误导用户。
    if (!content) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { openid: true },
    });
    if (!user?.openid) {
      // 理论上不会发生（登录时必有 openid）。真发生了也放行，别阻塞用户。
      this.logger.warn(`内容安全跳过（用户 ${userId} 没有 openid）：${what}`);
      return;
    }

    const res = await this.wechat.msgSecCheck({
      openid: user.openid,
      content: truncate(content, what, this.logger),
      scene: SEC_CHECK_SCENE.SOCIAL_LOG,
    });

    if (!res.ok) {
      // fail-open：见类注释。这里必须是 warn 而不是 error —— 不是故障，是降级。
      this.logger.warn(
        `内容安全判不了，放行：${what} errcode=${res.errcode ?? '-'} errmsg=${res.errmsg ?? '-'}`,
      );
      return;
    }

    if (res.suggest === 'risky') {
      this.logger.warn(`内容安全拦截：${what} label=${res.label ?? '-'} userId=${userId}`);
      // 不回 label / 命中词：既没帮助又像在指责人（见 BusinessException.sensitiveContent）
      throw BusinessException.sensitiveContent();
    }

    if (res.suggest === 'review') {
      this.logger.warn(`内容安全建议复核，本次放行：${what} label=${res.label ?? '-'}`);
    }
  }

  /**
   * 断言一张用户上传的图片可以入库。**不通过则抛 40002**（M4-3）。
   *
   * 与 `assertTextSafe` 共用**同一套策略**（拦「确定违规」，放「不确定」），
   * 只是图片接口只有两档结论：`errcode=0` 正常 / `87014` 有风险。
   *
   * ⚠️ **调用时机：在写入对象存储之前**（`UploadService` 里）。
   *    先检测再落盘，违规图片**永远不会**出现在存储桶里 ——
   *    否则就得写一套「发现违规再去删对象」的补偿逻辑。
   *
   * ⚠️ 两道「判不了就放行」的分支，都**不是**故障而是设计：
   *    ① 图片超过 `IMG_SEC_CHECK_MAX_BYTES`（1MB，微信接口硬限制）——
   *       产品允许 5MB，超限的图根本没法用这个接口检。**记 warn 后放行**。
   *       实际影响有限：P18 用 `sizeType: ['compressed']`，压缩后通常 100–500KB。
   *    ② 网络 / 凭证 / 48001 未开通 —— 同 `assertTextSafe`，宁可漏拦不可全家用不了。
   *
   * @param buffer 图片二进制
   * @param mime   图片 MIME（服务端**嗅探**出来的，不是客户端自称的）
   * @param what   中文描述，**只用于日志**（如「留念里的第 2 张图」）
   */
  async assertImageSafe(buffer: Buffer, mime: string, what: string): Promise<void> {
    if (!this.isEnabled()) return;

    if (buffer.byteLength > IMG_SEC_CHECK_MAX_BYTES) {
      this.logger.warn(
        `图片内容安全跳过（${formatKb(buffer.byteLength)} 超过接口上限 ` +
          `${formatKb(IMG_SEC_CHECK_MAX_BYTES)}）：${what}`,
      );
      return;
    }

    const res = await this.wechat.imgSecCheck({ buffer, mime, filename: what });

    if (!res.ok) {
      // fail-open：见类注释。warn 而不是 error —— 不是故障，是降级。
      this.logger.warn(
        `图片内容安全判不了，放行：${what} errcode=${res.errcode ?? '-'} errmsg=${res.errmsg ?? '-'}`,
      );
      return;
    }

    if (res.risky) {
      this.logger.warn(`图片内容安全拦截：${what} mime=${mime}`);
      throw BusinessException.sensitiveContent();
    }
  }

  /** 是否启用检测。默认**开**；本地要关就显式写 `CONTENT_SECURITY_ENABLED=false`。 */
  private isEnabled(): boolean {
    if (this.enabledCache == null) {
      const raw = this.config.get<string>('CONTENT_SECURITY_ENABLED')?.trim().toLowerCase();
      this.enabledCache = raw !== 'false' && raw !== '0';
    }
    return this.enabledCache;
  }
}

/** 微信单次检测的文本上限（超过会直接报错，不是截断） */
const WX_CONTENT_LIMIT = 2500;

/**
 * 超长就**截断**，而不是跳过检测。
 *
 * 跳过等于「越长越不查」，恰恰放过了最该看的内容。
 * 截断后继续检测，至少覆盖前 2500 字；但要**留痕** ——
 * 超长本身说明产品侧的字数校验漏了。
 */
function truncate(text: string, what: string, logger: Logger): string {
  if (text.length <= WX_CONTENT_LIMIT) return text;
  logger.warn(
    `${what} 超过 ${WX_CONTENT_LIMIT} 字（${text.length} 字），只检测前 ${WX_CONTENT_LIMIT} 字`,
  );
  return text.slice(0, WX_CONTENT_LIMIT);
}

/** 把字节数写成「1.2MB」这种日志里一眼能读的量级 */
function formatKb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}
