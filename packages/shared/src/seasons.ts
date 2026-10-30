import { z } from 'zod';
import { paginated } from './common/pagination';
import { IsoDateTime, Uuid } from './common/primitives';

// =============================================================================
// S3 시즌(문서 5장 seasons). S3는 조회와 「시즌이 없을 때 자동 생성」만 한다(시즌 종료 처리는 S4 이후).
// 계약: _workspace/01_architect_contract.md(S3) 6절
//
// 시즌 구간은 반열림 [starts_at, ends_at). 어떤 시각 t가 속한 시즌 = starts_at ≤ t < ends_at인 행.
// 겹치는 행이 여럿이면 starts_at이 가장 늦은 것, 같으면 id 문자열이 작은 것(core resolveSeasonAt).
// =============================================================================

/**
 * 결과 승인 시각이 어떤 시즌에도 속하지 않을 때 자동으로 만드는 시즌 길이(개월, KST 달력 기준).
 * 환경 변수 SEASON_AUTO_LENGTH_MONTHS 기본값. 화면에는 쓰지 않는다.
 */
export const SEASON_AUTO_LENGTH_MONTHS_DEFAULT = 3;

/** 자동 생성 시즌 이름 형식: `시즌 {n}` (n = 기존 시즌 행 수 + 1) */
export function autoSeasonName(n: number): string {
  return `시즌 ${n}`;
}

/** 시즌 참조(응답 공통) */
export const SeasonRef = z.object({
  id: Uuid,
  name: z.string(),
  starts_at: IsoDateTime,
  /** 끝 시각(이 시각은 시즌에 포함되지 않음) */
  ends_at: IsoDateTime,
});
export type SeasonRef = z.infer<typeof SeasonRef>;

/** GET /seasons 1행 */
export const SeasonView = SeasonRef.extend({
  /** 서버 현재 시각이 이 시즌 구간에 있고, resolveSeasonAt(now)가 고른 시즌이면 true(최대 1개) */
  is_current: z.boolean(),
});
export type SeasonView = z.infer<typeof SeasonView>;

/**
 * GET /seasons — 전체 시즌(starts_at 내림차순, 같으면 id 오름차순). 페이징 없음(next_cursor 항상 null, D75와 같은 방식).
 * 프로필 레이팅 그래프의 시즌 선택에 쓴다.
 */
export const ListSeasonsResponse = paginated(SeasonView);
export type ListSeasonsResponse = z.infer<typeof ListSeasonsResponse>;
