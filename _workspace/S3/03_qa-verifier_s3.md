# QA: s3 (교차 대조·명세 대조) — 판정: fail

작성: qa-verifier, 2026-10-30
대상: S3 전체(shared `scrims.ts`·`scrim-results.ts`·`ratings.ts`·`seasons.ts`·`paths.ts`·`errors.ts`·`profile.ts`, packages/core `rating.ts`·`balance.ts`·`season.ts`·`config.ts`, apps/api `modules/ratings/**`·`modules/scrims/{scrim-teams,scrim-results,scrim-views,scrims}.service.ts`·`scrim-result-json.ts`·`scrims.controller.ts`·`profile/profile-scrim.service.ts`·`common/scrim-tx.ts`·`config/env.ts`, Prisma 스키마·마이그레이션 `20261030120000_s3`, apps/web 내전 상세·카드·프로필 내전 블록·훅·API·목)
기준: 계약 `_workspace/01_architect_contract.md`(D103–D135), 슬라이스 `_workspace/00_input/slice.md`, 명세 2·5·6·7-1·7-2·8장, qa-boundary-check 2절 「교차 대조」「명세 대조」(+ 도메인 무결성).
모듈 보고서: `_workspace/03_qa-verifier_{core,backend,web}.md`(모두 pass). 구현 보고서: `02_domain-logic-dev_report.md`, `02_backend-dev_s3.md`, `02_frontend-dev_s3.md`.
사용 가능 도구: Read, Grep, Glob, Bash(Git Bash), Write. 브라우저·스크린샷 도구는 쓰지 않았다. 코드 수정 없음. 지시에 따라 build는 실행하지 않았다.

판정 근거: blocker 0, **major 1(기계 검사 `pnpm -r test` 실패 — core 성능 테스트, 제품 코드 결함 아님)**, minor 4. 결함 1만 고치면 pass 조건이다. 연결부·전이·레이팅 무결성에서는 계약 위반을 찾지 못했다.

## 실행한 명령과 결과 (2026-10-30 15:2x–15:4x)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·api·web 4개 Done, EXIT 0 |
| `corepack pnpm -r test` (1회차, typecheck 직후) | shared **71** passed. core **237 passed / 1 failed** — `balance.test.ts:191` 「16명 → 6435가지, 200ms 미만」 `expected 210.36 to be less than 200`. pnpm이 첫 실패에서 멈춰 api·web은 실행 안 됨. EXIT 1 |
| `corepack pnpm -r test` (2회차) | 같은 테스트 실패 `244.90 ms`. EXIT 1 |
| `corepack pnpm --filter core test` | 같은 테스트 실패 `264.96 ms`(237/238). EXIT 1 |
| `corepack pnpm --filter api test` | Test Files 25 passed / 5 skipped, **Tests 376 passed / 33 skipped**(DB e2e 5파일). EXIT 0 |
| `corepack pnpm --filter web test` | Test Files 15 passed, **Tests 159 passed**. EXIT 0 |
| `npx vitest run src/balance.test.ts -t "16명"`(core, 2회) / `npx vitest run src/balance.test.ts` | 통과(파일 단독 47–49ms, 33/33). 다른 테스트 파일과 병렬일 때만 200ms를 넘는다 |
| node로 dist `balanceTeams` 16명 5회(`scratchpad\perf16.cjs`) | 38.5 / 37.3 / 26.5 / 25.3 / 23.0 ms — 함수 자체는 빠르다 |
| `prisma validate`(DATABASE_URL 더미) | `The schema at apps\api\prisma\schema.prisma is valid` (DATABASE_URL 없으면 P1012 — 환경 변수 문제일 뿐) |
| `prisma migrate diff --from-schema-datamodel <git show HEAD:apps/api/prisma/schema.prisma> --to-schema-datamodel prisma/schema.prisma --script` | `ALTER TABLE "rating_history" ADD COLUMN "k_factor" INTEGER NOT NULL;` + `CREATE INDEX "rating_history_user_id_game_id_season_id_created_at_idx" …` 2문장 = `migrations/20261030120000_s3/migration.sql` 자동 부분과 **같다**. 수동 블록 `CREATE UNIQUE INDEX "scrim_results_one_active_per_scrim" … WHERE "status" IN ('pending','approved')` 1문장. `DROP INDEX` 문 없음(주석만) |
| core dist 재현(node, 아래 결함 3) | 8명 제출·1·2위 노쇼 → 5위 사용자: 프로필 `isPlacementWin(5,8)=false`(LOSS), 반영 rank 3/6 `outcome win, delta +3` |
| DB e2e(`test/db/scrim-results.db.e2e.spec.ts` 6건 외) | **미실행**(PostgreSQL·Docker 없음) |

## 결함

