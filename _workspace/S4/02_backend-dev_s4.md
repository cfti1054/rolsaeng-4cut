# backend-dev 보고서: S4 apps/api

계약: `_workspace/01_architect_contract.md` 14절 backend 1–8번, 4·6·7·8·11·13·15절.

## 결과

- 엔드포인트 신규 3개, 프로필 응답 확장 2개 구현. 시즌 종료·랭킹 캐시 작업, 승인 7c·9단계, 읽기 D160, env 3개 완료.
- `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api build` 통과.
- api 테스트 **470 passed / 42 skipped**(기준선 381 passed / 33 skipped, 신규 89건 + DB e2e 9건). 실패 0. QA 수정 반영 뒤 수치다.
- core 테스트 347 passed(별도 임시 설정으로 확인). `softResetElo`·`pickPreviousRating`을 실제 호출한 상태에서 승인 테스트가 통과했다.
- **실제 PostgreSQL에서는 아무것도 실행하지 않았다.** 아래 「미실행」 참고.

사용 가능한 도구: Read, Bash, Write, Edit, SubagentHandback.

## 엔드포인트

| 메서드 | 경로 | 응답 | 오류 |
| --- | --- | --- | --- |
| GET | /rankings/tier?game= | GetTierRankingResponse | 401, 400 VALIDATION_FAILED(steam 포함) |
| GET | /rankings/elo?game=&season= | GetEloRankingResponse | 401, 400, 404 NOT_FOUND |
| GET | /dashboard/summary | GetDashboardSummaryResponse | 401 |
| GET | /users/:id/profile | `badges` 항상 배열, `scrim.ratings[].rank` 실제 값 | 기존과 같음 |

## 변경 파일

새 파일(src):
- `modules/rankings/`: rankable-users, ranking-keys, ranking-cache.store, ranking-calculator.service, rankings-reader.service, ranking-refresher, season-closer, ranking-jobs.scheduler, ranking-jobs.module, rankings.module, rankings.controller
- `modules/dashboard/`: dashboard.controller, dashboard.service, dashboard.module
- `modules/ratings/rating-carry.ts`
- `common/shared-schedule.ts`(계약 외, 아래 참고)

수정(src): `config/env.ts`, `app.module.ts`, `modules/ratings/rating-locks.ts`, `modules/ratings/rating-inputs.service.ts`, `modules/scrims/scrim-results.service.ts`, `modules/scrims/scrims.module.ts`, `modules/scrims/scrim-views.service.ts`(gameRef 공개), `modules/profile/profile.service.ts`, `modules/profile/profile-scrim.service.ts`, `modules/profile/profile.module.ts`, `jobs/jobs.module.ts`(계약 외, 아래 참고), `apps/api/vitest.config.ts`

테스트:
- 새 파일: `test/rankings.e2e.spec.ts`(27), `test/season-transition.e2e.spec.ts`(31), `test/dashboard.e2e.spec.ts`(15), `test/support/s4-helpers.ts`, `test/support/memory-ranking-cache.ts`, `test/db/season-close.db.e2e.spec.ts`(5, 작성만), `test/db/ranking-cache.db.e2e.spec.ts`(4, 작성만)
- 수정: `test/schedule-dedupe.spec.ts`(+14), `src/config/env.spec.ts`(+2), `test/profile.e2e.spec.ts`(badges `[]`), `test/support/fake-prisma.ts`, `test/support/fake-table.ts`, `test/support/test-app.ts`

## 계약과 다른 점

