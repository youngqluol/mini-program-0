import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MenuItem } from '@prisma/client';
import { MealType, MenuSource, dbToEnum, enumToDb } from '@shared/enums';
import type {
  DecideAndAssignResponse,
  DecideMenuResponse,
  ListMenuItemsResponse,
  MealTypeValue,
  MenuItemBrief,
  MenuItemRow,
  RandomMenuResponse,
  RecentMealGroup,
} from '@shared/dto/menu';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/errors/business.exception';
import {
  beijingDayStartOffset,
  formatDateRequired,
  parseBeijingDate,
  toNumber,
  toNumberRequired,
} from '../../common/serialize/beijing-time';
import type { FamilyMemberContext } from '../families/family-context';
import { FamiliesService } from '../families/families.service';
import { ThingService } from '../thing/thing.service';
import type { ReminderInputDto } from '../thing/dto/thing.dto';
import { ContentSecurityService } from '../wechat/content-security.service';
import { MEAT_CATEGORY, SYSTEM_MENU, THIRD_CATEGORIES, VEGGIE_CATEGORY } from './default-menu';
import type {
  CreateMenuItemDto,
  DecideAndAssignDto,
  DecideMenuDto,
  ListMenuItemsQueryDto,
  RandomMenuQueryDto,
  RecentMealsQueryDto,
  UpdateMenuItemDto,
} from './dto/menu.dto';

/** 「最近吃过的」默认往前看几天 */
const DEFAULT_RECENT_DAYS = 7;
/** 「排除最近 3 天吃过的」——含今天在内的 3 个自然日 */
const EXCLUDE_RECENT_DAYS = 3;
/** 列表默认每页条数 */
const DEFAULT_PAGE_SIZE = 50;
/** 列表每页上限 */
const MAX_PAGE_SIZE = 200;
/** 一条用餐记录最多几道菜（与 DTO 的上限一致） */
const MAX_MEAL_ITEMS = 8;
/** `menu_items.enabled = 1` */
const ENABLED = 1;
/** `menu_items.enabled = 0` */
const DISABLED = 0;

/**
 * 吃啥呢的业务逻辑 —— docs/02 §六。
 *
 * 三条贯穿全文件的纪律：
 *   ① **池子在后端算。** 系统菜谱是代码常量（`default-menu.ts`），家庭菜谱在
 *      `menu_items`，两者在 `buildPool()` 里合成一个池子，随机与排除都作用在它上面。
 *   ② **「最近吃过的」按菜名比对，不按 id。** 系统菜谱没有 id，而家庭菜谱也有菜名 ——
 *      一套判据覆盖两种来源。详见 `default-menu.ts` 文件头。
 *   ③ **`meal_records` 记录的是「决定了吃什么」**，与是否派人做无关（PRD §16.5）。
 *      点了「就吃这个」写一条；选了「自己解决」同样写一条。
 *
 * 与小事模块的关系：**「一键派活」复用 `ThingService`，不另写一份创建逻辑**
 * （docs/02 §6.8）。依赖方向是 menu → thing，单向。
 */
