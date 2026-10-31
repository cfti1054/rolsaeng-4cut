# QA: S4 apps/api — 판정: fail

대상: `apps/api`(마이그레이션 포함). 기준: 계약 14절 qa, 4·6·7·8·11·13·15절, S3 계약, 문서 9장, `qa-boundary-check`.
blocker 1, major 0, minor 3, 문서 정정 2. 코드 수정·커밋 없음. apps/web은 판단하지 않았다.

**중요 한계:** 실제 PostgreSQL을 쓰지 못했다. 원시 SQL과 잠금은 코드 추적과 PostgreSQL 문서 지식으로만 판단했다. 이번 pass 항목 중 DB 동작은 「실행 확인」이 아니다(「미실행」 참고).

사용 가능한 도구: Read, Bash, Write, SubagentHandback.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `apps/api` `tsc -p tsconfig.json --noEmit` | exit 0 |
| `apps/api` `tsc -p tsconfig.build.json --outDir <스크래치패드>` | exit 0 |
| `prisma validate` | 통과 |
| `prisma migrate diff`(HEAD schema → 현재) vs `migration.sql` | **불일치 2줄**(결함 1). 그 외 문장 일치 |
| `grep DROP migration.sql` | SQL 문장에는 없음. 3행 주석에 단어만 있음 |
| `vitest run`(스크래치패드 임시 설정, 저장소 설정과 같은 내용) api | 28파일 통과·7파일 skip, **462 passed / 42 skipped** |
| core·shared typecheck, vitest | exit 0, core 347 passed, shared 91 passed |
| 임시 spec: AppModule을 실제 `NestFactory`로 env 8조합 기동 | 8조합 모두 기대값(아래 A) |
| 임시 spec: B 재현, tier 불량 행 11종 | 아래 |
| 뮤테이션 11종(스크래치 복사본) | 9종 검출, 1종 생존(결함 2), 1종 동등 변형 |

