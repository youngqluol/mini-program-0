import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 修改我的家庭称谓（docs/02 §3.6） */
export class UpdateMyRoleDto {
  @IsString({ message: '称谓要填哦' })
  @IsNotEmpty({ message: '称谓要填哦' })
  @MaxLength(30, { message: '称谓最多 30 个字' })
  roleName!: string;
}
