import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 修改家庭名称（docs/02 §3.4） */
export class UpdateFamilyDto {
  @IsString({ message: '家庭名称要填哦' })
  @IsNotEmpty({ message: '家庭名称要填哦' })
  @MaxLength(50, { message: '家庭名称最多 50 个字' })
  familyName!: string;
}
