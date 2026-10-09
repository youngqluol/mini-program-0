# 02 · API 接口设计

**版本：** v0.2.9
**协议：** HTTPS + REST + JSON
**Base URL：** `https://<云托管服务名>.ap-shanghai.run.tcloudbase.com/api`
**鉴权：** `Authorization: Bearer <JWT>`（除 `/auth/login`、`/wechat/mp-callback` 外全部必填）

**v0.2.9 变更（M5 上线前置）：** 新增 **§2.6 注销账号** `DELETE /auth/account`（提审硬性要求，`docs/06` §4.6）——
① 口径定为「**认人的抹掉，家里的事留下但不再署名**」，附完整处理表；
② 明确 **`notification_logs` 是全库唯一的物理删除**，并说明为什么它不算破例；
③ 记下两处容易漏的实现要点：`thing_reminders` 必须显式取消（`userIdOfMember` 不看成员状态）、
`JwtGuard` 新增账号状态检查（否则旧 token 能用满 7 天）；
④ 接口总数 53 → **54**。

**v0.2.8 变更：** 留个念（M4）落地后把 §七 / §八 按实现重写 ——
① **§7.2 的游标由「`createdAt` 时间戳」改为「上一页最后一条的 `id`」**：
`family_memories.created_at` 是 `DATETIME(0)`（**秒**精度），同一秒发两条就会有
相同时间戳，`created_at < cursor` 翻页会**静默漏掉**并列的那几条；
`id` 自增唯一，顺序即插入顺序。`CursorQuery` 的注释同步改。
② §7.1 / §7.2 的响应补 **`thing`（完成纪念关联的小事）** 与 **`isMine`**，
并说明**详情与列表项是同一个形状**（P03 卡片本来就要回显全文与九宫格，
详情不比它多一个字段）；补 `thingId` 的三种失败语义（**未完成 → 40001、
别人家 → 40400**）。
③ **§7.4 `PATCH` 没有 `attachments`** —— 图片是不可变的：全库不做物理 DELETE，
而 `memory_attachments` **没有状态位**，无法逻辑删除旧行。发错了只能删掉重发。
④ §7.3 补「**私密记录对别人回 40400 而不是 40300**」（40300 等于告诉对方
「这里有一条你看不到的东西」）；§7.5 补逻辑删除后**附件行原样保留**。
⑤ §8.1 补实现口径：**类型以服务端嗅探的文件头为准**（不采信客户端
`Content-Type`）、`scene` 必填、413 超限归一到 40001、COS 未配置时
**明确报 50000 而不是假装成功**。
**v0.2.7 变更：** §6.3~§6.8 的写接口落地后把实现口径写回文档 ——
① §6.3 补**同家庭菜名唯一（40900）** 与 `name` 长度守卫；
② §6.4 / §6.5 补**本路由不挂 `FamilyMemberGuard`**、改用「由资源反查家庭」，
失败语义 **40400（不存在）/ 40300（不是你家）**；`enabled` 走 `@ParseBoolean()`；
③ §6.8 把「`POST /things`」**勘误为 `POST /family-things`**，补 `title`（今晚**做饭**）与
§6.6 `summary`（今晚**吃**）的动词差异，以及「内容安全校验在事务外」
**v0.2.6 变更：** 吃啥呢（M3）动工前把 §6 的口径钉死 ——
① **系统菜谱的 `id` 恒为 `null`**（它们是代码常量，`menu_items` 里没有行；
给个假 id 会让人以为能拿去查库），`source` 取 `SYSTEM` / `FAMILY`
（新增 `packages/shared` 的 `MenuSource`）；
② §6.1 补**推荐口径四条**：池子构成、**按菜名**排除最近 3 天、池子被排空时**自动放宽**
（否则「换一个」一片空白）、`count>=3` 且晚餐时尽量「一荤一素一汤」（`外食` 不参与组合）；
③ §6.2 补 `canEdit` / `source` / 排序 / `enabled` / 分页五条说明 ——
**系统菜谱在前（按分类分组）、家庭菜谱在后**；
④ §6.6 / §6.8 的 `menuItemId` 改为允许 `null`，并写明「`name` 是权威的」
「传了 id 必须校验属于该家庭」「无论是否派活都要写 `meal_records`」；
⑤ §6.8 补事务约束：**三步必须同事务**、**派活必须复用 `ThingService` 不能另写一份**、
**事务里不做网络调用**
**v0.2.5 变更：** §9.1 修正两处与实现不符的地方 ——
① 补 `title` / `content` 的**分工表**：`title` 是消息中心列表**唯一**显示的字段，
所以它必须带上事项名（实现原先写死成「提醒你一下」这种泛化短语，20 条通知在
列表里长得一模一样）；`content` 是多行正文，小程序端暂不展示。
② **`channel` / `status` 的视角由「发起人」改为「收件人」** ——
消息中心是收件箱，里面的每一条都是发给「我」的，所以它回答的是
「我为什么没在微信里收到」，原稿写的「让发起人知道到底叮到了没有」把场景说反了
（那是 P08 三档 toast 的事）。同时把展示文案从「已推送到微信 / 对方打开小程序可见」
改成实际实现的六种，并写明**必须同时看 `channel` 与 `status`**
（`IN_APP` + `SENT` 是「只在小程序里」，不是「已发到微信」）。

**v0.2.4 变更：** §十 调度器接口按实现补全 —— §10.1 新增 `skipped` / `locked` 字段与字段语义表、
恒等式；§10.2 把「扫描 `status=1` 重试」改写为实际的两类处理（FAILED 重发 + 幽灵 PENDING 收尾）
与两条硬约束（复用日志、换 `client_msg_id`）；§10.3 标注归 M5-4 且尚未实现，
并澄清「重复提醒」与「重复小事」是两件事。

**v0.2.3 变更：** §2.4 / §2.5 补订阅额度的**实现口径** —— 服务端只接受已知模板 ID
（防任意字符串灌 Redis）、`count` 上限 10 且服务端再钳一次、`quotas` 只列已配置模板的种类。

**v0.2.2 勘误：** §3.10 的 `sharePath` 由 `pages/join-family/index?code=` 改为
`pages/family/join?code=`（与 docs/03 的页面路径表一致）。

**v0.2.1 变更：**

| # | 变更 |
| --- | --- |
| 1 | 新增第九章 9.4–9.6：微信提醒绑定接口（查询状态 / 生成绑定码 / 关闭） |
| 2 | 新增第十章 10.4 / 10.5：手工绑定 openid、测试号消息回调 |
| 3 | `deliveryStatus` 由两档扩为**三档**，新增 `NOT_BOUND`；新增 `deliveryChannel` 字段 |
| 4 | 修正 1.5 可见性枚举：`ThingVisibility` 与 `MemoryVisibility` 是**两套**，此前误写成一个 |
| 5 | 修正 9.1 通知 `type` 取值（此前写的 `COMPLETED` 不在枚举内） |
| 6 | 接口总数 48 → **53** |

---

## 一、通用约定

### 1.1 统一响应体

**成功：**

```json
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

**失败：**

```json
{
  "code": 40101,
  "message": "登录已过期，请重新进入小程序",
  "data": null
}
```

> HTTP 状态码统一返回 200（网络层异常除外），业务结果看 `code`。这样小程序端只需要写一处错误处理。
> 例外：`401` 鉴权失败会同时返回 HTTP 401，便于前端统一拦截跳登录。

### 1.2 错误码表

| code | HTTP | 含义 | 前端处理 |
| --- | --- | --- | --- |
| 0 | 200 | 成功 | — |
| 40001 | 200 | 参数校验失败 | toast `message` |
| 40002 | 200 | 内容包含敏感词 | toast「内容需要修改一下」 |
| 40100 | 401 | 未登录 / token 缺失 | 静默重新 `wx.login` |
| 40101 | 401 | token 过期 | 静默重新登录后重放请求 |
| 40300 | 200 | 不是该家庭成员 | toast「你不在这个家里」 |
| 40301 | 200 | 无权限操作（非创建者） | toast「只有家里人能改」 |
| 40400 | 200 | 资源不存在 | toast + 返回上一页 |
| 40900 | 200 | 冲突（称谓重复 / 已加入家庭） | toast `message` |
| 42900 | 200 | 请求过于频繁 | toast「慢一点～」 |
| 50000 | 200 | 服务端异常 | toast「出了点小问题，再试一次」 |
| 50001 | 200 | 微信接口调用失败 | 记录日志，用户侧轻提示 |
| 50002 | 200 | 推送失败（所有通道都失败） | toast「没叮成功，稍后再试」 |
| 50003 | 200 | 绑定码无效或已过期 | toast「这个码不对或过期了，重新获取一下」 |

### 1.3 分页约定

**请求：**

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `page` | number | 1 | 页码，从 1 开始 |
| `pageSize` | number | 20 | 每页条数，最大 50 |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [],
    "page": 1,
    "pageSize": 20,
    "total": 37,
    "hasMore": true
  }
}
```

