import { Injectable, Logger } from '@nestjs/common';
import { MemoryStatus, MemoryVisibility, ThingStatus, dbToEnum, enumToDb } from '@shared/enums';
import type {
  ListMemoriesResponse,
  MemoryAttachmentBrief,
  MemoryAttachmentInput,
  MemoryItem,
  MemoryThingRef,
  MemoryVisibilityValue,
} from '@shared/dto/memory';
import type { MemberBrief } from '@shared/dto/common';
import type { FamilyMemory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/errors/business.exception';
import {
  formatDateRequired,
  formatDateTimeRequired,
  toNumberRequired,
} from '../../common/serialize/beijing-time';
import type { FamilyMemberContext } from '../families/family-context';
import { FamiliesService } from '../families/families.service';
import { ContentSecurityService } from '../wechat/content-security.service';
import { StorageService } from '../upload/storage.service';
import type { CreateMemoryDto, ListMemoriesQueryDto, UpdateMemoryDto } from './dto/memory.dto';
import { MEMORY_DEFAULT_LIMIT } from './dto/memory.dto';

/**
 * 留个念的业务逻辑 —— docs/02 §七。
 *
 * ## 产品定位（PRD §18.1）
 *
 * **不是朋友圈**，是「属于一家人的私人时间线」。所以这里：
 *   - 没有点赞 / 评论 / 转发，接口上也没有它们的预留字段
 *   - 时间线上「完成纪念」与「独立留念」**不做视觉区分**
 *     （一旦区分，时间线就滑向「任务日志」）
 *
 * ## 三条贯穿全文件的纪律
 *
 * ① **隐私过滤在服务端。** `visibility=PRIVATE` 的记录只有发布者能看见，
 *    列表用 `OR` 条件过滤，详情对别人直接回 40400（**不是 40300** ——
 *    40300 等于告诉对方「这里有一条你看不到的记录」）。
 *
 * ② **游标用 `id`，不用 `created_at`。** `created_at` 是 `DATETIME(0)`
 *    （秒精度），同一秒里发两条就会有相同时间戳，`created_at < cursor`
 *    翻页会**静默漏掉**并列的那几条。`id` 自增唯一，顺序即插入顺序。
 *
 * ③ **图片不可变。** 「全库不做物理 DELETE」，而 `memory_attachments`
 *    没有状态位 —— 所以 `PATCH` 只改正文与可见范围，`DELETE` 只置
 *    `family_memories.status=0`（附件行原样留着，跟着记录一起「消失」）。
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly families: FamiliesService,
    private readonly contentSecurity: ContentSecurityService,
    private readonly storage: StorageService,
  ) {}

  // =============================================================
  // 家庭上下文：由「记录 ID」反查
  // =============================================================

  /**
   * 由「记录 ID」反查家庭上下文 —— 给 `GET/PATCH/DELETE /memories/:id` 用。
   *
   * 为什么不让前端在 URL / body 里带上 `familyId`：记录自己就知道属于哪个家，
   * 让前端多传一个「必须与记录一致」的参数，只会多一类对不上的 bug。
   * 与 `ThingService.contextForThing` / `MenuService.contextForItem` 同一个模式。
   *
   * 失败语义：
   *   记录不存在 / 已删除 / 是别人的私密记录 → **40400**（都不透露存在性）
   *   记录存在但我不是这个家的成员          → **40300**
   */
  async contextForMemory(userId: bigint, memoryId: bigint): Promise<FamilyMemberContext> {
    const row = await this.prisma.familyMemory.findUnique({
      where: { id: memoryId },
      select: { familyId: true, creatorMemberId: true, status: true, visibility: true },
    });
    if (!row || row.status === MemoryStatus.DELETED) throw BusinessException.notFound('记录');

    const member = await this.families.findActiveMember(row.familyId, userId);
    if (!member) throw BusinessException.notMember();

    // 别人的私密记录：**当它不存在**（40300 会泄露「这里有一条你看不到的东西」）
    if (row.visibility === MemoryVisibility.PRIVATE && row.creatorMemberId !== member.id) {
      throw BusinessException.notFound('记录');
    }

    const ownerMemberId = await this.families.ownerMemberIdOf(row.familyId);
    return {
      familyId: row.familyId,
      memberId: member.id,
      userId,
      roleName: member.roleName,
      isOwner: ownerMemberId != null && ownerMemberId === member.id,
    };
  }

  // =============================================================
  // 发布（M4-5）
  // =============================================================

  /** 发布一条记录（docs/02 §7.1）。正文与图片**至少给一样**。 */
  async create(ctx: FamilyMemberContext, dto: CreateMemoryDto): Promise<MemoryItem> {
    const content = dto.content?.trim() ?? '';
    const attachments = dto.attachments ?? [];

    if (!content && attachments.length === 0) {
      // 跨字段规则，DTO 层表达不了 —— 而且这句话写在 service 里更像人话
      throw BusinessException.invalidParam('写点什么，或者加张图片吧');
    }

    // ① 内容安全 —— **在事务之外**：检测失败要能整体回滚，不留半条数据
    await this.contentSecurity.assertTextSafe(ctx.userId, content, '留念正文');

    // ② 「完成纪念」要确认那件小事真的做完了
    if (dto.thingId != null) await this.assertThingCompleted(ctx, BigInt(dto.thingId));

    // ③ 图片地址必须来自我们自己的桶（见方法注释）
    this.assertAttachmentsOwnedByUs(attachments);

    const memoryId = await this.prisma.$transaction(async (tx) => {
      const memory = await tx.familyMemory.create({
        data: {
          familyId: ctx.familyId,
          creatorMemberId: ctx.memberId,
          content,
          thingId: dto.thingId != null ? BigInt(dto.thingId) : null,
          visibility:
            enumToDb(MemoryVisibility, dto.visibility ?? 'FAMILY') ?? MemoryVisibility.FAMILY,
          status: MemoryStatus.NORMAL,
        },
        select: { id: true },
      });

      if (attachments.length > 0) {
        await tx.memoryAttachment.createMany({
          data: attachments.map((a, i) => ({
            memoryId: memory.id,
            fileUrl: a.fileUrl,
            fileType: a.fileType ?? null,
            fileSize: a.fileSize ?? null,
            width: a.width ?? null,
            height: a.height ?? null,
            sortNo: a.sortNo ?? i,
          })),
        });
      }

      return memory.id;
    });

    return this.detail(ctx, memoryId);
  }

  // =============================================================
  // 时间线（M4-6）
  // =============================================================

  /** 家庭时间线，含服务端隐私过滤与游标分页（docs/02 §7.2） */
  async list(ctx: FamilyMemberContext, query: ListMemoriesQueryDto): Promise<ListMemoriesResponse> {
    const limit = query.limit ?? MEMORY_DEFAULT_LIMIT;

    // 多取一条用来判断「还有没有下一页」—— 比再查一次 count 便宜
    const rows = await this.prisma.familyMemory.findMany({
      where: {
        familyId: ctx.familyId,
        status: MemoryStatus.NORMAL,
        // 隐私过滤：家庭可见的 + 我自己的（不管它是不是私密）
        OR: [{ visibility: MemoryVisibility.FAMILY }, { creatorMemberId: ctx.memberId }],
        ...(query.cursor != null ? { id: { lt: BigInt(query.cursor) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0 ? toNumberRequired(page[page.length - 1].id) : null;

    const items = await this.toItems(page, ctx);
    return { list: items, nextCursor, hasMore };
  }

  // =============================================================
  // 详情（M4-7）
  // =============================================================

  /** 记录详情（docs/02 §7.3）。形状与列表项**完全相同**（见 dto/memory.ts） */
  async detail(ctx: FamilyMemberContext, memoryId: bigint): Promise<MemoryItem> {
    const row = await this.prisma.familyMemory.findFirst({
      where: { id: memoryId, familyId: ctx.familyId, status: MemoryStatus.NORMAL },
    });
    if (!row) throw BusinessException.notFound('记录');

    // ⚠️ 隐私过滤**在这里再判一次**，不依赖调用方已经过了 `contextForMemory`。
    //    「数据权限过滤必须在服务端做」是铁律 —— 而「调用方已经校验过」
    //    正是这条铁律最容易被绕过的方式（多一个调用点就漏一次）。
    if (row.visibility === MemoryVisibility.PRIVATE && row.creatorMemberId !== ctx.memberId) {
      throw BusinessException.notFound('记录');
    }

    const [item] = await this.toItems([row], ctx);
    return item;
  }

  // =============================================================
  // 编辑（M4-7）
  // =============================================================

  /** 编辑记录（docs/02 §7.4）。**仅发布者**；只改正文与可见范围 */
  async update(
    ctx: FamilyMemberContext,
    memoryId: bigint,
    dto: UpdateMemoryDto,
  ): Promise<MemoryItem> {
    const row = await this.loadEditable(ctx, memoryId);

    const content = dto.content !== undefined ? dto.content.trim() : row.content;

    if (dto.content !== undefined) {
      // ⚠️ 「正文与图片至少给一样」在**编辑时同样成立**，否则会留下一条空白卡片。
      //    这条规则不能交给 DTO 的 `@IsNotEmpty` —— 它判的是**没 trim 的值**，
      //    所以 `content: '   '` 能过校验，trim 完却是空串（冒烟脚本抓到的）。
      //    规则只写一遍：与 `create` 同一句话、同一个位置。
      if (!content) {
        const pics = await this.prisma.memoryAttachment.count({ where: { memoryId } });
        if (pics === 0) throw BusinessException.invalidParam('写点什么，或者加张图片吧');
      }
      // 改了正文才检测；没改就没必要再花一次微信调用
      await this.contentSecurity.assertTextSafe(ctx.userId, content, '留念正文');
    }

    await this.prisma.familyMemory.update({
      where: { id: memoryId },
      data: {
        content,
        ...(dto.visibility !== undefined
          ? { visibility: enumToDb(MemoryVisibility, dto.visibility) ?? row.visibility }
          : {}),
      },
    });

    return this.detail(ctx, memoryId);
  }

  // =============================================================
  // 删除（M4-7）
  // =============================================================

  /**
   * 删除记录（docs/02 §7.5）。**仅发布者**。
   *
   * **逻辑删除**：`status=0`。附件行**不动** —— 它们没有状态位，
   * 而记录一删就再也不会被任何查询带出来，留着不影响任何行为。
   * 真要做「物理清理」是运维的事（将来配生命周期规则），不是接口的事。
   */
  async remove(ctx: FamilyMemberContext, memoryId: bigint): Promise<{ id: number }> {
    await this.loadEditable(ctx, memoryId);

    await this.prisma.familyMemory.update({
      where: { id: memoryId },
      data: { status: MemoryStatus.DELETED },
    });

    return { id: toNumberRequired(memoryId) };
  }

  // =============================================================
  // 内部：取数与装配
  // =============================================================

  /** 载入一条**可编辑**的记录（存在 + 未删 + 是我发的） */
  private async loadEditable(ctx: FamilyMemberContext, memoryId: bigint): Promise<FamilyMemory> {
    const row = await this.prisma.familyMemory.findFirst({
      where: { id: memoryId, familyId: ctx.familyId, status: MemoryStatus.NORMAL },
    });
    if (!row) throw BusinessException.notFound('记录');

    if (row.creatorMemberId !== ctx.memberId) {
      throw BusinessException.forbidden('只有发布人能改这一条');
    }
    return row;
  }

  /** 批量装配记录（附件、发布人、关联小事各一次查询，不做 N+1） */
  private async toItems(rows: FamilyMemory[], ctx: FamilyMemberContext): Promise<MemoryItem[]> {
    if (rows.length === 0) return [];

    const [attachmentMap, creatorMap, thingMap] = await Promise.all([
      this.attachmentMap(rows.map((r) => r.id)),
      this.creatorMap(rows.map((r) => r.creatorMemberId)),
      this.thingRefMap(rows.map((r) => r.thingId)),
    ]);

    return rows.map((r) => ({
      id: toNumberRequired(r.id),
      date: formatDateRequired(r.createdAt),
      content: r.content,
      visibility: (dbToEnum(MemoryVisibility, r.visibility) ?? 'FAMILY') as MemoryVisibilityValue,
      creator: creatorMap.get(r.creatorMemberId) ?? unknownMember(r.creatorMemberId),
      attachments: attachmentMap.get(r.id) ?? [],
      thing: r.thingId != null ? (thingMap.get(r.thingId) ?? null) : null,
      isMine: r.creatorMemberId === ctx.memberId,
      createdAt: formatDateTimeRequired(r.createdAt),
    }));
  }

  /** 一次查出这批记录的全部附件，按 `sortNo` 排好 */
  private async attachmentMap(memoryIds: bigint[]): Promise<Map<bigint, MemoryAttachmentBrief[]>> {
    const out = new Map<bigint, MemoryAttachmentBrief[]>();
    if (memoryIds.length === 0) return out;

    const rows = await this.prisma.memoryAttachment.findMany({
      where: { memoryId: { in: memoryIds } },
      orderBy: [{ sortNo: 'asc' }, { id: 'asc' }],
      select: { id: true, memoryId: true, fileUrl: true, width: true, height: true },
    });

    for (const a of rows) {
      const list = out.get(a.memoryId) ?? [];
      list.push({
        id: toNumberRequired(a.id),
        fileUrl: a.fileUrl,
        width: a.width,
        height: a.height,
      });
      out.set(a.memoryId, list);
    }
    return out;
  }

  /** 批量取发布人简写（称谓 + 头像），两次查询，不做 N+1 */
  private async creatorMap(memberIds: bigint[]): Promise<Map<bigint, MemberBrief>> {
    const ids = [...new Set(memberIds.map(String))].map((s) => BigInt(s));
    if (ids.length === 0) return new Map();

    const members = await this.prisma.familyMember.findMany({
      where: { id: { in: ids } },
      select: { id: true, roleName: true, userId: true },
    });
    if (members.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, avatarUrl: true },
    });
    const avatarById = new Map(users.map((u) => [u.id, u.avatarUrl]));

    return new Map(
      members.map((m) => [
        m.id,
        {
          memberId: toNumberRequired(m.id),
          roleName: m.roleName,
          avatarUrl: avatarById.get(m.userId) ?? null,
        } satisfies MemberBrief,
      ]),
    );
  }

  /** 批量取「完成纪念」关联的小事标题 */
  private async thingRefMap(thingIds: (bigint | null)[]): Promise<Map<bigint, MemoryThingRef>> {
    const ids = [...new Set(thingIds.filter((v): v is bigint => v != null).map(String))].map((s) =>
      BigInt(s),
    );
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.familyThing.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    return new Map(
      rows.map((t) => [
        t.id,
        { id: toNumberRequired(t.id), title: t.title } satisfies MemoryThingRef,
      ]),
    );
  }

  // =============================================================
  // 内部：校验
  // =============================================================

  /**
   * 「完成纪念」关联的那件小事必须**属于本家庭**且**已完成**（PRD §19.2）。
   *
   * 为什么要求「已完成」：入口就在小事详情页的已完成状态里（「📖 记个念 →」）。
   * 允许关联一件没做完的小事，会让时间线上出现「完成纪念」配着一件未完成的事，
   * 那是数据说谎。V0.1 没有状态回滚（PRD §15.1），所以完成态是稳定的。
   */
  private async assertThingCompleted(ctx: FamilyMemberContext, thingId: bigint): Promise<void> {
    const thing = await this.prisma.familyThing.findUnique({
      where: { id: thingId },
      select: { familyId: true, status: true },
    });

    // 别人家的小事一律 40400 —— 与「不存在」同一个语义，不透露存在性
    if (!thing || thing.familyId !== ctx.familyId) throw BusinessException.notFound('小事');

    if (thing.status !== ThingStatus.COMPLETED) {
      throw BusinessException.invalidParam('这件事还没做完，做完再记吧');
    }
  }

  /**
   * 图片地址必须来自**我们自己的桶**。
   *
   * 为什么值得判：`fileUrl` 是前端原样传上来的字符串。不判的话，
   * 任何人都能把任意外部 URL（追踪像素、别人的图、写错的地址）塞进留念 ——
   * 而小程序端加载外域图片会被 `downloadFile` 合法域名拦掉，
   * 表现为「图片加载不出来」，排查时完全看不出是数据的问题。
   *
   * ⚠️ **未配置对象存储时跳过检查**（记一条 warn）：那时上传接口本身就用不了，
   *    根本不会有正常来源的地址，拦了只会让本地开发彻底没法验 M4。
   *    这与「内容安全判不了就放行」是同一类取舍 —— 但只在这一个前提下成立。
   */
  private assertAttachmentsOwnedByUs(attachments: MemoryAttachmentInput[]): void {
    if (attachments.length === 0) return;

    const baseUrl = this.storage.publicBaseUrl();
    if (!baseUrl) {
      this.logger.warn('对象存储未配置，跳过留念图片的地址来源校验');
      return;
    }

    for (const a of attachments) {
      if (!a.fileUrl.startsWith(`${baseUrl}/`)) {
        this.logger.warn(`留念图片地址不在本桶内：${a.fileUrl}`);
        throw BusinessException.invalidParam('图片地址不对，重新上传一下');
      }
    }
  }
}

/** 成员被删/退家后仍可能有历史记录 —— 给一个占位，别让整条记录渲染不出来 */
function unknownMember(memberId: bigint): MemberBrief {
  return { memberId: toNumberRequired(memberId), roleName: '家人', avatarUrl: null };
}
