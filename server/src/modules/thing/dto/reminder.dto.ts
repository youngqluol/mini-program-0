import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 提醒模块 DTO（docs/02 §5.1 ~ §5.3）。
 *
 * 提醒是小事的子资源：一条小事可以挂 0..n 条提醒，
 * 每条提醒面向一个接收人、在一个时刻触发。
 */

const RECURRENCE_TYPES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
const REMIND_TYPES = ['NOW', 'SCHEDULED'] as const;

/** POST /reminders/nudge 请求体（docs/02 §5.3） */
export class NudgeDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  /** 叮谁 */
  @Type(() => Number)
  @IsInt({ message: '要选一个人哦' })
  @Min(1, { message: '要选一个人哦' })
  recipientMemberId!: number;

  /** 叮的内容；关联已有小事时可省略（用小事自己的标题） */
  @IsOptional()
  @IsString({ message: '要叮的内容格式不对' })
  @MaxLength(200, { message: '最多写 200 个字' })
  content?: string;

  /** 关联的小事；纯叮一下时省略，后端会新建一条 REMINDER 小事 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '这件小事不对' })
  @Min(1, { message: '这件小事不对' })
  thingId?: number;
}

/** GET /reminders/inbox 查询参数（docs/02 §5.4） */
export class InboxQueryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  /** 不传则返回全部未取消的 */
  @IsOptional()
  @IsIn(['PENDING', 'SENT'], { message: '状态不对' })
  status?: 'PENDING' | 'SENT';
}

/** POST /family-things/{thingId}/reminders 请求体（docs/02 §5.1） */
export class AddReminderDto {
  /** 提醒对象；不传默认取小事的执行人 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '提醒对象不对' })
  @Min(1, { message: '提醒对象不对' })
  recipientMemberId?: number;

  @IsIn(REMIND_TYPES, { message: '提醒方式不对' })
  remindType!: (typeof REMIND_TYPES)[number];

  /** 定时叮必填 */
  @IsOptional()
  @IsString({ message: '提醒时间格式不对' })
  remindAt?: string | null;

  @IsOptional()
  @IsIn(RECURRENCE_TYPES, { message: '重复方式不对' })
  recurrenceType?: (typeof RECURRENCE_TYPES)[number];

  @IsOptional()
  @IsObject({ message: '重复规则格式不对' })
  recurrenceConfig?: Record<string, unknown> | null;
}
