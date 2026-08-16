import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '@erp/config';
import type { ApiErrorBody } from '@erp/shared';

const STATUS_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * Translates every thrown error into the project-wide response envelope:
 *
 *   { "error": { "code", "message", "details"? } }
 *
 * Stack traces are always logged server-side (with the request id for
 * correlation) but are only ever included in the HTTP response body
 * outside of production, purely as a local-dev convenience.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  constructor(private readonly configService: ConfigService<Env, true>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const isProduction =
      this.configService.get('NODE_ENV', { infer: true }) === 'production';

    const { status, code, message, details } = this.resolve(
      exception,
      isProduction,
    );

    this.logger.error(
      `${request.method} ${request.url} -> ${status} [${code}] ${message} (requestId=${request.id ?? 'n/a'})`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const body: ApiErrorBody = {
      error: { code, message, ...(details ? { details } : {}) },
    };
    response.status(status).json(body);
  }

  private resolve(
    exception: unknown,
    isProduction: boolean,
  ): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        const code =
          STATUS_CODES[status] ??
          exception.constructor.name.replace(/Exception$/, '').toUpperCase();
        return { status, code, message: payload };
      }

      const {
        message,
        error: _error,
        statusCode: _statusCode,
        code: explicitCode,
        ...rest
      } = payload as Record<string, unknown>;
      // Custom exceptions (e.g. company-context errors) pass an explicit
      // `code` in their body so several distinct error cases can share one
      // HTTP status — that code wins over the generic per-status mapping.
      const code =
        (typeof explicitCode === 'string' ? explicitCode : undefined) ??
        STATUS_CODES[status] ??
        exception.constructor.name.replace(/Exception$/, '').toUpperCase();
      const resolvedMessage = Array.isArray(message)
        ? message.join(', ')
        : ((message as string) ?? exception.message);
      const details = Object.keys(rest).length > 0 ? rest : undefined;
      return { status, code, message: resolvedMessage, details };
    }

    const message =
      isProduction || !(exception instanceof Error)
        ? 'Internal server error'
        : exception.message;
    const details =
      !isProduction && exception instanceof Error && exception.stack
        ? { stack: exception.stack }
        : undefined;

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message,
      details,
    };
  }
}
