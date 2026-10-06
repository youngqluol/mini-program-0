# MySQL 数据库设计

> **版本：v0.2.2** ｜ 最后更新：2026-10-06
>
> **本文档的定位：** 解释每张表**为什么**这样设计。
> **可执行 DDL 在 [`db/schema.sql`](../db/schema.sql)**——那是唯一真相。本文与它冲突时，以 schema.sql 为准。
>
> **v0.2.2 相对 v0.2.1 的变化：**
> 1. `thing_reminders` / `notification_logs` 各新增 `read_at`（已读时刻，`NULL` = 未读，见第八、十三章）
> 2. **勘误**：§八 `thing_reminders` 的 DDL 补齐 `sent_count` / `next_remind_at`，索引名由 `idx_remind_at_status` 更正为 `idx_next_remind`（以 schema.sql 为准）
>
> **v0.2.1 相对 v0.1 的变化：**
> 1. `users` 新增 `mp_openid` / `mp_bound_at`（公众号推送绑定，见第二章）
> 2. `menu_items` 不再承载系统菜谱（改为代码常量，见第九章）
> 3. `notification_logs` 渠道扩为三档、状态扩为五档（见第十三章）
> 4. 全库统一「状态位逻辑删除」，不做物理 DELETE

---

## 一、数据库整体关系

核心关系可以理解成：

```text
users
  │
  ├──────────────┐
  ↓              ↓
family_members   family_invites
  │
  ↓
families
  │
  ├────────────── family_things
  │                       │
  │                       └── thing_reminders
  │
  ├────────────── menu_items
  │                       │
  │                       └── meal_records
  │
  └────────────── family_memories
                          │
                          └── memory_attachments
```

另外：

```text
notification_logs
```

负责记录消息发送情况。

---

# 二、users 用户表

用户是独立于家庭存在的。

```sql
CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',

    openid VARCHAR(64) NOT NULL COMMENT '微信openid（小程序内唯一）',
    unionid VARCHAR(64) DEFAULT NULL COMMENT '微信unionid',

    mp_openid VARCHAR(64) DEFAULT NULL COMMENT '公众号openid（推送用，与小程序openid不同值）',
    mp_bound_at DATETIME DEFAULT NULL COMMENT '公众号提醒绑定时间',

    nickname VARCHAR(50) DEFAULT NULL COMMENT '用户昵称',
    avatar_url VARCHAR(500) DEFAULT NULL COMMENT '头像地址',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1正常 0禁用',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uk_openid (openid),
    UNIQUE KEY uk_mp_openid (mp_openid),
    KEY idx_unionid (unionid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';
```

### 为什么会有两个 openid？

**openid 是「用户 × 应用」维度的。** 同一个人在**小程序**里有一个 openid，在**公众号**里有**另一个** openid，两者无法互相推导。

```
用户 A
├── 小程序 openid  →  oX1a...   （登录身份）
└── 公众号 openid  →  oZ9b...   （推送收件地址）
```

所以推送通道要用的公众号 openid 必须**单独一列** `mp_openid` 存。
绑定链路（绑定码 + 消息回调）见 [`08-wxpush推送集成方案.md`](08-wxpush推送集成方案.md) 第四章。

`uk_mp_openid` 保证一个公众号 openid 只能绑定一个用户，防止串号。

---

这里有一个重要点：

### 不要把家庭称谓放到 users

不要：

```text
users
├── nickname
└── role_name  ❌
```

因为同一个用户可以：

```text
我们家 → 阿爸
爸妈家 → 儿子
```

所以称谓必须放在：

```text
family_members.role_name
```

---

# 三、families 家庭表

```sql
CREATE TABLE families (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '家庭ID',

    name VARCHAR(50) NOT NULL COMMENT '家庭名称',

    owner_member_id BIGINT UNSIGNED DEFAULT NULL COMMENT '家庭创建者成员ID',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1正常 0解散',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_owner_member (owner_member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭表';
```

这里暂时保留 `owner_member_id`。

但是创建家庭时会出现一个顺序问题：

```text
创建 family
    ↓
创建 family_member
    ↓
回写 owner_member_id
```

所以这个字段允许 `NULL`，创建完成后再更新。

---

# 四、family_members 家庭成员表

这是整个系统非常核心的一张表。

