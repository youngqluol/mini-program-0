import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys, RedisTtl } from '../../redis/redis.keys';
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
 *   ① 小程序请求生成 6 位绑定码 → 存 Redis（TTL 10 分钟）
 *   ② 用户扫码关注推送号 → 把绑定码发给公众号
 *   ③ 微信把消息推给我们的回调 → 解析出 openid + 绑定码
 *   ④ 写 users.mp_openid → 绑定完成
 */
@Injectable()
export class MpBindService {
  private readonly logger = new Logger(MpBindService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // -------------------------------------------------------------
  // 小程序侧
  // -------------------------------------------------------------

  /** 查询绑定状态（docs/02 §9.4） */
  async getStatus(userId: bigint): Promise<MpBindStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mpOpenid: true, mpBoundAt: true },
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
    const pending = await this.readPendingCode(userId);
    return pending ?? { bound: false, pending: false };
  }

  /**
   * 生成一个绑定码（docs/02 §9.5）。
   *
   * 6 位数字，避开容易混淆的场景：用户要在微信里手打这串数字，
   * 所以只发数字、不用字母，并且同一用户 30 秒内不能重复生成。
   */
  async createBindCode(userId: bigint): Promise<MpBindStatus> {
    const existingCode = await this.redis.get(RedisKeys.mpBindCodeOfUser(userId));
    if (existingCode) {
      const ttl = await this.redis.ttl(RedisKeys.mpBindCode(existingCode));
      // 还在冷却期内（剩余 TTL 大于「总时长 - 冷却」）→ 直接把旧码还给他
      if (ttl > RedisTtl.MP_BIND_CODE - RedisTtl.MP_BIND_COOLDOWN) {
        return this.pendingStatus(existingCode, ttl);
      }
    }

    // 生成一个当前未被占用的码（碰撞概率极低，但仍要防）
    let code: string | null = null;
    for (let i = 0; i < 5; i++) {
      const candidate = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const taken = await this.redis.get(RedisKeys.mpBindCode(candidate));
      if (!taken) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      // 连续 5 次都撞码，说明 Redis 状态异常；重试对用户没意义
      throw BusinessException.conflict('刚才没生成出来，稍后再试一次～');
    }

    // 双向索引：code → userId（回调时用），userId → code（前端轮询时用）
    await this.redis.set(
      RedisKeys.mpBindCode(code),
      String(userId),
      RedisTtl.MP_BIND_CODE,
    );
    await this.redis.set(
      RedisKeys.mpBindCodeOfUser(userId),
      code,
      RedisTtl.MP_BIND_CODE,
    );

    return this.pendingStatus(code, RedisTtl.MP_BIND_CODE);
  }

  /** 解除绑定（docs/02 §9.6） */
  async unbind(userId: bigint): Promise<void> {
    const code = await this.redis.get(RedisKeys.mpBindCodeOfUser(userId));
    if (code) await this.redis.del(RedisKeys.mpBindCode(code));
    await this.redis.del(RedisKeys.mpBindCodeOfUser(userId));

    await this.prisma.user.update({
      where: { id: userId },
      data: { mpOpenid: null, mpBoundAt: null },
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

    const userIdStr = await this.redis.get(RedisKeys.mpBindCode(code));
    if (!userIdStr) {
      // 不区分「码不存在」和「码已过期」，避免任何信息泄露
      return '这个绑定码不对或者过期了，回到小程序重新获取一下～';
    }

    const userId = BigInt(userIdStr);

    // 同一公众号 openid 只能绑一个用户：先解掉旧的
    const occupied = await this.prisma.user.findFirst({
      where: { mpOpenid, NOT: { id: userId } },
      select: { id: true },
    });
    if (occupied) {
      this.logger.warn(
        `openid 已被用户 ${occupied.id} 占用，先解除再绑定到 ${userId}`,
      );
      await this.prisma.user.update({
        where: { id: occupied.id },
        data: { mpOpenid: null, mpBoundAt: null },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mpOpenid, mpBoundAt: new Date() },
    });

    // 用完即焚
    await this.redis.del(RedisKeys.mpBindCode(code));
    await this.redis.del(RedisKeys.mpBindCodeOfUser(userId));

    this.logger.log(`用户 ${userId} 绑定公众号提醒成功`);
    return '绑定成功 ✅ 以后家里有事，会在这里提醒你～';
  }

  /**
   * 保底方案：管理员手工录入 openid。
   * 家人只有两三个、懒得走回调流程时用，见方案文档 5.3。
   */
  async bindManually(userId: bigint, mpOpenid: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { mpOpenid, mpBoundAt: new Date() },
    });
    this.logger.log(`用户 ${userId} 手工绑定 openid 成功`);
  }

  // -------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------

  /** 读出当前未过期的待用绑定码；没有则返回 null */
  private async readPendingCode(userId: bigint): Promise<MpBindStatus | null> {
    const code = await this.redis.get(RedisKeys.mpBindCodeOfUser(userId));
    if (!code) return null;

    const ttl = await this.redis.ttl(RedisKeys.mpBindCode(code));
    if (ttl <= 0) {
      // 已经过期，顺手清掉反向索引，避免下次读到脏数据
      await this.redis.del(RedisKeys.mpBindCodeOfUser(userId));
      return null;
    }
    return this.pendingStatus(code, ttl);
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
