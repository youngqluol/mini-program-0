import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 更新个人资料（docs/02 §2.3） */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '昵称有点长哦' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '头像地址有点长哦' })
  avatarUrl?: string;
}
