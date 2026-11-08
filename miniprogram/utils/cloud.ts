/**
 * WorkBuddy 云服务客户端
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 与自建后端的关系（读代码前先看清这一条，别改错方向）
 * ---------------------------------------------------------------------------
 *
 * 本项目的业务链路（叮一下 / 派个活 / 吃啥呢 / 留个念）走**自建 NestJS 后端**，
 * 统一入口是 `services/request.ts` + `config.ts` 的 `BASE_URL`。
 * 本文件是**另一条独立通道**：WorkBuddy 云服务（数据库 / 登录 / 存储 / 大模型）。
 *
 * 两条通道**互不替代**：
 *   - `services/request.ts` → 自建后端，承载家庭业务的全部读写
 *   - `utils/cloud.ts`      → 托管云服务，给「不想自己维护的服务」用
 *
 * 页面里**禁止**绕过 `request.ts` 直接调 `wx.request`（docs/04 §5.2），
 * 也**禁止**绕过本文件直接用 `wx.request` 打 `/.cloud/**` ——
 * 后者会丢掉 `publishableKey` 注入与会话管理，请求必然被网关拒。
 *
 * ---------------------------------------------------------------------------
 * 关于配置
 * ---------------------------------------------------------------------------
 *
 * `endpoint` / `publishableKey` 来自开通云服务时下发的 `publicConfig`，
 * **只能照抄，不要改**：
 *   - `endpoint` 小程序端是**固定网关**（`mp-api.app.workbuddy.host`），
 *     不是本应用自己的域名。微信的请求域名白名单不收通配符，托管方
 *     把这个固定 host 注册进白名单，发布流程会自动做，改了就连不上。
 *   - `publishableKey` 只标识「哪个应用」，本身不带权限（服务端按
 *     应用 + 来源校验），所以可以放在客户端代码里，但不要打进日志。
 *
 * 真机上看到 `url not in domain list` 是**白名单**没生效，
 * 不是这两个值写错了 —— 别去改它们。
 */

import { createMiniProgramWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk/miniprogram';
import { createDiagnosticWx } from './workbuddy-cloud-diagnostics';

/** 数据面基址（`publicConfig.endpoint`）。小程序端为固定网关，见文件头说明。 */
const CLOUD_ENDPOINT = 'https://mp-api.app.workbuddy.host';

/** 应用标识（`publicConfig.publishableKey`）。 */
const CLOUD_PUBLISHABLE_KEY = 'wbpk_29t2N2qOE3jkfzbdShpAD6_Bqvyk2LZ7UbaxohbwKWt4ccfI8DqMwjr';

type CloudClient = ReturnType<typeof createMiniProgramWorkBuddyCloud>;

let client: CloudClient | null = null;

/**
 * 初始化云服务客户端。
 *
 * **幂等**：重复调用只装配一次，不会重复创建。
 *
 * **不抛异常**：初始化失败返回 `false`，由调用方决定是否降级。
 * 理由与推送通道一致（docs/08）——云服务是增强能力，
 * 它挂了不能把首页也拖挂。
 */
export function initCloud(): boolean {
  if (client) return true;

  try {
    client = createMiniProgramWorkBuddyCloud({
      endpoint: CLOUD_ENDPOINT,
      publishableKey: CLOUD_PUBLISHABLE_KEY,
      // 包一层诊断 wx：云请求失败时在 vConsole 里打出方法 / URL / 状态码 / 错误码，
      // 成功与主动 abort 保持静默。排查真机问题时这是唯一可靠的线索来源。
      wx: createDiagnosticWx(wx),
    });
    return true;
  } catch {
    client = null;
    return false;
  }
}

/**
 * 取云服务客户端。
 *
 * @throws 未初始化（或初始化失败）时抛错 —— 调用方必须处理，
 *         不要吞掉：静默失败会让「数据没存上」变成一个没有线索的谜。
 */
export function getCloud(): CloudClient {
  if (!client) {
    throw new Error('云服务未初始化，请先调用 initCloud()');
  }
  return client;
}

/** 云服务当前是否可用。页面可用它决定是否展示云相关入口。 */
export function isCloudReady(): boolean {
  return client !== null;
}