blocker 0, major 1, minor 4.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | major | packages/core/src/balance.test.ts:191-199 (`expect(ms).toBeLessThan(200)`) | 슬라이스 기계 검사 `corepack pnpm -r test`가 EXIT 0 | 벽시계 시간 단언이 vitest 병렬 실행 부하에서 3/3회 실패(210·245·265ms). 함수 단독은 23–49ms라 **제품 코드 결함이 아니라 테스트 불안정**이지만, pnpm이 core에서 멈춰 api·web 테스트가 `-r` 실행에서 아예 돌지 않는다. core QA 때는 통과(부하 차이). 계약 7-4 테스트 목록에 「16명 성능(< 200ms)」이 있어 테스트 자체는 필요 | `corepack pnpm --filter core test` 또는 `corepack pnpm -r test`. 처리 예: 워밍업 1회 후 측정, 상한 완화(예: 1초), 또는 해당 테스트만 `sequential`/별도 파일. 계약 수치를 바꾸면 architect 확인 |
| 2 | minor | apps/web/src/lib/api/mock/scrims.ts:1228-1230 ↔ apps/api/src/modules/scrims/scrim-results.service.ts:75-84 | 목과 API가 같은 `details[].path`(계약 5-4 2번) | 결과 모양 불일치 시 API는 **보낸 잘못된 필드**(팀 게임에 placements → `placements`, 개인 순위에 winner_team → `winner_team`)를, 목은 **기대 필드**(팀 게임 → `winner_team`, 개인 순위 → `placements`)를 path로 준다. 화면은 둘 다 행을 못 찾아 패널 하단에 표시하므로 지금 보이는 차이는 없다 | 목에서 롤 내전에 `{placements:[…]}` 제출 → path `winner_team`, 실제 API → path `placements`. 계약 5-4 2번 문구를 하나로 정하고 목을 맞출 것 |
| 3 | minor | apps/api/src/modules/profile/profile-scrim.service.ts:85-88, apps/web/src/lib/api/mock/ratings.ts:467 (계약 4-1 ProfileScrim `recent`) ↔ scrim-views.service.ts resultView·승인 wins/losses | 같은 내전의 승패 표시가 프로필 최근 내전 칩·내전 레이팅 카드(wins/losses)·상세 ELO 표에서 같다 | 계약 4-1이 프로필 recent만 「제출 순위 전체 인원 기준」 `isPlacementWin(placement, placements.length)`로 정해, 제출 뒤 노쇼가 빠져 다시 매긴 경우 프로필은 **LOSS**, 레이팅 반영(D105)·상세 표·ratings.wins는 **win**, delta는 **+3**이 된다. 계약대로 구현한 결과라 계약 수준의 불일치(데이터 오염 없음, 표시만) | 롤체 8명 순위 제출 → 1·2위 노쇼 표시 → 승인 → 5위 사용자 프로필: 칩 「LOSS」 + 「+3」, 카드 승수 +1. node 재현은 위 표. 개인 순위는 반영 순위(이력 있는 사용자 기준 재매김)로 맞추고, 이력이 없을 때만 제출 순위를 쓰는 식을 architect가 정할 것 |
| 4 | minor | apps/api/test/scrim-results.e2e.spec.ts:648-696 | D131(새 참가 확정으로 joined 명단이 바뀌면 팀 초기화)을 API 테스트로 확인 | API e2e는 참가 확정자 취소·정원 확대 승격만 다룬다. 새 참가 경로 코드(scrims.service.ts:369-372 `resetTeams`)는 있고 목 테스트(mock/scrim-results.test.ts:133)만 이 경로를 확인한다 | 「full → 팀 저장 → 승격 없는 정원 확대(recruiting) → 새 참가 → 팀 null」 API e2e 1건 추가 권고 |
| 5 | minor | _workspace/01_architect_contract.md 본문 | D128–D135를 본문 절에도 반영(변경 이력 2행이 「반영」이라고 적음) | 결정 표에만 있고 본문은 옛 문구: 5-1(151행, 「참가 취소·정원 수정」만 — D131 새 참가 누락), 4-1(110행, 「created_at DESC, 같으면 id DESC」·`DISTINCT ON` — D131), 5-5 7단계(193행, 시즌 advisory를 now 판정 뒤에 잡는 순서 — D128과 충돌), 2절(D135 INTERNAL_ERROR 없음), 7-4 5·6번(D134 사전순·evaluateTeams 순서 없음), 9절 최근 내전(400행, 게임 이름 없음 — D133), 10절(skill 입력 위치 = `ratings/rating-inputs.service.ts`, 프로필 = `profile-scrim.service.ts`). 구현 영향 없음 | 계약 파일 열람 |

### 참고(결함 아님)