| # | 내용 | 이유 |
| --- | --- | --- |
| 1 | **계약 외 수정: cron 중복 수정.** `common/shared-schedule.ts`를 만들어 Jobs·Scrims·RankingJobs 세 모듈이 `ScheduleModule` 객체 하나를 공유한다. `jobs/jobs.module.ts` 1줄 변경 포함 | 아래 「발견한 기존 결함」 |
| 2 | **계약 외 수정: `ScrimsModule.forRoot()`가 구성별로 같은 객체를 돌려준다** | 계약 11절대로 DashboardModule이 ScrimsModule을 import하면 인스턴스가 2개가 되어 자동 마감 cron도 2개가 된다(테스트로 재현 후 수정) |
| 3 | RankingsModule이 `RankingsReader` 외에 `RankingRefresher`·`SeasonCloser`도 export | 11절은 Reader만 적었지만 RankingJobsModule의 스케줄러가 주입받아야 한다 |
| 4 | RankingsReader에 `eloView`(대시보드 공용)·`eloEntryOf`(me의 elo·rank) 공개 메서드 추가. `eloRankOf`는 이 위에 있다. 인자는 `(game, seasonId, userId)` | 4-2와 8-2가 같은 출처를 쓰게 하려고 |
| 5 | 프로필 `badges`는 `include` 대신 user_badges → badges → seasons를 표별로 한 번씩 읽는다. 결과는 같다 | ScrimViews와 같은 방식, FakeTable이 include를 지원하지 않음 |
| 6 | 티어 스냅샷 SQL은 id 배열 대신 `JOIN game_accounts`로 범위를 좁힌다. 순위 대상 필터(`rankableUserWhere`)는 계정 조회에서 적용한다 | `$queryRaw` uuid 배열 파라미터는 실제 DB로 확인할 수 없어 위험을 줄였다. DISTINCT ON·정렬은 계약 그대로 |
| 7 | `SkillInput.seasonElo` 의미 확장: 행이 없으면 소프트 리셋 값, 이전 행도 없으면 null | D160. `computeSkill`이 seasonElo ?? tierSeed를 쓰므로 필드를 늘리지 않았다 |
| 8 | `ScrimViews.gameRef`를 private에서 public으로 | 8-3 `game: ScrimGameRef` |

계약에 없는 필드·엔드포인트·오류 코드는 추가하지 않았다.

## 발견한 기존 결함 (리더·QA 확인 필요)

**S2부터 cron이 중복 등록되고 있었다.** Nest 11은 동적 모듈을 참조로 구분한다(`ByReferenceModuleOpaqueKeyFactory`가 기본값). `ScheduleModule.forRoot()`를 부를 때마다 인스턴스가 생기고, 인스턴스마다 탐색기가 앱의 모든 `@Cron`을 따로 등록한다.

- 측정: `forRoot()` 3번 호출 시 ScheduleModule 인스턴스 3개, 각 인스턴스 레지스트리에 같은 cron 등록.
- 영향: 배포 환경에서 SYNC·SCRIM이 모두 켜져 있으면 동기화·자동 마감 작업이 2번씩 돌았을 가능성이 있다. 이번 수정 전이었다면 S4 추가로 3번이 된다. try lock으로 동시 실행은 막혀도 실행 횟수는 늘어난다.
- 기존 `schedule-dedupe.spec.ts`는 레지스트리 하나만 봐서 이를 잡지 못했다. 이제 ScheduleModule 인스턴스가 1개인지, AppModule의 ScrimsModule이 1개인지 검사한다.
- 실제 배포 로그로 확인한 것은 아니다. 측정은 테스트 모듈에서 했다.

## 테스트 결과

- 14절 6번 항목 전부 작성. 6-1 표 5경우 + 다른 게임·비율 설정, 6-5 시나리오 1·2·4·5·6·7·8·9·10·11(FakePrisma 범위), 시나리오 3은 DB e2e.
- 변이 검사 13종(7c 제거, 승인 이월 무시, carried 미기록, D160 무시, 유예·closed_at 재확인 제거, 최소 경기 설정 무시, 닫힌 시즌 캐시 출처, 프로필이 계산 유발, 실패 격리 제거, 주 기준 고정 해제, me 동점 규칙, next 제외 제거)을 일부러 넣어 보았고 모두 테스트가 실패했다. 소스는 복원했다.

## 미실행