**游标分页（时间线用）：** 家庭记录列表用 `cursor`（上一页最后一条的 `createdAt` 时间戳）+ `limit`，避免新数据插入导致翻页错乱。

### 1.4 时间格式

统一 `"YYYY-MM-DD HH:mm:ss"`（北京时间），日期型用 `"YYYY-MM-DD"`。

### 1.5 命名约定

- 路径：`kebab-case`，复数资源名（`/family-things`）
- 字段：`camelCase`（后端 Prisma 的 snake_case 字段通过映射层转换，接口层不暴露下划线）
- 枚举：接口传字符串，不传数字魔法值

```text
type:        "TASK" | "REMINDER"
status:      "PENDING" | "COMPLETED" | "CANCELLED"
```

> ⚠️ **可见性枚举有两套，不要混用**（对应两张不同的表）：
>
> | 字段 | 取值 | 表 |
> | --- | --- | --- |
> | `family_things.visibility` | `"FAMILY"` \| `"RELATED"` | 小事（派活/叮一下） |
> | `family_memories.visibility` | `"FAMILY"` \| `"PRIVATE"` | 留个念 |
>
> 唯一来源：`packages/shared/src/enums.ts` 的 `ThingVisibility` / `MemoryVisibility`。

> 数据库里存 TINYINT，接口层做转换。这样前端代码可读性远好于 `status === 2`。

### 1.6 公共请求头

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 是 | `Bearer <token>` |
| `X-Family-Id` | 否 | 当前家庭上下文，多家庭场景下由前端带上 |

---

## 二、认证模块 `/auth`

### 2.1 微信登录

```http
POST /api/auth/login
```

**请求：**

```json
{
  "code": "081Abc...",          // wx.login 返回的 code
  "nickname": "张三",            // 可选，用户授权后带上
  "avatarUrl": "https://..."     // 可选
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOi...",
    "expiresIn": 604800,
    "user": {
      "id": 1,
      "nickname": "张三",
      "avatarUrl": "https://..."
    },
    "families": [
      {
        "familyId": 10001,
        "familyName": "我们家",
        "memberId": 20001,
        "roleName": "阿爸"
      }
    ],
    "currentFamilyId": 10001
  }
}
```

> `families` 为空数组 → 前端进入「创建家庭 / 加入家庭」引导页。

### 2.2 刷新 token

```http
POST /api/auth/refresh
```

**响应：** 同 2.1 的 `token` / `expiresIn`。

### 2.3 更新个人资料

```http
PATCH /api/auth/profile
```

**请求：**

```json
{ "nickname": "张三", "avatarUrl": "https://..." }
```

### 2.4 上报订阅授权结果

```http
POST /api/auth/subscribe-quota
```

**请求：**

```json
{
  "templateId": "AbCdEf123...",
  "count": 1              // 本次授权成功的次数（requestSubscribeMessage 成功回调）
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "quotas": [
      { "templateId": "AbCdEf123...", "templateName": "派活提醒", "remaining": 3 }
    ]
  }
}
```

> `templateName` 用**产品自己的话**（派活提醒 / 叮一下提醒 / 完成回执），
> 不是微信后台的模板标题 —— 后台标题带「待办事项」这类禁用词（AGENTS.md §6），
> 不能出现在用户界面。映射表见 `subscribe.templates.ts` 的 `displayName`。
>
> 后端用 Redis 计数。前端在拿到授权后调用，用于后续展示额度提示。
>
> ⚠️ **服务端只接受「已知的」模板 ID** —— 即 `WX_TEMPLATE_TASK` / `WX_TEMPLATE_NUDGE` /
> `WX_TEMPLATE_DONE` 三个环境变量里的值。传别的报 `40001`
> （「模板 ID 不认识，可能是小程序版本太旧了」）。不校验的话，任何人都能拿任意字符串
> 往 Redis 里灌 key，额度池就变成了无上限的键值垃圾场。
>
> `count` 上限 10，服务端还会再钳一次（微信一次授权单个模板最多 +1）。
>
> 实现见 `server/src/modules/notify/subscribe-quota.service.ts` 的 `grant()`。

### 2.5 查询订阅额度

```http
GET /api/auth/subscribe-quota
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "quotas": [
      { "templateId": "AbCdEf123...", "templateName": "叮一下提醒", "remaining": 0 }
    ],
    "needReauthorize": true
  }
}
```

> `quotas` 只列**已配置模板 ID** 的种类 —— 没配的种类前端拿不到模板 ID，
> 也就无从调 `requestSubscribeMessage`，列出来只会让前端显示一堆没用的项。
>
> `needReauthorize` 在**全部见底**时为 `true`，前端据此展示「再开一次微信提醒，就能多叮几次」的轻提示。

### 2.6 注销账号

```http
DELETE /api/auth/account
```

**请求：** 无 body。**不接受任何入参** —— 这是一个「自己删自己」的接口，
只认 token 里的 `userId`。任何形式的「指定要注销谁」都是越权入口。

**响应：**

```json
{ "code": 0, "message": "ok", "data": { "ok": true } }
```

**为什么是 `DELETE` 而不是 `POST /auth/logout`：** 注销**不可逆**，
方法名要让人一眼看出来。`logout` 在前端已经占了另一个意思
（`userStore.logout()`，只清本地缓存），两者混用会让人以为注销也是「退出登录」。

#### 处理口径 —— 「认人的抹掉，家里的事留下但不再署名」

| 数据 | 处理 | 为什么 |
| --- | --- | --- |
| `users` | 匿名化 + `status=0` + **openid 换成墓碑值** | 个人数据必须清除；openid 是登录锚点，留着等于「注销后还能登回这个号」 |
| `family_members` | **保留行**，`status=0` + `role_name` → `已注销的家人` | 它是全家历史的「作者指针」，删了历史就成了孤儿 |
| `thing_reminders`（发给他的、未发出的） | `status=3`（已取消）+ `next_remind_at=null` | **否则注销之后还会继续叮他**，见下方 ⚠️ |
| `notification_logs`（发给他的） | **物理删除** | 全库唯一的物理删除例外，见下 |
| `family_things` / `family_memories` / `meal_records` / `menu_items` / `family_invites` | 原样不动 | 家庭共享内容，「删了但历史要留着」 |
| `families`（他是创建者的） | 交接给**最早加入**的其他成员；没有别人则 `status=0` 解散 | V0.1 没有「转让创建者」，但不能因此拒绝注销 |

**⚠️ 最容易漏的一条：`thing_reminders` 必须显式取消。**
`ThingService.userIdOfMember()` 只按 `family_members.id` 反查 `user_id`，
**不看成员状态** —— 光把成员置为「已退出」，调度器到点照样会把提醒发出去。
这一步不做，用户注销完还会收到「家人的叮一下」，是实打实的 bug。

**⚠️ 唯一的物理删除：`notification_logs`。**
全库纪律是「不做物理 DELETE」（AGENTS.md §4.4），但那张表**整个都是
「发给这个人的消息」**——标题、正文、送达状态全是个人数据，没有一丝家庭历史
（家庭历史是 `family_things` / `family_memories`，一行没动）。
留着它与 PRD §32「30 天内清除其个人数据」直接冲突。**这是有意为之，不是漏改。**

**幂等与 token 失效：**

- 服务层幂等（用户不存在 / 已禁用时直接返回）—— 挡的是**并发**，不是重试。
- **重试走不到服务层**：第二次带同一个 token 打进来时，
  `JwtGuard` 的账号状态检查会先返回 `40100`。这是刻意的：
  JWT 无状态，没有这一查，注销就退化成「前端清了一下本地缓存」，
  旧 token 还能用满 7 天。
- 客户端收场（`miniprogram/services/request.ts`）：`40100` → 静默重登 →
  同一个微信登进来是一个**全新的空账号**（openid 命中不了墓碑值）→
  重放这次注销 → 删掉那个空账号 → 前端 `logout()` + `reLaunch` 回登录页。

**墓碑值：** `deleted:<userId>`。用冒号是刻意的 ——
微信 openid 的字符集是 `[A-Za-z0-9_-]`（28 位），**冒号不可能出现**，
所以该值在数学上不会和任何真实 openid 撞车，不需要任何去重逻辑。

**错误码：** 无专用码。未登录 → `40100`；`status=0` 的账号访问任何接口 → `40100`（不是 `40301`，理由见客户端收场那段）。

> 实现见 `server/src/modules/auth/account.service.ts`（文件头有完整口径表与推演）。

---

## 三、家庭模块 `/families`

### 3.1 创建家庭

```http
POST /api/families
```

**请求：**

```json
{
  "familyName": "我们家",
  "roleName": "阿爸"        // 创建者在自己家庭里的称谓
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "familyId": 10001,
    "familyName": "我们家",
    "memberId": 20001,
    "roleName": "阿爸",
    "ownerMemberId": 20001
  }
}
```

