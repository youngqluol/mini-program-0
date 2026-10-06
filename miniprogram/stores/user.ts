/**
 * 登录态管理（M1-F3）
 *
 * 小程序端没有引入状态管理库 —— 这里只需要维护一份「登录态 + 我的家庭」，
 * 手写一个带订阅的小 store 比装 mobx/redux 更轻、更透明（docs/04 §5.2：不引入无谓依赖）。
 *
 * 三份数据的关系：
 *   token           → 请求鉴权用
 *   user            → 昵称头像（「我的」Tab）
 *   families        → 决定冷启动跳哪一页：空 → 引导页，非空 → 首页
 *   currentFamilyId → 多家庭场景的上下文；V0.1 只有一个家庭，取第一个
 *
 * ⚠️ 这里存的是 `MyFamilyBrief`（登录接口顺带返回的），**不含 `isOwner` / `memberCount`**。
 *    页面需要这些字段时自己调 `GET /families/{id}` 或 `GET /families`——
 *    不要在 store 里补默认值，那会造出「看起来是创建者」的假数据。
 */

import type { AuthUser, LoginResponse, MyFamilyBrief } from '@shared/dto/auth';
import type { MyFamily } from '@shared/dto/family';
import * as authApi from '../services/auth';
import * as familyApi from '../services/family';
import { setReloginHandler } from '../services/request';
import { storage } from '../utils/storage';

export interface UserState {
  /** 登录态 token；未登录为空串 */
  token: string;
  /** 当前用户资料 */
  user: AuthUser | null;
  /** 我加入的家庭（简要信息） */
  families: MyFamilyBrief[];
  /** 当前家庭；未加入任何家庭时为 null */
  currentFamilyId: number | null;
}

const EMPTY_STATE: UserState = {
  token: '',
  user: null,
  families: [],
  currentFamilyId: null,
};

let state: UserState = { ...EMPTY_STATE };

type Listener = (state: UserState) => void;
const listeners: Listener[] = [];

function emit(): void {
  // 复制一份再遍历：监听者可能在回调里取消订阅，直接遍历原数组会漏掉/错位
  listeners.slice().forEach((fn) => fn(state));
}

function setState(patch: Partial<UserState>): void {
  state = { ...state, ...patch };
  emit();
}

// =============================================================
// 订阅
// =============================================================

export function getState(): UserState {
  return state;
}

/** 订阅变更，返回取消订阅的函数（页面 `onUnload` 里调） */
export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// =============================================================
// 派生状态
// =============================================================

export function isLoggedIn(): boolean {
  return state.token !== '';
}

/** 已登录但没有任何家庭 → 需要走「创建 / 加入」引导 */
export function needsFamilySetup(): boolean {
  return state.families.length === 0;
}

export function getCurrentFamily(): MyFamilyBrief | null {
  if (state.currentFamilyId === null) return null;
  return state.families.find((f) => f.familyId === state.currentFamilyId) ?? null;
}

// =============================================================
// 恢复 / 登录 / 登出
// =============================================================

/** 冷启动时从本地缓存恢复登录态（同步，不阻塞首屏） */
export function restore(): void {
  state = {
    token: storage.getToken(),
    user: storage.getUser<AuthUser>(),
    families: storage.getFamilies<MyFamilyBrief>(),
    currentFamilyId: storage.getCurrentFamilyId(),
  };
  emit();
}

/** 取 `wx.login` 的 code */
function fetchWxCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) resolve(res.code);
        else reject(new Error('登录没成功，再试一次'));
      },
      fail: () => reject(new Error('登录没成功，再试一次')),
    });
  });
}

function applyLogin(res: LoginResponse): void {
  const currentFamilyId =
    res.currentFamilyId ?? (res.families.length > 0 ? res.families[0].familyId : null);

  state = {
    token: res.token,
    user: res.user,
    families: res.families,
    currentFamilyId,
  };

  storage.setToken(res.token);
  storage.setUser(res.user);
  storage.setFamilies(res.families);
  storage.setCurrentFamilyId(currentFamilyId);

  emit();
}

/** 走完整登录流程（wx.login → POST /auth/login），并把结果写进 store 与缓存 */
export async function login(): Promise<LoginResponse> {
  const code = await fetchWxCode();
  const res = await authApi.login({ code });
  applyLogin(res);
  return res;
}

/** 有登录态就直接过；没有就登录一次。返回是否可用。 */
export async function ensureLogin(): Promise<boolean> {
  if (isLoggedIn()) return true;
  try {
    await login();
    return true;
  } catch {
    return false;
  }
}

/** 退出登录（清空本地登录态；服务端无状态，不需要通知） */
export function logout(): void {
  state = { ...EMPTY_STATE };
  storage.clearAuth();
  emit();
}

/** 更新本地用户资料（改完昵称头像后同步 store 与缓存） */
export function updateLocalUser(user: AuthUser): void {
  setState({ user });
  storage.setUser(user);
}

// =============================================================
// 家庭
// =============================================================

/** 切换当前家庭（V0.1 只有一个家庭，接口先留着，V0.2 放开入口即可） */
export function setCurrentFamily(familyId: number): void {
  setState({ currentFamilyId: familyId });
  storage.setCurrentFamilyId(familyId);
}

/**
 * 重新拉取我的家庭列表（完整字段），并同步更新 store 里的简要信息。
 *
 * 创建 / 加入家庭后必须调一次 —— 否则冷启动的路由判断会依据过期的列表。
 */
export async function reloadFamilies(): Promise<MyFamily[]> {
  const list = await familyApi.listMine();

  const briefs: MyFamilyBrief[] = list.map((f) => ({
    familyId: f.familyId,
    familyName: f.familyName,
    memberId: f.memberId,
    roleName: f.roleName,
  }));

  const stillThere =
    state.currentFamilyId !== null && briefs.some((f) => f.familyId === state.currentFamilyId);

  const currentFamilyId = stillThere
    ? state.currentFamilyId
    : (briefs.length > 0 ? briefs[0].familyId : null);

  setState({ families: briefs, currentFamilyId });
  storage.setFamilies(briefs);
  storage.setCurrentFamilyId(currentFamilyId);

  return list;
}

/**
 * 本地追加一个家庭（创建 / 加入成功后调用，省一次网络往返）。
 *
 * 随后仍建议调 `reloadFamilies()` 对齐 —— 这里只保证「立刻可用」。
 */
export function addFamily(brief: MyFamilyBrief): void {
  const families = state.families.filter((f) => f.familyId !== brief.familyId);
  families.push(brief);
  setState({ families, currentFamilyId: brief.familyId });
  storage.setFamilies(families);
  storage.setCurrentFamilyId(brief.familyId);
}

/** 本地移除一个家庭（退出 / 解散 / 被移出后调用） */
export function removeFamily(familyId: number): void {
  const families = state.families.filter((f) => f.familyId !== familyId);
  const currentFamilyId =
    state.currentFamilyId === familyId
      ? (families.length > 0 ? families[0].familyId : null)
      : state.currentFamilyId;

  setState({ families, currentFamilyId });
  storage.setFamilies(families);
  storage.setCurrentFamilyId(currentFamilyId);
}

// =============================================================
// 注入「静默重登」实现
// =============================================================

// request 层不 import store（否则循环依赖），由这里反向注册。
// 拿到 401 时 request 会调它，成功后自动重放原请求，用户全程无感。
setReloginHandler(async () => {
  try {
    await login();
    return true;
  } catch {
    return false;
  }
});
