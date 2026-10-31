# backend-dev S3 보고서: 팀 밸런스·팀 저장·결과 제출·승인·반려·ELO·시즌·레이팅 그래프

계약: `_workspace/01_architect_contract.md`(S3, D103–D127). 범위: `apps/api/**`만 수정(core·shared·web 미수정).

## 검증 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter api typecheck` | 통과 |
| `corepack pnpm --filter api test` | 25 파일 통과 / 5 파일 skip, **372 통과, 0 실패, 33 skip** |

- 기준선 33개 실패(scrims.e2e 31, steam-apps.e2e 2)는 모두 통과로 바뀜.
- skip 33개 = `test/db/*.db.e2e.spec.ts` 5개 파일(TEST_DATABASE_URL 없음). Docker가 없어(`docker: command not found`) PostgreSQL을 띄우지 못했다. **새 DB e2e 6개(`scrim-results.db.e2e.spec.ts`)는 작성만 하고 실행하지 않았다.**
- core는 vitest `source` 조건으로 `packages/core/src`를 읽는다. 실행 시점에 core src의 S3 함수 23개가 있었고 dist에도 rating/balance/season이 생성돼 있었다.
- `prisma generate`를 다시 실행했다(`rating_history.k_factor` 타입 반영).

## 구현 엔드포인트

| 메서드·경로 | 위치 | 비고 |
| --- | --- | --- |
| POST /scrims/:id/balance | `scrims.controller.ts` → `scrim-teams.service.ts#balance` | 잠금·쓰기 없음. 본문 없음/`{}` 모두 허용(Express 5 undefined → `{}`) |
| PUT /scrims/:id/teams | `#saveTeams` | 트랜잭션 + 내전 행 잠금, core `validateTeamAssignment` |
| POST /scrims/:id/result | `scrim-results.service.ts#submit` | 잠금, 모양 검사, core `validatePlacementUsers`, P2002 → SCRIM_RESULT_EXISTS |
| DELETE /scrims/:id/result | `#withdraw` | 잠금, NOT_PENDING → FORBIDDEN 순서, `deleteMany(id, status=pending)` 0행 → NOT_PENDING |
| POST /scrims/:id/result/approve | `#approve` | `@Roles('admin')`, READ COMMITTED 한 트랜잭션, 5-5 1–14단계 |
| POST /scrims/:id/result/reject | `#reject` | `@Roles('admin')`, 잠금, 조건부 update |
| GET /seasons | `ratings/ratings.controller.ts` → `seasons.service.ts#list` | next_cursor null |
| GET /users/:id/rating-history | `ratings/rating-history.service.ts` | 기본 시즌 = resolveSeasonAt → latestStartedSeason, 101개 조회 → 100 + truncated |
| GET /scrims, /scrims/:id (확장) | `scrim-views.service.ts` | result_status·outcome, players skill·is_new·position_preference, viewer can_* 5개, balance(evaluateTeams), result(ScrimResultView) |
| GET /users/:id/profile (확장) | `profile/profile-scrim.service.ts` | `scrim` 항상 객체(D119) |

## 모듈·파일

- `src/config/env.ts`: `SCRIM_ELO_K_BASE`·`SCRIM_ELO_K_NEW`·`SCRIM_ELO_NEW_PLAYER_GAMES`(양의 정수), `SEASON_AUTO_LENGTH_MONTHS`(1–24). `config.rating = {kBase, kNew, newPlayerGames}`(core EloPolicy 모양), `config.seasonAutoLengthMonths`.
- `src/modules/ratings/`(새): `rating-seed.ts`(D103 대표 계정 → `RANKED_QUEUE_BY_GAME` 큐 최신 스냅샷 → `tierSeedRating`, 계정 1회 + 스냅샷 1회 일괄 조회), `rating-locks.ts`(시즌 `hashtext('season-auto-create')`, 사용자 `pg_advisory_xact_lock(hashtext('rating:'||game_id), hashtext(user_id))` user_id 오름차순), `seasons.service.ts`(조회·`ensureForApproval` 자동 생성), `rating-inputs.service.ts`(skill 입력 일괄: 시즌 1 + ratings 1 + 이력 groupBy 1 + 시드), `rating-history.service.ts`, `ratings.controller.ts`, `ratings.module.ts`.
- `src/modules/scrims/`: `scrim-teams.service.ts`, `scrim-results.service.ts`, `scrim-result-json.ts`(placements JSON parse, 활성 판정), `scrim-views.service.ts`(직렬화 확장, `orderSlots` 공용 함수로 추출), `scrims.service.ts`(5-1 `resetTeams`), 컨트롤러 6개 라우트, 모듈 연결.
- 계산은 전부 `@gcd/core`: computeSkill, balanceTeams, evaluateTeams, previewTeamElo, positionPreferenceOf, roundHalfAwayFromZero, validateTeamAssignment, validatePlacementUsers, selectRatedParticipants, computeTeamEloUpdates, computePlacementEloUpdates, isPlacementWin, computeWinRate, tierSeedRating, resolveSeasonAt, latestStartedSeason, planAutoSeason. api에 공식 복사본 없음. 블루 기대 승률 소수 셋째 자리 반올림(`Math.round(p×1000)/1000`)만 직렬화에서 한다(계약 7-4 7번).

