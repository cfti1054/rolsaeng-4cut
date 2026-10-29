import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_HTTP_STATUS, type ErrorBody, type ErrorCode } from '@gcd/shared';
import type { Response } from 'express';
import { AppError, DEFAULT_ERROR_MESSAGE } from '../app-error';

/** Nest 내장 예외(라우트 404, 본문 JSON 파싱 실패 등)를 계약 오류 코드로 바꾼다. */
function codeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.PAYLOAD_TOO_LARGE:
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
    case HttpStatus.METHOD_NOT_ALLOWED:
      return 'NOT_FOUND';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}

/** body-parser가 던지는 오류(잘못된 JSON 등)는 HttpException이 아니고 status/type 필드를 가진다. */
function bodyParserStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const e = exception as { status?: unknown; type?: unknown };
  if (typeof e.status === 'number' && typeof e.type === 'string' && e.status >= 400 && e.status < 500) {
    return e.status;
  }
  return undefined;
}

export function toErrorResponse(exception: unknown): {
  status: number;
  body: ErrorBody;
  retryAfterSec?: number;
} {
  if (exception instanceof AppError) {
    const body: ErrorBody = { code: exception.code, message: exception.message };
    if (exception.code === 'VALIDATION_FAILED' && exception.details?.length) {
      body.details = exception.details;
    }
    return exception.retryAfterSec === undefined
      ? { status: exception.status, body }
      : { status: exception.status, body, retryAfterSec: exception.retryAfterSec };
  }
  const httpStatus =
    exception instanceof HttpException ? exception.getStatus() : bodyParserStatus(exception);
  if (httpStatus !== undefined) {
    const code = codeForHttpStatus(httpStatus);
    // 내장 예외 메시지(영문, 내부 정보 포함 가능)는 노출하지 않고 기본 문구를 쓴다.
    return { status: ERROR_HTTP_STATUS[code], body: { code, message: DEFAULT_ERROR_MESSAGE[code] } };
  }
  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message: DEFAULT_ERROR_MESSAGE.INTERNAL_ERROR },
  };
}

/** 모든 예외 → `ErrorBody` (계약 3절). APP_FILTER로 전역 등록한다. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body, retryAfterSec } = toErrorResponse(exception);
    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      );
    }
    if (res.headersSent) return;
    if (retryAfterSec !== undefined) res.setHeader('Retry-After', String(retryAfterSec));
    res.status(status).json(body);
  }
}
