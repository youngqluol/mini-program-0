# 家有小事 · 开发文档索引

> **家有小事，不必放心上。**
>
> 面向家庭成员的轻量事务协作小程序。
> 不追求功能多，只解决三件事：**重要的事不会忘记 / 事情有人负责 / 纠结的事不再纠结。**

---

## 一、文档地图

### 产品与设计

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [产品需求文档](产品需求文档.md) | 产品定位、理念、四大模块、MVP 边界、版本路线 | **v0.2.3** ✅ |
| [核心数据模型与业务流程](核心数据模型与业务流程.md) | 领域模型、小事/提醒关系、权限设计、业务闭环 | **v0.2.2** ✅ |
| [MySQL 数据库设计](MySQL 数据库设计.md) | 11 张核心表的字段与关系设计 | **v0.2.2** ✅ |
| [未来需求池](未来需求池.md) | 开发中冒出的想法，一律记这里，不进 V0.1 | — |

### 开发文档

| 文档 | 内容 |
| --- | --- |
| [01 技术架构与技术选型](01-技术架构与技术选型.md) | 技术栈、整体架构、鉴权、定时任务、**消息送达四通道**、成本预估 |
| [02 API 接口设计](02-API接口设计.md) | **53 个接口**的完整定义：路径、入参、出参、错误码、权限 |
| [03 页面原型与交互流程](03-页面原型与交互流程.md) | **21 个页面**（4 Tab）的布局、交互、跳转关系、文案规范 |
| [04 工程规范与目录结构](04-工程规范与目录结构.md) | Monorepo 结构、前后端目录、命名规范、Git 策略、本地环境 |
| [05 开发计划与任务拆分](05-开发计划与任务拆分.md) | M0–M5 里程碑、**125 个任务**、**技术假设验证**、关键路径、开发纪律 |
| [06 上线前环境准备清单](06-上线前环境准备清单.md) | 账号资质、类目、**推送通道准备**、隐私合规、云托管、提审自查、**wxpush 处置** |
| [07 视觉设计规范](07-视觉设计规范.md) | **v1.1 柔光粉彩**：色彩令牌、组件尺寸、插画规范、**中转页规范**、WXSS 变量文件 |
| [08 wxpush 推送集成方案](08-wxpush推送集成方案.md) | **V0.1 主力推送通道**：架构、跳转降级、openid 绑定、部署步骤、后端对接、**通道二订阅消息**、拆除计划 |

**各篇当前版本（版本按篇独立，改哪篇就只升哪篇）：**

| 篇 | 版本 | 篇 | 版本 |
| --- | --- | --- | --- |
| 产品需求文档 | **v0.2.3** | 05 开发计划 | **v0.2.5** |
| 01 技术架构 | **v0.2.3** | 06 环境准备 | **v0.2.3** |
| 02 API 设计 | **v0.2.3** | 07 视觉规范 | v1.0 |
| 03 页面原型 | v0.2.1 | 08 推送集成 | **v1.0.2** |
| 04 工程规范 | **v0.2.7** | 核心数据模型 / MySQL 设计 | **v0.2.2** |

### 配套资源

| 文件 | 内容 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | **AI 编码代理工作守则**：铁律、技术约定、文档同步规则、不要做的事 |
| [db/schema.sql](../db/schema.sql) | 11 张表的可执行建表 DDL（系统菜谱已改为代码常量，不再入库） |
| [packages/shared/](../packages/shared/) | 前后端共享的枚举与类型（`enums.ts` 是枚举唯一来源） |
| [prototypes/prototype.html](../prototypes/prototype.html) | 10 屏核心页面的可视化原型 + 色彩系统 + 组件库（浏览器直接打开） |
| [wxpush/](../wxpush/) | 推送 Worker 代码 + 部署配置（Cloudflare Workers）；基于上游 MIT 项目改造，见 `wxpush/LICENSE` |
| [tools/](../tools/) | `check-ts.mjs`（TS 语法校验）、`check-links.mjs`（MD 链接校验）、`check-shared.mjs`（`@shared` 镜像漂移校验）、`check-mp.mjs`（小程序端静态自查）、`smoke-m1.mjs`（M1 认证 + 家庭域冒烟）、`smoke-m2-things.mjs`（M2 小事域冒烟）、`test-wxpush.mjs`（通道一连通性）、`probe-subscribe.mjs`（通道二连通性） |
| [ui/风格参考/](../ui/风格参考/) | 视觉风格参考图（仅参考样式，功能与人群定位无关） |

