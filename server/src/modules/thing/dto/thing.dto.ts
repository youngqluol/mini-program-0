import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * 小事模块 DTO（docs/02 §4.1 / §4.4）。
 *
 * 约定：
 *   - 枚举一律用字符串（`'TASK'`），不用数字 —— 转换只在 service 层做一次
 *   - 时间一律 `"YYYY-MM-DD HH:mm:ss"`（北京时间）
 *   - 每条 message 都是**给家人看的中文**，不是给开发者看的英文
 */

/** 小事类型 */
const THING_TYPES = ['TASK', 'REMINDER'] as const;
/** 可见范围 */
const VISIBILITIES = ['FAMILY', 'RELATED'] as const;
/** 重复类型（V0.1 只开放前四种） */
const RECURRENCE_TYPES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
/** 提醒方式 */
const REMIND_TYPES = ['NOW', 'SCHEDULED'] as const;

/** 北京时间日期时间串：`2026-09-29 18:00:00`（秒可省） */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

/** 创建/编辑小事时内嵌的提醒项 */
export class ReminderInputDto {
  @IsIn(REMIND_TYPES, { message: '提醒方式不对' })
  remindType!: (typeof REMIND_TYPES)[number];

  /** 定时叮必填；立即叮忽略 */
  @IsOptional()
  @IsString({ message: '提醒时间格式不对' })
  remindAt?: string | null;

  @IsOptional()
  @IsIn(RECURRENCE_TYPES, { message: '重复方式不对' })
  recurrenceType?: (typeof RECURRENCE_TYPES)[number];

  @IsOptional()
  @IsObject({ message: '重复规则格式不对' })
  recurrenceConfig?: Record<string, unknown> | null;

  /** 提醒对象；不传默认取小事的执行人 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '提醒对象不对' })
  recipientMemberId?: number | null;
}

/** POST /family-things 请求体 */
export class CreateThingDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  @IsIn(THING_TYPES, { message: '类型只能是派活或叮一下' })
  type!: (typeof THING_TYPES)[number];

  @IsString({ message: '要写点什么呢' })
  @IsNotEmpty({ message: '要写点什么呢' })
  @MaxLength(200, { message: '这件事最多写 200 个字' })
  title!: string;

  @IsOptional()
  @IsString({ message: '备注格式不对' })
  @MaxLength(1000, { message: '备注最多写 1000 个字' })
  content?: string | null;

  @Type(() => Number)
  @IsInt({ message: '要选一个人哦' })
  @Min(1, { message: '要选一个人哦' })
  assigneeMemberId!: number;

  @IsOptional()
  @IsIn(VISIBILITIES, { message: '可见范围不对' })
  visibility?: (typeof VISIBILITIES)[number];

  @IsOptional()
  @IsString({ message: '时间格式不对' })
  dueAt?: string | null;

  @IsOptional()
  @IsIn(RECURRENCE_TYPES, { message: '重复方式不对' })
  recurrenceType?: (typeof RECURRENCE_TYPES)[number];

  @IsOptional()
  @IsObject({ message: '重复规则格式不对' })
  recurrenceConfig?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray({ message: '提醒格式不对' })
  @ValidateNested({ each: true })
  @Type(() => ReminderInputDto)
  reminders?: ReminderInputDto[];
}

/** PATCH /family-things/{id} 请求体 —— 只传要改的字段 */
export class UpdateThingDto {
  @IsOptional()
  @IsString({ message: '标题格式不对' })
  @IsNotEmpty({ message: '标题不能空着' })
  @MaxLength(200, { message: '这件事最多写 200 个字' })
  title?: string;

  @IsOptional()
  @IsString({ message: '备注格式不对' })
  @MaxLength(1000, { message: '备注最多写 1000 个字' })
  content?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '执行人不对' })
  @Min(1, { message: '执行人不对' })
  assigneeMemberId?: number;

  @IsOptional()
  @IsIn(VISIBILITIES, { message: '可见范围不对' })
  visibility?: (typeof VISIBILITIES)[number];

  @IsOptional()
  @IsString({ message: '时间格式不对' })
  dueAt?: string | null;

  @IsOptional()
  @IsIn(RECURRENCE_TYPES, { message: '重复方式不对' })
  recurrenceType?: (typeof RECURRENCE_TYPES)[number];

  @IsOptional()
  @IsObject({ message: '重复规则格式不对' })
  recurrenceConfig?: Record<string, unknown> | null;

  /** 传了就**全量替换**该小事下的提醒 */
  @IsOptional()
  @IsArray({ message: '提醒格式不对' })
  @ValidateNested({ each: true })
  @Type(() => ReminderInputDto)
  reminders?: ReminderInputDto[];
}

/** GET /family-things 查询参数（docs/02 §4.2） */
export class ListThingsQueryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  @IsOptional()
  @IsIn(THING_TYPES, { message: '类型不对' })
  type?: (typeof THING_TYPES)[number];

  @IsOptional()
  @IsIn(['PENDING', 'COMPLETED', 'CANCELLED'], { message: '状态不对' })
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '执行人不对' })
  assigneeMemberId?: number;

  @IsOptional()
  @IsIn(['ALL', 'MINE', 'ASSIGNED_TO_ME'], { message: '筛选范围不对' })
  scope?: 'ALL' | 'MINE' | 'ASSIGNED_TO_ME';

  /** "YYYY-MM-DD"，含当天 00:00:00 */
  @IsOptional()
  @IsString({ message: '开始日期格式不对' })
  startDate?: string;

  /** "YYYY-MM-DD"，含当天 23:59:59 */
  @IsOptional()
  @IsString({ message: '结束日期格式不对' })
  endDate?: string;

  @IsOptional()
  @IsString({ message: '关键词格式不对' })
  @MaxLength(50, { message: '关键词太长了' })
  keyword?: string;

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

/** 北京时间时间串校验 —— 供 service 复用（DTO 只能校验「是字符串」） */
export function isBeijingDateTime(s: string): boolean {
  return DATETIME_RE.test(s.trim());
}
