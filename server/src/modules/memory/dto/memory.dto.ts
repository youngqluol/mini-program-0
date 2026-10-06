import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import { MEMORY_LIMITS } from '@shared';
import { toNullableNumber } from '../../../common/utils/query.util';

/**
 * 留个念模块 DTO（docs/02 §七）。
 *
 * 约定与其余模块一致：
 *   - 枚举一律用字符串（`'FAMILY'`），转换只在 service 层做一次
 *   - 每条 message 都是**给家人看的中文**
 */

/** 可见范围可选值 */
const VISIBILITIES = ['FAMILY', 'PRIVATE'] as const;

/** 图片地址长度上限 —— 与 `memory_attachments.file_url` 的 VARCHAR(500) 一致 */
const MAX_URL_LEN = 500;
/** 尺寸上限。**只是防止塞进离谱的数字**（比如 100000×100000 把页面撑爆），
 *  不是「图片不能这么大」——真实上限由 `POST /upload/image` 把关 */
const MAX_DIMENSION = 20_000;
/** 每页默认 / 最大条数 */
export const MEMORY_DEFAULT_LIMIT = 20;
export const MEMORY_MAX_LIMIT = 50;

// ---------------------------------------------------------------
// 图片
// ---------------------------------------------------------------

/**
 * 发布时提交的一张图 —— **照抄 `POST /upload/image` 的响应**。
 *
 * `width` / `height` 允许为空（服务端解不出尺寸时会回 null），
 * 所以这里不能写 `@IsInt` 而不给 `@IsOptional`。
 */
export class MemoryAttachmentDto {
  @IsString({ message: '图片地址格式不对' })
  @IsNotEmpty({ message: '图片地址是空的' })
  @MaxLength(MAX_URL_LEN, { message: '图片地址太长了' })
  fileUrl!: string;

  /** 例如 `image/jpeg`。**仅用于回显**，服务端不据此做任何判断 */
  @IsOptional()
  @IsString({ message: '图片类型格式不对' })
  @MaxLength(30, { message: '图片类型太长了' })
  fileType?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '图片大小不对' })
  @Min(0, { message: '图片大小不对' })
  fileSize?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '图片宽度不对' })
  @Min(1, { message: '图片宽度不对' })
  @Max(MAX_DIMENSION, { message: '图片宽度不对' })
  width?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '图片高度不对' })
  @Min(1, { message: '图片高度不对' })
  @Max(MAX_DIMENSION, { message: '图片高度不对' })
  height?: number | null;

  /** 展示顺序，从 0 开始；不传按数组下标 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '图片顺序不对' })
  @Min(0, { message: '图片顺序不对' })
  sortNo?: number;
}

// ---------------------------------------------------------------
// 发布 / 编辑
// ---------------------------------------------------------------

/** `POST /memories` 请求体（docs/02 §7.1） */
export class CreateMemoryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  /**
   * 正文。**允许为空**（可以只发图片），
   * 但「正文与图片至少给一样」是跨字段规则，DTO 层表达不了，
   * 由 `MemoryService.create` 判（那里文案更自然）。
   */
  @IsOptional()
  @IsString({ message: '内容格式不对' })
  @MaxLength(MEMORY_LIMITS.CONTENT_MAX, { message: `最多写 ${MEMORY_LIMITS.CONTENT_MAX} 个字` })
  content?: string;

  /** 不传 = `FAMILY`（家庭可见） */
  @IsOptional()
  @IsIn(VISIBILITIES, { message: '可见范围不对' })
  visibility?: (typeof VISIBILITIES)[number];

  @IsOptional()
  @IsArray({ message: '图片格式不对' })
  @ArrayMaxSize(MEMORY_LIMITS.MAX_ATTACHMENTS, {
    message: `一次最多 ${MEMORY_LIMITS.MAX_ATTACHMENTS} 张图片`,
  })
  @ValidateNested({ each: true })
  @Type(() => MemoryAttachmentDto)
  attachments?: MemoryAttachmentDto[];

  /**
   * 「完成纪念」关联的小事（PRD §19.2）。
   *
   * 用 `toNullableNumber` 而不是 `@Type(() => Number)`：后者会把空串变成 `0`，
   * 然后 `@Min(1)` 报「小事不对」，而前端传空串的本意是「独立留念、不关联」。
   */
  @IsOptional()
  @Transform(toNullableNumber)
  @IsInt({ message: '关联的小事不对' })
  @Min(1, { message: '关联的小事不对' })
  thingId?: number | null;
}

/**
 * `PATCH /memories/{id}` 请求体（docs/02 §7.4）。只传要改的字段。
 *
 * ⚠️ **刻意没有 `attachments`。**
 *    「全库不做物理 DELETE，一律状态位逻辑删除」（AGENTS.md）——
 *    而 `memory_attachments` 表**没有状态位**（`db/schema.sql` 是字段唯一真相）。
 *    没有状态位就无法逻辑删除旧行，于是「替换图片」只能物理删 —— 违反铁律。
 *    所以 V0.1 的图片是**不可变**的：发错了就删掉重发。
 *    要支持改图片，得先给那张表加状态位（已记入 docs/未来需求池.md）。
 */
export class UpdateMemoryDto {
  /**
   * ⚠️ **刻意没有 `@IsNotEmpty`**：「正文与图片至少给一样」这条规则由
   * `MemoryService.update` 判 —— 因为 DTO 只能看到未 trim 的值，
   * `'   '` 能过 `@IsNotEmpty` 却 trim 成空串。规则只写一遍。
   */
  @IsOptional()
  @IsString({ message: '内容格式不对' })
  @MaxLength(MEMORY_LIMITS.CONTENT_MAX, { message: `最多写 ${MEMORY_LIMITS.CONTENT_MAX} 个字` })
  content?: string;

  @IsOptional()
  @IsIn(VISIBILITIES, { message: '可见范围不对' })
  visibility?: (typeof VISIBILITIES)[number];
}

// ---------------------------------------------------------------
// 时间线
// ---------------------------------------------------------------

/** `GET /memories` 查询参数（docs/02 §7.2） */
export class ListMemoriesQueryDto {
  @Type(() => Number)
  @IsInt({ message: '家庭信息不对' })
  @Min(1, { message: '家庭信息不对' })
  familyId!: number;

  /**
   * 游标 = **上一页最后一条的 `id`**（不是时间戳）。
   *
   * 为什么不用 `created_at`：它是 `DATETIME(0)`（秒精度），
   * 同一秒里发两条（冒烟脚本、家人连着发）就会有**相同的时间戳** ——
   * 用 `created_at < cursor` 翻页会**静默漏掉**并列的那几条。
   * `id` 自增且唯一，天然没有这个问题，而它的大小顺序就是插入顺序，
   * 与「按时间倒序」等价。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '翻页参数不对' })
  @Min(1, { message: '翻页参数不对' })
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数不对' })
  @Min(1, { message: '每页条数不对' })
  @Max(MEMORY_MAX_LIMIT, { message: `每页最多 ${MEMORY_MAX_LIMIT} 条` })
  limit?: number;
}
