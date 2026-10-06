# 《家有小事》项目长期记忆

## 项目定位
面向家庭成员的轻量事务协作微信小程序。四大模块：🔔叮一下 / 🎯派活 / 🍽️吃啥呢 / 📖留个念。
核心闭环：吃啥呢 → 派活 → 叮一下 → 完成 → 留个念。
阶段：个人开发者 MVP → 家庭真实使用 → 持续迭代。
**进度（2026-10-06）：M0 ✅ / M1 ✅** —— 后端 B1–B15 + 小程序 F1–F13 全部完成。
下一步：M1 真机验收（开发者工具打开 `miniprogram/`，按 docs/05 §三 的四步走）→ M2 核心闭环。
信息架构（v0.2）：底部 4 Tab = 家里 / 吃啥呢 / 留个念 / 我的。家庭管理在「我的」，为 V0.2 家庭切换预留。

## 技术栈（已确定，勿再变更）
- 小程序：原生微信小程序 + TypeScript
- 后端：微信云托管容器 + NestJS + Prisma
- 数据库：云托管 MySQL 8.0（11 张表）｜缓存：腾讯云 Redis｜存储：云开发云存储 / COS
- 定时任务：云托管 Cron 触发 HTTP 端点
- 消息：**四通道降级**（v0.2.1）
  1. 公众号模板消息（wxpush / Cloudflare Workers）← **V0.1 验证期主力**，无限次、能推给别人
  2. 小程序订阅消息（一次性，1 授权 = 1 条）
  3. 站内消息（永不失败）
  4. 首页「今天家里有什么事」（底线：打开小程序一定看得到）

### 两套模板体系，绝对不能互换（最容易踩的坑）
两组都是「三个模板、同样三个场景、标题一模一样」，**比对字符串判断不出谁是谁**。
唯一可靠判据是**字段名规则**：

| | 订阅消息（辅助，通道②） | 公众号模板消息（主力，通道①） |
| --- | --- | --- |
| 后台 | 小程序 `mp.weixin.qq.com` → 订阅消息 → 公共模板库 | 测试号后台 → 模板消息接口 |
| 字段名 | **公共模板库定死**：`thing1`/`thing4`/`time23`/`thing22` | **自定义**：`first`/`keyword1`/`remark` |
| 接收人 | **小程序 openid** | **公众号 openid** |
| 环境变量 | `WX_TEMPLATE_*` | `MP_TEMPLATE_*` |
| 模板编号 | 2983 / 10938 / 77364 | — |

- 订阅消息硬约束：`thing` **≤ 20 字符**（超长 47003）；`time` 只认 `yyyy-MM-dd HH:mm`。
- **订阅消息模板没有审核环节**（公共模板库挑现成的）。别再说「要等 1–3 个工作日审核」。
- **已知缺口**：派活模板的 `time23` 是必填 `time` 字段 → **派活不设时间时订阅消息发不出去**，
  自动降级站内消息（公众号模板不受影响）。见 `docs/未来需求池.md`。
- 代码位置：`subscribe.templates.ts`（字段/组装）、`subscribe-quota.service.ts`（Redis 额度池）、
  `subscribe-message.adapter.ts`（下发 + 按 errcode 退还/归零）。
- 实探：`node tools/probe-subscribe.mjs <小程序openid> TASK` —— 唯一能看到微信**原始 errcode** 的方式。
  用无效 openid 只能验到 `40003`（说明凭证与请求形状 OK），**验不到 47003**（微信先校验 touser）。

## 不可动摇的产品纪律
1. **只提醒，不监督** —— 无催办、无逾期处罚、无强制确认
2. **家庭不是公司** —— 无审批、无工作流、无 KPI、无权限矩阵
3. **家庭成员平等** —— 只有「成员」和「创建者」两种身份
4. **功能只减不增** —— V0.1 的新想法写进 `docs/未来需求池.md`
5. **不做家庭版飞书**
6. **用户界面禁用词**（AGENTS.md §6）：
   - 机械通知词：逾期 / 超时 / 待办 / 待办事项 / 审批 / 流程 / KPI / 催办 / 监督 / 绩效
   - **机制词：绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号**
   - 用户只需要知道「微信提醒 开 / 关」。`NO_QUOTA` toast 的正确说法：
     「已记下，{称谓}再开一次微信提醒就能收到」（唯一定义处 `shared/dto/notify.ts` 的 `DELIVERY_TOAST`）
   - 微信后台模板标题带禁用词（「待办事项提醒」），**不要直接回给前端** ——
     用 `SUB_TEMPLATE_SPECS[].displayName`（派活提醒 / 叮一下提醒 / 完成回执）

