# 《家有小事》项目长期记忆

## 项目定位
面向家庭成员的轻量事务协作微信小程序。四大模块：🔔叮一下 / 🎯派活 / 🍽️吃啥呢 / 📖留个念。
核心闭环：吃啥呢 → 派活 → 叮一下 → 完成 → 留个念。
阶段：个人开发者 MVP → 家庭真实使用 → 持续迭代。
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
  - scope ∈ `auth` / `family` / `thing` / `reminder` / `menu` / `memory` / `upload` / `notify` / `mp` / `wxpush` / `db`
    （基础设施工地用 `server`；不在列表里的新 scope 先补 docs/04 §6.2 再用）
- 提交前核对：`git check-ignore -v server/.env` 必须命中；`.env.example` 必须入库。
- 每次 commit 后核对：`git log --oneline -1` + `git status --porcelain -uall | wc -l`。

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
- **已排除**：认证服务号模板消息（需企业主体）、企业微信、原生 App（PRD 6.5.4）

## V0.1 明确不做
编辑 / 撤回 / 状态回滚 / 多家庭切换 / 「每天」重复 / 通知节流与汇总 —— 全部 V0.2。

## 文档结构
**根目录只放 `AGENTS.md` + `README.md` 两个 md**（工具约定要求它们必须在根），其余文档全在 `docs/`：
- `docs/README.md` — 索引 + **文档权威性表**（一份信息只有一个权威来源，防矛盾机制）
- `docs/产品需求文档.md` — ★ 产品需求唯一权威来源
- `docs/核心数据模型与业务流程.md` / `docs/MySQL 数据库设计.md` — 设计基线（v0.2.1）
- 文档版本**按篇独立**：v0.2.2 = PRD / 01 / 02 / 04 / 05 / 06；08 = v1.0.1；03 / 07 / 核心数据模型 / MySQL 设计 仍 v0.2.1
- `docs/未来需求池.md` — 超出 V0.1 的想法一律记这里
- `docs/01~08` — 架构 / API / 页面 / 工程规范 / 开发计划 / 上线准备 / 视觉设计规范 / wxpush 推送集成方案
- 配套：`db/schema.sql`（DDL 唯一真相）、`packages/shared/src/enums.ts`（枚举唯一来源）、`prototypes/prototype.html`、`wxpush/`、`tools/`

**文档移动/重命名后必须跑 `node tools/check-links.mjs`**（Markdown 相对链接失效不会报错）。
vendor 第三方代码要连 LICENSE 一起带（`wxpush/` 是 MIT）。

## 工程目录约定（docs/04）
Monorepo + pnpm workspace：`packages/shared`（共享类型）+ `miniprogram/` + `server/`（NestJS）。
后端模块（已建）：`auth` / `families` / `wechat` / `notify` / `health` + `prisma` / `redis` / `common`。
（规划中）`thing` / `reminder` / `menu` / `memory` / `upload` / `scheduler`。
Prisma `@map` 做 snake_case ↔ camelCase 映射，**接口层永远不出现下划线字段**。

### 三个容易踩的工程坑（都已在 docs/04 写明）
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

## 设计风格
v1.0「柔光粉彩」，完整规范见 `docs/07`。主色粉桃渐变 `#FF9DB4 → #FFB59B`，背景 `#FDF6F7`，
卡片纯白 + 20px 圆角 + **粉调柔阴影**（禁灰阴影），emoji 装粉彩 squircle 色块。
参考 `ui/风格参考/`（育儿 App，**只参考样式，不参考功能与人群**）。

文案必须有人情味：「阿妈，有个活儿到你啦～」而非「您有任务待完成」。
禁止出现：任务逾期、超时未完成、待办事项、审批、流程、KPI、催办、监督、绩效。
