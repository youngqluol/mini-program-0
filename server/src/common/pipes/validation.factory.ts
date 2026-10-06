import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** 兜底文案 —— 校验失败但拿不到中文 message 时用它 */
const GENERIC_MESSAGE = '填的内容有点问题，检查一下～';

/**
 * 把 DTO 校验失败转成**一句中文**。
 *
 * 为什么需要这个：class-validator 的默认文案是英文
 * （`count must not be greater than 10`、`templateId must be a string`），
 * 会原样漏给用户看 —— 而本项目所有面向用户的文案都必须是人话。
 *
 * 项目约定是每个校验器手写中文 message（见各 DTO 的 `{ message: '...' }`），
 * 但只要漏写一个就漏一次英文，所以这里做最后一道兜底：
 * **文案里一个中文字符都没有 → 认定是框架默认文案，换成通用中文提示**。
 *
 * 与 `AllExceptionsFilter.isFrameworkDefaultMessage()` 是同一类防御，
 * 区别是那边拦 Nest 的路由文案（`Cannot GET /api/xxx`），
 * 这边拦 class-validator 的校验文案。
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const message = firstMessage(errors);
  return new BadRequestException(
    hasChinese(message) ? message : GENERIC_MESSAGE,
  );
}

/** 深度优先取第一条约束消息 —— class-validator 的报错是嵌套结构 */
function firstMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    if (error.constraints) {
      const first = Object.values(error.constraints)[0];
      if (first) return first;
    }
    if (error.children?.length) {
      const nested = firstMessage(error.children);
      if (nested) return nested;
    }
  }
  return GENERIC_MESSAGE;
}

function hasChinese(msg: string): boolean {
  return /[\u4e00-\u9fa5]/.test(msg);
}