## 技术约定
- 数据库 `snake_case`，接口 `camelCase`，接口层不暴露下划线
- 枚举：数据库存 TINYINT，接口传字符串（TASK/REMINDER、PENDING/COMPLETED/CANCELLED）
- **全库不做物理 DELETE**，全部状态位逻辑删除
- **数据权限过滤必须在服务端做**，前端不做
- **时间：存储层用 UTC，北京时间只在接口层格式化一次**（v0.2.2 修正）
  - Prisma 的 MySQL 连接器**不支持**连接串 `?timezone=`（`prisma/orm#29517` 至今 open），
    固定按 UTC 读写 DATETIME。别跟它对抗。
  - MySQL 会话时区必须 `+00:00`；时间戳用 Prisma 侧 `@default(now())` / `@updatedAt`，
    不用 `dbgenerated("CURRENT_TIMESTAMP")`。
  - Node 进程 `TZ=Asia/Shanghai` → 对 Date 调本地 getter 直接得北京时间。
  - 唯一出口 `server/src/common/serialize/beijing-time.ts`；前端传入用 `parseBeijingDateTime()`。
  - 代价：直连数据库看数据是 UTC，比北京时间少 8 小时。
- 页面里禁止直接调 `wx.request`，只能走 `services/request.ts`
- 禁止硬编码密钥，全部环境变量

## 开发工作纪律（用户明确要求，2026-10-06 确立）
- **每完成一个阶段任务，先提交代码，再进入下一阶段。** 别再积压成「一次性上百文件」的批量入库。
- 提交粒度：**一个逻辑单元一个 commit**，不要 `git add -A` 一把梭。
- 提交信息 `<type>(<scope>): <subject>`，见 `docs/04` §6.2。
  - type ∈ `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore`
  - scope ∈ `auth` / `family` / `thing` / `reminder` / `menu` / `memory` / `upload` / `notify` / `mp` / `wxpush` / `db` / `tools`
    （基础设施工地用 `server`；`tools` 给仓库根的自查与冒烟脚本）
- 提交前核对：`git check-ignore -v server/.env` 必须命中；`.env.example` 必须入库。
- 每次 commit 后核对：`git log --oneline -1` + `git status --porcelain -uall | wc -l`。
- **只提交，不推送。`git push` 由用户自己做**（2026-10-06 用户明确要求）。

## 本机开发环境（2026-10-06 实测）
- Windows 10 **专业版** 22H2（Build 19045），物理机 ASUS，PowerShell 有管理员权限。
- **下载必须走代理：`curl -x http://127.0.0.1:7890`**
  - 直连（`--noproxy '*'`）只有 **48 KB/s**；走代理 **3 ~ 8.7 MB/s**，差 60 倍以上。
  - 环境变量里的 `HTTP_PROXY=127.0.0.1:53986` 是**坏的**（curl 会报 502 / HTTP 000），别依赖它。
  - 该 blob 存储不支持 byte range 续传（`-C -` 报错 33），断了只能重下。
- **Docker Desktop 4.94.0 已装好**（WSL2 后端，docker 29.8.2 / compose v5.5.1），
  `pnpm run db:up` 可一键起 MySQL 8.0 + Redis 7（11 张表自动建好）。
  - 启动 GUI 程序只能用 `cmd //c start "" "<path>"` —— `Start-Process` 与 WMI `Win32_Process.Create`
    都被 WorkBuddy 拦。
  - **从 WorkBuddy 会话启动的 Docker Desktop 会继承程序黑名单**，它调 `wsl.exe` 会报
    `Access is denied`；**必须让用户手动从开始菜单启动**（手动启动不受限）。
  - 在 Bash 里调 docker 要先 `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`，
    否则报 `docker-credential-desktop: executable file not found`。
  - Docker Hub 直连不通，但 Docker Desktop 自动继承了系统代理，拉镜像很快，无需配 registry-mirrors。
