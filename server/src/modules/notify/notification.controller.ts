import { Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { NotificationListResponse, UnreadCountResponse } from '@shared/dto/notify';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';

/**
 * 消息中心（docs/02 §九）。
 *
 * 实际路径（全局前缀 `/api`）：
 *   GET  /api/notifications                通知列表（含 unreadCount）
 *   GET  /api/notifications/unread-count   未读数（角标）
 *   POST /api/notifications/read-all       全部已读
 *
 * ⚠️ 这三个接口**不带 familyId** —— 消息中心是跨家庭的统一收件箱，
 *    同一个人可能在「我们家」和「爸妈家」里都有事。
 *
 * ⚠️ `unread-count` 必须写在 `:id` 类路由之前（如果将来加了 `:id`）。
 *    目前没有 `:id` 路由，所以不存在被吃掉的问题。
 *
 * 已知缺口：docs/02 §9 只定义了「全部已读」，没有「单条已读」。
 * 所以点开一条通知并不会把它标记为已读，角标只能靠「全部已读」清掉。
 * 这属于**产品待决**，已记入 docs/未来需求池.md，不在这里私自加接口。
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /** 通知列表（M2-B25） */
  @Get()
  async list(
    @CurrentUser('userId') userId: bigint,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(userId, query);
  }

  /** 未读数（docs/02 §9.2） */
  @Get('unread-count')
  async unreadCount(@CurrentUser('userId') userId: bigint): Promise<UnreadCountResponse> {
    return this.notifications.unreadCount(userId);
  }

  /** 全部已读（docs/02 §9.3） */
  @Post('read-all')
  async readAll(@CurrentUser('userId') userId: bigint): Promise<{ updated: number }> {
    return this.notifications.readAll(userId);
  }
}
