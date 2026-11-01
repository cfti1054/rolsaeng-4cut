import { ADMIN_AUDIT_TARGET_BY_ACTION, type AdminAuditAction } from '@gcd/shared';
import type { Prisma } from '@prisma/client';

/**
 * 운영 감사 기록(계약 S6 10절, D261·D262·D278).
 * - 행위와 **같은 트랜잭션**에서 쓴다. 감사 insert가 실패하면 예외가 그대로 올라가 행위 전체가 롤백된다.
 * - target_type은 shared ADMIN_AUDIT_TARGET_BY_ACTION으로 정한다(호출자가 고르지 않는다).
 * - summary는 서버가 만든 한국어 한 줄. 사용자 입력은 auditQuote()로 40자까지만 인용한다.
 * - 「변경 없음」(같은 역할, 같은 값 PATCH, 이미 폐기된 키 폐기)은 호출자가 부르지 않는다.
 */
export type AuditWriter = Pick<Prisma.TransactionClient, 'adminAuditLog'>;

export type AuditEntry = {
  /** 운영진 수기 행위는 회원 id. 패치노트 자동 등록은 null */
  actorId: string | null;
  action: AdminAuditAction;
  targetId: string | null;
  summary: string;
  /** 행위별 전후 값(10-2 표). JSON으로 저장할 수 있는 값만(Date는 ISO 문자열로 바꿔 넣는다) */
  details: Record<string, unknown>;
  /** 행위 시각(APP_CLOCK now). 행위 행의 시각과 맞춘다 */
  at: Date;
};

/** summary에 넣는 사용자 입력 인용 길이(D278) */
export const AUDIT_QUOTE_MAX = 40;

/** 사용자 입력을 따옴표 안에 40자(코드 포인트)까지. 넘으면 39자 + 「…」 */
export function auditQuote(text: string): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  const body = chars.length > AUDIT_QUOTE_MAX ? `${chars.slice(0, AUDIT_QUOTE_MAX - 1).join('')}…` : chars.join('');
  return `'${body}'`;
}

/** Date → ISO 문자열(깊게). details를 jsonb에 넣기 전에 쓴다 */
export function auditJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(auditJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, auditJson(v)]));
  }
  return value;
}

export async function writeAudit(tx: AuditWriter, entry: AuditEntry): Promise<void> {
  await tx.adminAuditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: ADMIN_AUDIT_TARGET_BY_ACTION[entry.action],
      targetId: entry.targetId,
      summary: entry.summary,
      details: auditJson(entry.details) as Prisma.InputJsonValue,
      createdAt: entry.at,
    },
  });
}

/** 수정 감사 details: 요청에 있고 값이 바뀐 필드만 { before, after }. 바뀐 것이 없으면 null(감사 행을 쓰지 않는다) */
export function auditDiff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const nv = after[k];
    if (nv === undefined) continue;
    const ov = before[k];
    const same = ov instanceof Date && nv instanceof Date ? ov.getTime() === nv.getTime() : ov === nv;
    if (same) continue;
    b[k] = ov;
    a[k] = nv;
  }
  return Object.keys(a).length === 0 ? null : { before: b, after: a };
}
