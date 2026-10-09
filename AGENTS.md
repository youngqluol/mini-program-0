# AGENTS.md

给在此仓库中工作的 AI 编码代理的指南。人类贡献者同样适用。

**本文件是「代理行为约束」，不是产品文档。** 产品细节去读 `docs/产品需求文档.md` 与 `docs/`。
当本文件与代码/文档冲突时，**以代码和 `docs/` 为准**，并在同一次改动中修正本文件。

---

## 0. 铁律（优先级高于本文其他所有约定）

### 0.1 只提醒，不监督

**这是产品的第一性原理，任何功能设计都不能违反。** 具体表现：

- 没有催办、没有逾期标记、没有超时提醒、没有强制确认
- 没有「待办事项」「任务逾期」「绩效」「KPI」「审批」「工作流」这类词
- 通知只是「告诉你一声」，不是「要求你做到」
- 给发起人的反馈是「阿爸已经搞定啦 ❤️」，不是「任务已完成」

写任何涉及任务的代码前，先问自己：**这会不会让家人觉得被监视了？** 会，就不要写。

### 0.2 功能只减不增

V0.1 阶段的任何新想法，**写进 `docs/未来需求池.md`，不要写进代码**。
不要「顺手实现」，不要「为了以后可能用到」做抽象。先让它跑起来。

### 0.3 任何改动都必须落到仓库文件

只存在于对话、临时脚本或某个人脑子里的改动，视为**未完成**。

改动类型与必须同步更新的文件的对应关系见 **第 10 节**。

自查标准：**一个只读仓库文件的新人，能否完整复现并理解这次改动？** 不能，就说明记录缺失。

### 0.4 涉及数据权限的过滤必须在服务端做

**前端只做展示，不做安全。** 任何「这个数据该不该给这个人看」的判断，
都必须在后端 service 层完成，前端不得依赖「不请求就不显示」。

---

## 1. 项目速览

**家有小事** —— 面向家庭成员的轻量事务协作微信小程序。

不追求功能多，只解决三件事：**重要的事不会忘记 / 事情有人负责 / 纠结的事不再纠结。**

四个模块：

```text
🔔 叮一下  ——  别忘了
🎯 派个活  ——  有人做
🍽️ 吃啥呢  ——  别纠结
📖 留个念  ——  值得记
```

核心闭环：

```text
🍽️ 吃啥呢  →  决定吃什么  →  🎯 派活  →  指定家人
     ↓
🔔 叮一下  →  对方收到  →  ✓ 完成  →  ✨ 搞定啦  →  📖 留个念
```

阶段：个人开发者 MVP → 家庭真实使用 → 持续迭代。
当前进度：**M0 准备就绪**（文档已完成，账号资质与推送通道假设待验证）。

---

## 2. 技术栈（已确定，勿再变更）

| 层次 | 选型 |
| --- | --- |
| 小程序端 | 原生微信小程序 + TypeScript |
| 后端 | **NestJS 11**（Node **22 LTS**）+ **Prisma 6** |
| 数据库 | 微信云托管 **MySQL 8.0**（11 张表） |
| 缓存 | 腾讯云 **Redis**（内网调用） |
| 存储 | 云开发云存储 / COS |
| 部署 | 微信云托管（容器，自定义 Dockerfile） |
| 推送 | **四通道降级**：公众号模板消息（wxpush）→ 小程序订阅消息 → 站内消息 → 首页 |

> ⚠️ **Node 20 已于 2026-04-30 EOL，不要再用。** 全部用 Node 22 LTS。
> ⚠️ **小程序端是原生开发，不是 uni-app / Taro。** 不要引入跨端框架。
> ⚠️ **包管理只允许 pnpm**，禁止 npm / yarn。

**为什么后端选 NestJS？** 前后端同语言，`packages/shared` 里的类型改一处、两边编译期同时报错；
一个业务域一个 module，天然匹配领域划分；个人开发者最贵的是调试时间，而不是服务器钱。
完整对比见 `docs/01-技术架构与技术选型.md` §3.0。

---

## 3. 仓库结构（Monorepo）

