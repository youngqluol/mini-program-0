# 08 · wxpush 推送集成方案

**版本：** v1.1.0
**适用阶段：** V0.1 验证期（自己家人使用）
**对应 PRD：** 6.5.7「增强通道：公众号模板消息」
**代码位置：** `server/src/modules/notify/`（通道①：`mp-account.client.ts` + `landing.controller.ts`）
**怎么读：** 现行实现看 §三 架构图、§九 后端对接、§9.4 环境变量、§十 模板与字段；
排查问题看 §十二 故障表与 §十五 风险表。文件名里的 wxpush 是**历史标签**，不代表链路上还有 Worker。

> ⚠️ 本文档凡标 🕰「历史」的章节，描述的是**已删除的 Worker 方案**，留着是为了说明「为什么不用它」。

---

## 变更记录

### v1.1.0 · 2026-11-12 · 通道① 改为后端直连微信 API，Cloudflare Worker 已拆除

- **触发**：§十五 第 8 行那条「`*.workers.dev` 在大陆被 DNS 污染」的风险**已落地成真** ——
  家人绑定完成后（`mp_openid` 有值了），云托管运行日志里通道① 全是
  `errcode=undefined errmsg=fetch failed`，**微信的 errcode 一个都没有**，
  说明请求根本没出容器，第二道墙证实。
- **处置**：既然 Worker 无论如何都要找一个大陆可达的入口，**索性砍掉这一跳** ——
  后端自己拿 `access_token` 调 `cgi-bin/message/template/send`，中转页 `/skin` 也搬回后端渲染。
- **影响面**：**业务层（`notify.service.ts`）一行没改**，换掉的只有 `wxpush.client.ts` 那一个调用方。
- 仓库侧：Worker 源码与部署配置已删除，`wxpush/` 只剩一张小程序码（清理清单见 §十四）。

### v1.0.7 · 2026-11-11 · 实测确认 `*.workers.dev` 在大陆被 DNS 污染

- 记入 §十五 第 8 行 + Step 4 + §十二 故障表。
- **证据**：本机 `dig` 把 `pusher.youngqluol.workers.dev` 解析到 `108.160.165.141`
  （Dropbox 地址，每次查询换一个），无代理 `curl` 超时；同机 `api.weixin.qq.com`（404 = 通）/
  `www.cloudflare.com`（200）正常 —— **被封的是那个共享后缀，不是 Cloudflare**。
- 当时判定通道① 有**两道墙**：① `users.mp_openid` 全员为空（卡在 `status=5`，压根没发）→ `docs/06` §3.1；
  ② 绑定之后容器那次 `fetch` 出不到 Worker（症状是 `fetch failed` 且没有微信 errcode）。
  **② 已于当晚证实，处置见上面的 v1.1.0。**

### v1.0.6 · 2026-11-11 · §5.3 那条手工绑定的 curl 会 400

- `userId` 必须是**字符串**（`ManualBindDto` 上是 `@IsString()`，为了躲开 JS 大整数精度），
  原示例写的是数字 `3`，已在示例下方标注。

### v1.0.5 · 2026-11-11 · 勘误 · 两处接口路径的前缀是错的

- 全局前缀是 `/api`（`main.ts` 的 `setGlobalPrefix('api')`），**不是 `/api/v1`**：
  §4 绑定链路图里的 `POST /api/wechat/mp-callback`、§9 Step 8 测试号后台要填的 URL 已改正，
  §5.3 手工绑定的 curl 顺带修了段序（真实路径是 `/api/notify/internal/bind-mp-openid`）。
- ⚠️ **这不是文字问题**：照旧文档填，微信侧永远 404 → `mp_openid` 永远为空 →
  通道① 一条都发不出去，而站内消息照收 —— 现象正好是「小程序里能收到，微信里收不到」。

### v1.0.4 – v1.0.1 · 早期四次收口

| 版本 | 主题 | 要点 |
| --- | --- | --- |
| **v1.0.4** | 去掉 Redis | 绑定码改存 `users.mp_bind_code` 两列；订阅额度改存 MySQL `subscribe_quotas`。绑定链路、回调和额度记账的存储说明已同步 |
| **v1.0.3** | 小程序码素材入库 | §8 Step 6 补「本项目的小程序码已生成并入库」，源图 `wxpush/assets/miniprogram-code.png`，只剩「上传 COS → 填 URL」两步；加一条**别拿错图**的警告（`miniprogram/assets/mp-account-qr.jpg` 是**公众号二维码**，填进 `MP_QRCODE_URL` 会让兜底路失效） |
| **v1.0.2** | 通道二的模板补齐 | 新增 §10.7「小程序订阅消息模板」：三个模板的真实字段名、两条硬约束（`thing` ≤ 20 字 / `time` 格式）、额度池记账表、实探脚本；§9.1 文件清单补齐通道二全部文件；§9.4 补 `WX_TEMPLATE_*` 并加「两组模板 ID 不能互换」的警告；§10.6 自检入口改为已实现 |
| **v1.0.1** | 时间口径勘误 | §10.4 原文「全链路 `TZ=Asia/Shanghai`，不转 UTC」→ 改为「存储 UTC + 本地 getter 即北京时间」 |

---

## 一、这份文档要解决什么

v0.2 的 PRD 里有一个结论是**错的**：把「微信测试号推送」列为「明确不做」。

错的理由是当时认为「消息跳不回小程序」。但实际核查后发现：

1. 模板消息 payload **支持 `miniprogram` 字段**，配置后点击直接跳小程序
2. 即使该字段不生效，还有**中转页 + 小程序码长按识别**这条一定能走通的兜底路

而它带来的收益，恰好补上了本项目**最大的短板**：

| | 小程序订阅消息 | wxpush 公众号模板消息 |
| --- | --- | --- |
| 推送次数 | 1 次授权 = 1 条 | **无限次** |
| 能否推给「别人」 | ❌ 不能 | ✅ **能** |
| 到达形态 | 服务通知 | 服务通知（同样有弹窗 + 声音） |

> **一句话：** wxpush 把「阿妈能不能叮到阿爸」这件事，从**做不到**变成了**做得到**。

**本文档的目标：** 让这套通道从「知道有这个方案」变成「装得上、跑得通、拆得掉」。

---

## 二、通道定位

V0.1 一共有四条送达路径，通道① 是**主力**（v1.1.0 起由**后端直连微信 API**，不再经 Worker）：

```text
┌─────────────────────────────────────────────────────────────┐
│  ① 公众号模板消息             ← 主力，无限次，能推给别人     │
│     └ 条件：接收人已绑定（关注过推送号）                      │
├─────────────────────────────────────────────────────────────┤
│  ② 小程序订阅消息               ← 辅助，有额度就用           │
│     └ 条件：接收人有剩余订阅额度（假设 A4）                   │
├─────────────────────────────────────────────────────────────┤
│  ③ 站内消息中心                 ← 兜底，永不失败             │
│     └ 条件：无。所有通知无条件写入                           │
├─────────────────────────────────────────────────────────────┤
│  ④ 首页「今天家里有什么事」      ← 最终底线                  │
│     └ 产品承诺：打开小程序一定看得到                          │
└─────────────────────────────────────────────────────────────┘
```

**降级顺序不可颠倒**：先试 ①，失败试 ②，都失败也必须写 ③。

> ⚠️ **纪律：** ① 是**验证期的临时通道**。产品化（面向非家人用户）之前必须拆除，见第十四章。

---

## 三、整体架构