| 항목 | 상태 |
| --- | --- |
| `test/db/season-close.db.e2e.spec.ts` 5건, `test/db/ranking-cache.db.e2e.spec.ts` 4건 | **작성만, 실행 안 함**(typecheck만 통과). Docker·PostgreSQL 없음 |
| 기존 DB e2e 33건 | 실행 안 함 |
| 실제 SQL 전부 | 미검증: `ON CONFLICT … WHERE` upsert, `SELECT DISTINCT ON`, `FOR SHARE`, `FOR NO KEY UPDATE`, FK 검사 비대기. FakePrisma는 정규식으로 문장을 흉내 낼 뿐 SQL을 해석하지 않는다 |
| 잠금 대기·교착 없음(6-3), 시나리오 3 | 미검증. FakePrisma는 트랜잭션을 직렬화한다 |
| 앱 실제 기동(`NestFactory` + 실제 DB, cron 실제 발화) | 저장소 테스트로는 실행 안 함. 플래그 8조합은 AppModule을 Test 모듈 + FakePrisma로 띄워 cron 등록·DI 생성까지만 검사한다. 시각이 되어 cron이 도는 것은 검사하지 않는다 |
| `apps/api/vitest.config.ts` | Node 20.11이 읽지 못해 같은 내용의 임시 `vitest.tmp-s4.config.mjs`로 실행 후 삭제. 저장소 설정 변경은 계약이 지시한 `RANKING_JOBS_ENABLED: 'false'`뿐이다. Node 22로 다시 돌린 결과는 아니다 |
| shared 테스트 | 실행 안 함(이번에 shared를 바꾸지 않음) |

## 남은 문제 (계약대로 구현했고 판단이 필요한 것)

1. **남은 결함(QA minor 4, 이번에 수정하지 않음, 리더 지시).** `apps/api/src/modules/dashboard/dashboard.service.ts:85`: `/dashboard/summary`의 `top_rankers`는 빈 캐시면 첫 계산을 일으킨다(4-2 출처를 그대로 쓰므로). 이 첫 계산이 실패하면 요약 전체가 500이 되어 홈과 사이드바 시즌 카드가 함께 사라진다. 첫 작업 tick 이후에는 캐시가 있어 드문 경우다.
2. `me.rank`는 읽기 전용이라 대표 게임이 `top_rankers` 게임과 다르고 캐시가 비어 있으면 첫 주기까지 null이다.
3. 시즌 종료 처리 `runOnce`의 바깥 트랜잭션 timeout은 계약에 값이 없어 5분으로 뒀다(갱신 작업과 같음). 넘겨도 각 시즌 처리는 별도 트랜잭션이고 시즌 행 잠금 후 재확인하므로 안전하다.

## 수정 이력

QA 판정(`_workspace/03_qa-verifier_backend.md`) 중 테스트 결함 2건을 리더 지시로 수정했다. src는 바꾸지 않았다. 마이그레이션(결함 1, blocker)은 리더가 처리해 건드리지 않았다.

| QA 결함 | 수정 | 확인 |
| --- | --- | --- |
| 2 `test/season-transition.e2e.spec.ts` 7c 순서 | `rating.createMany`·`rating.update` 호출을 rawCalls에 함께 기록해 「사용자 잠금 < FOR SHARE < 첫 rating 쓰기」를 비교. 첫 쓰기가 createMany인지도 고정 | 7c를 createMany 뒤로 옮긴 변형(M7)과 사용자 잠금 앞으로 옮긴 변형이 각각 이 테스트 1건 실패. 복원 확인 |
| 3 `test/schedule-dedupe.spec.ts` | QA 임시 spec의 env 8조합 행렬을 옮김. `vi.stubEnv` + `vi.resetModules` + `test-app` 동적 import로 조합마다 AppModule을 새로 띄워 cron 식 목록, ScheduleModule·ScrimsModule·RankingsModule 수, RankingJobsScheduler·ScrimAutoCloseScheduler·SyncScheduler 인스턴스 수를 검사. QA 구성과 달리 NestFactory 대신 `createTestApp`(FakePrisma)을 쓴다 | RankingJobs의 forRoot 직접 호출, RankingsModule import 제거(DI 파손), ScrimsModule 캐시 제거 변형이 모두 행렬에서 실패. 복원 확인 |

