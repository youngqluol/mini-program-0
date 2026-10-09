/**
 * 注销账号（docs/02 §2.6 / PRD §32 / `docs/06` §4.6）。
 *
 * **为什么这件事不能只有前端。** 提审要求「有注销入口 + 注销后数据有明确的处理说明」，
 * 但真正的难点不是那个入口，是**删什么、留什么、留的那部分怎么变得认不出是谁**。
 * 本库的铁律是「不做物理 DELETE，一律状态位逻辑删除」，理由写在 AGENTS.md §4.4：
 * 「删了但历史要留着」是这个项目的常态。可这条铁律和「注销」天然打架 ——
 * 家庭里那些共享过的东西（谁派过活、谁记过念）是全家的历史，不能因为一个人走了就消失。
 *
 * 所以口径定成这样（**一句话：认人的抹掉，家里的事留下但不再署名**）：
 *
 * | 数据 | 处理 | 为什么 |
 * | --- | --- | --- |
 * | `users` | **匿名化 + 禁用 + 释放 openid** | 个人数据，必须清除 |
 * | `family_members` | 保留行，`status=0` + 匿名化 `role_name` | 它是全家历史的「作者指针」，删了历史就成了孤儿 |
 * | `thing_reminders`（发给他的） | 未发出的置为已取消 | **否则注销之后还会继续叮他** |
 * | `notification_logs`（发给他的） | **物理删除** | 见下方「唯一的例外」 |
 * | 小事 / 记录 / 用餐 / 菜谱 / 邀请 | **原样不动** | 家庭共享内容 |
 * | `families`（他是创建者的） | 交接给最早加入的家人；没有别人则解散 | 见下方「创建者走了怎么办」 |
 *
 * ---
 *
 * **① 唯一的例外：`notification_logs` 是物理删除。**
 *
 * 铁律说不做物理 DELETE，但那张表**整个都是「发给这个人的消息」** ——
 * 标题、正文、送达状态，全是个人数据，没有一丝「全家的历史」在里面
 * （全家的历史是 `family_things` / `family_memories`，那些一行没动）。
 * 留着它就等于「注销了但收件箱还在」，与 PRD §32「30 天内清除其个人数据」直接冲突。
 * 这是**全库唯一一处物理删除**，是有意为之，不是漏改。
 *
 * 顺带说明「30 天」：那是**上限**不是等待期 —— 立刻清干净当然满足「30 天内清除」。
 * 多挂一个「30 天后清理」的定时任务只会多一个会坏掉的地方，而不会更合规。
 *
 * ---
 *
 * **② 创建者走了怎么办。** V0.1 没有「转让创建者」这个功能，
 * 但**不能因此拒绝注销** —— 注销是法定权利，不能因为「你先转个别人」而被卡住
 * （`FamiliesService.leave()` 就是这么拒绝创建者的，注销不能沿用那个口径）。
 * 两种收场：
 *   - 家里还有别人 → **自动交接给最早加入的那位**（`joined_at` 最小，同级比 `id`）
 *   - 家里只剩他   → **解散**（`families.status=0`，逻辑删除，其他成员一并退出）
 * 交接是**静默**的，不通知任何人 —— 创建者身份在这个产品里只代表「能移除成员」，
 * 不是头衔。为它发一条通知反而像在宣布「谁上位了」。
 *
 * ---
 *
 * **③ 匿名化不能靠「只改个名字」。** 除了 `role_name`，还必须把
 * `users.openid` 置换成墓碑值：它是唯一的登录锚点，留着就意味着
 * 「注销后拿同一个微信还能登回这个号、还带着这些数据」。
 * 置换成 `deleted:<id>` 之后，同一个微信再登录会**新建一个干净的账号**
 * （`upsertUser` 按 openid 找不到旧行）—— 这正是「注销」该有的语义。
 * 该值不可能与真实 openid 撞车：微信 openid 的字符集是 `[A-Za-z0-9_-]`，
 * **冒号不可能出现**。
 */

