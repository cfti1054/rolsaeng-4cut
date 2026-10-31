# 계약: S4 티어·ELO 랭킹, 랭킹 캐시 작업, 홈 대시보드 요약, 시즌 종료 처리

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서") 6장, 7-3, 8장, 9장 캐싱. 슬라이스: `_workspace/00_input/slice.md`(메인 기본값 1–5 반영)
선행 계약: `_workspace/S0`(D1–D31), `S1`(D32–D72), `S2`(D73–D102), `S3`(D103–D139)의 `01_architect_contract.md`. 와이어 형식(S0 3절), 외부 식별자 비노출(D38), 자리 필드 확장(D39), 화면 env 값 노출(D101), `ScrimUserRef` 공개 정보는 그대로 쓴다. 이 문서는 네 계약을 **확장**하고, 깨는 것은 1-3절에 모두 적는다.
실제 계약은 코드가 우선한다: `packages/shared/src/**`, `apps/api/prisma/schema.prisma`.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-30 | S4 최초 작성: 엔드포인트 신규 3개 + 프로필 응답 확장 2개(`badges`, `ratings[].rank`), 오류 코드 추가 없음(전체 43개), 스키마 증분(마이그레이션 `20261030180000_s4`), core 함수 16개, 환경 변수 3개, 결정 D140–D165 | architect |
| 2026-10-31 | 구현·QA 반영(문서만, 교차 QA 정정 C1–C15). 구현 후 사실 맞춤: 3절 마이그레이션 이력, 4-4 공개 메서드·뱃지 조회, 7-2 SQL, 9절 예외·추가 export, 10절 화면 규칙·재조회·목, 11절 모듈, D164. 새 결정 D166(뱃지 월 표시), D167(세션 사용자 변경), D168(시즌 공백 프로필 표시). 소프트 리셋 안내 문구 정리(10절). 확인 필요 Q8 추가(요약 첫 계산 실패·`top_rankers` null 의미), 2절·8-2에 현재 동작 명시. 18절에 배포 영향 추가. 코드 미반영 2건은 같은 날 frontend가 반영(r2 확인), 18절 참고 | architect |
| 2026-10-31 | S4 후속 변경 3건: 패배 배율, 레드팀 호칭, ELO 설명 ⓘ. 19절 신설, 결정 D169–D178, 확인 필요 Q9·Q10. shared·`.env.example` 수정, 스키마 변경 없음 | architect |
| 2026-10-31 | S4 후속 변경 2(사용자 결정 4건): 시작 점수 전원 1000, 시즌마다 1000 초기화(소프트 리셋 폐지), 밸런스 w = 0.2 × min(현재 시즌 경기 수 ÷ 10, 1), 라인 기본값 = 라이엇 주·보조 라인. 20절 신설, 결정 D182–D195, 확인 필요 Q11–Q13, Q1·Q5 닫힘. 새 엔드포인트 1개(`GET /me/position-suggestions`), 응답 필드 변경 2곳(`rating_policy`), env 1개 삭제, 마이그레이션 없음(`schema.prisma` 주석만). 앞 절의 충돌 규칙에 「20절로 변경」 표시 | architect |
| 2026-10-31 | Q9·Q10 사용자 확정(추천안 그대로, 코드 변경 없음). Q9 패배 배율 0.5 유지(D173, `SCRIM_ELO_LOSS_RATIO`로 조정). Q10 ⓘ 이유 문구 유지 | 리더 |
| 2026-10-31 | S4 후속 변경 3(사용자 결정): Q2·Q3·Q4·Q6·Q7 추천안 확정(코드 변경 없음, Q4는 S5에서 `users.left_at`), Q8 지금 구현. 21절, 결정 D196–D201. 요약 응답 필수 필드 1개(`top_rankers_state`), `top_rankers` 첫 계산 실패는 요약만 부분 실패, `GET /rankings/*` 500은 그대로. shared `dashboard.ts`·`contract.s4.test.ts` 수정, 스키마·마이그레이션 없음. 2절·8-2의 「Q8에서 판단」은 21절로 대체 | architect |

---

## 1. 범위

### 1-1. 포함

| 문서 행 | S4 범위 |
| --- | --- |
| 2장 랭킹 · 티어 랭킹 (P0) | `GET /rankings/tier`, 대표 계정 최신 스냅샷, 티어 점수 |
| 2장 랭킹 · 내전 ELO 랭킹 (P0) | `GET /rankings/elo`, 시즌별, 5경기 이상, 내 순위, 순위 변동. 주간·월간은 제외(D162, 17절 Q6) |
| 7-3 캐시 | 5분 주기 작업, PostgreSQL 저장, 실패 시 마지막 성공값 + 갱신 시각 |
| 7-3 시즌 종료 | 최종 순위 스냅샷, 뱃지 지급, ~~소프트 리셋(새 시즌 첫 행)~~ **→ 20절로 변경: 새 시즌은 전원 1000(D183)** |
| 6장 `/dashboard/summary`, 8장 `/` | 홈, 사이드바 시즌 카드, 내 ELO·순위 |
| 2장 프로필 · 뱃지 (P0) | `GET /users/:id/profile`의 `badges`, 내전 레이팅 순위(D127 후속) |

### 1-2. 제외

활동·플레이타임 랭킹(S5, 탭은 비활성 + 「봇 연동 후 제공」), 음성 접속·활동 멤버 카드(S5, 응답에 필드 자체가 없다), 패치·이벤트(S6), 스파크라인·전주 대비(자료 없음, 생략), 시즌 수동 생성·수정(S6), 티어 변화 그래프, 업적·포인트(P2), 승인 되돌리기(S6).

### 1-3. 기존 결정 변경

| 기존 | 변경 | 이유 |
| --- | --- | --- |
| **D103** 「시드는 (사용자, 게임, 시즌) 행을 처음 만들 때 한 번 쓴다」 | 새 행의 시작값 = **이전 시즌 행이 있으면 소프트 리셋, 없으면 시드**. 시드 표·출처(대표 계정)는 그대로. 밸런스의 「티어 시드」도 그대로. **→ 20절로 변경: 시작값은 항상 1000, 시드 표는 밸런스 티어 환산값으로만 쓴다(D182, D189)** | 문서 7-3 소프트 리셋. 슬라이스 「새 시즌 첫 레이팅 행을 소프트 리셋 값으로」 |
| **D107** 「행이 없으면 시드(= 그 시즌 첫 반영 때 쓰일 값)」 | 괄호의 원칙을 유지한다: 행이 없으면 **첫 반영 때 쓰일 값**(소프트 리셋 값 또는 시드). 조회는 행을 만들지 않는다(D160). **→ 20절로 변경: 첫 반영 때 쓰일 값 = 1000, w 정의도 바뀐다(D187)** | 이월을 무시하면 지난 시즌 1600인 멤버가 첫 내전 밸런스에서 시드로 계산된다 |
| **S3 5-5** 승인 흐름 | 7c단계(시즌 행 `FOR SHARE` + `closed_at` 검사) 추가, 9단계 시작값 변경. 실행 순서는 6-2 | 종료 작업과의 경합(D141) |
| **S3 6절** 마지막 항목 「이전 시즌 값 이월·소프트 리셋은 S4 이후」 | 6절로 대체 | - |
| **S3 11절** approve 잠금 행 | 시즌 행 FOR SHARE 추가(15절) | D141 |
| **D127** 프로필 순위 「#3」 미제공 | 제공(`ProfileGameRating.rank`, D159) | D127이 조건으로 둔 S4 랭킹 규칙이 생겼다 |
| **D39** `badges: null` 자리 | `ProfileBadge[] | null`로 넓힘. backend는 항상 배열 | D39 절차 그대로 |

그대로 유지: D116(시즌 = 승인 시각이 속한 구간, 시즌 생성은 승인에서만, D143), D106(K 경기 수는 시즌 무관), D123(승인 취소 없음), D139.

---

## 2. 오류 코드

**추가 없음(43개 유지).** 기존 코드 재사용:

| code | 상황 |
| --- | --- |
| VALIDATION_FAILED | `game` 누락, 티어 랭킹에 `steam`, `season`이 uuid 아님 |
| NOT_FOUND | `GET /rankings/elo`의 없는 season id |
| INTERNAL_ERROR(로그) | 빈 캐시 첫 계산 실패(마지막 성공값이 없음), GameCode는 유효한데 games 행 없음(D135와 같은 처리), 승인 시 닫힌 시즌(7c, 정상 흐름에서 생기지 않음, 롤백·pending 유지) |

빈 캐시 첫 계산 실패의 현재 동작: `GET /rankings/*`는 500이다(보여 줄 마지막 성공값이 없음). `GET /dashboard/summary`도 같은 계산을 거치므로 **요약 전체가 500**이다(모집·통계까지 함께 실패). 값이 있는 캐시의 갱신 실패는 해당 없다(200, `stale: true`). 처리 방향은 17절 Q8. **→ 21절로 변경: `GET /rankings/*`는 그대로 500, 요약은 `top_rankers`만 부분 실패(`top_rankers_state: 'unavailable'`, 200, D196)**

---

## 3. 스키마 변경 (`apps/api/prisma/schema.prisma`)

마이그레이션: `apps/api/prisma/migrations/20261030180000_s4/migration.sql` — `prisma migrate diff --from-schema-datamodel <S3 schema> --to-schema-datamodel prisma/schema.prisma --script` 출력과 **일치 확인함**(주석 제외 diff 없음). 수동 블록 없음, `DROP` 문장 없음. `prisma validate` 통과(`DATABASE_URL` 값이 필요하다, 가짜 값 가능). DB 적용 미실행(Docker 없음).

이력: 최초 파일에는 architect가 `2>&1`로 저장해 Prisma CLI 경고 2줄이 함께 들어갔고, 그 상태로 적은 「일치 확인함」은 사실이 아니었다(비교 출력에 차이가 나왔는데 놓쳤다). 리더가 두 줄을 지우고 stdout만 저장했으며, 교차 QA가 다시 비교해 지금 파일의 일치를 확인했다. 재생성할 때는 stdout만 저장한다.

| 대상 | 변경 | 근거 |
| --- | --- | --- |
| seasons | **추가** `closed_at timestamptz NULL` | D141·D144 |
| ratings | **추가** `carried_from_season_id uuid NULL` FK seasons(ON DELETE SET NULL) | D140 감사. **20절로 변경: 컬럼은 남기고 쓰지 않는다(D184)** |
| ranking_caches | **새 표**: `id`, `cache_key`(unique), `payload jsonb`, `computed_at`, `last_failed_at`, `last_error`, `baseline_period_start`, `baseline_ranks jsonb DEFAULT '{}'`, `created_at`, `updated_at` | D146, D153 |
| season_standings | 컬럼 변경 없음. 의미 확정: 5경기 이상 멤버만 | D145 |
| badges, user_badges | 컬럼 변경 없음. 유일 키 `(user_id, badge_id, season_id)` 재사용. 시드 추가(`seed.ts`) | D145 |

컬럼 의미:

| 컬럼 | 의미 |
| --- | --- |
| seasons.closed_at | 시즌 종료 처리 커밋 시각. 값이 있으면 그 시즌 `ratings`는 더 바뀌지 않고, 조회 출처는 `season_standings`다 |
| ratings.elo(첫 행) | 6-1 시작값. **20절로 변경: 1000(D182)** |
| ratings.carried_from_season_id | 시작값을 준 이전 시즌. 시드로 시작했으면 null. **20절로 변경: 새 행은 항상 null, 기존 값은 감사 기록(D184)** |
| ranking_caches.payload·computed_at | 마지막 **성공** 값·시각. 실패가 지우지 않는다 |
| ranking_caches.last_failed_at·last_error | 마지막 실패. 성공하면 null. `last_error`는 로그용, 응답에 내리지 않는다 |
| ranking_caches.baseline_* | 순위 변동 기준(D153) |
| user_badges.earned_at | 시즌 뱃지 = 그 시즌 `ends_at`(재실행·지연과 무관한 고정값) |

기존 행: `closed_at` NULL → 이미 끝난 시즌은 첫 종료 작업이 처리한다. 이전 데이터 소급 재계산은 없다.

---

## 4. 엔드포인트 (S4)

모두 `/api/v1`, JWT, 멤버 전원. 이름은 shared export, 경로는 `ApiPath`.

| 메서드 | 경로 (`ApiPath`) | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- |
| GET | /rankings/tier (`rankingsTier`) | `GetTierRankingQuery {game: lol\|tft}` | 200 `GetTierRankingResponse` | VALIDATION_FAILED |
| GET | /rankings/elo (`rankingsElo`) | `GetEloRankingQuery {game, season?}` | 200 `GetEloRankingResponse` | VALIDATION_FAILED, NOT_FOUND |
| GET | /dashboard/summary (`dashboardSummary`) | - | 200 `GetDashboardSummaryResponse` | - |
| GET | /users/:id/profile (기존) | 그대로 | `badges: ProfileBadge[]`(항상 배열), `scrim.ratings[].rank` 추가 | 그대로 |

- 문서 6장 대비: 세 경로 모두 문서 경로 그대로. `game`을 필수로 둔다(게임 코드 기본값을 서버에 박지 않는다, 설계 원칙 3).
- 직렬화는 반드시 shared parse(D38). `game_accounts.external_id`·email·discord_id는 스키마에 없어 걸러진다.
- 스키마 코드: `packages/shared/src/rankings.ts`, `dashboard.ts`, `badges.ts`. 필드별 규칙은 스키마 주석이 기준이고 아래는 계산 방법이다.

### 4-1. `GET /rankings/tier`

1. `rankedQueueOf(game)`로 큐 결정. key = `rankings:tier:{game}`.
2. 7-3 읽기(캐시 → 없으면 첫 계산).
3. 응답: `items` = entries 앞 `RANKING_ITEMS_MAX`(200), `next_cursor` null, `total` = entries 길이, `me` = entries에서 요청자, `synced_at` = computed_at, `stale` = core `isRankingStale`.

### 4-2. `GET /rankings/elo`

시즌 결정: `season` 있음 → 그 행(없으면 NOT_FOUND). 없음 → `resolveSeasonAt(now)` → `latestStartedSeason(now)` → 둘 다 없으면 null.

| 시즌 상태 | 출처 | is_final | rank_change | synced_at | stale |
| --- | --- | --- | --- | --- | --- |
| null | - | false | - | null | false |
| `starts_at > now` | - (빈 목록) | false | - | null | false |
| `closed_at` 있음 | `season_standings` join users, rank ASC | true | 전부 null | closed_at | false |
| 그 외(진행 중 또는 끝났지만 종료 처리 전) | key `rankings:elo:{game}:{season_id}`, 7-3 읽기 | false | 캐시 값 | computed_at | `isRankingStale` |

- standings 경로: wins + losses = games, win_rate = `computeWinRate`. 삭제된 사용자 행은 Cascade로 사라지고 남은 행의 저장 rank는 다시 매기지 않는다.
- `min_games` = `config.ranking.eloMinGames`.

### 4-3. `GET /dashboard/summary`

8절.

### 4-4. 프로필 (`profile.service.ts`, `profile-scrim.service.ts`)

- `badges`: `user_badges` where user, `earned_at DESC, id ASC` → badges·seasons를 id 목록으로 표별 조회해 합친다(relation include를 쓰지 않는다). 항상 배열. `game`·`place` = `parseSeasonBadgeCode(badge.code)`, 아니면 null. `season` = `seasonRef` 또는 null.
- `scrim.ratings[].rank`: `RankingsReader.eloRankOf(game, seasonId, userId)`(`game`은 GameCode, `seasonId`는 uuid) = 캐시 **읽기 전용**(없으면 null, 프로필 조회가 계산을 일으키지 않는다).
- `RankingsReader` 공개 메서드: `tier`, `elo`(컨트롤러), `eloView`(요약 top_rankers, 4-2와 같은 출처 선택), `eloEntryOf`(요약 `me`, 읽기 전용), `eloRankOf`(프로필).

---

## 5. 요청 흐름 공통

- 쓰기 경로 추가 없음(승인만 변경, 6-2).
- `now`는 요청당 `clock.now()` 1회.
- 「순위 대상 사용자」 조건은 `apps/api/src/modules/rankings/rankable-users.ts`의 `rankableUserWhere` 한 곳에서 정의한다(D161). 티어·ELO 계산·시즌 종료가 모두 이 값을 쓴다.

---

## 6. 시즌 전환 (D140–D145)

### 6-1. 시작값 규칙

> **20절로 변경(D182, D183):** 이 절의 소프트 리셋·티어 시드 시작값은 폐지됐다. 새 행은 항상 `RATING_START_ELO`(1000)로 시작한다. 「행을 처음 만드는 순간 한 번」이라는 시점 규칙만 남는다. 아래는 이력으로 둔다.

(사용자, 게임, 시즌) 행을 **처음 만드는 순간** 한 번 계산한다.

```
prev = 그 (사용자, 게임)의 ratings 행 중 season.starts_at < 대상 시즌.starts_at 인 것의 최신(core pickPreviousRating)
시작값 = prev ? softResetElo(prev.elo, ratio) : 티어 시드(D103)
carried_from_season_id = prev?.seasonId ?? null
```

`softResetElo = 1000 + roundHalfAwayFromZero((elo − 1000) × ratio)`, ratio = `SEASON_SOFT_RESET_RATIO`(0.5). 반올림은 변동분에 적용해 1000 기준 대칭이다(D104와 같은 이유).

| 경우 | 시작값 |
| --- | --- |
| 직전 시즌 행 있음(5경기 이상) | 소프트 리셋 |
| 직전 시즌 행 있음(**5경기 미만**) | 소프트 리셋(같은 규칙, 경기 수 무관, D142) |
| 직전 시즌은 안 뛰고 그 전 시즌 행 있음(**연속 빈 시즌**) | 가장 최근 행에 소프트 리셋 **1회**(빈 시즌 수만큼 반복하지 않음, D142) |
| 시즌 **공백**(직전 시즌과 새 시즌 사이 기간이 빔) | 같음. 기간은 영향 없음 |
| **이전 시즌 행 없음** | 티어 시드(D103). 첫 레이팅(문서 7-1) |

왜 종료 작업이 아니라 첫 행 생성에서 하는가(D140): 값이 「이전 시즌 행」의 순수 함수이고, 행 생성이 한 경로뿐이며, 유일 키가 있어 작업 실행 순서·횟수와 무관하게 정확히 한 번 적용된다. 자동 시즌은 첫 승인 때 생기므로 종료 작업 시점에 다음 시즌 행이 없을 수도 있다. ELO 랭킹은 5경기 이상만 보이므로 0경기 행을 미리 만들 이유도 없다.

검증 값(ratio 0.5): 1421 → 1211(+210.5 → +211), 1512 → 1256, 1000 → 1000, 1001 → 1001, 999 → 999, 800 → 900, 1500 → 1250. ratio 0 → 1000, ratio 1 → 그대로.

### 6-2. 승인 흐름 변경 (S3 5-5)

실행 순서(rated 반영 있음): 1 → 2 → 3 → 5 → 6 → 7a → 8 → 4 → 7b → **7c** → **9(변경)** → 10 → 11 → 12 → 13. 반영 없음은 그대로.

- **7c (새)** `lockSeasonForRating(tx, season.id)`(`rating-locks.ts`):
  ```sql
  SELECT closed_at FROM seasons WHERE id = $1 FOR SHARE
  ```
  `closed_at`이 있으면 로그 + `INTERNAL_ERROR`(전체 롤백, 결과 pending 유지). 잠금은 커밋까지 유지된다.
- **9 (변경)** 없는 사용자에 대해 `loadPreviousRatings(tx, game, season.startsAt, missing)` → 6-1 시작값. prev가 없는 사용자만 `loadTierSeeds`. `createMany({ data: [{…, elo, carriedFromSeasonId}], skipDuplicates: true })` 후 다시 조회(그대로). **→ 20절로 변경: `createMany({ data: [{ userId, gameId, seasonId, elo: RATING_START_ELO }], skipDuplicates: true })`. 이전 시즌·티어 조회 없음, `carriedFromSeasonId` 안 씀(20-4). 7c는 유지(D185)**