- 목 승인은 개인 순위 placements가 null이면 skip으로 확정한다(mock/ratings.ts:297-302). API는 D130대로 INTERNAL_ERROR 롤백. 목은 항상 올바른 모양으로 쓰므로 실제 차이는 나지 않는다.
- 목의 노쇼 표시 기한·`can_mark_no_show`는 `NO_SHOW_MARK_WINDOW_DAYS_DEFAULT`를 쓴다(목 전용, D101 허용 범위).

## 교차 대조 표

### 1. 엔드포인트 8개 + 확장 응답 3개 (계약 4절 ↔ ApiPath ↔ 컨트롤러 ↔ shared ↔ 웹 API·훅 ↔ 목)

| # | 계약 | ApiPath | 컨트롤러(파일:줄) / 상태 | 요청 parse | 응답 parse | 웹 API → 훅 | 목(mock/scrims.ts) | 일치 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POST /scrims/:id/balance | scrimBalance | scrims.controller.ts `balance` `@HttpCode(200)` | `IdParam` + `preprocess(v ?? {}, BalanceScrimRequest)` | `BalanceScrimResponse.parse`(scrim-teams.service.ts:101) | `balanceScrim`(본문 `{}`) → `useBalanceScrim`(캐시 저장 안 함) | :1170 | O |
| 2 | PUT /scrims/:id/teams | scrimTeams | `saveTeams` 200 | `SaveScrimTeamsRequest` | ScrimDetail(views.detail) | `saveScrimTeams` → `useSaveScrimTeams` → applyScrimDetail | :1192 | O |
| 3 | POST /scrims/:id/result | scrimResult | `submitResult` 200 | `SubmitScrimResultRequest` | ScrimDetail | `submitScrimResult` → `useSubmitScrimResult` | :1218(path 차이 결함 2) | O |
| 4 | DELETE /scrims/:id/result | scrimResult | `withdrawResult` 200 | `IdParam` | ScrimDetail | `withdrawScrimResult` → `useWithdrawScrimResult` | :1263 | O |
| 5 | POST /scrims/:id/result/approve | scrimResultApprove | `approveResult` `RolesGuard`+`@Roles('admin')` 200 | `ApproveScrimResultRequest` | ScrimDetail | `approveScrimResult` → `useApproveScrimResult`(applyScrimResultDetail + `ratingKeys.seasons` 무효화) | :1112(403 먼저) | O |
| 6 | POST /scrims/:id/result/reject | scrimResultReject | `rejectResult` 같은 가드 200 | `RejectScrimResultRequest` | ScrimDetail | `rejectScrimResult` → `useRejectScrimResult` | :1112 | O |
| 7 | GET /seasons | seasons | ratings.controller.ts `listSeasons` | - | `ListSeasonsResponse.parse`(seasons.service.ts:44), next_cursor null | `listSeasons` → `useSeasons` | :1095 | O |
| 8 | GET /users/:id/rating-history | userRatingHistory | `ratingHistory` | `GetUserRatingHistoryParams` + `GetUserRatingHistoryQuery` | `GetUserRatingHistoryResponse.parse`(rating-history.service.ts:133, :149) | `getUserRatingHistory`(season 생략 가능) → `useUserRatingHistory` | :1098 | O |
| 9 | GET /scrims(확장) | scrims | 기존 | 그대로 | `ScrimSummary.parse` + result_status·outcome(views.ts:248-259) | `useScrims` | summary | O |
| 10 | GET /scrims/:id(확장) | scrim | 기존 | 그대로 | `ScrimDetail.parse` players skill·is_new·position_preference, viewer can_* 5개, balance, result | `useScrim`(playing 20초 재조회) | detail :852 | O |
| 11 | GET /users/:id/profile(확장) | userProfile | 기존 | 그대로 | `ProfileScrim.parse`(profile-scrim.service.ts:104) | `useUserProfile` | backend.ts 프로필 scrim | O |

- `RatingsModule`이 app.module.ts:34에 등록. 경로 충돌 없음(`/users/:id/profile` ↔ `/users/:id/rating-history`).
- 8개 모두 웹에서 쓴다(봇·관리 전용 없음). 계약 밖 엔드포인트 없음. 응답은 모두 `apiClient.request(path, Schema)`로 shared zod parse. snake_case가 화면까지 그대로 온다.

### 2. 오류 코드 S3 7개

| code | shared(HTTP) | API 기본 문구(app-error.ts) | API throw | 웹 문구(errors.ts) | 목 |
| --- | --- | --- | --- | --- | --- |
| SCRIM_TEAMS_NOT_EDITABLE | 409 | :43 | scrim-teams.service.ts:35(밸런스·팀 저장 공용) | :54 | :1175, :1196 |
| SCRIM_BALANCE_UNAVAILABLE | 409 | :44 | :64(auto_balance), :69(인원), :83(RangeError) | :55 | :1178, :1186 |
| SCRIM_RESULT_NOT_ALLOWED | 409 | :45 | scrim-results.service.ts:70 | :56 | :1224 |
| SCRIM_RESULT_EXISTS | 409 | :46 | :71, :118(P2002) | :57 | :1225 |
| SCRIM_TEAMS_REQUIRED | 409 | :47 | :93 | :58 | :1235 |
| SCRIM_RESULT_NOT_PENDING | 409 | :48 | :131, :134, :142, :286, :309 | :59 | :1126, :1266 |
| SCRIM_RESULT_SELF_REVIEW | 403 | :49 | :143 | :60 | :1127 |