> 后端事务：`insert families` → `insert family_members` → `update families.owner_member_id`。

### 3.2 我的家庭列表

```http
GET /api/families
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "familyId": 10001,
      "familyName": "我们家",
      "memberId": 20001,
      "roleName": "阿爸",
      "isOwner": true,
      "memberCount": 3
    }
  ]
}
```

### 3.3 家庭详情

```http
GET /api/families/{familyId}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "familyId": 10001,
    "familyName": "我们家",
    "ownerMemberId": 20001,
    "isOwner": true,
    "memberCount": 3,
    "createdAt": "2026-09-20 10:00:00"
  }
}
```

### 3.4 修改家庭名称

```http
PATCH /api/families/{familyId}
```

**请求：** `{ "familyName": "我的小家" }`
**权限：** 仅 `owner_member_id` 对应成员。

### 3.5 家庭成员列表

```http
GET /api/families/{familyId}/members
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "memberId": 20001,
      "userId": 1,
      "roleName": "阿爸",
      "nickname": "张三",
      "avatarUrl": "https://...",
      "isOwner": true,
      "isMe": true,
      "status": "ACTIVE",
      "joinedAt": "2026-09-20 10:00:00"
    }
  ]
}
```

> 已退出成员（`status=LEFT`）默认不返回；传 `?includeLeft=true` 可查历史成员。

### 3.6 修改我的家庭称谓

```http
PATCH /api/families/{familyId}/members/me
```

**请求：** `{ "roleName": "老爸" }`

**失败：** 称谓与家庭内其他成员重复 → `40900`

### 3.7 移除成员

```http
DELETE /api/families/{familyId}/members/{memberId}
```

**权限：** 仅家庭创建者。**不物理删除**，置 `status=0` + `left_at`，历史数据保留。

### 3.8 退出家庭

```http
POST /api/families/{familyId}/leave
```

**约束：** 创建者不能直接退出，需先转让或解散。

### 3.9 解散家庭

```http
DELETE /api/families/{familyId}
```

**权限：** 仅创建者。`families.status=0`，数据保留。

### 3.10 生成邀请码

```http
POST /api/families/{familyId}/invites
```

**请求：**

```json
{ "expireInHours": 72 }
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "inviteId": 30001,
    "inviteCode": "A7K2M9",
    "expireAt": "2026-10-01 10:00:00",
    "sharePath": "pages/family/join?code=A7K2M9"
  }
}
```

> `sharePath` 直接用于小程序 `onShareAppMessage` 的 `path`。

### 3.11 查询邀请码信息（加入前预览）

```http
GET /api/families/invites/{inviteCode}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "inviteCode": "A7K2M9",
    "familyName": "我们家",
    "inviterRoleName": "阿妈",
    "memberCount": 3,
    "expireAt": "2026-10-01 10:00:00",
    "status": "VALID",
    "alreadyMember": false
  }
}
```

**失败：** `40400` 邀请码不存在 / `40900` 已使用 / 已过期。

### 3.12 接受邀请加入家庭

```http
POST /api/families/invites/{inviteCode}/accept
```

**请求：**

```json
{ "roleName": "阿爸" }
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "familyId": 10001,
    "familyName": "我们家",
    "memberId": 20002,
    "roleName": "阿爸"
  }
}
```

**失败：** `40900` 已是该家庭成员 / 称谓重复。

---

## 四、小事模块 `/family-things`

「派活」和「叮一下」共用这一组接口，通过 `type` 区分。

### 4.1 创建小事（派活 / 叮一下）

```http
POST /api/family-things
```

**请求（派活 + 叮一下 组合）：**

```json
{
  "familyId": 10001,
  "type": "TASK",
  "title": "买牛奶",
  "content": "楼下超市，买两盒",
  "assigneeMemberId": 20001,
  "visibility": "FAMILY",
  "dueAt": "2026-09-29 18:00:00",
  "recurrenceType": "NONE",
  "recurrenceConfig": null,
  "reminders": [
    {
      "remindType": "SCHEDULED",
      "remindAt": "2026-09-29 17:30:00",
      "recurrenceType": "NONE",
      "recurrenceConfig": null
    }
  ]
}
```

**请求（纯叮一下）：**

```json
{
  "familyId": 10001,
  "type": "REMINDER",
  "title": "明天记得给宝宝带水杯",
  "assigneeMemberId": 20002,
  "visibility": "RELATED",
  "dueAt": "2026-09-29 07:30:00",
  "reminders": [
    { "remindType": "SCHEDULED", "remindAt": "2026-09-29 07:00:00" }
  ]
}
```

**请求（立即叮）：**

```json
{
  "familyId": 10001,
  "type": "REMINDER",
  "title": "记得拿快递",
  "assigneeMemberId": 20001,
  "reminders": [
    { "remindType": "NOW" }
  ]
}
```

**字段说明：**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `type` | 是 | `TASK` 派活 / `REMINDER` 叮一下 |
| `title` | 是 | 最长 200 字 |
| `content` | 否 | 最长 1000 字 |
| `assigneeMemberId` | 是 | 执行人；自己给自己派活传自己的 memberId |
| `visibility` | 否 | 默认 `TASK`→`FAMILY`，`REMINDER`→`RELATED` |
| `dueAt` | 否 | 不限时间传 `null` |
| `recurrenceType` | 否 | `NONE`/`DAILY`/`WEEKLY`/`MONTHLY` |
| `reminders[]` | 否 | 可传 0..n 条；`remindType=NOW` 时后端立即下发 |

**响应：** 返回创建后的小事详情（同 4.3）。

### 4.2 小事列表

```http
GET /api/family-things?familyId=10001&type=TASK&status=PENDING&assigneeMemberId=20001&scope=MINE&page=1&pageSize=20
```

**查询参数：**

| 参数 | 说明 |
| --- | --- |
| `familyId` | 必填 |
| `type` | 可选，`TASK` / `REMINDER` |
| `status` | 可选，`PENDING` / `COMPLETED` / `CANCELLED`；不传返回全部未取消 |
| `assigneeMemberId` | 可选，按执行人筛选 |
| `scope` | `ALL`（家庭全部，默认）/ `MINE`（我创建的）/ `ASSIGNED_TO_ME`（派给我的） |
| `startDate` / `endDate` | 可选，按 `dueAt` 或 `createdAt` 过滤，用于「今天」视图 |
| `keyword` | 可选，标题模糊搜索 |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 10001,
        "type": "TASK",
        "title": "买牛奶",
        "content": "楼下超市，买两盒",
        "status": "PENDING",
        "visibility": "FAMILY",
        "dueAt": "2026-09-29 18:00:00",
        "creator": { "memberId": 20002, "roleName": "阿妈", "avatarUrl": "https://..." },
        "assignee": { "memberId": 20001, "roleName": "阿爸", "avatarUrl": "https://..." },
        "hasReminder": true,
        "nextRemindAt": "2026-09-29 17:30:00",
        "isOverdue": false,
        "createdAt": "2026-09-28 10:00:00"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "hasMore": false
  }
}
```

> **隐私过滤**：`visibility=RELATED` 且当前用户既不是创建人也不是执行人时，**该条不出现在列表中**。这个过滤必须在 SQL 层做，不能在前端做。

### 4.3 小事详情

```http
GET /api/family-things/{id}
```

**响应：** 在 4.2 单条结构基础上追加：

```json
{
  "reminders": [
    {
      "id": 40001,
      "remindType": "SCHEDULED",
      "remindAt": "2026-09-29 17:30:00",
      "recurrenceType": "NONE",
      "status": "PENDING",
      "sentCount": 0,
      "lastSentAt": null
    }
  ],
  "completedAt": null,
  "completedBy": null,
  "cancelledAt": null,
  "updatedAt": "2026-09-28 10:00:00"
}
```

**失败：** `40300` 不是家庭成员 / `40400` 不存在或无权限查看。

### 4.4 编辑小事

```http
PATCH /api/family-things/{id}
```

**权限：** 创建人，或家庭创建者。

**请求：** 与创建一致，仅传需要修改的字段。

```json
{
  "title": "买牛奶和面包",
  "dueAt": "2026-09-29 19:00:00",
  "reminders": [
    { "remindType": "SCHEDULED", "remindAt": "2026-09-29 18:30:00" }
  ]
}
```

> 传 `reminders` 时**全量替换**该小事下的提醒（先取消旧的，再建新的），简化前端逻辑。

### 4.5 完成小事

```http
POST /api/family-things/{id}/complete
```

**权限：** 执行人本人，或家庭创建者。

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 10001,
    "status": "COMPLETED",
    "completedAt": "2026-09-29 18:05:00",
    "completedBy": { "memberId": 20001, "roleName": "阿爸" },
    "nextThingId": null
  }
}
```

**副作用：**

