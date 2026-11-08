import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DbLockService } from './db-lock.service';

/**
 * 全局数据库模块。
 *
 * 设为 `@Global()` 是刻意的：几乎所有业务模块都要用 Prisma，
 * 逐个 import 只会让 module 文件变成噪音。
 *
 * `DbLockService` 也放在这里 —— 它同样是「数据库能力」，
 * 且定时任务需要跨模块使用 MySQL 的 GET_LOCK。
 */
@Global()
@Module({
  providers: [PrismaService, DbLockService],
  exports: [PrismaService, DbLockService],
})
export class PrismaModule {}