```text
mini-program-0/
├── docs/                     开发文档（先读 docs/README.md）
│   ├── README.md             ★ 索引 + 文档权威性说明
│   ├── 产品需求文档.md        ★ 产品需求唯一权威来源
│   ├── 核心数据模型与业务流程.md
│   ├── MySQL 数据库设计.md
│   └── 01 ~ 08               架构 / API / 页面 / 工程规范 / 开发计划 / 上线准备 / 视觉 / wxpush
├── db/
│   └── schema.sql            11 张表的可执行 DDL（数据库唯一真相）
├── packages/
│   └── shared/               前后端共享枚举与类型（enums.ts 是枚举唯一来源）
├── miniprogram/              小程序端
├── server/                   后端（NestJS + Prisma）
├── wxpush/                   推送 Worker（Cloudflare Workers，V0.1 验证期）
├── tools/                    check-*.mjs 静态校验 / smoke-m*.mjs 端到端冒烟 / test-*.mjs
├── prototypes/prototype.html 可视化原型（浏览器直接打开）
├── ui/风格参考/               视觉风格参考图
├── docker-compose.yml        本地 MySQL + Redis
└── pnpm-workspace.yaml
```

**为什么用 monorepo：** 接口出入参类型只写一遍（`packages/shared`），
后端改字段时小程序端编译期就能报错，避免联调时才发现对不上。

> `@jyss/shared` 直接引用源码，**不需要构建产物**（`paths` 映射 `@shared/*`）。

---

## 4. 技术约定（硬性）

### 4.1 命名

| 对象 | 规范 | 示例 |
| --- | --- | --- |
| 数据库表 | `snake_case` 复数 | `family_members` |
| 数据库字段 | `snake_case` | `assignee_member_id` |
| 接口路径 | `kebab-case` | `/family-things` |
| 接口字段 | `camelCase` | `assigneeMemberId` |
| TS 变量/函数 | `camelCase` | `getTodayThings()` |
| TS 类/类型 | `PascalCase` | `CreateThingDto` |
| TS 常量 | `SCREAMING_SNAKE` | `MAX_PAGE_SIZE` |
| WXSS 类名 / 目录 | `kebab-case` | `.thing-card` / `pages/thing/detail` |

**接口层永远不出现下划线字段。** `snake_case` → `camelCase` 的转换只在 Prisma `@map` / `@@map` 层做一次。

### 4.2 枚举

**唯一来源：`packages/shared/src/enums.ts`。** 每个数值必须与 `db/schema.sql` 的 COMMENT 严格一致。

**数据库存数字（TINYINT），接口传字符串。** 前端写 `status === ThingStatus.PENDING`，不要写 `status === 1`。

> ⚠️ **易错点：可见性枚举有两套。**
> `family_things.visibility` 用 `ThingVisibility`（FAMILY / RELATED）；
> `family_memories.visibility` 用 `MemoryVisibility`（FAMILY / PRIVATE）。
> 早期文档把它们写成了一个，已修正。

### 4.3 时间

**存储层统一 UTC，北京时间只在接口层格式化一次。**

⚠️ 这一条在 v0.2.2 修正过，早期文档写的「`DATABASE_URL` 必须带 `timezone=+08:00`」是**错的**：
Prisma 的 MySQL 连接器**不支持**该参数（feature request `prisma/orm#29517` 至今 open，会被静默忽略），
它固定按 UTC 读写 DATETIME。跟 ORM 对抗不如顺着它来：

| 层 | 约定 |
| --- | --- |
| 存储 | **UTC**（Prisma 原生行为，写进去再读出来自洽，不会差 8 小时） |
| MySQL 会话时区 | `+00:00`（不是 +08:00）—— 否则 `CURRENT_TIMESTAMP` 产出北京时间，读回来就差 8 小时 |
| 时间戳来源 | 一律用 Prisma 侧默认值（`@default(now())` / `@updatedAt`），**不用** `dbgenerated("CURRENT_TIMESTAMP")` |
| Node 进程 | `TZ=Asia/Shanghai`（这样对 Date 调本地 getter 得到的就是北京时间） |
| 接口输出 | 统一走 `server/src/common/serialize/beijing-time.ts` |