---

## 一之二、文档权威性 ⭐

> **一份信息只有一个权威来源。** 当两份文档说法不一致时，按下表判断谁说了算。

| 话题 | 权威文档 | 说明 |
| --- | --- | --- |
| **产品是什么 / 为什么这么做** | `产品需求文档.md` | 一切产品决策的最终依据 |
| 具体字段、表结构、枚举数值 | `db/schema.sql` | **DDL 是数据库的唯一真相**；其余文档只做解释 |
| 前后端共用的类型与枚举 | `packages/shared/src/enums.ts` | 代码即文档，编译期强制一致 |
| 接口路径 / 入参 / 出参 / 错误码 | `docs/02-API接口设计.md` | 接口层的唯一依据 |
| 页面结构与交互 | `docs/03-页面原型与交互流程.md` | 页面编号 P01–P21 的唯一来源 |
| 视觉样式 | `docs/07-视觉设计规范.md` | 03 文档第七章只是摘要，以 07 为准 |
| 目录结构 / 命名 / Git 规范 | `docs/04-工程规范与目录结构.md` | — |
| 做什么、按什么顺序做 | `docs/05-开发计划与任务拆分.md` | 任务编号的唯一来源 |
| 推送通道的技术细节 | `docs/08-wxpush推送集成方案.md` | — |
| **通知模板的字段名与文案** | `notify.templates.ts`（公众号）+ `subscribe.templates.ts`（订阅消息） | 代码是唯一来源；docs/08 §10 只是镜像。`cd server && pnpm run check:templates` 校验 |
| 环境变量清单 | `server/.env.example` + `wxpush/.env.example` | 代码级模板，比文档更可信 |
| 中转页样式 | `docs/07` 第十章 | 实现位置在 `wxpush/index.js` 的 `/skin` |

**已消除的历史矛盾（v0.2.1 修复）：**

| 曾经的问题 | 修复 |
| --- | --- |
| docs/03 是 3 Tab，PRD 是 4 Tab | docs/03 与原型统一改为 4 Tab |
| docs/05 说「schema.sql 已含 20 条菜谱」，实际已改为代码常量 | 已修正 |
| docs/01 说「必须消耗订阅额度」，未提 wxpush | 已重写为四通道降级 |
| 可见性枚举被写成一个（实际是 `ThingVisibility` / `MemoryVisibility` 两套） | 已在 docs/02、docs/04、enums.ts 统一 |
| 多处章节引用编号错误（如「第二十一节」实为第二十六章） | 已修正 |
| 早期文档写「Node 20 LTS」，该版本已 EOL | 全部改为 Node 22 LTS |
| 两份 v0.1 设计文档与现状不符 | 已更新为 v0.2.1 |
| 产品/数据/数据库三份文档散在仓库根目录 | 已移入 `docs/`，并去掉过期的 ` v0.1` 文件名后缀 |
| **根目录 `AGENTS.md` 内容是另一个无关项目（ShellQuest / Vue3 + FastAPI）** | 已重写为《家有小事》的 AI 代理工作守则 |

**已消除的历史矛盾（v0.2.2 修复）：**

