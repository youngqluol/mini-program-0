import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FamilyMemberContext, RequestWithFamily } from '../family-context';

/**
 * 取当前家庭上下文（`FamilyMemberGuard` 写入）。
 *
 * 用法：
 *   @FamilyMemberCtx() ctx: FamilyMemberContext          // 整个对象
 *   @FamilyMemberCtx('memberId') memberId: bigint        // 只要 memberId
 *
 * ⚠️ 只在挂了 `FamilyMemberGuard` 的路由上可用。
 *    拿到 undefined 说明漏挂了守卫，那是个 bug —— 不是「可以容忍的默认值」。
 */
export const FamilyMemberCtx = createParamDecorator(
  (field: keyof FamilyMemberContext | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<RequestWithFamily>();
    const familyMember = req.familyMember;
    if (!familyMember) return undefined;
    return field ? familyMember[field] : familyMember;
  },
);
