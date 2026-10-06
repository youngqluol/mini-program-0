import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/** 通知类型筛选值（`ALL` = 不筛） */
const NOTIFY_TYPES = [
  'ALL',
  'TASK_ASSIGNED',
  'REMINDER',
  'TASK_DONE',
  'JOIN_FAMILY',
  'SYSTEM',
] as const;

/** GET /notifications 查询参数（docs/02 §9.1） */
export class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(NOTIFY_TYPES, { message: '消息类型不对' })
  type?: (typeof NOTIFY_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码不对' })
  @Min(1, { message: '页码不对' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数不对' })
  @Min(1, { message: '每页条数不对' })
  pageSize?: number;
}
