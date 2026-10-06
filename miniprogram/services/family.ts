/**
 * 家庭与成员相关接口（docs/02 §三）
 *
 * 路径与 `server/src/modules/families/families.controller.ts` 一一对应。
 * 注意两条邀请接口**不要求已是成员** —— 它们刻意排在 `:familyId` 之前，
 * 否则「加入家庭」这件事根本没法开始。
 */

import type {
  AcceptInviteResponse,
  CreateFamilyRequest,
  CreateFamilyResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  FamilyDetail,
  FamilyMember,
  InvitePreview,
  MyFamily,
  UpdateFamilyRequest,
  UpdateMyRoleRequest,
} from '@shared/dto/family';
import { del, get, patch, post } from './request';

// ---------------------------------------------------------------
// 家庭
// ---------------------------------------------------------------

/** 创建家庭（创建者同时成为第一个成员） */
export function createFamily(data: CreateFamilyRequest): Promise<CreateFamilyResponse> {
  return post<CreateFamilyResponse>('/families', { ...data });
}

/** 我的家庭列表 */
export function listMine(): Promise<MyFamily[]> {
  return get<MyFamily[]>('/families');
}

/** 家庭详情 */
export function getDetail(familyId: number): Promise<FamilyDetail> {
  return get<FamilyDetail>(`/families/${familyId}`);
}

/** 改家庭名（仅创建者） */
export function updateFamilyName(
  familyId: number,
  data: UpdateFamilyRequest,
): Promise<{ ok: true }> {
  return patch<{ ok: true }>(`/families/${familyId}`, { ...data });
}

/** 解散家庭（仅创建者，逻辑删除，历史数据保留） */
export function dissolveFamily(familyId: number): Promise<{ ok: true }> {
  return del<{ ok: true }>(`/families/${familyId}`);
}

// ---------------------------------------------------------------
// 成员
// ---------------------------------------------------------------

/** 成员列表。`includeLeft=true` 时连已退出的成员一起返回。 */
export function listMembers(familyId: number, includeLeft = false): Promise<FamilyMember[]> {
  return get<FamilyMember[]>(`/families/${familyId}/members`, includeLeft ? { includeLeft: true } : undefined);
}

/** 改我的称谓 */
export function updateMyRole(
  familyId: number,
  data: UpdateMyRoleRequest,
): Promise<{ ok: true }> {
  return patch<{ ok: true }>(`/families/${familyId}/members/me`, { ...data });
}

/** 移除成员（仅创建者，逻辑删除） */
export function removeMember(familyId: number, memberId: number): Promise<{ ok: true }> {
  return del<{ ok: true }>(`/families/${familyId}/members/${memberId}`);
}

/** 退出家庭（创建者不可直接退，需先解散） */
export function leaveFamily(familyId: number): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/families/${familyId}/leave`);
}

// ---------------------------------------------------------------
// 邀请
// ---------------------------------------------------------------

/** 生成邀请码 */
export function createInvite(
  familyId: number,
  data: CreateInviteRequest = {},
): Promise<CreateInviteResponse> {
  return post<CreateInviteResponse>(`/families/${familyId}/invites`, { ...data });
}

/** 邀请码预览（加入前看家庭信息，**不要求已是成员**） */
export function previewInvite(inviteCode: string): Promise<InvitePreview> {
  return get<InvitePreview>(`/families/invites/${inviteCode}`);
}

/** 接受邀请加入家庭 */
export function acceptInvite(
  inviteCode: string,
  data: { roleName: string },
): Promise<AcceptInviteResponse> {
  return post<AcceptInviteResponse>(`/families/invites/${inviteCode}/accept`, { ...data });
}