1. `status=2`，写 `completed_at` / `completed_by_member_id`
2. 若创建人 ≠ 完成人 → 给创建人发一条「完成回执」通知：**「❤️ 阿爸已经把「买牛奶」搞定啦」**
3. 若该小事是重复任务 → 自动生成下一条实例，`nextThingId` 返回新 ID

### 4.6 取消小事

```http
POST /api/family-things/{id}/cancel
```

**权限：** 创建人，或家庭创建者。**不物理删除**，`status=3` + `cancelled_at`。

### 4.7 重新打开

```http
POST /api/family-things/{id}/reopen
```

将 `COMPLETED` / `CANCELLED` 恢复为 `PENDING`，清空 `completed_at` / `cancelled_at`。

### 4.8 首页今日汇总

```http
GET /api/family-things/today?familyId=10001
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "date": "2026-09-28",
    "reminders": [
      {
        "id": 10002,
        "title": "接宝宝",
        "time": "17:30",
        "assignee": { "memberId": 20002, "roleName": "阿妈" },
        "status": "PENDING"
      }
    ],
    "tasks": [
      {
        "id": 10001,
        "title": "买菜",
        "assignee": { "memberId": 20002, "roleName": "阿妈" },
        "dueAt": "2026-09-28 18:00:00",
        "status": "PENDING"
      }
    ],
    "stats": { "todayTotal": 4, "todayDone": 1, "overdue": 0 }
  }
}
```

> 这个接口专门为首页设计，一次请求拿齐「今日提醒 + 今日派活 + 计数」，避免首页并发 3 个请求。

---

## 五、提醒模块 `/reminders`

### 5.1 单独给某条小事加提醒

```http
POST /api/family-things/{thingId}/reminders
```

**请求：**

```json
{
  "recipientMemberId": 20001,
  "remindType": "SCHEDULED",
  "remindAt": "2026-09-29 17:30:00",
  "recurrenceType": "WEEKLY",
  "recurrenceConfig": { "weekdays": [1, 3, 5], "time": "20:00" }
}
```

### 5.2 取消提醒

```http
DELETE /api/reminders/{id}
```

置 `status=3`，不物理删除。

### 5.3 立即叮一下（独立入口）

```http
POST /api/reminders/nudge
```

**请求：**

```json
{
  "familyId": 10001,
  "recipientMemberId": 20001,
  "content": "记得拿快递",
  "thingId": 10001
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "thingId": 10001,
    "reminderId": 40005,
    "deliveryStatus": "SENT",
    "deliveryChannel": "MP_TEMPLATE",
    "quotaRemaining": 2
  }
}
```

**`deliveryStatus` 取值（三档，见 PRD 6.5.6）：**

| 值 | 含义 | 前端 toast |
| --- | --- | --- |
| `SENT` | 已下发到对方微信（通道 ① 或 ②） | 「已经叮到{称谓}啦 🔔」 |
| `NO_QUOTA` | 订阅额度不足，已转为站内消息 | 「已记下，{称谓}再开一次微信提醒就能收到」+ 补提醒引导 |
| `NOT_BOUND` | 对方还没开微信提醒 | 「已记下，{称谓}还没开微信提醒，他打开小程序就能看到」 |
| `FAILED` | 所有通道都失败 | 「没叮成功，稍后再试」 |

**`deliveryChannel` 取值：** `MP_TEMPLATE`（公众号提醒）/ `SUBSCRIBE`（订阅消息）/ `IN_APP`（仅站内）

> ⚠️ **`NOT_BOUND` 与 `NO_QUOTA` 必须区分开。** 前者要引导「去帮对方开提醒」，
> 后者要引导「让对方再开一次微信提醒」。混在一起会让用户按错误的提示去操作。
>
> ⚠️ toast 文案**不得出现机制词**（绑定 / 授权 / 公众号 / openid / 订阅 / 模板消息 / 测试号）——
> 用户只需要知道「微信提醒 开 / 关」（AGENTS.md §6）。
> 文案的唯一定义处是 `packages/shared/src/dto/notify.ts` 的 `DELIVERY_TOAST`。

> **注意：** 自 v0.2.1 起，系统**可以推送给「别人」**（通道 ① 不要求接收人本人逐次授权），
> 因此「定时提醒」「完成回执」「派活通知」都能真正送达到接收人微信。
> 若通道 ① 未绑定，则降级为站内消息，由首页承担提醒职责。

### 5.4 我的待提醒（小程序内消息中心兜底）

```http
GET /api/reminders/inbox?familyId=10001&status=PENDING
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 40001,
        "thingId": 10001,
        "title": "买牛奶",
        "content": "楼下超市，买两盒",
        "fromRoleName": "阿妈",
        "remindAt": "2026-09-29 17:30:00",
        "isRead": false
      }
    ]
  }
}
```

> 这是订阅消息发不出去时的**兜底通道**。用户打开小程序就能看到「有人叮了你」。

### 5.5 标记已读

```http
POST /api/reminders/inbox/{id}/read
```

---

## 六、吃啥呢 `/menu`

### 6.1 随机推荐菜品

```http
GET /api/menu/random?familyId=10001&mealType=DINNER&count=1&excludeRecent=true
```

**查询参数：**

| 参数 | 说明 |
| --- | --- |
| `mealType` | `BREAKFAST`/`LUNCH`/`DINNER`/`OTHER` |
| `count` | 推荐数量，默认 1，最大 5（用于「一荤一素一汤」组合） |
| `category` | 可选，限定分类。**传了就不做组合搭配**（只在这个分类里抽） |
| `excludeRecent` | 是否排除最近 3 天吃过的（默认 `true`） |

**推荐口径（PRD §16.3）：**

1. 池子 = 系统默认菜谱（代码常量）+ 本家庭**启用中**的自定义菜谱；传了 `category` 再按分类过滤。
2. `excludeRecent=true` 时，按**菜名**排除最近 3 天出现在 `meal_records` 里的菜。
   ⚠️ **按菜名而不是按 id** —— 系统菜谱没有 id，而家庭菜谱也有菜名，
   一套判据同时覆盖两种来源。
3. **池子被排空时自动放宽**（不再排除）—— 否则「换一个」会一片空白。
   宁可重复一次，也不能给用户一个空卡片。
4. `count >= 3` 且 `mealType=DINNER` 且没传 `category` 时，**尽量**按
   「一荤（家常菜）+ 一素（素菜）+ 一汤/主食」搭配；凑不齐就退回随机不重复抽。
   `外食` **不参与组合**（出去吃就不存在「一荤一素」）。

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      { "id": null, "name": "番茄炒蛋", "category": "家常菜", "imageUrl": null, "source": "SYSTEM" },
      { "id": null, "name": "炒青菜",   "category": "素菜",   "imageUrl": null, "source": "SYSTEM" }
    ],
    "poolSize": 18
  }
}
```

> ⚠️ **系统菜谱的 `id` 恒为 `null`。** 它们存在 `server/src/modules/menu/default-menu.ts`
> 这个**代码常量**里，`menu_items` 表里没有对应的行（PRD §16.4）——
> 所以它们**没有 id 可给**。给个假 id 会让人以为能拿它去查数据库。
>
> `source` 取 `SYSTEM` / `FAMILY`（`packages/shared` 的 `MenuSource`）：
> 家庭菜谱有真实 `id`，可以拿去 `PATCH /menu/items/{id}`；
> 系统菜谱的 `id` 是 `null`，前端据此不展示编辑入口（配 `canEdit`，见 §6.2）。
>
> `poolSize` 是**排除之后**的池子大小，用于调试与空状态判断。

### 6.2 菜谱列表

```http
GET /api/menu/items?familyId=10001&category=家常菜&keyword=&page=1&pageSize=50
```

**响应：** 返回「系统菜谱 + 本家庭自定义菜谱」的合集。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": null,
        "name": "番茄炒蛋",
        "category": "家常菜",
        "imageUrl": null,
        "source": "SYSTEM",
        "enabled": true,
        "canEdit": false
      },
      {
        "id": 30012,
        "name": "可乐鸡翅",
        "category": "家常菜",
        "imageUrl": null,
        "source": "FAMILY",
        "enabled": true,
        "canEdit": true
      }
    ],
    "page": 1, "pageSize": 50, "total": 73, "hasMore": false
  }
}
```

> **`canEdit` 与 `source` 是同一个判断的两种说法**，前端用哪个都行：
> 系统菜谱 `id` 为 `null` / `source` 为 `SYSTEM` / `canEdit` 为 `false`。
> 三个字段都给出，是为了让前端**不必反推**（反推的规则一旦改动就会静默失效）。
>
> **排序：** 系统菜谱在前（按 `default-menu.ts` 的书写顺序，即按分类分组），
> 家庭菜谱在后（按 `sort_no`、再按 `id`）。P17 的两个分组直接按顺序切即可，
> 不需要前端再排一次。
>
> **`enabled`：** 系统菜谱恒为 `true`（它们不在库里，没有启停状态）。
> 家庭菜谱停用后**仍然出现在列表里**（否则用户再也找不到它去重新启用），
> 但**不会进 `/menu/random` 的池子**。
>
> **分页：** `total` 是「系统 + 家庭」的合计数。系统菜谱只有 72 条，
> 所以默认 `pageSize=50` 时 P17 需要翻两页 —— 前端按正常分页处理即可。

