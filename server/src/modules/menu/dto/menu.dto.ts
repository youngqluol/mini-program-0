import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MENU_CATEGORY } from '@shared';
import { ParseBoolean, toNullableNumber } from '../../../common/utils/query.util';

/**
 * 吃啥呢模块 DTO（docs/02 §六）。
 *
 * 约定与小事模块一致：
 *   - 枚举一律用字符串（`'DINNER'`），转换只在 service 层做一次
 *   - 日期 `"YYYY-MM-DD"`、日期时间 `"YYYY-MM-DD HH:mm:ss"`（北京时间）
 *   - 每条 message 都是**给家人看的中文**，不是给开发者看的英文
 */

/** 餐次 */
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'OTHER'] as const;
/** 分类的可选值 —— 从 shared 的 `MENU_CATEGORY` 取，不在这里重写一遍 */
const CATEGORIES = Object.values(MENU_CATEGORY);

/** 北京时间日期串：`2026-09-28` */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 北京时间日期时间串：`2026-09-28 18:30:00`（秒可省） */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

/** 一次最多决定几道菜（docs/02 §6.1 的 `count` 上限） */
export const MAX_RANDOM_COUNT = 5;
/** 「最近吃过」最多往前看几天 */
export const MAX_RECENT_DAYS = 90;
/** 一次最多记录几道菜（「一荤一素一汤」= 3，留一点余量） */
export const MAX_MEAL_ITEMS = 8;

// ---------------------------------------------------------------
// 随机推荐 / 列表
// ---------------------------------------------------------------

/** `GET /menu/random` 查询参数（docs/02 §6.1） */
export class RandomMenuQueryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  @IsOptional()
  @IsIn(MEAL_TYPES, { message: '餐次不对' })
  mealType?: (typeof MEAL_TYPES)[number];

  /** 抽几道菜。默认 1；P02 晚餐传 3（「一荤一素一汤」） */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '数量不对' })
  @Min(1, { message: '数量不对' })
  @Max(MAX_RANDOM_COUNT, { message: `一次最多抽 ${MAX_RANDOM_COUNT} 道菜` })
  count?: number;

  /** 限定分类。⚠️ 传了就**不做组合搭配**，只在这个分类里抽 */
  @IsOptional()
  @IsIn(CATEGORIES, { message: '分类不对' })
  category?: string;

  /** 是否排除最近 3 天吃过的。默认 `true` */
  @IsOptional()
  @ParseBoolean()
  @IsBoolean({ message: '这个开关不对' })
  excludeRecent?: boolean;
}

/** `GET /menu/items` 查询参数（docs/02 §6.2） */
export class ListMenuItemsQueryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  @IsOptional()
  @IsIn(CATEGORIES, { message: '分类不对' })
  category?: string;

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
  @Max(200, { message: '每页最多 200 条' })
  pageSize?: number;
}

/** `GET /menu/recent` 查询参数（docs/02 §6.7） */
export class RecentMealsQueryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  /** 往前看几天。默认 7 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '天数不对' })
  @Min(1, { message: '天数不对' })
  @Max(MAX_RECENT_DAYS, { message: `最多看 ${MAX_RECENT_DAYS} 天` })
  days?: number;
}

// ---------------------------------------------------------------
// 决定吃什么
// ---------------------------------------------------------------

/**
 * 一道菜（请求里的）。
 *
 * ⚠️ **`name` 是权威的**，服务端以它落库（`meal_records.name` 是历史快照），
 * 不回头查菜谱表取名字 —— 用户看到的就是这个名字，记下来的也该是这个。
 *
 * ⚠️ **`menuItemId` 允许为空**：系统菜谱没有 id（它们是代码常量，不在库里）。
 * 用 `toNullableNumber` 而不是 `@Type(() => Number)` —— 后者会把空串变成 `0`，
 * 然后 `@Min(1)` 报「菜谱不对」，而前端传空串的本意是「没选」。
 */
