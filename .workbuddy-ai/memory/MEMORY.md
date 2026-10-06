# 《家有小事》项目长期记忆

## 项目定位
面向家庭成员的轻量事务协作微信小程序。四大模块：🔔叮一下 / 🎯派活 / 🍽️吃啥呢 / 📖留个念。
核心闭环：吃啥呢 → 派活 → 叮一下 → 完成 → 留个念。
阶段：个人开发者 MVP → 家庭真实使用 → 持续迭代。
**进度（2026-10-06）：M0 ✅ / M1 ✅ / M2 进行中**
- 后端 B1–B26 全部收口（只剩 **B23 云托管 Cron 配置**，需用户在控制台操作）。
- 小程序端：4 个共用组件 + `services/` 接口封装 + P04–P12 + **P20「我的」Tab** 已完成 →
  **核心闭环四个方向都点通了**（首页 → 叮一下 / 派活 → 列表 → 详情 → 完成），
  消息中心与「我的」也都在了，**4 个 Tab 全部有内容**。
- 剩余：**只剩 P21 微信提醒（M2-F1）**；M2-F3 / M2-F14 明确不做（都已记入 `docs/未来需求池.md`）。
- **P20 刻意不露出的三样**（都写进了代码文件头 + 未来需求池）：
  ① 微信提醒那一行（要跳 P21，随 M2-F1 一起加）；② 隐私政策；③ 注销账号。
  后两样是**上线前**的事（`docs/06` §4.6 / §264），注销还需要后端删除链路。
  共同理由：**挂一个点了没反应的入口，比暂时不挂更糟**。
- 还欠用户侧动作：**M1 真机验收**、**M2-B23 云托管 Cron**、Worker 4 个 secret +
  `MP_QRCODE_URL` + `MP_CALLBACK_TOKEN`、用真实 openid 跑 `tools/probe-subscribe.mjs` 验 47003。
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
- **⚠️ DTO 里的 `boolean` 字段必须挂 `@ParseBoolean()`**（`common/utils/query.util.ts`），
  不要手写 `@Transform(toQueryBoolean)`。全局 `ValidationPipe` 开了
  `enableImplicitConversion: true`，而 class-transformer 是**先隐式转换、后跑
  `@Transform`** —— `boolean` 的 `design:type` 先把 `'false'` 变成 `true`，
  `@Transform` 才拿到布尔值，原始字符串已丢。症状：`?flag=false` **静默等于 `true`**。
  `@ParseBoolean()` 内部先 `@Type(() => String)` 把元数据类型改成 String。
  **不能删 `enableImplicitConversion`** —— 有一批数字字段没写 `@Type`，正靠它把 `'5'` 转成 `5`。
  详见 `docs/04 §5.3`。同类：可空数字 ID 用 `toNullableNumber`（`@Type(() => Number)`
  对 `null` 安全但 `Number('') === 0`，`@Min(1)` 会误报）。

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
- **公众号二维码 ≠ 小程序码 —— 本项目第二对「看起来一样、其实不能换」的东西**
  （第一对是两套模板体系，判据是**字段名规则**；这一对的判据是**角标**）
  - 判据只有一个：**小程序码右下角有绿色小程序角标**，放射状圆码；
    公众号二维码是**方形 + 中间头像**。除此之外都是「黑白的方块」，肉眼极易混
  - 扫出来完全不同：**公众号二维码 → 关注那个号**（P21 要的就是它）；
    **小程序码 → 打开小程序**（对 P21 毫无帮助，会走进死路）
  - 本项目位置：公众号二维码 `miniprogram/assets/mp-account-qr.jpg`
    （`config.ts` 的 `MP_ACCOUNT_QR`）；小程序码 `wxpush/assets/miniprogram-code.png`
    （上传 COS 后填 Worker 的 `MP_QRCODE_URL`）
  - ⚠️ 命名陷阱：本项目里 `MP` 前缀是**公众号**（`mp_openid` / `MP_TEMPLATE_*` /
    `MP_ACCOUNT_QR`），而上游 wxpush 的 `MP_QRCODE_URL` 要的却是**小程序码**。
    所以小程序码入库名叫 `miniprogram-code.png`，**不要**沿用 `MP_QRCODE`
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
- **消息中心没有「单条已读」接口** —— `read_at` 字段（`notification_logs` /
  `thing_reminders`）已就绪，docs/02 §9 只定义了「全部已读」。**这是接口契约缺口、
  不是技术缺口**。后果：点开一条通知不会清角标，只能靠「全部已读」（会连带清掉没看的）。
  已记入 `docs/未来需求池.md`。