```sql
CREATE TABLE family_members (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '家庭成员ID',

    family_id BIGINT UNSIGNED NOT NULL COMMENT '家庭ID',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',

    role_name VARCHAR(30) NOT NULL COMMENT '家庭称谓，例如阿爸、阿妈、奶奶',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1正常 0退出',

    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
    left_at DATETIME DEFAULT NULL COMMENT '退出时间',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uk_family_user (family_id, user_id),

    KEY idx_user_id (user_id),
    KEY idx_family_id (family_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭成员表';
```

这里：

```text
family_id + user_id
```

唯一。

意味着：

> 一个用户不能重复加入同一个家庭。

但是：

```text
user A + family A
user A + family B
```

是完全允许的。

---

# 五、family_invites 家庭邀请

家庭成员加入需要邀请机制。

```sql
CREATE TABLE family_invites (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '邀请ID',

    family_id BIGINT UNSIGNED NOT NULL COMMENT '家庭ID',
    inviter_member_id BIGINT UNSIGNED NOT NULL COMMENT '邀请人',

    invite_code VARCHAR(32) NOT NULL COMMENT '邀请码',

    expire_at DATETIME DEFAULT NULL COMMENT '过期时间',
    used_at DATETIME DEFAULT NULL COMMENT '使用时间',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 2已使用 3已过期 4已取消',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uk_invite_code (invite_code),

    KEY idx_family_id (family_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭邀请表';
```

例如：

```text
阿妈
 ↓
邀请
 ↓
生成邀请链接
 ↓
阿爸点击
 ↓
微信小程序
 ↓
加入“我们家”
 ↓
填写家庭称谓：阿爸
```

---

# 六、family_things 小事表

这是整个系统最核心的表。

```sql
CREATE TABLE family_things (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '小事ID',

    family_id BIGINT UNSIGNED NOT NULL COMMENT '家庭ID',

    creator_member_id BIGINT UNSIGNED NOT NULL COMMENT '创建人',

    type TINYINT NOT NULL COMMENT '类型：1任务 2提醒',

    title VARCHAR(200) NOT NULL COMMENT '小事标题',
    content VARCHAR(1000) DEFAULT NULL COMMENT '详细内容',

    assignee_member_id BIGINT UNSIGNED DEFAULT NULL COMMENT '执行人/提醒对象',

    visibility TINYINT NOT NULL DEFAULT 1 COMMENT '可见范围：1家庭可见 2仅相关人员',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1待处理 2已完成 3已取消',

    due_at DATETIME DEFAULT NULL COMMENT '要求完成时间',

    completed_at DATETIME DEFAULT NULL COMMENT '完成时间',
    completed_by_member_id BIGINT UNSIGNED DEFAULT NULL COMMENT '完成者',

    cancelled_at DATETIME DEFAULT NULL COMMENT '取消时间',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_family_status (family_id, status),
    KEY idx_family_created (family_id, created_at),
    KEY idx_assignee_status (assignee_member_id, status),
    KEY idx_creator (creator_member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭小事表';
```

---

# 七、这里有一个非常重要的设计

虽然数据库叫：

```text
family_things
```

但前端不要让用户看到“小事”。

用户看到的是：

```text
🎯 派活
🔔 叮一下
```

“小事”只是我们内部的领域模型。

例如：

```text
family_things
----------------
type = TASK
title = 买牛奶
assignee = 阿爸
```

前端显示：

> 🎯 派活
> 买牛奶
> → 阿爸

而：

```text
type = REMINDER
title = 明天带水杯
assignee = 宝宝
```

前端显示：

> 🔔 叮一下
> 明天带水杯
> → 宝宝

这样产品语言和技术模型就可以分离。

---

# 八、thing_reminders 提醒表

```sql
CREATE TABLE thing_reminders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '提醒ID',

    thing_id BIGINT UNSIGNED NOT NULL COMMENT '小事ID',

    recipient_member_id BIGINT UNSIGNED NOT NULL COMMENT '提醒对象',

    remind_type TINYINT NOT NULL COMMENT '提醒类型：1立即 2定时',

    remind_at DATETIME DEFAULT NULL COMMENT '提醒时间',

    recurrence_type TINYINT NOT NULL DEFAULT 0 COMMENT '重复类型：0不重复 1每天 2每周 3每月 4自定义',

    recurrence_config JSON DEFAULT NULL COMMENT '重复规则配置',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '1待发送 2已发送 3已取消',

    sent_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计发送次数',

    last_sent_at DATETIME DEFAULT NULL COMMENT '最近发送时间',

    next_remind_at DATETIME DEFAULT NULL COMMENT '下一次触发时间（调度扫描用）',

    read_at DATETIME DEFAULT NULL COMMENT '接收人已读时间（NULL=未读）',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_next_remind (next_remind_at, status),
    KEY idx_thing_id (thing_id),
    KEY idx_recipient (recipient_member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小事提醒表';
```

