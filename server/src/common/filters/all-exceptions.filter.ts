import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_MESSAGE, ErrorCode, httpStatusOf } from '@shared';
import { BusinessException } from '../errors/business.exception';

interface ErrorBody {
  code: number;
  message: string;
  data: null;
}

/**
 * 全局异常过滤器 —— 保证**任何**异常都返回统一响应体，绝不漏出 HTML 错误页。
 *
 * 映射规则（docs/02 §1.2）：
 *   BusinessException  → 用它自带的 code
 *   HttpException 400  → 40001 参数校验失败（取第一条校验消息）
 *   HttpException 401  → 40100 未登录（同时返回 HTTP 401，供前端拦截）
 *   HttpException 403  → 40301 无权限
 *   HttpException 404  → 40400 资源不存在
 *   其他 / 未知        → 50000 服务端异常（记完整堆栈，但不回传给用户）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { code, message, status } = this.resolve(exception);

    // 5xxxx 是「我们的问题」，必须留痕；4xxxx 是用户操作问题，不刷日志
    if (code >= 50000) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${code} ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${req.method} ${req.originalUrl} → ${code} ${message}`);
    }

    const body: ErrorBody = { code, message, data: null };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): {
    code: ErrorCode;
    message: string;
    status: number;
  } {
    // ① 业务异常：直接用它自己的 code 与文案
    if (exception instanceof BusinessException) {
      return {
        code: exception.code,
        message: exception.message,
        status: exception.getStatus(),
      };
    }

    // ② 其他 HttpException：按状态码归一到业务错误码
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = this.mapStatus(status);

      // ValidationPipe 抛出的 message 是 string[]，取第一条最具体的信息
      const raw = exception.getResponse();
      const message = this.extractMessage(raw) ?? ERROR_MESSAGE[code];

      return { code, message, status: httpStatusOf(code) };
    }
    // ③ 未知异常：不回传细节，避免泄露内部实现
    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: ERROR_MESSAGE[ErrorCode.INTERNAL_ERROR],
      status: httpStatusOf(ErrorCode.INTERNAL_ERROR),
    };
  }

  private mapStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.INVALID_PARAM;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.TOO_MANY_REQUESTS;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  /** 从 HttpException 的 response 里抠出给用户看的一句话 */
  private extractMessage(raw: unknown): string | null {
    const msg = this.rawMessage(raw);
    if (!msg) return null;

    // Nest 路由未命中时抛的是 `Cannot GET /api/xxx` —— 英文、且暴露内部路径。
    // 这类「框架自带的默认文案」一律丢掉，换成统一的中文提示。
    if (isFrameworkDefaultMessage(msg)) return null;

    return msg;
  }

  private rawMessage(raw: unknown): string | null {
    if (typeof raw === 'string') return raw;
    if (!raw || typeof raw !== 'object') return null;

    const msg = (raw as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg) && msg.length > 0) {
      // class-validator 的消息数组，第一条通常最贴近出错字段
      return String(msg[0]);
    }
    return null;
  }
}

/** 识别 Nest 内置的英文默认文案（不应透给用户） */
function isFrameworkDefaultMessage(msg: string): boolean {
  return /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//.test(msg);
}
