/**
 * P21 · 微信提醒（M2-F1）
 *
 * 入口：「我的」Tab → 消息与提醒 → 微信提醒
 *
 * **这一页存在的唯一目的：让「叮一下」真的能叮到人。**
 * 但它是**可选的** —— 不开，产品依然完整可用（打开小程序就能看到今天的事）。
 *
 * 流程（docs/03 P21）：
 *   进页面 → GET /notify/mp-bind/status
 *     ├─ bound  → 「已经开启啦」
 *     └─ 还没开 → POST /notify/mp-bind/code → 展示二维码 + 六位数字
 *                 → 每 3 秒轮询一次 status（最多 20 次 = 1 分钟）
 *                    ├─ bound → 切「已经开启啦」
 *                    └─ 1 分钟没等到 → 「还没收到哦，重新获取一个数字试试」
 *
 * 四条刻意的判断：
 *
 * 1. **只在「还没开、手里又没有还没过期的数字」时才生成新数字。**
 *    `POST /notify/mp-bind/code` 会**换掉**正在展示的那串数字，
 *    而用户此刻可能正拿着它在微信里打字 —— 一进页面就换码会把他的操作作废。
 *    所以 `onShow` 只重新**查**状态，只在没有可用数字时才生成。
 *
 * 2. **轮询用「查一次、再排下一次」，不用 `setInterval`。** 查询本身是异步的，
 *    固定间隔会在网络慢的时候叠起好几个并发请求；而且那样停不掉正在飞的那一个。
 *
 * 3. **`onHide` / `onUnload` 必须停轮询。** 不停的话，用户切走后定时器还在跑，
 *    1 分钟后会 `setData` 到一个已经不可见的页面，期间还每 3 秒白打一次接口。
 *
 * 4. **不做「重新绑定」。** docs/03 的草图里有这一行，但它没有真实语义：
 *    绑定关系挂在**用户**身上，换一个微信号就是换一个人，不存在「重绑」。
 *    挂一个点不出结果的入口，比不挂更糟（和 M2-F3 同一个判断）。
 *
 * ⚠️ 二维码从 `config.ts` 的 `MP_ACCOUNT_QR` 读，图片加载失败会自动降级成
 *    一句文字说明（`binderror`）—— **不显示破图，也不显示一张错的图**。
 *    这一页要的是**公众号二维码**，不是小程序码（见 config.ts 里那段说明）。
 */

import { MP_ACCOUNT_QR } from '../../config';
import type { MpBindStatus } from '@shared/dto/notify';
import * as notifyApi from '../../services/notify';
import type { WechatNotifyView } from '../../utils/mine-view';
import { buildWechatNotifyView } from '../../utils/mine-view';
import { guardEntry } from '../../utils/route';
import { confirm, toast, toastError, toastOk } from '../../utils/toast';

/** 轮询间隔与上限：3 秒 × 20 = 1 分钟。再久用户已经去做别的事了 */
const POLL_INTERVAL = 3000;
const POLL_MAX = 20;

Page({
  data: {
    loading: true,
    view: null as WechatNotifyView | null,

    qr: MP_ACCOUNT_QR,
    /** 二维码能不能显示 —— 图片加载失败时置 false，页面退回一句文字说明 */
    hasQr: MP_ACCOUNT_QR !== '',

    /** 1 分钟没等到结果 —— 显示「重新获取」 */
    timedOut: false,
    /** 有请求在路上：挡住重复点 */
    acting: false,
  },

  /** 轮询定时器句柄 / 已轮询次数。不参与渲染，所以不放进 `data` */
  pollTimer: 0,
  pollCount: 0,

  onLoad() {
    if (!guardEntry()) return;
    void this.load();
  },

  onShow() {
    // 首次进入时 onLoad 的请求还在路上（loading 仍是 true）→ 不重复打
    if (this.data.loading) return;
    if (!guardEntry()) return;
    // 从微信切回来：立刻重查一次。轮询在小程序切到后台时已经停了
    void this.load();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  // ---------------------------------------------------------------
  // 取数与轮询
  // ---------------------------------------------------------------

  async load() {
    let status: MpBindStatus;
    try {
      status = await notifyApi.getMpBindStatus();
      // 手里没有还没过期的数字时才生成 —— 生成会换掉正在展示的那一串
      // （后端有 30 秒冷却：冷却期内重复调用会返回同一个码）
      if (!status.bound && !status.pending) {
        status = await notifyApi.createMpBindCode();
      }
    } catch (e) {
      this.setData({ loading: false });
      toastError(e);
      return;
    }

    this.apply(status);
  },

  apply(status: MpBindStatus) {
    this.setData({
      loading: false,
      timedOut: false,
      view: buildWechatNotifyView(status),
    });

    if (status.bound) this.stopPolling();
    else this.startPolling();
  },

  /** 每 3 秒查一次，最多 20 次 */
  startPolling() {
    this.stopPolling();
    this.pollCount = 0;
    this.scheduleNextPoll();
  },

  scheduleNextPoll() {
    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, POLL_INTERVAL);
  },

  async poll() {
    this.pollTimer = 0;
    this.pollCount += 1;

    try {
      const status = await notifyApi.getMpBindStatus();
      if (status.bound) {
        this.apply(status);
        toastOk('已经开好啦');
        return;
      }
    } catch {
      // 轮询失败不打扰用户 —— 这是后台行为，下一轮会再试
    }

    if (this.pollCount >= POLL_MAX) {
      this.setData({ timedOut: true });
      return;
    }
    this.scheduleNextPoll();
  },

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    }
  },

  // ---------------------------------------------------------------
  // 交互
  // ---------------------------------------------------------------

  /** 「重新获取」：用户明确要求换一个，所以**直接生成**、不复用旧码 */
  async onRefresh() {
    if (this.data.acting) return;
    this.setData({ acting: true, timedOut: false });

    try {
      // 走到这里说明已经等了 1 分钟 —— 后端 30 秒的冷却早就过了，一定会换一个新码
      this.apply(await notifyApi.createMpBindCode());
    } catch (e) {
      toastError(e);
    } finally {
      this.setData({ acting: false });
    }
  },

  /** 关闭提醒。文案不许说得像惩罚：关掉只是「换一种收消息的方式」 */
  async onTurnOff() {
    if (this.data.acting) return;

    const ok = await confirm({
      title: '关掉微信提醒？',
      content: '关掉之后，家里有事就只在小程序里提醒你了。随时可以再开。',
      confirmText: '关掉',
    });
    if (!ok) return;

    this.setData({ acting: true });
    try {
      await notifyApi.unbindMp();
    } catch (e) {
      this.setData({ acting: false });
      toastError(e);
      return;
    }

    this.setData({ acting: false });
    toast('关掉了，随时可以再开');
    // 关掉之后立刻把「还没开」的样子摆出来（含一串新数字），
    // 而不是留一个空页面让用户自己找入口
    await this.load();
  },

  /** 二维码加载失败（文件还没放进去 / 路径写错）→ 降级成文字说明，不显示破图 */
  onQrError() {
    this.setData({ hasQr: false });
  },
});