- WorkBuddy 工具限制（这台机器上）：`wsl.exe` / `reg.exe` / `schtasks.exe` 在程序黑名单里无法执行；
  `dism.exe` 经 PowerShell 调用**可用**；PowerShell 工具 stdout 常为空，
  **必须把结果 `Out-File` 到临时文件再用 Read 读**。
- **沙箱 hook 了 Node 的 `child_process`：Node 进程创建任何子进程都 EBUSY**
  （`execFileSync(process.execPath, ['-v'])`、`execSync('echo hi')`、`spawnSync(docker, ...)` 全部失败）。
  而 `Bash` 工具起 docker 正常 —— 限制只作用于当前 Node 进程的 spawn，不是程序黑名单。
  **推论：Node 脚本想碰外部系统，只能走「进程内协议」—— HTTP / Prisma(N-API) / Redis 客户端。**
  例：`tools/smoke-m1.mjs` 的数据库夹具用 **Prisma Client**（Prisma 6 默认 N-API library 引擎，
  不 spawn `query-engine.exe`），而不是 `docker exec mysql`。
- `nest start --watch` 会因清空 `server/dist`（412 个文件）触发 WorkBuddy 批量删除保护
  （阈值 50）；改用 `pnpm run build` + `node dist/server/src/main.js` 起服务。

## 关键风险与待验证假设（M0 必须实测）
- **A4** 订阅额度累积机制（勾选「总是保持以上选择」后静默 +1）
- **A5** 测试号模板消息能否推给已关注用户
- **A6** `miniprogram` 字段在测试号下是否生效
- **wxpush 是验证期脚手架，产品化前必须拆除**。已设三道开关（`NOTIFY_MP_ENABLED` / 删 Worker / 清 `users.mp_openid`），拆除时不改业务代码
- **审核风险**：需登录且需两人协作才有内容，易判「功能不完整」。应对：正式功能「示例家庭」（mock、只读演示）

## 已核实的微信硬事实（别再想当然）
- **URL Link（`wxaurl.cn`）官方只对非个人主体小程序开放**，且须小程序已发布 → 个人主体**不可用**
- `wx-open-launch-weapp` 需认证公众号 + JSSDK → 测试号不具备
- **小程序码长按识别**是个人主体唯一可靠的中转页跳转手段
- openid 是「用户 × 应用」维度：**小程序 openid ≠ 公众号 openid，无法互推**（`users.mp_openid` 单独存）
- **个人主体小程序可以调用 `security.msgSecCheck`**（无 48001）—— 2026-10-06 实测
  - 结论看 `result.suggest`（`pass` / `review` / `risky`），老接口形态用 `errcode=87014`
  - 唯一能看到原始结论的方式：`node tools/probe-seccheck.mjs [--text=…]`（服务端只回 40002，看不到原因）
  - 策略唯一出口 `server/src/modules/wechat/content-security.service.ts`：
    **`risky` 拦（40002），`review` 与「判不了」放行**（fail-open，理由见文件头）
  - ⚠️ 冒烟验不到「违规被拦」：夹具 openid 是假的（`smoke_xxx`）→ 微信必回 40003 → 走放行。别被全绿骗了
- **`client_msg_id` 是微信侧的 24 小时去重键** —— 补偿重发必须换 ID（加 `-r{n}` 后缀），
  原样重发会被微信直接拦掉，补偿就成了空转（见 `DispatchOptions.attempt`）
- **已排除**：认证服务号模板消息（需企业主体）、企业微信、原生 App（PRD 6.5.4）

## V0.1 明确不做
编辑 / 撤回 / 状态回滚 / 多家庭切换 / 「每天」重复 / 通知节流与汇总 —— 全部 V0.2。