**用户永远只看到北京时间，业务代码里不做任何时区换算。**
完整推导见 `docs/01` §4.3 与 `server/prisma/schema.prisma` 的 datasource 注释。

> 前端传入时间统一为 `"YYYY-MM-DD HH:mm:ss"` 字符串，用 `parseBeijingDateTime()` 解析
> （它显式拼 `+08:00`，不要用 `new Date(str)` —— 那会按运行环境时区解析）。

### 4.4 删除

**全库不做物理 DELETE，一律状态位逻辑删除**（`status` / `enabled` / `deleted_at`）。
「删了但历史要留着」是本项目的常态（例如菜单可删，但「9 月 26 日晚餐吃了番茄炒蛋」必须永久保留）。

> ⚠️ **唯一的例外：`notification_logs`。**
> 注销账号时，这个用户的收件箱行是**物理删除**的
> （`server/src/modules/auth/account.service.ts` 的 `clearInbox()`）。
> 理由：那张表**整张都是「发给这个人的消息」**（标题 / 正文 / 送达状态），
> 没有一丝「全家的历史」在里面 —— 留它就等于「注销了但收件箱还在」，
> 与 PRD §32「30 天内清除其个人数据」直接冲突。
> **这是有意为之，不要当成漏改去「修正」它。** 新增物理删除前先想清楚：
> 这一行是「个人数据」还是「家庭历史」？后者一律不许删。

### 4.5 密钥

**禁止硬编码任何密钥 / host / appid。** 全部走环境变量：

- 后端 → `server/.env.example`（模板）+ 云托管控制台（生产值）
- Worker → `wxpush/.env.example`（模板）+ `wrangler secret`（生产值）

### 4.6 代码风格

- **禁止 `any`**（需要时用 `unknown` + 类型收窄）
- **禁止 `console.log`**，用 NestJS `Logger`（后端）/ 自研 `logger`（小程序端）
- 函数长度尽量 ≤ 50 行，单个文件 ≤ 400 行
- 格式由 Prettier 决定，不依赖人工审美

---

## 5. 后端约定（NestJS）

### 5.1 分层职责

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| Controller | 参数接收、调用 service、返回结果 | 写业务逻辑、直接访问 Prisma |
| Service | 业务逻辑、事务、权限判断 | 直接读写 req/res |
| Repository | 数据访问（Prisma 封装） | 写业务分支 |
| DTO | 出入参定义 + class-validator 校验 | 包含业务方法 |

**一个业务域一个 module**，module 内自带 controller / service / dto / repository。
**不做「一个巨型 service」。**

### 5.2 统一响应体

`code === 0` 表示成功，`data` 承载业务数据；非 0 表示失败，`message` 是给用户看的文案。
错误码定义见 `docs/02-API接口设计.md`。**错误码是接口契约，改动必须同步文档。**

### 5.3 鉴权

- 用户接口：JWT（`jwt.guard.ts` + `family-member.guard.ts`）
- 内部接口（定时任务、手工绑定）：`X-Internal-Secret`（`internal-secret.guard.ts`）

---

## 6. 小程序端约定

- **页面里禁止直接调 `wx.request`**，只能走 `services/request.ts`。这是硬性规范，否则错误处理会散落各处。
- **页面里禁止做数据权限过滤**（见铁律 0.4）。
- 全局样式变量唯一来源是 `docs/07-视觉设计规范.md` §11.1。
  > ⚠️ 早期版本的暖橙令牌（`#FF8A4C` / `#FFF7F0`）**已废弃**，现用「柔光粉彩」（主色 `#FF9DB4 → #FFB59B`、背景 `#FDF6F7`）。
- Tab 结构是 **4 个**：家里 / 吃啥呢 / 留个念 / 我的。
  「叮一下」「派活」是**动作**，不是 Tab，作为首页悬浮入口。
- 页面编号 P01–P22 与 `docs/03-页面原型与交互流程.md` 一一对应。

### 6.1 文案纪律（重要）

