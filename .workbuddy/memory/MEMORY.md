# 项目长期记忆 · 家有小事

## 后端是双通道，别混

- **自建 NestJS + MySQL**（`server/`）：全部家庭业务读写走它，小程序端唯一入口
  `miniprogram/services/request.ts` → `config.ts` 的 `BASE_URL`。
- **WorkBuddy 托管云服务**（`miniprogram/utils/cloud.ts`）：`wbapp_29t2N2qOE3jkfzbdShpAD6`。
  数据库 / 登录 / 存储 / 大模型，给不想自己维护的服务用。
- 两条通道**并存，不是迁移**。页面里既不能直接 `wx.request`，
  也不能绕过 `utils/cloud.ts` 直接打 `/.cloud/**`。

## 云服务接入的三个坑

1. `endpoint` 小程序端是**固定网关** `mp-api.app.workbuddy.host`，不是应用自己的域名。
   微信请求域名白名单不收通配符，托管方注册的就是这个 host。真机报
   `url not in domain list` 是白名单问题，**不要去改这两个配置值**。
2. SDK 必须走 `@tencent-ai/workbuddy-cloud-sdk/miniprogram` 子路径的
   `createMiniProgramWorkBuddyCloud`，不要从根入口手搓 fetch/storage/polyfill 组合。
3. `miniprogram/tsconfig.json` 的 `moduleResolution` 是 `"Node"`，读不了 SDK 的
   `exports` 字段，靠 `paths` 映射到 `lib/miniprogram`。改 moduleResolution 会牵动全项目。

## 发布

- 小程序**不走** `workbuddy_sites_deploy`（目录会被预检拒）。
  产物卡片 → 预览 → 右上角「分享 / Share」→ 发布。
- 后续管理：「设置 → 数据管理 → 应用」。
- 上线前必须换掉 `miniprogram/config.ts` 的 `PROD_BASE_URL` 占位符，
  否则体验版 / 正式版连不上业务后端。
- **开通云服务 ≠ 业务接口通**。发布流程只上传代码包，后端仍是另一回事。
  用户容易把两者混为一谈，解释时要先说清这条。
- `config.ts` 的 `BASE_URL` 实际行为：develop（模拟器 / 真机预览）→ `localhost:3000`，
  模拟器可通、真机预览不通（要换局域网 IP）；trial / release → 占位符，必然失败。