## 잠금·트랜잭션(11절 대조)

| 경로 | 구현 |
| --- | --- |
| PUT /teams, POST/DELETE /result, reject | `$transaction` 첫 문장 `lockOrNotFound`(SELECT … FOR UPDATE) |
| approve | 내전 행 → (resolveSeasonAt null일 때만) season-auto-create → 재조회 → planAutoSeason insert → 사용자 잠금(오름차순) → ratings `createMany(skipDuplicates)`(= ON CONFLICT DO NOTHING) 후 재조회 → 경기 수 groupBy → core 계산 → ratings update(win/loss increment) + rating_history insert(P2002 → INTERNAL_ERROR, 롤백) → `updateMany(id, status=pending)` 1행 아니면 NOT_PENDING(롤백) → `assertScrimTransition(playing, finished)` |
| 상태 전이 | scrims `assertScrimTransition`, scrim_results `canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, pending, approved/rejected)` |
| now | 승인 요청 시작 시 1회 → approved_at, rating_history.created_at, 시즌 판정. 제출도 `created_at = clock.now()`로 저장(submitted_at) |

## 테스트

- `test/scrim-results.e2e.spec.ts`(새, 24개, FakePrisma): 밸런스(403·404·400·롤체·모집 중·auto_balance off·노쇼로 1명·3안·rating_policy env·티어 시드·포지션 사용·rated=false preview null), 팀 저장(남의 user_id·노쇼·포지션 누락/범위 밖·zod 중복 400, 덮어쓰기, 미배정, 결과 pending 후 409, 포지션 미사용에 position 400), 결과 제출(playing 아님·팀 미구성·모양 불일치·멤버 403·운영진 대리·중복 409, 롤체 비참가자/노쇼 path), 제출 취소(권한·pending 없음·재제출), 승인(비운영진 403이 404보다 먼저, 자기 제출 403(방장 운영진), result_id 불일치, 시즌 자동 생성 날짜·이름, 시드 행 GOLD 1200, ±26 계산, k_factor, wins/losses, 잠금 순서 rawCalls 검사, 이중 승인, 동시 승인(Fake 직렬화), rated=false, 노쇼·미배정 제외, 한 팀 전원 노쇼 skipped, 개인 순위 +20/+7/−7/−20, 노쇼 후 순위 재부여, 기존 시즌 사용·K 32/40 혼합), 반려(사유 검증·재제출·팀 수정 재개), 5-1 팀 초기화(확정자 취소·승격·정원 확대, 대기자 취소·노쇼 표시는 유지), /seasons, 그래프(빈·기본 시즌 대체·404·truncated·rating), 프로필 scrim(win/loss/no_show/unassigned·elo_delta), viewer can_* 조합, 응답에 email·discord 없음.
- `src/modules/ratings/rating-seed.spec.ts`(새, 2개), `src/config/env.spec.ts`(S3 1개 추가).
- `test/profile.e2e.spec.ts`: `scrim` 기대값 null → `{season: null, ratings: [], recent: []}`(D119).
- `test/support/fake-prisma.ts`: scrimResult(부분 고유 `scrim_results_one_active_per_scrim`), season, rating(고유 user·game·season), ratingHistory(고유 scrim·user) 추가, 스냅샷 복원 대상에 포함. `fake-table.ts`: `createMany({skipDuplicates})`.
- **DB e2e(작성만, 미실행)** `test/db/scrim-results.db.e2e.spec.ts`: 같은 결과 동시 승인 → 200·409·이력 2행, 같은 사용자 두 내전 동시 승인 → 둘째 elo_before = 첫째 elo_after, 시즌 없음 동시 승인 → 시즌 1개, 동시 제출 → 1건만, 부분 고유 인덱스 직접 insert P2002, advisory SQL 실행.

