import type { Request } from 'express';

/** `FamilyMemberGuard` 校验通过后挂在 `request` 上的家庭上下文 */
export interface FamilyMemberContext {
  familyId: bigint;
  /** 当前用户在该家庭里的成员 ID（**不是** users.id） */
  memberId: bigint;
  userId: bigint;
  /** 当前用户在该家庭里的称谓 */
  roleName: string;
  isOwner: boolean;
}

export type RequestWithFamily = Request & {
  user?: { userId: bigint; openid: string };
  familyMember?: FamilyMemberContext;
};