@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly families: FamiliesService,
    private readonly things: ThingService,
    private readonly contentSecurity: ContentSecurityService,
  ) {}

  // =============================================================
  // 家庭上下文：由「菜谱 ID」反查
  // =============================================================

  /**
   * 由「菜谱 ID」反查家庭上下文 —— 给那些 URL 里**没有 familyId** 的接口用
   * （`PATCH /menu/items/:id` 与 `PATCH /menu/items/:id/enabled`）。
   *
   * 为什么不要求前端在 URL / body 里带上 familyId：菜谱自己就知道属于哪个家，
   * 让前端多传一个「必须与菜谱一致」的参数，只会多一类对不上的 bug。
   * 与 `ThingService.contextForThing` 是同一个模式（小事模块的 `:id` 路由
   * 也**不挂** `FamilyMemberGuard`，正是这个原因）。
   *
   * 失败语义：
   *   菜谱不存在（或它是**系统菜谱**，库里没有行）→ 40400
   *   菜谱存在但我不是这个家的成员          → 40300
   *
   * ⚠️ 拿到了 `ctx` 之后，`updateItem` / `setItemEnabled` **仍会**再用
   * `loadOwnedItem(ctx.familyId, id)` 复核一次 —— 「数据权限过滤必须在服务端做」
   * 是铁律，不能因为调用方「看起来已经校验过」就省掉。
   */
  async contextForItem(userId: bigint, itemId: bigint): Promise<FamilyMemberContext> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: itemId },
      select: { familyId: true },
    });
    // familyId 为 NULL = 系统菜谱（它们不在库里，但保险起见一并当「找不到」）
    if (!item || item.familyId == null) throw BusinessException.notFound('菜谱');

    const member = await this.families.findActiveMember(item.familyId, userId);
    if (!member) throw BusinessException.notMember();

    const ownerMemberId = await this.families.ownerMemberIdOf(item.familyId);
    return {
      familyId: item.familyId,
      memberId: member.id,
      userId,
      roleName: member.roleName,
      isOwner: ownerMemberId != null && ownerMemberId === member.id,
    };
  }

  // =============================================================
  // 随机推荐（docs/02 §6.1）
  // =============================================================

  /**
   * 抽几道菜。
   *
   * 顺序很重要：**先建池子 → 再排除 → 排除空了就放宽 → 最后才抽**。
   * 排除完可能一道不剩（一家人把池子里的菜都吃遍了，或者家庭菜谱很少时），
   * 那时若直接返回空，用户点「换一个」看到的就是一片空白 ——
   * **宁可重复一次，也不能给一个空卡片**。
   */
  async random(ctx: FamilyMemberContext, query: RandomMenuQueryDto): Promise<RandomMenuResponse> {
    const count = query.count ?? 1;
    const mealType = query.mealType ?? 'DINNER';
    const excludeRecent = query.excludeRecent ?? true;

    const familyDishes = await this.loadFamilyDishes(ctx.familyId, { onlyEnabled: true });
    let pool = this.buildPool(familyDishes, query.category);

    if (excludeRecent) {
      const recent = await this.recentNames(ctx.familyId, EXCLUDE_RECENT_DAYS);
      const narrowed = pool.filter((item) => !recent.has(item.name));
      if (narrowed.length > 0) pool = narrowed;
      // narrowed 为空 = 全被排除了 → 保持原池子（见上面的注释）
    }

    const items = this.pick(pool, count, mealType, query.category);
    return { items, poolSize: pool.length };
  }

  // =============================================================
  // 菜谱列表（docs/02 §6.2）
  // =============================================================

  /**
   * 「系统菜谱 + 本家庭自定义菜谱」的合集。
   *
   * **停用的家庭菜谱仍然返回**（`enabled: false`）—— 否则用户在 P17 里
   * 再也找不到它，也就没法重新启用。它们只是不进随机池。
   */
  async list(
    ctx: FamilyMemberContext,
    query: ListMenuItemsQueryDto,
  ): Promise<ListMenuItemsResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const keyword = query.keyword?.trim() ?? '';

    const familyDishes = await this.loadFamilyDishes(ctx.familyId, { onlyEnabled: false });

    const system: MenuItemRow[] = SYSTEM_MENU.filter((dish) =>
      matches(dish.name, dish.category, query.category, keyword),
    ).map((dish) => ({
      id: null,
      name: dish.name,
      category: dish.category,
      imageUrl: null,
      source: MenuSource.SYSTEM,
      enabled: true,
      canEdit: false,
    }));

    const family: MenuItemRow[] = familyDishes
      .filter((row) => matches(row.name, row.category, query.category, keyword))
      .map((row) => ({
        id: toNumber(row.id),
        name: row.name,
        category: row.category as MenuItemRow['category'],
        imageUrl: row.imageUrl,
        source: MenuSource.FAMILY,
        enabled: row.enabled === ENABLED,
        canEdit: true,
      }));

    // 系统菜谱在前（常量里已按分类分组），家庭菜谱在后（按 sort_no、再按 id）
    const merged = [...system, ...family];
    const start = (page - 1) * pageSize;
    const list = merged.slice(start, start + pageSize);

    return {
      list,
      page,
      pageSize,
      total: merged.length,
      hasMore: start + list.length < merged.length,
    };
  }

  // =============================================================
  // 决定吃什么（docs/02 §6.6）
  // =============================================================

  /**
   * 记下「今天吃什么」。
   *
   * ⚠️ **`name` 以请求为准**（`meal_records.name` 是历史快照）——
   * 用户看到的就是这个名字，记下来的也该是这个，不回头查菜谱表取名字。
   * 这样「菜谱后来被改名/停用」也不会改写历史。
   */
  async decide(ctx: FamilyMemberContext, dto: DecideMenuDto): Promise<DecideMenuResponse> {
    const mealType = requireMealType(dto.mealType);
    const mealDate = this.resolveMealDate(dto.mealDate);
    const items = await this.normalizeItems(ctx.familyId, dto.items);

    const ids = await this.prisma.$transaction((tx) =>
      this.writeMealRecords(tx, ctx, mealDate, mealType, items),
    );

    const names = items.map((item) => item.name);
    this.logger.log(
      `用户 ${ctx.userId} 在家庭 ${ctx.familyId} 记下 ${names.length} 道菜：「${names.join('、')}」`,
    );

    return {
      mealRecordIds: ids.map((id) => toNumberRequired(id)),
      summary: summarize(mealType, names),
    };
  }

  // =============================================================
  // 一键派活（docs/02 §6.8）—— M3-7
  // =============================================================

  /**
   * 记录用餐 + 生成派活 + 挂提醒，**三步一个事务**。
   *
   * 只写一半的后果很具体（docs/02 §6.8）：
   *   - 记了用餐却没派活 → 用户以为已经派了，没人做饭
   *   - 派了活却没记用餐 → 「最近吃过」第二天还推同一道菜
   *
   * 三个刻意的取舍：
   *
   * ① **派活复用 `ThingService`，不另写一份。** 见 `prepareThing` 的注释 ——
   *    「派活」的字段口径（`title` 措辞、可见性默认值 `TASK → FAMILY`、
   *    提醒的组装与 `next_remind_at` 的算法）只有一份实现。
   *    V0.1 的 `POST /menu/decide-and-assign` 与 `POST /family-things`
   *    产出**形状完全相同**的一条小事。
   * ② **准备在事务外。** `prepareThing` 里有一次微信内容安全的网络往返，
   *    在事务里等微信接口会让锁持有时间不可控（docs/02 §6.8）。
   * ③ **通知在提交后。** 通知里带着 `thingId`，事务没提交时对方点进去会 404。
   */
  async decideAndAssign(
    ctx: FamilyMemberContext,
    dto: DecideAndAssignDto,
  ): Promise<DecideAndAssignResponse> {
    const mealType = requireMealType(dto.mealType);
    const mealDate = this.resolveMealDate(dto.mealDate);
    const items = await this.normalizeItems(ctx.familyId, dto.items);
    const names = items.map((item) => item.name);

    // 派活的标题 = 一句带事项名的话（docs/03 §4.1：「今晚做饭：番茄炒蛋、炒青菜」）。
    // 用 `title` 而不是 `content` 承载菜名：列表行只显示 `title`（docs/03 P11），
    // 写进 content 的话「今晚做什么」在列表里就看不见了。
    const title = assignTitle(mealType, names);

    const prepared = await this.things.prepareThing(ctx, {
      familyId: dto.familyId,
      type: 'TASK',
      title,
      content: null,
      assigneeMemberId: dto.assigneeMemberId,
      dueAt: dto.dueAt ?? null,
      reminders: buildAssignReminders(dto),
    });

    const { mealRecordIds, created } = await this.prisma.$transaction(async (tx) => {
      const ids = await this.writeMealRecords(tx, ctx, mealDate, mealType, items);
      const thing = await this.things.insertThing(tx, ctx, prepared);
      return { mealRecordIds: ids, created: thing };
    });

    this.logger.log(
      `用户 ${ctx.userId} 在家庭 ${ctx.familyId} 记下 ${names.length} 道菜并派活 ${created.thing.id}「${title}」`,
    );

    await this.things.dispatchCreatedThing(ctx, created);

    return {
      thingId: toNumberRequired(created.thing.id),
      mealRecordIds: mealRecordIds.map((id) => toNumberRequired(id)),
      title: created.thing.title,
    };
  }

  // =============================================================
  // 最近吃过（docs/02 §6.7）
  // =============================================================

  /** 按「日期 + 餐次」归组返回。新的一天在前，同一天里晚餐在前。 */
  async recent(ctx: FamilyMemberContext, query: RecentMealsQueryDto): Promise<RecentMealGroup[]> {
    const days = query.days ?? DEFAULT_RECENT_DAYS;
    // days = 7 表示「含今天在内的 7 个自然日」→ 起点是今天往前推 6 天
    const from = beijingDayStartOffset(-(days - 1));

    const rows = await this.prisma.mealRecord.findMany({
      where: { familyId: ctx.familyId, mealDate: { gte: from } },
      orderBy: [{ mealDate: 'desc' }, { mealType: 'desc' }, { id: 'asc' }],
      select: { mealDate: true, mealType: true, name: true },
    });

    const groups: RecentMealGroup[] = [];
    let current: RecentMealGroup | null = null;

    for (const row of rows) {
      const mealDate = formatDateRequired(row.mealDate);
      const mealType = mealTypeFromDb(row.mealType);
      if (!current || current.mealDate !== mealDate || current.mealType !== mealType) {
        current = { mealDate, mealType, names: [] };
        groups.push(current);
      }
      current.names.push(row.name);
    }

    return groups;
  }

  // =============================================================
  // 菜谱管理（docs/02 §6.3 / §6.4 / §6.5）—— M3-5
  // =============================================================

  /**
   * 新增家庭自定义菜谱。
   *
   * ⚠️ **只能往自己家加。** `family_id` 取 `ctx.familyId`，请求体里的
   * `familyId` 只用来过守卫 —— 前端改它也不会写到别人家去。
   *
   * ⚠️ **同名会被拒（40900）。** 菜名是池子里的唯一标识（系统菜谱没有 `id`，
   * 见 `default-menu.ts`），同一个家里出现两条同名菜谱的后果是
   * **随机结果里可能连出两个一样的菜**（`shuffle` 抽到两个不同行、同一个名字）。
   * 所以这里挡在写入前，而不是等到推荐时才去重。
   */
  async createItem(ctx: FamilyMemberContext, dto: CreateMenuItemDto): Promise<MenuItemRow> {
    const name = dto.name.trim();
    if (!name) throw BusinessException.invalidParam('菜名写点什么呢');

    await this.contentSecurity.assertTextSafe(ctx.userId, name, '菜名');
    await this.assertNameFree(ctx.familyId, name);

    // 排到自家菜谱末尾 —— 系统菜谱的展示顺序由常量决定，家庭菜谱按加入顺序
    const last = await this.prisma.menuItem.aggregate({
      where: { familyId: ctx.familyId },
      _max: { sortNo: true },
    });

    const row = await this.prisma.menuItem.create({
      data: {
        familyId: ctx.familyId,
        name,
        category: dto.category ?? null,
        imageUrl: dto.imageUrl?.trim() || null,
        enabled: ENABLED,
        sortNo: (last._max.sortNo ?? 0) + 1,
        createdByMemberId: ctx.memberId,
      },
    });

    this.logger.log(`用户 ${ctx.userId} 在家庭 ${ctx.familyId} 加了菜谱「${name}」`);
    return toRow(row);
  }

  /**
   * 改家庭自定义菜谱（只传要改的字段）。
   *
   * ⚠️ 系统菜谱改不了 —— 它们不在库里（`loadOwnedItem` 查不到 → 40400）。
   * 前端用 `canEdit` / `source` 判断，不要拿系统菜谱的 `id: null` 来调。
   */
  async updateItem(
    ctx: FamilyMemberContext,
    itemId: bigint,
    dto: UpdateMenuItemDto,
  ): Promise<MenuItemRow> {
    const item = await this.loadOwnedItem(ctx.familyId, itemId);

    const data: {
      name?: string;
      category?: string | null;
      imageUrl?: string | null;
    } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw BusinessException.invalidParam('菜名不能空着');
      await this.contentSecurity.assertTextSafe(ctx.userId, name, '菜名');
      await this.assertNameFree(ctx.familyId, name, item.id);
      data.name = name;
    }
    // null 表示「清空分类」，undefined 表示「没传这个字段」—— 两者不能混
    if (dto.category !== undefined) data.category = dto.category ?? null;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl?.trim() || null;

    const row = await this.prisma.menuItem.update({ where: { id: item.id }, data });
    return toRow(row);
  }

  /**
   * 停用 / 启用家庭自定义菜谱。
   *
   * 停用只是**不进随机池**，菜谱本身仍然出现在 `GET /menu/items` 里
   * （否则用户在 P17 里再也找不到它，也就没法重新启用）。
   */
  async setItemEnabled(
    ctx: FamilyMemberContext,
    itemId: bigint,
    enabled: boolean,
  ): Promise<MenuItemRow> {
    const item = await this.loadOwnedItem(ctx.familyId, itemId);
    const row = await this.prisma.menuItem.update({
      where: { id: item.id },
      data: { enabled: enabled ? ENABLED : DISABLED },
    });
    return toRow(row);
  }

  // =============================================================
  // 内部：池子与抽取
  // =============================================================

  /**
   * 合成池子：系统菜谱（常量）+ 家庭菜谱（库）。
   *
   * 系统菜谱的 `id` 是 `null` —— 它们在库里没有行（PRD §16.4）。
   * 前端**不要**拿这个 `null` 去调 `PATCH /menu/items/{id}`。
   *
   * ⚠️ **按菜名去重，家庭菜谱优先。** 菜名是池子里的唯一标识，同名会在
   * 抽取时被当成两道不同的菜 —— `shuffle(pool).slice(0, 3)` 可能一次
   * 抽到「番茄炒蛋」和家庭自建的「番茄炒蛋」，于是推荐结果里出现
   * 「今晚吃：番茄炒蛋、番茄炒蛋」。家庭版覆盖系统版是**对的**：
   * 它可能带图片、也可能就是这家人的做法。
   * （同一个家里重复添加同名菜谱在 `createItem` 就被挡住了，这里是兜底。）
   */
  private buildPool(familyDishes: MenuItem[], category?: string): MenuItemBrief[] {
    const family: MenuItemBrief[] = familyDishes
      .filter((row) => !category || row.category === category)
      .map((row) => ({
        id: toNumber(row.id),
        name: row.name,
        category: row.category as MenuItemBrief['category'],
        imageUrl: row.imageUrl,
        source: MenuSource.FAMILY,
      }));

    const familyNames = new Set(family.map((item) => item.name));

    const system: MenuItemBrief[] = SYSTEM_MENU.filter(
      (dish) => (!category || dish.category === category) && !familyNames.has(dish.name),
    ).map((dish) => ({
      id: null,
      name: dish.name,
      category: dish.category,
      imageUrl: null,
      source: MenuSource.SYSTEM,
    }));

    return [...system, ...family];
  }

  /**
   * 从池子里抽 `count` 道菜。
   *
   * `count >= 3` 且晚餐且没限定分类时，**尽量**按「一荤一素一汤」搭配
   * （PRD §16.3）；凑不齐就退回随机不重复抽 —— 搭配是**尽量**，不是硬要求。
   * `外食` 不参与组合（出去吃就不存在「一荤一素」），但会被随机抽到。
   */
  private pick(
    pool: MenuItemBrief[],
    count: number,
    mealType: MealTypeValue,
    category?: string,
  ): MenuItemBrief[] {
    if (pool.length === 0) return [];

    const wantCombo = count >= 3 && mealType === 'DINNER' && !category;
    if (wantCombo) {
      const combo = this.tryCombo(pool, count);
      if (combo) return combo;
    }

    return shuffle(pool).slice(0, Math.min(count, pool.length));
  }

  /** 尽量组一个「一荤 + 一素 + 一汤/主食」；凑不齐返回 `null` 交给随机 */
  private tryCombo(pool: MenuItemBrief[], count: number): MenuItemBrief[] | null {
    const meat = pool.filter((item) => item.category === MEAT_CATEGORY);
    const veggie = pool.filter((item) => item.category === VEGGIE_CATEGORY);
    const third = pool.filter(
      (item) => item.category != null && THIRD_CATEGORIES.includes(item.category),
    );

    if (meat.length === 0 || veggie.length === 0 || third.length === 0) return null;

    const picked = [oneOf(meat), oneOf(veggie), oneOf(third)];
    if (count <= 3) return picked;

    // 还要更多道 → 从**没被选中的**里随机补，不重复
    const used = new Set(picked.map((item) => item.name));
    const rest = shuffle(pool.filter((item) => !used.has(item.name)));
    return [...picked, ...rest.slice(0, count - picked.length)];
  }

  // =============================================================
  // 内部：数据加载与校验
  // =============================================================

  /**
   * 写用餐记录 —— `decide` 与 `decideAndAssign` 共用。
   *
   * 抽出来是因为「一键派活」要把这一步和派活放进**同一个事务**：
   * 抄一份到别处，迟早会出现「一个改了字段、另一个没改」。
   */
  private async writeMealRecords(
    tx: Prisma.TransactionClient,
    ctx: FamilyMemberContext,
    mealDate: Date,
    mealType: number,
    items: readonly NormalizedItem[],
  ): Promise<bigint[]> {
    const ids: bigint[] = [];
    for (const item of items) {
      const row = await tx.mealRecord.create({
        data: {
          familyId: ctx.familyId,
          menuItemId: item.menuItemId,
          mealDate,
          mealType,
          name: item.name,
          createdByMemberId: ctx.memberId,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  }

  /**
   * 取一条**属于本家庭的**菜谱行。
   *
   * 三种情况在这里统一回 40400，**不区分**：
   *   - 这条菜谱不存在
   *   - 它是系统菜谱（库里没有行，压根查不到）
   *   - 它是别人家的
   * 区分它们就等于告诉调用方「这个 id 存在，只是不是你的」。
   *
   * ⚠️ 实际请求走的是「先 `contextForItem` 反查家庭、再到这里复核」两步，
   * 所以「别人家的菜谱」在第一步就回 **40300**（`contextForItem` 的语义：
   * 「存在但你不在这个家」，与 `ThingService.contextForThing` 一致）。
   * 这一层仍要留着 —— **数据权限过滤必须在服务端做**，不能因为
   * 调用方「看起来已经校验过」就省掉。
   */
  private async loadOwnedItem(familyId: bigint, itemId: bigint): Promise<MenuItem> {
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, familyId } });
    if (!item) throw BusinessException.notFound('菜谱');
    return item;
  }

  /**
   * 同一个家里菜名不能重复 —— 菜名是池子里的唯一标识。
   *
   * 重名的后果很具体：`shuffle(pool).slice(0, 3)` 可能一次抽到两行**同名**的菜，
   * 于是推荐结果出现「今晚吃：番茄炒蛋、番茄炒蛋」。症状轻、难复现、极难查。
   * 所以挡在写入前。`exceptId` 用于改名时排除自己。
   *
   * ⚠️ 只查**本家庭**：家庭菜谱与系统菜谱同名是允许的（用户可能就想加
   * 「妈妈版红烧肉」这种同名改良版），`buildPool()` 会让家庭版覆盖系统版。
   */
  private async assertNameFree(familyId: bigint, name: string, exceptId?: bigint): Promise<void> {
    const dup = await this.prisma.menuItem.findFirst({
      where: { familyId, name, ...(exceptId != null ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw BusinessException.conflict('这道菜已经在菜谱里啦');
  }

  private async loadFamilyDishes(
    familyId: bigint,
    opts: { onlyEnabled: boolean },
  ): Promise<MenuItem[]> {
    return this.prisma.menuItem.findMany({
      where: {
        familyId,
        ...(opts.onlyEnabled ? { enabled: ENABLED } : {}),
      },
      orderBy: [{ sortNo: 'asc' }, { id: 'asc' }],
    });
  }

  /** 最近 `days` 天出现过的菜名（用于「排除最近吃过的」） */
  private async recentNames(familyId: bigint, days: number): Promise<Set<string>> {
    const from = beijingDayStartOffset(-(days - 1));
    const rows = await this.prisma.mealRecord.findMany({
      where: { familyId, mealDate: { gte: from } },
      select: { name: true },
    });
    return new Set(rows.map((row) => row.name));
  }

  /**
   * 校验并归一化「决定了吃什么」的入参。
   *
   * ⚠️ **传了 `menuItemId` 就必须属于本家庭。** 不校验的话，
   * 任何人改一下 id 就能把别人家的菜谱挂到自己的用餐记录上 ——
   * 数据权限过滤必须在服务端做（AGENTS.md 铁律）。
   *
   * 菜名以**请求**为准（历史快照），但去掉首尾空白。
   */
  private async normalizeItems(
    familyId: bigint,
    items: readonly { menuItemId?: number | null; name: string }[],
  ): Promise<NormalizedItem[]> {
    if (items.length === 0) throw BusinessException.invalidParam('要选一道菜哦');
    if (items.length > MAX_MEAL_ITEMS) {
      throw BusinessException.invalidParam(`一次最多记 ${MAX_MEAL_ITEMS} 道菜`);
    }

    const normalized: NormalizedItem[] = items.map((item) => {
      const name = item.name.trim();
      if (!name) throw BusinessException.invalidParam('菜名写点什么呢');
      return {
        menuItemId: item.menuItemId == null ? null : BigInt(item.menuItemId),
        name,
      };
    });

    const ids = normalized.map((item) => item.menuItemId).filter((id): id is bigint => id !== null);

    if (ids.length === 0) return normalized;

    const owned = await this.prisma.menuItem.findMany({
      where: { id: { in: ids }, familyId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((row) => row.id.toString()));
    for (const id of ids) {
      if (!ownedIds.has(id.toString())) throw BusinessException.invalidParam('菜谱不对');
    }

    return normalized;
  }

  /** 不传 `mealDate` 就记**今天**（北京时间） */
  private resolveMealDate(input: string | undefined): Date {
    const text = input?.trim() || formatDateRequired(new Date());
    const parsed = parseBeijingDate(text);
    if (!parsed) throw BusinessException.invalidParam('日期格式不对');
    return parsed;
  }
}

// =============================================================
// 纯函数
// =============================================================

interface NormalizedItem {
  menuItemId: bigint | null;
  name: string;
}

/** 菜名 / 分类 / 关键词三个过滤条件 —— 系统与家庭菜谱共用同一套判据 */
function matches(
  name: string,
  category: string | null,
  wantCategory: string | undefined,
  keyword: string,
): boolean {
  if (wantCategory && category !== wantCategory) return false;
  if (keyword && !name.includes(keyword)) return false;
  return true;
}

/** Fisher–Yates 洗牌。**不改原数组** —— 调用方还要拿原池子算 `poolSize` */
function shuffle<T>(input: readonly T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function oneOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function requireMealType(value: string): MealType {
  const found = enumToDb(MealType, value);
  if (found == null) throw BusinessException.invalidParam('餐次不对');
  return found as MealType;
}

/** 库里的 TINYINT → 接口字符串。查不到说明数据脏了，按 `OTHER` 兜底而不是崩。 */
function mealTypeFromDb(value: number): MealTypeValue {
  return (dbToEnum(MealType, value) as MealTypeValue | undefined) ?? 'OTHER';
}

/**
 * 给 toast 用的现成句子 —— 「今晚吃：番茄炒蛋、可乐鸡翅」。
 *
 * 放在服务端而不是前端：**同一句话只写一遍**。前端自己拼的话，
 * P02 的 ActionSheet 与派活成功后的 toast 迟早会不一致。
 */
function summarize(mealType: MealType, names: string[]): string {
  const lead =
    mealType === MealType.BREAKFAST
      ? '早餐吃'
      : mealType === MealType.LUNCH
        ? '午饭吃'
        : mealType === MealType.DINNER
          ? '今晚吃'
          : '吃点';
  return `${lead}：${names.join('、')}`;
}

/**
 * 一键派活时那条小事的 `title` —— 「今晚做饭：番茄炒蛋、炒青菜」（docs/03 §4.1）。
 *
 * ⚠️ **与 `summarize()` 刻意不同**（「今晚**吃**」vs「今晚**做饭**」）：
 * 前者是「决定了吃什么」的陈述，后者是「把做饭这件事交给你」的请求。
 * 同一个措辞用两处的话，被派活的人收到的通知会读起来像在汇报。
 *
 * 措辞必须**带上事项名**（docs/03 P11：列表行只显示 `title`，
 * 不显示 `content`）—— 写死成「派活」这种泛化短语的话，列表里一眼看不出要干什么。
 */
function assignTitle(mealType: MealType, names: string[]): string {
  const lead =
    mealType === MealType.BREAKFAST
      ? '做早饭'
      : mealType === MealType.LUNCH
        ? '做午饭'
        : mealType === MealType.DINNER
          ? '今晚做饭'
          : '做饭';
  return `${lead}：${names.join('、')}`;
}

/**
 * 「一键派活」要不要挂提醒（docs/02 §6.8 的 `withReminder` / `remindAt`）。
 *
 * 规则只有三条，刻意不做「智能默认」：
 *   - `withReminder` 不为 `true` → 不挂（P02 的 ActionSheet 就属于这种：
 *     它只问「派给谁」，不问提醒）
 *   - 挂了就一定要有个时间：优先 `remindAt`，没传就用 `dueAt`（「到点提醒」），
 *     两个都没有 → 40001。**不猜**一个时间 —— 猜错就是半夜叮人。
 */
function buildAssignReminders(dto: DecideAndAssignDto): ReminderInputDto[] {
  if (dto.withReminder !== true) return [];

  const remindAt = dto.remindAt ?? dto.dueAt ?? null;
  if (!remindAt) {
    throw BusinessException.invalidParam('要叮一下的话，得选个时间哦');
  }
  return [{ remindType: 'SCHEDULED', remindAt }];
}

/** `menu_items` 行 → 接口形状（P17 菜谱列表的一行） */
function toRow(row: MenuItem): MenuItemRow {
  return {
    id: toNumber(row.id),
    name: row.name,
    category: row.category as MenuItemRow['category'],
    imageUrl: row.imageUrl,
    source: MenuSource.FAMILY,
    enabled: row.enabled === ENABLED,
    canEdit: true,
  };
}