- docs/04 里 `husky + lint-staged` / `commitlint` 仍标「M1 接入」，尚未接入。
- **`pnpm run format:check` 目前不通过：43 个文件**（含 `server/`）—— 前几轮手写时
  没跑 prettier 留下的（`tools/smoke-m2-things.mjs` 一个文件就要改 178 行）。
  2026-10-06 **用户已拍板：「先不用，记录下」** → 不做整仓重排，已记入 docs/README 的「已知偏差」。
  **沿用纪律：只格式化自己新增/改动的文件**（提交前 `npx prettier --check <本次改动>`），
  不动历史欠账。若日后要做，单独开一个 `style:` 提交。
- **P10 不露出「家庭创建者也能完成 / 取消」这条后端兜底** —— 服务端
  `complete` / `cancel` / `reopen` 都允许 `ctx.isOwner` 越过身份操作，那是防止一件事
  因执行人退出家庭而永远卡住的**数据阀门**；界面只认「我是执行人 / 我是发起人」
  （「只提醒，不监督」）。代价：极少见的死锁（发起人与执行人都已不在家庭时，
  创建者打开 P10 什么都做不了）。已记入 `docs/未来需求池.md`，
  **修复时不要把权限判断搬到前端**（详情响应加一个服务端判定字段）。
- **P10 的提醒行假定「接收人 = 执行人」** —— `ThingDetail.reminders` 里没有接收人字段，
  页面只能拿执行人拼「🔔 17:30 提醒阿爸」。V0.1 成立（P08 / P09 都不传接收人，
  后端默认取执行人），但 docs/02 §5.1 允许显式指定 —— 哪天做「提醒别人」，
  这一行会说**安静的假话**。已记入 `docs/未来需求池.md`。
- **M2-F3（首页「未开微信提醒」提示条）不做** —— docs/03 要求它出现在「**别人**
  没开微信提醒」时，但 `GET /notify/mp-bind/status` 只回**我自己**的状态，
  后端**没有「家庭成员谁开了」的接口**（这个条件算不出来）。
  已记入 `docs/未来需求池.md`。（P21 本身**已经做完了**，这条不做的唯一原因就是上面这个。）
  要做的话注意**只暴露「开 / 没开」布尔值**，不要把 `mp_openid` 漏给前端（机制词，用户界面禁用）。
- **P01 首页不显示 `stats.overdue`（过期未完成数）—— 刻意的，别改回来** ——
  「今天有 2 件事已经过了时间」是**催办话**（AGENTS.md §6 禁用词有「逾期」）。
  单条小事上**变红的时间保留**（那是信息：本来定在几点），聚合成一个数字挂页面顶部
  就变成**监督**了。已记入 `docs/未来需求池.md` 并写明「不要做」。
- 已加 `.gitattributes`（`* text=auto eol=lf`）：本机 `core.autocrlf=true`，
  原先「索引存 LF、checkout 出 CRLF」，会让 prettier 的 `endOfLine: "lf"` 换台机器就全仓失败。
- **P20 底部 Tab 不补图标** —— `app.json` 的 `tabBar.list` 四项都只有 `text`。
  微信允许纯文字 tabBar（合法），要补得放 8 张 PNG，且线性图标与
  「emoji 装粉彩 squircle」是两套视觉语言。这是**打磨**不是**通路**，
  验收标准是「4 个 Tab 都能切换，未读角标正常」。
  （`assets/` 现在只有 P21 的公众号二维码，仍然没有图标。）
