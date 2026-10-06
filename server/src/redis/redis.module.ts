import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** 全局 Redis 模块。理由同 PrismaModule：几乎所有业务模块都要用。 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