| 曾经的问题 | 修复 |
| --- | --- |
| **文档说「`DATABASE_URL` 必须带 `timezone=+08:00`，否则 Prisma 的 DATETIME 会差 8 小时」——这条是错的** | Prisma 的 MySQL 连接器**不支持**该参数（`prisma/orm#29517` 至今 open，会被静默忽略）。改为「**存储用 UTC，北京时间只在接口层格式化一次**」，并同步修 docs/01 §4.3、docs/04、docs/06、docs/08、PRD §27.5、`AGENTS.md` §4.3、`.env`、`.env.example`、`docker-compose.yml`、`db/schema.sql` |
| MySQL 容器时区设 `+08:00`，与 Prisma 的 UTC 读写口径冲突（`DEFAULT CURRENT_TIMESTAMP` 会差 8 小时） | 改为 `+00:00` |
| `miniprogram/app.json` 把 Tab 页注册成 `pages/menu/index/index`，与 docs/03 的页面路径表（`pages/menu/index`）不符 | 文件上移一层，app.json 与 docs/03、docs/04 统一 |
| docs/02 §3.10 的 `sharePath` 写成 `pages/join-family/index`，docs/03 是 `pages/family/join` | 已统一为 `pages/family/join` |
| `@shared` 的 `paths` 映射写成带 `.ts` 后缀，`nest build` 原样保留后缀，产物 `require(".../index.ts")` 直接 `MODULE_NOT_FOUND` | 去掉后缀，并在 docs/04 §一 写明这个坑 |
| Dockerfile 的 `CMD ["node","dist/main.js"]` 路径不存在（实际是 `dist/server/src/main.js`） | 已修正，并在 docs/04 §一 说明产物布局的成因 |

**v0.2.4 – v0.2.6 补充（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| docs/04 §6.2 的提交 scope 新增 `tools` | 仓库根 `tools/` 下的自查与冒烟脚本不属于任何业务模块，硬塞 `server` / `db` 会让「按 scope 找改动」失效 |
| docs/04 §5.1 与 §十 登记 `tools/smoke-m1.mjs` | 改完后端接口必须跑真实库端到端冒烟，「编译通过」不等于「链路通」 |
| docs/04 §5.2 补「小程序端不能引 `@shared` 的运行时值」 | 微信开发者工具的 TS 编译只做类型擦除、不解析 `tsconfig` 的 `paths`：`import type` 安全，`import { 值 }` 会运行时 `MODULE_NOT_FOUND`。常量在 `miniprogram/` 下做镜像，由 `tools/check-shared.mjs` 防漂移 |
| docs/04 §5.1 与 §十 登记 `tools/check-mp.mjs` | 小程序有一类错误编译不报、`tsc` 也不报，只在运行时安静失效：页面文件缺失、`bindtap` 绑错方法名、写了页面忘注册 |

**核心数据模型 / MySQL 设计 v0.2.2 补充（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| `thing_reminders` / `notification_logs` 各新增 `read_at` | 「已读」是**时刻**不是开关：`NULL` = 未读，非 `NULL` = 已读并记下时刻。单字段同时表达两件事，比 `is_read` + `read_at` 少一个字段、少一次自相矛盾。为 M2 的「叮一下收件箱」与「消息中心」的已读/未读数/全部已读做前置（docs/02 §5.4 / §9） |
| 勘误：`docs/MySQL 数据库设计.md` §八 `thing_reminders` 的 DDL 与 `db/schema.sql` 漂移 | 缺 `sent_count` / `next_remind_at`，索引名 `idx_remind_at_status` 实为 `idx_next_remind`。已按 schema.sql（DDL 唯一真相）对齐 |
| 四处同步：`db/schema.sql` → `server/prisma/schema.prisma` → `docs/MySQL 数据库设计.md` → `docs/核心数据模型与业务流程.md` | 本地库已 ALTER；`prisma migrate diff` 输出 `-- This is an empty migration.`；Prisma Client 重新生成后已验证 `readAt` 可查 |

**M2 小事域后端（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| 新增 `tools/smoke-m2-things.mjs`，107 项断言全通过 | 覆盖创建（TASK/REMINDER）、列表筛选、**服务端隐私过滤**、权限边界（创建人 / 执行人 / 创建者 / 同家无关成员 / 非成员）、状态机、完成回执落库、今日汇总 |
| 修掉 `common/serialize/json-safe.ts` 的**静默 bug** | 循环引用保护把「同一个对象被多处引用」误判成环，第二次出现时整个键被吞掉 —— 表现为「列表里只有第一条有称谓和头像」。改为只在**当前递归路径**上记 seen，回溯时 `delete`。编译不报、`tsc` 也不报，是冒烟脚本查出来的 |

**已消除的历史矛盾（v0.2.3 修复，2026-10-06）：**