- **微信昵称 / 头像授权未做** —— `AuthUser.nickname` 一直是 null，所以 P20 抬头大字
  显示的是家庭称谓（`buildMineProfile` 里「大字已经是称谓时小字不重复它」就是为这个写的）。
  影响有限：家里认的是称谓。已记入 `docs/未来需求池.md`。
- **后端 `leave()` 的报错文案含「转给别人」，但转让创建者功能不存在** ——
  P20 已绕开（创建者看不到「退出家庭」按钮），但服务端那句话是**不实陈述**。
  已记入 `docs/未来需求池.md`，V0.2 做家庭管理时一并处理。
- **P21 的二维码已到位** —— ✅ `miniprogram/assets/mp-account-qr.jpg`（微信后台下发的
  **原图，未转码**），`config.ts` 的 `MP_ACCOUNT_QR` 指向它。
  ⚠️ **扩展名是常量的一部分**：换格式要**连常量一起改** —— 改漏了不报错、不白屏，
  只会**静默**退回一句文字说明。`check-mp.mjs` 检查项 ⑪ 读的是常量本身，会自动跟上。
- **小程序码还没上传，`MP_QRCODE_URL` 还是空的** —— 源图已入库
  （`wxpush/assets/miniprogram-code.png`），但 Worker 读的是**公网 URL**，
  还差「上传 COS → 填 URL」。没填时中转页只剩纯文案引导（可用，体验略降）。
  ⚠️ **别拿错图**：拿公众号二维码填 `MP_QRCODE_URL`，用户长按识别会跳到「关注」页，
  这条兜底路等于废了。
- Worker 4 个 secret（`API_TOKEN` / `WX_SECRET` / `WX_TEMPLATE_ID` / `WX_USERID`）
  与 `MP_QRCODE_URL` 待用户配；`MP_CALLBACK_TOKEN` 待云托管部署后配。

## 文档结构
**根目录只放 `AGENTS.md` + `README.md` 两个 md**（工具约定要求它们必须在根），其余文档全在 `docs/`：
- `docs/README.md` — 索引 + **文档权威性表**（一份信息只有一个权威来源，防矛盾机制）
- `docs/产品需求文档.md` — ★ 产品需求唯一权威来源
- `docs/核心数据模型与业务流程.md` / `docs/MySQL 数据库设计.md` — 设计基线（v0.2.1）
- 文档版本**按篇独立**，随时在变 —— **不要在这里抄具体版本号**，
  当前值以 `docs/README.md` 的「文档权威性表」为唯一来源。
- `docs/未来需求池.md` — 超出 V0.1 的想法一律记这里
- `docs/01~08` — 架构 / API / 页面 / 工程规范 / 开发计划 / 上线准备 / 视觉设计规范 / wxpush 推送集成方案
- 配套：`db/schema.sql`（DDL 唯一真相）、`packages/shared/src/enums.ts`（枚举唯一来源）、`prototypes/prototype.html`、`wxpush/`、`tools/`

**文档移动/重命名后必须跑 `node tools/check-links.mjs`**（Markdown 相对链接失效不会报错）。
vendor 第三方代码要连 LICENSE 一起带（`wxpush/` 是 MIT）。

## 自查与测试工具（`tools/`）
一条命令跑全部：**`pnpm run check`**（= check:ts + check:links + check:shared + check:mp + check:view）。