- shared `ErrorCode` 43개 = `ERROR_HTTP_STATUS`(Record) = API `DEFAULT_ERROR_MESSAGE`(Record<ErrorCode>) = 웹 `ERROR_MESSAGES`(Record<AppErrorCode>). 누락 시 typecheck 실패 — 통과.
- 판정 순서(API ↔ 목): 승인·반려 = 역할 → id → 본문 → NOT_FOUND → NOT_PENDING(없음·id 불일치) → SELF_REVIEW. 제출 = 본문 → NOT_FOUND → FORBIDDEN → NOT_ALLOWED → EXISTS → 모양 → TEAMS_REQUIRED/순위 사용자. 제출 취소 = NOT_FOUND → NOT_PENDING → FORBIDDEN. 양쪽 같다.

### 3. 내전 상태 전이 추적 (API ↔ 목)

| 경로 | API | 목 | 일치 |
| --- | --- | --- | --- |
| recruiting/full → (팀 구성) | 팀 구성 가능 = has_teams && status ∈ {full, playing} && 활성 결과 없음(scrim-teams.service.ts:33-37). 밸런스·팀 저장·`can_edit_teams`(views.ts) 같은 조건. 상태 전이 없음 | `teamsLocked`(:1167) 같은 조건 | O |
| → playing | S2 start·자동 마감(canTransition). S3 변경 없음 | 같음 | O |
| playing → 결과 제출(pending insert) | status playing·활성 없음·팀 게임은 두 팀 joined 배정자 ≥ 1 → insert(created_at = 서버 now), 내전 playing 유지 | :1224-1250 | O |
| pending → 반려(rejected) | `assertResultTransition` + `updateMany(id, status=pending)` 1행 검사, 내전 playing, 활성 결과가 없어져 팀 수정·재제출 재개 | :1130, playing 유지 | O |
| rejected → 재제출 | 새 pending 행. 최근 결과 = created_at DESC → 활성 먼저 → id DESC(views.ts:100-106, 목 ratings.ts:355-361) | 같음 | O |
| pending → 승인(approved) + playing → finished | 조건부 update 1행(:282-286) → `assertScrimTransition(playing, finished)`(:289) | :1133-1147 | O |
| pending → 제출 취소(delete) | 제출자·방장, `deleteMany(id, pending)` 0행 → NOT_PENDING. approved·rejected 행은 지우지 않음 | :1263-1272 | O |
| 팀 초기화(5-1, D131) | 새 참가 확정(:369-372, 재참가 행도 team·position null :362), 확정자 취소(:396-399, 승격 포함), 정원 확대 승격(:300). 대기 등록·대기자 취소·노쇼 표시/정정은 유지 | joined 집합 문자열 비교 후 초기화(:1356, :1372, :1439) — 동치 | O(API 테스트 결함 4) |
| 승인 뒤 | 재제출 NOT_ALLOWED(finished), 팀 NOT_EDITABLE, 취소 NOT_PENDING(D123). 노쇼 표시는 허용되고 레이팅 불변 | 같음 | O |

- 상태 갱신 코드 전수: scrims status 갱신은 모두 `assertScrimTransition` 뒤, 결과 status는 `canTransition(SCRIM_RESULT_STATUS_TRANSITIONS)` 뒤. 맵 밖 전이 없음, S3 범위 미구현 전이 없음(`playing → finished` 처음 사용).
- 잠금: 쓰기 경로 12개 + 자동 마감 건별 모두 `scrimWriteTx`(timeout 15초·maxWait 5초) 안 첫 문장이 `lockOrNotFound`. 밸런스는 잠금·쓰기 없음. `$transaction` 직접 호출은 scrims 모듈에서 자동 마감 바깥 루프뿐.

