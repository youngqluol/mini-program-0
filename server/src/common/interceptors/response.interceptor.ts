import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiResponse, ErrorCode } from '@shared';
import { sanitizeForJson } from '../serialize/json-safe';

/**
 * 统一响应体拦截器（docs/02 §1.1）。
 *
 * 所有成功响应被包成：
 *   { "code": 0, "message": "ok", "data": ... }
 *
 * 这样小程序端只需要写一处错误处理 —— 它永远只看 `code`，不看 HTTP 状态码。
 *
 * ⚠️ 用 `@Res()` 直接操作原生响应的方法（如微信消息回调）会绕过本拦截器，
 *    这是预期的：那个接口必须返回微信要求的裸文本格式。
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: ErrorCode.OK,
        message: 'ok',
        // 没有返回值的接口（如 PATCH）统一给 null，而不是 undefined
        // —— undefined 在 JSON 里会被整个键吞掉，前端拿到的是 undefined 而不是 null
        data: (data === undefined ? null : sanitizeForJson(data)) as T,
      })),
    );
  }
}
