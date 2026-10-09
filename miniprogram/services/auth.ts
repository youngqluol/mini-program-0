/**
 * 认证相关接口（docs/02 §二）
 *
 * 全部薄封装 —— 只负责「拼路径 + 传参 + 标类型」，不做业务判断。
 */

import type {
  AuthUser,
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
  ReportSubscribeQuotaRequest,
  SubscribeQuotaResponse,
  UpdateProfileRequest,
} from '@shared/dto/auth';
import { del, get, patch, post } from './request';

/**
 * 微信登录（全项目唯一不需要 token 的接口）。
 *
 * `code` 来自 `wx.login`。注意 code 只能用一次、5 分钟有效 ——
 * 所以不要把它缓存起来反复用。
 */
export function login(data: LoginRequest): Promise<LoginResponse> {
  return post<LoginResponse>('/auth/login', { ...data });
}

/** 续期 token。正常情况下由 `services/request.ts` 的静默重登兜住，业务代码不用主动调。 */
export function refresh(): Promise<RefreshTokenResponse> {
  return post<RefreshTokenResponse>('/auth/refresh');
}

/** 更新个人资料（昵称 / 头像） */
export function updateProfile(data: UpdateProfileRequest): Promise<AuthUser> {
  return patch<AuthUser>('/auth/profile', { ...data });
}

/** 查询订阅额度（M2 的「微信提醒」页会用） */
export function getSubscribeQuota(): Promise<SubscribeQuotaResponse> {
  return get<SubscribeQuotaResponse>('/auth/subscribe-quota');
}

/** 上报订阅授权结果 */
export function reportSubscribeQuota(
  data: ReportSubscribeQuotaRequest,
): Promise<SubscribeQuotaResponse> {
  return post<SubscribeQuotaResponse>('/auth/subscribe-quota', { ...data });
}

/**
 * 注销账号（docs/02 §2.6）。
 *
 * **不可逆。** 后端会：抹掉个人身份信息、退出所有家庭、收掉还没发出的提醒、
 * 清空消息中心；家里共享过的内容保留但匿名化。
 *
 * 所以这个函数**只在 P20 的两步确认之后**才允许调用，不要在别处随手用
 * （比如「退出登录」那种场景 —— 那是 `userStore.logout()`，本地的事）。
 */
export function deleteAccount(): Promise<{ ok: true }> {
  return del<{ ok: true }>('/auth/account');
}
