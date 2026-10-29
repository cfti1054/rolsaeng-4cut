# S1 logic (packages/core) 보고

> domain-logic-dev 에이전트가 실행 환경 제약으로 보고서 파일을 쓰지 못해, 리더가 최종 보고를 옮겨 적었다(2026-10-28). 수치는 에이전트 보고 기준.

## 결과

계약 10절 core 함수 7개를 시그니처 그대로 구현. 계약 변경 없음.

- `corepack pnpm --filter @gcd/core test`: 3 files, 79 passed (time 20, profile 15, riot 44)
- `corepack pnpm --filter @gcd/core build` 통과, `corepack pnpm -r typecheck` 통과

## 파일

- `packages/core/src/config.ts`: `KST_OFFSET_MS`, `KST_OFFSET_LABEL`, `DAY_MS`, `HOUR_MS`
- `packages/core/src/time.ts`: `kstDayWindow`, `buildSyncQuota`, `formatKstMidnight`
- `packages/core/src/profile.ts`: `computeMainPosition`, `MAIN_POSITION_MAX`(=2)
- `packages/core/src/riot.ts`: `pickVerificationIcon`, `toRankValue`, `isSameRank`, `isMatchesCacheStale`, `RiotLeagueEntryLike`
- `packages/core/src/index.ts`: 재수출
- 테스트: `packages/core/src/{time,profile,riot}.test.ts` (기존 vitest include 규칙에 맞춰 src 안)

## 함수

| 함수 | 시그니처 | 테스트 | 주요 경계 |
| --- | --- | --- | --- |
| kstDayWindow | `(now: Date) => { start; end }` | 10 | KST 자정 전후, UTC 15:00Z, 연말·윤일, DST 입력, Invalid Date |
| buildSyncQuota | `(used, limit, now) => SyncQuota` | 8 + 2 | used=0/limit/초과, limit 0, resets_at 날짜 넘김, `SyncQuota.parse` 통과 |
| computeMainPosition | `(positions) => MainPosition \| null` | 15 | 0건, 전부 null, 동률, 20경기 창, 반올림, 속성 테스트 200건 |
| pickVerificationIcon | `(currentIconId, random) => number` | 8 | 후보 29개, 현재 아이콘 제외, random 범위 밖·NaN |
| toRankValue | `(entry \| undefined) => RankValue` | 21 | UNRANKED, apex division null, 모르는 tier·rank, 음수·소수 LP |
| isSameRank | `(a, b) => boolean` | 9 | 필드별 차이, UNRANKED, 승급 직후 |
| isMatchesCacheStale | `(syncedAt \| null, now, ttlHours?) => boolean` | 8 | 정확히 6h → true, 미래 시각 → false, ttl 0·음수 |

## 해석 (계약에 없던 것)

1. apex 티어(MASTER 이상)는 rank 문자열을 검사하지 않음(division은 항상 null)
2. 입력 검증 실패는 모두 `RangeError` (toRankValue LP·승·패 비정수, buildSyncQuota 음수, isMatchesCacheStale ttl 비정상, Invalid Date, 모르는 포지션)
3. pickVerificationIcon: random ≥1 → 마지막 후보, 음수 → 첫 후보, NaN → 예외
4. computeMainPosition: 앞 20경기를 자른 뒤 null 제외 → sample_size ≤ 20, ratio = `round(count*100/sample)/100`
5. isMatchesCacheStale: synced_at이 미래면 false, ttl 0이면 항상 true
6. 추가 export: `formatKstMidnight`, `MAIN_POSITION_MAX`, `RiotLeagueEntryLike`, config 상수

## backend·integration 참고

- 작업자는 `toRankValue`의 `RangeError`를 잡아 `INTERNAL_ERROR`로 기록(계약 10절)
- `SYNC_LIMIT_EXCEEDED`의 `Retry-After`(`kstDayWindow(now).end - now`, 초 올림)는 backend에서 계산