```text
┌──────────────┐
│  小程序端     │  ① 用户点「叮一下」
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────────────────────────────────┐
│  后端 NestJS（微信云托管）                 │
│                                          │
│  modules/notify/                         │
│    ├─ notify.service.ts     ← 通道选择    │
│    ├─ mp-account.client.ts  ← 调微信 API  │
│    └─ landing.controller.ts ← 中转页      │
│                                          │
│  modules/wechat/                         │
│    └─ mp-callback.controller.ts           │
│        ← 接收公众号消息，完成 openid 绑定   │
└───────┬──────────────────────▲───────────┘
        │ ② POST               │ ④ 用户发绑定码
        │  cgi-bin/message/    │    微信推给公众号
        │  template/send       │
        ▼                      │
┌──────────────────────────────────────────┐
│  微信服务器                                │
│    ├─ 公众号模板消息 → 用户微信服务通知      │
│    └─ 用户关注/发消息 → 我们的回调接口       │
└──────────────────────────────────────────┘
```

**为什么中间那一跳（Cloudflare Worker）没了？**

v1.0 把「取 token + 发模板消息」外包给 Worker，图的是不用在后端存 appsecret。但验证下来这层脚手架的代价大于收益：

- **可达性**：Worker 用的是 `*.workers.dev` 共享域名，在大陆被 DNS 污染。云托管容器在上海，那次 `fetch` 根本出不去（2026-11-11 运行日志实测，见 §十五 第 8 行）。要救它就得再买/绑一个域名，等于把「能不能收到提醒」押在自有域名 + CF 边缘上。
- **中转页也得跟着搬**：`/skin` 在 Worker 上，`WX_BASE_URL` 同样出不去；用户点了消息打不开中转页。
- **多一处故障点、多一套密钥**：`API_TOKEN` 要在 Worker 和后端两边对齐，排查时得同时看两处日志。

后端本来就是公网可达（云托管自带域名）、也有数据库，直连微信 API 少一跳、少一份凭据、少一个待清理的线上资源。

---

## 四、跳转链路（三级降级）

### 4.1 真实能力边界（已核实官方文档，不要想当然）

| 手段 | 个人主体可用？ | 依据 / 说明 |
| --- | --- | --- |
| 模板消息 `miniprogram` 字段 | ⚠️ **待实测** | 官方要求「服务号已关联该小程序」；测试号无关联入口，**大概率不生效** |
| URL Link（`wxaurl.cn`） | ❌ **不可用** | 官方原文：「**针对非个人主体小程序开放**」，且「只能生成已发布的小程序的 URL Link」 |
| `wx-open-launch-weapp` 开放标签 | ❌ 不可用 | 需认证公众号 + JSSDK 权限，测试号不具备 |
| **小程序码（长按识别）** | ✅ **可用** | 个人主体可生成，中转页展示图片，长按识别即打开。**主力手段** |
| 纯文案引导 | ✅ 可用 | 「打开微信，搜索小程序『家有小事』」——最后保底 |

> **教训：** 网上大量教程讲「公众号跳小程序」用的是 URL Link 或开放标签，**这两条对个人主体都不通**。不要照抄。

### 4.2 降级顺序

```text
用户点击模板消息
        │
        ▼
① 模板消息 miniprogram 字段生效？
   ├─ 是 → 直接打开小程序对应页面                    [最优，待实测]
   └─ 否 ↓
② 打开中转页 <MP_LANDING_URL>（/api/skin?title=..&message=..&date=..）
   ├─ 展示消息全文（保证用户至少能看到内容）
   ├─ 展示小程序码图片 → 用户长按识别 → 打开小程序      [主力]
   └─ 未配置小程序码 ↓
③ 纯文案：「打开微信，搜索小程序『家有小事』」          [保底]
```

### 4.3 中转页长什么样

> 这一页现在由后端 `landing.controller.ts` 渲染（`GET /api/skin`，v1.1.0 前在 Worker 上）。
> 图标按通知种类换：派活 🎯 / 叮一下 🔔 / 完成 ✅ / 其他 💬；视觉规格见 `docs/07` §10.3。
> **页面里没有任何私有数据** —— 标题、正文、时间全来自 URL 参数，所以它可以是 `@Public()`，
> 也正因为如此，参数**必须逐字转义**（`escapeHtml`）后才进 HTML。

```
┌─────────────────────────────┐
│                             │
│   🔔 家有小事                │
│                             │
│   阿妈，有个活儿到你啦～      │
│   ─────────────────────     │
│   记得买酱油                  │
│                             │
│   2026-10-06 20:15          │
│                             │
│   ┌───────────────────┐     │
│   │                   │     │
│   │    [小程序码图片]   │     │  ← 长按识别
│   │                   │     │
│   └───────────────────┘     │
│   长按识别小程序码，打开「家有小事」│
│                             │
└─────────────────────────────┘
```

---

## 五、openid 绑定链路 ⭐

> **这是整个方案的前置条件。没有 openid，一条都发不出去。**

### 5.1 为什么必须单独做绑定

微信的 openid 是**「用户 × 应用」**维度的：

```text
同一个阿妈：
   在小程序里  →  openid = oX_aaa111      （小程序 openid）
   在公众号里  →  openid = oY_bbb222      （公众号 openid）

两个值完全不同，无法互相推导。
```

而 wxpush 发送模板消息，**需要的是「公众号 openid」**。

### 5.2 主方案：绑定码 + 消息回调（推荐）

利用测试号后台的「**接口配置信息**」——它可以把用户发给公众号的消息转发到我们的服务器。

```text
【小程序内】
用户进入「我的 → 微信提醒」页
        │
        ▼
后端生成 6 位绑定码，存 users 表
   users.mp_bind_code / mp_bind_code_expires_at   TTL: 10 分钟
        │
        ▼
页面展示：① 测试号二维码   ② 绑定码「 7 3 5 2 4 1 」
        │
        ▼
【微信内】
用户扫码关注测试号 → 发送消息「735241」
        │
        ▼
【微信服务器 → 我们的后端】
POST /api/wechat/mp-callback   (XML 报文)
   报文里含：FromUserName = 公众号 openid
             Content      = "735241"
        │
        ▼
后端处理：
   ① 解析 XML，取 openid 与绑定码
   ② 查 users.mp_bind_code = '735241' 且未过期 → 拿到 userId
   ③ 写 users.mp_openid = openid, users.mp_bound_at = now()
   ④ 清空绑定码两列（mp_bind_code / mp_bind_code_expires_at）
   ⑤ 回一条文本消息：「绑定成功，以后家里有事会在这里提醒你 ✅」
        │
        ▼
【小程序内】
页面轮询「绑定状态」→ 检测到已绑定 → 显示「✅ 已开启微信提醒」
```

**用户实际只需要做两件事：扫码关注 + 发一次码。** 之后的绑定全自动。

### 5.3 保底方案：手工录入（自测 / 家人极少时用）

如果不想做回调，V0.1 完全可以手工：

