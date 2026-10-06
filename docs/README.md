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
| 产品需求文档 | **v0.2.3** | 05 开发计划 | **v0.2.13** |
| 01 技术架构 | **v0.2.4** | 06 环境准备 | **v0.2.3** |
| 02 API 设计 | **v0.2.4** | 07 视觉规范 | v1.0 |
| 03 页面原型 | **v0.2.2** | 08 推送集成 | **v1.0.2** |
| 04 工程规范 | **v0.2.11** | 核心数据模型 / MySQL 设计 | **v0.2.2** |

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

**M2 提醒域 / 消息中心后端（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| `tools/smoke-m2-things.mjs` 扩到 176 项断言全通过 | 追加提醒域（nudge 两条路径、收件箱隔离、加/取消提醒的三种权限）与消息中心 / 我的称谓 |
| **消息中心是用户维度的，不带 `familyId`** | 数据源 `notification_logs` 是「发给某个人」的记录；同一个人可能在多个家庭里，所以 `GET /notifications` 三件套只认 `userId`，不走 `FamilyMemberGuard` |
| `channel` / `status` 是**给发起人看的** | 「到底叮到了没有」。数据库存 TINYINT、接口转字符串枚举，取不到值宁可抛错也不静默给错值 |
| 「我的称谓」放在 `families` 而非 `auth/me` | 称谓是**「人 × 家庭」维度**的：同一个人在「我们家」是「阿爸」，在「爸妈家」可能是「儿子」。离开 familyId 无法确定 |
| 记入 `docs/未来需求池.md`：**消息中心没有「单条已读」** | docs/02 §九 只定义了「全部已读」。字段（`read_at`）与实现都已就绪，缺的是接口契约 —— 点开一条不会清角标，只能靠「全部已读」。属产品待决，不私自加接口 |

**M2 内容安全（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| 新增 `ContentSecurityService`（`modules/wechat`） | 用户输入文本的**唯一放行策略点**：`risky` → 拦（40002）；`review` 与「判不了」→ 放行 + 记 warn。`msgSecCheck` 只回答「判成什么」，**「判不了时放不放行」是产品判断**，必须只写一遍，否则今天这里放行、明天那里拦截就成了随机行为 |
| **实测：个人主体小程序可以调用 `security.msgSecCheck`** | 没有 48001「api unauthorized」。正常文案回 `suggest=pass`；违规文案回 `suggest=risky` + `label=20006` |
| 新增 `tools/probe-seccheck.mjs` | 唯一能看到微信原始 `suggest` / `label` 的方式（服务端只会回一句 40002，看不到原因）。自动跳过冒烟夹具的假 openid |
| **fail-open 取舍** | 检测失败（网络 / 凭证 / 接口未开通）**放行**。理由：微信抖一下就让「阿妈，记得买牛奶」发不出去，家里人只会觉得小程序坏了；而 V0.1 是自用、没有公开传播面，违规内容实际风险为零。⚠️ **公开传播场景下要重新评估** |
| 检测超时设 3 秒（其他微信接口 8 秒） | 检测在「创建一条小事」的**同步路径**上，微信慢 8 秒用户就干等 8 秒 |
| 开关 `CONTENT_SECURITY_ENABLED`，**默认开** | 生产必须为 true（审核硬性要求）；本地关掉只是为了不被超时拖慢 |
| 冒烟脚本**验的是 fail-open 路径** | 夹具 openid 是假值 → 微信必回 40003 → 放行。所以冒烟只保证「不误拦、不阻塞」，验不了「违规被拦」。确认链路真被调用：看服务日志里的 `[ContentSecurityService] 内容安全判不了，放行` |