## 已知待决项
- **`FamiliesService.dissolve()` 只改 `families.status=0`，没把成员置 LEFT** ——
  解散后 `family_members` 仍 `ACTIVE`。用户视角无影响（`listMine` 按家庭状态过滤），
  但 M2 做「家庭切换 / 历史家庭」会读到脏数据。M2 前决定是否一并 `updateMany` 置 LEFT。
- `/api/health/templates` 的**公众号通道** `templates[].name` 仍回微信后台标题
  （含禁用词「待办事项」）；订阅通道已用 `displayName` 规避。运维接口，暂不阻塞。
- `notification_logs` / `thing_reminders` 缺 `read_at`，docs/02 §9 要求「已读 / 未读数 /
  全部已读」，M2 前需决定。
- docs/04 里 `husky + lint-staged` / `commitlint` 仍标「M1 接入」，尚未接入。
- Worker 4 个 secret（`API_TOKEN` / `WX_SECRET` / `WX_TEMPLATE_ID` / `WX_USERID`）
  与 `MP_QRCODE_URL` 待用户配；`MP_CALLBACK_TOKEN` 待云托管部署后配。

## 文档结构
**根目录只放 `AGENTS.md` + `README.md` 两个 md**（工具约定要求它们必须在根），其余文档全在 `docs/`：
- `docs/README.md` — 索引 + **文档权威性表**（一份信息只有一个权威来源，防矛盾机制）
- `docs/产品需求文档.md` — ★ 产品需求唯一权威来源
- `docs/核心数据模型与业务流程.md` / `docs/MySQL 数据库设计.md` — 设计基线（v0.2.1）
- 文档版本**按篇独立**：04 = **v0.2.4**；PRD / 01 / 02 / 05 / 06 = v0.2.3；08 = v1.0.1；
  03 / 07 / 核心数据模型 / MySQL 设计 仍 v0.2.1
- `docs/未来需求池.md` — 超出 V0.1 的想法一律记这里
- `docs/01~08` — 架构 / API / 页面 / 工程规范 / 开发计划 / 上线准备 / 视觉设计规范 / wxpush 推送集成方案
- 配套：`db/schema.sql`（DDL 唯一真相）、`packages/shared/src/enums.ts`（枚举唯一来源）、`prototypes/prototype.html`、`wxpush/`、`tools/`

**文档移动/重命名后必须跑 `node tools/check-links.mjs`**（Markdown 相对链接失效不会报错）。
vendor 第三方代码要连 LICENSE 一起带（`wxpush/` 是 MIT）。

## 自查与测试工具（`tools/`）
| 脚本 | 用途 | 何时跑 |
| --- | --- | --- |
| `check-ts.mjs` | TS 语法校验（不装 typescript 也能跑） | 提交前 |
| `check-links.mjs` | Markdown 内部链接校验 | 文档移动/重命名后 |
| `smoke-m1.mjs` | **M1 家庭链路端到端冒烟**（14 阶段 / 83 断言） | 改完后端接口后 |
| `probe-subscribe.mjs` | 实探订阅消息，看微信**原始 errcode** | 排查 47003 / 43101 时 |
| `test-wxpush.mjs` | 测公众号模板消息通道 | 排查推送时 |

`smoke-m1.mjs` 要点：用 `node:crypto` 手写 HS256 JWT（payload 与 `AuthService.signToken`
一致，`sub` 必须是 number）；夹具走 Prisma Client（见上方沙箱 EBUSY 那条）；
需先起服务 + MySQL + Redis。提交 scope 用 `tools`（docs/04 §6.2 已登记）。

**提交纪律**：改完后端接口 → 跑 `smoke-m1.mjs` → 「编译通过」不等于「链路通」。

## 工程目录约定（docs/04）
Monorepo + pnpm workspace：`packages/shared`（共享类型）+ `miniprogram/` + `server/`（NestJS）。
后端模块（已建）：`auth` / `families` / `wechat` / `notify` / `health` + `prisma` / `redis` / `common`。
（规划中）`thing` / `reminder` / `menu` / `memory` / `upload` / `scheduler`。
Prisma `@map` 做 snake_case ↔ camelCase 映射，**接口层永远不出现下划线字段**。

