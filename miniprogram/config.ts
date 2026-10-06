/**
 * 环境配置
 *
 * ⚠️ **真机调试注意**：`localhost` 只在开发者工具的模拟器里可用 ——
 *    真机上的 `localhost` 指向手机自己，连不到你的电脑。
 *    真机调试时把 `BASE_URL` 换成电脑的局域网 IP（例如 `http://192.168.1.8:3000`），
 *    并确保手机与电脑在同一个 Wi-Fi 下。
 *
 * 开发者工具需要勾选「详情 → 本地设置 → 不校验合法域名」
 * （`project.config.json` 里已设 `urlCheck: false`，通常无需手动勾）。
 */

/** 后端地址。本地开发指向 NestJS 的 3000 端口。 */
export const BASE_URL = 'http://localhost:3000';

/** 全局接口前缀，与 docs/02 的 Base URL 一致（注意不是 /api/v1）。 */
export const API_PREFIX = '/api';

/** 请求超时（毫秒）。家庭场景网络普遍一般，给得比默认 60s 短一些，早点让用户重试。 */
export const REQUEST_TIMEOUT = 15000;
