# 02 · API 接口设计

**版本：** v0.2.4
**协议：** HTTPS + REST + JSON
**Base URL：** `https://<云托管服务名>.ap-shanghai.run.tcloudbase.com/api`
**鉴权：** `Authorization: Bearer <JWT>`（除 `/auth/login`、`/wechat/mp-callback` 外全部必填）

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
| `category` | 可选，限定分类 |
| `excludeRecent` | 是否排除最近 3 天吃过的（默认 `true`） |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      { "id": 1, "name": "番茄炒蛋", "category": "家常菜", "imageUrl": null, "source": "SYSTEM" },
      { "id": 2, "name": "炒青菜",   "category": "素菜",   "imageUrl": null, "source": "SYSTEM" }
    ],
    "poolSize": 18
  }
}
```

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
        "id": 1,
        "name": "番茄炒蛋",
        "category": "家常菜",
        "imageUrl": null,
        "source": "SYSTEM",
        "enabled": true,
        "canEdit": false
      }
    ],
    "page": 1, "pageSize": 50, "total": 20, "hasMore": false
  }
}
```

> `canEdit` 仅家庭自定义菜谱为 `true`。系统菜谱前端不展示编辑入口。

### 6.3 新增家庭自定义菜谱

```http
POST /api/menu/items
```

**请求：**

```json
{ "familyId": 10001, "name": "可乐鸡翅", "category": "家常菜", "imageUrl": null }
```

### 6.4 修改菜谱

```http
PATCH /api/menu/items/{id}
```

**权限：** 仅家庭自定义菜谱（`family_id` 不为 NULL 且属于该家庭）。

### 6.5 停用/启用菜谱

```http
PATCH /api/menu/items/{id}/enabled
```

**请求：** `{ "enabled": false }`

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
    { "menuItemId": 1, "name": "番茄炒蛋" },
    { "menuItemId": 7, "name": "炒青菜" }
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
    "summary": "今晚吃：番茄炒蛋、炒青菜"
  }
}
```

> 写入 `meal_records`。`name` 做快照冗余，菜单后续被删也不影响历史。

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
    { "menuItemId": 1, "name": "番茄炒蛋" },
    { "menuItemId": 7, "name": "炒青菜" }
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

---

## 七、留个念 `/memories`

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
    { "fileUrl": "https://.../a.jpg", "fileType": "image/jpeg", "width": 1600, "height": 1200, "sortNo": 0 }
  ]
}
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 60001,
    "content": "宝宝今天第一次自己穿鞋。",
    "visibility": "FAMILY",
    "creator": { "memberId": 20002, "roleName": "阿妈", "avatarUrl": "https://..." },
    "attachments": [{ "id": 1, "fileUrl": "https://...", "width": 1600, "height": 1200 }],
    "createdAt": "2026-09-28 19:32:00"
  }
}
```

### 7.2 家庭时间线

```http
GET /api/memories?familyId=10001&cursor=1759000000000&limit=20
```

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 60001,
        "date": "2026-09-28",
        "content": "宝宝今天第一次自己穿鞋。",
        "visibility": "FAMILY",
        "creator": { "memberId": 20002, "roleName": "阿妈", "avatarUrl": "https://..." },
        "attachments": [{ "id": 1, "fileUrl": "https://...", "width": 1600, "height": 1200 }],
        "createdAt": "2026-09-28 19:32:00"
      }
    ],
    "nextCursor": "1758900000000",
    "hasMore": true
  }
}
```

> **隐私过滤**：`visibility=PRIVATE` 且 `creator_member_id != 当前成员` 的记录不返回。

### 7.3 记录详情

```http
GET /api/memories/{id}
```

### 7.4 编辑记录

```http
PATCH /api/memories/{id}
```

**权限：** 仅发布者。

### 7.5 删除记录

```http
DELETE /api/memories/{id}
```

**权限：** 仅发布者。`status=0` 逻辑删除。

---

## 八、上传 `/upload`

### 8.1 上传图片

```http
POST /api/upload/image
Content-Type: multipart/form-data
```

**表单字段：**

| 字段 | 说明 |
| --- | --- |
| `file` | 图片文件，≤ 5MB，仅 `jpg/jpeg/png/webp` |
| `scene` | 场景：`AVATAR` / `MEMORY` / `MENU` |

**响应：**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "fileUrl": "https://.../memories/2026/09/xxx.jpg",
    "fileType": "image/jpeg",
    "fileSize": 342100,
    "width": 1600,
    "height": 1200
  }
}
```

**失败：** `40002` 内容安全检测未通过。

---

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
        "title": "阿爸已经把「买牛奶」搞定啦",
        "content": "阿妈，阿爸把「买牛奶」弄好啦\n辛苦啦 🎉",
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

**`channel` / `status` 取值**：见 `NotifyChannel` / `NotifyStatus`。
小程序端据此在条目上展示「已推送到微信 / 已推送 / 对方打开小程序可见」，
让发起人知道**到底叮到了没有**（PRD 6.5.6）。

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

**合计 53 个接口**，覆盖 V0.1 全部功能。

> **v0.2.1 新增 5 个**：`/notify/mp-bind/*`（3 个）+ `/internal/notify/bind-mp-openid` + `/wechat/mp-callback`（2 个方法）。
> 全部服务于 wxpush 推送通道，详见 `docs/08-wxpush推送集成方案.md`。