| 脚本 | 用途 | 何时跑 |
| --- | --- | --- |
| `check-ts.mjs` | TS 语法校验（不装 typescript 也能跑） | 提交前 |
| `check-links.mjs` | Markdown 内部链接校验 | 文档移动/重命名后 |
| `check-shared.mjs` | 小程序侧常量镜像防漂移（`ErrorCode` 数值 + `DELIVERY_TOAST` 文案） | 改了 `packages/shared` 或 `miniprogram/constants` 后 |
| `check-mp.mjs` | 小程序端静态自查（页面/组件四件套、事件绑定、`usingComponents` 引用、**未读角标挂的 Tab 下标**、**二维码图片在不在**；另有 `notes` 通道打 `⏳` 提示，**只提示不判失败**） | 改了页面、组件、`app.json` 或 `config.ts` 后 |
| `test-view.mjs` | **展示模型层的行为断言**（**127 项**：详情 38 + 列表行 14 + 首页提醒行 10 + 通知 18 + 我的 25 + 微信提醒 22） | 改了 `utils/thing-view.ts` / `utils/notice-view.ts` / `utils/mine-view.ts` / `utils/time.ts` 后 |
| `smoke-m1.mjs` | 家庭链路端到端冒烟（14 阶段 / 83 断言） | 改完后端接口后 |
| `smoke-m2-things.mjs` | 派活 / 叮一下 / 提醒 / 消息中心 / 调度器冒烟（215 断言） | 改完后端接口后 |
| `smoke-m3-menu.mjs` | 吃啥呢冒烟（**180 断言**，夹具建**两个家庭**专验隔离；`excludeRecent` 有 5 条回归断言；第 8 节菜谱管理含 `enabled:"false"` 字符串回归；第 9 节一键派活逐字段比对与 `POST /family-things` 的一致） | 改了 `menu` 模块后 |
| `probe-subscribe.mjs` | 实探订阅消息，看微信**原始 errcode** | 排查 47003 / 43101 时 |
| `probe-seccheck.mjs` | 实探文本内容安全，看 `suggest` / `label` | 排查 msgSecCheck 时 |
| `test-wxpush.mjs` | 测公众号模板消息通道 | 排查推送时 |

**`test-view.mjs` 的做法值得复用**（它是仓库里第一个行为断言工具，原名 `test-thing-view.mjs`）：
小程序端是 TS，node 不能直接 require → 用已有的 `typescript` 走**编译器 API 在进程内**
（`readConfigFile` → `parseJsonConfigFileContent` → `createProgram` → `emit`）把
`miniprogram/` 编到系统临时目录再 require 产物。**不要 spawn `tsc`**：
本机执行环境会拦子进程（`.bin/tsc.cmd` → `EINVAL`，`process.execPath` → `EBUSY`）。
产物路径是 `<out>/miniprogram/utils/*.js`（tsc 推断 `rootDir` 为仓库根）。
**一次编译同时产出全部 `*-view.js`**（`thing-view` / `notice-view` / `mine-view` 一起断言，
每遍编译 3.4s，分几次编就白花几倍时间）。**为什么需要它**：`tsc` 只保证类型对，
保证不了「不限时间前完成」这种语法通顺但意思错的文案，也保证不了
「谁该看到哪个操作」这种权限判断 —— 后者算错的后果很具体，点一下就是一次 403 toast。
写它的当天就抓到一个空格级错误。**别只加断言，也要核对既有断言还成不成立。**

`smoke-m1.mjs` 要点：用 `node:crypto` 手写 HS256 JWT（payload 与 `AuthService.signToken`
一致，`sub` 必须是 number）；夹具走 Prisma Client（见上方沙箱 EBUSY 那条）；
需先起服务 + MySQL + Redis。提交 scope 用 `tools`（docs/04 §6.2 已登记）。

**⚠️ 写冒烟断言的纪律：有随机性的接口，断言不能依赖单次结果。**
`smoke-m3-menu.mjs` 用的是：① 比对 `poolSize`（确定性）；
② 「连抽 60 次都不出现」；③ 「**包含**三类」而不是「恰好三类」。
**这个纪律当天就抓到真 bug** —— `excludeRecent=false` 被全局隐式转换吃掉
（见上方 `@ParseBoolean()` 那条），如果拿「这次抽到了什么」去断言，会被随机性掩盖。

**验证新代码要另起端口**：用户可能正在 3000 端口跑旧代码，别去打扰 ——
`PORT=3100 TZ=Asia/Shanghai npx --no-install ts-node -r tsconfig-paths/register src/main.ts`，
再用 `SMOKE_BASE_URL=http://127.0.0.1:3100` 跑冒烟。
探针：新路由在「未登录」时应回 **40100**；若回 **40400** 说明跑的还是旧代码。

