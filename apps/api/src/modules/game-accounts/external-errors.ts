import type { ErrorCode } from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { ExternalApiError } from '../../integrations/contracts';

/**
 * 요청 처리 중(interactive) 외부 호출 오류 → HTTP 오류(계약 S1 2절, 6-4).
 * not_found는 호출한 단계의 코드(RIOT_ID_NOT_FOUND 등). ExternalApiError가 아니면 그대로 다시 던진다.
 */
export function toProviderAppError(err: unknown, notFound: ErrorCode): unknown {
  if (!(err instanceof ExternalApiError)) return err;
  switch (err.kind) {
    case 'not_found':
      return new AppError(notFound, undefined, { cause: err });
    case 'not_configured':
      return new AppError('GAME_PROVIDER_NOT_CONFIGURED', undefined, { cause: err });
    case 'rate_limited':
      return new AppError('GAME_PROVIDER_RATE_LIMITED', undefined, {
        cause: err,
        retryAfterSec: err.retryAfterSec ?? 60,
      });
    case 'auth':
    case 'unavailable':
    case 'bad_response':
      return new AppError('GAME_PROVIDER_ERROR', undefined, { cause: err });
  }
}

/** 외부 호출을 감싸 오류를 변환한다 */
export async function callProvider<T>(fn: () => Promise<T>, notFound: ErrorCode): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toProviderAppError(err, notFound);
  }
}

/** 다음 시각까지 남은 초(올림, 최소 1) */
export function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}