### 4. 레이팅 반영 무결성 (scrim-results.service.ts `approve`)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| core 호출만 | `selectRatedParticipants` → `computeTeamEloUpdates`/`computePlacementEloUpdates`. eloAfter·kFactor·outcome을 그대로 저장, api에 공식 복사본 없음. 목도 core import(mock/ratings.ts:297-326) | :177-240 |
| k_factor 저장 | `kFactor: u.kFactor`(:263), 스키마 `k_factor INTEGER NOT NULL`, 상세 `k_factor: h.kFactor`, 웹 「K {k_factor}」(D132) | O |
| 이중 승인 방지 | ① 내전 행 FOR UPDATE ② pending 재조회·result_id 일치 ③ 결과 `updateMany(id, status=pending)` count ≠ 1 → NOT_PENDING 롤백 ④ `rating_history (scrim_id, user_id)` 유일 P2002 → INTERNAL_ERROR 롤백 ⑤ ratings `(user, game, season)` 유일 + skipDuplicates. FakePrisma 동시 승인 e2e 통과, 실제 DB e2e 미실행 | O |
| rated=false | 6–11단계 건너뜀 → 시즌·잠금·ratings·이력 없음, approved·finished, `not_rated`(D122) | :184, :275-278 |
| 노쇼·미배정 | 승인 시점 status joined && team(팀) / joined && 순위 포함(개인), 한 팀 0명·개인 M < 2 → skip → approved·finished·`skipped` | core selectRatedParticipants |
| 개인 순위 placements 깨짐 | INTERNAL_ERROR 롤백, pending 유지(D130) | :171-176 |
| 시즌 자동 생성 | 7a `lockIfMayCreate(지금, 15초)` → 사용자 잠금 → now → 7b `resolveForApproval(now, holdsLock)` → 없으면 `planAutoSeason({seasons: 전체, at: now, lengthMonths: env})` insert. 잠금 없이 생성이 필요하면 INTERNAL_ERROR(트랜잭션 timeout이 margin과 같아 정상 경로에서는 안 생김: 지금 ≥ 트랜잭션 시작, now < 시작 + 15초) | seasons.service.ts:56-79 |
| now 시점(D128) | 레이팅 반영 시 사용자 advisory 잠금 직후(:193), 없으면 내전 잠금·검사 직후(:277). approved_at = rating_history.created_at = 시즌 판정 = 응답 now | O |
| 잠금 순서(D117) | 내전 행 → season-auto-create(조건부) → `rating:{game}` 2-인자 advisory(user_id 오름차순, 중복 제거) | rating-locks.ts |
| K 판정 경기 수(D106) | `countRatedGames`(user, game, 시즌 무관), 사용자 잠금 아래·반영 전 | rating-inputs.service.ts:27-41, results :214 |
| 시드(D103) | 대표 계정 → `RANKED_QUEUE_BY_GAME` 큐 최신 스냅샷 → `tierSeedRating`, 없으면 1000. 시즌 첫 반영 때만 행 생성 | rating-seed.ts |
| 한 트랜잭션 | 결과·내전·ratings·rating_history·seasons 쓰기가 모두 같은 `scrimWriteTx`(READ COMMITTED) 안 | O |

### 5. 라우트 ↔ 링크

| 라우트 | app 파일 | 링크 생성(S3 추가분) |
| --- | --- | --- |
| /scrims/[id] | app/(main)/scrims/[id]/page.tsx | 프로필 최근 내전 제목 `routes.scrim(r.scrim_id)`(profile-scrim.tsx:255), 카드(scrim-card.tsx:94, :147) |
| /members/[id] | app/(main)/members/[id]/page.tsx | 결과 순위표·ELO 표 닉네임 `routes.member(id)`(scrim-result.tsx:334, :391), 상세 참가자(scrim-detail.tsx:441) |
| /scrims | app/(main)/scrims/page.tsx | 상세 「← 내전 목록」 `routes.scrims()` |

S3 컴포넌트에 문자열 하드코딩 경로 없음. 새 라우트 없음.

### 6. Prisma 스키마·마이그레이션

| 항목 | 결과 |
| --- | --- |
| migrate diff(HEAD 스키마 → 현재) = migration.sql 자동 부분 | 같다(2문장) |
| 수동 부분 고유 인덱스 `scrim_results_one_active_per_scrim` | 있음. FakePrisma도 같은 제약(fake-prisma.ts) |
| DROP INDEX | 없음. S1 `game_accounts_one_primary_per_user_game` 유지 |
| `prisma validate` | valid |
| 새 인덱스 사용 | 그래프 `(user_id, game_id, season_id, created_at)`, 경기 수 `(user_id, game_id)` 접두 |
| 적용 | 미실행(DB 없음). rating_history는 S3 전 쓰기 코드가 없어 NOT NULL 추가 가능(주석과 같음) |

### 7. env 4개

`SCRIM_ELO_K_BASE`·`K_NEW`·`NEW_PLAYER_GAMES`(posInt), `SEASON_AUTO_LENGTH_MONTHS`(1–24) — env.ts:116-121 = `.env.example`:90-94 = shared 기본값 상수 = `config.rating`·`seasonAutoLengthMonths`. 화면 코드(mock 제외)에서 `SCRIM_ELO_*`·`SEASON_AUTO_LENGTH*` import 0건, K는 `rating_policy`·`k_factor`로만 표시.

