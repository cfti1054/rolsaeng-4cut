/**
 * game_accounts insert의 고유 제약 위반(P2002) 구분(계약 S1 5-2a).
 * Prisma 오류 `meta.target`은 필드 이름 배열(예: ['game_id', 'external_id']) 또는 인덱스 이름 문자열로 온다.
 * 수동으로 추가한 부분 고유 인덱스는 이름(game_accounts_one_primary_per_user_game) 또는 컬럼 배열(user_id, game_id)로 올 수 있다.
 */
export type GameAccountUniqueViolation = 'external_id' | 'one_primary' | 'unknown';

/** P2002가 아니면 null */
export function classifyGameAccountUniqueViolation(err: unknown): GameAccountUniqueViolation | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== 'P2002') return null;
  const target = e.meta?.target;
  const names: string[] = Array.isArray(target)
    ? target.map((t) => String(t).toLowerCase())
    : typeof target === 'string'
      ? [target.toLowerCase()]
      : [];
  if (names.length === 0) return 'unknown';
  const joined = names.join(',');
  if (joined.includes('one_primary_per_user_game') || joined.includes('is_primary') || joined.includes('isprimary')) {
    return 'one_primary';
  }
  if (joined.includes('external_id') || joined.includes('externalid')) return 'external_id';
  const set = new Set(names.map((n) => n.replace(/_/g, '')));
  // 컬럼 배열 (user_id, game_id) = 부분 고유 인덱스(이 테이블에 그 조합의 고유 제약은 이것뿐)
  if (set.size === 2 && set.has('userid') && set.has('gameid')) return 'one_primary';
  return 'unknown';
}
