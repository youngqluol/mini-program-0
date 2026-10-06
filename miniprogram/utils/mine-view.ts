/**
 * 「我的」Tab（P20）的展示模型
 *
 * 与 `thing-view.ts` / `notice-view.ts` 同一层：把「store / 接口里的原始数据」
 * 翻成「界面要显示的那几个字段」，页面只负责「取数据 → setData → 绑事件」。
 *
 * 为什么单独抽一层：这里的判断**算错的后果都很具体**——
 * 角标显示成 0、把称谓说两遍、给创建者一个点了就报错的按钮。
 * 抽成纯函数才能在 `tools/test-view.mjs` 里断言（`tsc` 只能保证类型对）。
 *
 * ⚠️ 这个文件必须保持**纯**（不碰 `wx.*`）。有副作用的那部分在 `utils/tab-badge.ts`。
 */

import type { AuthUser, MyFamilyBrief } from '@shared/dto/auth';

// ---------------------------------------------------------------
// 抬头（头像 + 名字 + 一行小字）
// ---------------------------------------------------------------

export interface MineProfileView {
  /** 大字那一行 */
  nickname: string;
  /** 小字那一行：「在我们家 · 阿爸」；没有家庭时是空串 */
  roleLine: string;
  hasFamily: boolean;
}

/**
 * 名字优先用微信昵称，没有就退回**家庭称谓**。
 *
 * ⚠️ 昵称现在**基本拿不到**：`chooseAvatar` / 昵称填写那套授权还没做
 *    （已记入 `docs/未来需求池.md`），`AuthUser.nickname` 一直是 null。
 *    所以实际上大字那一行就是称谓 —— 这也合理：家里认的是称谓，不是微信名。
 *
 * 小字那行有一个刻意的判断：**大字那行已经是称谓时，小字不再重复它**，
 * 只报家庭名。否则「阿爸 / 在我们家 · 阿爸」会读起来像卡带。
 */
export function buildMineProfile(
  user: AuthUser | null,
  family: MyFamilyBrief | null,
): MineProfileView {
  const nickname = (user && user.nickname ? user.nickname : '').trim();

  if (!family) {
    return { nickname: nickname || '我', roleLine: '', hasFamily: false };
  }

  const shown = nickname || family.roleName;
  const roleLine =
    shown === family.roleName
      ? `在${family.familyName}`
      : `在${family.familyName} · ${family.roleName}`;

  return { nickname: shown, roleLine, hasFamily: true };
}

// ---------------------------------------------------------------
// 未读数角标
// ---------------------------------------------------------------

export interface UnreadBadgeView {
  /** 0 条时**不显示** —— 要显式移除角标，不是显示一个「0」 */
  show: boolean;
  /** 「1」…「99」「99+」；不显示时是空串 */
  text: string;
}

/** 超过这个数就不再报精确值 */
const BADGE_MAX = 99;

/**
 * 角标文案。底部 Tab 和「消息中心」这一行**共用同一个数字**，
 * 所以只在这里算一次 —— 两处各算一遍迟早会不一致。
 *
 * 为什么到 99 就不报精确值：微信的 tabBar 角标**最多显示 4 个字符**，
 * 超过就截成「前 3 个字符 + …」。与其让微信把「128」截成一个看不懂的东西，
 * 不如自己先说「99+」—— 到这个量级，用户要的是「很多」，不是精确值。
 */
export function buildUnreadBadge(count: number): UnreadBadgeView {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n <= 0) return { show: false, text: '' };
  if (n <= BADGE_MAX) return { show: true, text: String(n) };
  return { show: true, text: `${BADGE_MAX}+` };
}

// ---------------------------------------------------------------
// 退出家庭
// ---------------------------------------------------------------

export interface LeaveRowView {
  /** 能不能直接退 —— 创建者不能（后端会拦），所以不给他一个点了就报错的按钮 */
  show: boolean;
  /** 不能退时改说这一句，占按钮的位置 */
  hint: string;
}

/**
 * 创建者**不能直接退出**家庭：`FamiliesService.leave()` 会抛
 * 「你是这个家的创建者，得先解散或者转给别人」。
 *
 * 所以不给创建者这个按钮 —— 点了才被告知「不行」是很差的交互。
 * 改成一行说明，并且**不提「转给别人」**：转让创建者这个功能 V0.1 没有，
 * 说了就是在承诺一个不存在的出口（后端那句报错里的「转给别人」是同一个问题，
 * 已记入 `docs/未来需求池.md`）。
 */
export function buildLeaveRow(isOwner: boolean): LeaveRowView {
  if (isOwner) {
    return { show: false, hint: '你是这个家的创建者，想结束的话去「家庭设置」解散这个家' };
  }
  return { show: true, hint: '' };
}