## 모듈 QA 결함 재확인

| 출처 | 결함 | 상태 |
| --- | --- | --- |
| backend 1 | 승인 now를 잠금 대기 전에 정함 | **해소.** D128. results:186-195(사용자 잠금 직후), :275-278(반영 없음). e2e 「QA minor 1–3 반영」 (1) 2건 통과 |
| backend 2 | 트랜잭션 timeout 미지정 | **해소.** D129. `common/scrim-tx.ts` 15초·5초, S2 6경로·자동 마감 건별·S3 5경로 모두 `scrimWriteTx`, 승인 READ COMMITTED. e2e (2) 통과 |
| backend 3 | 깨진 placements → skipped 확정 | **해소.** D130. results:171-176 INTERNAL_ERROR. e2e (3) 통과 |
| backend 4 | 프로필 최근 내전 전체 조회 | 열림(리더 결정으로 유지). profile-scrim.service.ts:48-60 그대로 |
| core 1 | 포지션 6개 이상 성능 | 계약 전제로 처리(D134 「포지션 ≤ 5」). 코드 변경 없음, 현재 카탈로그로는 도달 불가 |
| core 2 | 수동 시즌 월말 종료 시 날짜 밀림 | 열림(S4·S6 시즌 관리 때). 계약 6절 문구 그대로 |
| core 3 | config.ts 머리 주석 낡음 | **해소.** config.ts:3-7, :19-21 갱신 |
| web 1 | 목 can_balance `positionsFit` | **해소.** mock/scrims.ts:912 = API 식 |
| web 2 | VALIDATION details 패널 하단 | **해소.** `splitValidationDetails` + `RowErrors`(scrim-teams.tsx:251, :511 / scrim-result.tsx:150, :187) |
| web 3 | /games 실패 시 Skeleton 고정 | **해소.** profile-scrim.tsx:130 `games.isError` → ErrorState |
| web 4 | 승인 후 seasons 캐시 | **해소.** hooks/scrims.ts 승인 onSuccess `ratingKeys.seasons` 무효화 |
| web 5 | 순위 draft에 노쇼·이탈자 남음 | **해소.** scrim-result.tsx:147 `pruneDraft` |
| web 6 | 개인 순위 2명 미만에서 방장에게 waiting 문구 | **해소.** scrim-results.ts:174 `too_few` |
| web 7 | 새 참가 팀 초기화 목 테스트 | **해소.** mock/scrim-results.test.ts:133. API 쪽 테스트는 결함 4 |
| web 8 | setQueriesData 범위 | **해소.** game-accounts.ts:198 predicate `queryKey[2] === 'profile'` |
| D128–D135 | 구현 반영 | D128·D129·D130 API, D131 API·목(새 참가·「활성 먼저」·findMany 1회), D132 결과 표 NEW 없음, D133 최근 내전 `GAME_META[game].short`(profile-scrim.tsx:262)·노쇼 응답 프로필 무효화, D134 계약 전제, D135 rating-history.service.ts:122 — 모두 코드 반영. 계약 본문 동기화는 결함 5 |

## 명세 대조 (문서 2·5·6·7-1·7-2·8장)