| 曾经的问题 | 修复 |
| --- | --- |
| **docs/05 §2.3 的「测试号模板凭证」表把 3 个订阅消息模板 ID 标成了 `MP_TEMPLATE_*`** —— 两组 ID 场景相同、标题相同，肉眼分不出来，是「贴错槽位 → 47003」这类问题的直接来源 | 拆成两张表（小程序订阅消息 / 公众号测试号），各带模板编号；并补「两组 ID 绝对不能互换，判别方法是看字段名」的警告。同步修 docs/01 §5.3、docs/08 §9.4、docs/06 §3.2、`.env`、`.env.example` |
| 「订阅消息模板需要 1–3 个工作日审核」——**这条是错的** | 订阅消息模板是在**公共模板库**里挑现成的，选完即用，**没有审核环节**。已修 docs/06 §十、docs/05 §2.3、docs/README |
| docs/01 §5.2 写 Redis key 是 `subquota:{userId}:{templateId}`，代码里是 `subscribe:quota:{userId}:{templateId}` | 已统一为代码里的命名 |
| docs/README 的推送验证命令写了不存在的环境变量 `WXPUSH_OPENID` / `WXPUSH_TEMPLATE_ID` | 改为 `tools/test-wxpush.mjs` 实际读的 `RECEIVER`，并补上通道二的 `tools/probe-subscribe.mjs` |
| `docs/03` / `docs/05` 的验收清单把「订阅模板」列为待办 | 标 ✅ 并补当前进度表 |
| **用户可见 toast 里出现了禁用词「授权」**（`DELIVERY_TOAST[NO_QUOTA]` = 「微信限制需要补一次授权才能推给他」），违反 AGENTS.md §6 | 改为「已记下，{称谓}再开一次微信提醒就能收到」；PRD §6.5.6、docs/01 §5.2/§5.4、docs/02 §2.5/§5.3、docs/03 P08/P21、docs/05 M2-F14 一并统一 |
| `GET /auth/subscribe-quota` 的 `templateName` 直接回微信后台模板标题（「待办事项提醒」），含禁用词「待办事项」 | 加 `displayName`（派活提醒 / 叮一下提醒 / 完成回执），API 只回产品化的名字 |
| class-validator 的默认英文文案会漏给用户（`count must not be greater than 10`） | 新增 `common/pipes/validation.factory.ts`：无中文字符的校验文案统一换成通用中文提示 |
| **`server/prisma/schema.prisma` 里 `mpOpenid` / `inviteCode` 两个字段漏了 `@map`** —— `prisma db push` 想把列名改成 camelCase（`DROP COLUMN` + `ADD COLUMN`，丢数据），且运行时查询会 `Unknown column`，**会让邀请功能与公众号绑定全部失效** | 补齐 `@map("mp_openid")` / `@map("invite_code")`；在 docs/04 §3.2 补对齐自查命令（`prisma migrate diff` 必须输出 `-- This is an empty migration.`） |
| **pnpm 11 不再读 `package.json` 的 `pnpm` 字段**，`pnpm.onlyBuiltDependencies` 被静默忽略 → Prisma `postinstall` 不执行 → `@prisma/client` 不生成 → `prisma:push` 失败 | 白名单迁到 `pnpm-workspace.yaml` 的 `allowBuilds`；新增 docs/04 §3.3；移除 `package.json` 里已失效的字段 |

---

## 二、技术选型一句话总结

```text
原生微信小程序（TypeScript）
        ↓
微信云托管（NestJS + Prisma，Node 22 LTS）
        ↓
云托管 MySQL 8.0 + Redis（内网）
        ↓
云开发云存储（图片）
        ↓
推送通道（按优先级降级）：
   ① 公众号模板消息（wxpush / Cloudflare Workers）  ← V0.1 验证期主力
   ② 微信小程序订阅消息（一次性订阅）
   ③ 站内消息（永不失败）
   ④ 首页「今天家里有什么事」（产品承诺底线）
```

---

## 三、开发顺序

```text
M0 准备就绪   ✅ 文档与工程骨架已完成（账号资质仍待申请）
   ↓
M1 骨架贯通   ← 你在这里（后端已完成，小程序端待做）
   ↓
M2 核心闭环   派活 + 叮一下 + 完成   ★ 最关键
   ↓
M3 吃啥呢     随机决策 + 一键派活
   ↓
M4 留个念     图片发布 + 家庭时间线
   ↓
M5 上线       提审 → 发布 → 家人真机安装
```