### 容易踩的工程坑（都已在 docs/04 写明）
- **`prisma/schema.prisma` 每个字段都必须有 `@map`**（camelCase 字段名 → snake_case 列名）。
  漏了**不会报错**，但 `prisma db push` 会想把列名改成 camelCase（DROP + ADD，丢数据），
  运行时查询会 `Unknown column`。**自查命令**：
  `prisma migrate diff --from-url <db-url> --to-schema-datamodel prisma/schema.prisma --script`，
  输出 `-- This is an empty migration.` 才算真正对齐。
  （2026-10-06 实测踩到：`mp_openid` / `invite_code` 两个字段漏了 `@map`，
  会导致邀请功能与公众号绑定全部失效）
- **pnpm 11 不再读 `package.json` 的 `pnpm` 字段**：构建脚本白名单要写进
  `pnpm-workspace.yaml` 的 `allowBuilds`（值设 `true`），否则 Prisma 的 postinstall 被跳过、
  `@prisma/client` 不生成。
- **`prisma/schema.prisma` 不定义 relation**，是 `db/schema.sql` 的 1:1 镜像。
  定义了 relation，`prisma db push` 会自动补建外键与额外索引 → 两个 schema 漂移。
  join 写两次查询。
- **`@shared` 的 paths 映射不能带 `.ts` 后缀**：`nest build` 原样替换别名并保留后缀，
  产物 `require(".../index.ts")` → 运行时 `MODULE_NOT_FOUND`。
- **构建产物在 `dist/server/src/main.js`**（不是 `dist/main.js`）：`include` 含
  `../packages/shared/src`，tsc 推断 `rootDir` 为仓库根，shared 编译产物进 `dist/packages/shared/`。
- **小程序页面是扁平文件**：`pages/<模块>/<页面>.{ts,wxml,wxss,json}`（如 `pages/menu/index.ts`），
  不是「一页一目录」。以 `docs/03` 的页面路径表为准。
- 全局前缀 `/api`（不是 `/api/v1`），以 `docs/02` 的 Base URL 为准。

### 小程序端专属的坑（都已在 docs/04 写明）
- **不能 import `@shared` 的运行时值，只能 `import type`。**
  微信开发者工具的 TS 编译由 `@babel/plugin-transform-typescript` 实现，官方文档写明
  它「仅仅是移除了 ts 代码中类型声明等信息」——**只做类型擦除，不解析 tsconfig 的 paths**。
  `import type` 整条被擦除（安全）；`import { X }` 会保留 `require('@shared')` → 运行时崩。
  常量的做法：在 `miniprogram/constants/` 下做**镜像**（用 `as const` 对象，不用 `enum`
  —— Babel 默认不转换 enum），由 `node tools/check-shared.mjs` 防漂移。
- **`wx.request` 的类型定义里没有 PATCH**（官方文档只列 OPTIONS/GET/HEAD/POST/PUT/
  DELETE/TRACE/CONNECT），但底层支持。在 `services/request.ts` 断言一次即可。
- **iOS 不认 `new Date('2026-10-06 12:00:00')`**（返回 Invalid Date），必须先把 `-`
  换成 `/`。**只在真机 iOS 暴露**，模拟器与安卓都不报错。见 `utils/time.ts`。
- 小程序**没有全局路由钩子**，守卫只能写成普通函数在页面 `onShow` 里调
  （`utils/route.ts` 的 `guardEntry`）。
- 真机调试时 `localhost` 指向手机自己 —— `config.ts` 的 `BASE_URL` 要换成电脑局域网 IP。

## 设计风格
v1.0「柔光粉彩」，完整规范见 `docs/07`。主色粉桃渐变 `#FF9DB4 → #FFB59B`，背景 `#FDF6F7`，
卡片纯白 + 20px 圆角 + **粉调柔阴影**（禁灰阴影），emoji 装粉彩 squircle 色块。
参考 `ui/风格参考/`（育儿 App，**只参考样式，不参考功能与人群**）。

文案必须有人情味：「阿妈，有个活儿到你啦～」而非「您有任务待完成」。
禁止出现：任务逾期、超时未完成、待办事项、审批、流程、KPI、催办、监督、绩效。
