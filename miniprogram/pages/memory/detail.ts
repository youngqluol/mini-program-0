/**
 * P19 · 记录详情
 *
 * 时间线上点一条进来。它是**相册的一页**，不是任务详情 —— 所以：
 *
 * 1. **没有「已读 / 未读」，没有确认按钮，没有点赞。** 用户来这里是看，
 *    不是处理。整页唯一可做的两件事是「改一改」和「删掉」，都只对发布者出现。
 *
 * 2. **图片在编辑态里改不了**，所以编辑面板要**明说这件事**，
 *    而不是让用户改完才发现图还在、或者以为能删图却删不掉。
 *    原因：`memory_attachments` 没有状态位，而全库不做物理 DELETE
 *    （见 `@shared/dto/memory` 的 `UpdateMemoryRequest`）。
 *
 * 3. **`来自 🎯 买牛奶` 只在这一页出现**（PRD §19.3）。时间线上不做视觉区分 ——
 *    一旦区分，时间线就滑向「任务日志」，违背 PRD §18.1 的定位。
 *
 * 4. **删除后 `navigateBack` 回时间线**，让 P03 的 `onShow` 去刷新。
 *    在这里就地改列表会让「返回后还看得到刚删的那条」变成可能。
 */

import { MEMORY_LIMITS } from '../../constants/memory';
import type { MemoryItem, MemoryVisibilityValue } from '@shared/dto/memory';
import * as memoryApi from '../../services/memory';
import type { VisibilityOption } from '../../utils/memory-view';
import {
  buildVisibilityOptions,
  describeMemoryDate,
  describeMemoryTime,
  describeThingRef,
  describeVisibility,
  editDoneToast,
  initialOf,
} from '../../utils/memory-view';
import { guardEntry } from '../../utils/route';
import { toastError, toastOk } from '../../utils/toast';

Page({
  data: {
    id: 0,

    loading: true,
    item: null as MemoryItem | null,

    // ---- 展示用的派生字段 ----
    dateText: '',
    timeText: '',
    creatorName: '',
    avatarUrl: '',
    avatarText: '',
    photos: [] as string[],
    thingText: '',
    visibilityText: '',
    isMine: false,

    // ---- 编辑态 ----
    editing: false,
    draftContent: '',
    draftVisibility: 'FAMILY' as MemoryVisibilityValue,
    visibilityOptions: buildVisibilityOptions() as VisibilityOption[],
    contentMax: MEMORY_LIMITS.CONTENT_MAX,
    saving: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (!guardEntry()) return;

    const id = Number(options.id) || 0;
    if (!id) {
      toastError(new Error('这条记录找不到了'));
      wx.navigateBack();
      return;
    }

    this.setData({ id });
    void this.load(Boolean(options.edit));
  },

  async load(openEditor = false) {
    try {
      const item = await memoryApi.detail(this.data.id);
      const creator = item.creator || { memberId: 0, roleName: '家人', avatarUrl: null };

      this.setData({
        loading: false,
        item,
        dateText: describeMemoryDate(item.date),
        timeText: describeMemoryTime(item.createdAt),
        creatorName: creator.roleName,
        avatarUrl: creator.avatarUrl || '',
        avatarText: initialOf(creator.roleName),
        photos: (item.attachments || []).map((a) => a.fileUrl),
        thingText: describeThingRef(item.thing),
        visibilityText: describeVisibility(item.visibility),
        isMine: item.isMine === true,
        ...(openEditor && item.isMine === true
          ? { editing: true, draftContent: item.content, draftVisibility: item.visibility }
          : {}),
      });
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 看图
  // ---------------------------------------------------------------

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    if (this.data.photos.length === 0) return;
    wx.previewImage({ urls: this.data.photos, current: this.data.photos[index] });
  },

  // ---------------------------------------------------------------
  // 编辑
  // ---------------------------------------------------------------

  onEdit() {
    const item = this.data.item;
    if (!item) return;
    this.setData({ editing: true, draftContent: item.content, draftVisibility: item.visibility });
  },

  onCancelEdit() {
    this.setData({ editing: false });
  },

  onDraftInput(e: WechatMiniprogram.Input) {
    this.setData({ draftContent: e.detail.value });
  },

  onPickDraftVisibility(e: WechatMiniprogram.TouchEvent) {
    this.setData({
      draftVisibility: String(e.currentTarget.dataset.value) as MemoryVisibilityValue,
    });
  },

  async onSave() {
    if (this.data.saving) return;

    const content = this.data.draftContent.trim();
    const hasPhotos = this.data.photos.length > 0;
    if (!content && !hasPhotos) {
      // 与后端同一条规则（服务端也判，这里只是省一次往返）
      toastError(new Error('写点什么，或者加张图片吧'));
      return;
    }

    this.setData({ saving: true });
    try {
      const item = await memoryApi.update(this.data.id, {
        content,
        visibility: this.data.draftVisibility,
      });
      this.setData({
        editing: false,
        saving: false,
        item,
        visibilityText: describeVisibility(item.visibility),
      });
      toastOk(editDoneToast());
    } catch (e) {
      this.setData({ saving: false });
      toastError(e);
    }
  },

  // ---------------------------------------------------------------
  // 删除
  // ---------------------------------------------------------------

  async onRemove() {
    const yes = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删掉这条？',
        content: '删了就翻不到了，家里其他人也看不到了。',
        confirmText: '删掉',
        cancelText: '再想想',
        confirmColor: '#F2637B',
        success: (r) => resolve(Boolean(r.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!yes) return;

    try {
      await memoryApi.remove(this.data.id);
      toastOk('删掉啦');
      // 让 P03 的 onShow 去刷新，不在这里就地改列表（见文件头 ④）
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      toastError(e);
    }
  },
});