`loadPreviousRatings`는 8단계 사용자 잠금 아래에서 읽으므로, 같은 사용자의 직전 시즌 승인이 진행 중이면 그 커밋 뒤 값을 본다. 잠금 뒤에 now를 정하는 D128 덕분에 사용자별 승인 순서와 시즌 순서가 같다. (20절 이후 이 문단은 이력이다. 사용자 잠금은 ratings 갱신 직렬화를 위해 그대로 쓴다)

### 6-3. 시즌 종료 작업 `SeasonCloser` (D141, D144)

`runOnce()`: 바깥 트랜잭션 `pg_try_advisory_xact_lock(hashtext('season-close'))` — 실패하면 `{acquired: false}`로 끝(다른 인스턴스 실행 중). 잡으면:

1. `seasons = season.findMany()`, `now = clock.now()`.
2. `selectSeasonsToClose(seasons, now, SEASON_CLOSE_GRACE_SEC × 1000)`: `closedAt == null && endsAt + 유예 ≤ now`, `endsAt ASC, id ASC`.
3. 각 시즌을 **별도 트랜잭션**으로 `closeOne`. 실패는 로그 + `failed++`, 다음 시즌 계속(다음 주기에 재시도). 시즌끼리 의존이 없다(D140).

`closeOne(seasonId, now)` — `$transaction` READ COMMITTED, timeout 60000ms, maxWait 10000ms, 전부 또는 전무:

1. `SELECT id, ends_at, closed_at FROM seasons WHERE id = $1 FOR NO KEY UPDATE`. 없음·`closed_at` 있음·유예 전 → 건너뜀(`'skipped'`).
2. 그 시즌 `ratings` 전체 + `user: rankableUserWhere`. 1번 잠금 **뒤에** 읽는다.
3. 게임별 `computeSeasonStandings({rows, minGames})` → `seasonStanding.createMany(skipDuplicates)`.
4. 순위가 1명이라도 있는 게임: `badge.createMany(seasonBadgeSeed(game), skipDuplicates)`(시드를 안 돌린 환경 방어) → 코드로 id 조회.
5. `computeSeasonBadges(standings)` → `userBadge.createMany({ userId, badgeId, seasonId, earnedAt: endsAt }, skipDuplicates)`.
6. `season.updateMany({ where: {id, closedAt: null}, data: {closedAt: now} })` — 영향 행 1이 아니면 롤백.

GameCode로 parse되지 않는 games 행은 그 게임만 건너뛰고 로그. 빈 시즌도 같은 경로로 `closed_at`만 찍힌다. `ratings`는 쓰지 않는다.

**잠금 관계(교착 없음):** 승인 = 내전 행 → (시즌 생성) → 사용자 → 시즌 행 FOR SHARE. 종료 = season-close(try) → 시즌 행 FOR NO KEY UPDATE. 종료는 내전·사용자 잠금을 잡지 않아 순환이 없다. FOR SHARE와 FOR NO KEY UPDATE는 충돌하고, FOR KEY SHARE(새 행의 FK 검사)와는 충돌하지 않으므로 새 시즌 승인이 지난 시즌 종료 작업을 기다리지 않는다.

### 6-4. 뱃지 (D145)

| 항목 | 값 |
| --- | --- |
| 지급 대상 | 게임별 `season_standings` rank 1·2·3 |
| 코드 | `season_{game}_top{1\|2\|3}` (`seasonBadgeCode`), 예 `season_lol_top1` |
| 시드 | shared `SEASON_BADGE_SEED`(GAME_SEED × 3 = 현재 9행). `seed.ts` code upsert. 배포 CMD가 매번 실행 |
| 이름 | `{game.name} 시즌 {n}위`, 화면은 `{season.name} · {이름}` |
| 유일 키 | `(user_id, badge_id, season_id)` 그대로. 코드가 게임별이라 같은 시즌 롤 1위 + 롤체 1위가 충돌하지 않는다 |

### 6-5. 경합 시나리오 (QA 대조표)

T = 시즌 S의 `ends_at`.

> **20절로 변경(D183):** 아래 표의 「리셋」은 모두 「S+1 새 행을 1000으로 만든다」로 읽는다(1·2·5·10행). 1과 2가 같은 값이라는 결론, 4·6–9·11행은 그대로다(20-4).

| # | 상황 | 결과 |
| --- | --- | --- |
| 1 | 종료 작업 → 다음 승인 | S 순위 확정. 승인 때 S 행에서 1회 리셋 |
| 2 | **승인 → 종료 작업**(종료가 아직 안 돔, now ≥ T) | 승인은 S+1에 반영(없으면 D116 자동 생성). S 행 값으로 1회 리셋. S 행은 안 바뀌므로 이후 종료 작업의 standings가 같다. 1과 **같은 값** |
| 3 | now < T로 시작한 승인이 T 뒤에 커밋 | 승인 상한 15초 < 유예 60초 → 종료 작업이 돌기 전에 끝난다. 어긋나도 종료 작업의 FOR NO KEY UPDATE가 FOR SHARE를 기다려 커밋된 값을 읽는다 |
| 4 | 시계가 어긋나 종료 뒤 S에 승인 시도 | 7c에서 closed_at 발견 → INTERNAL_ERROR, 롤백. standings 오염 없음. 재시도하면 S+1에 반영 |
| 5 | 같은 사용자 새 시즌 첫 승인 2건 동시 | 사용자 잠금으로 직렬화, 둘째는 기존 행 사용. 리셋 1회 |
| 6 | 종료 작업 동시 실행 | try lock으로 한쪽 종료. 잠금을 뚫어도 시즌 행 잠금 후 closed_at을 다시 본다 |
| 7 | 종료 작업이 중간에 죽음 | 트랜잭션 전체 롤백 → 다음 주기에 처음부터. 부분 지급 없음 |
| 8 | 재실행 | closed_at 때문에 대상 아님. 마지막 방어선: standings·user_badges 유일 키 + skipDuplicates |
| 9 | 서버가 오래 꺼짐, 끝난 시즌 여러 개 | ends_at 오름차순으로 전부 처리 |
| 10 | 시즌 공백 후 승인 | D139 자동 시즌 + 가장 최근 행에서 리셋 1회 |
| 11 | S 경계에서 pending이던 결과를 T 뒤에 승인 | 승인 시각 기준 S+1에 반영(D116, D165). S 순위에 안 들어간다 |

---

## 7. 랭킹 캐시 (D146–D155)

### 7-1. 저장과 키

저장소는 **`ranking_caches` 표 하나**, Redis 유무와 무관하게 같은 경로(D146). 구현은 토큰 `RANKING_CACHE_STORE` 인터페이스 뒤에 둔다(테스트 메모리 구현, `memory-sync-store.ts`와 같은 방식).

```ts
interface RankingCacheStore {
  read(key: string): Promise<RankingCacheRow | null>;
  /** 새 값 저장. computed_at이 더 새로울 때만 덮어쓴다. last_failed_at·last_error = null */
  write(key: string, row: { payload: unknown; computedAt: Date; baselinePeriodStart: Date; baselineRanks: Record<string, number> }): Promise<void>;
  /** 값은 두고 실패만 기록. 행이 없으면 아무것도 안 함 */
  markFailed(key: string, at: Date, reason: string): Promise<void>;
  /** keep에 없는 `rankings:` 키 삭제 */
  deleteExcept(keep: readonly string[]): Promise<number>;
}
```

| key | 내용 | 갱신 대상 |
| --- | --- | --- |
| `rankings:tier:{game}` | `TierRankingCachePayload` | 랭크 큐가 있는 games 행(lol, tft) |
| `rankings:elo:{game}:{season_id}` | `EloRankingCachePayload` | 모든 games × `closed_at IS NULL && starts_at ≤ now`인 시즌 |

`write`는 `INSERT … ON CONFLICT (cache_key) DO UPDATE … WHERE ranking_caches.computed_at <= EXCLUDED.computed_at`(늦게 끝난 오래된 계산이 새 값을 덮지 않게).

### 7-2. 계산 `computeAndStore(target, now)`

1. entries 계산(아래).
2. `prior = store.read(key)`. payload를 parse해 `previousRanks`(실패·없음 → null).
3. `baseline = rollRankBaseline({ stored, previousRanks, weekStart: kstWeekWindow(now).start })`.
4. 각 행 `rank_change = computeRankChange(baseline.ranks[userId], rank)`.
5. `store.write`.

티어 entries: 해당 게임 `game_accounts`(`is_primary && verified`, `user: rankableUserWhere`) + 그 큐 최신 스냅샷 1행. 이력이 쌓이는 표이므로 전체를 읽지 말고 `SELECT DISTINCT ON (rs.game_account_id) … FROM rank_snapshots rs JOIN game_accounts ga ON ga.id = rs.game_account_id WHERE ga.game_id = $1 AND ga.is_primary AND ga.verified AND rs.queue = $2 ORDER BY rs.game_account_id, rs.captured_at DESC, rs.created_at DESC`로 조회한다(계정 id 배열을 넘기지 않는다). `user: rankableUserWhere`는 계정 조회 쪽에 있고 스냅샷은 그 계정과 합칠 때 걸러진다. 형식 불량·UNRANKED는 제외 후 `buildTierRanking`. `account_name` = `display_name`.

ELO entries: `ratings` where game, season, `user: rankableUserWhere` → `buildEloRanking({rows, minGames})`. `avatar_url` = `discordAvatarUrl`.

### 7-3. 읽기 (`RankingsReader`)

```
row = store.read(key); parse 실패 → 없음으로 취급(로그)
있음 → 그대로 응답. 오래됐어도 읽기가 다시 계산하지 않는다(D148)
없음 → 인스턴스 안 단일 실행(key별 Map<Promise>)으로 computeAndStore → 응답. 실패 → INTERNAL_ERROR
```

`eloRankOf`·`me` 조회는 같은 행을 쓴다. `eloRankOf`는 첫 계산을 일으키지 않는다.

### 7-4. 주기 작업 `RankingRefresher`

`runOnce()`: `pg_try_advisory_xact_lock(hashtext('ranking-refresh'))`(timeout 5분) → 실패하면 `{acquired: false}`. 잡으면 7-1 대상 키마다 try/catch로 `computeAndStore`, 실패는 `store.markFailed(key, now, 메시지 앞 200자)` + 로그(한 키 실패가 다른 키를 막지 않는다). 끝에 `store.deleteExcept(대상 키)`(닫힌 시즌 키 정리).

### 7-5. 스케줄러 `RankingJobsScheduler` (D164)

`@Cron('*/5 * * * *', { timeZone: 'Asia/Seoul' })` + 프로세스 시작 시 1회(기동을 기다리지 않음). 한 tick = **`SeasonCloser.runOnce()` → `RankingRefresher.runOnce()`**, 각각 try/catch(종료 실패가 캐시 갱신을 막지 않는다). `RANKING_JOBS_ENABLED=false`면 등록하지 않는다(실행기 클래스는 항상 등록, 테스트·수동 실행용).

### 7-6. 요구별 정리

| 질문 | 결정 |
| --- | --- |
| 저장 위치 | `ranking_caches`(PostgreSQL). Redis 없어도, 있어도 같다 |
| 키 | 7-1 |
| 5분 작업 | 7-4, 7-5. `*/5` KST |
| 빈 캐시 첫 요청 | 동기 계산 후 응답. 이후 읽기는 계산하지 않음 |
| 갱신 시각 필드 | `synced_at`(= computed_at) + `stale` |
| 실패 시 | payload·computed_at 유지, `last_failed_at`만 기록 → `stale: true`, 마지막 성공값 응답 |
| 내 순위 | payload는 공용 전체 목록. 요청마다 `me`를 찾아 넣는다. payload에 사용자별 값 없음 |
| 다중 인스턴스 | 저장소 공유, 작업은 try lock, 동시 첫 계산은 같은 값 + `computed_at` 조건부 쓰기 |
| 순위 변동 | 7-7 |
| 페이징 | 없음. `items` 최대 200, `next_cursor` null, `total` 제공 |
| 종료 시즌 | `closed_at` 있으면 `season_standings` |

### 7-7. 순위 변동 (D153)

기준 = **이번 KST 주(월요일 00:00)가 시작될 때의 순위**. 한 주 동안 기준이 고정되어 5분 갱신으로 흔들리지 않고, 값은 실제 순위가 바뀔 때만 바뀐다.

`rollRankBaseline`:

| 상태 | 결과 |
| --- | --- |
| 저장된 기준의 period = 이번 주 시작 | 그대로 |
| 기준이 지난 주 것, 이전 payload 있음 | `{period: 이번 주, ranks: 이전 payload의 순위}` — 주가 바뀌기 직전 마지막 스냅샷 |
| 행 없음(첫 계산) | `{period: 이번 주, ranks: {}}` |

`rank_change = 기준 순위 − 현재 순위`, 기준에 없으면 null. 화면: 양수 `▲n`, 음수 `▼n`, 0·null `—`. 첫 주와 새 시즌 첫 주는 전부 `—`다(슬라이스 「기준 자료가 없으면 `—`」). 종료 시즌은 항상 null.

---

## 8. 대시보드 (D156–D158)

`DashboardService.summary(viewer)`, `now` 1회.

| 필드 | 출처 | 범위 |
| --- | --- | --- |
| season | seasons, `resolveSeasonAt(now)`, `seasonDaysLeft`, `seasonProgress` | 공용, 요청마다 |
| rating_policy | env | 공용 |
| stats | scrims 집계 2회. 이번 주 = core `kstWeekWindow(now)`, `status ≠ cancelled` | 공용, 요청마다 |
| top_rankers | `RankingsReader`(4-2와 같은 출처, 5분 캐시/standings) | 공용, 캐시 |
| recent_results | scrim_results + scrims + rating_history | 공용, 요청마다 |
| next_scrim | 8-1 | 사용자별, 요청마다 |
| recruiting | `status ∈ {recruiting, full}`, `scheduled_at ASC, id ASC`, next_scrim 제외 최대 3개, `ScrimViews.summaries` | 사용자별(my_status), 요청마다 |
| me | 8-2 | 사용자별 |

응답 전체를 캐시하지 않는다(D156). 모집 인원은 요청마다 읽고, 랭킹만 5분 캐시다.

### 8-1. 다음 내전

1. 내가 `joined`이고 scrim `status ∈ {recruiting, full}`, `scheduled_at ASC, id ASC` 첫 행 → `source: 'joined'`. 시작 시각이 지난 내전은 자동 마감(최대 60분) 전까지 남아 카드가 「곧 시작」으로 보인다.
2. 없으면 `status = recruiting && scheduled_at > now` 첫 행 → `source: 'recruiting'`.
3. 없으면 null.

대기(waitlist)·`playing`은 대상이 아니다. `playing`은 결과가 입력될 때까지 무기한 남을 수 있어 「다음」 카드를 막는다(D158). `participants`는 그 내전 joined, S2 슬롯 순서(`orderSlots`) 앞 6명.

### 8-2. top_rankers·me

- 시즌 = `resolveSeasonAt(now) ?? latestStartedSeason(now)`. 없으면 `top_rankers = null`(21절: `top_rankers_state: 'no_season'`).
- game = `games.sort_order` 순으로 4-2 출처를 읽어 처음 행이 있는 게임, 전부 비면 첫 게임.
- **→ 21절로 변경: 아래 두 예외는 `top_rankers_state`로 나눈다(시즌 없음 `no_season`, games 빈 경우·첫 계산 실패 `unavailable`, D196–D198). 주석도 21절에서 고쳤다.** 이전 동작(기록용): `games`가 비면 시즌이 있어도 `top_rankers = null`이라 화면이 「아직 시즌이 없어요」로 보인다(시드는 배포 CMD가 돌리므로 시드 없는 DB에서만 생긴다). 이 블록의 첫 계산이 실패하면 요약 전체가 500이다(2절). `packages/shared/src/dashboard.ts`의 「시즌이 하나도 없으면 null」 주석은 Q8 결정 때 함께 고친다.
- me: 현재 시즌 없으면 null. 내 `ratings` 행 중 `wins + losses` 최대(같으면 sort_order) → 없으면 null. 그 게임 캐시 행의 내 entry가 있으면 `elo`·`rank`는 entry 값, 없으면 `elo` = ratings 값·`rank` null. `games` = wins + losses.

### 8-3. 최근 내전 결과

`scrim_results` approved(`approved_at DESC`) 4개 + pending(`created_at DESC`) 4개를 읽어 `at` 내림차순 병합, 같으면 scrim id ASC, 앞 4개.

- outcome: `winner_team` 또는 placements 1위 사용자.
- rating_status: S3 4-1 규칙(`waiting`·`applied`·`skipped`·`not_rated`).
- elo_swing: 팀 게임 && applied → 그 내전 `|elo_after − elo_before|` 최댓값, 그 외 null.
- N+1 금지(내전·사용자·이력을 id 목록으로 일괄 조회).

---

## 9. core 함수 (`packages/core`, domain-logic)

I/O 없음, 시각은 인자, env 값은 인자. `index.ts` export 추가. 전부 단위 테스트.

### 9-1. `src/time.ts`

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| kstWeekWindow | `(now: Date) => { start: Date; end: Date }` | KST 월요일 00:00 시작 7일 |

### 9-2. `src/ranking.ts` (새 파일, 문서 7-3)

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| tierScore | `(rank: { tier: RiotTier; division: RiotDivision \| null; lp: number }) => number` | `RIOT_TIER_ORDER × 400 + (division ? RIOT_DIVISION_ORDER : 0) × 100 + lp`. 마스터 이상은 디비전 0(D152). 알 수 없는 tier·division, 0 이상 정수가 아닌 lp는 RangeError |
| compareRanking | `(a, b: { userId; value: number; wins; losses }) => number` | value DESC → 승률 DESC(`a.wins × bGames` 교차 곱, 0경기 = 승률 0) → 경기 수 DESC → userId ASC |
| buildTierRanking | `<T extends { userId; tier: RankTier; division; lp; wins; losses }>(rows: readonly T[]) => (T & { rank; score })[]` | UNRANKED 제외, value = tierScore, compareRanking, rank 1.. |
| buildEloRanking | `<T extends { userId; elo; wins; losses }>(input: { rows: readonly T[]; minGames: number }) => (T & { rank; games; winRate })[]` | `wins + losses ≥ minGames`, value = elo, winRate = computeWinRate |
| computeRankChange | `(baselineRank: number \| undefined, rank: number) => number \| null` | 없으면 null, 아니면 baseline − rank |
| rollRankBaseline | `(input: { stored: { periodStart: Date; ranks: Record<string, number> } \| null; previousRanks: Record<string, number> \| null; weekStart: Date }) => { periodStart: Date; ranks: Record<string, number> }` | 7-7 표 |
| isRankingStale | `(input: { computedAt: Date; lastFailedAt: Date \| null; now: Date }) => boolean` | `lastFailedAt > computedAt` 또는 `now − computedAt > RANKING_STALE_AFTER_SEC` |

검증 값(목업): Diamond II 45 LP = 2645, Emerald I 80 = 2380, Emerald III 12 = 2112, Platinum I 67 = 1967, Gold I 90 = 1590, Gold II 20 = 1420. Iron IV 0 = 0, Master 0 LP = 2800, Grandmaster 0 = 3200, Challenger 1000 = 4600.