- 수정 뒤 `corepack pnpm --filter api typecheck`, `corepack pnpm --filter api build` 통과. api 테스트 470 passed / 42 skipped. Node 20.11이라 같은 내용의 임시 `.mjs` 설정으로 실행하고 지웠다.
- 처음 보고한 「기존 결함」의 등록 수는 QA가 `HEAD AppModule`로 재측정했다(ScheduleModule 2개, cron 8개, 기대 4개). 실제 배포 환경의 실행 횟수는 여전히 측정하지 않았다.

## 20절(S4 후속 변경 2)

계약 20-1~20-6, 20-9(D182–D195), 20-10(Q11–Q13 추천안), 20-12 backend 표대로 구현했다. 스키마·마이그레이션·shared·core·web은 건드리지 않았다.

### 변경

| 파일 | 내용 |
| --- | --- |
| `src/modules/scrims/scrim-results.service.ts` | 승인 9단계: 빠진 행을 `elo: RATING_START_ELO`로 `createMany(skipDuplicates)`. `carriedFromSeasonId`는 넣지 않는다(null). `seasonStartElo`·`tierSeedRating`·`loadPreviousRatings`·`loadTierSeeds` import 삭제. 7a·7b·7c(`lockSeasonForRating`)·8(사용자 잠금)·10–13 그대로(D185). 클래스 주석 |
| `src/modules/ratings/rating-carry.ts` | **삭제** |
| `src/modules/ratings/rating-inputs.service.ts` | `SkillInput.seasonGames`(현재 시즌 행 wins + losses, 없으면 0) 추가, `seasonElo` = 현재 시즌 행 값 또는 null(이전 시즌 조회 삭제), `computeSkill({ seasonElo, seasonGames, tierSeed })`, `rating = seasonElo ?? RATING_START_ELO`(전에는 `?? tierSeed`). `gamesPlayed`(모든 시즌 이력 수)는 `isNew`에만 |
| `src/modules/scrims/scrim-teams.service.ts` | 밸런스 `rating_policy.elo_weight_max: BALANCE_ELO_WEIGHT_MAX` |
| `src/modules/dashboard/dashboard.service.ts` | 요약 `rating_policy`: `soft_reset_ratio` 삭제, `full_weight_games`·`elo_weight_max` 추가 |
| `src/config/env.ts`, `env.spec.ts` | `SEASON_SOFT_RESET_RATIO`·`SEASON_SOFT_RESET_RATIO_DEFAULT` import·`AppConfig.seasonSoftResetRatio` 삭제. 비율 테스트 삭제, 「env에 남아 있어도(0.5·0.25·half·-1) 기동 성공, 설정이 없을 때와 같다」 테스트 추가 |
| `src/modules/profile/recent-matches.ts`(새) | `loadRecentLolMatches(db, gameAccountId)` — `ProfileService.loadMatches`를 그대로 옮김 |
| `src/modules/profile/profile.service.ts` | 위 함수 사용(동작 변경 없음) |
| `src/modules/profile/position-suggestions.service.ts`(새), `profile.controller.ts`, `profile.module.ts` | `GET /me/position-suggestions?game=`(20-5). `GameCatalog.ids()`로 game id → games 행 → `has_positions` false면 빈 응답 → 대표 계정(`isPrimary`) → `loadRecentLolMatches` → `computeMainPosition` → `games.positions` 안 값, 최대 2개. `SyncEnqueuer`·외부 클라이언트를 주입하지 않는다 |
| `rating-seed.ts`, `ratings.module.ts`, `rankings/season-closer.ts` | 주석만(티어 환산값, 소프트 리셋 언급 삭제) |

참가 신청·작성 서비스는 바꾸지 않았다(추천 호출 없음, 빈 포지션 그대로 저장).

### 응답 예시

```json
GET /me/position-suggestions?game=lol
{ "game": "lol", "positions": ["mid", "top"], "sample_size": 6, "synced_at": "2026-10-27T20:00:00.000Z" }

GET /me/position-suggestions?game=tft   (또는 계정 없음)
{ "game": "tft", "positions": [], "sample_size": 0, "synced_at": null }
```

### 테스트

