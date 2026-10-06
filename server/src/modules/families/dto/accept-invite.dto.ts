import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 接受邀请加入家庭（docs/02 §3.12） */
export class AcceptInviteDto {
  @IsString({ message: '称谓要填哦' })
  @IsNotEmpty({ message: '称谓要填哦' })
  @MaxLength(30, { message: '称谓最多 30 个字' })
  roleName!: string;
}
