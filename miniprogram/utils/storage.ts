/**
 * 本地缓存封装
 *
 * 统一在这里管 key，避免各处硬编码字符串导致「写进去了但读的是另一个 key」。
 * 小程序的 storage 是同步 API，且可能因超出上限而抛异常，这里统一兜住 ——
 * 缓存读失败不该让页面白屏，退化成「未登录」再走一遍登录流程即可。
 */

const KEYS = {
  token: 'jyss:token',
  user: 'jyss:user',
  families: 'jyss:families',
  currentFamilyId: 'jyss:currentFamilyId',
} as const;

type StorageKey = (typeof KEYS)[keyof typeof KEYS];

function read<T>(key: StorageKey): T | null {
  try {
    const value = wx.getStorageSync(key);
    if (value === '' || value === null || value === undefined) return null;
    return value as T;
  } catch {
    return null;
  }
}

function write(key: StorageKey, value: unknown): void {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // 存储写失败（多为超限）不影响本次会话，忽略即可
  }
}

function remove(key: StorageKey): void {
  try {
    wx.removeStorageSync(key);
  } catch {
    // 同上
  }
}

export const storage = {
  getToken(): string {
    return read<string>(KEYS.token) ?? '';
  },
  setToken(token: string): void {
    write(KEYS.token, token);
  },

  getUser<T>(): T | null {
    return read<T>(KEYS.user);
  },
  setUser(user: unknown): void {
    write(KEYS.user, user);
  },

  getFamilies<T>(): T[] {
    return read<T[]>(KEYS.families) ?? [];
  },
  setFamilies(families: unknown): void {
    write(KEYS.families, families);
  },

  getCurrentFamilyId(): number | null {
    const v = read<number>(KEYS.currentFamilyId);
    return typeof v === 'number' && v > 0 ? v : null;
  },
  setCurrentFamilyId(familyId: number | null): void {
    if (familyId === null) remove(KEYS.currentFamilyId);
    else write(KEYS.currentFamilyId, familyId);
  },

  /** 退出登录时清空全部登录态（保留其他缓存） */
  clearAuth(): void {
    remove(KEYS.token);
    remove(KEYS.user);
    remove(KEYS.families);
    remove(KEYS.currentFamilyId);
  },
};
