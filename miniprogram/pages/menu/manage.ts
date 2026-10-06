/**
 * P17 · 菜谱管理
 *
 * 两组：**系统菜谱（只读）** / **我家菜谱（可改可停）**。
 *
 * 四条刻意的判断：
 *
 * 1. **系统菜谱没有任何操作。** 它们不在库里（`id` 恒为 `null`），改不了也停不了。
 *    所以那两行不给开关、也不给左滑 —— `swipe-cell` 见到空 `actions` 会完全不响应
 *    手势。给一个滑不动的抽屉比滑不动更让人困惑。
 *
 * 2. **停用 ≠ 删除。** 停用的菜谱**仍然留在列表里**（否则用户再也找不到它去重新启用），
 *    只是不进随机池。所以左滑那个动作用「停用 / 启用」，不用「删除」——
 *    叫删除会让用户以为这道菜的历史（`meal_records`）也没了。
 *
 * 3. **「+ 添加」与「编辑」共用一个表单面板**（名字 + 分类），不拆成两个。
 *    两者字段完全一样，拆开只会让校验文案有两份。改名走 `promptText` 也行，
 *    但那样分类就改不了了 —— 一个入口做完更省事。
 *
 * 4. **开关是乐观更新。** 点下去先就地翻过去（原生开关本来就会动），
 *    失败再拉一次列表纠正回来。不然网络慢的时候，用户会看到开关弹回去又弹回来。
 *
 * 分页：系统菜谱有 72 条，默认 `pageSize=50` 要翻两页。这里直接要 200 条
 * （接口上限），一般一次就取完了；`hasMore` 时靠上拉加载。
 */

import * as menuApi from '../../services/menu';
import * as userStore from '../../stores/user';
import { MENU_CATEGORY_OPTIONS } from '../../constants/menu';
import type { MenuItemRowView } from '../../utils/menu-view';
import { splitMenuGroups } from '../../utils/menu-view';
import { guardEntry } from '../../utils/route';
import { toast, toastError, toastOk } from '../../utils/toast';

/** 一页拉多少条。系统菜谱 72 条，取上限一次拿完，省一次往返 */
const PAGE_SIZE = 200;

/** 分类下拉：第 0 项是「不分类」（对应接口的 `category: null`） */
const CATEGORY_PICKER = ['不分类'].concat(MENU_CATEGORY_OPTIONS);

/** 「不分类」在 picker 里的下标 —— 与 `CATEGORY_PICKER` 的位置绑定 */
const NO_CATEGORY_INDEX = 0;

