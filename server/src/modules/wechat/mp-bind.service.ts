import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/errors/business.exception';
import { formatDateTime } from '../../common/serialize/beijing-time';
import { MpBindStatus } from '@shared/dto/notify';

/**
 * 公众号提醒绑定服务。
 *
 * 背景：微信的 openid 是「用户 × 应用」维度的。
 *   小程序 openid ≠ 公众号 openid，且无法互相推导。
 *   而 wxpush 发模板消息必须用**公众号 openid**。
 *
 * 绑定链路（见 docs/08-wxpush推送集成方案.md 第五章）：
 *   ① 小程序请求生成 6 位绑定码 → 存 `users.mp_bind_code`（10 分钟有效）
 *   ② 用户扫码关注推送号 → 把绑定码发给公众号
 *   ③ 微信把消息推给我们的回调 → 解析出 openid + 绑定码
 *   ④ 写 users.mp_openid → 绑定完成
 *
 * v0.2.3：不再使用 Redis。绑定码存在 `users` 表的两列里，
 * 同一用户只保留**最新一个**有效码（重新生成会让旧码失效）。
 */

/** 绑定码有效期：10 分钟 */
const CODE_TTL_MS = 10 * 60 * 1000;
/** 同一用户 30 秒内不能重复生成（UI 上表现为「还展示原来那串」） */
const CODE_COOLDOWN_MS = 30 * 1000;
/** 给前端展示的 TTL（秒） */
const CODE_TTL_SECONDS = CODE_TTL_MS / 1000;

