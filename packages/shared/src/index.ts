/**
 * 前后端共享类型入口。
 *
 * 小程序端与后端都从这里 import，改一个字段两边编译期同时报错，
 * 避免联调时才发现对不上（docs/04 第一章）。
 */

export * from './enums';
export * from './error-codes';
export * from './dto/common';
export * from './dto/auth';
export * from './dto/family';
export * from './dto/thing';
export * from './dto/menu';
export * from './dto/memory';
export * from './dto/upload';
export * from './dto/notify';