产品文案必须有**人情味**：

```text
✅ 阿妈，有个活儿到你啦～
✅ 有空的时候弄一下就行 😊
✅ 阿爸已经搞定啦 ❤️

❌ 您有任务待完成
❌ 任务已逾期
❌ 待办事项
```

**用户界面里禁止出现这些词**：绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号。
用户只需要知道「微信提醒 开 / 关」，不需要知道背后发生了什么。

---

## 7. 数据库约定

- **`db/schema.sql` 是数据库的唯一真相。** 其余文档只做解释，冲突时以它为准。
- 所有 DDL 均为 `IF NOT EXISTS`，可重复执行。
- 字段必须有 COMMENT，枚举取值在 COMMENT 里写全。
- 索引命名：`uk_`（唯一）/ `idx_`（普通）；命名要能看出用途（`idx_family_status`）。
- **系统菜谱不入库**，写死在 `miniprogram/config/default-menu.ts`；`menu_items` 只存家庭自定义菜。

---

## 8. 推送通道约定

**四通道按优先级降级，任何一环失败都自动落到下一环：**

```text
① 公众号模板消息（wxpush）  ← 无次数限制，但用户需先绑定
        ↓ 失败/未绑定
② 小程序订阅消息（一次性）  ← 需用户授权，一次授权一条
        ↓ 失败/无额度
③ 站内消息                  ← 永不失败，进「我的 · 消息中心」
        ↓
④ 首页「今天家里有什么事」  ← 产品承诺底线
```

**必须遵守：**

- 推送失败**不得阻塞主流程**（必须降级 + 写日志）
- `notification_logs` **无条件写入**（站内兜底是产品承诺，不能省）
- 所有推送**必须走 `notify.service.ts`**，禁止绕过它直接调 wxpush / 微信 API
- 新写的推送逻辑必须**不依赖** `NOTIFY_MP_ENABLED=true` 也能正常工作
- `NOTIFY_MP_ENABLED` 是 wxpush 通道总开关；产品化拆除时置为 `false`，**业务代码一行都不用改**
- 完整方案见 `docs/08-wxpush推送集成方案.md`

> ⚠️ **个人主体限制（不要忘记）：** URL Link（`wxaurl.cn`）官方只对**非个人主体**小程序开放，个人主体不可用。
> 中转页跳回小程序**唯一可靠手段是小程序码长按识别**。

---

## 9. 常用命令

```bash
# 依赖
pnpm install

# 本地数据库（MySQL 8.0 + Redis 7，首次自动执行 db/schema.sql）
pnpm run db:up        # 起库
pnpm run db:down      # 停库（保留数据）
pnpm run db:reset     # 停库并清空（改了 schema.sql 后必须用它重建）
pnpm run db:logs      # 看 MySQL 日志

# 后端
pnpm run dev                              # 起后端 http://localhost:3000
cd server && pnpm run prisma:push         # 同步表结构到库
cd server && pnpm run prisma:generate     # 重新生成 Prisma Client

# 质量
pnpm run typecheck                        # 全仓类型检查
pnpm run format                           # Prettier 格式化
node tools/check-ts.mjs                   # TS 语法校验（无需装 typescript）
node tools/check-links.mjs                # Markdown 内部链接校验（文档移动后必跑）
node tools/check-docker.mjs               # Docker 构建上下文（改了 Dockerfile / .dockerignore 必跑）
pnpm run check                            # 以上全部 + 小程序端自查 + 展示模型断言 + 上传链路自检

# 端到端冒烟（打**真实库**，需要先起后端；每个脚本自建/自清夹具，可重复跑）
pnpm run smoke:m1                         # 认证 + 家庭域（83 项）
pnpm run smoke:m2                         # 小事 / 提醒 / 通知（215 项）
pnpm run smoke:m3                         # 吃啥呢（180 项）
pnpm run smoke:m4                         # 留个念（76 项）
pnpm run smoke:m5                         # 注销账号（42 项）

# 推送
cd wxpush && wrangler login && wrangler deploy
node tools/test-wxpush.mjs                # 推送连通性测试
```