| 파일 | 내용 |
| --- | --- |
| `test/season-transition.e2e.spec.ts` | 6-1 교체: 지난 시즌 1421·1512·800이어도 새 행 1000·carried null·지난 행 불변, 다이아 신규 1000, 자동 생성 시즌 1000, **현재 시즌 기존 행 1800은 이어지고 새 멤버만 1000(D193)**, 승인이 현재 시즌 ratings만 읽고 createMany 데이터에 carried 없음, `SEASON_SOFT_RESET_RATIO` 남아도 1000. 6-3 미달자 다음 시즌 1000. 6-5 starts [1000, 1000]·carried [null, null](두 순서 결과 동일 유지). 읽기: 지난 시즌 10경기여도 새 시즌 0경기면 skill = 티어 환산값·is_new false, 현재 시즌 0·5·10·25경기 → 1800·1720·1640·1640, ELO 1400·10경기 → 1720, 현재 시즌 없으면 티어 환산값 |
| `test/scrim-results.e2e.spec.ts` | 밸런스 `rating_policy` `elo_weight_max` 0.2, 신규 다이아 `rating` 1000(skill 1800 그대로). 승인 테스트: GOLD도 1000 시작 → ±20, carried null. **새 테스트**: 0·5·10·25경기 실력값과 밸런스 `members[].skill` = 상세 `players[].skill` |
| `test/loss-ratio.e2e.spec.ts`, `test/dashboard.e2e.spec.ts` | 요약 `rating_policy` 기대값 |
| `test/position-suggestions.e2e.spec.ts`(새, 7건) | 롤 2개·sample_size·synced_at, 깨진 summary·win null 건너뜀, 프로필 `main_position`과 같은 값, `SyncEnqueuer.enqueue` 미호출·큐 비어 있음(전적이 7시간 지난 상태에서), 1개만, 기록 없음, 롤체·스팀·계정 없음 [], 부계정·다른 사용자 미혼입, 대표 변경 반영, `games.positions` 필터, game 누락·모르는 값 400, 인증 없음 401 |
| `test/db/season-close.db.e2e.spec.ts` | carried → null, 시작 1000(작성만, DB 없음) |

### 결과

- `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api build` 통과(dist에 남은 옛 `rating-carry.js`는 지웠다, dist는 gitignore).
- api 테스트 **498 passed / 42 skipped / 0 failed**(37파일 중 7 skip = DB e2e). 두 번 실행해 같은 결과. Node 20.11이라 저장소 밖 `/tmp`에 같은 내용의 `.mjs` 설정(`unplugin-swc`는 절대 경로 ESM import)으로 실행하고 지웠다.
- 삭제 확인 rg(`softResetElo|seasonStartElo|pickPreviousRating|SEASON_SOFT_RESET|seasonSoftResetRatio|soft_reset_ratio|loadPreviousRatings`, apps/api, dist 제외): 남은 것은 계약이 요구한 「env에 남아 있어도 기동」 테스트 2곳의 `SEASON_SOFT_RESET_RATIO` 문자열(`src/config/env.spec.ts`, `test/season-transition.e2e.spec.ts`)뿐이다.

### 계약과 다른 점·판단

- 20-13 삭제 확인 항목과 20-12 「남아 있어도 기동 성공 테스트」가 충돌한다. 테스트 쪽을 택해 테스트 2곳에 키 문자열이 남는다. QA rg에서 이 두 곳은 예외로 봐야 한다.
- 추천 응답에서 대표 계정은 있는데 포지션 근거가 없을 때 `synced_at`은 계정 `matchesSyncedAt`을 준다(20-5 5번을 그대로 적용). 1번(포지션 없는 게임)·2번(계정 없음)만 null.
- `SkillInput.rating` 폴백이 `tierSeed` → 1000으로 바뀌어 밸런스 `members[].rating`과 `rating_avg`·`elo_preview`가 행 없는 멤버에서 달라진다(20-4 표대로).

### 미확인

- DB e2e(`test/db/*`) 실행 안 함(DB·Docker 없음). Node 22로 돌린 결과 아님.
