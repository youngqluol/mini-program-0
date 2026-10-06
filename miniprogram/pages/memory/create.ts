/**
 * P18 · 发布记录
 *
 * 页面只做一件事：**把一段话和几张图变成一条记录**。
 *
 * 五条刻意的判断：
 *
 * 1. **选图就上传，不等「发布」。** 用户选完图到按下发布之间可能过很久，
 *    那时才上传会让「发布」按钮转很久；而且失败要等到最后才知道。
 *    代价是「选了又删」会浪费一次上传 —— 家庭场景下这点浪费换体验值得。
 *
 * 2. **`sizeType: ['compressed']`。** 这不是省流量，是**为了过内容安全检测**：
 *    微信的图片检测接口（`img_sec_check`）有 **1MB 上限**，原图动辄 3–5MB
 *    根本检不了，只能 fail-open 放行。压缩后通常 100–500KB，落在限制内。
 *
 * 3. **上传失败的图留在九宫格里，点一下重试**，不是悄悄消失。
 *    悄悄消失会让用户以为「选上了」，发布后才发现少一张。
 *
 * 4. **有图在上传中时禁止发布。** 否则会发出一条少图或者空图的记录，
 *    而用户以为都传上去了。
 *
 * 5. **「完成纪念」的关联靠 URL 参数带过来**（`thingId` + `thingTitle`），
 *    不为它多发一次请求 —— P10 详情页手里本来就有这两个值。
 *    文案预填由 `prefillContent()` 给，**可改**：它只是省一次打字。
 */

import { MEMORY_LIMITS } from '../../constants/memory';
import type { MemoryAttachmentInput, MemoryVisibilityValue } from '@shared/dto/memory';
import * as memoryApi from '../../services/memory';
import * as userStore from '../../stores/user';
import type { VisibilityOption } from '../../utils/memory-view';
import {
  buildVisibilityOptions,
  describeThingBanner,
  draftCanPublish,
  photoUploadHint,
  prefillContent,
  publishDoneToast,
} from '../../utils/memory-view';
import { guardEntry } from '../../utils/route';
import { toast, toastError } from '../../utils/toast';

/** 一张待发布/已发布的图 */
interface DraftPhoto {
  /** `wx:key` 用。临时路径在重试时会变，所以单独给一个稳定的 key */
  key: string;
  /** 本地临时路径 —— 预览用，也是重试上传时要的东西 */
  path: string;
  /** 0–100；上传中才有意义 */
  progress: number;
  /** 上传成功后的可访问 URL；空串表示还没传上去 */
  url: string;
  /** 传失败了 —— 缩略图上盖一层「重试」 */
  failed: boolean;
}

let photoSeq = 0;