> ⚠️ MySQL 的 initdb 脚本**只在数据卷首次创建时执行**。改了 `db/schema.sql` 必须 `db:reset`。

---

## 10. 文档同步规则（改动 → 更新哪个文件）

| 变化 | 必须同步更新 |
| --- | --- |
| 新增 / 修改 / 删除接口 | `docs/02-API接口设计.md` |
| 新增 / 修改页面、交互、跳转 | `docs/03-页面原型与交互流程.md` + `prototypes/prototype.html` |
| 新增 / 修改表、字段、枚举数值 | `db/schema.sql` + `packages/shared/src/enums.ts` |
| 目录结构、文件职责、命名规范变化 | `docs/04-工程规范与目录结构.md` + 本文件 §3/§4 |
| 任务拆分、里程碑变化 | `docs/05-开发计划与任务拆分.md` |
| 推送通道逻辑变化 | `docs/08-wxpush推送集成方案.md`（必要时同步 `docs/01` §5） |
| 视觉令牌、组件样式变化 | `docs/07-视觉设计规范.md` |
| 环境变量增删 | `server/.env.example` / `wxpush/.env.example` + `docs/04` §7 |
| 部署配置变化（`server/Dockerfile` / `.dockerignore` / 云托管参数） | `docs/04` §九 + `docs/06` §五（`.dockerignore` **必须在仓库根**，见 §九） |
| 新增或推翻产品决策 | `docs/产品需求文档.md`（并在变更记录里写明原因） |
| 冒出超出 V0.1 的想法 | `docs/未来需求池.md`（**不要写进代码**） |

**「某个待办被完成了」时，必须回到对应文档把它从 ⬜ 改成 ✅ 或删除该条目**，不要留下过期描述。

> **移动或重命名文档后，必须跑 `node tools/check-links.mjs`。**
> Markdown 的相对链接失效时不会报错，只有这个脚本能发现。

---

## 11. 不要做的事

```text
❌ 不要用 npm / yarn 装依赖
❌ 不要引入 uni-app / Taro / 任何跨端框架
❌ 不要用 Node 20（已 EOL）
❌ 不要在页面里直接调 wx.request
❌ 不要在前端做权限过滤
❌ 不要硬编码密钥
❌ 不要物理删除数据
❌ 不要绕过 notify.service.ts 直接发消息
❌ 不要写「催办 / 逾期 / 待办 / 绩效 / 审批」这类词
❌ 不要「顺手」实现未来需求池里的东西
❌ 不要把新想法直接写进代码——先记进未来需求池
```

---

## 12. 提交规范

```text
<type>(<scope>): <subject>

type:  feat | fix | docs | style | refactor | perf | test | chore
scope: auth | family | thing | reminder | menu | memory | upload | notify | mp | wxpush | db
```

示例：

```text
feat(thing): 支持创建派活时同时挂定时提醒
fix(reminder): 修复重复提醒计算下一次时间时区偏移问题
docs(api): 补充订阅额度上报接口
feat(mp): 微信提醒绑定码生成与轮询
chore(db): 初始化 11 张核心表
```

分支：`main`（可上线）+ `feat/*` / `fix/*` / `chore/*`。个人项目可省 `develop`。

---

## 13. 提交前自查

- [ ] 是否违反了「只提醒，不监督」？
- [ ] 接口出入参是否与 `docs/02` 一致？不一致是否已同步？
- [ ] 是否有硬编码的密钥 / host / appid？
- [ ] 数据权限过滤是否在服务端完成？
- [ ] 新增/修改的接口是否有 DTO 校验？
- [ ] 涉及时间的地方是否用了北京时间？
- [ ] 是否写了 `console.log` 或 `any`？
- [ ] 是否调用了 `wx.request`（小程序端）/ 绕过 `notify.service.ts`（后端）？
- [ ] 用户可见文案里是否出现了禁用词（绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号）？
- [ ] 改了 `server/Dockerfile` 或 `.dockerignore` 是否跑过 `node tools/check-docker.mjs`？
- [ ] **第 10 节的文档同步是否都做了？**
