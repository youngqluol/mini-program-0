import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotifyChannel, NotifyStatus, NotifyType, dbToEnum, enumToDb } from '@shared/enums';
import type { NotificationItem, NotificationListResponse, UnreadCountResponse } from '@shared/dto/notify';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/errors/business.exception';
import { formatDateTimeRequired, toNumber, toNumberRequired } from '../../common/serialize/beijing-time';

/** 默认每页条数 */
const DEFAULT_PAGE_SIZE = 20;
/** 每页上限 */
const MAX_PAGE_SIZE = 50;

/**
 * 消息中心 —— docs/02 §九。
 *
 * 数据源是 `notification_logs`：**每一条通知都先落库、再尝试推送**，
 * 所以这里天然就是「不管推没推到微信，站内一定看得到」的兜底入口。
 *
 * `channel` / `status` 是给**发起人**看的：「到底叮到了没有」。
 * 小程序端据此在条目上显示「已推送到微信 / 对方打开小程序可见」（PRD 6.5.6）。
 *
 * ⚠️ 通知是**用户维度**的，不带 familyId —— 同一个人可能在多个家庭里，
 *    消息中心是跨家庭的统一收件箱。
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 通知列表（docs/02 §9.1） */
  async list(
    userId: bigint,
    options: { type?: string; page?: number; pageSize?: number },
  ): Promise<NotificationListResponse> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = clamp(options.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

    const where: Prisma.NotificationLogWhereInput = { userId };
    if (options.type && options.type !== 'ALL') {
      const t = enumToDb(NotifyType, options.type);
      if (t === undefined) throw BusinessException.invalidParam('消息类型不对');
      where.type = t;
    }

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationLog.count({ where }),
      this.unreadOf(userId),
    ]);

    return {
      list: rows.map((r) => this.toItem(r)),
      unreadCount,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  /** 未读数（docs/02 §9.2）—— 给「我的」Tab 角标用 */
  async unreadCount(userId: bigint): Promise<UnreadCountResponse> {
    return { unreadCount: await this.unreadOf(userId) };
  }

  /** 全部已读（docs/02 §9.3）。幂等：没有未读时返回 0，不报错。 */
  async readAll(userId: bigint): Promise<{ updated: number }> {
    const res = await this.prisma.notificationLog.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  // -------------------------------------------------------------

  private unreadOf(userId: bigint): Promise<number> {
    return this.prisma.notificationLog.count({ where: { userId, readAt: null } });
  }

  private toItem(row: Prisma.NotificationLogGetPayload<Record<string, never>>): NotificationItem {
    return {
      id: toNumberRequired(row.id),
      type: requireName(NotifyType, row.type, 'notification_logs.type') as NotificationItem['type'],
      title: row.title,
      content: row.content ?? '',
      channel: requireName(
        NotifyChannel,
        row.channel,
        'notification_logs.channel',
      ) as NotificationItem['channel'],
      status: requireName(
        NotifyStatus,
        row.status,
        'notification_logs.status',
      ) as NotificationItem['status'],
      thingId: toNumber(row.thingId),
      isRead: row.readAt != null,
      createdAt: formatDateTimeRequired(row.createdAt),
    };
  }
}

// ---------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** 数据库 TINYINT → 接口字符串。取不到说明数据坏了，宁可报错也不要静默给错值。 */
function requireName(enumObj: Record<string, string | number>, v: number, what: string): string {
  const s = dbToEnum(enumObj, v);
  if (!s) throw new Error(`${what} 取值异常：${v}`);
  return s;
}