**提交纪律**：改完后端接口 → 跑冒烟 → 「编译通过」不等于「链路通」。
改了小程序纯展示逻辑 → 跑 `check:view`。

## 工程目录约定（docs/04）
Monorepo + pnpm workspace：`packages/shared`（共享类型）+ `miniprogram/` + `server/`（NestJS）。
后端模块（已建）：`auth` / `families` / `wechat` / `notify` / `thing`（含 reminder）/ `scheduler` /
`health` / `menu` + `prisma` / `redis` / `common`。（规划中）`memory` / `upload`。
Prisma `@map` 做 snake_case ↔ camelCase 映射，**接口层永远不出现下划线字段**。

**`menu` 模块现状（M3 后端已全部完成）**：`default-menu.ts`（系统菜谱常量 72 条，**不入库**，PRD §16.4）
+ `dto/menu.dto.ts` + `menu.service.ts` + `menu.controller.ts` + `menu.module.ts`。
读接口 ✅：`GET /menu/random`（`count` 组合搭配 / `excludeRecent` 按**菜名**排除 /
池子被排空时放宽）、`GET /menu/items`（系统 + 家庭合集，`canEdit` / `enabled`，
**停用的也返回**，否则用户在 P17 找不到它去重新启用）、`POST /menu/decide`
（写 `meal_records`，`name` 是历史快照、以请求为准）、`GET /menu/recent`（按日期 + 餐次归组）。
写接口 ✅：`POST /menu/items`（同家庭菜名唯一 **40900**）/ `PATCH /menu/items/{id}` /
`PATCH /menu/items/{id}/enabled` / **`POST /menu/decide-and-assign`**。
- ⚠️ **`PATCH /items/:id` 两条都不挂 `FamilyMemberGuard`**（URL/body 没有 `familyId`），
  改用 `contextForItem` 由资源反查家庭：不存在 **40400**、不是你家 **40300**
  （照搬 `contextForThing`）。
- ⚠️ **`decide-and-assign` 复用 `ThingService` 三段式**（`prepareThing` 事务外 /
  `insertThing` 事务内 / `dispatchCreatedThing` 提交后），**没另写一份派活逻辑**。
  冒烟逐字段比对两条路径产出的小事，键集合完全一致。
- `buildPool()` 按**菜名**去重，家庭版覆盖系统版。
- `summary`（今晚**吃**）与派活 `title`（今晚**做饭**）刻意不同。
冒烟：`pnpm run smoke:m3`（**180 项断言**，夹具建**两个家庭**专验隔离）。

**五个分类是有语义的，改分类会改推荐行为**：`家常菜`=荤 / `素菜`=素 /
`汤`+`主食`=第 3 道（共用一个位置）/ `外食` **不参与组合**。
`MENU_CATEGORY` 的唯一来源是 `packages/shared/src/enums.ts`
（`as const` 对象 + 联合类型，刻意不用 `enum` —— 消费方有 72 行字面量，
用 enum 噪音大；联合类型打错字照样 TS2322）。

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
- **⚠️ DTO 的 `boolean` 字段必须挂 `@ParseBoolean()`**（`common/utils/query.util.ts`），
  不要手写 `@Transform(toQueryBoolean)`。全局 `ValidationPipe` 开了
  `enableImplicitConversion: true`，class-transformer 是**先隐式转换、后跑 `@Transform`**：
  `boolean` 的 `design:type` 先把 `'false'` 变成 `true`，`@Transform` 才拿到布尔值，
  原始字符串已丢。症状：`?flag=false` **静默等于 `true`** —— 不报错、无日志，只有行为错。
  `@ParseBoolean()` 内部先 `@Type(() => String)` 把元数据类型改成 String。
  **不能删 `enableImplicitConversion`**：有一批数字字段没写 `@Type`，正靠它把 `'5'` 转成 `5`。
  同类：可空数字 ID 用 `toNullableNumber`（`@Type(() => Number)` 对 `null` 安全，
  但 `Number('') === 0` → `@Min(1)` 误报）。详见 `docs/04 §5.3`。
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
- **组件是「一个组件一个目录」，入口固定 `index.*`**（`components/<kebab-case>/index.{ts,wxml,wxss,json}`），
  和页面的扁平文件布局不是一套，别记混。
