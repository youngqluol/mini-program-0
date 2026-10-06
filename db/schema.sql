-- =============================================================
-- 《家有小事》数据库建表脚本  v0.2.2
-- 目标数据库：MySQL 8.0（微信云托管 MySQL 实例）
-- 字符集：utf8mb4 / utf8mb4_unicode_ci
-- 说明：在 v0.1 设计基础上补齐缺失字段、索引与初始化数据，
--       并统一删除策略为「状态位逻辑删除，不做物理删除」。
--       v0.2.1 新增 users.mp_openid（公众号推送绑定）。
--       v0.2.2 明确时区约定（见下）。
--
-- ⚠️ 时区约定（改之前先读 docs/01 §4.3）：
--   本库的 DATETIME **存 UTC**，不存北京时间。
--   原因：Prisma 的 MySQL 连接器固定按 UTC 读写 DATETIME，且不支持
--         连接串里的 timezone 参数（prisma/orm#29517 至今 open）。
--   因此：
--     · MySQL 会话时区必须是 +00:00（docker-compose 已设）
--     · 下面的 DEFAULT CURRENT_TIMESTAMP 只在**绕过 Prisma 直连写库**时生效，
--       此时它产出的是 UTC，与 Prisma 的读写口径一致
--     · 正常业务路径的时间戳由 Prisma 侧生成（@default(now()) / @updatedAt），
--       不会用到这里的 DEFAULT
--   北京时间只在接口层格式化输出（server/src/common/serialize/beijing-time.ts）。
--
-- 执行方式：
--   mysql -h <host> -P <port> -u <user> -p < schema.sql
-- 幂等：所有 DDL 均为 IF NOT EXISTS，可重复执行。
-- =============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------
-- 一、用户与家庭
-- -------------------------------------------------------------

