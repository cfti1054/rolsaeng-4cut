import { Logger } from '@nestjs/common';
import type { RawExecutor } from '../../common/advisory-lock';
import { AppError } from '../../common/app-error';
import type { RawQueryExecutor } from '../../common/scrim-lock';

const logger = new Logger('RatingLocks');

/**
 * 결과 승인 잠금(계약 S3 5-5 7·8단계, 11절, D117). 순서: 내전 행 FOR UPDATE → 시즌 생성 → 사용자별(user_id 오름차순).
 * 모두 트랜잭션 advisory lock(커밋·롤백 때 자동 해제). pg_advisory_xact_lock은 void라 $executeRaw로 실행한다.
 * S4: 마지막에 시즌 행 FOR SHARE(lockSeasonForRating, 7c단계).
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

/**
 * 승인 7c단계(계약 S4 6-2, D141). 쓰기 전 시즌 행 FOR SHARE + closed_at 검사.
 * 커밋까지 유지되므로 시즌 종료 작업(FOR NO KEY UPDATE)은 진행 중 승인이 끝나기를 기다려 커밋된 ratings를 읽는다.
 * FOR KEY SHARE(새 행의 FK 검사)와는 충돌하지 않는 잠금이라 새 시즌 승인은 지난 시즌 종료 작업을 기다리지 않는다.
 * 닫힌 시즌이면 INTERNAL_ERROR(전체 롤백, 결과 pending 유지). 재시도하면 다음 시즌에 반영된다(6-5 시나리오 4).
 */
export async function lockSeasonForRating(tx: RawQueryExecutor, seasonId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ closed_at: Date | null }[]>`
    SELECT closed_at FROM seasons WHERE id = ${seasonId}::uuid FOR SHARE`;
  const row = rows[0];
  if (!row || row.closed_at !== null) {
    logger.error(row ? `닫힌 시즌에 승인 시도: ${seasonId}` : `승인 대상 시즌 없음: ${seasonId}`);
    throw new AppError('INTERNAL_ERROR');
  }
}
