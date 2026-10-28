import { Logger } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './app-error';

const logger = new Logger('serialize');

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** camelCase 키 → snake_case, Date → ISO 문자열(깊게). undefined 필드는 뺀다. */
export function toWire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[camelToSnake(k)] = toWire(v);
    }
    return out;
  }
  return value;
}

/**
 * 응답을 shared Response 스키마로 직렬화한다.
 * production이 아니면 스키마 위반을 500(INTERNAL_ERROR)으로 터뜨려 계약 어긋남을 바로 드러낸다.
 * production에서는 로그만 남기고 변환한 값을 그대로 보낸다.
 */
export function serialize<T extends ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const wire = toWire(data);
  const result = schema.safeParse(wire);
  if (result.success) return result.data as z.output<T>;
  const msg = `응답 스키마 위반: ${JSON.stringify(result.error.issues)}`;
  if (process.env.NODE_ENV === 'production') {
    logger.error(msg);
    return wire as z.output<T>;
  }
  throw new AppError('INTERNAL_ERROR', undefined, { message: msg });
}