import { Injectable, Logger } from '@nestjs/common';
import { EnabledStatus, MemberStatus, ReminderStatus } from '@shared/enums';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 注销后写进 `family_members.role_name` 的占位称谓。
 *
 * 选这句而不是空白 / `null`（该列 NOT NULL）：历史记录里会显示
 * 「已注销的家人 完成了 买牛奶」，读起来是**一句人话**，
 * 而不是一个坏掉的数据位。它也不泄露「原来是谁」—— 这是匿名化的全部意义。
 */
const ANONYMIZED_ROLE_NAME = '已注销的家人';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 注销当前登录用户。
   *
   * **幂等**：用户不存在 / 已禁用时直接当成功返回，不做任何事。
   *
   * ⚠️ 别把这个幂等理解成「客户端重试会拿到 code 0」—— **不会**。
   *    第二次带同一个 token 打进来时，`JwtGuard` 的账号状态检查
   *    （`status=0` → 40100）就已经把它拦在门外了，根本到不了这里。
   *    这一层真正挡的是**并发**：同一瞬间两个请求都通过了守卫，
   *    第一个提交后第二个才读到 `status` —— 没有这一句，
   *    交接创建者、匿名化会被跑第二遍（`openid` 被盖第二次、
   *    家庭被交接两轮），虽然结果多半一样，但那是靠运气，不是靠设计。
   *
   * 而「响应丢了、用户重按一次」那条路径由**客户端**收场，见
   * `miniprogram/services/request.ts`：40100 → 静默重登 →
   * 同一个微信登进来是一个全新的空账号 → 重放这次注销 → 删掉那个空账号。
   */
  async deleteAccount(userId: bigint): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== EnabledStatus.ENABLED) return;

    const members = await this.prisma.familyMember.findMany({
      where: { userId },
      select: { id: true, status: true },
    });
    const memberIds = members.map((m) => m.id);
    const activeMemberIds = members
      .filter((m) => m.status === MemberStatus.ACTIVE)
      .map((m) => m.id);

    // 他是创建者的家庭（只有「还在的」成员关系才可能是现任创建者）
    const ownedFamilies =
      activeMemberIds.length === 0
        ? []
        : await this.prisma.family.findMany({
            where: {
              ownerMemberId: { in: activeMemberIds },
              status: EnabledStatus.ENABLED,
            },
            select: { id: true },
          });

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.handOverOwnedFamilies(tx, ownedFamilies, memberIds, now);
      await this.exitAndAnonymizeMemberships(tx, userId, now);
      await this.cancelPendingReminders(tx, memberIds);
      await this.clearInbox(tx, userId);
      await this.anonymizeUser(tx, userId);
    });

    this.logger.log(
      `账号已注销 userId=${userId} 成员关系=${members.length} 交接/解散家庭=${ownedFamilies.length}`,
    );
  }

  // -------------------------------------------------------------
  // 内部：五个步骤，各自只做一件事
  // -------------------------------------------------------------

  /**
   * 交接他创建的每个家庭。
   *
   * 注意「没有别人 → 解散」这一支里，**其他成员也要一并退出** ——
   * 否则会留下一批 `status=1` 的成员指向一个 `status=0` 的家庭，
   * 他们打开小程序会看到「我家没了」但列表里还挂着一个进不去的家。
   */
  private async handOverOwnedFamilies(
    tx: Prisma.TransactionClient,
    ownedFamilies: Array<{ id: bigint }>,
    leavingMemberIds: bigint[],
    now: Date,
  ): Promise<void> {
    for (const family of ownedFamilies) {
      const successor = await tx.familyMember.findFirst({
        where: {
          familyId: family.id,
          status: MemberStatus.ACTIVE,
          id: { notIn: leavingMemberIds },
        },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });

      if (successor) {
        await tx.family.update({
          where: { id: family.id },
          data: { ownerMemberId: successor.id },
        });
        continue;
      }

      await tx.family.update({
        where: { id: family.id },
        data: { status: EnabledStatus.DISABLED },
      });
      await tx.familyMember.updateMany({
        where: { familyId: family.id, status: MemberStatus.ACTIVE },
        data: { status: MemberStatus.LEFT, leftAt: now },
      });
    }
  }

  /**
   * 退出他在所有家庭的成员关系，并把称谓匿名化。
   *
   * **⚠️ 两条语句，不能合成一条。** 如果合并成
   * `where: { userId }, data: { status: LEFT, leftAt: now, roleName: ... }`，
   * 那些**早就退出过**的成员关系会被重新写上今天的 `leftAt` ——
   * 等于篡改历史（「他上个月就退出了」变成「他今天退出的」）。
   * 匿名化要覆盖全部（含早退出的，那些行同样还挂着他的称谓），
   * 而 `leftAt` 只能写给**还在的**。
   */
  private async exitAndAnonymizeMemberships(
    tx: Prisma.TransactionClient,
    userId: bigint,
    now: Date,
  ): Promise<void> {
    await tx.familyMember.updateMany({
      where: { userId },
      data: { roleName: ANONYMIZED_ROLE_NAME },
    });
    await tx.familyMember.updateMany({
      where: { userId, status: MemberStatus.ACTIVE },
      data: { status: MemberStatus.LEFT, leftAt: now },
    });
  }

  /**
   * 收掉「还没发给他」的提醒。
   *
   * **这一步不能省。** `ThingService.userIdOfMember()` 只按 `family_members.id`
   * 反查 `user_id`，**不看成员状态** —— 所以光把成员置为「已退出」，
   * 调度器到点照样会把提醒发到一个已经没有的人身上（订阅消息 / 公众号都发得出去，
   * 因为 `users` 行的 id 还在）。用户会收到「家人的叮一下」，
   * 而他明明已经把账号注销了 —— 这是这个功能里最容易漏、也最像 bug 的一环。
   *
   * 已经发出去的（`status=2`）不动：那是「通知留痕」，删了会让
   * 消息中心的历史凭据断裂，而它本来就只是告诉他「刚刚发生了什么」。
   */
  private async cancelPendingReminders(
    tx: Prisma.TransactionClient,
    memberIds: bigint[],
  ): Promise<void> {
    if (memberIds.length === 0) return;

    await tx.thingReminder.updateMany({
      where: {
        recipientMemberId: { in: memberIds },
        status: ReminderStatus.PENDING,
      },
      data: { status: ReminderStatus.CANCELLED, nextRemindAt: null },
    });
  }

  /** 清掉他的收件箱 —— 全库唯一的物理删除，理由见文件头「①」。 */
  private async clearInbox(tx: Prisma.TransactionClient, userId: bigint): Promise<void> {
    await tx.notificationLog.deleteMany({ where: { userId } });
  }

  /**
   * 用户本体：匿名化 + 禁用 + 把 openid 换成墓碑值。
   *
   * `status=0` 之外，`openid` 必须一起换（理由见文件头「③」）；
   * `unionid` / `mp_openid` / 昵称 / 头像 都是身份信息，一律清空。
   * `mp_openid` 清掉同时就是「解绑微信提醒」——
   * 推送通道读的就是这个字段，置空后通道一自动跳过，不需要额外调微信接口。
   */
  private async anonymizeUser(tx: Prisma.TransactionClient, userId: bigint): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: {
        openid: tombstoneOpenid(userId),
        unionid: null,
        mpOpenid: null,
        mpBoundAt: null,
        nickname: null,
        avatarUrl: null,
        lastLoginAt: null,
        status: EnabledStatus.DISABLED,
      },
    });
  }
}

/**
 * openid 的墓碑值。
 *
 * 用 `:` 分隔是**刻意**的：微信 openid 的字符集是 `[A-Za-z0-9_-]`（28 位），
 * 冒号不可能出现 —— 所以这个值**在数学上**不会和任何一个真实 openid 撞车，
 * 不需要任何去重逻辑。带上 `id` 是为了排查时还能对上人。
 */
function tombstoneOpenid(userId: bigint): string {
  return `deleted:${userId}`;
}
