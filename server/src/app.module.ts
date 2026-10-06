import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions, type JwtSignOptions } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';

import { validateEnv } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { FamiliesModule } from './modules/families/families.module';
import { ThingModule } from './modules/thing/thing.module';
import { WechatModule } from './modules/wechat/wechat.module';
import { NotifyModule } from './modules/notify/notify.module';

import { JwtGuard } from './common/guards/jwt.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/pipes/validation.factory';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/**
 * 应用根模块。
 *
 * 全局件（APP_* 令牌注册，全部在这里一览）：
 *   APP_PIPE        ValidationPipe      DTO 校验，白名单剥离多余字段，失败文案中文化
 *   APP_GUARD       JwtGuard            默认全部接口都要登录
 *   APP_INTERCEPTOR ResponseInterceptor 统一响应体 { code, message, data }
 *   APP_FILTER      AllExceptionsFilter 统一异常体，绝不漏出 HTML 错误页
 *
 * 为什么用 APP_* 而不是 `app.useGlobalXxx()`：这些件要走 Nest 的 DI
 * （JwtGuard 需要 JwtService 与 Reflector），`useGlobalXxx` 拿不到容器。
 */
@Module({
  imports: [
    // isGlobal 是刻意的：各处直接 config.get('WXPUSH_URL') 读扁平环境变量名
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),

    // JWT 也设全局：AuthModule 与全局 JwtGuard 都要用，没必要逐个 import
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          // jsonwebtoken 把 expiresIn 声明成模板字面量类型（`${number}d` 之类），
          // 而我们从环境变量读到的是普通 string，只能断言一次。
          // 值本身是可信的：AuthService 另有 parseDurationSeconds 兜底。
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),

    // 基础设施（都是 @Global）
    PrismaModule,
    RedisModule,

    // 业务模块
    HealthModule,
    WechatModule,
    FamiliesModule,
    AuthModule,
    NotifyModule,
    ThingModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        // 只保留 DTO 里声明过的字段，多余的直接剥掉（不是报错）
        whitelist: true,
        // 允许前端传 "10001" 字符串给 number 字段（小程序端常见）
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        // 校验失败时兜底成中文 —— class-validator 的默认文案是英文，
        // 会原样漏给用户看（见 common/pipes/validation.factory.ts）
        exceptionFactory: validationExceptionFactory,
      }),
    },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