### 9-3. `src/season.ts` 추가

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| ~~softResetElo~~ | `(elo: number, ratio: number) => number` | 6-1. ratio ∉ [0,1] RangeError. **20절로 변경: 삭제(D183)** |
| ~~seasonStartElo~~ | `(input: { previousElo: number \| null; tierSeed: number; ratio: number }) => number` | 6-1. **20절로 변경: 삭제(D183)** |
| ~~pickPreviousRating~~ | `<R extends { seasonId: string }>(input: { rows: readonly R[]; seasons: readonly SeasonLike[]; targetStartsAt: Date }) => R \| null` | 행의 시즌 중 `startsAt < target`, startsAt 최신 → endsAt 최신 → seasonId ASC. seasons에 없는 행 무시. **20절로 변경: 삭제(D183)** |
| selectSeasonsToClose | `<T extends SeasonLike & { closedAt: Date \| null }>(seasons: readonly T[], now: Date, graceMs: number) => T[]` | 6-3 2번. 경계 포함(`endsAt + 유예 = now`이면 대상) |
| computeSeasonStandings | `(input: { rows: readonly { userId; elo; wins; losses }[]; minGames: number }) => { userId; rank; elo; wins; losses }[]` | buildEloRanking |
| computeSeasonBadges | `(standings: readonly { userId; rank }[]) => { userId: string; place: SeasonBadgePlace }[]` | rank가 `SEASON_BADGE_PLACES`(1·2·3)에 있는 행만. 0·음수·소수는 제외. place ASC → userId ASC |
| seasonDaysLeft | `(endsAt: Date, now: Date) => number` | `(endsAt − 1ms)의 KST 날짜 − now의 KST 날짜`, 최소 0 |
| seasonProgress | `(season: { startsAt; endsAt }, now: Date) => number` | 0–1 자르기, 소수 셋째 자리 |

테스트 필수: 6-1 검증 값·표 5경우, 반올림 대칭, 연속 빈 시즌 리셋 1회, 겹친 시즌 결정성, 유예 경계 ±1ms, 동점 4단계, 입력 순서를 섞어도 결과 동일, 승률 교차 곱(2/3 vs 4/6 동률), 7-7 표, KST 일요일 23:59 ↔ 월요일 00:00(UTC 일요일 15:00) 경계, D-day(마지막 날 0, 끝난 뒤 0).

**core 신규 합계 16개**: kstWeekWindow, tierScore, compareRanking, buildTierRanking, buildEloRanking, computeRankChange, rollRankBaseline, isRankingStale, softResetElo, seasonStartElo, pickPreviousRating, selectSeasonsToClose, computeSeasonStandings, computeSeasonBadges, seasonDaysLeft, seasonProgress. 기존 `computeWinRate`, `roundHalfAwayFromZero`는 재사용한다. 추가 export: 상수 `SEASON_SOFT_RESET_CENTER`(1000, `config.ts`), 타입 `RankingComparable`, `RankBaseline`. **20절로 변경: `softResetElo`·`seasonStartElo`·`pickPreviousRating`·`SEASON_SOFT_RESET_CENTER` 삭제(D183, 20-3)**

---

## 10. 화면 (frontend)

공통: 시각 KST, 마이너스 U+2212, 색은 토큰(D53), env 값 직접 사용 금지(`RANKING_ELO_MIN_GAMES_DEFAULT`, `SEASON_SOFT_RESET_RATIO_DEFAULT`는 목 전용, **후자는 20절에서 삭제**). 값이 없는 카드에 가짜 숫자를 넣지 않는다.

### `/rankings` (목업 Rankings)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 머리 | `synced_at`, `stale`, `is_final` | 「5분마다 갱신 · HH:mm」(`RANKING_CACHE_INTERVAL_MIN`). stale → 「갱신 지연 · 마지막 HH:mm」. is_final → 「시즌 최종 순위」 |
| 탭 | - | 티어·내전 ELO(기본), 활동·플레이타임은 `aria-disabled` + 「봇 연동 후 제공」. 탭 설명 문구는 목업 |
| 필터 | `GET /games`, `GET /seasons` | 티어: 게임(`TierRankingGame` 값만). ELO: 게임 + 시즌(기본 = 파라미터 생략, 응답 `season`을 표시). 선택은 URL 쿼리. 잘못된 쿼리 값은 없는 것으로 친다. 시즌 0개면 select 비활성 + 「시즌 없음」. 주소의 시즌이 목록에 없으면 응답 `season`과 같은 시즌은 그 이름, 아니면 옵션 「—」 |
| 상위 3명 | `items`의 `rank` 1·2·3 | 2·1·3 배치. 자리는 배열 위치가 아니라 응답 `rank`로 정한다(종료 시즌은 탈퇴로 2위부터 시작할 수 있고 그때 1위 자리는 비운다). 전체 빈 상태면 영역 숨김 |
| 표 | `items`, `me` | RANK · PLAYER · (티어: TIER, SCORE / ELO: RECORD 「22승 9패 · 71%」, RATING) · +/−. PLAYER 보조 줄: 티어 `account_name`, ELO 「{games}경기」. 내 행 강조 + `YOU`. `me`가 items 밖이면 맨 아래 한 줄 추가. 모바일은 TIER·RECORD 열과 아바타를 숨기고 값을 PLAYER 줄에 합친다(목업의 가로 스크롤 대신) |
| 규칙 문구 | `min_games`, `is_final` | 티어: 「티어 점수 = 티어 × 400 + 디비전 × 100 + LP」. ELO: 「{min_games}경기 이상 치른 멤버만 표시 · 동점이면 승률 순」. is_final: 「시즌 종료 때 확정된 순위 · 동점이면 승률 순」(지금 `min_games`가 그 시즌 기준이 아닐 수 있다, 13절) |
| 상태 | - | 로딩 스켈레톤, 빈 상태(티어 「라이엇 계정을 연동한 멤버가 아직 없어요」, ELO 「{min_games}경기 이상 치른 멤버가 아직 없어요」, 시즌 없음 「아직 시즌이 없어요」, 종료 시즌 「이 시즌에 순위에 든 멤버가 없어요」, 시작 전 시즌 「아직 시작하지 않은 시즌이에요」), 없는 시즌(NOT_FOUND) 「시즌을 찾을 수 없어요」 + 「기본 시즌 보기」, 오류 재시도. ELO 빈 상태 보조 문구는 `is_final`이거나 `season.ends_at <= now`이거나 now를 아직 모르면 생략한다. 재조회 실패 때 이전 데이터 유지 |

### `/` 홈 (목업 Main·MobileHome)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 다음 내전 | `next_scrim` | 게임·정원, rated면 「시즌 ELO 반영」, 카운트다운(`useNow`), 슬롯, `open_positions`, 아바타 `participants` + 「외 {joined_count − participants.length}명 참가 중」. source joined면 「상세 보기」만, recruiting이면 「참가하기」도 상세로. null → 「예정된 내전이 없어요」 + 「내전 모집」 |
| 통계 | `stats` | 「모집 중인 내전」, 「이번 주 내전」 두 카드. 음성·활동 카드는 숨김. 스파크라인·증감 없음 |
| 모집 중 | `recruiting` | 목업 3행, 「전체 보기」 |
| 시즌 ELO TOP 5 | `top_rankers` | 모바일은 3명. is_final이면 제목에 「{season.name} 최종」. 막대 폭 = elo ÷ 1위 elo. 빈 상태 `min_games` 문구 |
| 최근 내전 결과 | `recent_results` | 팀: `BLUE WIN`/`RED WIN`(D174). 개인: 「1위 {winner}」. 상태: pending 「승인 대기」, applied 「최대 {elo_swing}점 변동」(D179) 또는 「반영 완료」, skipped·not_rated 「미반영」 |
| 패치·이벤트 | - | 숨김(S6) |

목업에서 뺀 것(응답에 값이 없어 가짜 숫자를 만들지 않는다): 다음 내전 히어로의 팀 평균 패널, TOP 랭커의 티어 육각형.

### 사이드바·모바일 머리 (목업 Main·MobileHome, D157)

`useDashboardSummary` 공유(staleTime 60초, `refetchInterval` 5분). 홈과 같은 쿼리 키라 요청은 한 번이다. `useTierRanking`·`useEloRanking`도 `refetchInterval` 5분(`RANKING_CACHE_INTERVAL_MIN × 60초`)이다. 화면을 열어 둔 채로도 캐시 주기마다 새 값을 받는다.

| 항목 | 표시 |
| --- | --- |
| 시즌 카드 | 「{season.name}」 + `days_left` 「D-34」(0이면 「D-DAY」), 12칸(`progress × 12` 반올림), 안내(`soft_reset_ratio`, N = ratio × 100 반올림) — 0.5: 「종료 시 레이팅 절반 소프트 리셋」, 1: 「종료 시 레이팅 유지」, 0: 「종료 시 레이팅 1000으로 초기화」, 그 외: 「종료 시 1000 기준 차이의 {N}%만 유지」(식이 레이팅 전체가 아니라 1000과의 차이에 적용된다, ratio 0.3이면 1600 → 1180). **→ 20절로 변경: 안내는 고정 문구 「종료 시 모두 {RATING_START_ELO}점으로 초기화」(20-7)** |
| season null | 「다음 시즌 준비 중」, 「첫 내전 결과가 승인되면 시작돼요」 |
| 사용자 카드 | 「ELO {elo} · #{rank}」, rank null → 「ELO {elo}」, me null → 기존 표시 |
| 요약 실패 | 시즌 카드 숨김, 사용자 카드 유지(앱 셸을 막지 않는다) |
| 모바일 머리 | 「{season.name} · D-34」 |

### `/members/[id]`

- BADGES: `badges`. 카드 = 표시 `#{place}`(gold·silver·bronze 토큰, 시즌 뱃지가 아니면 코드 없이 이름만), 「{season.name} · {name}」, `earned_at − 1ms`의 `YYYY.MM` KST(D166). `[]`·null → 「아직 받은 뱃지가 없어요」.
- 내전 레이팅 카드 mark: `rank`가 있으면 `#{rank}`, 머리 칩 「#3 ELO」(`rank` 있을 때만).
- 카드 빈 상태(D168): `ratings []`이고 `scrim.season` 있음 → 「내전 기록 없음」 + 시즌 이름. `scrim.season` null → 「다음 시즌 준비 중」 + 「현재 진행 중인 시즌이 없어요」. 시즌 공백 중에는 최근 내전·그래프에 기록이 나오므로 「내전 기록 없음」이라고 쓰지 않는다.

### 훅·목

- 훅: `useTierRanking`, `useEloRanking`, `useDashboardSummary`(`lib/hooks/rankings.ts`, `lib/api/rankings.ts`). 승인 응답에서 요약·랭킹 쿼리를 무효화해도 캐시 때문에 값이 늦을 수 있다(정상).
- 세션 사용자 변경(D167): 다른 탭의 재로그인 등으로 사용자가 바뀌면 `applySessionUser`가 `me` 외 쿼리를 `resetQueries`한다. 요약에는 쿼리 키에 사용자 id가 없다.
- 목(`NEXT_PUBLIC_API_MOCK`): 3개 엔드포인트, `badges`·`rank`. 계산은 `@gcd/core` import(공식 복사본 금지). 종료 작업과 소프트 리셋은 흉내 내지 않는다. 끝난 시즌(ends_at + 유예 ≤ now)은 저장된 ratings로 읽을 때 순위·뱃지를 계산해 standings처럼 내려 준다.
- 목 시나리오: localStorage `gcd-mock-rankings` = `stale` | `final` | `no_season` | `empty` | `error` | `loading` | `me_outside` | `me_error`. `GET /seasons`에도 적용한다. `me_error`는 세션 부팅(`/auth/refresh`, `/me`) 5xx. 목 시드 버전 5(`SEED_VERSION`), 버전이 다르면 재시드.

---

## 11. 구현 경계 (backend 모듈)

| 위치 | 내용 |
| --- | --- |
| `modules/rankings/rankings.module.ts`(새) | 일반 모듈. `RANKING_CACHE_STORE`, `RankingCalculator`, `RankingsReader`, `RankingRefresher`, `SeasonCloser`, 컨트롤러. export `RankingsReader`, `RankingRefresher`, `SeasonCloser`(뒤의 둘은 스케줄러용) |
| `modules/rankings/ranking-jobs.module.ts`(새) | `RankingJobsModule.forRoot()` — `RANKING_JOBS_ENABLED`면 `sharedScheduleModule` + `RankingsModule` + `RankingJobsScheduler`. 다른 모듈이 RankingsModule을 import해도 cron이 중복되지 않게 분리 |
| `common/shared-schedule.ts`(새) | `sharedScheduleModule` = 앱 전체가 공유하는 `ScheduleModule.forRoot()` 객체 하나. `forRoot()`를 직접 부르지 않는다(D164) |
| `jobs/jobs.module.ts`, `modules/scrims/scrims.module.ts` | `ScheduleModule.forRoot()` → `sharedScheduleModule` |
| `modules/rankings/ranking-cache.store.ts`(새) | `PrismaRankingCacheStore`(7-1) |
| `modules/rankings/ranking-keys.ts`(새) | 키 생성 함수 |
| `modules/rankings/ranking-calculator.service.ts`(새) | 7-2 |
| `modules/rankings/rankings-reader.service.ts`(새) | 7-3, 4-1·4-2 응답, `eloRankOf` |
| `modules/rankings/ranking-refresher.ts`(새) | 7-4 |
| `modules/rankings/season-closer.ts`(새) | 6-3 |
| `modules/rankings/ranking-jobs.scheduler.ts`(새) | 7-5 |
| `modules/rankings/rankable-users.ts`(새) | D161 |
| `modules/dashboard/`(새) | 컨트롤러 + `DashboardService`(8절). `ScrimViews` 필요 → `ScrimsModule.forRoot()`의 `exports`에 `ScrimViews` 추가, DashboardModule은 `ScrimsModule.forRoot()`를 import(D164 동일 객체 규칙) |
| `modules/ratings/rating-carry.ts`(새) | `loadPreviousRatings(db, game, targetStartsAt, userIds)`: seasons 조회 → `rating.findMany` → `pickPreviousRating`. 승인·읽기 공용. **20절로 변경: 파일 삭제(D183)** |
| `modules/ratings/rating-locks.ts` | `lockSeasonForRating` |
| `modules/ratings/rating-inputs.service.ts` | D160. **20절로 변경: 행이 없으면 1000, w는 현재 시즌 경기 수(20-4)** |
| `modules/scrims/scrim-results.service.ts` | 6-2 |
| `modules/profile/*` | 4-4. ProfileModule이 RankingsModule import |
| `config/env.ts` | 13절, `rankingJobsEnabledFromEnv` |
| `app.module.ts` | RankingsModule, DashboardModule, `RankingJobsModule.forRoot()` |
| `apps/api/vitest.config.ts` | `RANKING_JOBS_ENABLED: 'false'` |

---

## 12. 상태 전이

`scrims`·`scrim_players`·`scrim_results` 전이 변경 없음. 시즌 상태는 값이 아니라 판정이다.

```
seasons: 진행 중(starts_at ≤ now < ends_at)
       → 끝남·미처리(now ≥ ends_at, closed_at NULL)   ratings 잠김(승인이 다음 시즌으로 간다), 조회는 캐시
       → 종료 처리됨(closed_at 있음)                  조회는 season_standings
```

---

## 13. 환경 변수 (`.env.example` 반영됨, 신규 3개)

| 변수 | 사용처 | 기본 | 비고 |
| --- | --- | --- | --- |
| ~~SEASON_SOFT_RESET_RATIO~~ | api | 0.5 | 0–1 실수. 문서 7-3. **20절로 변경: 삭제(D183). `.env.example`에서 지움** |
| RANKING_ELO_MIN_GAMES | api | 5 | 양의 정수. 값을 바꿔도 이미 닫힌 시즌 standings는 그대로 |
| RANKING_JOBS_ENABLED | api | true | `strictBool`. 모듈 구성 시점에 읽는다(D96과 같음) |

기본값 상수: shared `SEASON_SOFT_RESET_RATIO_DEFAULT`, `RANKING_ELO_MIN_GAMES_DEFAULT`. `AppConfig`: `seasonSoftResetRatio: number`, `ranking: { eloMinGames: number; jobsEnabled: boolean }`. 화면 노출: `rating_policy`, `GetEloRankingResponse.min_games`. **20절로 변경: `SEASON_SOFT_RESET_RATIO_DEFAULT`·`seasonSoftResetRatio` 삭제**

설정값이 아닌 상수: `RANKING_CACHE_INTERVAL_MIN`(5), `RANKING_STALE_AFTER_SEC`(660), `RANKING_ITEMS_MAX`(200), `SEASON_CLOSE_GRACE_SEC`(60), 뱃지 순위 1·2·3.

---

## 14. 담당 배정과 실행 순서

S4 실행 구현자: **logic**, **backend**, **frontend** (+ qa). integration 없음(외부 호출 없음, 티어는 저장된 스냅샷만 읽는다).

```
architect(완료)
  ├─ logic ──────────────────────────┐
  ├─ backend(9절 시그니처로 시작) ───┼─ 전체 테스트 → qa
  └─ frontend(목 백엔드로 시작) ─────┘
```

셋 다 바로 시작한다. 단 backend의 6-2(승인 변경)는 레이팅에 직접 영향을 주므로 logic의 `softResetElo`·`pickPreviousRating` 테스트가 통과한 뒤 머지 판단을 한다.

### logic (domain-logic-dev) — `packages/core/src/**`

1. 9절 16개 함수 + `index.ts` export. `ranking.ts` 새 파일.
2. 9절 테스트, 6-1·9-2 검증 값.
3. dist 재빌드. 보고서 `_workspace/02_domain-logic-dev_report.md`.

### backend (backend-dev) — `apps/api/src/**`, `apps/api/test/**`