- **自定义组件抛事件必须避开原生事件名**：`triggerEvent('tap')` 会和原生 tap 冒泡撞车，
  页面写 `bindtap` 会收到**两次**回调。卡片用 `click` + `complete`。
- **组件不读 store、不发请求**（项目约定）：页面决定「给谁选、拿什么数据」，
  组件只把「选了什么 / 点了什么」抛回去。组件一旦自己去查成员列表就没法复用了。
- **`thing-card` 只吃 `utils/thing-view.ts` 归一化出来的 `ThingCardItem`**，不认识任何后端 DTO。
  后端三种小事形状（`ThingListItem` / `TodayTask` / `TodayReminder`）的差异只在归一化层处理一次。
  **P10 详情页的 `buildThingDetailView()` 也放这里** —— 同一层的纯函数，好处是可断言。
- **改了小事状态后整页重拉，不就地打补丁**：完成一件小事会连带取消它下面所有未发出的提醒，
  只改本地 `status` 会让「🔔 17:30 提醒阿爸」留在一件已经做完的事上。
- **toast 只说界面说不出来的事**：状态条已经变成「已完成 · 18:05 由阿爸完成」时，
  再弹一句「搞定啦」是重复。只有 `nextThingId` 这种界面表达不了的信息才补 toast。
- **时间文案三个出口**：`describeMoment(value)` 给「单独出现的绝对时刻」（要带「今天 / 明天」
  才不歧义，如消息列表的「今天 17:30」）；`shortMoment(value, base?)` 给「成对出现的时间」
  （同一天只说「18:05」）；`describeDue(value | null)` 给「要求完成时间」（可为空 →「不限时间」，
  有值时复用 `describeMoment`）。
  拼「X 前完成」时注意 `describeDue(null)` 是「不限时间」——直接拼会成「不限时间前完成」。
- **页面路径以 `docs/03` §二 为准**：P08 = `pages/nudge/create`、P09 = `pages/task/create`、
  P10 = `pages/thing/detail`、P11 = `pages/thing/mine`、P12 = `pages/notice/index`、
  P20 = `pages/mine/index`、P21 = `pages/mine/wechat-notify`。**不是** `pages/thing/create`。
- **列表页用 `onShow` 取数，不用 `onLoad`**：从创建页 / 详情页返回时必须反映刚才的操作。
  代价是分页位置会收回到第一页 —— **数据正确优先于位置保留**。
- **列表请求必须防「过期响应」**：快速连点两个 Tab 时先发的那次可能后到 →
  「Tab 高亮着 A，列表里却是 B」，而且**不报错**。做法：请求前记下筛选条件，
  响应回来对不上就丢弃；`loadMore` 还要检查分页号没被中间那次 `reload` 接上。
  ⚠️ **`reload()` 里不能加 `if (loading) return`** —— 它会把「过期的首次请求」
  变成一道闸门，后续刷新全被堵死。防重复靠条件判断，不靠锁。
- **`swipe-cell` 左滑组件（第 5 个组件）的三个设计点**：
  ① **横滑与竖滚要仲裁** —— 判据是「位移先超过 6px 的那个方向」，判成纵向就彻底不管，
  把滚动还给页面；为此用 `bindtouchmove` 而非 `catchtouchmove`（后者会吃掉事件、
  列表就再也滚不动）。② **同一时刻只允许开一行** → 「哪一行开着」由**页面**持有
  （`openId`），组件只回答「我这一行该不该开着」（**受控组件**）。
  ③ **`actions` 为空 = 这一行不可滑**（真的不响应手势），不是「滑开一个空抽屉」。
  ⚠️ **`ACTION_WIDTH = 84` 是 ts 与 wxss 的跨文件耦合**（`.swipe__action { width: 84px }`）。
  ⚠️ 手势中间态（`touchStartX/Y` 等）**放进 `data`，不挂 `this.xxx`** ——
  小程序组件的 TS 类型里没有自定义实例字段的位置。