1. 家人扫码关注测试号
2. 打开 [测试号后台](https://mp.weixin.qq.com/debug/cgi-bin/sandbox) → 页面下方的**用户列表**
3. 复制该用户的 openid
4. 调一次内部接口写入（或直接改数据库）：

```bash
curl -X POST "https://<后端域名>/api/notify/internal/bind-mp-openid" \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"userId": "3", "mpOpenid": "oY_bbb222xxxxx"}'
```

> ⚠️ `userId` **必须是字符串**（`ManualBindDto` 上是 `@IsString()`，为了躲开 JS 大整数精度），
> 传数字 `3` 会被 class-validator 直接打回 400。

> **建议：** 先用保底方案把链路跑通（验证 A5/A6），再补自动绑定。不要一上来就啃回调。

### 5.4 数据落点

```sql
-- users 表新增两个字段（见 db/schema.sql）
`mp_openid`   VARCHAR(64) DEFAULT NULL COMMENT '公众号 openid（wxpush 推送用）',
`mp_bound_at` DATETIME    DEFAULT NULL COMMENT '公众号提醒绑定时间',

UNIQUE KEY `uk_mp_openid` (`mp_openid`)
```

**为什么放 `users` 而不是 `family_members`？**
公众号 openid 属于「用户 × 公众号」这个关系，与家庭无关。同一用户不管在几个家庭里，openid 都是同一个。

---

## 六、Worker 改造说明

> 🕰 **已废弃（v1.1.0）。** 本章记录的 `wxpush/index.js` 改造不再在链路上：通道① 由后端
> `mp-account.client.ts` 直连微信 API，中转页由后端 `landing.controller.ts` 渲染。
> 内容保留是因为这四处改造（自定义 `data`、`miniprogram` 字段、`client_msg_id` 防重、中转页注入）
> 正好是「微信模板消息能做什么」的实测笔记，产品化换成正式公众号时仍用得上。

对 `wxpush/index.js` 共做了 **4 处**改造，全部向后兼容（不传新参数时行为与原生 wxpush 完全一致）。

### 改造 1 · `sendMessage()` 扩展

```js
async function sendMessage(accessToken, userid, template_id, base_url, title, content, extra = {}) {
  // extra 新增三个字段：
  //   data                 自定义模板数据（不传则用默认的 { title, content }）
  //   miniprogramAppid     跳转小程序 appid（与 url 同时存在时微信优先跳小程序）
  //   miniprogramPagepath  跳转页面路径，默认 pages/index/index
  //   clientMsgId          防重 ID（微信侧 24h 内相同 ID 只发一次）
```

### 改造 2 · 新增 `buildJumpHtml(env)`

生成中转页里的「打开小程序」区块，由环境变量控制：

```js
function buildJumpHtml(env) {
  const name = escapeAttr(env.MP_NAME || '小程序');
  const link = env.MP_URL_LINK;      // 个人主体留空
  const qr   = env.MP_QRCODE_URL;    // 主力手段
  if (!link && !qr) return '';       // 都没配 → 中转页退化为纯消息展示
  // ...
}
```

同时新增 `escapeAttr()` 做 HTML 属性转义，防注入。

### 改造 3 · `/wxsend` 路由新增参数解析

```js
const miniprogramAppid    = params.miniprogram_appid || env.MP_APPID || '';
const miniprogramPagepath = params.miniprogram_pagepath || env.MP_PAGEPATH || 'pages/index/index';
const customData          = parse(params.data);     // 支持 JSON 字符串或对象
const clientMsgId         = params.client_msg_id || undefined;
```

### 改造 4 · 中转页注入

`/skin` 路由新增 `.jump-box` / `.jump-btn` / `.jump-qr` 样式，并在页面中注入 `${jumpHtml}`。

### 校验

```bash
node --check wxpush/index.js   # ✅ 通过
```

---

## 七、环境变量清单

> 🕰 **已废弃（v1.1.0）：这是 Worker 侧的变量，现在不再需要。**
> 现行配置在**后端**，见 §9.4； Worker 侧唯一还有用的是 `WX_APPID` / `WX_SECRET` 这两个值本身
> （它们对应后端的 `MP_ACCOUNT_APPID` / `MP_ACCOUNT_SECRET`）。

~~完整模板见 `wxpush/.env.example`~~ —— 该文件已于 2026-11-12 随 Worker 代码一起从仓库删除，本节只作历史记录。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `API_TOKEN` | ✅ | 调用 `/wxsend` 的令牌，自己生成随机串 |
| `WX_APPID` | ✅ | 测试号 appID |
| `WX_SECRET` | ✅ | 测试号 appsecret |
| `WX_USERID` | ✅ | 默认接收人公众号 openid，多个用 `\|` 分隔（仅联调用） |
| `WX_TEMPLATE_ID` | ✅ | 模板消息模板 ID |
| `WX_BASE_URL` | ✅ | 中转页地址，形如 `https://<worker域名>/skin` |
| `MP_APPID` | ⚠️ | 小程序 appID（`miniprogram` 字段用，待实测） |
| `MP_PAGEPATH` | ⚠️ | 跳转页面，默认 `pages/index/index` |
| `MP_QRCODE_URL` | ✅ | **小程序码图片地址（个人主体唯一可靠跳转手段）** |
| `MP_URL_LINK` | ❌ | URL Link，个人主体不可用，留空 |
| `MP_NAME` | ❌ | 中转页显示的小程序名 |
| `ALIVE_DAYS` | ❌ | 测试号保活间隔（天），不配则不保活 |

> **安全纪律：** 所有敏感值走 `wrangler secret put`，**不写进 `wrangler.toml`**，不提交仓库。`.gitignore` 已忽略 `.dev.vars`。

---

## 八、部署步骤（从零到跑通）

### Step 1 · 拿到测试号

1. 手机微信打开 <https://mp.weixin.qq.com/debug/cgi-bin/sandbox>
2. 扫码登录，记下 **appID** 和 **appsecret**

### Step 2 · 建三个模板消息模板

测试号后台「**模板消息接口 → 新增测试模板**」，建 **3 个**模板。

⚠️ **模板内容必须与本文 §10.2 逐字一致**（`{{}}` 里的字段名一个都不能改），
否则微信返回 `47003`，而且报错信息几乎无法定位。

| # | 模板标题 | 内容 |
| --- | --- | --- |
| 1 | 待办事项提醒 | §10.2 ① |
| 2 | 备忘事项提醒 | §10.2 ② |
| 3 | 日程任务完成提醒 | §10.2 ③ |

建好后把 3 个模板 ID 填进 `server/.env`：

```bash
MP_TEMPLATE_TASK=""        # 待办事项提醒（派活）
MP_TEMPLATE_REMINDER=""    # 备忘事项提醒（叮一下）
MP_TEMPLATE_DONE=""        # 日程任务完成提醒（完成回执）
```

> 💡 测试号的模板字段可以**完全自定义**，这是它的优势。
> 但正因如此，字段名是**我们自己定的契约** —— 后台改了，代码必须同步改
> （唯一来源：`notify.templates.ts` 的 `MP_TEMPLATE_SPECS`）。

### Step 3 · 关注测试号，拿到自己的 openid

用手机微信扫码关注测试号 → 回到后台页面下方「**用户列表**」，能看到自己的 openid，复制下来。

### Step 4 · 部署 Worker

> 🕰 **已废弃（v1.1.0），跳过。** 后端直连微信 API，不需要 Worker，也不需要 `wrangler deploy`。
> 线上那个 Worker 的清理动作见 §十四。
> 当初要它，是因为「不想在后端存 appsecret」；后来发现它在大陆根本访问不到（§十五 第 8 行），
> 而 appsecret 放云托管环境变量本来就是常规做法 —— 这层脚手架没有价值了。

```bash
cd wxpush
npm i -g wrangler
wrangler login
wrangler deploy
```

部署成功后拿到 Worker 域名，形如 `https://jia-you-xiao-shi-push.xxx.workers.dev`。

> 🔴 **`*.workers.dev` 在中国大陆被 DNS 污染，而云托管容器就在上海**（2026-11-11 实测，见 §十五 第 8 行）。
> 也就是说后端往这条 URL 发的那次 `fetch` **很可能根本出不去**。它是通道① 的**第二道墙**
> （第一道是没人绑定，见 `docs/06` §3.1），**绑定做完后必须当场验一次**：
> 运行日志里出现 `fetch failed` / `ETIMEDOUT` 且**没有微信 errcode**，就是它。
> ~~解法是给 Worker 绑一个**自定义域名**（Cloudflare 免费版就能加），只改 `WXPUSH_URL` 一个环境变量，业务代码零改动。~~
> → **2026-11-12 没走这条路**：绑自定义域名要把可达性押在自有域名 + CF 边缘上，中转页也得跟着搬；
> 直接砍掉 Worker 更省事，见 §三。

### Step 5 · 配置密钥

> 🕰 **`wrangler secret put` 那一套已废弃（v1.1.0）。** 现在凭据只配在**云托管控制台**的环境变量里：

| 变量 | 值从哪来 |
| --- | --- |
| `MP_ACCOUNT_APPID` | Step 1 测试号的 appID |
| `MP_ACCOUNT_SECRET` | Step 1 测试号的 appsecret |
| `MP_TEMPLATE_TASK` / `MP_TEMPLATE_REMINDER` / `MP_TEMPLATE_DONE` | Step 2 建的三个模板 ID |
| `MP_LANDING_URL` | 云托管后端域名 + `/api/skin`（见 §9.4 的警告：前缀不能漏） |
| `MP_QRCODE_URL` | Step 6 上传后得到的公网 URL（可后补） |

`node tools/gen-prod-env.mjs` 会把这些变量的名和值整理成一份清单（输出到仓库外），照抄进控制台即可。

### Step 6 · 生成小程序码

1. 后端调 `wxacode.getUnlimited`（用小程序 access_token）
2. 拿到图片 Buffer，上传到云存储 / COS，得到公网 URL
3. 填进 `MP_QRCODE_URL`

> 📦 **本项目的小程序码已经生成好并入库**：`wxpush/assets/miniprogram-code.png`
> （放射状圆码，右下角有**绿色小程序角标**）。所以这里只剩「上传到 COS → 填 URL」两步，
> 不需要再调一次 `wxacode.getUnlimited`。
>
> ⚠️ **别拿错图。** 仓库里另有一张二维码：`miniprogram/assets/mp-account-qr.jpg`
> —— 那是**公众号二维码**（方形 + 中间头像），给小程序端 P21 用的（扫码关注那个号）。
> **中转页要的是小程序码**（打开小程序）；拿公众号二维码来填 `MP_QRCODE_URL`，
> 用户长按识别会跳到「关注」页 —— 这条兜底路等于废了。
>
> ⚠️ **开发期**小程序未发布，扫小程序码只有开发者/体验成员能打开。上线后所有人才行。**联调期可先用文案保底。**

### Step 7 · 跑通验证

```bash
# 通道一单独实探（绕过后端，直接打微信 API；只需 4 个变量）
MP_ACCOUNT_APPID="wx..." \
MP_ACCOUNT_SECRET="..." \
MP_TEMPLATE_REMINDER="<模板ID>" \
RECEIVER="<你的公众号 openid>" \
node tools/test-mp-template.mjs

# 中转页（后端渲染，浏览器直接打开）
https://<后端域名>/api/skin?title=测试&message=内容&date=2026-11-12
```

手机会收到一条模板消息 → **点一下，看能不能跳到小程序**。这一步的结论直接决定假设 A6 是否成立。

> ⚠️ 这个脚本**测不了「家人能不能收到」**：它只验「公众号这个凭据 + 这个模板 + 这个 openid」通不通，
> 收件人固定是 `RECEIVER` 一个人。真实链路要回小程序里派一次活，再看 `notification_logs` 的 `channel`/`status`。

### Step 8 · 配置绑定回调（可选，做自动绑定时才需要）

测试号后台「**接口配置信息**」：

| 项 | 值 |
| --- | --- |
| URL | `https://<后端域名>/api/wechat/mp-callback` |
| Token | 自己设一个随机串，与后端 `MP_CALLBACK_TOKEN` 保持一致 |

> ⚠️ **前缀是 `/api`，不是 `/api/v1`**（`main.ts` 的 `setGlobalPrefix('api')`）。
> 这一条早期文档写成了 `/api/v1/…`，照着填会得到 404，微信那边永远显示「配置失败」，
> 于是 `mp_openid` 永远为空、通道① 一条都发不出去 —— 排查时很容易误判成推送代码坏了。

点「提交」时微信会发一个 GET 请求验证签名，后端必须正确返回 `echostr`（见 `mp-callback.controller.ts`）。

---

## 九、后端对接

### 9.1 新增文件

```text
packages/shared/src/dto/
└── notify.ts                       # 前后端共享的通知类型、送达结果、toast 文案

server/src/modules/notify/          # 通道一 + 通道二 + 降级，全部收在这里
├── notify.module.ts                # 模块定义（把 SUBSCRIBE_MESSAGE_PORT 接到真实适配器）
├── notify.controller.ts            # 用户侧接口（绑定状态 / 生成绑定码 / 解绑）
├── notify.service.ts               # 通道选择 + 降级 + 日志（核心）
├── notify.templates.ts             # 通道一文案与字段组装（产品文案唯一定义处）
├── mp-account.client.ts            # 通道一：直连微信模板消息 API（含 stable_token 缓存）
├── landing.controller.ts           # 通道一：中转页 GET /api/skin（后端渲染，无 Worker）
├── subscribe.templates.ts          # 通道二模板定义与字段组装（thing 截断 / time 格式化）
├── subscribe-quota.service.ts      # 通道二额度池（MySQL subscribe_quotas）
├── subscribe-message.port.ts       # 通道二端口契约（notify 只依赖它，不依赖微信）
└── subscribe-message.adapter.ts    # 通道二真实实现（扣额度 → 下发 → 失败退还）

server/src/modules/wechat/          # 微信侧能力
├── wechat.service.ts               # code2Session / access_token / 订阅消息下发
├── mp-bind.service.ts              # 绑定码生成 / 校验 / openid 写入
└── mp-callback.controller.ts       # 测试号消息回调（验签 + 收码 + 绑定）

tools/
├── test-mp-template.mjs            # 通道一连通性实探（直连微信 API，不经后端）
└── probe-subscribe.mjs             # 通道二连通性实探（看微信原始 errcode）
```

> **为什么订阅消息的实现在 notify 而不是 wechat**：整条通道（模板 → 额度 → 下发 → 降级）
> 收在一个模块里，依赖方向保持 notify → wechat 单向，不会成环。
> `WechatService` 只提供「怎么调微信 API」，不管「该不该发、发不出去怎么办」。

### 9.2 核心调用

```ts
// notify.service.ts 的主流程（伪代码）
async send(thing: FamilyThing, receiver: FamilyMember) {
  const log = await this.createLog(thing, receiver);   // 先落库，状态=待发送

  // 通道 ① 公众号模板消息（主力）
  if (receiver.user.mpOpenid) {
    const res = await this.mpAccount.send({
      title: this.buildTitle(thing),
      content: this.buildContent(thing, receiver),
      userid: receiver.user.mpOpenid,
      miniprogramAppid: this.cfg.MP_APPID,
      miniprogramPagepath: 'pages/index/index',
      clientMsgId: `${log.id}`,       // 用日志 ID 防重
    });
    if (res.ok) return this.markSent(log, Channel.MP_TEMPLATE);
    // 失败不 return，继续降级
  }

  // 通道 ② 小程序订阅消息
  if (await this.hasSubscribeQuota(receiver.userId)) {
    const ok = await this.wechat.sendSubscribeMessage(...);
    if (ok) return this.markSent(log, Channel.SUBSCRIBE);
  }

  // 通道 ③ 站内消息（永不失败）
  return this.markSent(log, Channel.IN_APP);
}
```

### 9.3 职责边界（不要写乱）

| 组件 | 只做 | 不做 |
| --- | --- | --- |
| `mp-account.client.ts` | 取 access_token、拼参数、发 HTTP、解析微信错误码 | 不做通道选择、不写数据库、不组装文案 |
| `landing.controller.ts` | 把消息参数渲染成中转页 HTML | 不查数据库、不做权限判断（页面里没有任何私有数据） |
| `notify.templates.ts` | 组装**两条通道**的模板数据与站内文案 | 不发 HTTP、不碰数据库 |
| `notify.service.ts` | 通道选择、降级、写日志 | 不直接发 HTTP、不管额度细节 |
| `subscribe-message.adapter.ts` | 扣额度、调微信、按 errcode 退还/归零 | 不组装文案、不做通道选择 |
| `subscribe-quota.service.ts` | 额度读写（`grant` / `consume` / `refund` / `reset`） | 不知道「这条通知是什么」 |
| `wechat.service.ts` | code2Session / access_token / 调微信 HTTP | 不决定该不该发 |
| `mp-callback.controller.ts` | 验签、解析 XML、绑定 openid | 不发消息 |
| 小程序端 | 展示状态、引导绑定、上报授权结果 | 不做任何推送判断 |

### 9.4 后端环境变量

```bash
# ---------- 通道总开关 ----------
# 产品化拆除通道① 时，只把这个置为 false，业务代码一行都不用改
NOTIFY_MP_ENABLED=true

# ---------- 通道一：公众号凭据（直连微信 API，不再经 Worker）----------
# ⚠️ 这是**第三套** appid/secret，与 WX_APPID/WX_SECRET（小程序）不能互换，
#    也与 MP_APPID（模板消息里要跳的那个小程序）不同义。照抄必错。
MP_ACCOUNT_APPID=<测试号/公众号 appID>
MP_ACCOUNT_SECRET=<测试号/公众号 appsecret>

# ---------- 通道一：中转页 ----------
# ⚠️ 路由是 /api/skin —— 全局前缀 /api 不能漏（漏了微信侧点开是 404）
MP_LANDING_URL=https://<后端域名>/api/skin
MP_QRCODE_URL=<小程序码图片公网 URL，可后补>
MP_NAME=家有小事

# ---------- 通道一：公众号模板 ID（三个，见 §10.2）----------
MP_TEMPLATE_TASK=<待办事项提醒模板 ID>       # 派活
MP_TEMPLATE_REMINDER=<备忘事项提醒模板 ID>   # 叮一下
MP_TEMPLATE_DONE=<日程任务完成提醒模板 ID>   # 完成回执

# ---------- 跳转 ----------
MP_APPID=<小程序 appID>
MP_PAGEPATH=pages/index/index

# ---------- 测试号回调（做自动绑定时才需要）----------
MP_CALLBACK_TOKEN=<与测试号后台「接口配置信息」的 Token 一致>

# ---------- 通道二：小程序订阅消息模板 ID（三个，见 §10.7）----------
# ⚠️ 这三个与上面的 MP_TEMPLATE_* **完全不是一回事**，别互相复制！
#    订阅消息的模板在小程序后台建，字段名由公共模板库定死（thing1 / time23）
WX_TEMPLATE_TASK=<待办事项提醒模板 ID>       # 派活
WX_TEMPLATE_NUDGE=<备忘事项提醒模板 ID>      # 叮一下
WX_TEMPLATE_DONE=<日程任务完成提醒模板 ID>   # 完成回执
```

> ⚠️ **最容易搞错的一处**：`MP_TEMPLATE_*`（公众号模板）与 `WX_TEMPLATE_*`（订阅消息模板）
> 是**两个体系**，模板 ID 不能互换。判别方法是看**字段名**：
> 后台模板里是 `first` / `keyword1` 的属于公众号，是 `thing1` / `time23` 的属于订阅消息。
>
> 曾经踩过这个坑：把订阅消息的模板 ID 复制进了 `MP_TEMPLATE_*` 槽位，
> 结果通道一发出去就是 `47003`，而且完全看不出原因。

> **模板 ID 是按类型分开发送的。** `mp-account.client.ts` 按 `templateKind` 从环境变量取对应的
> `MP_TEMPLATE_*` 并**显式放进请求体** —— **不显式传的话三种通知会全用同一个模板**，
> 字段对不上直接 47003。这是一个容易踩的坑，已在代码里注释。

### 9.5 一处关键的防御性设计

三段防御都在 `mp-account.client.ts` 里，共同点是**「消息送不出去」永远比「跳转降级」严重**：

**① 带 `miniprogram` 失败 → 去掉该字段重发一次**

```text
带 miniprogram 字段发送 → 失败？
        │
        ├─ 成功 → 结束
        └─ 失败 → 去掉 miniprogram 字段重发一次
                    ├─ 成功 → 消息至少送到了，跳转降级为中转页
                    └─ 失败 → 返回第一次的错误（更接近根因）
```

**为什么需要它：** 测试号能否使用 `miniprogram` 字段尚未验证（假设 A6，测试号后台没有「关联小程序」的入口）。如果该字段不合法会导致**整条消息发送失败**，那配置 `MP_APPID` 就会变成一个「按下就炸」的开关。

有了这层重试，**最坏情况只是跳转降级，消息永远送得出去**。

**② `url` 永远一起带上（`MP_LANDING_URL` 配了的话）**

`miniprogram` 和 `url` 同时存在时微信优先跳小程序，`url` 只在前面那条不生效时被用到。
所以中转页不是「备胎的方案」，而是**每次发送都实打实带在报文里的兜底**。
`MP_LANDING_URL` 没配则**整个 `url` 字段不出现** —— 代码里不拼任何写死的 host（AGENTS §4.5）。

**③ access_token 用 `stable_token` + 进程内缓存 + 并发合并**

| 做法 | 为什么 |
| --- | --- |
| 用 `cgi-bin/stable_token`（`force_refresh: false`）而不是老的 `cgi-bin/token` | 老接口是「后取的顶掉前一个」，云托管多副本 / 每次重启都会互相打飞，表现为一半通知 `40001`。`stable_token` 同一凭据重复取返回**同一个** token |
| 进程内缓存到有效期前 **5 分钟** | 卡在有效期边界上容易拿到刚失效的 token |
| `inflight` 合并并发请求 | 一批提醒同时进来时只打一次微信接口，不白耗调用配额 |

---

## 十、文案与模板设计

### 10.1 三个模板与通知类型的映射

公众号模板消息的 `data` 字段名由**后台模板**决定，对不上就返回 `47003`。
所以「后台模板内容」和「后端组装的字段」必须由同一处约束 ——
**代码里的唯一来源是 `server/src/modules/notify/notify.templates.ts` 的 `MP_TEMPLATE_SPECS`**，
本节内容与它保持一致。

| 通知类型 | 后台模板标题 | 环境变量 | 字段 |
| --- | --- | --- | --- |
| `TASK_ASSIGNED`（派活） | **待办事项提醒** | `MP_TEMPLATE_TASK` | first / keyword1~4 / remark |
| `REMINDER`（叮一下） | **备忘事项提醒** | `MP_TEMPLATE_REMINDER` | first / keyword1~3 / remark |
| `TASK_DONE`（完成回执） | **日程任务完成提醒** | `MP_TEMPLATE_DONE` | first / keyword1~3 / remark |
| `JOIN_FAMILY` / `SYSTEM` | — 无对应模板 → 自动降级到订阅消息 + 站内 | | |

> **为什么要加 `first` 和 `remark`？**
> 这两个字段是产品文案纪律的载体：`first` 是「阿妈，有个活儿到你啦～」这句人情味开头，
> `remark` 是「有空的时候弄一下就行 😊」这句不带催促的结尾。
> **少了它们，模板消息就退化成机械通知了。** 后台建模板时务必加上。

### 10.2 后台模板内容（直接粘贴）

> ⚠️ **`{{}}` 里的字段名一个都不能改**，顺序也要一致。
> 测试号后台：**模板消息接口 → 新增测试模板**。

**① 待办事项提醒**（派活用）

```text
{{first.DATA}}
事项主题：{{keyword1.DATA}}
事项描述：{{keyword2.DATA}}
提醒对象：{{keyword3.DATA}}
提醒时间：{{keyword4.DATA}}
{{remark.DATA}}
```

**② 备忘事项提醒**（叮一下用）

```text
{{first.DATA}}
备忘事项：{{keyword1.DATA}}
事项时间：{{keyword2.DATA}}
相关人员：{{keyword3.DATA}}
{{remark.DATA}}
```

**③ 日程任务完成提醒**（完成回执用）

```text
{{first.DATA}}
备忘事项：{{keyword1.DATA}}
完成人：{{keyword2.DATA}}
完成时间：{{keyword3.DATA}}
{{remark.DATA}}
```

### 10.3 后端组装的字段

**派活（`MP_TEMPLATE_TASK`）**

```ts
data: {
  first:    { value: '阿妈，有个活儿到你啦～' },       // 人情味开头
  keyword1: { value: '记得买酱油' },                  // 事项主题
  keyword2: { value: '下班路上顺手带一瓶' },          // 事项描述（无则给默认句）
  keyword3: { value: '阿爸' },                        // 提醒对象（接收人称谓）
  keyword4: { value: '今天 18:00' },                  // 提醒时间（无则「不限时间」）
  remark:   { value: '有空的时候弄一下就行 😊' },     // 结尾，永远不带催促
}
```

**叮一下（`MP_TEMPLATE_REMINDER`）**

```ts
data: {
  first:    { value: '阿爸，别忘了这件事' },
  keyword1: { value: '记得带水杯' },                  // 备忘事项
  keyword2: { value: '明天 07:30' },                  // 事项时间
  keyword3: { value: '阿妈 → 阿爸' },                 // 相关人员（发起人 → 接收人）
  remark:   { value: '到时候了，提醒你一下～' },
}
```

**完成回执（`MP_TEMPLATE_DONE`）**

```ts
data: {
  first:    { value: '阿爸把「记得买酱油」弄好啦' },
  keyword1: { value: '记得买酱油' },                  // 备忘事项
  keyword2: { value: '阿爸' },                        // 完成人
  keyword3: { value: '今天 17:42' },                  // 完成时间
  remark:   { value: '辛苦啦 🎉' },
}
```

> ⚠️ **完成回执是「搞定啦」，不是「任务已完成」。** 这是产品纪律，不是措辞偏好。

### 10.4 时间格式化

统一走 `formatMpTime()`，输出中文口语。**业务代码里不做任何时区换算**：
存储层是 UTC，Node 进程设了 `TZ=Asia/Shanghai`，所以对 Date 调本地 getter
拿到的就是北京时间（详见 docs/01 §4.3）。

| 情况 | 输出 |
| --- | --- |
| 今天 | `今天 18:00` |
| 明天 | `明天 18:00` |
| 其他 | `10月8日 18:00` |
| 未设置 | `不限时间`（派活）/ `现在`（叮一下） |

### 10.5 各场景文案总表

| 场景 | first | remark |
| --- | --- | --- |
| 派活 | `{称谓}，有个活儿到你啦～` | `有空的时候弄一下就行 😊` |
| 叮一下 | `{称谓}，别忘了这件事` | `到时候了，提醒你一下～` |
| 完成回执 | `{完成人}把「{事项}」弄好啦` | `辛苦啦 🎉` |
| 加入家庭 | `欢迎加入「{家庭名}」` | `以后家里的事都在这儿说～` |

> ⚠️ **禁用词**（PRD 31.3）：逾期、超时、待办、审批、流程、KPI、催办、监督、绩效。
> **所有文案必须有人情味**，这是产品纪律，不是文案偏好。

### 10.6 字段对齐自检

字段多了微信会忽略，**少了直接 47003**，而报错信息几乎无法定位。
代码里提供了 `validateTemplateData(kind, data)`，返回 `{ ok, missing, extra }`。

**✅ 已实现两个自检入口：**

```bash
# ① 开发期：把两条通道的字段逐项比对，并打印可粘贴到后台的模板原文
cd server && pnpm run check:templates

# ② 部署后：打这个接口，一眼看出「哪个模板 ID 没配」「代码期望哪些字段」
curl https://<你的域名>/api/health/templates
```

---

### 10.7 通道二：小程序订阅消息模板（**另一套，别混**）

> ⚠️ **这是最容易搞错的地方。** 订阅消息与公众号模板消息是**两个完全不同的体系**，
> 字段名规则都不一样。排查 `47003` 时，**不要拿一个通道的字段去对另一个通道**。

| 维度 | 订阅消息（本节） | 公众号模板消息（§10.1–10.6） |
| --- | --- | --- |
| 后台在哪 | 小程序后台 `mp.weixin.qq.com` → 功能 → 订阅消息 | 公众号（测试号）后台 → 模板消息接口 |
| 字段名 | **公共模板库定死**（`thing1` / `time23`），不可改 | **完全自定义**（`first` / `keyword1`） |
| 接收人 | **小程序 openid** | **公众号 openid**（两者无法互推） |
| 额度 | 一次性，1 次授权 = 1 条 | 关注即可无限次 |
| 环境变量 | `WX_TEMPLATE_*` | `MP_TEMPLATE_*` |
| 通道优先级 | ② 辅助 | ① 主力 |

**代码里的唯一来源是 `server/src/modules/notify/subscribe.templates.ts` 的 `SUB_TEMPLATE_SPECS`**，
本节内容与它保持一致。

| 通知类型 | 模板标题 | 模板编号 | 环境变量 | 字段 |
| --- | --- | --- | --- | --- |
| `TASK_ASSIGNED`（派活） | 待办事项提醒 | 2983 | `WX_TEMPLATE_TASK` | `thing1` / `thing4` / `thing22` / `time23` |
| `REMINDER`（叮一下） | 备忘事项提醒 | 10938 | `WX_TEMPLATE_NUDGE` | `thing3` / `time10` / `thing6` |
| `TASK_DONE`（完成回执） | 日程任务完成提醒 | 77364 | `WX_TEMPLATE_DONE` | `thing1` / `thing2` / `time3` |
| `JOIN_FAMILY` / `SYSTEM` | — 无对应模板 → 自动降级到站内消息 | | | |

**后端组装的字段**

```ts
// 派活（WX_TEMPLATE_TASK）—— 字段顺序与后台一致
data: {
  thing1:  { value: '记得买酱油' },           // 事项主题（≤20 字）
  thing4:  { value: '下班路上顺手带一瓶' },   // 事项描述（≤20 字）
  thing22: { value: '阿爸' },                 // 提醒对象
  time23:  { value: '2026-10-08 18:00' },     // 提醒时间（必填！）
}

// 叮一下（WX_TEMPLATE_NUDGE）
data: {
  thing3:  { value: '接阿公去体检' },
  time10:  { value: '2026-10-07 07:30' },
  thing6:  { value: '阿妈 → 阿爸' },          // 相关人员
}

// 完成回执（WX_TEMPLATE_DONE）
data: {
  thing1: { value: '记得买酱油' },
  thing2: { value: '阿爸' },                  // 完成人
  time3:  { value: '2026-10-06 17:42' },      // 完成时间
}
```

**两条硬约束（不满足就 47003）**

| 类型 | 限制 | 代码里怎么保证 |
| --- | --- | --- |
| `thing` | **最多 20 个字符** | `truncateThing()` 统一截断，超出用 `…` 收尾 |
| `time` | 只认 `yyyy-MM-dd HH:mm` 或 `yyyy年MM月dd日 HH:mm` | `formatSubTime()` 统一格式化 |

> ⚠️ **不要复用 `formatMpTime()`** —— 它产出的是「今天 18:00」这种口语，
> 给公众号模板用正好，给订阅消息用直接 `47003`。两套格式化函数是刻意分开的。

**已知缺口：派活不设时间时发不出订阅消息**

`time23` 是必填的 `time` 字段，而公共模板库的模板**不可改字段**，
所以「不限时间」的派活只能靠**公众号模板（主力通道）+ 站内消息**。
代码里 `buildSubscribeData()` 会返回 `null`，通道二自动跳过 —— 这是**正常降级，不是失败**。
详见 `docs/未来需求池.md`。

**额度池记账**

订阅消息是一次性的，所以必须在服务端记账，否则会出现「以为能发、微信回 43101」的假成功。

| 时机 | 操作 | 触发方 |
| --- | --- | --- |
| 用户授权成功 | `grant()` **+1** | 前端 `POST /api/auth/subscribe-quota` |
| 下发成功 | `consume()` **-1** | 服务端下发前**原子**扣减（单条 `UPDATE ... WHERE remaining > 0`） |
| 下发失败（网络 / 47003） | `refund()` **+1** | 服务端自动退还，不白扣 |
| 微信返回 `43101` | `reset()` **归零** | 本地账错了，以微信为准 |

存储：MySQL `subscribe_quotas` 表，主键 `(user_id, template_id)`，`expires_at` 24 小时。
过期行不物理删除，按 0 处理。**额度表读写失败只影响辅助通道** ——
`NotifyService.trySubscribe` 会 catch 后降级到站内消息，不影响主流程。

**怎么实探**

```bash
# 真的发一条订阅消息给指定 openid（会消耗 1 条额度）
node tools/probe-subscribe.mjs <小程序openid> TASK
```

这个脚本会打印微信的**原始** errcode，并按错误码给出可操作的建议 ——
排查 `47003` 时它是唯一能看到原始报错的地方（服务端只记一条 warn 日志，
而且微信**不告诉你是哪个字段错了**）。

---

## 十一、通知记录与状态映射

`notification_logs` 表已扩展（见 `db/schema.sql`）：

```sql
`channel`  TINYINT COMMENT '发送渠道：1微信订阅消息 2站内消息 3公众号模板消息(wxpush)',
`status`   TINYINT COMMENT '状态：1待发送 2发送成功 3发送失败 4无订阅额度跳过 5未绑定提醒跳过',
```

> 那个 `(wxpush)` 是 COMMENT 里的**历史标签**（通道① 最初借 wxpush 这个第三方服务实现，v1.1.0 已拆）。
> 枚举值 `3` 与语义都没变，**不值得为改一个字跑一次 DDL**：`db/schema.sql` 全是 `IF NOT EXISTS`，
> 改了 COMMENT 现网也不会跟着变，只会造成「文档和库不一致」。看到它别当成漏改。

### 微信错误码 → 业务状态

| 微信错误码 | 含义 | 系统处理 | 用户看到（PRD 6.5.6） |
| --- | --- | --- | --- |
| `ok` | 成功 | `status=2` | 「已经叮到阿妈啦 🔔」 |
| `43004` | 用户未关注公众号 | `status=5`，降级到 ②③ | 「已记下，阿妈还没开微信提醒，她打开小程序就能看到」 |
| `40164` | **调用方 IP 不在公众号「IP 白名单」内** | `status=3`，降级；**去后台清空白名单**即可（测试号没有白名单设置项，正式号有） | 同上 |
| `40001` / `42001` | access_token 失效 | 重试 1 次 | 「没叮成功，稍后再试」 |
| `40013` | `MP_ACCOUNT_APPID` 填错 | `status=3`，**不重试**（重试也不会好） | 同上 |
| `47003` | 模板参数不匹配 | `status=3`，**打日志告警** | 同上 |
| `45009` | 接口调用超限 | `status=3`，降级 | 同上 |
| 网络异常 | — | 重试 1 次后降级 | 同上 |

> **47003 是开发期最常见的坑**：模板字段名和传的 `data` key 对不上。改模板后一定要同步改后端常量。

---

## 十二、降级与容错

| 故障 | 表现 | 兜底 |
| --- | --- | --- |
| 公众号 API 挂了 / 拿不到 token | ① 全部失败 | 降级到 ②③，站内消息照常 |
| 测试号被回收 | 全部返回 `40001` / `43004` | 同上；后端日志里 `拿不到公众号 access_token` 会先报错 |
| `MP_ACCOUNT_SECRET` 泄露 | 别人可冒充你的号发消息 | 测试号后台**重置 appsecret** → 更新云托管环境变量（旧值立刻失效） |
| 用户取关 | `43004` | `status=5`，站内消息兜底 |
| 模板被改字段 | `47003` | 后端同步模板常量 |
| 绑定码过期 / 被新码替换 | 绑定失败 | 重新生成绑定码即可（TTL 只有 10 分钟） |
| ~~Worker 域名出不到（大陆 + `*.workers.dev`）~~ | ~~`fetch failed`，没有微信 errcode~~ | **已消除（v1.1.0）**：Worker 拆掉了，改由后端直连 `api.weixin.qq.com`（容器到这条路的连通性由登录链路证明，见 `docs/06` §5.17） |
| 容器出口 IP 撞上 IP 白名单 | `40164` | 后台把 IP 白名单留空；云托管出口 IP 不固定，**不要**去填 |

**核心原则：通道① 的任何故障都不能影响主流程。** 发消息是异步的，失败只写日志，不阻塞用户操作，不弹错误给发起人以外的任何人。

---

## 十三、测试与验收

### 13.1 分层测试

| 层级 | 怎么测 | 通过标准 |
| --- | --- | --- |
| 通道① 连通性 | `tools/test-mp-template.mjs` | 手机收到消息 |
| 跳转能力 | 点消息 → 看落到哪 | 确认假设 A6（`miniprogram` 是否生效） |
| 中转页 | 浏览器打开 `<后端域名>/api/skin?title=测试&message=内容&date=2026-11-12` | 页面正常渲染，小程序码可长按识别 |
| 绑定链路 | 小程序生成码 → 公众号发码 | `users.mp_openid` 被正确写入 |
| 后端降级 | 故意把 `MP_TEMPLATE_DONE` 改成一个不存在的 ID | 通知记录 `status=3`，站内消息仍可见 |
| 端到端 | 阿妈派活给阿爸 | 阿爸微信收到，点击能进小程序 |

### 13.2 必测的负向场景

- [ ] 用户**未绑定**时派活 → 应提示 `NOT_BOUND`，且站内消息有记录
- [ ] 用户**已取关**时派活 → 应返回 `43004`，降级成功
- [ ] 绑定码**过期**后发送 → 应提示「绑定码已过期，请重新获取」
- [ ] 绑定码**错误** → 不泄露任何信息，只回「绑定码不对哦，重新获取一下」
- [ ] **重复发送**同一绑定码 → 绑定成功后码已清空，第二次应拒绝

### 13.3 M0 阶段必须回答的两个问题

| 假设 | 问题 | 若不成立 |
| --- | --- | --- |
| **A5** | 测试号模板消息能推给已关注用户吗？ | 回到 v0.2 的三层机制 |
| **A6** | `miniprogram` 字段在测试号下生效吗？ | 走中转页小程序码，体验略降但可用 |

---

## 十四、拆除计划（产品化前必做）

> **wxpush 是脚手架，不是房子。房子盖好了，脚手架必须拆。**

拆除时**不应该改业务代码**，只关配置。为此设计了三道开关：

| 开关 | 位置 | 关闭后效果 |
| --- | --- | --- |
| `NOTIFY_MP_ENABLED=false` | 后端环境变量 | `notify.service.ts` 直接跳过通道 ① |
| 清空 `MP_ACCOUNT_APPID` / `MP_ACCOUNT_SECRET` | 后端环境变量 | 客户端拿到空凭据 → `skipped`，通道 ① 自然失效 |
| 清空 `users.mp_openid` | 数据迁移 | 无 openid → 不走通道 ① |

> ⚠️ v1.1.0 起**没有「删除 Worker」这一道开关了** —— Worker 已经不在链路上。
> 拆完业务代码同样一行不用改，但**控制台清理是另一回事**，见下面的清单。

**拆除检查清单：**

- [ ] 后端 `NOTIFY_MP_ENABLED` 置为 `false`
- [ ] 删除云托管环境变量 `MP_ACCOUNT_APPID` / `MP_ACCOUNT_SECRET`
- [ ] **清理线上 Cloudflare Worker**（`pusher.youngqluol.workers.dev` 那个）：`wrangler delete` 或控制台删除，
      它已经没人调了，留着等于在公网挂一个「知道你的模板 ID 和 appid」的空转接口
- [x] ~~删除仓库里的 `wxpush/` 目录~~ **2026-11-12 已删代码与配置**（`index.js` / `wrangler.toml` / `.env.example` / `readme.md` / `LICENSE`），
      目录里只剩 `assets/miniprogram-code.png` —— 等 `MP_QRCODE_URL` 上传完就可以连它一起删
- [ ] 移除测试号「接口配置信息」里的回调 URL
- [ ] 数据迁移：`UPDATE users SET mp_openid = NULL, mp_bound_at = NULL`
- [ ] 小程序端隐藏「微信提醒」绑定入口
- [ ] 确认订阅消息通道已能独立支撑（或已找到替代方案）
- [ ] 更新 PRD 6.5.7 的状态

> **在完成替代方案之前不要拆。** 拆了之后推送能力会退回到「一次性订阅」，这比有公众号模板消息差得多。

---

## 十五、风险与未验证项

| # | 项 | 等级 | 处置 |
| --- | --- | --- | --- |
| 1 | `miniprogram` 字段是否生效（A6） | 🟡 | M0 实测，不成立则走小程序码 |
| 2 | 小程序码长按识别稳定性 | 🟢 | 微信原生能力，稳定 |
| 3 | 测试号被回收 | 🟡 | ~~Worker 保活心跳~~ **v1.1.0 起保活没了**：Worker 拆除后没人定期打测试号接口。当前缓解是家人日常使用本身会触发回调和模板消息；**兜底仍是站内消息**。若哪天通道① 集体 `43004`/`40001`，第一反应是去测试号后台确认号还在，重新扫码登录即可（appid/secret 不变，环境变量不用动） |
| 4 | 测试号用户数上限 | 🟡 | 家人规模（≤8 人）远低于上限 |
| 5 | 用户不愿关注测试号 | 🟡 | 不做强制，未绑定自动降级 |
| 6 | 上架审核 | 🔴 | **提审时不应出现测试号相关内容**；建议 V0.1 先不上架，自己家先用 |
| 7 | 测试号消息回调的稳定性 | 🟡 | 保底方案：手工录入 openid |
| 8 | **`*.workers.dev` 在中国大陆被 DNS 污染** | ✅ **已消除（v1.1.0，2026-11-12）** | **当时的实测**：本机 `dig` 把 `pusher.youngqluol.workers.dev` 解析到 `108.160.165.141`（Dropbox 的地址，典型污染特征，且每次查询返回的 IP 都不一样），无代理 `curl` **直接超时**；同一台机器上 `api.weixin.qq.com`（404 = 通）和 `www.cloudflare.com`（200）都正常 —— **封的是 `*.workers.dev` 这个共享域名，不是 Cloudflare**。<br>**证实过程**：家人绑定完成后（`mp_openid` 有值），云托管运行日志里通道① 全部是 `errcode=undefined errmsg=fetch failed`，**一个微信 errcode 都没有** → 请求根本没出容器，第二道墙成立。<br>**处置**：没有走「给 Worker 绑自定义域名」，而是**删掉 Worker、后端直连微信 API**（见 §三、§十四）。`api.weixin.qq.com` 从容器可达已被登录链路证明（`docs/06` §5.17）。 |
| 9 | **公众号「IP 白名单」撞上云托管** | 🟡 | **直连方案特有**的新风险，Worker 方案没有（那时出网 IP 是 Cloudflare 的）。云托管出口 IP 不固定，一旦在公众号后台填了白名单就是 `40164` 全灭。<br>**处置**：后台**把 IP 白名单留空**（默认就是空）。测试号没有白名单设置项，正式号转过来时记得这一条。 |
| 10 | **中转页用的是云托管默认域名** | 🟡 | `MP_LANDING_URL` 指向 `...tcloudbase.com` 那个默认域名：它**没备案**、且属于「仅接口测试」性质的默认分配域名，微信网页里能否长期正常打开没有保证。<br>**处置**：家庭自用阶段可接受（打不开也只是看不到兜底页，`miniprogram` 生效时根本用不到它）。真出问题就给它挂一个自有域名。 |

---

## 附：文件清单

| 文件 | 作用 |
| --- | --- |
| `wxpush/index.js` | 🕰 Worker 代码 —— **已于 2026-11-12 从仓库删除**（v1.1.0 起不在链路上） |
| `wxpush/wrangler.toml` | 🕰 Worker 部署配置（含保活 Cron）—— 同上，已删除 |
| `wxpush/.env.example` | 🕰 Worker 环境变量模板 —— 同上，已删除；现凭据只走 `server/.env.example` |
| `wxpush/readme.md` | 🕰 上游原版文档 —— 同上，已删除（要看原始设计去上游仓库，别在本文档里找） |
| `wxpush/assets/miniprogram-code.png` | 小程序码原图 —— `wxpush/` 现在**只剩它**，`MP_QRCODE_URL` 靠它（待上传） |
| `tools/test-mp-template.mjs` | 通道① 连通性测试脚本（直连微信 API，不经后端） |
| `server/src/modules/notify/mp-account.client.ts` | 通道① 客户端：`stable_token` + `message/template/send` |
| `server/src/modules/notify/landing.controller.ts` | 中转页 `GET /api/skin`（后端渲染） |
| `db/schema.sql` | 已新增 `users.mp_openid` / `mp_bound_at` |
| `server/src/modules/notify/` | 后端通知模块 |
| `server/src/modules/wechat/mp-callback.controller.ts` | 测试号消息回调 |

---

**相关文档：** PRD 6.5「消息送达机制」、`docs/01-技术架构与技术选型.md`、`docs/02-API接口设计.md`