1. `config/env.ts` 13절. `vitest.config.ts`.
2. 11절 모듈, 4절 엔드포인트, 6·7·8절 흐름.
3. 승인 변경(6-2): 7c, 9단계. `fake-prisma`에 `FROM seasons … FOR SHARE`·`FOR NO KEY UPDATE` 응답, `seasonStanding`·`badge`·`userBadge` 표 추가. `test/support/memory-ranking-cache.ts`.
4. 프로필 4-4. `profile-scrim.service.ts`의 임시 `rank: null`을 실제 값으로 교체.
5. 읽기 D160(`rating-inputs.service.ts`).
6. 테스트(DB 없이): 6-1 표 전 경우(승인으로 새 시즌 첫 행, carried_from 값, 시드 경로), 6-5 시나리오 1·2 결과 동일, 시나리오 4, 8(재실행 standings·뱃지 불변), 빈 시즌 close, 5경기 미만 standings 제외·이월 적용, 동점, 게임별 뱃지, 같은 사용자 두 게임 1위. 랭킹: 빈 캐시 첫 요청 후 재계산 없음, 실패 시 마지막 값 + stale, 한 키 실패가 다른 키에 영향 없음, try lock 실패 시 미실행, 주 경계 baseline, 5분 재계산에서 rank_change 불변, `me`가 200위 밖, 닫힌 시즌 standings 출처, 끝났지만 미처리 시즌 캐시 출처, 시즌 없음, 없는 season 404, steam 티어 400, 언랭·미연동 제외, 부계정 무시. 요약: 다음 내전 3경로, 주 경계, top_rankers 게임 선택, me 게임 선택·rank null, 응답에 사용자별 값 혼입 없음(사용자 2명 교차), email·discord_id·puuid 없음. 프로필 badges·rank.
7. **DB 필요(작성만)**: `test/db/season-close.db.e2e.spec.ts` — 승인 진행 중 종료 작업 대기(FOR SHARE ↔ FOR NO KEY UPDATE), 종료 동시 실행 2건 → 뱃지 1벌, 새 시즌 FK 검사가 종료 작업을 기다리지 않음, 동시 첫 승인 리셋 1회. `test/db/ranking-cache.db.e2e.spec.ts` — `ON CONFLICT … WHERE` 조건부 쓰기, DISTINCT ON 최신 스냅샷.
8. 보고서 `_workspace/02_backend-dev_s4.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 10절 화면 4곳, 훅 3개, `lib/api/rankings.ts`.
2. 목 백엔드(`lib/api/mock/rankings.ts` 등), `mock/ratings.ts`의 임시 `rank: null`을 캐시 흉내 값으로, `badges` 목 데이터.
3. 검증: `corepack pnpm --filter web typecheck && test && build`, 목 모드 데스크톱·모바일 × 라이트·다크(빈·로딩·오류, YOU 행, stale, is_final, 시즌 null 사이드바).
4. 보고서 `_workspace/02_frontend-dev_s4.md`.

### qa (qa-verifier)

- 교차 대조: 4절 ↔ 컨트롤러 ↔ 웹 훅, 13절 env ↔ `.env.example` ↔ `config/env.ts`, 9절 공식 ↔ 테스트 수치.
- 6-5 표 11줄과 6-3 잠금 관계를 코드 경로로 추적. 종료 작업이 `ratings`를 쓰지 않는지, 승인 외 `rating.create`가 없는지.
- 캐시 payload에 사용자별 값이 없는지, 응답 전체 캐시가 없는지.
- 마이그레이션에 `DROP` 문장 없음.
- 화면 코드에 숫자 5·0.5 리터럴·`*_DEFAULT` import 없음(목 제외).

---

## 15. 트랜잭션·잠금 요약 (QA 대조용, S3 11절 갱신)

| 경로 | 잠금 | 마지막 방어 |
| --- | --- | --- |
| approve | 내전 행 → (조건부) `season-auto-create` → 사용자별 `rating:{game}` → now → 시즌 판정·생성 → **시즌 행 FOR SHARE** | 결과 조건부 update, `rating_history` 유일, `ratings` 유일 + ON CONFLICT, **`closed_at` 검사** |
| SeasonCloser.runOnce | `season-close` try lock | - |
| closeOne | 시즌 행 FOR NO KEY UPDATE | `closed_at` 재확인, 조건부 update 1행, `season_standings`·`user_badges` 유일 + skipDuplicates |
| RankingRefresher.runOnce | `ranking-refresh` try lock | 키별 try/catch, `computed_at` 조건부 쓰기 |
| 읽기 첫 계산 | 인스턴스 안 단일 실행(잠금 없음) | `computed_at` 조건부 쓰기 |

---

## 16. 결정 사항 (S4, D140부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D140 | **[20절로 변경: 소프트 리셋 폐지, 첫 행 = 1000(D182·D183). 「종료 작업은 ratings를 쓰지 않는다」는 유지]** 소프트 리셋은 **새 시즌 첫 행을 만들 때** 계산한다. 시즌 종료 작업은 `ratings`를 쓰지 않는다. `carried_from_season_id`로 출처를 남긴다. D103 변경 | 값이 이전 행의 순수 함수이고 행 생성 경로가 하나 + 유일 키라 작업 순서·횟수와 무관하게 정확히 한 번이다. 종료 시점에 다음 시즌이 없을 수 있고(D116), 5경기 미만은 어차피 안 보여 0경기 행이 필요 없다 |
| D141 | 승인은 쓰기 전 시즌 행 `FOR SHARE` + `closed_at` 검사, 종료는 `FOR NO KEY UPDATE`, 종료 대상은 `ends_at + 60초` 이후 | 시계에 기대지 않고 진행 중 승인이 끝나기를 기다려 standings 오염을 막는다. 유예는 사용자가 오류를 보지 않게 하는 장치고, 안전성은 잠금이 보장한다. `FOR UPDATE`면 새 시즌 행 FK 검사까지 막으므로 쓰지 않는다 |
| D142 | **[20절로 변경: 폐지(D183)]** 시작값: `1000 + 반올림((이전 − 1000) × ratio)`. 이전 값 = 가장 최근 시즌의 행. 경기 수 무관, 빈 시즌을 건너뛰어도 1회 | 문서 식에 예외가 없다. 빈 시즌에는 그 사람 행이 없어 리셋할 값이 없다. 규칙이 하나라 검증이 쉽다 |
| D143 | 시즌 생성은 D116 그대로 승인에서만. 종료 작업은 다음 시즌을 만들지 않는다. 그 사이 사이드바 「다음 시즌 준비 중」, 랭킹 기본값은 직전 시즌 최종 순위 | 활동이 없는 동안 빈 시즌이 쌓이지 않고 쓰기 경로가 늘지 않는다. 다음 시즌은 직전 끝에서 이어 붙으므로 기간 손실도 없다 |
| D144 | 종료 멱등: 시즌당 1트랜잭션(standings + 뱃지 + closed_at), `closed_at`이 처리 완료 표시. `season-close` try lock, 시즌 행 잠금 후 재확인, 유일 키 + skipDuplicates | 부분 완료 상태가 없어 재개 로직이 필요 없다. 시즌 데이터는 작아 트랜잭션 하나로 충분하다 |
| D145 | `season_standings`는 5경기 이상만. 뱃지는 게임별 1·2·3위, 코드 `season_{game}_top{n}`, earned_at = ends_at, 종료 트랜잭션이 뱃지 행도 보장 | `rank`가 NOT NULL이고 문서 「5경기 이상만 노출」과 같다. 미달자 값은 ratings에 남아 이월에 쓰인다(**20절로 변경: 이월 없음, D186**). 게임별 코드로 유일 키를 바꾸지 않는다(메인 기본값 2) |
| D146 | 캐시 저장소는 Redis 유무와 무관하게 PostgreSQL `ranking_caches` 한 경로 | 재시작·다중 인스턴스에서 마지막 성공값이 살아야 하고(메모리 대체는 불가), 경로가 둘이면 Redis 없는 이 환경에서 다른 쪽을 검증할 수 없다. S1 큐는 소비자 분리가 목적이라 전환이 필요했지만 여기서는 DB 쿼리뿐이다. 문서 4장 「Redis 없이 시작」. 슬라이스 「Redis 없으면 동작하는 대체 경로」를 만족 |
| D147 | 키는 게임·시즌별, 갱신 대상은 닫히지 않은 시작된 시즌. 닫힌 시즌 키는 작업이 지운다 | 끝났지만 미처리인 시즌도 같은 경로로 보여 조회에 빈틈이 없다 |
| D148 | 빈 캐시는 첫 요청에서 동기 계산(인스턴스 안 단일 실행). 값이 있으면 오래돼도 읽기는 계산하지 않는다 | 배포 직후 빈 화면을 없애면서 「요청마다 계산하지 않는다」를 지킨다. 프로필·`me`는 계산을 일으키지 않는다 |
| D149 | 실패는 값을 지우지 않고 `last_failed_at`만 남긴다. `stale`로 알린다 | 문서 9장 |
| D150 | payload는 전체 목록(공용). `me`는 요청마다 찾는다 | 사용자별 키가 없어 사용자 수와 무관. 200위 밖도 찾는다 |
| D151 | 다중 인스턴스: 작업 try lock, 쓰기 `computed_at` 조건부 | D96 방식. 첫 계산이 겹쳐도 같은 값이고 오래된 값이 덮지 않는다 |
| D152 | 티어 점수: IRON 0 … CHALLENGER 9, IV 0 … I 3, 마스터 이상 디비전 0. 언랭 제외. 동점: 승률 → 경기 수 → user id. ELO 동점도 같은 뒷단계. 순위는 항상 1씩 증가(공동 순위 없음) | 목업 수치 6개와 일치. 승률은 교차 곱으로 반올림 동률을 피한다. 뱃지 대상이 결정적이어야 한다 |
| D153 | 순위 변동 기준 = 이번 KST 주 시작 순위. 같은 행에 저장, 기준 교체는 계산 성공 때만 | 주 안에서 고정이라 5분마다 흔들리지 않는다. 내전이 주 단위로 쌓이고 문서의 주 경계와 같다. 직전 캐시 대비는 슬라이스가 금지 |
| D154 | 랭킹은 페이징 없음(`next_cursor` null, 최대 200행, `total`) | 5분마다 바뀌는 순위에 커서는 행 누락·중복을 만든다. 커뮤니티 규모상 한 번에 충분하다. 응답 모양은 skill 형식 유지 |
| D155 | 닫힌 시즌 조회는 `season_standings`, 미처리 시즌은 캐시 | 최종값을 고정. 응답 `is_final`로 구분 |
| D156 | `/dashboard/summary`는 응답 전체를 캐시하지 않고 랭킹 부분만 캐시 재사용. 모집·통계·결과는 요청마다 | 문서가 5분 캐시로 정한 것은 랭킹뿐이다. 모집 인원이 5분 늦으면 참가 판단이 틀어지고, 사용자별 값이 공용 키에 섞일 위험을 없앤다 |
| D157 | 사이드바는 `/dashboard/summary`를 공유한다. 대표 게임 = 현재 시즌 경기 수 최다(같으면 sort_order). `elo`와 `rank`는 같은 캐시 행 | 엔드포인트를 늘리지 않고 홈과 요청을 합친다. 무거워지면 필드를 그대로 분리할 수 있다. 값이 어긋나 보이지 않게 한 출처로 묶는다 |
| D158 | 다음 내전은 joined + recruiting·full. waitlist·playing 제외. 대체는 시작 전 recruiting. 목록은 next_scrim을 뺀다 | `playing`은 결과가 없으면 영구히 남는다. 카드와 목록이 중복되지 않게 |
| D159 | 프로필 `badges` 전체 배열, `ratings[].rank` 추가(캐시 읽기만) | D127 후속. 목업 BADGES·「#3 ELO」 |
| D160 | **[20절로 변경: 첫 반영 값 = 1000(D182)]** 읽기(`rating-inputs`)는 행이 없으면 첫 반영 값(소프트 리셋 또는 시드)을 계산해 쓰고 저장하지 않는다. 현재 시즌이 없으면 target = now | D107 원칙 유지. 조회는 행을 만들지 않는다(D116) |
| D161 | 「탈퇴·비활성」 상태 컬럼이 없으므로 S4의 제외 조건은 사용자 행이 존재함(삭제는 Cascade)이다. `rankableUserWhere` 한 곳에 둔다 | 메인 기본값 4가 재사용할 규칙이 코드에 없다(D24는 토큰 폐기뿐). 17절 Q4 |
| D162 | ELO 랭킹은 시즌 단위만 | 문서 7-3·6장·슬라이스·목업 기준. 2장 「주간·월간」은 Q6 |
| D163 | env 3개(13절). 비율·최소 경기 수는 설정값, 뱃지 순위·유예·주기는 상수. **[20절로 변경: 비율 env 삭제, 2개]** | 슬라이스 「비율은 설정값」「상수 또는 env」 |
| D164 | cron 하나로 종료 → 캐시 갱신 순서로 실행, 플래그 `RANKING_JOBS_ENABLED`, 모듈 분리. 스케줄 모듈은 `sharedScheduleModule` 객체 하나를 공유하고, `ScrimsModule.forRoot()`는 구성(jobs 여부)마다 같은 객체를 돌려준다 | 종료 직후 캐시가 정리된다. Nest 11은 동적 모듈을 참조로 구분해서 `forRoot()`를 부를 때마다 별도 인스턴스가 생기고 cron이 그 수만큼 중복 실행된다. S2 주석의 「같은 메타데이터라 한 번만」은 Nest 11에서 맞지 않다 |
| D165 | 시즌 경계에서 승인 대기였던 결과는 승인 시각 기준 다음 시즌 반영(D116 유지) | 내전 시각 기준으로 바꾸면 닫힌 시즌을 다시 열어야 해 standings 불변이 깨진다. Q3 |
| D166 | 뱃지 월 표시는 `earned_at − 1ms`의 KST 월이다. 표시만 그렇게 하고 저장 값(`earned_at = ends_at`, D145)은 바꾸지 않는다 | `ends_at`은 배타적 끝이라 2월 1일 00:00 KST에 끝난 시즌이 그대로 쓰면 「2월」로 보인다. 시즌이 실제로 끝난 달은 1월이다 |
| D167 | 세션 사용자가 바뀌면 `me` 외 쿼리를 `resetQueries`한다(첫 세션은 지우지 않음). `clear()`는 쓰지 않는다 | 요약·프로필 등에 이전 사용자 값이 남으면 안 된다. `clear()`·`removeQueries`는 떠 있는 observer에 알리지 않아 화면에 이전 값이 그대로 남는다 |
| D168 | 프로필 레이팅 카드는 `scrim.season` null이면 「내전 기록 없음」 대신 시즌 공백 문구를 쓴다(10절) | 시즌 공백(D143)은 정상 상태이고 같은 화면 최근 내전·그래프에 기록이 보인다. 시즌이 한 번도 없던 경우에도 맞도록 「종료」라고 단정하지 않는다 |
| D169 | 패배 배율 `SCRIM_ELO_LOSS_RATIO`(기본 0.5, 0–1). core `applyLossRatio`로 음수 변동에만, 반올림 전에 곱한다. 승리 식은 그대로. D104 대칭 설명은 ratio 1에서만 성립 | 사용자 요청. 한 함수로 묶어 세 경로가 어긋나지 않게 하고, ratio 1이면 값이 정확히 같다 |
| D170 | 개인 순위는 합산 변동의 부호로 배율을 정한다. 승패 표시(D105)와 분리 | 메인 기본값 1. 쌍마다 곱하면 식이 달라지고, 승패 표시로 정하면 점수가 내려가는 상위 절반이 배율을 못 받는다 |
| D171 | `previewTeamElo`는 `lossRatio`를 필수로 받고, `rating_policy`에 `loss_ratio`를 더한다(D124 확장) | 미리보기와 실제 반영이 같은 규칙이어야 한다 |
| D172 | 이미 승인된 경기는 다시 계산하지 않는다. 적용 배율은 저장하지 않고 `elo_before`·`elo_after`로 남긴다 | 메인 기본값 2. 이번 변경은 스키마를 바꾸지 않는다 |
| D173 | 비대칭으로 생기는 점수 인플레이션을 허용하고 19-1에 영향을 기록한다 | 메인 기본값 1. 소프트 리셋이 평균 상승을 묶어 준다(**20절로 변경: 시즌마다 1000 초기화가 묶는다, 20-1**). Q9 |
| D174 | 호칭 변경은 화면만. 영문 태그 `RED`, 색 토큰 `--team-red`·`--team-red-ink`. API 값 `orange`·DB enum·코드 식별자 유지 | 메인 기본값 3. 팀 전용 이름으로 경고용 orange와 섞이지 않게 한다 |
| D175 | ⓘ는 `/rankings` ELO 탭과 프로필 내전 레이팅 카드 2곳. 사이드바 제외 | 점수를 보는 자리다. 사이드바는 메뉴 버튼 안에 중첩되고 모바일에 없다 |
| D176 | ⓘ 값 출처는 `/dashboard/summary`의 `rating_policy` 확장. 고정값은 core 상수, 예시는 core 함수 | 앱 셸이 이미 부르는 요청이라 가장 작다. 새 엔드포인트와 요청이 없다 |
| D177 | ⓘ는 호버·`:focus-visible`·탭·Esc를 모두 지원하는 공개 패널로 만들고 `role="tooltip"`을 쓰지 않는다 | 메인 기본값 4. 여러 문단 설명이고, 터치에서 포커스와 클릭이 겹쳐 바로 닫히는 문제를 막는다 |
| D178 | 값이 없으면 숫자 없는 문구를 쓴다. 기본값을 대신 보여 주지 않는다 | D101. 요약 실패 때 틀린 숫자를 보이지 않는다 |

---

## 17. 확인 필요 (사용자 판단)

메인 기본값 1–5 반영: 1 → 4-1·7-2, 2 → D145, 3 → D153, 4 → D161(규칙이 없어 Q4), 5 → 6-3. 아래는 답이 오기 전 「현재 계약」대로 구현한다.

| # | 질문 | 현재 계약 · 추천 | 다른 선택지 |
| --- | --- | --- | --- |
| Q1 | **사용자 결정으로 닫힘(20절, D182): 시작 점수는 티어 무관 전원 1000.** 다이아 신규 멤버는 첫 경기를 1800(시드)으로 시작하는데, 같은 티어로 지난 시즌을 뛴 멤버는 소프트 리셋으로 약 1400에서 시작한다. 지난 시즌을 안 뛴 사람이 더 높게 시작해도 되는가? | 문서 그대로 유지(추천). 시즌이 쌓이면 대부분 이월 값을 쓴다 | (a) 시작값 = max(소프트 리셋, 시드) (b) 소프트 리셋 중심을 1000 대신 그 사람 티어 시드로 |
| Q2 | **사용자 결정으로 닫힘(2026-10-31): 추천안 그대로 유지(D143), 코드 변경 없음.** 시즌이 끝나고 다음 내전이 승인되기 전까지 현재 시즌이 없다(사이드바 「다음 시즌 준비 중」, 랭킹은 직전 시즌 최종 순위). 괜찮은가? | 유지(추천, D143) | 종료 작업이 다음 시즌을 바로 만든다(화면은 끊기지 않지만 활동 없는 기간에 빈 시즌이 쌓인다) |
| Q3 | **사용자 결정으로 닫힘(2026-10-31): 추천안 그대로, 승인 시각 기준 다음 시즌 반영(D165), 코드 변경 없음.** 시즌 마지막 날 경기가 종료 후 승인되면 새 시즌에 반영되고 지난 시즌 순위에 들어가지 않는다. 괜찮은가? | 유지(추천, D165). 운영진이 종료 전 승인을 끝내도록 안내 | 종료 처리를 대기 결과가 없어질 때까지 미룬다(최종 순위가 늦어진다) |
| Q4 | **사용자 결정으로 닫힘(2026-10-31): 추천안대로 S5 봇 탈퇴 이벤트 때 `users.left_at` 추가 + `rankableUserWhere`만 변경. 지금은 구현하지 않는다(S4 코드 변경 없음).** 사용자 상태 컬럼이 없어 서버를 나간 멤버도 S5 전까지 랭킹에 남고 뱃지를 받을 수 있다. 괜찮은가? | S5 봇 탈퇴 이벤트 때 `users.left_at`을 추가하고 `rankableUserWhere`만 바꾼다(추천) | 지금 컬럼 + 운영진 수동 표시(S6 화면 필요) |
| Q5 | **사용자 결정으로 닫힘(20절, D183): 소프트 리셋이 없어져 질문 자체가 없어졌다.** 지난 시즌 5경기 미만 멤버도 같은 소프트 리셋을 받는다. 괜찮은가? | 유지(추천, D142) | 5경기 미만은 시드로 다시 시작 |
| Q6 | **사용자 결정으로 닫힘(2026-10-31): ELO 랭킹은 시즌 단위만(D162), 코드 변경 없음.** 문서 2장은 ELO 랭킹을 「주간·월간·시즌 단위」라고 하고 7-3·6장·목업은 시즌별이다. 주간·월간이 필요한가? | 시즌만(추천, D162) | S5 이후 `rating_history` 합산으로 기간 변동 랭킹 추가 |
| Q7 | **사용자 결정으로 닫힘(2026-10-31): 뱃지는 게임별 1–3위 유지, 코드 변경 없음.** 뱃지가 게임별 1–3위인데 목업은 「시즌 1 TOP 10」이다. | 메인 기본값대로 1–3위 | `SEASON_BADGE_PLACES`와 시드 변경, 코드 형식 유지 |
| Q8 | **사용자 결정으로 닫힘(2026-10-31): 추천 방향을 지금 구현한다(21절, D196–D200).** 아래 「이번에는 코드를 바꾸지 않는다」는 더 이상 현재 계약이 아니다(기록용). 배포 직후 등 랭킹 캐시가 빈 상태에서 첫 계산이 실패하면 홈 요약 전체가 500이 되어 모집·통계도 안 보이고 사이드바 시즌 카드도 사라진다. 또 `top_rankers: null` 하나가 「시즌 없음」과 「게임 시드 없음」을 함께 뜻해, 시즌이 있어도 「아직 시즌이 없어요」로 보일 수 있다. 어떻게 처리할까? | 이번에는 코드를 바꾸지 않는다(2절·8-2 현재 동작). **추천: 다음 변경 때 부분 실패로 처리하고 null의 의미를 나눈다.** `top_rankers` 첫 계산 실패는 요약 500으로 올리지 않고 로그 후 null. 응답에 `top_rankers_state: 'ready' \| 'no_season' \| 'unavailable'`를 추가한다. `no_season`은 시즌 행 없음, `unavailable`은 계산 실패와 `games` 빈 경우(서버 설정 오류, 로그). 화면은 `no_season` 「아직 시즌이 없어요」, `unavailable` 「순위를 불러오지 못했어요」. 영향: shared `dashboard.ts`(필드·주석), `dashboard.service.ts`, 웹 홈·목, 테스트 | (a) 현재 유지(500이어도 다음 요청에서 복구되고, 시드 누락은 배포 CMD가 막는다) (b) `top_rankers`를 항상 객체로 하고 `season` nullable + `items []`(응답 모양 변경이 더 크다) (c) 요약 500만 막고 null 의미는 그대로(화면이 실패를 「시즌 없음」으로 잘못 말한다) |
| Q9 | **사용자 결정으로 닫힘(2026-10-31): 패배 배율 0.5 유지(D173).** 승률 50% 멤버도 경기당 평균 약 4점씩 올라 랭킹이 경기 수도 함께 반영한다. 시즌마다 1000으로 초기화하므로 상승은 그 시즌 안에서만 쌓인다(20-1). 값을 바꾸려면 `SCRIM_ELO_LOSS_RATIO`(0–1) | 요청대로 0.5 유지(추천, D173). 실제 시즌 값을 보고 조정 | (a) 0.75처럼 덜 줄인다 (b) 시즌별 평균을 보정한다(작업 추가) |
| Q10 | **사용자 결정으로 닫힘(2026-10-31): 이 문구로 유지.** ⓘ에 승패 점수가 다른 이유를 「지는 부담을 줄여 내전에 편하게 참여하도록」이라고 적었다 | 이 문구로 진행(추천) | 원하는 이유로 문구만 교체 |

---

## 18. 영향받는 파일

architect가 이번에 바꾼 것:

| 파일 | 변경 |
| --- | --- |
| `apps/api/prisma/schema.prisma` + `migrations/20261030180000_s4/` | 3절. `prisma format`이 일부 정렬 공백도 바꿨다 |
| `apps/api/prisma/seed.ts` | 뱃지 시드 |
| 새 파일 | `packages/shared/src/rankings.ts`, `dashboard.ts`, `badges.ts`, `contract.s4.test.ts` |
| `packages/shared/src/paths.ts`, `index.ts` | 경로 3개, export |
| `packages/shared/src/seasons.ts` | `SEASON_SOFT_RESET_RATIO_DEFAULT`, `SEASON_CLOSE_GRACE_SEC` |
| `packages/shared/src/ratings.ts` | `ProfileGameRating.rank` |
| `packages/shared/src/profile.ts` | `badges` 넓힘 |
| `packages/shared/src/contract.s1.test.ts`, `contract.s3.test.ts` | 픽스처 |
| `.env.example` | 13절 |
| `apps/api/src/modules/profile/profile-scrim.service.ts` | 임시 `rank: null`(typecheck용 1곳, backend가 교체) |
| `apps/api/test/scrim-results.e2e.spec.ts` | 기대값에 `rank: null` |
| `apps/web/src/lib/api/mock/ratings.ts` | 임시 `rank: null`(frontend가 교체) |
| `apps/web/src/lib/scrim-results.test.ts` | 픽스처 `rank` |

**기존 응답 영향:** `ProfileGameRating.rank`가 필수라 이를 만드는 모든 곳은 값을 채워야 한다(위 임시 처리로 parse 실패 없음). `badges`는 null도 통과하지만 backend는 배열로 바꾼다. 기존 테스트 `apps/api/test/profile.e2e.spec.ts`의 `expect(p.badges).toBeNull()`은 backend가 `[]`로 바꾼다.

**배포 영향(교차 QA 결함 1):** 웹 Docker 빌드가 `@gcd/core` 소스를 찾지 못해 실패했다(S3 e905f88부터, 목 백엔드가 정적으로 import). `apps/web/Dockerfile`에 `COPY packages/core ./packages/core`가 작업 트리에 들어가 있다. 실제 `docker build`와 Railway 로그는 확인하지 못했다(Docker 없음). `apps/api/Dockerfile`은 `COPY packages ./packages`라 영향이 없다. 앞으로 web이 새 워크스페이스 패키지를 import하면 웹 Dockerfile 복사 범위도 함께 고친다.

**계약 대비 코드 차이:** 없음. 2026-10-31 문서 정정 때 남았던 `softResetText`와 프로필 빈 상태(D168)는 frontend가 반영했고 `_workspace/03_qa-verifier_s4_r2.md`에서 확인했다.

**최초 검증 결과(architect, 2026-10-30, 구현 전 기준선):** `corepack pnpm -r typecheck` 4개 패키지 Done, shared dist 재빌드, `prisma validate` 통과, `prisma generate` 완료, `prisma migrate diff`(S3 schema → 현재) 출력 = 마이그레이션(주석 제외 diff 없음, 이 항목은 당시 사실이 아니었다, 3절 이력). 테스트 shared 91(s4 20개 포함)·core 241·web 163·api 381 passed / 33 skipped(DB e2e). 구현 시작 기준선이다.

구현 후 값(리더 직접 실행, 2026-10-31): core 347·shared 91·web 225·api 470 passed / 42 skipped.

이 PC 기본 Node는 20.11이라 `vitest.config.ts`를 읽지 못해(패키지 engines는 ≥22), 같은 내용의 임시 `.mjs` 설정으로 실행하고 지웠다. 저장소 설정은 바꾸지 않았다. 다른 Node 버전으로 다시 돌린 결과는 아니다.

미검증: 6-3의 PostgreSQL 잠금 동작(FOR SHARE ↔ FOR NO KEY UPDATE, FK 검사와의 관계)과 7-1 조건부 upsert는 PostgreSQL 문서 기준 설계이고 실제 DB로 확인하지 않았다. 14절 backend 7번 DB e2e가 확인 수단이다.

---

## 19. S4 후속 변경 (사용자 요청, 2026-10-31)

입력: `_workspace/00_input/slice.md` 끝 「S4 후속 변경」 절(기본값 1–6). 스키마·마이그레이션·DB enum·오류 코드·엔드포인트 변경 없음. 이 절이 앞 절과 다르면 이 절을 따른다.

### 19-1. 승패 점수 비대칭 (D169–D173)

`EloPolicy`는 core 타입이라 logic이 바꾼다:

```ts
export type EloPolicy = { kBase: number; kNew: number; newPlayerGames: number; lossRatio: number };
```

새 core 함수 하나로 세 경로의 규칙을 묶는다(`src/rating.ts`):

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| applyLossRatio | `(rawDelta: number, lossRatio: number) => number` | `rawDelta < 0 ? rawDelta × lossRatio : rawDelta`. lossRatio ∉ [0, 1]이면 RangeError. **반올림 전 값**에 쓴다 |

| 함수 | 지금 | 변경 |
| --- | --- | --- |
| computeTeamEloUpdates | `round(k × (S − E))` | `round(applyLossRatio(k × (S − E), policy.lossRatio))`. 진 쪽만 줄어든다 |
| computePlacementEloUpdates | `round(k / (M − 1) × raw)` | `round(applyLossRatio(k / (M − 1) × raw, policy.lossRatio))` |
| previewTeamElo | 입력 `{blueAvg, orangeAvg, k}` | 입력에 `lossRatio: number` 필수 추가. `lose = round(applyLossRatio(k × (0 − E), lossRatio))`, `win`은 그대로 |

- 반올림은 `roundHalfAwayFromZero` 그대로다.
- `ratio = 1`이면 `x × 1 = x`라 지금과 **정확히 같다**. 기존 수치 테스트를 `lossRatio: 1`로 두고 그대로 통과시켜 증명한다.
- `ratio = 0`이면 진 쪽 변동은 0이고 `outcome`·`losses`는 그대로 패배로 센다.
- 개인 순위는 쌍마다가 아니라 **합산 변동의 부호**로 정한다. 승패 표시(`outcome`, 상위 절반, D105)와는 따로 본다. 승리로 세면서 점수가 내려가는 사람도 배율을 받는다.

검증 값(테스트 필수):

| 입력 | ratio 1 | ratio 0.5 |
| --- | --- | --- |
| 1000 vs 1000, K 32 | 승 +16 / 패 −16 | 승 +16 / 패 −8 |
| 1500 vs 1300, K 32, 높은 팀 승 | +8 / −8 | +8 / −4 |
| 1500 vs 1300, K 32, 낮은 팀 승 | +24 / −24 | +24 / −12 |
| 1500 vs 1300, K 40, 높은 팀 승 | +10 / −10 | +10 / −5 |
| 개인 4명 동일 1000, K 32 | +16, +5, −5, −16 | +16, +5, −3, −8 |
| 개인 1000·1400·1000·1000 순위, K 32 | +20, −8, −1, −12 | +20, −4, 0, −6 |

마지막 줄의 2위(1400)는 상위 절반이라 `outcome`이 win인데 점수는 내려가므로 배율을 받는다.

연결:

| 위치 | 변경 |
| --- | --- |
| `config/env.ts` | `SCRIM_ELO_LOSS_RATIO`: 실수 0–1, 기본 `SCRIM_ELO_LOSS_RATIO_DEFAULT`. 범위 밖이면 기동 실패. `config.rating.lossRatio` |
| 승인(`scrim-results.service.ts`) | `policy = config.rating`이라 코드 추가 없이 적용된다 |
| `previewTeamElo` 호출 2곳 | `scrim-teams.service.ts`, `scrim-views.service.ts`에 `lossRatio` 전달 |
| 응답 | `BalanceScrimResponse.rating_policy.loss_ratio`, `GetDashboardSummaryResponse.rating_policy`에 `k_base`·`k_new`·`new_player_games`·`loss_ratio` |
| 화면 | 팀 카드 「승리 +X · 패배 −Y」는 응답 값을 그대로 쓴다. `skillFormulaText` 끝에 ratio ≠ 1일 때 ` 패배 점수는 {N}%만 반영해요.`를 붙인다(N = ratio × 100 반올림) |

기존 결정과의 관계:

| 결정 | 관계 |
| --- | --- |
| D104 | 승리 쪽 식, 팀 평균, 참가자별 K, 반올림은 유지. 「승패 대칭(+16/−16)」은 ratio 1일 때만 성립한다 |
| D105 | 쌍 대결 합산과 상위 절반 승패 집계는 유지. S3 7-3의 「합계 0」 검증은 ratio 1일 때만 성립한다 |
| D106 | K 판정 변경 없음 |
| D124 | 값 하나 추가. 화면은 `rating_policy`로만 쓴다 |
| D125 | `rating_history`에 배율은 남기지 않는다. `elo_before`·`elo_after`가 실제 변동이다(D172) |

이미 승인된 경기의 `rating_history`와 현재 점수는 다시 계산하지 않는다. 배율은 변경 이후 승인부터 적용된다.

**점수 인플레이션(D173):** 진 쪽이 덜 잃으므로 경기마다 전체 점수 합이 늘어난다.

- 비슷한 두 팀, K 32, ratio 0.5면 참가자 1인당 경기당 평균 약 +4점이다(승 +16, 패 −8의 평균). 5:5 한 판이면 전체 합 +40점이다.
- 승률 50%인 멤버도 경기 수만큼 오른다. 시즌 30경기면 약 +120점이다. 랭킹이 실력뿐 아니라 경기 수도 함께 반영하게 된다.
- 소프트 리셋 기준점 1000은 그대로라 시즌마다 1000과의 차이가 절반으로 줄어 전체 평균이 끝없이 오르지는 않는다. 평균 상승이 시즌당 D점이면 시즌 시작 평균은 약 1000 + D, 끝 평균은 약 1000 + 2D에서 멈춘다(ratio 0.5, 소프트 리셋 0.5 기준). 다만 1000이 더는 「평균 멤버」 점수가 아니다. **→ 20절로 변경: 시즌마다 전원 1000으로 초기화하므로 시즌 시작 평균은 항상 1000이고 상승은 그 시즌 안에서만 쌓인다(20-1)**
- 티어 시드는 고정값이라 시간이 지나면 기존 멤버 점수가 같은 티어 신규 멤버보다 높아진다. Q1의 역전(신규가 더 높게 시작)은 줄지만, 신규 멤버의 기대 승률은 실제보다 낮게 계산된다. 밸런스 실력값도 10경기 이상 멤버 쪽이 조금 높게 나온다. **→ 20절로 변경: 티어 시드 시작이 없어져 이 문단은 해당 없음. 시즌 중 늦게 합류한 멤버는 1000에서 시작해 기존 멤버보다 낮은 자리에서 시작한다(20-1)**

위 수치는 승률 50%를 가정한 계산이다. 실제 운영값으로 확인한 것은 아니다.

### 19-2. 팀 호칭 (D174)

바꾸는 것은 화면 표기뿐이다. DB enum `scrim_team`, API 값 `orange`, 쿼리·응답 필드(`winner_team`, `orangeAvg` 등), 코드 식별자(`TEAM_LABEL.orange`, `TEAM_TONE.orange`)는 **그대로** 둔다.

| 파일 | 지금 | 변경 |
| --- | --- | --- |
| `lib/scrim-results.ts` `TEAM_LABEL.orange` | `ORANGE`, `오렌지팀` | `RED`, `레드팀`. 결과 문구·최근 결과 `RED WIN`이 여기서 따라 바뀐다 |
| `lib/scrims.ts:190` | 「오렌지팀 승리」 | 「레드팀 승리」(`TEAM_LABEL` 사용으로 교체) |
| `lib/errors.ts:58` | 「블루·오렌지 두 팀」 | 「블루·레드 두 팀」 |
| `components/scrims/scrim-teams.tsx` | aria 문구, 「오렌지 기대 승률」, 라디오 「오렌지」, 태그 `ORANGE {n}` | 「레드 기대 승률」, 「레드」, `RED {n}` |
| `components/scrims/scrim-detail.tsx:456` | sr-only 「오렌지팀」 | `TEAM_LABEL[p.team].ko` |
| 코드 주석·테스트 기대값 | 위 값 | 함께 갱신 |

화면용 영문 태그는 `RED`만 쓴다.

**색 토큰:** 팀 전용 토큰 2개를 새로 둔다. 이름에 `team`을 넣어 경고색과 섞이지 않게 하고, Tailwind 기본 `red-*`와도 구분한다.

| 토큰 | 다크 | 라이트 | Tailwind | 대비(계산값) |
| --- | --- | --- | --- | --- |
| `--team-red` | `#FF6B7D` | `#F0566A` | `--color-team-red` | `on-accent` 글자 대비 다크 6.1, 라이트 5.0 |
| `--team-red-ink` | `#FFB0B9` | `#B3203A` | `--color-team-red-ink` | `surface` 위 글자 대비 다크 10.3, 라이트 6.6 |