### 6.3 新增家庭自定义菜谱

```http
POST /api/menu/items
```

**请求：**

```json
{ "familyId": 10001, "name": "可乐鸡翅", "category": "家常菜", "imageUrl": null }
```

**响应：** 新建的家庭菜谱对象（形状同 §6.2 的 `FAMILY` 条目）。

> **`name` 长度**：与 `family_things.title` 一样有上限，服务层另有守卫（超长 → 40001）。
>
> ⚠️ **同家庭内菜名唯一（40900）。** 菜名是池子里的唯一标识（系统菜谱没有 `id`），
> 重名会让随机连出同名菜、「排除最近吃过的」一次误伤两道。挡在写入前。
> **仅限本家庭** —— 家庭菜谱与系统菜谱同名是允许的（就是「我家的番茄炒蛋」覆盖内置那条）。
>
> **`category`** 取 `packages/shared` 的 `MenuCategory` 联合（家常菜 / 素菜 / 汤 / 主食 / 外食）。

### 6.4 修改菜谱

```http
PATCH /api/menu/items/{id}
```

**权限：** 仅家庭自定义菜谱（`family_id` 不为 NULL 且属于该家庭）。

> ⚠️ **本路由不挂 `FamilyMemberGuard`。** URL 和 body 里都没有 `familyId`，守卫拿不到
> 家庭上下文。改用「由资源反查家庭」：先查菜谱拿到 `familyId`，再校验调用者是该家庭成员。
> 失败语义：**资源不存在 → 40400；资源存在但不是你家 → 40300**（不是 40400 ——
> 不涉及隐私内容，给准确原因更好排查）。与小事模块的 `contextForThing` 同一模式。
>
> 改名的唯一性校验同 §6.3（排除自己这条）。

### 6.5 停用/启用菜谱

```http
PATCH /api/menu/items/{id}/enabled
```

**请求：** `{ "enabled": false }`

> ⚠️ **`enabled` 支持布尔或字符串 `"true"` / `"false"`** —— 必须走 `@ParseBoolean()`
> （docs/04 §5.3）。全局 `enableImplicitConversion` 会把 `Boolean("false")` 变成
> `true`，参数过了校验但行为相反。
>
> 权限与错误码同 §6.4。

### 6.6 确认今天吃什么

```http
POST /api/menu/decide
```

**请求：**

```json
{
  "familyId": 10001,
  "mealDate": "2026-09-28",
  "mealType": "DINNER",
  "items": [
    { "menuItemId": null, "name": "番茄炒蛋" },
    { "menuItemId": 30012, "name": "可乐鸡翅" }
  ]
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "mealRecordIds": [50001, 50002],
    "summary": "今晚吃：番茄炒蛋、可乐鸡翅"
  }
}
```

> 写入 `meal_records`。`name` 做快照冗余，菜单后续被删也不影响历史。
>
> ⚠️ **`menuItemId` 允许 `null`** —— 系统菜谱没有 id（见 §6.1），传 `null` 即可；
> 库里 `meal_records.menu_item_id` 也允许 NULL（DDL 注释：「可能为空，允许记录自定义菜」）。
> 传了非 `null` 的 id 时，服务端**必须校验它属于该家庭**，否则就是越权改别人的菜谱数据。
>
> **`name` 是权威的**（`mealItemId` 只是可选线索）：服务端以请求里的 `name` 落库，
> 不回头去查菜谱表取名字 —— 用户看到的就是这个名字，记下来的也该是这个。
>
> **`summary` 是给 toast 用的现成句子**（「今晚吃：番茄炒蛋、可乐鸡翅」），
> 省得前端自己拼一遍、两处措辞还可能不一致。
>
> ⚠️ **无论之后是否派活都要写 `meal_records`**（PRD §16.5）——
> 「吃啥呢」的价值是**帮家庭做决定**，决定了就是决定了；
> 「最近吃过」的防重复逻辑也建立在这条记录上。

### 6.7 最近吃过

```http
GET /api/menu/recent?familyId=10001&days=7
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    { "mealDate": "2026-09-27", "mealType": "DINNER", "names": ["红烧肉", "紫菜蛋花汤"] }
  ]
}
```

### 6.8 从「吃啥呢」一键派活

```http
POST /api/menu/decide-and-assign
```

**请求：**

```json
{
  "familyId": 10001,
  "mealDate": "2026-09-28",
  "mealType": "DINNER",
  "items": [
    { "menuItemId": null, "name": "番茄炒蛋" },
    { "menuItemId": null, "name": "炒青菜" }
  ],
  "assigneeMemberId": 20001,
  "dueAt": "2026-09-28 18:30:00",
  "withReminder": true,
  "remindAt": "2026-09-28 17:30:00"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "thingId": 10010,
    "mealRecordIds": [50001, 50002],
    "title": "今晚做饭：番茄炒蛋、炒青菜"
  }
}
```

> 一个接口完成「记录用餐 + 生成派活 + 挂提醒」三步，保证前端只发一次请求。这是核心业务闭环的关键接口。
>
> **`items` 的语义与 §6.6 完全一致**（含 `menuItemId` 可为 `null`）——
> 两个接口共用同一套「决定吃什么」的入参校验与落库逻辑，
> 差别只在于「要不要顺手派个活」。
>
> ⚠️ **三步必须在同一个事务里。** 只写一半的后果很具体：
> 记了用餐却没派活 → 用户以为已经派了，没人做饭；
> 派了活却没记用餐 → 「最近吃过」第二天还推同一道菜。
>
> ⚠️ **派活不能另写一份。** 这里要复用小事模块的创建逻辑（`ThingService`），
> 否则「派活」的字段口径（可见性默认值、`title` 的措辞、提醒的组装方式）
> 会在两个入口各长一套，迟早不一致。V0.1 的 `POST /menu/decide-and-assign`
> 与 `POST /family-things` 必须产出**形状完全相同**的一条小事。
> 实现上把 `ThingService.create` 拆成「准备（事务外）/ 写库（事务内）/ 通知（提交后）」
> 三段，`decideAndAssign` 直接复用这三段。
>
> **`title` 与 §6.6 的 `summary` 刻意不同。** 这里是「今晚**做饭**：番茄炒蛋、炒青菜」
> （把做饭交给谁），§6.6 是「今晚**吃**：番茄炒蛋、炒青菜」（决定了吃什么）——
> 一个动词之差，是两个动作。
>
> ⚠️ 响应里**只给 `title`**：P02 的确认层在**发请求之前**就要显示这一餐是什么，
> 那时拿不到任何响应，所以它只列菜名、不拼「今晚吃：…」这句话；
> 而「今晚吃：…」只在 `POST /menu/decide` 的响应里出现一次（§6.6），
> 由前端原样 toast 出来。**两边各说各的句子，就不会漂移。**
>
> ⚠️ **事务里不要做网络调用。** 发提醒是异步的（`notification_logs` + 调度器），
> 事务里只落库，推送交给既有的派活链路 —— 在事务里等微信接口会让锁持有时间不可控。
> 内容安全校验也是网络往返，因此放在**开事务之前**。

---

## 七、留个念 `/memories`

> 产品定位（PRD §18.1）：**不是朋友圈**，是「属于一家人的私人时间线」。
> 所以这里没有点赞 / 评论 / 关注 / 转发，接口上也不预留它们的字段。

**数据模型**：两种「念」是**同一张表** `family_memories`，靠 `thing_id` 区分（PRD §十九）：

| 类型 | 说明 | 数据表现 |
| --- | --- | --- |
| 独立留念 | 随手记一笔 | `thing_id = NULL` |
| 完成纪念 | 完成一件小事后顺手记一笔 | `thing_id = 该小事ID` |

**统一的记录形状**（列表项与详情**完全相同**）：

```json
{
  "id": 60001,
  "date": "2026-09-28",
  "content": "宝宝今天第一次自己穿鞋。",
  "visibility": "FAMILY",
  "creator": { "memberId": 20002, "roleName": "阿妈", "avatarUrl": "https://..." },
  "attachments": [{ "id": 1, "fileUrl": "https://...", "width": 1600, "height": 1200 }],
  "thing": { "id": 10001, "title": "买牛奶" },
  "isMine": false,
  "createdAt": "2026-09-28 19:32:00"
}
```

