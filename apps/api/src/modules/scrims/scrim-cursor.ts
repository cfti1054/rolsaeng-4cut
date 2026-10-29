import { IsoDateTime, ScrimListStatus, Uuid } from '@gcd/shared';
import { z } from 'zod';
import { AppError } from '../../common/app-error';

/**
 * 목록 커서(계약 S2 4-1): base64url(JSON { t: 탭, s: scheduled_at ISO, id }).
 * 해석 실패·요청 탭과 다른 t → VALIDATION_FAILED(details path `cursor`).
 */
const CursorPayload = z.object({ t: ScrimListStatus, s: IsoDateTime, id: Uuid }).strict();
export type ScrimCursor = { tab: ScrimListStatus; scheduledAt: Date; id: string };

export function encodeScrimCursor(c: ScrimCursor): string {
  return Buffer.from(JSON.stringify({ t: c.tab, s: c.scheduledAt.toISOString(), id: c.id })).toString('base64url');
}

function invalid(message: string): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { details: [{ path: 'cursor', message }] });
}

export function decodeScrimCursor(raw: string, tab: ScrimListStatus): ScrimCursor {
  let json: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('base64url 아님');
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid('cursor: 해석할 수 없는 값');
  }
  const p = CursorPayload.safeParse(json);
  if (!p.success) throw invalid('cursor: 해석할 수 없는 값');
  if (p.data.t !== tab) throw invalid('cursor: 다른 탭의 커서');
  return { tab: p.data.t, scheduledAt: new Date(p.data.s), id: p.data.id };
}