> **v0.2.2 勘误（2026-10-06）**：本段的 DDL 之前与 `db/schema.sql` 漂移 ——
> 缺了 `sent_count`、`next_remind_at` 两个字段，索引名写的是 `idx_remind_at_status`
> 而实际是 `idx_next_remind`。已按 `db/schema.sql`（DDL 唯一真相）对齐，
> 并补上 `read_at`。
>
> `read_at` 的存在理由：`GET /reminders/inbox` 需要「已读 / 未读数 / 全部已读」
> 三件事（docs/02 §5.4），**一个 `read_at` 就够了** —— NULL 表示未读，非 NULL
> 既表示已读也记录了时刻。不再另建 `is_read TINYINT`，避免两个字段互相矛盾。
> 查询「我的未读」走已有的 `idx_recipient`，不需要新索引。

例如：

### 每天晚上 8 点

```json
{
  "time": "20:00"
}
```

### 每周一、三、五

```json
{
  "weekdays": [1, 3, 5],
  "time": "20:00"
}
```

第一版用 JSON 保存重复规则即可。

**不要为了重复规则再拆五六张表。**

---

# 九、menu_items 菜单表

```sql
CREATE TABLE menu_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '菜单ID',

    family_id BIGINT UNSIGNED DEFAULT NULL COMMENT '家庭ID，NULL表示系统菜单',

    name VARCHAR(100) NOT NULL COMMENT '菜名',

    category VARCHAR(50) DEFAULT NULL COMMENT '分类',

    image_url VARCHAR(500) DEFAULT NULL COMMENT '图片',

    enabled TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',

    sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',

    created_by_member_id BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_family_enabled (family_id, enabled),
    KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜单表';
```

这里一个设计比较漂亮：

```text
family_id = NULL
```

表示：

> 系统菜单

例如：

```text
番茄炒蛋
红烧肉
鱼香肉丝
```

而：

```text
family_id = 10001
```

表示：

> 这个家庭自己添加的菜单。

这样不需要：

```text
system_menu
family_menu
```

两套表。

---

### ⚠️ v0.2.1 修订：系统菜谱不再入库

上面的「`family_id = NULL` 表示系统菜单」是 v0.1 的想法。落地时**改了**：

> **系统菜谱（约 60–80 条）改为写死在代码常量里**（`miniprogram/config/default-menu.ts`），不再往 `menu_items` 塞系统数据。

理由：

| 考虑 | 说明 |
| --- | --- |
| 系统菜谱是**静态内容** | 不需要查询、不需要关联、不会变，放数据库只会让「新建家庭」多一步 seed |
| 零配置 | 第一次打开就有菜可抽，不用等初始化 |
| 迭代方便 | 改菜谱只需改代码，不用写迁移脚本 |

因此 **V0.1 的 `menu_items` 只承载「家庭自定义菜谱」，`family_id` 恒非空。**
字段仍保留 `NULL` 语义，为 V0.3「联网菜谱库 / AI 推荐」预留。

随机决策时，把「代码常量 + 本家庭自定义」在内存里合并成候选池。

---

# 十、meal_records 用餐记录

“吃啥呢”不能只保存菜单。

我们还应该记录：

> 今天最终吃了什么。

```sql
CREATE TABLE meal_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用餐记录ID',

    family_id BIGINT UNSIGNED NOT NULL COMMENT '家庭ID',

    menu_item_id BIGINT UNSIGNED DEFAULT NULL COMMENT '菜单ID',

    meal_date DATE NOT NULL COMMENT '用餐日期',

    meal_type TINYINT NOT NULL COMMENT '餐次：1早餐 2午餐 3晚餐 4其他',

    name VARCHAR(100) NOT NULL COMMENT '最终菜名',

    created_by_member_id BIGINT UNSIGNED NOT NULL COMMENT '记录人',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_family_date (family_id, meal_date),
    KEY idx_menu_item (menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭用餐记录';
```