| 장 | 명세 항목 | 구현 | 차이(계약 D번호) |
| --- | --- | --- | --- |
| 2장 | 팀 자동 밸런스(P0): 티어와 내전 레이팅으로 두 팀 전력 배정 | 구현됨 | 상위 3안은 저장 안 하고 선택·직접 수정을 `PUT /teams`로 저장(D109), 정원 2–16·홀수 일반화(D108), auto_balance 꺼도 직접 구성 가능 |
| 2장 | 결과 입력·승인(P0): **팀장**이 결과 입력, 운영진 승인 후 레이팅 반영 | 구현됨 | 입력 = 방장 또는 운영진(대리 입력, D111), 자기 제출 승인·반려 금지(D114), 반려(사유 2–200자)·재입력, 제출 취소(D112), 승인 결과 수정·취소 없음(D123), rated=false 내전은 레이팅 없이 확정(D122) |
| 2장 | 프로필 「내전 승률」 | 구현됨 | 현재 시즌 게임별 카드, 개인 순위 게임은 상위 절반을 승(D105) |
| 5장 | scrim_results(scrim_id, winner_team, submitted_by, approved_by, approved_at) | 있음 | status·placements·rejected_by/at·reject_reason(S0), 활성 결과 1개 부분 고유 인덱스(D113) |
| 5장 | ratings(user_id, game_id, season_id, elo, wins, losses) | 있음 | 행 = 시즌 첫 반영 때 티어 시드로 생성(D103), wins/losses는 rated 반영만 |
| 5장 | rating_history(user_id, scrim_id, elo_before, elo_after) | 있음 | + game_id·season_id·scrim_result_id(S0), **k_factor**(D125), 인덱스 `(user, game, season, created_at)` |
| 5장 | seasons(name, starts_at, ends_at) | 있음 | 승인 시 시즌 없으면 자동 생성(KST 달 1일, 3개월, 「시즌 N」, D116) |
| 6장 | `GET /scrims/{id}` 상세(참가자, 팀 구성, 결과) | 구현됨 | balance(저장 팀 요약)·result(최근 결과·ELO 변동)·players skill/is_new·viewer can_* 5개(D121) |
| 6장 | `POST /scrims/{id}/balance`(방장) | 구현됨 | 방장·운영진, 계산만(저장 없음) |
| 6장 | `POST /scrims/{id}/result`(방장) | 구현됨 | 방장·운영진, 200 + 상세, 팀 게임 winner_team / 개인 placements |
| 6장 | `POST /scrims/{id}/result/approve`(운영진) | 구현됨 | 본문 `result_id` 필수(D114) |
| 6장 | (없음) | 추가 | `PUT /scrims/{id}/teams`(D109), `DELETE /scrims/{id}/result`(D112), `POST /scrims/{id}/result/reject`, `GET /seasons`(D120), `GET /users/{id}/rating-history`(D118, 목록이 아닌 그래프 데이터셋) |
| 6장 | `GET /users/{id}/profile` 「내전 레이팅」 | 구현됨 | `scrim = {season, ratings, recent(5)}`(D119) |
| 7-1 | 팀 평균, E 식, R' = R + K(S − E), K 32 / 10경기 미만 40 | 구현됨 | delta를 0에서 먼 쪽 정수 반올림, 하한 없음(D104). 경기 수 = (사용자, 게임) 이력 행 수, 시즌 무관(D106). K 값은 env(D124) |
| 7-1 | 시드: 티어당 200점, 실버 1000·골드 1200·플래 1400, 연동 없으면 1000 | 구현됨 | 아이언 600 … 다이아 1800, 마스터 이상 2000, 디비전·LP 무시, 대표 계정 최신 스냅샷, 스팀 1000(D103) |
| 7-1 | 변동 내역을 프로필 그래프로 | 구현됨 | 게임·시즌 선택, 최근 100점(D118) |
| 7-2 | 실력값 = w × 내전 레이팅 + (1 − w) × 티어 시드, w = 경기 수 ÷ 10 | 구현됨 | 내전 레이팅 = 현재 시즌 elo(없으면 시드), 정수 반올림(D107) |
| 7-2 | 126가지 팀 구성의 실력값 **합** 차이 | 구현됨 | 전력 차 = |평균 차| × n/2(짝수면 합의 차와 같음), 홀수 ⌊n/2⌋:⌈n/2⌉, 블루 = 슬롯 첫 참가자 쪽(D108) |
| 7-2 | 포지션 120가지, 1지망 0·2지망 +1·그 외 +3, 총 비용 상위 3안 | 구현됨 | 총 비용 = 전력 차 + **λ 50** × 포지션 비용, 동점 규칙(D108, D134), 포지션 ≤ 5 전제(D134) |
| 7-2 | 방장이 선택하거나 직접 수정 | 구현됨 | 방장·운영진, 미배정 허용(레이팅 제외) |
| 7-2 | 롤체: 개인 순위로 레이팅 갱신 | 구현됨 | 모든 쌍 1:1, K/(M−1) 합산, 상위 절반 승(D105) — 결함 3(프로필 승패 기준) |
| 8장 | `/scrims/[id]` 팀 밸런스 결과, 결과 입력 | 구현됨 | 진행 단계 4단계(개인 순위는 「참가 확정」), 3안 탭·기대 승률·전력 차·포지션 비용, 팀 직접 수정, 승인 대기·승인/반려·ELO 표(8·9절) |
| 8장 | `/scrims` 모집 중·마감 구분 | 구현됨 | 「승인 대기」 배지, 종료 카드 「블루팀 승리」/「1위 {닉네임}」 |
| 8장 | `/members/[id]` 레이팅 그래프, 최근 전적 | 구현됨 | 내전 레이팅 카드, Recharts 그래프, 최근 내전 5개(WIN/LOSS/노쇼/미배정, 게임 이름 D133). 순위 「#3」·내전 주 포지션은 미포함(D127, S4) |

S3 범위 P0(2장 팀 자동 밸런스·결과 입력·승인, 7-1, 7-2, 8장 상세·프로필 그래프) 중 **누락 없음**. 제외 항목(랭킹·시즌 종료·분쟁·알림)은 슬라이스 제외와 같다.

## 미실행 (통과로 보지 말 것)