---

## 四、现在最该做的事

> 对应 `docs/05` 的 M1 阶段。**后端 15 个任务已完成**，剩下小程序端 13 个。

### 1. 把本地环境跑起来（后端已就绪）

```bash
pnpm install                  # 安装依赖（Monorepo）
pnpm run db:up                # MySQL 8.0 + Redis 7，自动执行 db/schema.sql
pnpm --filter @jyss/server run prisma:push   # 同步 Prisma Schema 到库
pnpm dev                      # 起后端，监听 127.0.0.1:3000
```

起来后先打两个自检接口：

```bash
curl http://127.0.0.1:3000/api/health            # db / redis 是否 ok
curl http://127.0.0.1:3000/api/health/templates  # 三个公众号模板 ID 是否都配上了
```

> 停止：`pnpm run db:down`；重置（**会清空数据**）：`pnpm run db:reset`；看日志：`pnpm run db:logs`。
> ⚠️ 构建入口是 `dist/server/src/main.js`，**不是** `dist/main.js`，成因见 `docs/04` §一。

### 2. 用微信开发者工具预览小程序

用微信开发者工具「导入项目」指向 `miniprogram/` 目录（AppID 已写进 `project.config.json`）。
详细步骤见 [04 工程规范](04-工程规范与目录结构.md) §8.3。

### 3. 继续 M1 的小程序端

后端已经能回答这四件事，前端接上就是 M1 验收：

```text
POST /api/auth/login                        →  登录
POST /api/families                          →  建家
POST /api/families/{id}/invites             →  生成邀请码
POST /api/families/invites/{code}/accept    →  加入
```

### 4. 搭起推送通道（决定产品成不成立）

```bash
# ① 拿测试号：https://mp.weixin.qq.com/debug/cgi-bin/sandbox
# ② 建模板消息模板，记下模板 ID（内容直接粘贴：cd server && pnpm run check:templates）
# ③ 部署 Worker
cd wxpush && wrangler login && wrangler deploy
# ④ 配 4 个 secret（Cloudflare 控制台 Settings → Variables and Secrets，或 wrangler secret put）
#    API_TOKEN / WX_SECRET / WX_TEMPLATE_ID / WX_USERID
#    （WX_APPID / WX_BASE_URL / MP_* 等非敏感项走 wrangler.toml 的 [vars]）
# ⑤ 验证两条通道
RECEIVER=<你的公众号openid> WXPUSH_URL=... WXPUSH_TOKEN=... \
  node tools/test-wxpush.mjs                                  # 通道一：公众号模板消息
node tools/probe-subscribe.mjs <你的小程序openid> TASK        # 通道二：订阅消息
```

**这一步要回答两个决定性问题**（PRD 假设 A5 / A6）：

- 测试号模板消息能不能推到已关注用户？
- 消息点开能不能进小程序？

完整步骤见 [08 wxpush 推送集成方案](08-wxpush推送集成方案.md)。

> **另外别忘了（会卡审核，越早启动越好）：** 小程序服务类目（M0-14）、
> 《用户隐私保护指引》（M0-16）都有审核周期，等待期间正好用来做 M1 的小程序端。
> 完整清单见 [06 上线前环境准备清单](06-上线前环境准备清单.md) 第二章。
>
> ✅ **3 个订阅消息模板（M0-15）已完成** —— 是在公共模板库挑的现成模板，
> **没有审核环节**，原先预估的「1–3 个工作日审核」是错的。

---

## 五、三条不可动摇的纪律

```text
① 只提醒，不监督。
   没有催办、没有逾期处罚、没有强制确认。

② 家庭不是公司。
   没有审批、没有工作流、没有 KPI、没有权限矩阵。

③ 功能只减不增。
   V0.1 的任何新想法，写进《未来需求池》，不要写进代码。
```

---

## 六、核心业务闭环

```text
🍽️ 吃啥呢  →  决定吃什么  →  🎯 派活  →  指定家人
     ↓
🔔 叮一下  →  对方收到  →  ✓ 完成  →  ✨ 搞定啦  →  📖 留个念
```

这条链路跑通，「家有小事」在技术上就成立了。
剩下要验证的，是**你和老婆一个月后还在不在用**。