`styles/tokens.css` 두 테마와 `app/globals.css`에 넣는다. 다크·라이트 토큰 수 일치(D53)를 유지한다.

| 바꾸는 사용처(팀 색) | 변경 |
| --- | --- |
| `scrim-teams.tsx` `TEAM_TONE.orange` 전체 | `border-team-red/35`, `bg-team-red/6`, `bg-team-red`, `text-team-red-ink`, `bg-team-red/12` |
| `scrim-teams.tsx:163, 179, 458` | 승률 막대, 승률 숫자, 태그 |
| `home-view.tsx:403` | 최근 결과 칸 |
| `scrim-result.tsx:119` | 선택 테두리 |
| `scrim-card.tsx:120, 124` | 결과 글자·점 |

**그대로 두는 orange:** 경고·오류·위험 버튼(`primitives`, `controls`, 로그인 등), 패배 값·패배 칩(`scrim-teams.tsx:146`, `profile-scrim.tsx`, `profile-view.tsx`), 순위 하락, 정원 마감, 스팀 게임 색(`games.ts`), Challenger 색(`tiers.ts`), `StatusPill`의 `orange`.

### 19-3. ELO 설명 ⓘ (D175–D178)

**위치(2곳):**

| 위치 | 자리 |
| --- | --- |
| `/rankings` ELO 탭 | 탭 설명 문장 끝. 티어 탭에는 없다 |
| 프로필 내전 레이팅 카드 | 카드 라벨 「내전 레이팅」 옆 |

사이드바는 넣지 않는다. 사용자 카드 전체가 메뉴 버튼이라 버튼 안에 버튼이 생기고, 모바일에는 사이드바가 없다.

**값 출처:** 이미 모든 `(main)` 화면이 앱 셸에서 부르는 `useDashboardSummary()`의 `rating_policy`다. 엔드포인트를 늘리지 않고 요청도 늘지 않는다. 고정값(시드 범위, 기준점 1000)은 core 상수 `RATING_SEED_BY_TIER`, `RATING_SEED_DEFAULT`, `SEASON_SOFT_RESET_CENTER`에서 읽는다. 예시 숫자는 core `softResetElo`, `previewTeamElo`로 계산한다. 화면에 숫자를 직접 쓰지 않는다. **→ 20절로 변경: 시작 점수는 shared `RATING_START_ELO`, 밸런스 비중은 `rating_policy.elo_weight_max`·`full_weight_games`. `softResetElo`·`SEASON_SOFT_RESET_CENTER`·시드 표는 ⓘ에서 쓰지 않는다**

**문구:** `apps/web/src/lib/elo-info.ts`의 순수 함수 `eloInfoSections(policy: DashboardRatingPolicy | null)`가 만든다. 제목은 「내전 ELO란?」이다.

| 항목 | 값이 있을 때 | 값이 없을 때(로딩·요약 실패) |
| --- | --- | --- |
| 무슨 점수인가요 | 우리 서버 내전 결과로만 정해지는 실력 점수예요. 라이엇 티어와는 따로 계산하고, 게임과 시즌마다 따로 쌓여요. | 같음 |
| 언제 바뀌나요 | 운영진이 내전 결과를 승인할 때만 바뀌어요. 실제로 뛴 멤버만 바뀌고, 노쇼나 팀에 들지 않은 멤버는 그대로예요. {min_games}경기 이상 치르면 랭킹에 나와요. | 끝 문장을 「일정 경기 수를 채우면 랭킹에 나와요.」로 |
| 시작 점수는 어떻게 정하나요 | 그 시즌 첫 경기가 반영될 때 정해져요. 지난 시즌 기록이 있으면 {소프트 리셋 문장} 기록이 없으면 연동한 티어로 정해요. 아이언 {min}점부터 마스터 이상 {max}점까지이고, 티어가 없으면 {default}점이에요. 처음부터 실력에 가까운 자리에서 시작하도록 한 규칙이에요. | 지난 시즌 기록이 있으면 {center}점 쪽으로 점수를 당겨 시작해요. 새 시즌에 서로 따라잡을 기회를 주려는 규칙이에요. 기록이 없으면 연동한 티어로 정해서 처음부터 실력에 가까운 자리에서 시작해요. |
| 승패 점수는 왜 다른가요 | {비대칭 문장} 강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요. 한 경기 기본 폭은 {k_base}점이고, 그 게임 내전이 {new_player_games}경기 미만이면 {k_new}점이라 더 빨리 움직여요. | 강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요. |

| 소프트 리셋 문장 | ratio |
| --- | --- |
| {center}점과의 차이를 {N}%만 남겨요. 예를 들어 1400점이면 {softResetElo(1400)}점에서 시작해요. 지난 시즌 실력은 살리면서 새 시즌에 서로 따라잡을 기회를 주려는 규칙이에요. | 0 < ratio < 1 |
| 지난 시즌 점수를 그대로 이어 가요. | 1 |
| 모두 {center}점에서 다시 시작해요. | 0 |

| 비대칭 문장 | ratio |
| --- | --- |
| 지면 원래 잃을 점수의 {N}%만 잃어요. 비슷한 상대라면 이길 때 +{win}점, 질 때 −{lose}점이에요. 지는 부담을 줄여 내전에 편하게 참여하도록 한 규칙이에요. | 0 < ratio < 1 |
| 이길 때와 질 때 같은 크기로 계산해요. | 1 |
| 져도 점수가 내려가지 않아요. | 0 |

`win`·`lose`는 `previewTeamElo({blueAvg: 1000, orangeAvg: 1000, k: k_base, lossRatio})`의 blue 값이다. 현재 규칙(티어 시드)대로 설명한다. 전원 1000 안은 사용자 결정 전이라 문구에 넣지 않는다(기본값 6). **→ 20절로 변경: 「무슨 점수인가요」·「시작 점수」 문구와 소프트 리셋 문장 표는 20-7 문구로 바꾸고, 「팀을 나눌 때는요」를 더한다(D194)**