| 항목 | 이유 | 준비된 테스트 |
| --- | --- | --- |
| 같은 결과 동시 승인, 같은 사용자 두 내전 순차 반영, 시즌 없음 동시 승인 → 시즌 1개, 동시 제출 1건, 부분 고유 인덱스 P2002, 2-인자 advisory SQL, READ COMMITTED 재조회, `createMany skipDuplicates` | PostgreSQL·Docker 없음 | `test/db/scrim-results.db.e2e.spec.ts`(6건, skip) |
| 마이그레이션 `20261030120000_s3` 실제 적용 | 같음 | 없음(diff 대조로 대신) |
| 16명 승인이 경합 중 15초 안에 끝나는지 | 같음 | 없음 |
| 브라우저 렌더(밸런스 3안·팀 확정·결과 제출·승인 대기·반려·ELO 표·롤체 순위·프로필 그래프, 데스크톱·모바일 × 라이트·다크) | 브라우저 미사용 | frontend 보고서 수동 절차 |
| `corepack pnpm -r build` | 지시(리더가 실행) | - |

## 명세 문서 갱신 필요 목록 (S3분)

1. 2장 결과 입력·승인: 「팀장이 결과 입력」 → 방장(또는 운영진 대리)이 입력, 다른 운영진이 승인·반려(자기 제출 불가), 반려 사유 필수·재입력, 승인 전 제출 취소, 승인 결과는 수정 불가(분쟁 처리는 관리자 도구), ELO 미반영 내전 선택(D111, D112, D114, D122, D123).
2. 2장 팀 자동 밸런스: 3안은 저장하지 않고 고른 안·직접 수정 팀을 저장, 미배정 참가자는 레이팅 제외, 2–16명·홀수 지원, 자동 밸런스 꺼도 직접 구성 가능(D108, D109).
3. 5장: rating_history에 `game_id·season_id·scrim_result_id·k_factor`, scrim_results에 `status·placements·rejected_by·rejected_at·reject_reason`과 「활성 결과 1개」 규칙, ratings 행은 시즌 첫 반영 때 시드로 생성, 인덱스 `rating_history(user_id, game_id, season_id, created_at)`(D103, D113, D125).
4. 5장 seasons: 승인 시각이 속한 시즌에 반영, 없으면 자동 생성(KST 달 1일 또는 직전 시즌 끝부터 `SEASON_AUTO_LENGTH_MONTHS`개월, 「시즌 N」)(D116).
5. 6장: `balance`·`result`는 방장·운영진, `result/approve` 본문 `result_id`. 추가 경로 5개 — `PUT /scrims/{id}/teams`, `DELETE /scrims/{id}/result`, `POST /scrims/{id}/result/reject`, `GET /seasons`, `GET /users/{id}/rating-history?game=&season=`(그래프용, 페이징 없음·최근 100)(D109, D112, D114, D118, D120).
6. 6장 응답: `GET /scrims/{id}`에 팀 요약·결과·ELO 변동·viewer 권한, `GET /scrims`에 result_status·outcome, `GET /users/{id}/profile`에 내전 블록(현재 시즌 레이팅·최근 5개)(D119, D121).
7. 7-1: delta를 정수(0에서 먼 쪽) 반올림해 더함, 하한 없음, 「10경기 미만」 = 그 게임의 승인된 ELO 반영 내전 수(모든 시즌), K 값은 환경 변수, 시드 표 전체(아이언 600 … 마스터 이상 2000, 디비전·LP 무시, 대표 계정 기준, 스팀 1000), 노쇼·미배정은 반영 제외(D103–D106, D115, D124).
8. 7-2: 전력 차 = 평균 차 × 인원/2(짝수면 합의 차), 총 비용 = 전력 차 + 50 × 포지션 비용, 동점 규칙, 기대 승률은 실력값 평균 기준, 포지션 5개 이하 전제(D107, D108, D134).
9. 7-2 끝 개인 순위: 모든 쌍 1:1 대결, K/(인원 − 1)로 나눠 합산, 상위 절반(2 × 순위 ≤ 인원)을 승으로 집계(D105). 프로필 최근 내전의 승패 기준은 결함 3 결정 후 함께 적을 것.
10. 8장 `/scrims/[id]`: 진행 단계(모집 → 팀 구성/참가 확정 → 경기 진행 → 결과 승인), 운영진 승인·반려 버튼, 승인 후 참가자별 ELO 변동 표. `/scrims` 카드 「승인 대기」·결과 표시. `/members/[id]` 내전 레이팅 카드·그래프(게임·시즌 선택)·최근 내전 5개(D121, D132, D133).

계약 문서 안에서 맞출 것(구현 영향 없음): 결함 5의 본문 7곳, 5-4 2번 VALIDATION path 기준(결함 2), 4-1 ProfileScrim recent 개인 순위 승패 기준(결함 3), 7-4 테스트 목록 「16명 < 200ms」의 측정 방식(결함 1).
