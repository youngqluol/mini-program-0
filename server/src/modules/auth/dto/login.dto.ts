import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 登录请求（docs/02 §2.1）。
 *
 * ⚠️ 校验消息是**给用户看的**（会被全局过滤器原样透出），
 *    所以写中文、写人话，不要写「code should not be empty」。
 */
export class LoginDto {
  /** wx.login 拿到的 code */
  @IsString({ message: '登录凭证不对，重新进一次小程序试试' })
  @IsNotEmpty({ message: '登录凭证不能为空' })
  code!: string;

  /** 可选，用户授权后带上 */
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '昵称有点长哦' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '头像地址有点长哦' })
  avatarUrl?: string;
}