**M2 调度器（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| 新增 `scheduler` 模块（tick / Redis 锁 / 补偿） | 职责切干净：`scheduler` 只管「什么时候发、发哪些、别重复发」；「一条提醒怎么发、发完状态怎么变」全在 `ReminderService.fireDueReminder`，与用户点「叮一下」共用 `reminderCtx()`，所以两条路径的文案一定一致 |
| **`skipped` 与 `failed` 必须分开** | 「小事已完成 / 接收人已退出」是**正常跳过**。混在一起，失败率告警会被正常跳过污染，等于没有告警。docs/02 §10.1 补了 `skipped` / `locked` 两个字段 |
| **修正 docs/02 §10.2**：补偿扫的是 `FAILED` 而不是 `PENDING` | 提醒 FAILED 后 `next_remind_at` 被置 null（产品侧「不自动重试」），**tick 永远不会再碰它** —— 这才是真正的永久丢失。PENDING 残留只是「幽灵记录」，收尾成 FAILED 即可 |
| 补偿的两条硬约束 | ① **复用同一条日志**（`reuseLogId`）—— `notification_logs` 就是消息中心的数据源，新建会让用户看到两条重复通知；② **换 `client_msg_id`**（加 `-r1` 后缀）—— 它是**微信侧**的 24 小时去重键，原样重发会被微信直接拦掉 |
| 补偿只重建 `REMINDER` | 它的上下文能从 `thingId` 完整还原。派活 / 完成回执需要「是否迟到」「谁完成的」等额外上下文，重建成本高而残留概率极低 —— 遇到就跳过，**不猜** |
| `recurring-things`（重复**小事**生成实例）**未实现** | 归 M5-4。注意它与「重复**提醒**」是两件事，后者已由 tick 支持（发完自己算下一次） |

**M2 小程序端 · P08 叮一下（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| 新增 `pages/nudge/create`（M2-F4 / F5） | 叮谁 → 叮什么 → 什么时候叮。其余都是可选项 |
| **两条提交路径，不是一个接口** | 「现在就叮」走 `POST /reminders/nudge`，能拿到 `deliveryStatus`，发起人立刻知道「到底叮到了没有」；「定时叮」走 `POST /family-things`（type=REMINDER），到点由调度器下发，**当下拿不到送达结果**。所以成功文案必须不一样：前者说「已经叮到阿妈啦」，后者只能说「到点会提醒阿妈」——混用一句「发送成功」就是在承诺一件还没发生的事 |
| 新增 `miniprogram/constants/delivery.ts`（三档文案镜像） | `formatDeliveryToast` 是 `@shared` 的**运行时值**，小程序端不能引（只做类型擦除，不解析 tsconfig paths）。镜像 `DELIVERY_TOAST`，由 `check-shared.mjs` 防漂移 |
| `check-shared.mjs` 从「数字专用」扩成**可校验字符串映射** | 原来 `extract()` 写死 `Number(m[2])`。现在统一按字符串比对，同一个校验器既能管错误码也能管文案。**已实测校验器会失败**（改坏镜像验证过，不是假绿） |
| 首页两个大按钮接上真实路由 | `onNudge` / `onAssign` 此前是「这个功能正在做」的占位 toast |
| **M2-F14（`NO_QUOTA` 半屏补提醒引导）明确不做** | 它要调 `wx.requestSubscribeMessage`，需要**小程序侧的订阅模板 ID**，而模板 ID 只在服务端环境变量里，仓库中没有。退化为三档 toast，文案是准的。已记入 `docs/未来需求池.md` |
| 记入 `docs/未来需求池.md`：P08「常用短语」无接口 | docs/03 P08 要求「历史提醒标题 Top 5」，但 docs/02 里没有这个接口（`GET /family-things` 只有 `keyword` 过滤，没有聚合）。本次不渲染这一块 |

**M2 小程序端 · P09 派活创建页（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| 新增 `pages/task/create`（M2-F6） | 一屏问完六件事：干啥 / 派给谁 / 什么时候 / 重复 / 要不要叮一下 / 谁能看见。拆成多步会让「派个活」这件小事显得很重，而它本来只需要一句话 |
| 新增第 4 个共用组件 `repeat-picker` | P09 与 P08 都要「重复」，且含真实逻辑（规则要从基准时间推），所以抽出来 |
| **重复选项按 PRD 修正为「不重复 / 每周 / 每月」** | docs/03 的 P08 / P09 原稿写的是「每天 / 每周」，与 PRD §6.3 直接矛盾——那里明确把「每天」划到 V0.2（一年 365 次，订阅额度撑不住；高频重复实质接近「自动催办」），且 V0.1 是**支持每月**的。已改 docs/03 → v0.2.2 |
| **重复的周几 / 几号由「什么时候」推出，不单独再问一遍** | 用户已经说清了「周六 18:00」，再问「周几？」既啰嗦又制造两次回答不一致的可能。规则以「每周六 18:00」回显，一眼能核对 |
| `remindAt` 存**完整时间串**而非 `"HH:mm"` | 截止时间在凌晨时「提前 30 分钟」会落到**前一天**；只存时刻会把提醒丢到错误的日期上 |
| 「重复」与「叮一下」在未定时间时**一起置灰** | 没有 `dueAt` 就推不出「每周六几点」，也不知道提前多久提醒——不偷偷替用户选一个时间 |
| `repeat-picker` 的 `echo` 指纹 | 它的规则从 `baseAt` 推，基准时间一变必须主动重抛 `change`；而页面拿到后又 setData 回 `value` / `config` → observer 再跑一遍。两个方向叠加会互相触发，用指纹挡住自己那一轮 |
| `.prettierignore` 补 `*.wxml` | WXML 没有 prettier 解析器。不显式忽略的话，一旦被当参数传进来（如 `prettier --check "miniprogram/**/*"`）会报「No parser could be inferred」，看着像格式错误，其实是解析器缺失 |