Page({
  data: {
    familyId: 0,

    system: [] as MenuItemRowView[],
    family: [] as MenuItemRowView[],

    loading: true,
    loaded: false,
    hasMore: false,
    page: 0,

    /** 当前被滑开的那一行；0 表示都关着。受控给 swipe-cell */
    openId: 0,
    /** 有请求在路上：挡住重复点击 */
    acting: false,

    // ---- 添加 / 编辑表单面板 ----
    formOpen: false,
    /** `create` = 加新菜；`edit` = 改已有的 */
    formMode: 'create' as 'create' | 'edit',
    /** 编辑时的菜谱 id；新增时为 0 */
    formId: 0,
    formTitle: '添加菜谱',
    formName: '',
    categoryPicker: CATEGORY_PICKER,
    categoryIndex: NO_CATEGORY_INDEX,
    categoryLabel: CATEGORY_PICKER[NO_CATEGORY_INDEX],
    submitting: false,
  },

  onLoad() {
    if (!guardEntry()) return;
    const family = userStore.getCurrentFamily();
    if (!family) return;
    this.setData({ familyId: family.familyId });
  },

  /** 每次显示都重拉第一页 —— 从表单面板返回后列表必须反映刚才那次改动 */
  onShow() {
    if (!this.data.familyId) return;
    void this.reload();
  },

  onReachBottom() {
    void this.loadMore();
  },

  // ---------------------------------------------------------------
  // 取数
  // ---------------------------------------------------------------

  async reload() {
    this.setData({ loading: true, openId: 0 });
    try {
      const res = await menuApi.items({
        familyId: this.data.familyId,
        page: 1,
        pageSize: PAGE_SIZE,
      });
      const groups = splitMenuGroups(res.list);
      this.setData({
        system: groups.system,
        family: groups.family,
        page: 1,
        hasMore: res.hasMore,
        loading: false,
        loaded: true,
      });
    } catch (e) {
      this.setData({ loading: false, loaded: true });
      toastError(e);
    }
  },

  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;

    const next = this.data.page + 1;
    this.setData({ loading: true });
    try {
      const res = await menuApi.items({
        familyId: this.data.familyId,
        page: next,
        pageSize: PAGE_SIZE,
      });
      // 中间可能已经被一次 reload 接上了（那就不该再往后拼）
      if (this.data.page !== next - 1) return;

      const groups = splitMenuGroups(res.list);
      this.setData({
        system: this.data.system.concat(groups.system),
        family: this.data.family.concat(groups.family),
        page: next,
        hasMore: res.hasMore,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 行交互
  // ---------------------------------------------------------------

  onRowOpen(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    this.setData({ openId: e.detail.id });
  },

  onRowClose(e: WechatMiniprogram.CustomEvent<{ id: number }>) {
    if (this.data.openId === e.detail.id) this.setData({ openId: 0 });
  },

  async onRowAction(e: WechatMiniprogram.CustomEvent<{ key: string; id: number }>) {
    if (this.data.acting) return;

    const { key, id } = e.detail;
    this.setData({ openId: 0 });

    if (key === 'EDIT') {
      this.openEdit(id);
      return;
    }
    if (key === 'TOGGLE') {
      const row = this.findRow(id);
      if (row) await this.applyEnabled(row, !row.enabled);
    }
  },

  findRow(id: number): MenuItemRowView | null {
    return this.data.family.filter((r) => r.id === id)[0] ?? null;
  },

  /** 右侧开关。`e.detail.value` 是开关**想变成**的状态 */
  async onToggleSwitch(e: WechatMiniprogram.SwitchChange) {
    if (this.data.acting) return;

    const id = Number(e.currentTarget.dataset.id) || 0;
    const row = this.findRow(id);
    if (row) await this.applyEnabled(row, e.detail.value === true);
  },

  /**
   * 启停一道菜。
   *
   * 乐观更新：先就地翻过去（原生开关本来就会动，不翻反而会「跳回来」），
   * 失败再拉一次列表把状态纠正回来。
   */
  async applyEnabled(row: MenuItemRowView, enabled: boolean) {
    this.setData({ acting: true });
    this.patchRow(row.id, enabled);

    try {
      await menuApi.setItemEnabled(row.id, enabled);
      toast(enabled ? '又加回来啦' : '先收起来啦，随时能再启用');
    } catch (e) {
      toastError(e);
      // 状态以服务端为准 —— 拉一次比在这里猜「到底改没改」可靠
      await this.reload();
    } finally {
      this.setData({ acting: false });
    }
  },

  /** 就地改一行的 `enabled`（列表里那两行依赖它渲染开关与置灰） */
  patchRow(id: number, enabled: boolean) {
    const index = this.data.family.findIndex((r) => r.id === id);
    if (index < 0) return;
    this.setData({
      [`family[${index}].enabled`]: enabled,
      [`family[${index}].dim`]: !enabled,
    });
  },

  // ---------------------------------------------------------------
  // 添加 / 编辑
  // ---------------------------------------------------------------

  onAdd() {
    this.setData({
      formOpen: true,
      formMode: 'create',
      formId: 0,
      formTitle: '添加菜谱',
      formName: '',
      categoryIndex: NO_CATEGORY_INDEX,
      categoryLabel: CATEGORY_PICKER[NO_CATEGORY_INDEX],
    });
  },

  openEdit(id: number) {
    const row = this.findRow(id);
    if (!row) return;

    // 分类可能在 `CATEGORY_PICKER` 里找不到（比如后端加了新分类还没同步镜像）——
    // 那就退回「不分类」，而不是把用户带到一个选中项错位的下拉上
    const found = CATEGORY_PICKER.indexOf(row.category);
    const categoryIndex = found >= 0 ? found : NO_CATEGORY_INDEX;

    this.setData({
      formOpen: true,
      formMode: 'edit',
      formId: row.id,
      formTitle: '编辑菜谱',
      formName: row.name,
      categoryIndex,
      categoryLabel: CATEGORY_PICKER[categoryIndex],
    });
  },

  onFormClose() {
    if (this.data.submitting) return;
    this.setData({ formOpen: false });
  },

  onFormName(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ formName: e.detail.value });
  },

  onFormCategory(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({
      categoryIndex: index,
      categoryLabel: CATEGORY_PICKER[index],
    });
  },

  /** 表单里选中的分类 —— 第 0 项「不分类」对应 `null` */
  pickedCategory(): string | null {
    return this.data.categoryIndex === NO_CATEGORY_INDEX
      ? null
      : CATEGORY_PICKER[this.data.categoryIndex];
  },

  async onFormSubmit() {
    if (this.data.submitting) return;

    const name = this.data.formName.trim();
    if (!name) {
      toast('菜名写点什么呢');
      return;
    }

    const category = this.pickedCategory();
    this.setData({ submitting: true });

    try {
      if (this.data.formMode === 'create') {
        await menuApi.createItem({ familyId: this.data.familyId, name, category });
        toastOk('加好啦');
      } else {
        await menuApi.updateItem(this.data.formId, { name, category });
        toastOk('改好啦');
      }
      this.setData({ formOpen: false });
      await this.reload();
    } catch (e) {
      // 重名（40900）的 message 后端已经写成人话了（「这道菜已经在菜谱里啦」），原样透出
      toastError(e);
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ---------------------------------------------------------------
  // 说明
  // ---------------------------------------------------------------

  /**
   * 系统菜谱那一组的说明。
   *
   * 用 `confirmSheet` 不合适（它是一次性确认），这里只是一句话，
   * 所以直接 toast —— 但**不写成「系统内置菜谱由平台维护」**这种机制话，
   * 只说「这些是自带的，改不了」。
   */
  onSystemHint() {
    toast('这些是自带的菜，改不了～');
  },
});