-- 1. users 用户表
-- 用户是独立于家庭存在的实体。家庭称谓绝不能放在这里。
CREATE TABLE IF NOT EXISTS `users` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
    `openid`        VARCHAR(64)     NOT NULL                COMMENT '微信 openid（小程序内唯一）',
    `unionid`       VARCHAR(64)     DEFAULT NULL            COMMENT '微信 unionid（同一开放平台下唯一）',
    `mp_openid`     VARCHAR(64)     DEFAULT NULL            COMMENT '公众号 openid（wxpush 推送用，与小程序 openid 不同值）',
    `mp_bound_at`   DATETIME        DEFAULT NULL            COMMENT '公众号提醒绑定时间',
    `nickname`      VARCHAR(50)     DEFAULT NULL            COMMENT '用户昵称',
    `avatar_url`    VARCHAR(500)    DEFAULT NULL            COMMENT '头像地址',
    `status`        TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1正常 0禁用',
    `last_login_at` DATETIME        DEFAULT NULL            COMMENT '最近登录时间',
    `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_openid` (`openid`),
    UNIQUE KEY `uk_mp_openid` (`mp_openid`),
    KEY `idx_unionid` (`unionid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';


-- 2. families 家庭表
-- 创建家庭存在「先建 family 再建 member 再回写 owner」的顺序问题，
-- 因此 owner_member_id 允许 NULL。
CREATE TABLE IF NOT EXISTS `families` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '家庭ID',
    `name`            VARCHAR(50)     NOT NULL                COMMENT '家庭名称，例如：我们家',
    `owner_member_id` BIGINT UNSIGNED DEFAULT NULL            COMMENT '家庭创建者成员ID',
    `status`          TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1正常 0已解散',
    `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_owner_member` (`owner_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭表';


-- 3. family_members 家庭成员表（核心表）
-- 关键设计：role_name（称谓）属于「用户 × 家庭」这个关系，不属于用户。
-- 同一用户在不同家庭可以有不同称谓：我们家→阿爸，爸妈家→儿子。
CREATE TABLE IF NOT EXISTS `family_members` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '家庭成员ID',
    `family_id`  BIGINT UNSIGNED NOT NULL                COMMENT '家庭ID',
    `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT '用户ID',
    `role_name`  VARCHAR(30)     NOT NULL                COMMENT '家庭称谓，例如：阿爸、阿妈、阿公、阿嬷',
    `status`     TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1正常 0已退出',
    `joined_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
    `left_at`    DATETIME        DEFAULT NULL            COMMENT '退出时间',
    `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_family_user` (`family_id`, `user_id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_family_id` (`family_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭成员表';


-- 4. family_invites 家庭邀请表
-- v0.1 补充：used_by_user_id / used_by_member_id，用于追溯「谁用了这个邀请码」。
CREATE TABLE IF NOT EXISTS `family_invites` (
    `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '邀请ID',
    `family_id`          BIGINT UNSIGNED NOT NULL                COMMENT '家庭ID',
    `inviter_member_id`  BIGINT UNSIGNED NOT NULL                COMMENT '邀请人成员ID',
    `invite_code`        VARCHAR(32)     NOT NULL                COMMENT '邀请码（唯一）',
    `expire_at`          DATETIME        DEFAULT NULL            COMMENT '过期时间',
    `used_at`            DATETIME        DEFAULT NULL            COMMENT '使用时间',
    `used_by_user_id`    BIGINT UNSIGNED DEFAULT NULL            COMMENT '使用者用户ID',
    `used_by_member_id`  BIGINT UNSIGNED DEFAULT NULL            COMMENT '使用者成员ID',
    `status`             TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1有效 2已使用 3已过期 4已取消',
    `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_invite_code` (`invite_code`),
    KEY `idx_family_id` (`family_id`),
    KEY `idx_status_expire` (`status`, `expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭邀请表';


-- -------------------------------------------------------------
-- 二、核心事务：小事（派活 / 叮一下）
-- -------------------------------------------------------------

-- 5. family_things 家庭小事表（整个系统最核心的表）
-- 前端永远不出现「小事」这个词，用户只看到 🎯派活 / 🔔叮一下。
-- type=1 TASK 派活，type=2 REMINDER 叮一下。
CREATE TABLE IF NOT EXISTS `family_things` (
    `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '小事ID',
    `family_id`               BIGINT UNSIGNED NOT NULL                COMMENT '家庭ID',
    `creator_member_id`       BIGINT UNSIGNED NOT NULL                COMMENT '创建人（派活人/提醒发起人）',
    `type`                    TINYINT         NOT NULL                COMMENT '类型：1任务（派活） 2提醒（叮一下）',
    `title`                   VARCHAR(200)    NOT NULL                COMMENT '小事标题，例如：买牛奶',
    `content`                 VARCHAR(1000)   DEFAULT NULL            COMMENT '详细内容 / 备注',
    `assignee_member_id`      BIGINT UNSIGNED DEFAULT NULL            COMMENT '执行人 / 提醒对象',
    `visibility`              TINYINT         NOT NULL DEFAULT 1      COMMENT '可见范围：1家庭可见 2仅相关人员可见',
    `status`                  TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1待处理 2已完成 3已取消',
    `due_at`                  DATETIME        DEFAULT NULL            COMMENT '要求完成时间（不限时间则为 NULL）',
    -- 重复任务（V0.1 支持 每天/每周/每月，自定义规则 V0.2 开放）
    `recurrence_type`         TINYINT         NOT NULL DEFAULT 0      COMMENT '重复类型：0不重复 1每天 2每周 3每月 4自定义',
    `recurrence_config`       JSON            DEFAULT NULL            COMMENT '重复规则配置，例如 {"weekdays":[6],"time":"09:00"}',
    `source_thing_id`         BIGINT UNSIGNED DEFAULT NULL            COMMENT '由哪条重复任务生成（用于追溯重复链）',
    -- 完成 / 取消
    `completed_at`            DATETIME        DEFAULT NULL            COMMENT '完成时间',
    `completed_by_member_id`  BIGINT UNSIGNED DEFAULT NULL            COMMENT '实际完成者',
    `cancelled_at`            DATETIME        DEFAULT NULL            COMMENT '取消时间',
    `created_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_family_status_due` (`family_id`, `status`, `due_at`),
    KEY `idx_family_type_created` (`family_id`, `type`, `created_at`),
    KEY `idx_assignee_status` (`assignee_member_id`, `status`),
    KEY `idx_creator` (`creator_member_id`),
    KEY `idx_source_thing` (`source_thing_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭小事表（派活/叮一下统一承载）';


-- 6. thing_reminders 提醒表
-- 一条小事可以有 0..n 条提醒。支持立即叮 / 定时叮 / 重复叮。
CREATE TABLE IF NOT EXISTS `thing_reminders` (
    `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '提醒ID',
    `thing_id`             BIGINT UNSIGNED NOT NULL                COMMENT '小事ID',
    `recipient_member_id`  BIGINT UNSIGNED NOT NULL                COMMENT '提醒对象（接收人）',
    `remind_type`          TINYINT         NOT NULL                COMMENT '提醒类型：1立即 2定时',
    `remind_at`            DATETIME        DEFAULT NULL            COMMENT '提醒时间（定时时必填）',
    `recurrence_type`      TINYINT         NOT NULL DEFAULT 0      COMMENT '重复类型：0不重复 1每天 2每周 3每月 4自定义',
    `recurrence_config`    JSON            DEFAULT NULL            COMMENT '重复规则配置',
    `status`               TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1待发送 2已发送 3已取消',
    `sent_count`           INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '累计发送次数',
    `last_sent_at`         DATETIME        DEFAULT NULL            COMMENT '最近发送时间',
    `next_remind_at`       DATETIME        DEFAULT NULL            COMMENT '下一次触发时间（调度扫描用）',
    -- v0.2 补充：提醒收件箱（docs/02 §5.4）需要「已读 / 未读数 / 全部已读」。
    -- 用单个 read_at 表达三件事：NULL = 未读，非 NULL = 已读（同时也是已读时刻）。
    -- 比再建一个 is_read TINYINT 少一个字段、少一次「两个字段互相矛盾」的机会。
    `read_at`              DATETIME        DEFAULT NULL            COMMENT '接收人已读时间（NULL=未读）',
    `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_next_remind` (`next_remind_at`, `status`),
    KEY `idx_thing_id` (`thing_id`),
    KEY `idx_recipient` (`recipient_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小事提醒表';


-- -------------------------------------------------------------
-- 三、吃啥呢
-- -------------------------------------------------------------

-- 7. menu_items 菜单表
-- 【v0.2 变更】系统默认菜谱改为「写死在代码常量」中（miniprogram/config/default-menu.ts，
-- 约 60-80 条），第一次打开即可用、零配置，不再往这张表里塞系统数据。
-- 因此本表 V0.1 只承载「家庭自定义菜谱」，family_id 恒非空。
-- 字段仍保留 NULL 语义，为 V0.3「联网菜谱库 / AI 推荐」预留。
CREATE TABLE IF NOT EXISTS `menu_items` (
    `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '菜单ID',
    `family_id`            BIGINT UNSIGNED DEFAULT NULL            COMMENT '家庭ID，NULL 表示系统菜谱',
    `name`                 VARCHAR(100)    NOT NULL                COMMENT '菜名',
    `category`             VARCHAR(50)     DEFAULT NULL            COMMENT '分类，例如：家常菜、汤、主食',
    `image_url`            VARCHAR(500)    DEFAULT NULL            COMMENT '图片地址',
    `enabled`              TINYINT         NOT NULL DEFAULT 1      COMMENT '是否启用：1启用 0停用',
    `sort_no`              INT             NOT NULL DEFAULT 0      COMMENT '排序，越小越靠前',
    `created_by_member_id` BIGINT UNSIGNED DEFAULT NULL            COMMENT '创建人（系统菜谱为 NULL）',
    `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_family_enabled` (`family_id`, `enabled`),
    KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜单表（系统菜谱 + 家庭自定义）';


-- 8. meal_records 用餐记录表
-- 冗余 name 字段的原因：菜单可能被删除，但「9月26日晚餐吃了番茄炒蛋」这个
-- 历史事实必须永久保留。
CREATE TABLE IF NOT EXISTS `meal_records` (
    `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用餐记录ID',
    `family_id`            BIGINT UNSIGNED NOT NULL                COMMENT '家庭ID',
    `menu_item_id`         BIGINT UNSIGNED DEFAULT NULL            COMMENT '菜单ID（可能为空，允许记录自定义菜）',
    `meal_date`            DATE            NOT NULL                COMMENT '用餐日期',
    `meal_type`            TINYINT         NOT NULL                COMMENT '餐次：1早餐 2午餐 3晚餐 4其他',
    `name`                 VARCHAR(100)    NOT NULL                COMMENT '最终菜名（历史快照）',
    `created_by_member_id` BIGINT UNSIGNED NOT NULL                COMMENT '记录人',
    `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_family_date` (`family_id`, `meal_date`),
    KEY `idx_menu_item` (`menu_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭用餐记录';


-- -------------------------------------------------------------
-- 四、留个念
-- -------------------------------------------------------------

-- 9. family_memories 家庭记录表
-- 【v0.2 新增】thing_id：关联「完成一件小事后顺手记的念」。
--   NULL      = 独立留念（随手记一笔）
--   非 NULL   = 完成纪念（PRD 第十九章）
CREATE TABLE IF NOT EXISTS `family_memories` (
    `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
    `family_id`          BIGINT UNSIGNED NOT NULL                COMMENT '家庭ID',
    `creator_member_id`  BIGINT UNSIGNED NOT NULL                COMMENT '发布人',
    `content`            TEXT            NOT NULL                COMMENT '记录内容',
    `thing_id`           BIGINT UNSIGNED DEFAULT NULL            COMMENT '关联小事ID：NULL=独立留念，非NULL=完成纪念',
    `visibility`         TINYINT         NOT NULL DEFAULT 1      COMMENT '可见范围：1家庭可见 2仅自己可见',
    `status`             TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1正常 0已删除',
    `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_family_created` (`family_id`, `status`, `created_at`),
    KEY `idx_creator` (`creator_member_id`),
    KEY `idx_thing_id` (`thing_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭记录表';


-- 10. memory_attachments 家庭记录附件表
-- V0.1 只支持图片，视频不做。
CREATE TABLE IF NOT EXISTS `memory_attachments` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '附件ID',
    `memory_id`  BIGINT UNSIGNED NOT NULL                COMMENT '记录ID',
    `file_url`   VARCHAR(500)    NOT NULL                COMMENT '文件地址',
    `file_type`  VARCHAR(30)     DEFAULT NULL            COMMENT '文件类型，例如：image/jpeg',
    `file_size`  INT UNSIGNED    DEFAULT NULL            COMMENT '文件大小（字节）',
    `width`      INT UNSIGNED    DEFAULT NULL            COMMENT '图片宽',
    `height`     INT UNSIGNED    DEFAULT NULL            COMMENT '图片高',
    `sort_no`    INT             NOT NULL DEFAULT 0      COMMENT '排序',
    `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_memory_id` (`memory_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='家庭记录附件表';


-- -------------------------------------------------------------
-- 五、通知
-- -------------------------------------------------------------

-- 11. notification_logs 通知记录表
-- 必须有这张表。未来排查「为什么阿爸没收到通知」全靠它。
CREATE TABLE IF NOT EXISTS `notification_logs` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知记录ID',
    `user_id`         BIGINT UNSIGNED NOT NULL                COMMENT '接收用户ID',
    `family_id`       BIGINT UNSIGNED DEFAULT NULL            COMMENT '家庭ID',
    `thing_id`        BIGINT UNSIGNED DEFAULT NULL            COMMENT '关联小事ID',
    `type`            TINYINT         NOT NULL                COMMENT '通知类型：1派活通知 2叮一下提醒 3完成回执 4加入家庭 5系统',
    `title`           VARCHAR(200)    NOT NULL                COMMENT '通知标题',
    `content`         VARCHAR(1000)   DEFAULT NULL            COMMENT '通知内容',
    `channel`         TINYINT         NOT NULL DEFAULT 1      COMMENT '发送渠道：1微信订阅消息 2站内消息 3公众号模板消息(wxpush)',
    `template_id`     VARCHAR(64)     DEFAULT NULL            COMMENT '模板ID（渠道1为订阅消息模板，渠道3为公众号模板）',
    `status`          TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1待发送 2发送成功 3发送失败 4无订阅额度跳过 5未绑定提醒跳过',
    `retry_count`     TINYINT         NOT NULL DEFAULT 0      COMMENT '重试次数',
    `sent_at`         DATETIME        DEFAULT NULL            COMMENT '发送时间',
    `error_code`      VARCHAR(32)     DEFAULT NULL            COMMENT '微信返回错误码，例如 43101',
    `error_message`   VARCHAR(1000)   DEFAULT NULL            COMMENT '失败原因',
    -- v0.2 补充：消息中心（docs/02 §9）需要「已读 / 未读数 / 全部已读」。
    -- 语义与 thing_reminders.read_at 一致：NULL = 未读。
    -- 注意与 thing_reminders.read_at 是**两条独立记录**：一条提醒会同时产生
    -- 一条 thing_reminders（收件箱用）和一条 notification_logs（发送留痕用），
    -- 已读状态各自维护 —— 它们是不同的用户入口，不该互相耦合。
    `read_at`         DATETIME        DEFAULT NULL            COMMENT '接收人已读时间（NULL=未读）',
    `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_user_created` (`user_id`, `created_at`),
    KEY `idx_status` (`status`),
    KEY `idx_thing_id` (`thing_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知记录表';


SET FOREIGN_KEY_CHECKS = 1;


-- =============================================================
-- 六、初始化数据
-- =============================================================

-- 【v0.2 变更】不再向 menu_items 写入系统菜谱。
-- 系统默认菜谱（约 60-80 条）改为写死在代码常量中：
--     miniprogram/config/default-menu.ts
-- 理由（PRD 16.4）：第一次打开即可用、零配置、无需数据库 seed；
-- 且方便按版本迭代菜谱，不用写迁移脚本。
--
-- 后续如需批量导入自定义菜谱，可在此追加 INSERT 语句。

