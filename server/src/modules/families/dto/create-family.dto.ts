import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 创建家庭（docs/02 §3.1） */
export class CreateFamilyDto {
  @IsString({ message: '家庭名称要填哦' })
  @IsNotEmpty({ message: '家庭名称要填哦' })
  @MaxLength(50, { message: '家庭名称最多 50 个字' })
  familyName!: string;

  /** 创建者在自己家庭里的称谓，例如「阿爸」 */
  @IsString({ message: '称谓要填哦' })
  @IsNotEmpty({ message: '称谓要填哦' })
  @MaxLength(30, { message: '称谓最多 30 个字' })
  roleName!: string;
}