| 字段 | 说明 |
| --- | --- |
| `date` | `"YYYY-MM-DD"`（北京时间）。**时间线按它分组** |
| `visibility` | `"FAMILY"` 家庭可见 / `"PRIVATE"` 仅自己可见 |
| `creator` | **家庭称谓**（「阿妈」）而不是微信昵称；头像可空，前端用称谓首字兜底 |
| `attachments` | 只回 `id` / `fileUrl` / `width` / `height`。**按 `sortNo` 排好**，不是插入顺序 |
| `thing` | 完成纪念关联的小事；独立留念为 `null`。P19 底部那行「来自 🎯 买牛奶」用它 |
| `isMine` | **服务端算**。前端拿 `creator.memberId` 与自己的比也能得出，但那要求每个页面先取一次「我的身份」，多家庭切换时还容易比错人 |

> **为什么不做「列表项 / 详情」两层类型**：P03 的卡片本来就要回显全文与九宫格，
> 详情不比它多任何一个字段 —— 多一层类型只会多一层「哪个字段该出现在哪」的争论。

### 7.1 发布记录

```http
POST /api/memories
```

**请求：**

```json
{
  "familyId": 10001,
  "content": "宝宝今天第一次自己穿鞋。",
  "visibility": "FAMILY",
  "attachments": [
    { "fileUrl": "https://.../a.jpg", "fileType": "image/jpeg", "fileSize": 342100, "width": 1600, "height": 1200, "sortNo": 0 }
  ],
  "thingId": null
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `familyId` | ✅ | 发到哪个家庭 |
| `content` | — | 最长 **1000** 字（`MEMORY_LIMITS.CONTENT_MAX`） |
| `visibility` | — | 不传 = `FAMILY` |
| `attachments` | — | 最多 **9** 张（`MEMORY_LIMITS.MAX_ATTACHMENTS`）。字段照抄 §8.1 的响应 |
| `thingId` | — | 「完成纪念」才传（PRD §19.2） |

> ⚠️ **`content` 与 `attachments` 至少给一样**（都空 → `40001`）。
> 这条是**跨字段规则**，DTO 层表达不了，由 `MemoryService` 判 ——
> **发布与编辑共用同一句话、同一个位置**。

**响应：** 上面的统一记录形状。

**失败：**

| code | 场景 |
| --- | --- |
| `40001` | 正文超长 / 图片超 9 张 / 正文与图片都为空 / `thingId` 指向**未完成**的小事 |
| `40002` | 正文未通过内容安全检测 |
| `40300` | 不是该家庭成员 |
| `40400` | `thingId` 指向**别人家**的小事（**不透露存在性**） |

> **`thingId` 为什么必须「已完成」**：入口就在小事详情页的已完成状态里
> （「📖 记个念 →」）。允许关联一件没做完的事，会让时间线上出现
> 「完成纪念」配着一件未完成的事 —— 那是数据说谎。V0.1 没有状态回滚
> （PRD §15.1），所以完成态是稳定的。

> **图片地址必须来自我们自己的桶**：否则任何人都能把任意外部 URL
> （追踪像素、别人的图）塞进留念，而小程序端加载外域图片会被
> `downloadFile` 合法域名拦掉，表现为「图片加载不出来」，完全看不出是数据的问题。
> 校验用 `StorageService.publicBaseUrl()`；**未配置对象存储时跳过并记 warn**
> （那时上传接口本身就用不了）。

### 7.2 家庭时间线

```http
GET /api/memories?familyId=10001&cursor=60002&limit=20
```

| 参数 | 说明 |
| --- | --- |
| `familyId` | ✅ |
| `cursor` | 上一页最后一条的 **`id`**。不传 = 第一页 |
| `limit` | 默认 20，最大 50 |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [ /* 统一记录形状 */ ],
    "nextCursor": 60002,
    "hasMore": true
  }
}
```

> ⚠️ **游标是 `id`，不是时间戳。**
> `family_memories.created_at` 是 `DATETIME(0)`（**秒**精度）——
> 同一秒里发两条（家人连着发、冒烟脚本）就会有**相同的时间戳**，
> 用 `created_at < cursor` 翻页会**静默漏掉**并列的那几条，
> 而且只在真的翻到边界时才出现。`id` 自增且唯一，天然没有这个问题，
> 它的大小顺序就是插入顺序，与「按时间倒序」等价。
>
> 排序是 `id DESC`（= 时间倒序）。**前端不要再排一次**，只做分组。

> **隐私过滤（服务端做，前端不做）**：`visibility=PRIVATE` 且
> `creator_member_id != 当前成员` 的记录不返回。列表用 `OR` 条件过滤。

### 7.3 记录详情

```http
GET /api/memories/{id}
```

**响应：** 统一记录形状（与列表项**完全相同**）。

**失败：** `40400` 记录不存在 / 已删除 / **是别人的私密记录**；`40300` 不是该家庭成员。

> ⚠️ **别人的私密记录回 `40400` 而不是 `40300`。**
> `40300` 等于告诉对方「这里有一条你看不到的东西」—— 那本身就是一次泄露。
> 同一条判断在 `MemoryService.detail()` 里**再判一次**，不依赖调用方已经过了
> `contextForMemory`：「调用方已经校验过」正是这条铁律最容易被绕过的方式。

> **这三个 `:id` 路由都不挂 `FamilyMemberGuard`** —— URL 与 body 里都没有
> `familyId`，守卫无从下手。改由 `MemoryService.contextForMemory` 从**记录本身**
> 反查家庭，与小事模块的 `PATCH /family-things/:id`、吃啥呢的
> `PATCH /menu/items/:id` 是同一个模式。

### 7.4 编辑记录

```http
PATCH /api/memories/{id}
```

**请求：** 只传要改的字段。

```json
{ "content": "改过的正文", "visibility": "PRIVATE" }
```

**权限：** 仅发布者（否则 `40301`）。

> ⚠️ **刻意没有 `attachments` —— V0.1 的图片是不可变的。**
> 「全库不做物理 DELETE，一律状态位逻辑删除」（AGENTS.md）是铁律，
> 而 `memory_attachments` 表**没有状态位**（`db/schema.sql` 是字段唯一真相）：
> 无法逻辑删除旧行，于是「替换图片」只能物理删，违反铁律。
> 发错了就删掉重发。要支持改图，得先给那张表加状态位（见 `docs/未来需求池.md`）。

> ⚠️ **「正文与图片至少给一样」在编辑时同样成立**，否则会留下一条空白卡片。
> 这条不能交给 DTO 的 `@IsNotEmpty` —— 它判的是**没 trim 的值**，
> 所以 `content: "   "` 能过校验，trim 完却是空串（冒烟脚本真的抓到了这个 bug）。

### 7.5 删除记录

```http
DELETE /api/memories/{id}
```

**权限：** 仅发布者。**逻辑删除**（`status=0`），响应 `{ "id": 60001 }`。

> **附件行原样保留**：它们没有状态位，而记录一删就再也不会被任何查询带出来，
> 留着不影响任何行为。真要做物理清理是运维的事（将来配生命周期规则），
> 不是接口的事。

---

## 八、上传 `/upload`

### 8.1 上传图片

```http
POST /api/upload/image
Content-Type: multipart/form-data
```

**鉴权：** 只有全局 JWT（**要登录**），**不挂 `FamilyMemberGuard`**。
这一步只是「把一张图存进桶里换回一个 URL」，它不知道也不该知道这张图将来属于
哪个家庭 ——「这张图能不能进这条留念」由 §7.1 在写入时校验。
提前在守卫里要 `familyId`，只会让「先传图再选可见范围」的 P18 多绕一圈。

**表单字段：**

