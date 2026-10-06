/**
 * 认证模块出入参（docs/02 §二）。
 */

/** 当前登录用户（接口层，字段 camelCase，不暴露数据库列名） */
export interface AuthUser {
  id: number;
  nickname: string | null;
  avatarUrl: string | null;
}

/** 我加入的一个家庭（登录后直接带回来，省一次请求） */
export interface MyFamilyBrief {
  familyId: number;
  familyName: string;
  memberId: number;
  roleName: string;
}

/** POST /auth/login 请求 */
export interface LoginRequest {
  /** wx.login 拿到的 code */
  code: string;
  /** 可选，用户授权后带上 */
  nickname?: string;
  avatarUrl?: string;
}

/** POST /auth/login 响应 */
export interface LoginResponse {
  token: string;
  /** 有效期（秒） */
  expiresIn: number;
  user: AuthUser;
  /** 空数组 → 前端进入「创建家庭 / 加入家庭」引导页 */
  families: MyFamilyBrief[];
  /** 上次使用的家庭；只有一个家庭时就是它 */
  currentFamilyId: number | null;
}

/** POST /auth/refresh 响应 */
export interface RefreshTokenResponse {
  token: string;
  expiresIn: number;
}

/** PATCH /auth/profile 请求 */
export interface UpdateProfileRequest {
  nickname?: string;
  avatarUrl?: string;
}

/** 订阅消息额度项（docs/02 §2.4 / §2.5） */
export interface SubscribeQuota {
  templateId: string;
  templateName: string;
  /** 剩余可发送次数 */
  remaining: number;
}

/** 上报订阅授权结果请求 */
export interface ReportSubscribeQuotaRequest {
  templateId: string;
  /** 本次授权成功的次数 */
  count: number;
}

/** 订阅额度响应 */
export interface SubscribeQuotaResponse {
  quotas: SubscribeQuota[];
  /** 额度耗尽，需要引导用户重新授权 */
  needReauthorize?: boolean;
}

/**
 * JWT 载荷。
 *
 * ⚠️ 只放**不随请求变化**的身份信息。当前家庭（familyId）不放进来 ——
 * 多家庭场景下它会变，放进去会导致 token 频繁失效。
 */
export interface JwtPayload {
  /** users.id */
  sub: number;
  /** 便于日志排查，不参与鉴权 */
  openid: string;
  iat?: number;
  exp?: number;
}