## 계약 변경 요청 (확인 필요)

1. **5-1 범위 — 새 참가 확정(POST /join → joined)에서도 팀 초기화를 했다.** 5-1 본문은 참가 취소·정원 수정만 적지만 D110(「joined 집합이 바뀌면 전원 초기화」)에 따르면 새 참가도 해당한다. 실제로 full에서 팀 저장 → 승격 없는 정원 확대(full → recruiting, 팀 유지) → 새 참가자 joined 경로에서 팀이 남는 틈이 있다. 계약 5-1 문구에 「참가(joined로 들어감)」 추가를 요청한다. 원치 않으면 `scrims.service.ts#join`의 `resetTeams` 한 줄을 지우면 된다.
2. **최근 결과 행 동점 규칙**: 계약은 `created_at DESC, 같으면 id DESC`. 구현은 `created_at DESC → 활성(pending·approved) 먼저 → id DESC`. 활성 행은 항상 가장 나중 행이라 정상 상태에서는 같은 결과지만, 같은 ms에 반려·재제출이 겹칠 때 uuid 순서로 반려 행이 「최근」이 되는 것을 막는다. 계약 문구 반영 요청.
3. **목록 result_status 조회 방식**: 계약 4-1은 `DISTINCT ON (scrim_id)` 1회. 구현은 Prisma `findMany(scrimId IN 페이지, orderBy created_at DESC)` 1회 + 메모리에서 내전별 첫 행(결과 행은 내전당 반려 수 + 1개). 쿼리 수는 같고 raw SQL을 피했다. 허용 여부 확인.
4. **팀 저장 쓰기 횟수**: 5-3 3번 「updateMany 2–3회」. 포지션 사용 내전은 사람마다 position이 달라 Prisma로는 슬롯별 updateMany(최대 16회)가 필요하다. 포지션 미사용 내전은 3회. 문구 완화 요청.
5. **파일 배치**: 10절은 「참가자 skill 입력 모으기」를 `scrim-teams.service.ts`에 두라고 했지만 상세 직렬화(ScrimViews)와 밸런스가 함께 쓰고 ScrimViews ↔ ScrimTeamsService 순환을 피하려고 `ratings/rating-inputs.service.ts`(RatingInputsService)에 두었다. 프로필 scrim 블록은 `profile/profile-scrim.service.ts`(ProfileService가 호출). 동작 차이 없음.
6. **GET /users/:id/rating-history의 games 행 없음**: GameCode enum 값인데 DB 시드가 없으면 INTERNAL_ERROR로 처리했다(계약 오류 목록에 없음).

## 남은 문제

- DB e2e 미실행(Docker 없음). 실제 PostgreSQL에서 확인이 필요한 것: 부분 고유 인덱스 P2002 매핑, `createMany skipDuplicates`의 ON CONFLICT, 2-인자 advisory lock 직렬화, READ COMMITTED에서 잠금 뒤 재조회가 앞 트랜잭션 커밋을 보는지, 경합 상황에서 16명 승인이 timeout 15초(SCRIM_TX_TIMEOUT_MS) 안에 끝나는지.
- FakePrisma는 트랜잭션을 뮤텍스로 직렬화하므로 fake 동시 승인 테스트는 잠금 자체가 아니라 「잠금 아래 재검사」 로직만 검증한다.

## 수정 이력

### 2026-10-30 QA(_workspace/03_qa-verifier_backend.md) minor 1–3 반영 (minor 4는 리더 결정으로 그대로)

검증: `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api test` **376 통과, 0 실패, 33 skip**(DB e2e 5개 파일, PostgreSQL 없음 — 미실행).

