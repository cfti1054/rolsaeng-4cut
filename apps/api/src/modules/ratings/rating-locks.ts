import type { RawExecutor } from '../../common/advisory-lock';

/**
 * 결과 승인 잠금(계약 S3 5-5 7·8단계, 11절, D117). 순서: 내전 행 FOR UPDATE → 시즌 생성 → 사용자별(user_id 오름차순).
 * 모두 트랜잭션 advisory lock(커밋·롤백 때 자동 해제). pg_advisory_xact_lock은 void라 $executeRaw로 실행한다.
 */
export const SEASON_AUTO_CREATE_LOCK_KEY = 'season-auto-create';

/** 시즌이 없을 때 자동 생성 직렬화(1-인자 형식) */
export async function lockSeasonAutoCreate(tx: RawExecutor): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SEASON_AUTO_CREATE_LOCK_KEY}))`;
}

/** 사용자 레이팅 잠금 키(2-인자 형식: hashtext('rating:' || game_id), hashtext(user_id)) */
export const ratingLockKey = (gameId: string): string => `rating:${gameId}`;

/**
 * 사용자들의 (게임) 레이팅 잠금을 user_id 오름차순으로 건다(교착 방지).
 * 정렬은 uuid 소문자 문자열 비교 = PostgreSQL uuid 바이트 순서와 같다.
 */
export async function lockUserRatings(tx: RawExecutor, gameId: string, userIds: readonly string[]): Promise<string[]> {
  const sorted = [...new Set(userIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const key = ratingLockKey(gameId);
  for (const userId of sorted) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}), hashtext(${userId}))`;
  }
  return sorted;
}