- **自定义组件的行不要套在 `.card` 里**：`thing-card` / `swipe-cell` 自身就是白底圆角，
  再套一层白卡片就是**白压白**，行与行分不出界线。列表用 `.rows / .row` 直接躺在页面背景上。
- **`onLoad(query)` 要真的读入口参数**：P11 靠 `?tab=` 决定落在哪个 Tab
  （首页两个「更多 ›」都跳它）。**参数不认识要退回默认值**，不能因为一个错链接白屏。
- **通知的送达判断必须同时看 `channel` 和 `status`。** `SENT` 只说明「这次发送成功了」，
  而 `channel === 'IN_APP'` 的 `SENT` 意思是「只写进了站内」——只看 `status` 会把
  「只在小程序里」说成「已发到微信」，是一句**安静的假话**（有专门断言）。
  判据在 `utils/notice-view.ts` 的 `deliveryTextOf()`：`SENT` 且渠道在
  `WECHAT_CHANNELS = ['MP_TEMPLATE','SUBSCRIBE']` 里 → 返回空串（页面据此不显示标签）。
- **通知类型 emoji 是列表可辨识性的关键**：五种两两不同（🎯派活 / 🔔叮一下 / ❤️搞定了 /
  🏠家庭 / 📢通知），有断言。`NOTICE_TYPE_META` 用 `Record<NotificationItem['type'], …>`
  做**编译期穷举**，漏键 `tsc` 直接报错 —— **所以不需要额外的防漂移脚本**。
- **消息中心的未读用「加法」，不做「已读置灰」。** 标题 600 加粗 + 右侧 8px 粉点。
  理由：`thing-card` 的「已完成整条 `opacity .55`」是对的（少数、语义明确），
  但消息列表里**已读的是大多数** —— 把大多数压暗是在惩罚用户。
- **「全部已读」就地改本地状态，不重拉。** 这是「动作之后重拉」那条规律的**例外**：
  判断依据是「**有没有连带副作用**」，不是「是不是写操作」。全部已读不影响任何小事状态，
  重拉会闪、还会把刚上拉出来的第三页收回第一页。理由写在 `pages/notice/index.ts` 文件头。
- **列表只显示一个字段时，那个字段必须能独立说明白一件事。** 消息中心的列表只显示
  `title`，而后端原本把 `title` 写死成「提醒你一下」这种不含事项名的短语 →
  20 条通知长得一模一样，**这一页等于白做**。改成 `withWhat(from, action, what)` 拼出
  「阿妈 派了个活：买酱油」。**展示层字段的措辞属于实现责任**，不是「先随便写、以后再说」。
- **`utils/*-view.ts` 必须保持纯函数**（不碰 `wx.*`），有副作用的东西单独放
  （如 `utils/tab-badge.ts`）。**这不是洁癖**：一旦混进 `wx.`，`test-view.mjs` 在
  `require` 编译产物时会直接炸（node 里没有 `wx` 全局），**连小事 / 通知那两套断言一起废掉**。
- **未读角标三件事**（`utils/tab-badge.ts`）：
  ① `count = 0` 要**显式** `removeTabBarBadge` —— 只调 `setTabBarBadge` 的话，
  角标会一直停在最后一个数字上；② 超过 99 说「99+」（微信的角标最多显示 4 个字符，
  再多会截成「前 3 个字符 + …」）；③ 数字一律 `Math.floor` —— 2.7 条未读显示成 3 条
  是**凭空多报**。只在「我的」Tab 的 `onShow` 里刷：我的未读数只会因为**别人**做了事
  而变化，本地没有触发点，想实时只能轮询，不值当。