Page({
  data: {
    familyId: 0,

    content: '',
    contentMax: MEMORY_LIMITS.CONTENT_MAX,
    maxPhotos: MEMORY_LIMITS.MAX_ATTACHMENTS,

    photos: [] as DraftPhoto[],

    visibilityOptions: buildVisibilityOptions() as VisibilityOption[],
    visibility: 'FAMILY' as MemoryVisibilityValue,

    // ---- 「完成纪念」的关联（PRD §19.2）----
    thingId: 0,
    thingBanner: '',

    /** 有图在上传中 —— 挡住发布 */
    uploading: false,
    failedHint: '',
    /** 正在发布 —— 挡住重复点击（docs/03 P18：发布中禁用按钮） */
    publishing: false,
    canPublish: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (!guardEntry()) return;

    const family = userStore.getCurrentFamily();
    if (!family) return;

    const thingId = Number(options.thingId) || 0;
    const thingTitle = options.thingTitle ? decodeURIComponent(options.thingTitle) : '';

    this.setData({
      familyId: family.familyId,
      thingId,
      thingBanner: describeThingBanner(thingTitle),
      // 预填只在带关联时发生 —— 独立留念给一个空框
      content: thingId ? prefillContent(thingTitle) : '',
    });
    this.refreshCanPublish();
  },

  /** 草稿能不能发（正文与图片至少给一样，且没有图卡在上传中） */
  refreshCanPublish() {
    const { content, photos } = this.data;
    this.setData({
      canPublish: draftCanPublish({ content, photoCount: photos.length }) && !this.data.uploading,
    });
  },

  // ---------------------------------------------------------------
  // 正文
  // ---------------------------------------------------------------

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value });
    this.refreshCanPublish();
  },

  // ---------------------------------------------------------------
  // 可见范围
  // ---------------------------------------------------------------

  onPickVisibility(e: WechatMiniprogram.TouchEvent) {
    const value = String(e.currentTarget.dataset.value) as MemoryVisibilityValue;
    this.setData({ visibility: value });
  },

  // ---------------------------------------------------------------
  // 选图 → 上传
  // ---------------------------------------------------------------

  onAddPhoto() {
    const remaining = MEMORY_LIMITS.MAX_ATTACHMENTS - this.data.photos.length;
    if (remaining <= 0) {
      toast(`最多 ${MEMORY_LIMITS.MAX_ATTACHMENTS} 张`);
      return;
    }

    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      // ⚠️ 必须压缩：微信的图片内容安全接口有 1MB 上限（见文件头 ②）
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const added: DraftPhoto[] = res.tempFiles.map((f) => ({
          key: `p${++photoSeq}`,
          path: f.tempFilePath,
          progress: 0,
          url: '',
          failed: false,
        }));
        this.setData({ photos: this.data.photos.concat(added) });
        this.refreshCanPublish();
        added.forEach((p) => void this.uploadOne(p.key));
      },
      // 用户取消选择不算错误
      fail: () => undefined,
    });
  },

  /** 传一张。失败留在列表里等重试（见文件头 ③） */
  async uploadOne(key: string) {
    const index = this.data.photos.findIndex((p) => p.key === key);
    if (index < 0) return;

    this.setData({
      [`photos[${index}].failed`]: false,
      [`photos[${index}].progress`]: 0,
      uploading: true,
    });
    this.refreshCanPublish();

    try {
      const res = await memoryApi.uploadImage(this.data.photos[index].path, 'MEMORY', (percent) => {
        // 进度回调可能在图片被删掉之后才到 —— 先确认它还在
        const i = this.data.photos.findIndex((p) => p.key === key);
        if (i < 0) return;
        this.setData({ [`photos[${i}].progress`]: percent });
      });

      const i = this.data.photos.findIndex((p) => p.key === key);
      if (i < 0) return; // 已经删了
      this.setData({ [`photos[${i}].url`]: res.fileUrl, [`photos[${i}].progress`]: 100 });
    } catch (e) {
      const i = this.data.photos.findIndex((p) => p.key === key);
      if (i >= 0) this.setData({ [`photos[${i}].failed`]: true });
      toastError(e);
    } finally {
      this.settleUploading();
    }
  },

  /** 收尾：更新「还有没有图在上传」与失败提示 */
  settleUploading() {
    const uploading = this.data.photos.some((p) => !p.url && !p.failed);
    const failedCount = this.data.photos.filter((p) => p.failed).length;
    this.setData({ uploading, failedHint: photoUploadHint(failedCount) });
    this.refreshCanPublish();
  },

  onRetryPhoto(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key);
    const photo = this.data.photos.filter((p) => p.key === key)[0];
    if (!photo || !photo.failed) return;
    void this.uploadOne(key);
  },

  onRemovePhoto(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key);
    this.setData({ photos: this.data.photos.filter((p) => p.key !== key) });
    this.settleUploading();
  },

  /** 预览本地图（还没发布，没有远端 URL） */
  onPreviewPhoto(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    const urls = this.data.photos.map((p) => p.path);
    if (urls.length === 0) return;
    wx.previewImage({ urls, current: urls[index] });
  },

  // ---------------------------------------------------------------
  // 发布
  // ---------------------------------------------------------------

  async onPublish() {
    if (this.data.publishing) return;

    const { content, photos, visibility, thingId, familyId } = this.data;

    if (!draftCanPublish({ content, photoCount: photos.length })) {
      toast('写点什么，或者加张图片吧');
      return;
    }
    if (this.data.uploading) {
      toast('图片还在传，稍等一下');
      return;
    }

    // 只把**传成功的**带上。失败的图留在界面上（不静默丢掉），
    // 但用户明确点了发布，就按他看到的成功部分发。
    const attachments: MemoryAttachmentInput[] = photos
      .filter((p) => !!p.url)
      .map((p) => ({ fileUrl: p.url }));

    this.setData({ publishing: true });
    try {
      await memoryApi.create({
        familyId,
        content: content.trim(),
        visibility,
        attachments,
        thingId: thingId || null,
      });
      toast(publishDoneToast(visibility));
      // 返回 P03。它是 Tab 页，`navigateBack` 回去后 `onShow` 会自己刷新
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      this.setData({ publishing: false });
      toastError(e);
    }
  },

  onCancel() {
    wx.navigateBack();
  },
});
