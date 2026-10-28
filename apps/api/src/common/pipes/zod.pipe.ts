import type { PipeTransform } from '@nestjs/common';
import type { ErrorDetail } from '@gcd/shared';
import type { ZodError, ZodTypeAny, z } from 'zod';
import { AppError } from '../app-error';

export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** shared 스키마로 body·query·params를 검증한다. 실패 시 VALIDATION_FAILED + details. */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        details: zodIssuesToDetails(result.error),
      });
    }
    return result.data as z.output<T>;
  }
}
