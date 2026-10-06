import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BusinessException } from '../../../common/errors/business.exception';
import type { RequestWithFamily } from '../family-context';

/**
 * 「仅家庭创建者」守卫。
 *
 * 必须挂在 `FamilyMemberGuard` **之后**（@UseGuards 的数组顺序即执行顺序），
 * 因为它依赖前者写入的 `req.familyMember`。
 *
 * 家庭里只有两种身份：**成员** 和 **创建者**。
 * 刻意不做权限矩阵（AGENTS.md 铁律：家庭不是公司）。
 * 需要更高权限的操作只有三类：改家庭名、移除成员、解散家庭。
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithFamily>();
    const ctx = req.familyMember;

    if (!ctx) {
      // 漏挂 FamilyMemberGuard —— 属于编码错误，不能静默放行
      throw BusinessException.forbidden();
    }
    if (!ctx.isOwner) {
      throw BusinessException.forbidden('只有创建者能做这个操作');
    }
    return true;
  }
}
