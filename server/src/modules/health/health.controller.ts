import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MP_TEMPLATE_SPECS, MpTemplateKind } from '../notify/notify.templates';
import {
  SUB_TEMPLATE_KINDS,
  SUB_TEMPLATE_SPECS,
} from '../notify/subscribe.templates';
import { ConfigService } from '@nestjs/config';
import { formatDateTime } from '../../common/serialize/beijing-time';

/**
 * 健康检查。
 *
 * 两个端点：
 *   `GET /api/health`           云托管存活探针用（必须**不依赖任何外部服务**也能返回）
 *   `GET /api/health/templates` 通知模板配置自检（部署后第一件事就是打这个）
 *
 * 都标 `@Public()` —— 探针不带 token。
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 存活 + 依赖状态。
   *
   * 注意：**始终返回 HTTP 200**，把组件状态放在 body 里。
   * 理由：数据库短暂抖动不该让容器被反复重启 —— 重启解决不了 DB 的问题，
   * 只会让服务在恢复后更慢地回来。真正的告警靠日志与 body 里的 `status`。
   */
  @Get()
  async check() {
    const [db, redis] = await Promise.all([this.prisma.ping(), this.redis.ping()]);

    return {
      status: db ? 'ok' : 'degraded',
      db,
      redis,
      // 秒，取整避免小数噪音
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      // 全项目统一北京时间，这里也不破例（见 common/serialize/beijing-time.ts）
      checkedAt: formatDateTime(new Date()),
    };
  }

  /**
   * 通知模板配置自检（**两条通道都查**）。
   *
   * 排查 47003（模板字段不匹配）时先打这个：
   * 它能一眼看出「哪个模板 ID 没配」和「代码期望哪些字段」。
   *
   *   - `templates`     通道一：公众号模板消息（测试号后台自建，字段名可自定义）
   *   - `subTemplates`  通道二：小程序订阅消息（公共模板库，字段名定死）
   *
   * ⚠️ 两套模板的字段名长得完全不一样，排查时**别拿一个通道的字段去对另一个通道**。
   */
  @Get('templates')
  checkTemplates() {
    const templates = Object.values(MpTemplateKind).map((kind) => {
      const spec = MP_TEMPLATE_SPECS[kind];
      const templateId = this.config.get<string>(spec.envKey)?.trim();
      return {
        kind,
        name: spec.name,
        envKey: spec.envKey,
        configured: Boolean(templateId),
        fields: [...spec.fields],
      };
    });

    const subTemplates = SUB_TEMPLATE_KINDS.map((kind) => {
      const spec = SUB_TEMPLATE_SPECS[kind];
      const templateId = this.config.get<string>(spec.envKey)?.trim();
      return {
        kind,
        name: spec.name,
        /** 对外用的产品化名字（后台标题带禁用词，见 subscribe.templates.ts） */
        displayName: spec.displayName,
        /** 后台「模板编号」—— 对不上就说明后台换过模板 */
        number: spec.number,
        envKey: spec.envKey,
        configured: Boolean(templateId),
        fields: [...spec.fields],
        /** 字段中文含义，排查 47003 时对照后台看 */
        labels: spec.labels,
        /** 缺了就发不出去的字段 */
        required: [...spec.required],
      };
    });

    return {
      // ---- 通道一：公众号模板消息 ----
      mpChannelEnabled: this.config.get<string>('NOTIFY_MP_ENABLED') !== 'false',
      wxpushUrlConfigured: Boolean(this.config.get<string>('WXPUSH_URL')?.trim()),
      wxpushTokenConfigured: Boolean(this.config.get<string>('WXPUSH_TOKEN')?.trim()),
      allTemplatesConfigured: templates.every((t) => t.configured),
      templates,

      // ---- 通道二：小程序订阅消息 ----
      // 没配齐不算故障：通道二只是辅助，通道一 + 站内消息已能独立支撑
      allSubTemplatesConfigured: subTemplates.every((t) => t.configured),
      subTemplates,
    };
  }
}
