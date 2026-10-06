import { Injectable, Logger } from '@nestjs/common';
import type { MenuItem } from '@prisma/client';
import { MealType, MenuSource, dbToEnum, enumToDb } from '@shared/enums';
import type {
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
} from '../../common/serialize/beijing-time';
import type { FamilyMemberContext } from '../families/family-context';
import { MEAT_CATEGORY, SYSTEM_MENU, THIRD_CATEGORIES, VEGGIE_CATEGORY } from './default-menu';
import type {
  DecideMenuDto,
  ListMenuItemsQueryDto,
  RandomMenuQueryDto,
  RecentMealsQueryDto,
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
 */
@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const ids = await this.prisma.$transaction(async (tx) => {
      const created: bigint[] = [];
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
        created.push(row.id);
      }
      return created;
    });

    const names = items.map((item) => item.name);
    this.logger.log(
      `用户 ${ctx.userId} 在家庭 ${ctx.familyId} 记下 ${names.length} 道菜：「${names.join('、')}」`,
    );

    return {
      mealRecordIds: ids.map((id) => toNumber(id) as number),
      summary: summarize(mealType, names),
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
  // 内部：池子与抽取
  // =============================================================

  /**
   * 合成池子：系统菜谱（常量）+ 家庭菜谱（库）。
   *
   * 系统菜谱的 `id` 是 `null` —— 它们在库里没有行（PRD §16.4）。
   * 前端**不要**拿这个 `null` 去调 `PATCH /menu/items/{id}`。
   */
  private buildPool(familyDishes: MenuItem[], category?: string): MenuItemBrief[] {
    const system: MenuItemBrief[] = SYSTEM_MENU.filter(
      (dish) => !category || dish.category === category,
    ).map((dish) => ({
      id: null,
      name: dish.name,
      category: dish.category,
      imageUrl: null,
      source: MenuSource.SYSTEM,
    }));

    const family: MenuItemBrief[] = familyDishes
      .filter((row) => !category || row.category === category)
      .map((row) => ({
        id: toNumber(row.id),
        name: row.name,
        category: row.category as MenuItemBrief['category'],
        imageUrl: row.imageUrl,
        source: MenuSource.FAMILY,
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