export class MealItemInputDto {
  @IsOptional()
  @Transform(toNullableNumber)
  @IsInt({ message: '菜谱不对' })
  @Min(1, { message: '菜谱不对' })
  menuItemId?: number | null;

  @IsString({ message: '菜名写点什么呢' })
  @IsNotEmpty({ message: '菜名写点什么呢' })
  @MaxLength(100, { message: '菜名最多写 100 个字' })
  name!: string;
}

/** `POST /menu/decide` 请求体（docs/02 §6.6） */
export class DecideMenuDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  /** 不传默认**今天**（北京时间）。前端一般也不传 */
  @IsOptional()
  @IsString({ message: '日期格式不对' })
  mealDate?: string;

  @IsIn(MEAL_TYPES, { message: '餐次不对' })
  mealType!: (typeof MEAL_TYPES)[number];

  @IsArray({ message: '要选一道菜哦' })
  @ArrayMinSize(1, { message: '要选一道菜哦' })
  @ArrayMaxSize(MAX_MEAL_ITEMS, { message: `一次最多记 ${MAX_MEAL_ITEMS} 道菜` })
  @ValidateNested({ each: true })
  @Type(() => MealItemInputDto)
  items!: MealItemInputDto[];
}

/**
 * `POST /menu/decide-and-assign` 请求体（docs/02 §6.8）。
 *
 * 比 `DecideMenuDto` 多出「派给谁、什么时候要、要不要叮一下」——
 * 也就是一次 `POST /family-things` 的入参。
 */
export class DecideAndAssignDto extends DecideMenuDto {
  @Type(() => Number)
  @IsInt({ message: '要选一个人哦' })
  @Min(1, { message: '要选一个人哦' })
  assigneeMemberId!: number;

  /** 「什么时候要」。不传表示不限时间 */
  @IsOptional()
  @IsString({ message: '时间格式不对' })
  dueAt?: string | null;

  @IsOptional()
  @ParseBoolean()
  @IsBoolean({ message: '这个开关不对' })
  withReminder?: boolean;

  /** 「什么时候叮一下」。`withReminder` 为真时才有意义 */
  @IsOptional()
  @IsString({ message: '提醒时间格式不对' })
  remindAt?: string | null;
}

// ---------------------------------------------------------------
// 菜谱管理（P17）
// ---------------------------------------------------------------

/** `POST /menu/items` 请求体（docs/02 §6.3） */
export class CreateMenuItemDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  @IsString({ message: '菜名写点什么呢' })
  @IsNotEmpty({ message: '菜名写点什么呢' })
  @MaxLength(100, { message: '菜名最多写 100 个字' })
  name!: string;

  @IsOptional()
  @IsIn(CATEGORIES, { message: '分类不对' })
  category?: string | null;

  @IsOptional()
  @IsString({ message: '图片格式不对' })
  @MaxLength(500, { message: '图片地址太长了' })
  imageUrl?: string | null;
}

/** `PATCH /menu/items/{id}` 请求体（docs/02 §6.4）—— 只传要改的字段 */
export class UpdateMenuItemDto {
  @IsOptional()
  @IsString({ message: '菜名格式不对' })
  @IsNotEmpty({ message: '菜名不能空着' })
  @MaxLength(100, { message: '菜名最多写 100 个字' })
  name?: string;

  @IsOptional()
  @IsIn(CATEGORIES, { message: '分类不对' })
  category?: string | null;

  @IsOptional()
  @IsString({ message: '图片格式不对' })
  @MaxLength(500, { message: '图片地址太长了' })
  imageUrl?: string | null;
}

/** `PATCH /menu/items/{id}/enabled` 请求体（docs/02 §6.5） */
export class SetMenuItemEnabledDto {
  @ParseBoolean()
  @IsBoolean({ message: '开关状态不对' })
  enabled!: boolean;
}

/** 供 service 校验日期格式用的正则（DTO 里只能查格式，查不了「是不是合法日期」） */
export const DATE_PATTERNS = { DATE_RE, DATETIME_RE };
