import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 全局数据库模块。
 *
 * 设为 `@Global()` 是刻意的：几乎所有业务模块都要用 Prisma，
 * 逐个 import 只会让 module 文件变成噪音。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