| 字段 | 说明 |
| --- | --- |
| `file` | 图片文件，**≤ 5MB**，仅 `jpg` / `png` / `webp` |
| `scene` | ✅ 场景：`AVATAR` / `MEMORY` / `MENU`。决定对象存储里的目录前缀 |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "fileUrl": "https://<bucket>.cos.<region>.myqcloud.com/memories/2026/09/xxx.jpg",
    "fileType": "image/jpeg",
    "fileSize": 342100,
    "width": 1600,
    "height": 1200
  }
}
```

**失败：**

| code | 场景 |
| --- | --- |
| `40001` | 没收到文件 / `scene` 缺失或非法 / **文件头不是 jpg·png·webp** / **超过 5MB** |
| `40002` | 图片未通过内容安全检测 |
| `50000` | 对象存储未配置或写入失败 |

**五条实现口径：**

① **类型以服务端嗅探的文件头为准，不采信客户端的 `Content-Type`。**
把 `.exe` 改名成 `.png` 再声明 `image/png` 是零成本的 ——
而这个判断直接决定「允不允许存进桶里」。嗅探只认三种魔术字节
（PNG 签名 / JPEG 的 `FFD8` / RIFF+WEBP），**GIF 不支持**（动图会带来
「体积上限」和「内容安全只检首帧」两个新问题，V0.1 不做）。

② **`width` / `height` 也由服务端从文件头读**（PNG 的 IHDR、JPEG 的 SOFn、
WebP 的三种子格式）。它们进 `memory_attachments` 供九宫格按比例占位；
让客户端上报等于把布局交给客户端，一张错报 10000×10000 能把页面撑爆。
**解不出来时给 `null`，不编造、也不拒绝上传** —— 「解不出尺寸」不该让家人传不了照片。

③ **超过 5MB 由 multer 在流式解析时就中止**，不会先把整个大文件读进内存。
它是**传输层的守卫**（保护内存），不是业务规则 —— 所以业务层不再重复判一次
（那会变成永远走不到的死代码）。413 由 `AllExceptionsFilter` 归一到 `40001`
并换成中文（multer 带的是英文 `File too large`，会原样漏给用户）。

④ **四步顺序不能换：有没有文件 → 嗅探真实类型 → 内容安全 → 写桶。**
内容安全必须在写桶**之前**：违规图片永远不进桶，省掉「发现违规再去删对象」
的补偿逻辑（删失败就是永久留痕）。

⑤ **对象存储未配置时明确报 `50000`，不降级、不写本地磁盘。**
云托管容器的文件系统是**临时的**（重新部署即清空），
「写到本地磁盘」不是降级，是丢数据。假装上传成功会让用户以为照片发出去了、
实际什么都没有，比直接失败恶劣得多。日志里会把**缺哪个变量**写清楚。

> ⚠️ **图片内容安全用的是 `img_sec_check`（1.0 版同步接口）。**
> 微信自 2021-09-01 起「停止更新维护」，官方推荐改用异步的 `mediaCheckAsync`。
> 仍用它的原因：它是**唯一同步**的接口，能塞进「发布留念」这条同步路径；
> `mediaCheckAsync` 要传公网可达的图片 URL、结果几秒后经消息推送回调回来，
> 意味着「发布」得变成「先发出去、后判、判违规再下架」，要新增附件状态列、
> 回调处理器和产品决策 —— 对 V0.1（家庭内部、个人主体、无公开传播面）
> 代价不成比例。见 `docs/未来需求池.md`。
>
> ⚠️ 它有 **1MB 上限**，比产品允许的 5MB 小得多。超限的图**检测不了**，
> 走 fail-open 放行并记 warn（与文本检测同一套策略，见
> `ContentSecurityService`）。实际影响有限：P18 选图用
> `sizeType: ['compressed']`，压缩后通常 100–500KB。

## 九、通知模块 `/notifications` 与 `/notify`

### 9.1 通知列表（站内消息）

```http
GET /api/notifications?page=1&pageSize=20&type=ALL
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 70001,
        "type": "TASK_DONE",
        "title": "阿爸把「买牛奶」弄好啦",
        "content": "阿爸把「买牛奶」弄好啦\n事项：买牛奶\n完成人：阿爸\n辛苦啦 🎉",
        "channel": "MP_TEMPLATE",
        "status": "SENT",
        "thingId": 10001,
        "isRead": false,
        "createdAt": "2026-09-29 18:05:00"
      }
    ],
    "unreadCount": 3,
    "page": 1, "pageSize": 20, "total": 12, "hasMore": false
  }
}
```

**`type` 取值**（`packages/shared/src/enums.ts` 的 `NotifyType`）：

| 值 | 含义 |
| --- | --- |
| `TASK_ASSIGNED` | 派活通知 |
| `REMINDER` | 叮一下提醒 |
| `TASK_DONE` | 完成回执 |
| `JOIN_FAMILY` | 加入家庭 |
| `SYSTEM` | 系统通知 |

**`title` 与 `content` 的分工：**

| 字段 | 用途 | 约束 |
| --- | --- | --- |
| `title` | **消息中心列表只显示它** | 必须是**带上事项名的一句话**（「阿妈 提醒你：拿快递」），不能只写「提醒你一下」—— 那样列表里每条都一样，用户分不出哪条是哪条。文案在 `notify.templates.ts` 的 `withWhat()` |
| `content` | 多行正文（站内消息 / 公众号模板内容） | 列表放不下，小程序端目前**不展示**；留给将来的「通知详情页」 |

**`channel` / `status` 取值**：见 `NotifyChannel` / `NotifyStatus`。

⚠️ **这两个字段的视角是「收件人」，不是「发起人」。** 消息中心是**收件箱**，
里面的每一条都是发给「我」的，所以它回答的是「**我**为什么没在微信里收到」，
而不是「对方收到了没有」—— 后者是**发起人**关心的事，出口在 P08 的三档 toast
（`@shared/dto/notify` 的 `DELIVERY_TOAST`，PRD 6.5.6）。

小程序端的展示规则（`miniprogram/utils/notice-view.ts`）：

| `channel` | `status` | 条目上显示 |
| --- | --- | --- |
| `MP_TEMPLATE` / `SUBSCRIBE` | `SENT` | **不显示** —— 微信已经响过了，再说一句「已发到微信」是废话 |
| `IN_APP` | `NOT_BOUND` | `还没开微信提醒` |
| `IN_APP` | `NO_QUOTA` | `没发到微信` |
| `IN_APP` | `FAILED` | `没发出去` |
| `IN_APP` | `PENDING` | `发送中`（落库后进程挂掉的幽灵记录，补偿会收尾成 `FAILED`） |
| `IN_APP` | `SENT` | `只在小程序里` |

⚠️ **判据必须同时看两个字段。** `SENT` 只说明「这次发送成功了」，而 `IN_APP`
的 `SENT` 意思是「只写进了站内」—— 只看 `status` 会把「只在小程序里」说成
「已发到微信」，是一句**安静的假话**。

⚠️ 文案纪律：不能说「公众号 / 订阅 / 模板消息 / 站内 / 绑定」（AGENTS.md §6），
所以「仅站内」要说成「只在小程序里」。

### 9.2 未读数

```http
GET /api/notifications/unread-count
```

### 9.3 全部已读

```http
POST /api/notifications/read-all
```

### 9.4 查询微信提醒绑定状态

```http
GET /api/notify/mp-bind/status
```

**响应（未绑定且无待用绑定码）：**

```json
{
  "code": 0,
  "message": "ok",
  "data": { "bound": false, "pending": false }
}
```

**响应（已绑定）：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "bound": true,
    "boundAt": "2026-10-06 09:30:00",
    "pending": false
  }
}
```

