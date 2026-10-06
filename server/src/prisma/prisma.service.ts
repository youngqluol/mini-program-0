import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端封装。
 *
 * 只做两件事：连接生命周期管理 + 开发期慢查询日志。
 * **业务查询不要写在这里**，那是各 repository / service 的职责。
 *
 * ⚠️ 时区：Prisma 固定按 UTC 处理 DATETIME，北京时间的格式化
 *    统一在 `common/serialize/beijing-time.ts` 做一次。
 *    详见 `prisma/schema.prisma` 的 datasource 注释。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // 慢查询与错误必须能被看见，否则线上「为什么慢」无从查起
    // 注意：Prisma 的事件类型没进 `log` 数组时不存在，用 any 兜一下
    const self = this as unknown as {
      $on: (event: 'warn' | 'error', cb: (e: unknown) => void) => void;
    };
    self.$on('warn', (e) => this.logger.warn(formatPrismaEvent(e)));
    self.$on('error', (e) => this.logger.error(formatPrismaEvent(e)));

    try {
      await this.$connect();
      this.logger.log('数据库连接就绪');
    } catch (e) {
      // 生产环境：连不上就**必须**启动失败。
      // 让容器崩掉比让它半死不活地对外提供服务好 —— 云托管会把流量留给上一个健康版本。
      if (this.config.get<string>('NODE_ENV') === 'production') throw e;

      // 开发环境：允许带病启动。这样即使 MySQL 还没起，
      // 也能访问 /api/health 看到到底哪个依赖挂了，而不是对着一行连接错误猜。
      this.logger.error(
        `数据库连接失败，开发环境继续启动（/api/health 会显示 degraded）：` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * 健康检查用：真的打一次库，而不是只看连接池状态。
   * 云托管的健康检查会频繁调用，所以用最轻的查询。
   */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (e) {
      this.logger.error(
        `数据库 ping 失败: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }
}

function formatPrismaEvent(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