| # | 변경 | 파일 | 테스트 |
| --- | --- | --- | --- |
| 1 | 승인 now를 **모든 잠금 직후** 한 번 정한다(rated && 대상 있음: 사용자 advisory 잠금 직후, 그 외: 내전 잠금·검사 직후). approved_at·rating_history.created_at·시즌 판정 모두 이 값. 잠금 순서(내전 → 시즌 → 사용자)를 지키려고 시즌 단계를 둘로 나눴다. 7a `SeasonsService.lockIfMayCreate(tx, 지금, SCRIM_TX_TIMEOUT_MS)`: 지금 시각에 시즌이 없거나, 있어도 15초(트랜잭션 timeout) 안에 끝나면 사용자 잠금 **전에** season-auto-create를 잡는다. 7b `resolveForApproval(tx, now, holdsLock)`: now 기준으로 판정하고, 없으면 생성(잠금을 쥔 경우만. 아니면 INTERNAL_ERROR 롤백 — timeout 규칙상 생기지 않음). 시즌이 timeout보다 오래 남아 있으면 now(< 시작 + timeout)도 그 시즌이라 생성이 필요 없다. 기존 `ensureForApproval` 삭제 | scrim-results.service.ts, ratings/seasons.service.ts | 잠금 대기 중 시즌 경계를 넘는 상황(fake 시계를 사용자 잠금 뒤 +20초로): 잠금 순서 scrim → season-auto-create → user ×2, created_at = approved_at = +20초, 새 시즌(시작 = 이전 ends_at)에 반영. rated=false도 approved_at = 내전 잠금 뒤 시각 |
| 2 | 내전 쓰기 트랜잭션 공통 옵션 `common/scrim-tx.ts`: `SCRIM_TX_TIMEOUT_MS = 15000`, `SCRIM_TX_MAX_WAIT_MS = 5000`(주석: 잠금 대기가 timeout에 포함됨). `scrimWriteTx()`로 S2 경로 7개(작성·수정·참가·취소·시작·모집 취소·노쇼), S3 5개(팀 저장·제출·제출 취소·승인·반려), 자동 마감 건별 트랜잭션에 적용. 승인은 READ COMMITTED 추가. 자동 마감 바깥 트랜잭션(timeout 5분)은 그대로 | common/scrim-tx.ts, scrims.service.ts, scrim-teams.service.ts, scrim-results.service.ts, scrim-auto-close.ts | 팀 저장·제출·승인의 `$transaction` 옵션 기록 = {timeout 15000, maxWait 5000}(승인은 + isolationLevel ReadCommitted) |
| 3 | 개인 순위 게임 승인에서 저장 placements가 null이거나 형식이 깨졌으면 로그(`승인 중단: … result=id`) 후 INTERNAL_ERROR로 롤백. 결과 pending·내전 playing 유지(skipped로 확정하지 않음) | scrim-results.service.ts | placements `[{}]`·null 각각 → 500 INTERNAL_ERROR, 결과 pending, 내전 playing, ratings·이력·시즌 0 |

계약 문구(리더 수정 대상): 5-5 4단계 「트랜잭션 시작 시각」 → 「모든 잠금 직후 시각」. 5-5 7단계·11절 「(필요 시) season-auto-create」의 「필요 시」 = 사용자 잠금 전 시각 기준으로 시즌이 없거나 트랜잭션 timeout(15초) 안에 끝날 때.

### 2026-10-30 교차 QA(_workspace/03_qa-verifier_s3.md) backend 몫 2건 (D136·D131)

검증: `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api test` **379 통과, 0 실패, 33 skip**(DB e2e 5개 파일 — PostgreSQL 없음, 미실행).

| # | 변경 | 파일 | 테스트 |
| --- | --- | --- | --- |
| (3) D136 | 프로필 최근 내전의 개인 순위 승패를 레이팅 반영 기준으로 바꿨다: 그 내전 참가자 현재 status로 core `selectRatedParticipants`를 돌려 노쇼·미배정을 빼고 1..M으로 다시 매긴 뒤 `isPlacementWin(재순위, M)`. rated=false도 같은 기준. 개인 순위 내전 참가자는 1회 일괄 조회. `placement` 필드는 계약대로 제출 순위 그대로. 내가 노쇼 → no_show, 순위에 없음 → unassigned 그대로 | profile/profile-scrim.service.ts | 8명 중 5위·1·2위 노쇼 → WIN(placement 5), 6위 → LOSS, 노쇼 → no_show. rated true/false 각각 |
| (4) D131 | 코드 변경 없음(이미 `join`에서 `resetTeams`). API e2e 추가 | test/scrim-results.e2e.spec.ts | full → 팀(포지션 포함) 저장 → 정원 4 → 6(승격 없음, recruiting, 팀 유지) → 새 참가 → 5명 전원 team·position null, balance null |

확인 필요(임의 결정): D136 기준에서 반영 대상이 2명 미만이라 `selectRatedParticipants`가 skip이면(예: 나 말고 순위 참가자가 모두 노쇼) 승패를 정할 수 없어 `unassigned`로 내렸다. 다른 값을 원하면 알려 달라.