**响应（等待用户去公众号发绑定码）：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "bound": false,
    "pending": true,
    "bindCode": "735241",
    "bindCodeExpireAt": "2026-10-06 09:40:00"
  }
}
```

### 9.5 生成绑定码

```http
POST /api/notify/mp-bind/code
```

**响应：** 同 9.4 的 `pending` 形态。

**规则：**

| 项 | 说明 |
| --- | --- |
| 长度 | 6 位纯数字（用户要在微信里手打，不用字母） |
| 有效期 | 10 分钟 |
| 冷却 | 同一用户 30 秒内不能重复生成（防止连点造成多码并存） |
| 存储 | Redis `mpbind:code:{code}` → userId，TTL 10 分钟 |

**前端行为：** 拿到 `bindCode` 后展示二维码 + 码，**每 3 秒轮询一次 9.4**，最多 20 次。

### 9.6 关闭微信提醒

```http
DELETE /api/notify/mp-bind
```

清空 `users.mp_openid` 与 `users.mp_bound_at`，并删除 Redis 中的绑定码。

> **注意：** 关闭后该用户的所有通知自动降级为「站内消息」，**产品依然完整可用**。
> 这个开关不是「关掉功能」，而是「换一种收消息的方式」。

---

## 十、内部接口 `/internal` 与微信回调

> 仅云托管定时任务或微信服务器调用，**不暴露给小程序**。

### 10.1 提醒调度心跳

```http
POST /internal/scheduler/tick
X-Internal-Secret: <INTERNAL_CRON_SECRET>
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "scanned": 12,
    "sent": 10,
    "notBound": 1,
    "noQuota": 0,
    "failed": 1,
    "skipped": 0,
    "locked": false,
    "durationMs": 830
  }
}
```

**字段语义：**

| 字段 | 含义 |
| --- | --- |
| `scanned` | 本轮扫到几条**到点**的提醒（`status=PENDING` 且 `next_remind_at <= now`） |
| `sent` | 真的推到微信了 |
| `notBound` | 对方没开微信提醒 → 已降级站内 |
| `noQuota` | 订阅消息额度用完 → 已降级站内 |
| `failed` | 所有通道都失败 |
| `skipped` | **正常跳过**（小事已完成 / 已取消、接收人已退出家庭）—— 不是失败，必须与 `failed` 分开统计 |
| `locked` | `true` = 没抢到 Redis 锁（另一个实例在跑），本轮什么都没做 |
| `durationMs` | 本轮耗时 |

恒等式：`scanned = sent + notBound + noQuota + failed + skipped`（`locked=true` 时全部为 0）。

> ⚠️ `skipped` 与 `locked` 是 M2-B20 落地时**新增**的字段 —— 原文只有前 5 项，
> 但「扫了 12 条只处理了 10 条」必须能说清另外 2 条去哪了，
> 否则失败率告警会被正常跳过污染。加字段不破坏兼容，前端 / 运维脚本忽略即可。

**建议 Cron：** `* * * * *`（每分钟一次）。

### 10.2 补偿任务

```http
POST /internal/scheduler/compensate
X-Internal-Secret: <INTERNAL_CRON_SECRET>
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "scanned": 3,
    "resent": 1,
    "degraded": 1,
    "skipped": 1,
    "failed": 0,
    "ghostsClosed": 2,
    "locked": false,
    "durationMs": 210
  }
}
```

**处理两类记录，理由完全不同：**

| 扫什么 | 做什么 | 为什么需要 |
| --- | --- | --- |
| `notification_logs.status=FAILED`（最近 24 小时） | 重发一次 | 提醒 FAILED 后 `next_remind_at` 被置 null（产品侧明确「不自动重试」），**tick 永远不会再碰它** —— 这是真正的永久丢失 |
| `notification_logs.status=PENDING` 且超过 30 分钟 | 收尾为 `FAILED`（计入 `ghostsClosed`） | `dispatch` 中途进程挂掉会留下「幽灵记录」，消息中心会一直显示「发送中」 |

**两条硬约束（都在代码里写死了）：**

1. **复用同一条日志**（`reuseLogId`）—— `notification_logs` 就是消息中心的数据源，
   重发时新建会让用户在消息中心看到两条一模一样的通知。
2. **换 `client_msg_id`**（加 `-r1` 后缀）—— 它是**微信侧**的 24 小时去重键，
   原样重发会被微信直接拦掉，补偿就成了空转。

> ⚠️ **只重建 `REMINDER` 类型**：它的上下文能从 `thingId` 完整还原。
> 派活 / 完成回执需要「是否迟到」「谁完成的」等额外上下文，重建成本高而残留概率极低 ——
> 遇到就跳过（计入 `skipped`），**不猜**。

**建议 Cron：** `0 3 * * *`（每天凌晨 3 点一次）。低频是刻意的 ——
补偿是**运维兜底**，不是产品行为。

### 10.3 重复任务生成

```http
POST /internal/scheduler/recurring-things
```

**建议 Cron：** `0 0 * * *`（每天 00:00），为重复任务生成下一条实例。

> ⬜ **尚未实现**，归 **M5-4**（与云托管 Cron 配置一起做）。
> M2 只做了 `tick` 与 `compensate`。
> 注意：**重复提醒**（`thing_reminders.recurrence_type`）已由 `tick` 支持 ——
> 发完一条会自己算出下一次。这里说的是**重复小事**（`family_things.recurrence_type`
> 生成下一条独立实例），是两件事。

### 10.4 手工绑定公众号 openid（保底方案）

```http
POST /internal/notify/bind-mp-openid
X-Internal-Secret: <INTERNAL_CRON_SECRET>
Content-Type: application/json

{ "userId": "3", "mpOpenid": "oY_bbb222xxxxx" }
```

家人极少、暂时不想走消息回调时使用。详见 `docs/08` 5.3。

### 10.5 微信公众号（测试号）消息回调

```http
GET  /api/v1/wechat/mp-callback    # 微信服务器配置校验（返回 echostr）
POST /api/v1/wechat/mp-callback    # 接收用户消息 → 完成绑定
```

| 项 | 说明 |
| --- | --- |
| 鉴权 | **不使用 JWT**，由 `signature` 签名校验保证（sha1 排序拼接） |
| 配置位置 | 测试号后台 → 「接口配置信息」→ URL + Token |
| Token 环境变量 | `MP_CALLBACK_TOKEN` |
| 消息模式 | **明文模式**（安全模式需 AES 解密，V0.1 不做） |
| 处理逻辑 | 用户发来的纯数字消息视为绑定码 → 查 Redis → 写 `users.mp_openid` → 回文本消息 |
| 响应格式 | XML（`text` 类型） |

**绑定成功回复：**「绑定成功 ✅ 以后家里有事，会在这里提醒你～」
**绑定码错误/过期：**「这个绑定码不对或者过期了，回到小程序重新获取一下～」

> ⚠️ 该接口**必须能在无鉴权情况下被公网访问**，安全性完全依赖签名校验。
> 实现见 `server/src/modules/wechat/mp-callback.controller.ts`。

---

## 十一、接口总览

| 模块 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| Auth | POST | `/auth/login` | 微信登录 |
| Auth | POST | `/auth/refresh` | 刷新 token |
| Auth | PATCH | `/auth/profile` | 更新资料 |
| Auth | POST | `/auth/subscribe-quota` | 上报订阅授权 |
| Auth | GET | `/auth/subscribe-quota` | 查询订阅额度 |
| Auth | DELETE | `/auth/account` | **注销账号**（不可逆、幂等，§2.6） |
| Family | POST | `/families` | 创建家庭 |
| Family | GET | `/families` | 我的家庭列表 |
| Family | GET | `/families/{id}` | 家庭详情 |
| Family | PATCH | `/families/{id}` | 改名 |
| Family | DELETE | `/families/{id}` | 解散 |
| Family | GET | `/families/{id}/members` | 成员列表 |
| Family | PATCH | `/families/{id}/members/me` | 改我的称谓 |
| Family | DELETE | `/families/{id}/members/{mid}` | 移除成员 |
| Family | POST | `/families/{id}/leave` | 退出家庭 |
| Family | POST | `/families/{id}/invites` | 生成邀请码 |
| Family | GET | `/families/invites/{code}` | 邀请码预览 |
| Family | POST | `/families/invites/{code}/accept` | 接受邀请 |
| Thing | POST | `/family-things` | 创建派活/叮一下 |
| Thing | GET | `/family-things` | 列表 |
| Thing | GET | `/family-things/today` | 首页今日汇总 |
| Thing | GET | `/family-things/{id}` | 详情 |
| Thing | PATCH | `/family-things/{id}` | 编辑 |
| Thing | POST | `/family-things/{id}/complete` | 完成 |
| Thing | POST | `/family-things/{id}/cancel` | 取消 |
| Thing | POST | `/family-things/{id}/reopen` | 重新打开 |
| Reminder | POST | `/family-things/{id}/reminders` | 加提醒 |
| Reminder | DELETE | `/reminders/{id}` | 取消提醒 |
| Reminder | POST | `/reminders/nudge` | 立即叮一下 |
| Reminder | GET | `/reminders/inbox` | 我的待提醒 |
| Reminder | POST | `/reminders/inbox/{id}/read` | 标记已读 |
| Menu | GET | `/menu/random` | 随机推荐 |
| Menu | GET | `/menu/items` | 菜谱列表 |
| Menu | POST | `/menu/items` | 新增菜谱 |
| Menu | PATCH | `/menu/items/{id}` | 修改菜谱 |
| Menu | PATCH | `/menu/items/{id}/enabled` | 启停菜谱 |
| Menu | POST | `/menu/decide` | 确认吃什么 |
| Menu | POST | `/menu/decide-and-assign` | 决定 + 一键派活 |
| Menu | GET | `/menu/recent` | 最近吃过 |
| Memory | POST | `/memories` | 发布记录 |
| Memory | GET | `/memories` | 时间线 |
| Memory | GET | `/memories/{id}` | 详情 |
| Memory | PATCH | `/memories/{id}` | 编辑 |
| Memory | DELETE | `/memories/{id}` | 删除 |
| Upload | POST | `/upload/image` | 上传图片 |
| Notify | GET | `/notifications` | 通知列表 |
| Notify | GET | `/notifications/unread-count` | 未读数 |
| Notify | POST | `/notifications/read-all` | 全部已读 |
| Notify | GET | `/notify/mp-bind/status` | 查询微信提醒绑定状态 |
| Notify | POST | `/notify/mp-bind/code` | 生成绑定码 |
| Notify | DELETE | `/notify/mp-bind` | 关闭微信提醒 |
| Internal | POST | `/internal/scheduler/tick` | 调度心跳 |
| Internal | POST | `/internal/scheduler/compensate` | 补偿任务 |
| Internal | POST | `/internal/scheduler/recurring-things` | 重复任务生成 |
| Internal | POST | `/internal/notify/bind-mp-openid` | 手工绑定 openid（保底） |
| Wechat | GET | `/wechat/mp-callback` | 测试号回调校验 |
| Wechat | POST | `/wechat/mp-callback` | 接收测试号消息，完成绑定 |

**合计 54 个接口**，覆盖 V0.1 全部功能。

> **v0.2.9 新增 1 个**：`DELETE /auth/account`（注销账号，提审硬性要求）。

> **v0.2.1 新增 5 个**：`/notify/mp-bind/*`（3 个）+ `/internal/notify/bind-mp-openid` + `/wechat/mp-callback`（2 个方法）。
> 全部服务于 wxpush 推送通道，详见 `docs/08-wxpush推送集成方案.md`。