임시 파일: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4/qa/cron.spec.ts`, `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4/qa/behav.spec.ts`, `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4/vitest.api.config.mjs`

## 결함

| # | 심각도 | 위치 | 기대 | 실제 | 재현 | 처리 제안 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **blocker** | `apps/api/prisma/migrations/20261030180000_s4/migration.sql:6-7` | 파일 전체가 유효한 SQL. 계약 3절 「주석 제외 diff 없음」 | prisma CLI 경고가 SQL 본문에 그대로 들어 있다. `warn The configuration property ...`, `For more information, see: ...`. 주석이 아니므로 PostgreSQL은 `warn`에서 구문 오류를 낼 것이다. `apps/api/Dockerfile:47`의 CMD가 `prisma migrate deploy && ...`라 API 컨테이너가 뜨지 않고, 실패 기록이 남으면 이후 deploy도 P3009로 막힌다. DB e2e도 이 마이그레이션으로 준비하므로 함께 막힌다 | `grep -n 'warn\|For more' apps/api/prisma/migrations/*/migration.sql` → S4 파일 두 줄만. `migrate diff` 출력과 비교해도 이 두 줄만 다르다. PostgreSQL 없이 정적으로 확인했고 실행 오류를 직접 보지는 못했다 | 6·7행만 삭제(아직 미커밋이라 체크섬 문제 없음). `2>&1` 없이 stdout만 저장. 리더가 architect 또는 backend에 배정 |
| 2 | minor(테스트) | `apps/api/test/season-transition.e2e.spec.ts:147-158` | 제목대로 7c가 ratings 쓰기 전임을 고정 | 사용자 잠금 뒤인지만 본다. 7c를 `createMany` 뒤로 옮긴 변형이 462건 모두 통과. 실제 코드 순서는 맞다(`scrim-results.service.ts:202`가 `:211`보다 앞) | 뮤테이션 M7 | FakePrisma의 `rating.createMany` 호출 순서와 함께 기록해 비교 |
| 3 | minor(테스트) | `apps/api/test/schedule-dedupe.spec.ts:112-121`, `apps/api/vitest.config.ts` | 세 플래그가 켜진 AppModule에서 ScheduleModule 1개·cron 5개를 고정 | 저장소 테스트는 플래그를 끄고 AppModule을 띄운다. `RankingJobsScheduler` DI는 저장소 테스트에서 한 번도 생성되지 않는다. 임시 spec으로 동작은 확인했다 | 아래 A | 임시 spec의 행렬을 저장소 테스트로 옮김. env를 모듈 로드 전에 정해야 하므로 `vi.resetModules`와 동적 import 필요 |
| 4 | minor | `apps/api/src/modules/dashboard/dashboard.service.ts:85`, `apps/api/src/modules/rankings/rankings-reader.service.ts:74-79` | 판단 항목 B 참고 | 첫 계산 실패 시 요약 전체 500 | 아래 B | 아래 B |

### 문서 정정(코드 결함 아님)

- `_workspace/01_architect_contract.md:62`: 「일치 확인함」은 사실과 다르다. 결함 1을 고친 뒤 다시 확인하고 유지한다.
- 같은 문서 11절(`:459-460`): `ScheduleModule.forRoot()`를 `sharedScheduleModule`로, export 목록에 `RankingRefresher`·`SeasonCloser`를 반영한다. 8절 또는 D164에 `ScrimsModule.forRoot` 동일 객체 규칙도 적는다.

## 구현자 판단 요청 항목

### A. 계약 외 변경(공유 ScheduleModule, jobs.module.ts, ScrimsModule.forRoot): 결함 아님, 수용 권고

`@nestjs/core` 11.2.8의 `container.js:26-31`은 기본값이 `ByReferenceModuleOpaqueKeyFactory`다. 구현자 진단이 맞다.

| 실행 | ScheduleModule 인스턴스 | 등록 cron 수 |
| --- | --- | --- |
| 최소 재현, `forRoot()` 2회, `NestFactory` | 2 | 2 |
| 최소 재현, `Test.createTestingModule` | 2 | 2 |
| 최소 재현, 같은 객체 공유, `NestFactory` | 1 | 1 |
| **HEAD(S3) AppModule**, SYNC·SCRIM on | **2** | **8**(기대 4) |

현재 AppModule, 실제 `NestFactory`, 각 조합을 새로 import해 측정:

| SYNC | SCRIM | RANKING | 인스턴스 | cron(기대) | ScrimsModule 수 |
| --- | --- | --- | --- | --- | --- |
| on | on | on | 1 | 5 (5) | 1 |
| on | on | off | 1 | 4 (4) | 1 |
| on | off | on | 1 | 4 (4) | 1 |
| on | off | off | 1 | 3 (3) | 1 |
| off | on | on | 1 | 2 (2) | 1 |
| off | on | off | 1 | 1 (1) | 1 |
| off | off | on | 1 | 1 (1) | 1 |
| off | off | off | 0 | 0 (0) | 1 |

- 수정이 다른 cron을 끊지 않는다. SYNC 3개(`*/5`, `0 *`, `0 5`), SCRIM 1개, RANKING 1개가 각각 정확히 등록된다. `RankingJobsScheduler` DI도 문제없다.
- 1초 cron 2.3초 측정값은 2개 등록 시 4회, 1개 등록 시 3회였다. 측정 구간에 들어간 tick 수가 달라 깔끔한 2배는 아니다. 근거는 등록 수다.
- S2·S3 배포 환경의 실제 실행 횟수는 측정하지 않았다. HEAD 측정은 등록 수까지만 본 것이고, 그 spec은 DB 없는 환경에서 앱 종료 단계 오류로 실패 처리됐다(수치는 종료 전에 출력).
- `forRootCache` 키가 jobs 불리언뿐인 것은 forRoot 입력이 그것뿐이라 문제없다. `DashboardModule` 데코레이터와 AppModule은 같은 env에서 평가된다(`main.ts`가 `load-env`를 먼저 읽음).

### B. top_rankers 첫 계산 실패 시 요약 전체 500: 계약 위반 아님, minor

재현: 현재 시즌과 모집 내전이 있고 캐시가 빈 상태에서 `computeAndStore`를 실패시키면 `/dashboard/summary`가 500 `INTERNAL_ERROR`. 같은 상태의 프로필은 200. 계산이 복구되면 다음 요청은 200.
캐시 행이 있으면 갱신 실패 시 200, `stale: true`, 마지막 값 유지, `synced_at` 유지, `me` 값 유지를 확인했다.

- 문서 9장 「마지막 성공값」은 값이 있을 때의 규칙이다. 빈 캐시 첫 계산에는 보여줄 값이 없다. 계약 2절도 이 경우를 INTERNAL_ERROR로 적었다. 값이 있는 경로는 정확히 지켜진다.
- 계약 10절이 「요약 실패」 화면을 정의해 뒀다(시즌 카드 숨김, 앱 셸 유지).
- 다만 보고서의 「첫 tick 이후 드문 경우」는 조금 좁다. 새 시즌이 자동 생성될 때마다 그 시즌 키가 비므로 다음 tick까지 같은 경로가 열린다. 그리고 D156 기준으로 시즌·모집은 랭킹 캐시와 무관하다.
- 요약의 다른 쿼리도 같은 DB를 쓰므로 DB 장애에서는 어차피 함께 실패한다. 계산 로직 자체의 오류일 때만 차이가 나는데, 그런 입력을 현재 경로에서 찾지 못했다.

제안: 이번 슬라이스의 차단 사유는 아니다. 고친다면 `topRankers`에서 잡아 로그 후 `top_rankers: null`. 단 null은 현재 「시즌 없음」 의미라 `dashboard.ts:81` 주석과 계약 수정이 필요하므로 architect 판단으로 넘긴다.

### C. me.rank 첫 주기까지 null, SeasonCloser 바깥 timeout 5분: 둘 다 결함 아님

- `me.rank`: 계약 7-3과 D148이 읽기 전용을 정했고 8-2가 `rank null`을 정의했다. 지연은 주기 작업이 켜져 있으면 최대 5분 정도다. `elo`는 ratings 값으로 나온다. `RANKING_JOBS_ENABLED=false`면 누가 그 게임 랭킹을 조회할 때까지 null이고, `.env.example`이 이 모드의 제약을 적어 두었다.
- 5분 timeout: 바깥 트랜잭션은 try lock만 쥐고 시즌별 `closeOne`은 별도 트랜잭션이다. 만료되면 잠금이 풀려 다른 인스턴스가 들어올 수 있지만 시즌 행 잠금 후 재확인(`season-closer.ts:66-70`)과 조건부 update로 안전하다. `runOnce` 거부는 `tick`이 잡고 갱신은 계속된다. `closeOne` 상한 60초 기준 시즌이 많이 밀려야 도달한다.
- 참고: 바깥 트랜잭션이 연결 1개를 쥔 채 `closeOne`과 캐시 계산이 연결을 더 쓴다. `connection_limit=1`이면 각 시도가 대기 시간 초과로 실패할 것이다. `.env.example`에 그 설정은 없고 Prisma 기본 풀에서는 문제없다. 추론이며 실행하지 않았다.

## 중점 검증

### 6-5 대조(코드 경로 추적. 잠금 대기는 실제 DB로 실행하지 않음)

| # | 상황 | 경로 | 판단 |
| --- | --- | --- | --- |
| 1 | 종료 → 승인 | `resolveForApproval`이 S+1 → 7c 통과 → `loadPreviousRatings`가 S 행 → 리셋 | 일치 |
| 2 | 승인 → 종료 | 같은 경로로 S 행을 안 바꿈. 이후 종료 standings 동일 | 일치, 테스트 있음 |
| 3 | T 넘긴 커밋 | 승인 상한 15초 < 유예 60초. 어긋나도 `FOR NO KEY UPDATE` 뒤 ratings를 읽음(`season-closer.ts:66-72`), READ COMMITTED | 코드 일치, 대기 동작 미실행 |
| 4 | 시계 어긋남 | `rating-locks.ts:42-49` closed_at → INTERNAL_ERROR, 전체 롤백 | 일치, 테스트 있음 |
| 5 | 첫 승인 2건 동시 | 사용자 advisory 직렬화, `existing` 재조회, skipDuplicates | 코드 일치, 동시 실행은 미실행 |
| 6 | 종료 동시 | try lock + 시즌 행 잠금 후 closed_at 재확인 | 코드 일치 |
| 7 | 중간 실패 | `closeOne` 전체 롤백 | 일치, 테스트 있음 |
| 8 | 재실행 | closed_at 제외, 유일 키 `(season, game, user)`·`(user, badge, season)` + skipDuplicates | 일치 |
| 9 | 여러 시즌 | `selectSeasonsToClose` 정렬, 실패 격리 | 일치 |
| 10 | 공백 후 승인 | 자동 시즌 + 최근 행 1회 리셋 | 일치 |
| 11 | 경계 pending | 승인 시각 기준 S+1 | 일치 |

### 불변식

- **종료 작업이 ratings를 쓰지 않음:** 전수 검색 결과 `rating.createMany`·`rating.update`는 `scrim-results.service.ts:211,263` 승인 경로뿐. `rating.create`·`upsert`는 없고 seed에도 없다.
- **소프트 리셋 정확히 1회:** 행 생성 경로가 승인 하나이고 사용자 잠금 + 유일 키 + skipDuplicates. 읽기(`rating-inputs`)는 쓰지 않는다.
- **standings 오염 없음:** 7c 잠금이 커밋까지 유지되고, 닫힌 뒤 S에 쓰는 경로가 없다.
- **`computeSeasonStandings` 출력:** 필드 5개로 잘려 `createMany`에 불필요한 필드가 들어가지 않는다. FakePrisma가 못 잡는 종류라 직접 확인했다.

### 승인 트랜잭션과 교착(S3 대조)

`scrim-results.service.ts:192-229` 순서는 7a → 8 → 4 → 7b → 7c → 9로 계약 6-2와 같다. S3 잠금 순서는 그대로고 7c만 뒤에 붙었다. isolation은 READ COMMITTED로 유지(`:310`)되어 대기 후 재평가된 `closed_at`과 잠금 뒤 커밋 값을 읽는다.

교착 후보를 차례로 봤고 순환을 찾지 못했다.

- 승인 ↔ 종료: 종료는 내전·사용자 잠금을 잡지 않는다. 승인이 시즌 행을 기다려도 종료가 승인을 기다리는 간선이 없다.
- 승인 ↔ 승인: FOR SHARE끼리 호환, advisory 순서 동일.
- `carried_from_season_id` FK: 새 행이 S에 FOR KEY SHARE를 건다. FOR NO KEY UPDATE와 충돌하지 않는다. `closed_at` 갱신은 키 컬럼을 건드리지 않는다.
- 종료의 FK 잠금: users·games·badges에 KEY SHARE뿐이다. 승인은 이들을 키 변경으로 갱신하지 않는다.

이는 PostgreSQL 잠금 규칙 기반 판단이며 `season-close.db.e2e.spec.ts`로 실행 확인이 필요하다.

### 캐시

- payload는 공용 entries뿐이고 `me`는 응답 때 찾는다. 저장 경로는 `ranking-calculator.service.ts:96` 하나, 저장 키는 `rankings:*`뿐이다. 요약 응답 전체 캐시는 없다.
- 실패 시 payload·`computed_at` 유지, `last_failed_at` 기록, `stale: true`. 재현 시 `{refreshed:0, failed:5}`에 응답 200.
- 조건부 쓰기 SQL은 계약 그대로(`ranking-cache.store.ts:69`). **PostgreSQL 실행은 못 했다.** 메모리 구현은 같은 규칙을 흉내 낼 뿐이다.
- 첫 계산 실패 경로는 `markFailed`가 행 없음으로 아무것도 안 하며 계약과 같다.

### tier 불량 행

`ranking-calculator.service.ts:136-137`이 `RankValue.safeParse`로 먼저 거른다. 불량 11종(모르는 tier, 디비전 V, GOLD+null, MASTER+I, lp −1, lp 1.5, UNRANKED+I, UNRANKED, `constructor`, division `constructor`, wins −1)을 정상 1행과 넣어 요청하면 200, total 1, 정상 행 score 1590. 필터를 뺀 변형(M1)은 테스트가 잡는다.

### 교차 대조

| 계약 | 코드 | 결과 |
| --- | --- | --- |
| GET /rankings/tier, JWT | `rankings.controller.ts:21`, `ApiPath.rankingsTier` | 일치 |
| GET /rankings/elo, JWT | `rankings.controller.ts:30`, `ApiPath.rankingsElo` | 일치 |
| GET /dashboard/summary, JWT | `dashboard.controller.ts:14`, `ApiPath.dashboardSummary` | 일치 |
| GET /users/:id/profile 확장 | `profile.service.ts`, `profile-scrim.service.ts` | 일치, 읽기 전용 |
| 응답 parse | 세 응답 모두 shared `.parse` | 일치 |
| 오류 코드 추가 없음 | 기존 코드만 사용 | 일치 |

| 13절 env | `.env.example` | `config/env.ts` | `AppConfig` |
| --- | --- | --- | --- |
| SEASON_SOFT_RESET_RATIO 0.5 | 있음 | 0–1, 기본 상수 | `seasonSoftResetRatio` |
| RANKING_ELO_MIN_GAMES 5 | 있음 | `posInt` | `ranking.eloMinGames` |
| RANKING_JOBS_ENABLED true | 있음 | `strictBool(true)` | `ranking.jobsEnabled` |

구현자 「계약과 다른 점」 3–8번은 모두 동작 영향이 없어 수용 가능하다. 6번은 SQL 컬럼명(`is_primary`, `verified`, `game_id`, `captured_at`, `created_at`, `queue`)을 schema와 대조했다. 실행은 안 됐다.

## 뮤테이션

| 변형 | 결과 |
| --- | --- |
| M1 tier 필터 제거 | 검출 1 |
| M2 `deleteExcept` 제거 | 검출 1 |
| M3 종료 `FOR UPDATE` | 검출 16 |
| M4 승인 `FOR UPDATE` | 검출 28 |
| M5 `earned_at` 현재 시각 | 검출 2 |
| M6 tick 순서 교체 | 검출 1 |
| M7 7c를 createMany 뒤로 | **생존**, 결함 2 |
| M8 닫힌 시즌도 갱신 | 검출 1 |
| M9 `lt` → `lte` | 생존, 동등 변형(`pickPreviousRating`이 다시 `<`로 거른다) |
| M10 `closeOne` 유예 재확인 제거 | 검출 1 |
| M11 `eloEntryOf`가 계산 유발 | 검출 1 |

## 미실행

| 항목 | 이유 |
| --- | --- |
| DB e2e 42건(S4 신규 9건 포함) | PostgreSQL·Docker 없음. `TEST_DATABASE_URL` 미설정으로 skip |
| `prisma migrate deploy` 실행, 결함 1의 실제 오류 메시지 | 같음 |
| 실제 SQL 전부: `ON CONFLICT … WHERE`, `DISTINCT ON`, `FOR SHARE`, `FOR NO KEY UPDATE`, FK 비대기, `$queryRaw` 날짜 변환, `user: {}` 빈 관계 필터 | 같음. FakePrisma는 SQL을 해석하지 않는다 |
| 시나리오 3·5·6의 실제 동시 실행, 교착 없음 | 같음 |
| 저장소 `vitest.config.ts`, `pnpm -r test`, Node 22 실행, `node dist/main.js` 실제 기동 | 이 PC는 Node 20.11. 임시 설정 결과다 |
| apps/web 대조, web typecheck·test·build | 지시로 제외 |

embedded-postgres를 스크래치패드에 npm으로 설치해 DB e2e를 돌리려 했으나 권한 분류기가 거부했다. 다른 방법으로 PostgreSQL을 설치하지 않았다. 이 PC의 `node_modules`에도 쓸 수 있는 PostgreSQL 구현이 없다.

## 재검증 조건

1. 결함 1 수정 후 `migrate diff`와 `migrate deploy`.
2. PostgreSQL이 있는 환경에서 DB e2e 42건, 특히 `season-close`·`ranking-cache`. 환경이 없으면 사용자가 embedded-postgres 설치를 허용하거나 Docker를 제공해야 한다.

## 이전 결함 재확인

S4 backend 첫 검증이라 해당 없음.
