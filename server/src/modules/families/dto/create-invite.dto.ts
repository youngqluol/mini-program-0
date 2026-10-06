import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** 生成邀请码（docs/02 §3.10） */
export class CreateInviteDto {
  /** 有效期（小时），默认 72，最多 30 天 */
  @IsOptional()
  @IsInt({ message: '有效期填个整数小时数就行' })
  @Min(1, { message: '有效期至少 1 小时' })
  @Max(720, { message: '有效期最多 30 天' })
  expireInHours?: number;
}