/** 绑定码的唯一索引冲突（6 位数字撞车） */
function isDuplicateCode(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** 并发领取同一个码时的内部信号（不向外抛细节） */
class BindCodeRaceError extends Error {}

@Injectable()
export class MpBindService {
  private readonly logger = new Logger(MpBindService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------
  // 小程序侧
  // -------------------------------------------------------------

  /** 查询绑定状态（docs/02 §9.4） */
  async getStatus(userId: bigint): Promise<MpBindStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        mpOpenid: true,
        mpBoundAt: true,
        mpBindCode: true,
        mpBindCodeExpiresAt: true,
      },
    });

    if (user?.mpOpenid) {
      return {
        bound: true,
        // 接口层统一 "YYYY-MM-DD HH:mm:ss"，不要漏出 ISO 的 UTC 串
        boundAt: formatDateTime(user.mpBoundAt) ?? undefined,
        pending: false,
      };
    }

    // 未绑定：看看有没有还没用掉的绑定码，有就继续展示，避免用户来回点
    const pending = await this.readPendingCode(userId, user);
    return pending ?? { bound: false, pending: false };
  }

  /**
   * 生成一个绑定码（docs/02 §9.5）。
   *
   * 6 位数字，避开容易混淆的场景：用户要在微信里手打这串数字，
   * 所以只发数字、不用字母，并且同一用户 30 秒内不能重复生成。
   */
  async createBindCode(userId: bigint): Promise<MpBindStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mpBindCode: true, mpBindCodeExpiresAt: true },
    });

    const existingCode = user?.mpBindCode;
    const existingExpiresAt = user?.mpBindCodeExpiresAt;
    if (existingCode && existingExpiresAt) {
      const remainingMs = existingExpiresAt.getTime() - Date.now();
      // 还在冷却期内（剩余时间 > 总时长 - 冷却）→ 直接把旧码还给他
      if (remainingMs > CODE_TTL_MS - CODE_COOLDOWN_MS) {
        return this.pendingStatus(existingCode, Math.ceil(remainingMs / 1000));
      }
    }

    // 生成一个当前未被占用的码（碰撞概率极低，但仍要防）
    for (let i = 0; i < 5; i++) {
      const candidate = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            mpBindCode: candidate,
            mpBindCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
          },
        });
        return this.pendingStatus(candidate, CODE_TTL_SECONDS);
      } catch (e) {
        if (isDuplicateCode(e)) continue;
        throw e;
      }
    }

    // 连续 5 次都撞码，说明数据状态异常；重试对用户没意义
    throw BusinessException.conflict('刚才没生成出来，稍后再试一次～');
  }

  /** 解除绑定（docs/02 §9.6） */
  async unbind(userId: bigint): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mpOpenid: null,
        mpBoundAt: null,
        mpBindCode: null,
        mpBindCodeExpiresAt: null,
      },
    });
    this.logger.log(`用户 ${userId} 已解除公众号提醒绑定`);
  }

  // -------------------------------------------------------------
  // 微信回调侧
  // -------------------------------------------------------------

  /**
   * 用「公众号 openid + 绑定码」完成绑定。
   *
   * @returns 给用户在公众号里回一条文本消息的内容
   */
  async bindByCode(mpOpenid: string, rawCode: string): Promise<string> {
    const code = rawCode.trim();

    if (!/^\d{6}$/.test(code)) {
      return '绑定码是 6 位数字哦，回到小程序「我的 → 微信提醒」看一下～';
    }

    const target = await this.prisma.user.findFirst({
      where: {
        mpBindCode: code,
        mpBindCodeExpiresAt: { gt: new Date() },
        status: 1,
      },
      select: { id: true },
    });
    if (!target) {
      // 不区分「码不存在」和「码已过期」，避免任何信息泄露
      return '这个绑定码不对或者过期了，回到小程序重新获取一下～';
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // 同一公众号 openid 只能绑一个用户：先解掉旧的
        await tx.user.updateMany({
          where: { mpOpenid, NOT: { id: target.id } },
          data: { mpOpenid: null, mpBoundAt: null },
        });

        // 原子领取：只有码仍有效、仍属于该用户时才成功。
        // 两个回调同时打进来时，只有一个能把 mp_bind_code 清空。
        const claimed = await tx.user.updateMany({
          where: {
            id: target.id,
            mpBindCode: code,
            mpBindCodeExpiresAt: { gt: new Date() },
            status: 1,
          },
          data: {
            mpOpenid,
            mpBoundAt: new Date(),
            mpBindCode: null,
            mpBindCodeExpiresAt: null,
          },
        });
        if (claimed.count === 0) throw new BindCodeRaceError();
      });
    } catch (e) {
      if (e instanceof BindCodeRaceError) {
        return '这个绑定码刚被用掉了，回到小程序重新获取一下～';
      }
      throw e;
    }

    this.logger.log(`用户 ${target.id} 绑定公众号提醒成功`);
    return '绑定成功 ✅ 以后家里有事，会在这里提醒你～';
  }

  /**
   * 保底方案：管理员手工录入 openid。
   * 家人只有两三个、懒得走回调流程时用，见方案文档 5.3。
   */
  async bindManually(userId: bigint, mpOpenid: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mpOpenid,
        mpBoundAt: new Date(),
        mpBindCode: null,
        mpBindCodeExpiresAt: null,
      },
    });
    this.logger.log(`用户 ${userId} 手工绑定 openid 成功`);
  }

  // -------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------

  /** 读出当前未过期的待用绑定码；没有则返回 null */
  private async readPendingCode(
    userId: bigint,
    user?: { mpBindCode: string | null; mpBindCodeExpiresAt: Date | null } | null,
  ): Promise<MpBindStatus | null> {
    const row =
      user ??
      (await this.prisma.user.findUnique({
        where: { id: userId },
        select: { mpBindCode: true, mpBindCodeExpiresAt: true },
      }));

    const code = row?.mpBindCode;
    const expiresAt = row?.mpBindCodeExpiresAt;
    if (!code || !expiresAt) return null;

    const remainingMs = expiresAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      // 已经过期，顺手清掉，避免下次读到脏数据
      await this.prisma.user.update({
        where: { id: userId },
        data: { mpBindCode: null, mpBindCodeExpiresAt: null },
      });
      return null;
    }
    return this.pendingStatus(code, Math.ceil(remainingMs / 1000));
  }

  private pendingStatus(code: string, ttlSeconds: number): MpBindStatus {
    return {
      bound: false,
      pending: true,
      bindCode: code,
      bindCodeExpireAt: formatDateTime(
        new Date(Date.now() + ttlSeconds * 1000),
      ) as string,
    };
  }
}
