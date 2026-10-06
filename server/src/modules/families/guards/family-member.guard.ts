import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { FamiliesService } from '../families.service';
import { BusinessException } from '../../../common/errors/business.exception';
import type { RequestWithFamily } from '../family-context';

/**
 * 家庭成员守卫（M1-B10）。
 *
 * 职责：确认「当前登录用户」确实是「URL 里那个家庭」的成员，
 *       并把成员上下文（memberId / roleName / isOwner）挂到 request 上。
 *
 * 为什么必须存在（AGENTS.md 铁律）：
 *   **数据权限过滤必须在服务端做**。没有这个守卫，
 *   任何人把 URL 里的 familyId 一改就能看别人家的数据。
 *
 * familyId 的解析顺序：
 *   ① 路径参数 `:familyId`（绝大多数接口）
 *   ② 请求头 `X-Family-Id`（多家庭场景，前端显式指定上下文）
 *   ③ 查询参数 `familyId`（列表类接口）
 */
@Injectable()
export class FamilyMemberGuard implements CanActivate {
  constructor(private readonly families: FamiliesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithFamily>();

    const userId = req.user?.userId;
    if (!userId) {
      // 说明 JwtGuard 没跑到 —— 路由装饰器顺序有问题，属于编码错误
      throw BusinessException.unauthorized();
    }

    const familyId = resolveFamilyId(req);
    if (familyId == null) {
      throw BusinessException.invalidParam('缺少家庭信息');
    }

    const member = await this.families.findActiveMember(familyId, userId);
    if (!member) {
      // 不存在 / 已退出 / 家庭已解散，统一回「你不在这个家里」——
      // 不区分具体原因，避免泄露「这个家庭存在但你不是成员」
      throw BusinessException.notMember();
    }

    const ownerMemberId = await this.families.ownerMemberIdOf(familyId);

    req.familyMember = {
      familyId,
      memberId: member.id,
      userId,
      roleName: member.roleName,
      isOwner: ownerMemberId != null && ownerMemberId === member.id,
    };
    return true;
  }
}

function resolveFamilyId(req: RequestWithFamily): bigint | null {
  const candidates: unknown[] = [
    req.params?.familyId,
    headerValue(req.headers['x-family-id']),
    req.query?.familyId,
  ];

  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) {
      throw BusinessException.invalidParam('家庭信息不对');
    }
    return BigInt(s);
  }
  return null;
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
