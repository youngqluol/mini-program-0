/**
 * 环境配置
 *
 * 开发者工具需要勾选「详情 → 本地设置 → 不校验合法域名」
 * （`project.config.json` 里已设 `urlCheck: false`，通常无需手动勾）。
 */

// -------------------------------------------------------------
// 后端地址：按小程序版本自动切换
// -------------------------------------------------------------
//
// 小程序有三种版本，`wx.getAccountInfoSync().miniProgram.envVersion` 能区分：
//
//   develop   开发者工具 + **真机预览**   → 连本机后端
//   trial     体验版（上传后在后台设为体验版）→ 连线上后端
//   release   正式版（审核通过后发布）      → 连线上后端
//
// ⚠️ **真机预览也算 `develop`** —— 此时手机上的 `localhost` 指向手机自己，
//    连不到你的电脑。真机调试要把 `DEV_BASE_URL` 换成电脑的局域网 IP
//    （例如 `http://192.168.1.8:3000`），并确保手机与电脑在同一个 Wi-Fi 下。
//
// 之所以按版本自动切，是为了防一类事故：本地调试时把地址改成了局域网 IP，
// 发版前忘了改回来。现在改 `DEV_BASE_URL` 只影响本地，碰不到线上。

/** 后端地址：本地开发（开发者工具 / 真机预览）。 */
const DEV_BASE_URL = 'http://localhost:3000';

/**
 * 云托管默认域名 —— **仅用于调试/兜底，不能加到小程序后台的服务器域名**。
 *
 * 微信明确：云托管默认域名只能用于接口测试，小程序后台无法把它配成
 * `request` / `uploadFile` 合法域名（会提示「云托管域名仅用作测试使用」）。
 *
 * 所以体验版 / 正式版的 JSON 请求**不走这个地址**，而是走
 * `wx.cloud.callContainer`（见下方 CLOUD_RUN_ENV_ID / CLOUD_RUN_SERVICE）。
 * 以后绑定自定义域名时，再把这里替换成自定义域名。
 */
const PROD_BASE_URL =
  'https://family-things-api-324934-12-1502093511.sh.run.tcloudbase.com';

/**
 * 云托管环境 ID。
 *
 * 位置：云托管控制台 → 环境管理 → 选择环境 → 环境 ID。
 * ⚠️ 不是默认域名里那串，形如 `prod-xxxxxxxx`。
 */
export const CLOUD_RUN_ENV_ID: string = 'prod-d6gpyyf3z8f39506c';

/**
 * 云托管服务名 —— `callContainer` 的 `X-WX-SERVICE` 请求头。
 * 与服务管理里创建的服务名称一致。
 */
export const CLOUD_RUN_SERVICE: string = 'family-things-api';

/**
 * 当前小程序版本。基础库 2.2.2+ 提供，**同步接口**，模块加载时即可用。
 *
 * 兜底退回 `develop`：与「按版本切换」改造之前的行为一致（那时恒为本地地址），
 * 所以取不到版本信息时不会比原来更差。
 */
function readEnvVersion(): 'develop' | 'trial' | 'release' {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return 'develop';
  }
}

/** 当前版本（模块加载时求值一次） */
export const ENV_VERSION = readEnvVersion();

/**
 * 是否走云托管专用调用通道。
 *
 * - develop：开发者工具 / 真机预览 → 本机后端（`wx.request`）
 * - trial / release：体验版 / 正式版 → 云托管环境（`wx.cloud.callContainer`）
 *
 * ⚠️ `callContainer` 要求基础库 **2.23.0+**，且小程序需被云托管环境授权。
 *    请求体上限 100KiB，**不能传图片/文件**（图片走对象存储直传）。
 */
export const USE_CLOUD_CONTAINER: boolean = ENV_VERSION !== 'develop';

/**
 * 后端地址。
 *
 * ⚠️ 显式标 `: string` 是必须的：不标的话 TS 会把它推断成两个字面量的联合类型，
 *    页面里做 `BASE_URL !== ''` 之类的判断会被判成「恒真/恒假」而报 TS2367。
 *    （`MP_ACCOUNT_QR` 下面有同样的处理。）
 *
 * trial/release 的 JSON 请求不使用它（走 callContainer）；它只服务于：
 *   - develop 的本地 `wx.request`
 *   - 将来图片上传改走自定义域名 / COS 直传时的兜底
 */
export const BASE_URL: string = ENV_VERSION === 'develop' ? DEV_BASE_URL : PROD_BASE_URL;

/** 全局接口前缀，与 docs/02 的 Base URL 一致（注意不是 /api/v1）。 */
export const API_PREFIX = '/api';

/** 请求超时（毫秒）。家庭场景网络普遍一般，给得比默认 60s 短一些，早点让用户重试。 */
export const REQUEST_TIMEOUT = 15000;

/**
 * 图片上传超时（毫秒）。
 *
 * 比普通请求长得多：5MB 的图在移动网络上要几十秒，而这里**不能**早点放弃 ——
 * 半路超时会让用户看到「失败」，但服务端可能已经写进桶里了。
 * 宁可等，也不要制造一个「到底传上去没有」的模糊状态。
 */
export const UPLOAD_TIMEOUT = 60000;

/**
 * 「微信提醒」页（P21）要展示的二维码图片路径。留空则不显示二维码。
 *
 * ⚠️⚠️ **这里要的是「公众号二维码」，不是「小程序码」。**
 *    这两个东西长得有点像，但扫出来的结果完全不同：
 *      · **公众号二维码** → 关注那个号 —— P21 要的就是它（关注后把数字发给它）；
 *      · **小程序码**     → 打开小程序 —— 对 P21 这条流程**没有任何帮助**，会走进死路。
 *    怎么分辨：小程序码右下角有一个**绿色的小程序角标**。
 *    ⚠️ 顺便记一笔：wxpush Worker 的环境变量 `MP_QRCODE_URL` 要的才是**小程序码**
 *    （用在「中转页」，让用户长按识别跳回小程序）—— **两者不可互换**。
 *
 * 从公众号后台（测试号后台）下载后，另存为 `miniprogram/assets/mp-account-qr.*`。
 * 当前入库的是**微信后台直接下发的 `.jpg`**（没有转码 —— 转成 PNG 只会把体积
 * 放大，并不会把 JPEG 已经丢掉的信息找回来）。
 *
 * ⚠️ **扩展名写在下面这个常量里**，所以换格式时（比如以后换成 `.png`）
 *    必须**连常量一起改**，否则小程序找不到文件、静默降级成一句文字说明。
 *
 * 图片加载失败时会自动降级成一句文字说明（见页面里的 `binderror`），
 * **不会显示一张破图** —— 少一个便利，好过给一张错的图。
 *
 * ⚠️ 显式标 `: string` 是必须的：不标的话 TS 会把它推断成字面量类型，
 *    页面里 `MP_ACCOUNT_QR !== ''` 这种判断会被判成「不可能成立」而报 TS2367。
 */
export const MP_ACCOUNT_QR: string = 'assets/mp-account-qr.jpg';