**컴포넌트:** 공용 `components/ui/info-tip.tsx`(`InfoTip`, 내용은 children) + `components/rankings/elo-info.tsx`(`EloInfo`, 문구·값 연결). 아이콘은 `ui/icons.tsx`에 `InfoIcon` 추가.

| 항목 | 규칙 |
| --- | --- |
| 트리거 | `<button type="button">`, 보이는 아이콘 16px, 터치 영역 44×44px, `aria-label="내전 ELO 설명"`, `aria-expanded`, `aria-controls` |
| 패널 | 버튼 바로 뒤 DOM, `role="region"`, `aria-label="내전 ELO 설명"`, 포커스를 옮기지 않는다. 안에 포커스 가능한 요소를 두지 않는다. `role="tooltip"`은 쓰지 않는다(여러 문단이라 맞지 않다) |
| 호버 | `pointerType === 'mouse'`일 때만 연다. 버튼에서 패널로 옮겨 가도 열려 있고, 둘 다 벗어나면 150ms 뒤 닫는다 |
| 클릭 | 마우스 클릭은 고정/해제. 고정 중에는 벗어나도 닫히지 않는다 |
| 포커스 | 버튼이 `:focus-visible`일 때만 연다(터치·마우스 포커스로 열면 뒤따르는 클릭이 바로 닫는다). 포커스가 벗어나면 닫는다. Enter·Space는 고정 토글 |
| 터치 | 탭으로 열고 닫는다. 패널 밖 탭으로 닫는다 |
| Esc | 열려 있으면 어디서든 닫는다. 포커스는 버튼에 그대로 두고, 포커스가 나갔다 돌아오기 전에는 다시 열지 않는다 |
| 위치 | `position: fixed`, 폭 `min(340px, 100vw − 32px)`. 버튼 아래가 기본, 공간이 모자라면 위. 좌우는 화면 안쪽 16px로 자른다. 높이 상한은 쓸 수 있는 공간이고 넘치면 패널 안 세로 스크롤. 모바일(`md` 미만)은 하단 탭 높이만큼 아래 여백을 더 둔다 |
| 다시 계산 | 열릴 때와 창 크기 변경 때. 패널 밖 스크롤이면 닫는다(패널 안 스크롤은 닫지 않는다) |
| 잘림 | portal을 쓰지 않으므로 조상에 `transform`·`filter`·`backdrop-filter`가 없어야 한다. 있으면 그 자리만 조상을 고친다. `overflow-hidden` 조상은 fixed에 영향이 없다 |
| 움직임 | 애니메이션 없음 |

### 19-3a. 구현 후 결정 (리더, 후속 QA 반영)

| # | 결정 |
| --- | --- |
| D179 | 패배 배율 뒤에는 승패 변동 크기가 달라 「반영 ±N」이 틀린다. `elo_swing` 값(|delta| 최댓값)은 유지하고 화면 문구만 「최대 {elo_swing}점 변동」으로 바꾼다 |
| D180 | ⓘ 패널은 `tabIndex={0}`으로 Tab 진입을 허용한다. 포커스가 버튼·패널 안에 있으면 닫지 않고 ↑↓는 기본 스크롤이다. 둘 다 벗어나면 닫고, Esc는 닫은 뒤 패널에 포커스가 있었으면 버튼으로 돌린다. 키보드 포커스 중 페이지 스크롤은 닫지 않고 위치만 다시 계산한다(19-3 「패널 밖 스크롤이면 닫는다」보다 우선, 마우스 고정은 기존대로 닫힘) |
| D181 | 패배 배율 문구: 0은 「약한 상대에게 질수록」 절을 빼고 「져도 점수가 내려가지 않아요」와 승리 쪽 문장을 쓰고, 1은 제목을 「승패 점수」로 한다. 그 외 값은 19-3 표 문구. 극단값 반올림 표시(0.001 → 0%)는 기본값에서 나오지 않아 두고 간다 |

### 19-4. 담당

| 구현자 | 작업 |
| --- | --- |
| logic | `EloPolicy.lossRatio` 필수, `applyLossRatio`, 세 함수 변경, `previewTeamElo` 입력, `index.ts` export. 기존 테스트 policy에 `lossRatio: 1`을 넣어 수치 불변을 보이고, 19-1 검증 값·ratio 0·범위 밖 RangeError 테스트 추가. dist 재빌드 |
| backend | `config/env.ts`와 env 테스트, `previewTeamElo` 호출 2곳, `scrim-teams.service.ts`·`dashboard.service.ts`의 `rating_policy`. 기존 e2e 수치 테스트는 `SCRIM_ELO_LOSS_RATIO=1`로 유지하고, 0.5 승인 e2e 1건(rating_history·wins·losses·미리보기)과 이미 승인된 행 불변 테스트 추가 |
| frontend | 19-2 전부, 19-3 전부(`InfoTip`, `EloInfo`, `lib/elo-info.ts`와 테스트), `skillFormulaText`, 목(`mockEloPolicy`, `ratingPolicyView`, `mock/rankings.ts`의 `rating_policy`, 관련 테스트). 다크·라이트 × 데스크톱·모바일 확인 |

의존: logic → backend. frontend는 목으로 바로 시작한다.

### 19-5. qa 대조 항목

- ratio 1: 기존 core·api 수치 테스트가 값 변경 없이 통과. `applyLossRatio`가 반올림 전에 적용되는지.
- 19-1 검증 값 표 전체, 개인 순위 win인데 음수인 행, ratio 0에서 `losses` 증가.
- env ↔ `.env.example` ↔ `config/env.ts` ↔ `rating_policy` 두 응답. 범위 밖 값 기동 실패.
- 과거 행 불변: 재계산 코드와 마이그레이션이 없는지.
- 화면 소스에 `오렌지`, `ORANGE` 표기가 남지 않았는지(코드 식별자 `orange`와 API 값은 남는 것이 맞다). API 응답에 `red`가 없는지. `schema.prisma` 변경 없음.
- `team-red` 사용처가 팀 표시뿐이고, 19-2 「그대로 두는 orange」가 바뀌지 않았는지. 두 테마 토큰 수 일치.
- ⓘ: 호버, 키보드(Tab·Enter·Space·Esc), 터치 탭 각각. 터치에서 탭 한 번에 열리고 바로 닫히지 않는지, 390px 폭·화면 끝·하단 탭 근처 넘침, ratio 0·0.5·1 문구, 요약 실패 때 숫자 없는 문구.
- 화면 코드에 숫자 32·40·0.5·600·2000 리터럴과 `*_DEFAULT` import가 없는지(목 제외).

### 19-6. 이번 변경과 기준선

architect가 바꾼 것: `packages/shared/src/scrims.ts`(`SCRIM_ELO_LOSS_RATIO_DEFAULT`), `scrim-results.ts`(`RatingPolicyView.loss_ratio`), `dashboard.ts`(`DashboardRatingPolicy` 필드 4개), `constants/enums.ts`(주석), `contract.s3.test.ts`, `contract.s4.test.ts`, `.env.example`, 이 문서. `EloPolicy`는 core 타입이라 바꾸지 않았다(logic).

검증: shared 92 통과, shared dist 재빌드, shared·core·api typecheck Done. **web typecheck는 예상대로 실패한다**(`mock/ratings.ts:128`, `lib/scrim-results.test.ts:59`, `loss_ratio` 없음). frontend가 채우면 해소된다. 새 필드가 필수라 backend·목이 채우기 전에는 `GET /dashboard/summary`와 `POST /scrims/:id/balance`의 응답 parse도 실패한다. typecheck로는 api 쪽이 드러나지 않는다.

`_workspace/ELO_설명서.md` 4절의 예시는 구현 후 새 값에 맞춰 고쳐야 한다. 이 문서 범위 밖이라 그대로 두었다.

---

## 20. S4 후속 변경 2 (사용자 결정, 2026-10-31)

입력: `_workspace/00_input/slice.md` 끝 「S4 후속 변경 2」(사용자 결정 1–4, 메인 기본값 1–9). 취지: **티어와 라인은 팀을 나눌 때만 쓰고, 내전 ELO는 티어와 무관하게 내전 결과만으로 오르내리는 「이 디스코드 안의 내전 실력」 점수다.** 이 절이 앞 절(6-1, 6-2 9단계, 6-5, 9-3, 10절 시즌 카드, 13절, D103·D107·D140·D142·D160, 19-1 인플레이션, 19-3 문구)과 다르면 이 절을 따른다. 앞 절의 해당 자리에는 「20절로 변경」 표시를 달았다.

메인 기본값은 1–9 모두 그대로 따른다(다르게 정한 것 없음). 대응: 1 → D187, 2 → D188, 3 → D189, 4 → D193, 5 → D183·D184, 6 → D186, 7 → D190–D192, 8 → 20-7·Q1·Q5 닫힘, 9 → 20-11.

### 20-1. 바뀌는 규칙

| # | 규칙 | 전 | 후 |
| --- | --- | --- | --- |
| 1 | ELO 시작 점수 | 이전 시즌 행 있으면 소프트 리셋, 없으면 티어 시드(600–2000) | **전원 `RATING_START_ELO` = 1000.** (사용자, 게임, 시즌) 행을 처음 만들 때(승인 9단계) 한 번 |
| 2 | 시즌 전환 | `1000 + 반올림((이전 − 1000) × 0.5)` | **소프트 리셋 없음.** 새 시즌 행도 1000. 지난 시즌 값은 `season_standings`·뱃지·`rating_history`로만 남는다 |
| 3 | 밸런스 실력값 | `w × 레이팅 + (1 − w) × 티어 시드`, w = min(전체 시즌 경기 수 ÷ 10, 1) | `w × 내전 ELO + (1 − w) × 티어 환산값`, **w = 0.2 × min(현재 시즌 경기 수 ÷ 10, 1)**. 0경기 0, 5경기 0.1, 10경기 이상 0.2. 티어 비중 ≥ 80% |
| 4 | 1지망·2지망 기본 선택 | 빈 선택 | 롤(포지션 받는 내전)에서 **라이엇 대표 계정 최근 20경기 주·보조 라인**(`computeMainPosition` 상위 2개). 본인이 바꿀 수 있다. 서버는 받은 값을 그대로 저장 |

- 티어 환산값 = 기존 시드 표 그대로(아이언 600 … 다이아 1800, 마스터 이상 2000, 언랭·티어 없음·연동 없음·티어 없는 게임 1000). 이름만 화면에서 「티어 환산값」(D189). 출처도 그대로(대표 계정 최신 스냅샷, `loadTierSeeds`).
- 「현재 시즌 경기 수」 = 그 (사용자, 게임)의 **현재 시즌 `ratings` 행 `wins + losses`**. 행이 없거나 현재 시즌이 없으면 0(D187).
- 「내전 ELO」(실력값의 ELO 항, 미리보기 `rating`) = 현재 시즌 `ratings.elo`, 행이 없으면 1000. 행이 없으면 경기 수가 0이라 실력값에는 영향이 없고, `rating_avg`·`elo_preview`에만 쓰인다.
- K 판정(D106, 모든 시즌 rating_history 수)과 `is_new`는 **그대로**. 새 시즌에 1000으로 돌아가도 신규 K로 돌아가지 않는다.
- 패배 배율(19-1), 랭킹 5경기 이상(7-3), 시즌 종료 작업의 standings·뱃지(6-3, 6-4)는 그대로.

**영향(보고서·설명서에 적을 것):**

- 시즌 시작 직후에는 모두 1000이라 ELO 랭킹이 비어 있다가(5경기 미만) 경기가 쌓이며 채워진다. 지난 시즌 상위권도 같은 자리에서 다시 시작한다.
- 시즌 시작 직후 실력값은 거의 티어 환산값이다(w = 0). 밸런스가 내전 결과를 반영하는 폭은 그 시즌 10경기까지 최대 20%로 늘어난다. 지난 시즌에 많이 뛴 멤버도 새 시즌 0경기면 w = 0이다(메인 기본값 1: 1000은 정보가 없는 값이라 섞지 않는다).
- 실력값의 ELO 항이 움직일 수 있는 폭: 같은 티어 두 멤버가 ELO 1300과 900이면 w 0.2에서 실력값 차이는 80점이다. 티어 한 단계(200점) 차이의 40%다. 티어가 밸런스를 주도하고 ELO는 미세 조정이다.
- 패배 배율 인플레이션(19-1, Q9): 시즌마다 1000으로 초기화하므로 시즌 시작 평균은 항상 1000이고, 상승은 그 시즌 안에서만 쌓인다(시즌 30경기, 승률 50%면 시즌 끝 약 +120점). 소프트 리셋이 있을 때의 「1000 + 2D 수렴」 분석은 해당 없다.
- 시즌 중간에 합류한 멤버는 1000에서 시작하므로 이미 많이 이긴 기존 멤버보다 낮은 자리에서 시작한다. 이 서버 내전 기록이 없다는 뜻이라 규칙에 맞는다.
- **기존 데이터(D193, Q11):** 이미 승인된 경기와 **현재 시즌에 이미 있는 `ratings` 행은 다시 계산하지 않는다.** 현재 시즌 기존 행은 티어 시드(또는 소프트 리셋)로 시작한 값이 그대로 이어지고, 이번 변경 뒤 현재 시즌에 처음 반영되는 멤버만 1000에서 시작한다. 그래서 **현재 시즌 ELO 랭킹은 시즌이 끝날 때까지 두 시작 규칙이 섞인다**(예: 기존 다이아 멤버 1800 근처 vs 새 멤버 1000). 다음 시즌부터는 전원 1000이다.

### 20-2. 소프트 리셋 제거 범위 (D183–D186)

| 대상 | 처리 |
| --- | --- |
| core `softResetElo`, `seasonStartElo`, `pickPreviousRating` | **삭제**(+ 테스트) |
| core 상수 `SEASON_SOFT_RESET_CENTER` | **삭제**. 시작 점수는 shared `RATING_START_ELO` |
| shared `SEASON_SOFT_RESET_RATIO_DEFAULT` | **삭제**(architect 반영 완료) |
| env `SEASON_SOFT_RESET_RATIO`, `AppConfig.seasonSoftResetRatio` | **삭제**. `.env.example`에서 지움(architect 반영 완료). Railway에 남아 있어도 무시된다(env 스키마가 모르는 키를 버린다, backend 테스트로 보인다) |
| `apps/api/src/modules/ratings/rating-carry.ts`(`loadPreviousRatings`) | **파일 삭제**. 쓰는 곳 2곳(승인 9단계, `rating-inputs`)도 뺀다 |
| 승인 9단계 이월 판정 | 이전 시즌·티어 조회 없이 `elo: RATING_START_ELO`(20-4) |
| `ratings.carried_from_season_id` | **컬럼·FK·관계 유지, 쓰지 않는다**(D184). 새 행은 값을 넣지 않아 null. 기존 행 값은 감사 기록으로 그대로. 마이그레이션 없음 |
| 7c 시즌 행 `FOR SHARE` + `closed_at` 검사 | **유지**(D185). 닫힌 시즌 standings 오염 방지(D141)는 이월과 무관하다 |
| 8단계 사용자 advisory 잠금 | **유지**. 같은 사용자 ratings 갱신 직렬화(S3). 6-2의 「직전 시즌 커밋 뒤 값을 본다」 이유만 없어진다 |
| 시즌 종료 작업 `SeasonCloser` | **코드 동작 변경 없음**(D186). 원래 ratings를 쓰지 않았다. 주석의 소프트 리셋 언급만 고친다 |
| 6-5 경합표 | 「리셋」 → 「1000으로 새 행」. 1과 2가 같은 값이라는 결론은 그대로(둘 다 1000) |
| D160 읽기 | 행이 없으면 1000(이전 시즌 조회 없음) |
| 사이드바 시즌 카드, ⓘ, 로그인 화면, 설명서 | 20-7 |

### 20-3. core 변경 (logic)

`@gcd/shared` 상수를 쓴다: `RATING_START_ELO`(1000), `BALANCE_ELO_WEIGHT_MAX`(0.2), `BALANCE_FULL_WEIGHT_GAMES`(10, 그대로).

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| balanceEloWeight(**새**) | `(seasonGames: number) => number` | `BALANCE_ELO_WEIGHT_MAX × min(seasonGames, F) ÷ F`(F = `BALANCE_FULL_WEIGHT_GAMES`). 곱하고 나서 나눈다(0.2 × 1 ÷ 10 = 0.02, 부동소수 오차를 줄인다). 0 이상 정수가 아니면 RangeError |
| computeSkill(**변경**) | `(input: { seasonElo: number \| null; seasonGames: number; tierSeed: number }) => number` | `w = balanceEloWeight(seasonGames)`, `elo = seasonElo ?? RATING_START_ELO`, `roundHalfAwayFromZero(w × elo + (1 − w) × tierSeed)`. 입력 이름 `gamesPlayed` → **`seasonGames`**(뜻이 바뀌어 옛 호출부가 컴파일 오류로 드러나게, D189) |
| softResetElo, seasonStartElo, pickPreviousRating | - | **삭제** |

- `tierSeedRating`, `RATING_SEED_BY_TIER`, `RATING_SEED_DEFAULT`는 이름 그대로 두고 주석만 「밸런스 티어 환산값(ELO 시작값 아님)」으로 고친다(D189).
- `BalancePlayer.rating` 주석: 「현재 시즌 ELO(행이 없으면 RATING_START_ELO)」.
- `balanceTeams`·`evaluateTeams`·`previewTeamElo`·ELO 갱신 함수는 변경 없음.

검증 값(테스트 필수):

| tierSeed | seasonElo | seasonGames | w | skill |
| --- | --- | --- | --- | --- |
| 1800 | 1000 | 0 | 0 | 1800 |
| 1800 | 1000 | 1 | 0.02 | 1784 |
| 1800 | 1000 | 5 | 0.1 | 1720 |
| 1800 | 1000 | 10 | 0.2 | 1640 |
| 1800 | 1000 | 25 | 0.2 | 1640 |
| 600 | 1400 | 10 | 0.2 | 760 |
| 1200 | 1500 | 10 | 0.2 | 1260 |
| 1000 | null | 0 | 0 | 1000 |
| 1800 | null | 3 | 0.06 | 1752(null → 1000) |

`balanceEloWeight`: 0 → 0, 1 → 0.02, 5 → 0.1, 10 → 0.2, 11 → 0.2, −1·1.5·NaN → RangeError. `computeSkill`의 `seasonGames` 범위 오류도 같은 RangeError. 0.5 반올림 경계 테스트는 두지 않는다(부동소수 오차로 결과가 흔들린다).

**core 합계:** 삭제 함수 3개 + 상수 1개, 새 함수 1개, 시그니처 변경 1개. dist 재빌드.

### 20-4. backend 흐름 변경

**승인 9단계(`scrim-results.service.ts:203–227`):**

```ts
if (missing.length > 0) {
  await tx.rating.createMany({
    data: missing.map((userId) => ({ userId, gameId: game.id, seasonId: season.id, elo: RATING_START_ELO })),
    skipDuplicates: true,
  });
}
```

`loadPreviousRatings`·`loadTierSeeds`·`seasonStartElo`·`tierSeedRating` import를 뺀다. `carriedFromSeasonId`는 넣지 않는다(기본 null). 나머지 단계(7a·7b·7c·8·10–13, `countRatedGames`로 K 판정)는 그대로.

**읽기 `RatingInputsService.forUsers`(`rating-inputs.service.ts`):**

| 값 | 후 |
| --- | --- |
| `seasonElo` | 현재 시즌 행 `elo`, 없으면 null(이전 시즌 조회 없음) |
| `seasonGames`(**새 필드**) | 현재 시즌 행 `wins + losses`, 없으면 0 |
| `gamesPlayed` | 그대로(모든 시즌 rating_history 수). `isNew`에만 쓴다 |
| `tierSeed` | 그대로(`loadTierSeeds`) |
| `skill` | `computeSkill({ seasonElo, seasonGames, tierSeed })` |
| `rating` | `seasonElo ?? RATING_START_ELO` |

쿼리: 시즌 1 + ratings 1 + 이력 수 1 + 시드 2(이전 시즌 2회가 빠진다). 상세 `players[].skill`, 밸런스, 저장된 팀 요약(`balance`)이 모두 이 값을 쓴다.