为什么还需要：

```text
name
```

而不是只保存 `menu_item_id`？

因为菜单以后可能被删除。

但：

> 2026-09-26 晚餐吃了番茄炒蛋

这个历史事实应该一直存在。

---

# 十一、family_memories 留个念

```sql
CREATE TABLE family_memories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',

    family_id BIGINT UNSIGNED NOT NULL COMMENT '家庭ID',

    creator_member_id BIGINT UNSIGNED NOT NULL COMMENT '发布人',

    content TEXT NOT NULL COMMENT '记录内容',

    visibility TINYINT NOT NULL DEFAULT 1 COMMENT '1家庭可见 2仅自己可见',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_family_created (family_id, created_at),
    KEY idx_creator (creator_member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭记录表';
```

---

# 十二、memory_attachments 图片附件

```sql
CREATE TABLE memory_attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '附件ID',

    memory_id BIGINT UNSIGNED NOT NULL COMMENT '记录ID',

    file_url VARCHAR(500) NOT NULL COMMENT '文件地址',

    file_type VARCHAR(30) DEFAULT NULL COMMENT '文件类型',

    sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_memory_id (memory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家庭记录附件表';
```

第一版只支持：

```text
图片
```

就够了。

视频先不要做。

---

# 十三、notification_logs 通知记录

这一张表很重要。

因为未来你一定会遇到：

> “为什么阿爸没有收到通知？”

所以不要只发送消息而不记录。

```sql
CREATE TABLE notification_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知记录ID',

    user_id BIGINT UNSIGNED NOT NULL COMMENT '接收用户',

    family_id BIGINT UNSIGNED DEFAULT NULL COMMENT '家庭ID',

    thing_id BIGINT UNSIGNED DEFAULT NULL COMMENT '关联小事',

    type TINYINT NOT NULL COMMENT '通知类型：1派活通知 2叮一下提醒 3完成回执 4加入家庭 5系统',

    title VARCHAR(200) NOT NULL COMMENT '通知标题',

    content VARCHAR(1000) DEFAULT NULL COMMENT '通知内容',

    channel TINYINT NOT NULL COMMENT '发送渠道：1微信订阅消息 2站内消息 3公众号模板消息(wxpush)',

    template_id VARCHAR(64) DEFAULT NULL COMMENT '模板ID（渠道1为订阅消息模板，渠道3为公众号模板）',

    status TINYINT NOT NULL DEFAULT 1 COMMENT '1待发送 2发送成功 3发送失败 4无订阅额度跳过 5未绑定提醒跳过',

    retry_count TINYINT NOT NULL DEFAULT 0 COMMENT '重试次数',

    sent_at DATETIME DEFAULT NULL COMMENT '发送时间',

    error_code VARCHAR(32) DEFAULT NULL COMMENT '微信返回错误码，例如 43101',

    error_message VARCHAR(1000) DEFAULT NULL COMMENT '失败原因',

    read_at DATETIME DEFAULT NULL COMMENT '接收人已读时间（NULL=未读）',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_user_created (user_id, created_at),
    KEY idx_status (status),
    KEY idx_thing_id (thing_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知记录表';
```

> **v0.2.2 补充（2026-10-06）**：新增 `read_at`，供消息中心的
> 「已读 / 未读数 / 全部已读」使用（docs/02 §9）。
>
> ⚠️ 它与 `thing_reminders.read_at` 是**两条独立记录**，各自维护已读状态：
> 一条提醒会同时产生一条 `thing_reminders`（供 `/reminders/inbox` 收件箱）
> 和一条 `notification_logs`（供消息中心 + 发送留痕）。它们是两个不同的用户
> 入口，不该互相耦合 —— 在收件箱里读过，不等于在消息中心里也读过。
> 查询「我的未读」走已有的 `idx_user_created`，不需要新索引。

### 为什么 channel 有三档、status 有五档？

因为消息送达是**四通道降级**的，一条通知可能经过多档尝试：

| channel | 含义 | 说明 |
| --- | --- | --- |
| 1 | 微信订阅消息 | 需用户授权，一次授权一条 |
| 2 | 站内消息 | 永不失败，进「我的 · 消息中心」 |
| 3 | 公众号模板消息 | wxpush 通道，无次数限制 |