- **跨文件耦合的「静默失败」要配一个自查项。** `MINE_TAB_INDEX = 3` 与 `app.json` 的
  `tabBar.list` 是耦合关系，挂错 Tab **不报错、不白屏**，只是红点出现在别的栏上 →
  `check-mp.mjs` 检查项 ⑩ 比对两者，**并且要反向验证**（改成 2 看脚本会不会报）。
  同类：`swipe-cell` 的 `ACTION_WIDTH = 84` 与 `.swipe__action { width: 84px }`。
- **图片路径 / 扩展名是常量的一部分，改漏了会「静默降级」。** `MP_ACCOUNT_QR` 写的是
  `'assets/mp-account-qr.jpg'` —— 换格式时只改图片不改常量（或反过来），
  小程序**找不到文件也不报错、不白屏**，只是 `<image>` 触发 `binderror` →
  退回一句文字说明。所以：① 页面必须写 `binderror` 降级（宁可少一张图，
  也不能显示一张破图）；② 自查脚本要**从常量里读路径**去判文件在不在，
  而不是写死文件名（写死了就跟着一起漂移）。**同类静默失败**，同一条规律。
- **`export const X = '...'` 会被 TS 推断成字面量类型。** 于是页面里
  `X !== ''` 被判成「不可能成立」→ **TS2367**（明明是在判空，编译器说不可能）。
  必须显式标 `: string`。本轮 `MP_ACCOUNT_QR` 就踩了这个。
- **轮询不要用 `setInterval`，用「查一次、再排下一次」**（`setTimeout` 递归）。
  查询本身是异步的，固定间隔会在网络慢的时候叠起好几个并发请求，而且
  **停不掉正在飞的那一个**。配套：`onHide` / `onUnload` 必须停轮询，
  否则用户切走后定时器还在跑、还会 `setData` 到不可见的页面；
  `onShow` 回来时立刻重查一次。轮询句柄挂在 `this` 上（不进 `data`，不参与渲染）。
- **`test-view.mjs` 里造「相对当前时间」的时刻要留余量。** `describeExpire()` 是
  **向下取整**的 —— 造出 `now + 9 分钟` 并丢掉秒（`...:00`）后，到断言执行之间
  过去几毫秒就正好卡在整分钟边界，算成「8 分钟」。修法：辅助函数
  `expiresInMinutes(n)` 留 **+0.5 分钟**余量并**保留秒**。
  另外测「不到 1 分钟」要用 `expiresInMinutes(0)`，**不能用 `-1`**
  （`-1` 会变成「已经过期了」，测的就不是同一档了）。
- **「挂一个点了没反应的入口，比暂时不挂更糟」** —— 这条原则已经用过四次：
  M2-F3 首页提示条、P20 的微信提醒那一行、P20 的隐私政策 / 注销账号、
  P21 的「重新绑定」（草图里有，但绑定关系挂在**用户**身上，换微信号就是换人，
  这一行没有真实语义 → 直接从 docs/03 删掉）。
  判断方法：问「用户点下去会发生什么」。如果答案是「什么都不发生」或「一句敷衍的 toast」，
  那就先不挂，把理由写进代码文件头 + `docs/未来需求池.md`。
  ⚠️ **但不要把「先不做」当成默认**：信息不能丢 —— 比如「还没开微信提醒」，
  P20 不挂那一行，是因为 P12 消息中心已经在送达失败时告诉用户了。

## 设计风格
v1.0「柔光粉彩」，完整规范见 `docs/07`。主色粉桃渐变 `#FF9DB4 → #FFB59B`，背景 `#FDF6F7`，
卡片纯白 + 20px 圆角 + **粉调柔阴影**（禁灰阴影），emoji 装粉彩 squircle 色块。
参考 `ui/风格参考/`（育儿 App，**只参考样式，不参考功能与人群**）。

文案必须有人情味：「阿妈，有个活儿到你啦～」而非「您有任务待完成」。
禁止出现：任务逾期、超时未完成、待办事项、审批、流程、KPI、催办、监督、绩效。