**응답 `rating_policy`:**

| 위치 | 변경 |
| --- | --- |
| `scrim-teams.service.ts:119–125`(밸런스) | `elo_weight_max: BALANCE_ELO_WEIGHT_MAX` 추가 |
| `dashboard.service.ts:78–85`(요약) | `soft_reset_ratio` 삭제, `full_weight_games: BALANCE_FULL_WEIGHT_GAMES`, `elo_weight_max: BALANCE_ELO_WEIGHT_MAX` 추가 |

**env(`config/env.ts`):** `SEASON_SOFT_RESET_RATIO` 항목, `SEASON_SOFT_RESET_RATIO_DEFAULT` import, `AppConfig.seasonSoftResetRatio`와 대입 삭제.

**라인 추천:** 20-5.

### 20-5. 라인 추천 `GET /me/position-suggestions` (D190–D192)

| 메서드 | 경로 (`ApiPath`) | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- |
| GET | /me/position-suggestions (`myPositionSuggestions`) | `GetMyPositionSuggestionsQuery {game}` | 200 `GetMyPositionSuggestionsResponse {game, positions, sample_size, synced_at}` | VALIDATION_FAILED(게임 누락·모르는 값) |

JWT, 멤버 전원, **요청자 본인 것만**(다른 사용자 id를 받지 않는다). 스키마는 `packages/shared/src/scrims.ts` 끝.

서버 계산(`PositionSuggestions.forUser(userId, gameCode)`):

1. games 행(code). 없으면 INTERNAL_ERROR + 로그(D135와 같은 처리). `has_positions = false`면 `{positions: [], sample_size: 0, synced_at: null}`.
2. 그 게임의 요청자 대표 계정: `gameAccount.findFirst({ where: { userId, gameId, isPrimary: true } })`. 없으면 위와 같은 빈 응답.
3. `recent_matches` where 그 계정, `playedAt DESC, id ASC`, `take: RECENT_MATCHES_MAX`. `LolMatchSummary.safeParse` 실패·`win` null 행은 건너뛴다. **프로필 `ProfileService.loadMatches`와 같은 조회·필터**여야 하므로 그 메서드를 `modules/profile/recent-matches.ts`의 함수(`loadRecentLolMatches(db, gameAccountId)`)로 빼서 둘 다 쓴다.
4. `computeMainPosition(matches.map(m => m.summary.position))` → null이면 `positions []`, `sample_size 0`. 아니면 `positions` = 결과 순서대로 `game.positions`에 있는 값만, 최대 2개, `sample_size` = 결과 값.
5. `synced_at` = 계정 `matchesSyncedAt`(없으면 null).

- **외부 API 호출·동기화 등록 없음.** 프로필 조회와 달리 `maybeQueueMatches`를 부르지 않는다(메인 기본값 7). 전적이 오래됐으면 오래된 값으로 추천한다(Q13).
- 롤 대표 계정의 결과는 같은 사용자의 프로필 `main_position.positions[].position`과 같다(qa 대조).
- 위치: `modules/profile/position-suggestions.service.ts`(새) + `profile.controller.ts`에 라우트(ProfileModule에 이미 Prisma·GameCatalog 접근이 있다). 게임 행 조회는 기존 `GameCatalog`를 쓴다.
- 참가 신청(`POST /scrims/:id/join`)·작성(`POST /scrims`)은 **변경 없음.** 서버는 받은 `preferred_positions`·`host_preferred_positions`를 그대로 검증·저장하고 비어 있어도 채우지 않는다.

화면 규칙(D192):

| 화면 | 기본값을 채우는 조건 | 채우지 않는 경우 |
| --- | --- | --- |
| `/scrims/new` 작성 폼 | `effPositions`(게임 has_positions && 포지션 사용)이고 1지망·2지망을 사용자가 아직 건드리지 않았을 때, 추천이 도착하면 `first = positions[0] ?? null`, `second = positions[1] ?? null`. 게임을 바꾸면(`pickGame`) 「건드림」을 풀고 그 게임 추천으로 다시 채운다 | 사용자가 하나라도 바꾼 뒤 늦게 도착한 추천, 추천 `[]`·로딩·오류(빈 선택 그대로, 오류 문구 없음) |
| `/scrims/[id]` 참가 영역 `JoinControls` | `usePositions && v.can_join && !inRoster`(= `viewer.preferred_positions`가 []인 신청 전)이고 사용자가 아직 건드리지 않았을 때 같은 방식 | 참가·대기 중(저장된 희망 포지션이 우선), 위와 같은 경우 |

- 추천으로 채운 상태가 그대로면 고르는 칸 아래에 안내 한 줄: 「솔로 랭크 최근 {sample_size}경기 기준으로 골라 뒀어요. 바꿔도 돼요.」. 사용자가 바꾸면 숨긴다.
- 추천이 1개면 1지망만 채운다. 신청 버튼 조건(1지망 필수)은 그대로다.
- 쿼리: `usePositionSuggestions(game, enabled)` — 키 `['me', 'position-suggestions', game]`, `enabled`는 위 조건의 게임 쪽(포지션 받는 게임일 때만 요청), staleTime 5분. 실패해도 재시도 토스트를 띄우지 않는다.

### 20-6. shared 계약 변경 (architect 반영 완료)

| 파일 | 변경 |
| --- | --- |
| `scrims.ts` | 상수 `RATING_START_ELO = 1000`, `BALANCE_ELO_WEIGHT_MAX = 0.2` 추가. `BALANCE_FULL_WEIGHT_GAMES`(10) 뜻 주석 변경(「w가 최대에 닿는 현재 시즌 경기 수」). `ScrimTeamSide`·`ScrimPlayerView.skill`·`ScrimViewer.preferred_positions` 주석. `GetMyPositionSuggestionsQuery`·`GetMyPositionSuggestionsResponse` 추가 |
| `scrim-results.ts` | `RatingPolicyView.elo_weight_max`(0–1, 필수) 추가, `full_weight_games` 주석, `BalanceOptionMember.rating` 주석 |
| `dashboard.ts` | `DashboardRatingPolicy`: `soft_reset_ratio` **삭제**, `full_weight_games`·`elo_weight_max` **추가**(필수) |
| `seasons.ts` | `SEASON_SOFT_RESET_RATIO_DEFAULT` **삭제**, 머리 주석 |
| `paths.ts` | `myPositionSuggestions: '/me/position-suggestions'` |
| `contract.s3.test.ts` | 밸런스 `rating_policy` 픽스처에 `elo_weight_max` |
| `contract.s4.test.ts` | 소프트 리셋 상수 테스트 삭제, 요약 픽스처 갱신, 「S4 후속 변경 2」 describe 7개(상수 값, 소프트 리셋 상수 없음, 요약·밸런스 `rating_policy`, 추천 경로·쿼리·응답, 오류 코드 43개 유지) |

오류 코드 추가 없음(43개). `ScrimViewer`·`ScrimDetail` 모양은 그대로다(D190).

### 20-7. 화면 문구 변경 목록 (frontend)

숫자는 shared `RATING_START_ELO`와 응답 `rating_policy`로만 만든다(`*_DEFAULT` import 금지 규칙 그대로. `RATING_START_ELO`는 설정값이 아닌 고정 상수라 D176의 core 상수와 같은 취급). N = `round(elo_weight_max × 100)`.

| 위치(현재 줄) | 지금 | 변경 |
| --- | --- | --- |
| `apps/web/src/lib/elo-info.ts:1, 12–21` | `softResetElo`·`SEASON_SOFT_RESET_CENTER`·`RATING_SEED_*` import, `softResetSentence` | 삭제 |
| `elo-info.ts:27` | 승패 예시 `previewTeamElo({blueAvg: RATING_SEED_DEFAULT, …})` | `RATING_START_ELO` |
| `elo-info.ts:46–47` 「무슨 점수인가요」 | 「…라이엇 티어와는 따로 계산하고, 게임과 시즌마다 따로 쌓여요.」 | 「우리 서버 내전 결과로만 정해지는 점수예요. 라이엇 티어와 상관없이 모두 같은 점수에서 시작하고, 게임과 시즌마다 따로 쌓여요.」 |
| `elo-info.ts:51–53, 61–63` 「시작 점수는 어떻게 정하나요」(값 있음·없음 둘 다) | 소프트 리셋·티어 시드 문장 | 「모든 멤버가 티어와 상관없이 {RATING_START_ELO}점에서 시작해요. 새 시즌이 시작되면 모두 다시 {RATING_START_ELO}점이 돼요. 지난 시즌 순위는 시즌 최종 순위와 뱃지로 남아요.」(상수라 값 유무와 같은 문구) |
| `elo-info.ts` 끝 **새 섹션** 「팀을 나눌 때는요」 | 없음 | 값 있음: 「팀 자동 밸런스는 티어를 중심으로 나누고, 내전 ELO는 이번 시즌 경기 수에 따라 조금씩 섞어요. 이번 시즌 {full_weight_games}경기부터 최대 {N}%이고, 티어 비중은 {100 − N}% 아래로 내려가지 않아요.」 N = 0이면 「팀 자동 밸런스는 티어만으로 나눠요.」. 값 없음: 「팀 자동 밸런스는 티어를 중심으로 나누고, 내전 ELO는 조금만 섞어요.」 |
| `lib/dashboard.ts:7, 15–16, 28–34` `softResetText(ratio)` | 비율별 4가지 문구 | `seasonResetText()` = 「종료 시 모두 {RATING_START_ELO}점으로 초기화」. `HALF_RATIO` 삭제 |
| `components/shell/season-card.tsx:5, 42` | `softResetText(policy.soft_reset_ratio)` | `seasonResetText()` |
| `lib/scrim-results.ts:56–60` `skillFormulaText` | 「실력값 = w × 내전 레이팅 + (1 − w) × 티어 시드, w = 내전 경기 수 ÷ {full_weight_games} (최대 1). K = …」 | 「실력값 = w × 내전 ELO + (1 − w) × 티어 환산값. w는 이번 시즌 내전 경기 수에 따라 0에서 {N}%까지 늘어요({full_weight_games}경기부터 {N}%). K = {k_base}, 신규 멤버 K = {k_new}.」 + 기존 패배 배율 문장. 값 없음: 「실력값은 티어를 중심으로 이번 시즌 내전 ELO를 조금 섞어 계산해요.」 |
| `lib/rankings.ts:28` ELO 탭 설명 | 「서버 자체 내전 레이팅입니다. 운영진이 승인한 결과만 반영됩니다.」 | 「티어와 상관없이 모두 {RATING_START_ELO}점에서 시작하는 서버 자체 내전 점수입니다. 운영진이 승인한 결과만 반영되고, 시즌마다 새로 시작합니다.」 |
| `app/(auth)/layout.tsx:17` 로그인 화면 기능 소개 | 「운영진 승인 결과만 반영 · 시즌 소프트 리셋」 | 「운영진 승인 결과만 반영 · 시즌마다 {RATING_START_ELO}점에서 새로 시작」 |
| `components/scrims/scrim-new-form.tsx`(02 기본 정보, 희망 포지션 칸 340–350 근처) | 없음 | 20-5 안내 한 줄 |
| `components/scrims/scrim-detail.tsx` `JoinControls`(PositionPicker 660–671 아래) | 없음 | 20-5 안내 한 줄 |
| `_workspace/ELO_설명서.md` 1·3·5·6·8절, 9-1 | 티어 시드·소프트 리셋 설명, 9-1 「열린 결정」 | 리더가 새 규칙으로 고치고 9-1을 「결정됨(2026-10-31)」으로 닫는다. 20-1 영향(현재 시즌 혼재)을 적는다 |

그대로 두는 문구: `/rankings` 규칙 문구(「{min_games}경기 이상 … 동점이면 승률 순」), 티어 탭 「티어 점수 = 티어 × 400 + …」, `scrim-detail.tsx:463` `title="실력값"`, 로그인 화면 「티어와 내전 레이팅으로 126가지 조합 중 최적 3안」(:11, 여전히 맞다), 프로필 화면.

### 20-8. 스키마·마이그레이션

**스키마 변경 없음, 마이그레이션 없음.** `schema.prisma`는 `///` 주석 3줄만 고쳤다(`Rating` 모델 설명, `carriedFromSeasonId`, `Season.carriedRatings`). `prisma migrate diff --from-schema-datamodel <HEAD schema> --to-schema-datamodel prisma/schema.prisma --script` 출력 = `-- This is an empty migration.`, `prisma validate` 통과. `ratings.elo`의 DB 기본값은 원래 1000이다(승인은 값을 명시해 넣는다).

기존 데이터: 재계산·정리 스크립트 없음(D193). `carried_from_season_id` 기존 값은 남는다. `rating_history`, `season_standings`, `user_badges`는 손대지 않는다.

### 20-9. 결정 사항 (D182부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D182 | ELO 시작 점수 = shared `RATING_START_ELO`(1000). 모든 새 (사용자, 게임, 시즌) 행. 티어 무관. 설정값 아님. D103의 시드 표는 시작값 용도를 잃고 밸런스 티어 환산값으로만 쓴다 | 사용자 결정 1. 내전 ELO를 「이 서버 안의 내전 실력」으로 만든다. Q1(신규가 이월 멤버보다 높게 시작) 해소 |
| D183 | 소프트 리셋 폐지. core 함수 3개·상수, shared 기본값, env, `rating-carry.ts` 삭제(20-2). 새 시즌 행도 1000 | 사용자 결정 2. 죽은 코드를 남기면 다시 쓰일 위험이 있고, env가 남으면 운영자가 값을 바꿔도 아무 일이 없어 혼란스럽다 |
| D184 | `ratings.carried_from_season_id` 컬럼·FK는 남기고 쓰지 않는다. 새 행은 null | 메인 기본값 5. 지우면 `DROP COLUMN` 마이그레이션이 필요하고(QA 규칙 「DROP 없음」), 기존 행의 시작값 출처 감사 기록이 사라진다. 남겨도 비용이 없다. 나중에 정리하려면 별도 마이그레이션 |
| D185 | 승인 7c(시즌 행 `FOR SHARE` + `closed_at` 검사)와 8단계 사용자 잠금은 유지 | 7c는 닫힌 시즌 standings 오염 방지(D141), 사용자 잠금은 ratings 갱신 직렬화(S3)다. 둘 다 이월과 무관하다 |
| D186 | 시즌 종료 작업은 동작 변경 없음(standings·뱃지·`closed_at`). D145의 「미달자 값은 이월에 쓰인다」는 문구만 폐기 | 메인 기본값 6. 종료 작업은 원래 ratings를 쓰지 않았다 |
| D187 | 실력값 `w = 0.2 × min(현재 시즌 경기 수 ÷ 10, 1)`, 경기 수 = 현재 시즌 `ratings` 행 `wins + losses`(없으면 0), ELO 항 = `seasonElo ?? 1000`. K 판정(D106)·`is_new`는 모든 시즌 이력 수 그대로. D107 변경 | 사용자 결정 3, 메인 기본값 1. 시즌마다 1000으로 돌아가므로 지난 시즌 경기 수로 비중을 주면 정보 없는 1000이 섞인다. rated 반영마다 wins·losses 중 정확히 하나가 1 늘어 `wins + losses` = 그 시즌 반영 경기 수이고, 이미 읽는 행이라 쿼리가 늘지 않는다 |
| D188 | 0.2·10은 shared 상수(`BALANCE_ELO_WEIGHT_MAX`, `BALANCE_FULL_WEIGHT_GAMES`), env 아님. 화면은 `rating_policy.elo_weight_max`·`full_weight_games`로만 쓴다(밸런스·요약 두 응답). 요약의 `soft_reset_ratio`는 삭제 | 메인 기본값 2, D124 노출 규칙. ⓘ가 요약 `rating_policy`만 보므로 요약에도 넣는다 |
| D189 | 밸런스의 티어 값은 화면에서 「티어 환산값」이라 부른다. 코드 식별자(`tierSeed`, `RATING_SEED_BY_TIER`, `tierSeedRating`, `loadTierSeeds`)는 유지하고 주석만 고친다. 단 `computeSkill` 입력 `gamesPlayed`는 `seasonGames`로 바꾼다 | 메인 기본값 3. 「티어 점수」는 티어 랭킹의 `tierScore`(티어 × 400 + …, 화면 규칙 문구)와 겹쳐 다른 숫자가 같은 이름이 된다. 식별자 일괄 변경은 동작 변경과 섞여 리뷰 범위만 키운다. `seasonGames`는 뜻이 바뀌었으므로 이름을 바꿔 옛 호출부를 컴파일 오류로 잡는다 |
| D190 | 라인 추천은 새 엔드포인트 `GET /me/position-suggestions?game=` 하나로 내린다. `ScrimViewer`에 넣지 않는다 | 작성 화면은 내전이 없어 viewer가 없다. 추천은 (사용자, 게임) 값이라 내전과 무관하고, `ScrimDetail`은 상태 변경 응답 12곳이 함께 쓰므로 viewer에 넣으면 모든 쓰기 응답에 조회 2회가 붙는다. 두 화면이 같은 경로·같은 훅을 쓴다 |
| D191 | 추천 = 요청자 그 게임 대표 계정의 저장된 최근 20경기 → `computeMainPosition` → `games.positions` 안 값, 최대 2개. 외부 호출·동기화 등록 없음. 대상 아님·연동 없음·기록 없음은 `[]` | 메인 기본값 7. 프로필 `main_position`과 같은 계산이라 사용자가 보는 「주 포지션」과 기본값이 일치한다. 게임 코드 분기 대신 `has_positions`·`positions`로 판단(설계 원칙 3) |
| D192 | 화면은 사용자가 건드리기 전 빈 선택일 때만 추천으로 채우고, 이미 신청한 값·사용자 변경을 덮지 않는다. 서버는 받은 값을 그대로 저장한다 | 메인 기본값 7. 「본인이 바꿀 수 있다」와 「서버가 몰래 채우지 않는다」를 동시에 지킨다. 늦게 도착한 응답이 사용자 선택을 덮는 경합을 막는다 |
| D193 | 이미 승인된 경기·현재 시즌 기존 `ratings` 행은 다시 계산하지 않는다. 변경 뒤 새로 만들어지는 행부터 1000 | 메인 기본값 4. 영향(현재 시즌 혼재)은 20-1, 처리 여부는 Q11 |
| D194 | ⓘ는 「시작 점수」를 상수 문구로 바꾸고 「팀을 나눌 때는요」를 더한다(20-7). 현재 시즌 혼재 같은 과도기 안내는 ⓘ에 넣지 않는다 | 사용자 취지(티어는 팀 나눌 때만)를 점수 설명 자리에서 함께 보여 준다. 과도기 문구는 시즌이 바뀌면 틀린 말이 되므로 설명서·공지에 둔다(Q11) |
| D195 | api와 web은 같은 커밋으로 함께 배포한다(20-14). 응답 필드가 바뀌어 한쪽만 배포된 동안 요약·밸런스 응답 parse가 실패할 수 있다 | 19절과 같은 방식. 필수 필드로 두어 잘못된 값이 화면에 조용히 섞이지 않게 한다 |

### 20-10. 확인 필요 (추가)

17절 Q1·Q5는 20절로, Q9·Q10은 2026-10-31 사용자 확정으로 닫혔다(추천안 그대로, 코드 변경 없음).

**사용자 답변(2026-10-31):** Q11 실제 운영 데이터가 아직 없으므로 그대로 둔다(재계산·스크립트 없음). Q12 「티어 환산값」 확정. Q13 그대로 추천(「최근 {n}경기 기준」 표시, 본인 변경 가능) 확정. 세 항목 모두 아래 「현재 계약 · 추천」대로 구현한다.