**M2 小程序端 · 组件地基（2026-10-06）：**

| 变更 | 说明 |
| --- | --- |
| 新增三个共用组件：`member-picker` / `time-picker` / `thing-card` | 对应 M2-F7 / F8 / F12。**一律不读 store、不发请求** —— 页面决定「给谁选、拿什么数据」，组件只把「选了什么 / 点了什么」抛回去。组件一旦自己去查成员列表，就再也没法复用了（P08 要排除自己、P09 要把自己加进去，这个差别属于页面） |
| `thing-card` 不认识任何后端 DTO | 后端有 `ThingListItem` / `TodayTask` / `TodayReminder` 三种形状，字段名不同、语义相同。归一化收在 `utils/thing-view.ts` 一处，类型 emoji 与状态文案收在 `constants/thing.ts`。否则「要求时间怎么念」会在首页、列表、详情各写一遍，然后漂移成三种说法 |
| **卡片事件名不能叫 `tap`** | 自定义组件里 `triggerEvent('tap')` 会和原生 tap 冒泡撞车 —— 页面写 `bindtap` 会收到**两次**回调。改用 `click` + `complete` |
| `time-picker` 需要一个 `echo` 标记 | 页面拿到 `change` 后一般会 `setData` 回 `value`，observer 于是再跑一遍。没有这个标记就会出现：用户点「指定」→ 组件把日期默认成今天 → 值回到组件 → observer 按「日期是今天」判回「今天」，用户眼睁睁看着自己点的选择跳回去 |
| 归一化结果里 `isOverdue` / `hasReminder` 是**可选**字段 | 今日汇总没有这两个值。给「不知道」填 `false` 就是把未知说成「没晚」——宁可让字段缺省 |
| `tools/check-mp.mjs` 覆盖范围扩到组件 | 新增 ⑧ 组件四件套 + `Component(` + 绑定校验（含 `"component": true` 检查）、⑨ `usingComponents` 引用解析。组件有一模一样的静默故障：少一个 `.json` 白屏、绑定名打错点了没反应、引用路径写错整个页面白屏 |
| 新增根目录 `.gitattributes`（`* text=auto eol=lf`） | 本机 `core.autocrlf=true` 而仓库原先没有它，于是「索引存 LF、checkout 出 CRLF」。危害是安静的：prettier 配的是 `endOfLine: "lf"`，换台机器克隆一次就全仓 `format:check` 失败。加之前核对过索引里 217 个文本文件本来就是 LF，不会连带产生批量重新规范化 |
| ⚠️ **已知偏差：`pnpm run format:check` 目前不通过** | 43 个文件（含 `server/`）是前几轮手写时没跑 prettier 留下的，本次**刻意没做整仓重排**——不想把 300 行格式改动混进组件提交。待单独一个 `style:` 提交处理 |

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
M1 骨架贯通   ✅ 后端 15 项 + 小程序端 13 项全部完成（真机验收待做）
   ↓
M2 核心闭环   ← 你在这里（后端只剩 B23 云托管 Cron；小程序端组件地基已就位）
   ↓
M3 吃啥呢     随机决策 + 一键派活
   ↓
M4 留个念     图片发布 + 家庭时间线
   ↓
M5 上线       提审 → 发布 → 家人真机安装
```

---

## 四、现在最该做的事

> 对应 `docs/05` 的 M2 阶段。**后端 B1–B26 已全部收口**（只剩 B23 云托管 Cron 配置，
> 需在控制台操作）；小程序端四个共用组件、接口封装、**P09 派活**与 **P08 叮一下**已完成，
> 剩下按核心闭环做页面：**P10 小事详情 → P11 我的小事**。

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