| status | 含义 | 处理 |
| --- | --- | --- |
| 1 | 待发送 | 已落库，等待投递 |
| 2 | 发送成功 | — |
| 3 | 发送失败 | 记 `error_code` / `error_message` |
| 4 | 无订阅额度跳过 | 降级到下一通道 |
| 5 | 未绑定提醒跳过 | 用户没绑公众号，降级到站内 |

> 为什么要记录「跳过」而不是不记录？——因为排查时要能回答
> 「这条提醒到底试过哪些通道、卡在哪一环」。
> 详见 [`08-wxpush推送集成方案.md`](08-wxpush推送集成方案.md) 第十章「通知记录状态映射」。

以后排查：

```text
阿爸为什么没收到？

        ↓

notification_logs

        ↓

status = 3

        ↓

error_message
```

就能找到原因。

---

# 十四、最终 11 张核心表

```text
用户与家庭

users
families
family_members
family_invites


核心事务

family_things
thing_reminders


吃啥呢

menu_items        ← 只存家庭自定义菜（系统菜谱在代码里）
meal_records


留个念

family_memories
memory_attachments


通知

notification_logs
```

这套结构已经可以支撑第一版完整产品。

---

# 十五、一个真实场景走数据库

假设阿妈说：

> “阿爸，明天下班帮我买牛奶，5点半提醒一下。”

数据库实际上会产生：

```text
family_things

id: 10001
type: TASK
title: 买牛奶
creator: 阿妈
assignee: 阿爸
due_at: 明天 18:00
status: PENDING
visibility: FAMILY
```

然后：

```text
thing_reminders

thing_id: 10001
recipient: 阿爸
remind_type: SCHEDULED
remind_at: 明天 17:30
status: PENDING
```

17:30：

```text
定时任务
   ↓
扫描 thing_reminders
   ↓
发现到时间
   ↓
创建 notification_logs
   ↓
发送微信通知
   ↓
成功
   ↓
status = SENT
```

阿爸点进去：

> 🥛 买牛奶
> 阿妈让你明天下班买牛奶

点击：

**“搞定了”**

然后：

```text
family_things.status
        ↓
COMPLETED
```

同时：

```text
completed_at
completed_by_member_id
```

被记录下来。

再创建一条通知给阿妈：

> ❤️ 阿爸已经把「买牛奶」搞定啦

整个闭环完成。

---

# 十六、数据库设计暂时不要做的东西

下面这些我建议**明确禁止自己在第一版加进去**：

```text
❌ 积分
❌ 勋章
❌ 排行榜
❌ 家庭PK
❌ 聊天
❌ 评论
❌ 点赞
❌ 好友
❌ 动态广场
❌ 复杂角色权限
❌ 多人协作任务
❌ 子任务
❌ 任务审批
❌ 任务优先级系统
❌ AI聊天
❌ 家庭账本
❌ 购物商城
```

尤其是：

> **不要把它做成一个“家庭版飞书”。**

“家有小事”的价值恰恰在于：

> **简单到家里人愿意每天用。**

---

# 十七、下一阶段技术架构

数据库确定之后，后端其实也可以非常简单：

```text
              微信小程序
                  │
                  ↓
            微信云托管（网关）
                  │
                  ↓
                NestJS
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
      MySQL     Redis     COS/云存储
        │
        │
        ↓
   定时任务 / 消息任务
        │
        ↓
   消息送达（四通道降级）
   ① 公众号模板消息（wxpush / Cloudflare Workers）
   ② 小程序订阅消息
   ③ 站内消息
   ④ 首页兜底
```

其中：

### MySQL

保存业务数据。

### Redis

主要用于：

```text
登录状态
验证码/临时数据
定时任务锁
幂等控制
公众号绑定码（mpbind:code:* / mpbind:user:*）
缓存
```

### COS / 云存储

保存：

```text
头像
家庭照片
留个念图片
```

### 后台任务

负责：

```text
到时间了吗？
    ↓
需要提醒吗？
    ↓
按优先级尝试各通道
    ↓
记录结果
```

> **技术栈已定：NestJS + Prisma + 微信云托管**（v0.1 里写的「NestJS / Java」二选一已收敛）。
> 选型对比见 [`01-技术架构与技术选型.md`](01-技术架构与技术选型.md) 第 3.0 节。

---