| # | 질문 | 현재 계약 · 추천 | 다른 선택지 |
| --- | --- | --- | --- |
| Q11 | 현재 시즌에 이미 있는 ELO 행은 예전 규칙(티어 시드·소프트 리셋)으로 시작한 값이라, 이번 시즌이 끝날 때까지 기존 멤버(예: 다이아 1800 근처)와 새로 반영되는 멤버(1000)가 같은 랭킹에 섞인다. 괜찮은가? | 그대로 두고 다음 시즌부터 전원 1000(추천, 메인 기본값 4). 설명서·공지에 안내 | (a) 운영진이 현재 시즌을 일찍 끝내고 새 시즌을 시작한다(시즌 수정 화면은 S6, 지금은 DB 수동 작업 필요) (b) 일회성 스크립트로 현재 시즌 `rating_history`를 1000 시작으로 다시 재생해 `ratings`·이력을 고친다(되돌리기 어렵고 승인 순서 재현 검증이 필요하다) |
| Q12 | 밸런스에 쓰는 티어 값을 화면에서 「티어 환산값」이라고 부른다(「티어 점수」는 티어 랭킹의 다른 식과 겹친다). 이 이름이 괜찮은가? | 「티어 환산값」(추천, D189) | 「티어 기준 점수」 등 다른 말. 문구만 바뀐다 |
| Q13 | 라인 추천은 이미 저장된 최근 20경기만 쓴다. 전적 동기화가 오래 멈춘 멤버는 예전 라인이 추천된다. 괜찮은가? | 그대로(추천, D191). 안내 문구에 「최근 {n}경기 기준」을 보여 주고 본인이 바꿀 수 있다 | 동기화가 N일보다 오래됐으면 추천하지 않는다(기준일 상수 추가) |

### 20-11. 명세 문서 갱신 필요

명세(`게임 커뮤니티 대시보드 개발 문서.md`)는 고치지 않았다. 사용자가 반영할 목록:

| 위치 | 지금 문구 | 바꿀 내용 |
| --- | --- | --- |
| 7-1 셋째 항목(169행) | 「첫 레이팅은 연동된 티어로 시드를 정합니다 … 티어 연동이 없으면 1000입니다.」 | 티어와 상관없이 전원 1000에서 시작하고 시즌마다 1000으로 초기화 |
| 7-1 식(165행) | `R' = R + K(S − E)`(대칭) | 패배 쪽 변동에 패배 배율(기본 0.5)을 곱한다(19절에서 바뀐 것, 아직 미반영) |
| 7-2 1번(176행) | `실력값 = w × 내전 레이팅 + (1 − w) × 티어 시드`, `w = 내전 경기 수 ÷ 10(최대 1)` | `w × 내전 ELO + (1 − w) × 티어 환산값`, `w = 0.2 × min(이번 시즌 내전 경기 수 ÷ 10, 1)`, 티어 비중 80% 이상 |
| 7-2 3번(178행) | 희망 포지션 비용만 있음 | 희망 포지션 기본값 = 라이엇 대표 계정 최근 20경기 주·보조 라인, 본인이 변경 가능 |
| 7-3 마지막 문단(192행) | 「레이팅은 `1000 + (기존 − 1000) × 0.5`처럼 절반만 남기는 소프트 리셋을 적용합니다.」 | 「레이팅은 전원 1000으로 초기화합니다.」 |
| 6장 API 표(104행 근처 `/me/*`) | 없음 | `GET /me/position-suggestions?game=` — 참가 신청·작성 화면의 희망 포지션 기본값 |

### 20-12. 담당

의존: **logic → backend**, **logic → frontend 목 부분**(`computeSkill` 새 시그니처). frontend의 화면 문구·추천 훅은 바로 시작한다.

**logic (domain-logic-dev) — `packages/core/src/**`**

| 파일 | 작업 |
| --- | --- |
| `balance.ts` | `balanceEloWeight` 추가, `computeSkill` 입력 `seasonGames`·규칙 변경(20-3), `BalancePlayer.rating` 주석, 머리 주석 D187 |
| `balance.test.ts` | `computeSkill` 기존 테스트(112행~)를 20-3 표로 교체, `balanceEloWeight` 테스트 |
| `season.ts` | `softResetElo`·`seasonStartElo`·`pickPreviousRating` 삭제, `SEASON_SOFT_RESET_CENTER` import 삭제 |
| `season.test.ts` | 238–370행 근처 세 describe 삭제 |
| `config.ts` | `SEASON_SOFT_RESET_CENTER`와 S4 시즌 전환 상수 절 삭제, `RATING_SEED_BY_TIER`·`RATING_SEED_DEFAULT` 주석 「밸런스 티어 환산값(D189), ELO 시작값 아님」 |
| `rating.ts` | `tierSeedRating` 주석 같은 취지 |
| `index.ts` | 삭제 3개 export 제거, `balanceEloWeight` 추가 |
| dist | 재빌드. 보고서 `_workspace/02_domain-logic-dev_report.md`에 20절 추가분 |

**backend (backend-dev) — `apps/api/**`**

| 파일 | 작업 |
| --- | --- |
| `src/config/env.ts`, `env.spec.ts` | `SEASON_SOFT_RESET_RATIO`·`seasonSoftResetRatio` 삭제, 관련 테스트(160–177행) 삭제, 「`SEASON_SOFT_RESET_RATIO`가 env에 남아 있어도 기동 성공」 테스트 추가 |
| `src/modules/scrims/scrim-results.service.ts` | 9단계 20-4, import 정리, 클래스 주석(152–153행 「소프트 리셋 또는 시드」) |
| `src/modules/ratings/rating-carry.ts` | 삭제 |
| `src/modules/ratings/rating-inputs.service.ts` | 20-4 표(`seasonGames` 필드 추가, 이전 시즌 조회 삭제), 주석 |
| `src/modules/ratings/rating-seed.ts` | 주석만(밸런스 티어 환산값) |
| `src/modules/scrims/scrim-teams.service.ts` | `rating_policy.elo_weight_max` |
| `src/modules/dashboard/dashboard.service.ts` | `rating_policy` 20-4 |
| `src/modules/rankings/season-closer.ts` | 23행 주석(소프트 리셋 언급) |
| `src/modules/profile/recent-matches.ts`(새), `profile.service.ts` | `loadMatches`를 공용 함수로 이동 |
| `src/modules/profile/position-suggestions.service.ts`(새), `profile.controller.ts`, `profile.module.ts` | 20-5 엔드포인트 |
| `test/season-transition.e2e.spec.ts` | 6-1 이월 테스트(55–120행, 395–420행 근처)를 「새 시즌 첫 행 = 1000, carried null, 지난 시즌 1421이어도 1000, 다이아 신규도 1000」으로 교체. 시즌 경계 skill(478행 근처): 지난 시즌 경기가 많아도 새 시즌 0경기면 skill = 티어 환산값 |
| `test/scrim-results.e2e.spec.ts:175`, `test/loss-ratio.e2e.spec.ts:243`, `test/dashboard.e2e.spec.ts:77` | `rating_policy` 기대값 |
| `test/db/season-close.db.e2e.spec.ts:204, 237` | carried 기대값 → null·1000(작성만, DB 없음) |
| 새 테스트 | 승인 e2e: 현재 시즌 기존 행(1800)은 그대로 이어지고 새 멤버만 1000(D193). skill: 현재 시즌 0·5·10경기(w 0·0.1·0.2), 밸런스·상세 skill 일치. 추천 e2e: 롤 경기 있음 → 2개·`sample_size`·`synced_at`, 1개만, 롤체·스팀 → [], 계정 없음 → [], 깨진 summary 행 건너뜀, `game` 누락 400, 동기화 등록 안 함(enqueuer 미호출), 같은 사용자 프로필 `main_position`과 같은 값, 다른 사용자 계정 값이 섞이지 않음 |
| 보고서 | `_workspace/02_backend-dev_s4.md`에 20절 추가분 |

**frontend (frontend-dev) — `apps/web/**`**

| 파일 | 작업 |
| --- | --- |
| `src/lib/elo-info.ts`, `elo-info.test.ts` | 20-7 ⓘ 문구, 새 섹션, 테스트(소프트 리셋 ratio 케이스 삭제, `elo_weight_max` 0·0.2, 값 없음) |
| `src/lib/dashboard.ts`, `dashboard.test.ts` | `softResetText` → `seasonResetText`, 테스트 33–44행 교체 |
| `src/components/shell/season-card.tsx` | 42행 |
| `src/lib/scrim-results.ts`, `scrim-results.test.ts` | `skillFormulaText`, 테스트 59–64행 픽스처 `elo_weight_max` |
| `src/lib/rankings.ts` | 28행 |
| `src/app/(auth)/layout.tsx` | 17행 |
| `src/lib/api/scrims.ts`, `src/lib/hooks/scrims.ts`(또는 같은 위치 훅 파일) | `getMyPositionSuggestions(game)`, `usePositionSuggestions(game, enabled)` |
| `src/components/scrims/scrim-new-form.tsx` | 20-5 기본값·「건드림」 상태·안내 |
| `src/components/scrims/scrim-detail.tsx` | `JoinControls` 20-5 기본값·안내 |
| `src/lib/api/mock/ratings.ts` | 새 행 시작값 `RATING_START_ELO`(335행), `skillInfo`의 `computeSkill` 입력 `seasonGames`(192–199행, 현재 시즌 행 wins + losses), `rating` 폴백 1000, `ratingPolicyView`에 `elo_weight_max`(138행), 주석(142행) |
| `src/lib/api/mock/rankings.ts` | `SEASON_SOFT_RESET_RATIO_DEFAULT` import(30행)·`soft_reset_ratio`(388행) 삭제, `full_weight_games`·`elo_weight_max` 추가, 57행 주석 |
| 목 추천 엔드포인트 | `GET /me/position-suggestions` — 목 게임 계정의 최근 전적(`mock/game-accounts.ts`의 `mainPosition` 계산)과 같은 값. 목 시나리오에서 롤 연동 없음 → [] |
| `src/lib/api/mock/scrims.ts:168` | `SEED_VERSION` 6 → 7(저장된 목 ratings가 티어 시드로 시작했다) |
| 테스트 | `mock/rankings.test.ts:190`, `mock/scrim-results.test.ts:85` 기대값, 추천 기본값(채움·건드린 뒤 미적용·게임 변경 시 다시 채움·참가 중이면 저장값 유지·추천 실패 시 빈 선택) |
| 확인 | 다크·라이트 × 데스크톱·모바일: 작성 폼·상세 참가 영역 안내, ⓘ 새 섹션, 사이드바 시즌 카드. 보고서 `_workspace/02_frontend-dev_s4.md` |

**리더:** `_workspace/ELO_설명서.md`(20-7 마지막 행), 사용자 보고(20-1 영향, Q11–Q13).

### 20-13. qa 대조 항목

- 시작값: 승인 경로에 `RATING_START_ELO` 외 시작값 계산이 없는지. `rating.create`/`createMany`가 승인 9단계에만 있는지(기존 규칙). `carriedFromSeasonId`에 값을 쓰는 코드가 없는지.
- 삭제 확인: 코드 전체(목·테스트 포함)에 `softResetElo`, `seasonStartElo`, `pickPreviousRating`, `SEASON_SOFT_RESET`, `seasonSoftResetRatio`, `soft_reset_ratio`, `loadPreviousRatings`가 남지 않았는지(이력 문서 `_workspace/**` 제외).
- 7c `lockSeasonForRating`과 사용자 잠금이 그대로 있는지, 6-5 4·6–9행 테스트가 그대로 통과하는지.
- w: core 20-3 표 수치, `rating-inputs`의 `seasonGames` = 현재 시즌 행 `wins + losses`, `isNew`는 여전히 모든 시즌 이력 수. 밸런스 응답 `members[].skill` = 상세 `players[].skill`(같은 now).
- 응답: 밸런스 `rating_policy.elo_weight_max` = 0.2, 요약 `rating_policy`에 `soft_reset_ratio` 없음·`full_weight_games` 10·`elo_weight_max` 0.2. 웹 훅 parse가 실제 응답과 맞는지.
- env ↔ `.env.example` ↔ `config/env.ts`: `SEASON_SOFT_RESET_RATIO`가 셋 모두에 없는지. 남은 env가 기동을 막지 않는지.
- 추천: 엔드포인트 ↔ `ApiPath` ↔ 웹 클라이언트·목 일대일. 외부 호출·`enqueue` 없음. 프로필 `main_position`과 같은 값. 서버가 참가·작성 요청의 빈 포지션을 채우지 않는지(서비스 코드에 추천 호출이 없는지).
- 화면: 20-7 표 전 행. 「소프트 리셋」·「티어 시드」 표기가 화면 소스에 남지 않았는지(테스트·목 주석 제외). 숫자 1000·0.2·10 리터럴과 `*_DEFAULT` import가 화면 코드에 없는지(목 제외).
- 추천 기본값: 사용자 변경 후 늦게 온 응답이 덮지 않음, 참가 중 저장값 우선, 게임 변경 시 다시 채움, 추천 실패 시 빈 선택·오류 없음. 390px 폭에서 안내 줄바꿈.
- 스키마: `schema.prisma` diff가 주석뿐이고 새 마이그레이션 폴더가 없는지.

### 20-14. 배포 순서 영향

1. api·web을 **같은 커밋으로 함께** 배포한다(D195). 한쪽만 배포된 동안: 옛 web + 새 api → 요약 parse 실패(옛 스키마가 `soft_reset_ratio` 필수) → 홈 오류·사이드바 시즌 카드 숨김, 밸런스는 정상. 새 web + 옛 api → 요약·밸런스 parse 실패(`elo_weight_max` 없음), 추천 404 → 빈 선택(화면은 막히지 않음). 둘 다 배포가 끝나면 풀린다.
2. 마이그레이션 없음 → `prisma migrate deploy`는 할 일이 없다. 시드(`seed.ts`) 변경 없음.
3. Railway api 서비스 변수에서 `SEASON_SOFT_RESET_RATIO`를 지운다. 남겨 둬도 무시되지만 바꿔도 효과가 없어 혼란을 준다.
4. 배포 직후 현재 시즌 기존 행은 그대로라 랭킹 숫자가 갑자기 바뀌지 않는다. 새로 반영되는 멤버만 1000에서 시작한다(Q11).
5. web Dockerfile 복사 범위 변경 없음(새 워크스페이스 패키지 없음).
6. 랭킹 캐시는 다음 5분 주기에 새 값으로 갱신된다. 캐시 payload 형식 변경 없음.

### 20-15. 이번 변경과 기준선

architect가 바꾼 것: `packages/shared/src/scrims.ts`, `scrim-results.ts`, `dashboard.ts`, `seasons.ts`, `paths.ts`, `contract.s3.test.ts`, `contract.s4.test.ts`, `.env.example`, `apps/api/prisma/schema.prisma`(주석 3줄), 이 문서.

검증:

- `corepack pnpm --filter @gcd/shared typecheck` 통과. shared dist 재빌드.
- shared 테스트 **99 통과**(5파일, 이전 92 + 이번 7). 이 PC Node 20.11에서는 저장소 `vitest.config.ts`가 로드되지 않아(`ERR_REQUIRE_ESM`, 패키지 engines ≥ 22) 저장소 밖 임시 `.mjs` 설정(`include: ['src/**/*.test.ts']`, 같은 내용)으로 `npx vitest run --config <tmp>`를 실행하고 지웠다.
- `prisma migrate diff`(HEAD schema → 현재) = 빈 마이그레이션, `prisma validate` 통과.
- core typecheck 통과(아직 core는 바뀌지 않았다). **api typecheck는 예상대로 실패한다**(`src/config/env.ts:17` `SEASON_SOFT_RESET_RATIO_DEFAULT` 없음). **web typecheck도 예상대로 실패한다**(`season-card.tsx:42`, `elo-info.ts:63`, `mock/rankings.ts:30`, `mock/ratings.ts:138`, `elo-info.test.ts`, `scrim-results.test.ts`). backend·frontend 작업으로 해소된다. typecheck로 드러나지 않는 것: `dashboard.service.ts`·`scrim-teams.service.ts`는 객체를 `parse`에 넘기므로 새 필수 필드가 빠져도 컴파일되고 **실행 때 응답 parse가 실패한다**(backend 20-4).

## 21. S4 후속 변경 3 — Q8 요약 부분 실패 (사용자 결정, 2026-10-31)

Q2·Q3·Q4·Q6·Q7은 17절 추천안 확정이다. 코드 변경 없음. Q4의 `users.left_at`은 S5에서 넣는다. 이 절은 Q8만 구현한다. 2절·8-2의 이전 동작 문장보다 이 절이 우선한다.

### 21-1. 규칙 (D196–D201)

| 상황 | `top_rankers` | `top_rankers_state` | 화면 |
| --- | --- | --- | --- |
| 시작한 시즌이 없음(`resolveSeasonAt ?? latestStartedSeason`이 null). games가 비어도 이쪽이 우선(D201) | null | `no_season` | 「아직 시즌이 없어요」 |
| `games` 행이 없음 | null | `unavailable` | 「순위를 불러오지 못했어요」. 서버 error 로그 |
| `eloView`가 던짐(빈 캐시 첫 계산 실패 포함) | null | `unavailable` | 같은 문구. 서버 error 로그. 그 게임에서 루프를 멈춘다(D198) |
| 순위 블록이 있음. 행이 0개여도 | 객체 | `ready` | 기존 빈 상태 문구 |

- 요약의 나머지(시즌 카드, 모집, 통계, 최근 결과, `me`)는 그대로 200이다.
- `GET /rankings/*`의 빈 캐시 첫 계산 실패 500은 그대로다.
- 값이 있는 캐시의 갱신 실패(`stale: true`)는 이 절과 무관하다. 그때 `top_rankers`는 ready다.
- 게임을 sort_order 순으로 본다. 행이 있는 게임을 만나면 그 블록으로 ready를 반환하고 뒤 게임은 보지 않는다. 계산이 한 번이라도 던지면 앞 게임의 빈 블록으로 대체하지 않고 전체 unavailable이다(D198).
- 재시도 대기 시간은 두지 않는다. 다음 요약 요청이 같은 첫 계산을 다시 시도하고, 키별 in-flight 중복 제거는 랭킹과 같다(D201).
- `me`는 감싸지 않는다(D199). `eloEntryOf`는 캐시만 읽고 첫 계산을 하지 않는다. 캐시가 없으면 지금처럼 elo는 ratings 값, rank는 null이다. 캐시 읽기 자체가 실패하면 통계·모집 조회와 같이 요약 500이다.

### 21-2. 응답

shared는 반영됐다. `GetDashboardSummaryResponse`는 `top_rankers_state` 기준 판별 유니언이다. ready는 `top_rankers` 객체, `no_season`·`unavailable`은 null. 다른 조합은 parse 실패(D197). `.strict()`가 필요한 테스트는 `GetDashboardSummaryBody.strict()`로 알 수 없는 키를 거른 뒤 유니언으로 조합을 검사한다.

### 21-3. 담당

**backend:** `dashboard.service.ts`의 `topRankers`가 `{ top_rankers, top_rankers_state }`를 반환. 실패·games 없음은 `Logger.error` 한 줄(원인 로그는 `RankingsReader`가 이미 남긴다). `test/dashboard.e2e.spec.ts`: 시즌 없음 = `no_season`, lol 첫 계산 실패 = 200·`unavailable`·season·stats·me 유지·rank null, 실패를 풀면 ready, lol은 빈 블록인데 tft 계산이 실패하면 unavailable(lol로 대체하지 않음), games 행을 비우면 unavailable, 시즌도 없고 games도 없으면 `no_season`.

**frontend:** `lib/rankings.ts`에 `TOP_RANKERS_UNAVAILABLE_TEXT`. 홈 `TopRankersPanel`은 state로 빈 문구를 고른다(`no_season`은 기존 `SEASON_NONE_TEXT`). 목 `dashboardResponse`가 state를 넣고, 시나리오 `top_unavailable`는 요약 200·`unavailable`·`me.rank` null, `/rankings/tier`·`/rankings/elo`는 500. 사이드바 시즌 카드는 그대로(`season`만 본다).

### 21-4. 배포

api와 web을 같은 커밋으로 배포한다(D200). 새 웹 + 옛 api는 `top_rankers_state`가 없어 요약 parse가 실패하고 시즌 카드가 숨는다. 옛 웹 + 새 api는 알 수 없는 필드를 버리고 `top_rankers: null`을 「아직 시즌이 없어요」로 보여, 실패와 시즌 없음을 구분하지 못한다.
