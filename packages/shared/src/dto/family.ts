/**
 * 家庭模块出入参（docs/02 §三）。
 *
 * ⚠️ 家庭称谓（roleName）属于「用户 × 家庭」这个关系，**不属于用户**。
 *    同一用户在不同家庭可以有不同称谓：我们家→阿爸，爸妈家→儿子。
 */
import type { InviteStatus, MemberStatus } from '../enums';

/** 接口层的成员状态字符串 */
export type MemberStatusValue = keyof typeof MemberStatus;
/** 接口层的邀请码状态字符串 */
export type InviteStatusValue = keyof typeof InviteStatus;

// ---------------------------------------------------------------
// 家庭
// ---------------------------------------------------------------

/** POST /families 请求 */
export interface CreateFamilyRequest {
  /** 家庭名称，例如「我们家」 */
  familyName: string;
  /** 创建者在自己家庭里的称谓，例如「阿爸」 */
  roleName: string;
}

/** POST /families 响应 */
export interface CreateFamilyResponse {
  familyId: number;
  familyName: string;
  memberId: number;
  roleName: string;
  ownerMemberId: number;
}

/** GET /families 列表项 */
export interface MyFamily {
  familyId: number;
  familyName: string;
  memberId: number;
  roleName: string;
  isOwner: boolean;
  memberCount: number;
}

/** GET /families/{id} 详情 */
export interface FamilyDetail {
  familyId: number;
  familyName: string;
  ownerMemberId: number | null;
  isOwner: boolean;
  memberCount: number;
  /** "YYYY-MM-DD HH:mm:ss" */
  createdAt: string;
}

/** PATCH /families/{id} 请求 */
export interface UpdateFamilyRequest {
  familyName: string;
}

// ---------------------------------------------------------------
// 成员
// ---------------------------------------------------------------

/** GET /families/{id}/members 列表项 */
export interface FamilyMember {
  memberId: number;
  userId: number;
  /** 家庭称谓 —— 消息文案里用它，不用昵称 */
  roleName: string;
  nickname: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  /** 是不是「我」—— 前端据此高亮 */
  isMe: boolean;
  status: MemberStatusValue;
  /** "YYYY-MM-DD HH:mm:ss" */
  joinedAt: string;
}

/** PATCH /families/{id}/members/me 请求 */
export interface UpdateMyRoleRequest {
  roleName: string;
}

// ---------------------------------------------------------------
// 邀请
// ---------------------------------------------------------------

/** POST /families/{id}/invites 请求 */
export interface CreateInviteRequest {
  /** 有效期（小时），默认 72 */
  expireInHours?: number;
}

/** POST /families/{id}/invites 响应 */
export interface CreateInviteResponse {
  inviteId: number;
  inviteCode: string;
  /** "YYYY-MM-DD HH:mm:ss" */
  expireAt: string;
  /** 直接用于小程序 onShareAppMessage 的 path */
  sharePath: string;
}

/** GET /families/invites/{code} 邀请码预览 */
export interface InvitePreview {
  inviteCode: string;
  familyName: string;
  /** 邀请人在该家庭里的称谓 */
  inviterRoleName: string;
  memberCount: number;
  /** "YYYY-MM-DD HH:mm:ss" */
  expireAt: string | null;
  status: InviteStatusValue;
  /** 我是不是已经在这个家里了（是则不用再走加入流程） */
  alreadyMember: boolean;
}

/** POST /families/invites/{code}/accept 请求 */
export interface AcceptInviteRequest {
  roleName: string;
}

/** POST /families/invites/{code}/accept 响应 */
export interface AcceptInviteResponse {
  familyId: number;
  familyName: string;
  memberId: number;
  roleName: string;
}
