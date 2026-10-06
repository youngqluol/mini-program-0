import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

/**
 * 应用入口。
 *
 * 这里刻意保持很薄 —— 全局管道 / 守卫 / 拦截器 / 过滤器都在
 * `app.module.ts` 用 APP_* 令牌注册，好处是「全局件有哪些」一眼可见，
 * 且能走依赖注入。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // 微信消息回调要读原始 body（XML），关掉 Nest 的日志噪音即可，
    // body parser 保留 —— 微信发的是 text/xml，express.json 不会消费它
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? 3000);
  const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';

  // 全局前缀与 docs/02 的 Base URL 一致：https://<域名>/api
  app.setGlobalPrefix('api');

  // 小程序端不受同源策略约束，这里主要是给本地浏览器调试 / 云托管探针用
  app.enableCors({
    origin: nodeEnv === 'production' ? false : true,
    credentials: false,
  });

  // 收到 SIGTERM 时先跑 onModuleDestroy（关 DB 连接、放 Redis 连接）
  app.enableShutdownHooks();

  // 云托管要求监听 0.0.0.0
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`家有小事 · 后端已启动  http://127.0.0.1:${port}/api  [${nodeEnv}]`);
  logger.log(`健康检查: http://127.0.0.1:${port}/api/health`);
  logger.log(`模板自检: http://127.0.0.1:${port}/api/health/templates`);
}

void bootstrap();
