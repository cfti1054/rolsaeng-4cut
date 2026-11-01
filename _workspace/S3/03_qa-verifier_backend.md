# QA: S3 apps/api 백엔드(팀 밸런스·팀 저장·결과 제출·승인·반려·ELO·시즌·레이팅 그래프) — 판정: pass

대상: `apps/api/src/modules/ratings/**`, `modules/scrims/{scrim-teams,scrim-results,scrim-views}.service.ts`·`scrim-result-json.ts`·`scrims.service.ts`·`scrims.controller.ts`·`scrims.module.ts`, `modules/profile/profile-scrim.service.ts`·`profile.service.ts`, `config/env.ts`, `prisma/migrations/20261030120000_s3`
기준: 계약 `_workspace/01_architect_contract.md`(S3 2·3·4·5·6·8·11·12·13절, D103–D127), shared `scrim-results.ts`·`ratings.ts`·`seasons.ts`·`scrims.ts`·`paths.ts`, core QA `_workspace/03_qa-verifier_core.md` 확인 요청
구현 보고서: `_workspace/02_backend-dev_s3.md`

판정 근거: blocker 0, major 0, minor 4. **DB e2e(`test/db/scrim-results.db.e2e.spec.ts`: 동시 승인·사용자 잠금 직렬화·시즌 동시 생성·부분 고유 인덱스·advisory SQL 실동작)와 마이그레이션 적용은 PostgreSQL이 없어 미실행이다. 통과로 치지 않는다.** 동시성 보장은 코드를 정적으로 확인한 데까지다. 지시에 따라 `prisma validate`와 web 빌드·테스트는 실행하지 않았다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter api typecheck` | `tsc -p tsconfig.json --noEmit`, 출력 없음, exit 0 (중단 후 재개하면서 다시 실행, 결과 같음) |
| `corepack pnpm --filter api test` | **Test Files 25 passed \| 5 skipped (30), Tests 372 passed \| 33 skipped (405)**, exit 0. 구현 보고서 수치와 같음. skip = `test/db/**` 5개 파일(TEST_DATABASE_URL 없음) |

## 1. 엔드포인트 8개 + 기존 응답 3개 대조 (계약 4절 ↔ 컨트롤러 ↔ shared)

| 메서드 경로 | 컨트롤러 | 상태 | 요청 parse | 응답 parse | 권한·판정 순서 | 결과 |
| --- | --- | --- | --- | --- | --- | --- |
| POST /scrims/:id/balance (`ApiPath.scrimBalance`) | scrims.controller.ts `balance` `@HttpCode(200)` | 200 | `IdParam` + `z.preprocess(v ?? {}, BalanceScrimRequest)`(strict) | `BalanceScrimResponse.parse`(scrim-teams.service.ts:100) | NOT_FOUND → FORBIDDEN(방장·운영진) → TEAMS_NOT_EDITABLE → BALANCE_UNAVAILABLE(auto_balance, n ∉ [2,16], RangeError). 잠금·쓰기 없음 | 일치 |
| PUT /scrims/:id/teams (`scrimTeams`) | `saveTeams` | 200 | `SaveScrimTeamsRequest` | ScrimDetail(views.detail) | 잠금 → FORBIDDEN → NOT_EDITABLE → core `validateTeamAssignment` VALIDATION | 일치 |
| POST /scrims/:id/result (`scrimResult`) | `submitResult` | 200 | `SubmitScrimResultRequest` | ScrimDetail | 잠금 → FORBIDDEN → NOT_ALLOWED → EXISTS → 모양 VALIDATION → TEAMS_REQUIRED / `validatePlacementUsers` → insert(P2002 → EXISTS) | 일치(5-4 순서) |
| DELETE /scrims/:id/result (`scrimResult`) | `withdrawResult` | 200 | `IdParam` | ScrimDetail | 잠금 → NOT_PENDING → FORBIDDEN(제출자·방장 아님) → `deleteMany(id, pending)` 0행 → NOT_PENDING | 일치 |
| POST /scrims/:id/result/approve (`scrimResultApprove`) | `approveResult` `RolesGuard` + `@Roles('admin')` | 200 | `ApproveScrimResultRequest` | ScrimDetail | 가드가 파이프보다 먼저 실행돼 FORBIDDEN이 VALIDATION·NOT_FOUND보다 먼저 → NOT_PENDING(없음·result_id 불일치) → SELF_REVIEW | 일치 |
| POST /scrims/:id/result/reject (`scrimResultReject`) | `rejectResult` 같은 가드 | 200 | `RejectScrimResultRequest`(사유 정규화 2–200) | ScrimDetail | 승인과 같은 순서, 조건부 update 0행 → NOT_PENDING | 일치 |
| GET /seasons (`seasons`) | ratings.controller.ts `listSeasons` | 200 | - | `ListSeasonsResponse.parse`, next_cursor null, starts_at DESC·id ASC, is_current = resolveSeasonAt | JWT | 일치 |
| GET /users/:id/rating-history (`userRatingHistory`) | `ratingHistory` | 200 | `GetUserRatingHistoryParams` + `GetUserRatingHistoryQuery`(season Uuid) | `GetUserRatingHistoryResponse.parse` | VALIDATION → 사용자 NOT_FOUND → 시즌 NOT_FOUND. 기본 시즌 resolveSeasonAt → latestStartedSeason → 빈 응답. 101개 조회 → 100개 + truncated, 오래된 순 | 일치 |
| GET /scrims, /scrims/:id, /users/:id/profile (확장) | 기존 | 그대로 | 그대로 | ScrimSummary·ScrimDetail·ProfileScrim parse | - | 일치(아래 2절) |

- 오류 코드 S3 7개는 shared `errors.ts`와 `DEFAULT_ERROR_MESSAGE`(app-error.ts)에 모두 있다. 새로 고친 서비스의 반환은 모두 shared `parse`를 거친다(scrim-teams:100, views detail/summaries, seasons.service list, rating-history.service, profile-scrim.service:104).
- 외부 식별자: 사용자는 `ScrimUserRef`(id·nickname·avatar_url)로만 나간다. `discordId`는 아바타 URL을 만들 때만 읽고(scrim-views.service.ts:140) 응답에는 넣지 않는다. ProfileScrim·그래프 응답에는 사용자 참조가 없다. e2e가 응답에 email·discord가 없는지 확인한다.

## 2. 직렬화 ↔ 계약 4-1

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| players[].skill·is_new | `RatingInputsService.forUsers`: 현재 시즌 ratings.elo(시즌을 만들지 않음), (user, game) 이력 수, 티어 시드 → core `computeSkill`. is_new = gamesPlayed < env | rating-inputs.service.ts |
| position_preference | team·position 있고 use_positions일 때만 core `positionPreferenceOf` | scrim-views.service.ts:345 |
| balance | has_teams && 두 팀 모두 joined 배정자 ≥ 1일 때만. **evaluateTeams에 슬롯 순서(orderSlots → joined → team 필터) 그대로 members 전달**, elo_preview는 rated일 때만 `previewTeamElo({ratingAvg, kBase})`, unassigned = joined && team null | views.ts:388, :396–417 |
| result.rating_status | not_rated / approved+이력 ≥ 1 applied / 이력 0 skipped / 그 외 waiting | views.ts:433–439 |
| rating_changes | delta DESC → user id ASC, team = 현재 scrim_players.team, 개인 순위 placement = 이력 있는 사용자만 1..M 다시 매김, outcome `isPlacementWin(rank, M)`, k_factor = 이력 값 | views.ts:443–476 |
| result_status·outcome | 최근 결과 1행(요청 2 규칙), finished && approved일 때만 outcome. 1위 사용자는 방장과 한 번에 조회(N+1 없음) | views.ts:163–174, :248–255 |
| viewer can_* 5개 | shared `ScrimViewer` 주석 조건과 줄 단위로 같음(can_submit_result의 has_teams 두 팀 / 개인 joined ≥ 2 포함) | views.ts:317–386 |
| ProfileScrim | season = currentAt(만들지 않음), ratings = games.sort_order 순, recent = joined·no_show && finished, approved_at DESC 5, 개인 순위는 제출 인원 기준 isPlacementWin, elo_delta = 이력 | profile-scrim.service.ts |

## 3. core 호출 (core QA 확인 요청)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 승인이 core를 호출하고 delta·k_factor를 따로 계산하지 않음 | `computeTeamEloUpdates`/`computePlacementEloUpdates` 결과의 `eloAfter`·`kFactor`·`outcome`을 그대로 저장한다. api 쪽 delta는 직렬화에서 `eloAfter − eloBefore` 표시값으로만 만든다(이력 테이블에 delta 컬럼 없음) | scrim-results.service.ts:214–250 |
| gamesPlayed = 시즌과 무관한 (user, game) 이력 수(D106) | `countRatedGames`: `where {userId in, gameId}`, season 조건 없음. 승인·skill이 같은 함수를 쓴다. 승인에서는 사용자 잠금 아래, 이번 반영 전에 센다 | rating-inputs.service.ts:26–41, scrim-results.service.ts:199 |
| previewTeamElo에 ratingAvg·kBase | 밸런스(scrim-teams.service.ts:103)·상세(views.ts:408) 모두 `{blueAvg: blue.ratingAvg, orangeAvg: orange.ratingAvg, k: config.rating.kBase}` | 정적 확인 |
| planAutoSeason에 시즌 전체 목록 | advisory 잠금 뒤 `all(tx)`(필터 없이 전체)를 `seasons`로 넘긴다 | seasons.service.ts:57–60 |
| evaluateTeams에 슬롯 순서 members | 2절 balance 행 | views.ts:401–404 |
| 반영 대상 선택 | `selectRatedParticipants`(승인 시점 status·team, placements). 노쇼·미배정·cancelled가 빠진다 | scrim-results.service.ts:169–173 |
| 밸런스 입력 순서 | `orderSlots`(방장 → joined_at → user id) = 상세 슬롯 순서. 블루 = players[0] 쪽(D108) | scrim-teams.service.ts:66 |
| 티어 시드 D103 | 대표 계정 → `RANKED_QUEUE_BY_GAME` 큐의 최신 스냅샷 → `tierSeedRating`. 큐 없는 게임·계정 없음·티어를 모를 때 1000. 계정 1회 + 스냅샷 1회 조회 | rating-seed.ts |

api 안에 ELO·밸런스·시즌 공식을 복사한 곳은 없다. 표시용 반올림(`roundProbability` = Math.round(p×1000)/1000, 나머지는 core `roundHalfAwayFromZero`)만 직렬화에서 한다. 계약 7-4 7번과 맞는다.

## 4. 상태 전이 (8절 ↔ 갱신 코드)

| 전이·변경 | 코드 | 검사 |
| --- | --- | --- |
| scrims playing → finished | approve 13단계 `assertScrimTransition(s.status, 'finished')` | 맵 |
| scrim_results insert pending | submit, `createdAt = clock.now()` | - |
| pending → approved / rejected | `assertResultTransition` + `updateMany(id, status=pending)` 1행 검사 | `canTransition(SCRIM_RESULT_STATUS_TRANSITIONS)` |
| pending delete | withdraw `deleteMany(id, pending)`. approved·rejected 행은 지우지 않는다 | - |
| team·position 저장 | saveTeams: joined·no_show 전원 null → joined 행만 갱신 | 상태 전이 없음 |
| team·position 전원 null(5-1) | leave(joined 취소, 승격 포함), PATCH(승격 > 0), **join(joined로 들어감, 요청 1)**. 대기 등록·대기자 취소·노쇼 표시·정정은 지우지 않는다. 재참가 행은 `team: null, position: null` | scrims.service.ts:299, :361, :371, :397 |

- 팀 구성 가능 조건 = has_teams && status ∈ {full, playing} && 활성 결과 없음(scrim-teams.service.ts:32). 밸런스·팀 저장·`can_edit_teams`가 같은 조건을 쓴다.
- 결과 제출 조건: playing, 활성 결과 없음, 팀 게임은 블루·오렌지 각각 joined 배정자 ≥ 1(없으면 SCRIM_TEAMS_REQUIRED).
- 반려 뒤: 활성 결과가 없어져 팀 수정·재제출이 다시 열리고, 최근 결과가 새 pending 행이 된다(e2e 617행).
- 승인 뒤 변경 불가: 재제출은 finished라 NOT_ALLOWED, 팀은 NOT_EDITABLE, 취소는 NOT_PENDING. D123과 맞는다.

## 5. 잠금·트랜잭션 (11절 대조)

| 경로 | 첫 문장 잠금 | 마지막 방어 | 결과 |
| --- | --- | --- | --- |
| PUT /teams | `lockOrNotFound`(scrim-teams:131) | - | 일치 |
| POST /result | :67 | P2002 → SCRIM_RESULT_EXISTS(:116–118) | 일치 |
| DELETE /result | :128 | deleteMany 0행 → NOT_PENDING | 일치 |
| approve | :156 → (resolveSeasonAt null일 때만) `hashtext('season-auto-create')` → 재조회 → 생성 → `lockUserRatings`(중복 제거 + user_id 오름차순, 2-인자 `hashtext('rating:'||game_id), hashtext(user_id)`) → ratings `createMany(skipDuplicates)` 후 재조회 → 경기 수 → 계산 → 쓰기 → 결과 조건부 update(1행 아니면 NOT_PENDING 롤백) → finished | rating_history P2002 → INTERNAL_ERROR 롤백, `@@unique(user, game, season)` | 일치. 한 `$transaction`(ReadCommitted) 안에서 모든 쓰기가 일어난다 |
| reject | :283 | 조건부 update 1행 | 일치 |

- 교착: 모든 승인이 내전 행 → 시즌 → 사용자(정렬) 순서를 따른다. 시즌이 이미 있어 시즌 잠금을 건너뛰는 트랜잭션도 사용자 잠금만 잡으므로 순환 대기가 없다.
- 이중 승인: 둘째 요청은 내전 잠금에서 기다린 뒤 pending이 없어 NOT_PENDING을 받는다. 그래도 통과하면 조건부 update와 이력 고유 제약이 막는다. e2e `같은 결과 동시 승인` 통과(FakePrisma 직렬화. 실제 행 잠금은 DB e2e로만 확인 가능).
- `pg_advisory_xact_lock`은 S1 `advisoryXactLock`과 같이 `$executeRaw`로 실행한다(void 반환이라 queryRaw를 쓰지 않음).
- 잠금 순서 rawCalls 검사 e2e가 있다(407행 테스트).

## 6. rated=false·노쇼·미배정·시즌

- rated=false: 6–11단계를 건너뛰고 시즌 생성·잠금·ratings·이력이 모두 없다. 결과 approved, 내전 finished, `not_rated`. 프로필 recent에는 나오고 elo_delta는 null(D122).
- 노쇼·미배정은 반영 대상에서 빠진다. 한 팀 전원 노쇼면 skip → approved·finished·`skipped`. 개인 순위는 제출 뒤 노쇼를 빼고 1..M으로 다시 매긴다. e2e 502·556행.
- 시즌: 승인 시각이 속한 시즌을 쓰고, 없으면 자동 생성한다(KST 달 1일, 3개월, 「시즌 N」). 시즌이 바뀌면 새 시드 행을 만들고 K는 전체 이력 수로 정한다. e2e 407·583행.

## 7. 마이그레이션·env

- `20261030120000_s3/migration.sql`: `ALTER TABLE rating_history ADD COLUMN k_factor INTEGER NOT NULL`, 인덱스 `(user_id, game_id, season_id, created_at)`, 수동 `CREATE UNIQUE INDEX scrim_results_one_active_per_scrim … WHERE status IN ('pending','approved')`. **`DROP INDEX` 문은 없다**(주석 1줄만). S1 `game_accounts_one_primary_per_user_game`(20261028120000_s1)도 그대로 남아 있어 부분 고유 인덱스 2개가 유지된다. 스키마의 `kFactor`·`@@index`와 일치한다. DB 적용은 미실행.
- env 4개: `SCRIM_ELO_K_BASE`·`K_NEW`·`NEW_PLAYER_GAMES`는 posInt, `SEASON_AUTO_LENGTH_MONTHS`는 int 1–24이고 기본값은 shared 상수다. `.env.example` 88–94행과 일치한다. `rating_policy`는 env 실제 값을 쓴다(e2e).

## 결함

blocker 0, major 0, minor 4.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/api/src/modules/scrims/scrim-results.service.ts:153, ratings/rating-history.service.ts:52 | 같은 사용자의 이력 created_at 순서 = 실제 반영 순서(그래프에서 앞 점 elo_after = 뒤 점 elo_before) | `now`를 내전 잠금·사용자 잠금을 기다리기 **전에** 정한다. 내전 B가 먼저 now(t0)를 잡고 B 내전 잠금에서 기다리는 동안 A(t1 > t0)가 같은 사용자를 먼저 반영하면, B 이력은 elo_before = A.elo_after인데 created_at은 A보다 이르다. 그래프(created_at 순)에서 B, A 순으로 그려져 연결이 끊긴다. 계약 「트랜잭션 시작 시각」 문구를 그대로 따른 결과라 계약 수준의 틈이다 | 정적 분석(DB 필요). 서로 다른 두 내전을 같은 사용자로 동시에 승인하되 B 내전 행을 다른 트랜잭션으로 잠시 잡아 두면 된다. 사용자 잠금을 얻은 뒤 now를 정하거나, 그래프 정렬 보조 키를 두는 방안을 architect가 판단할 것 |
| 2 | minor | scrim-results.service.ts:154–275 | 사용자 잠금 경합에서도 승인이 정상 완료 | `$transaction`에 `timeout`·`maxWait`를 지정하지 않아 Prisma 기본값(5초·2초)이 적용된다. 16명 승인은 약 50개 쿼리를 실행하고, 사용자 advisory 잠금 대기 시간도 timeout에 포함된다. 경합이 길면 P2028로 500이 나고 전체가 롤백된다(데이터 오염은 없음). 구현 보고서 「남은 문제」와 같은 건 | DB e2e로 16명 내전 2개를 같은 사용자들로 동시에 승인. timeout 옵션 명시 권장 |
| 3 | minor | scrim-results.service.ts:168–172, scrim-result-json.ts:148–156 | placements JSON이 깨진 개인 순위 결과는 승인을 실패시킨다(INTERNAL_ERROR) | `readPlacements`가 로그만 남기고 null을 돌려준다. `?? []`이 되어 selection이 skip → 승인은 성공하고 finished·`skipped`로 레이팅 없이 확정된다. 되돌리기가 없어(D123) 조용히 굳는다. 정상 쓰기 경로에서는 생기지 않는다(수동 DB 수정일 때만) | FakePrisma에서 pending 행 placements를 `[{}]`로 바꾼 뒤 approve → 200 skipped |
| 4 | minor | apps/api/src/modules/profile/profile-scrim.service.ts:48–60 | 최근 5개만 필요한 조회 비용이 참가 수와 무관 | 사용자의 joined·no_show 참가 행 전부와 그 내전들의 approved 결과 전부를 메모리로 읽은 뒤 5개를 자른다. 참가 이력에 비례해 커진다(N+1은 아님) | 정적 분석. 참가 내전이 수백 개인 사용자의 프로필 조회 |

## 미검증(환경) — 통과 아님

- `test/db/scrim-results.db.e2e.spec.ts` 6건(작성만 됨, 미실행): 같은 결과 동시 승인 / 같은 사용자 두 내전 순차 반영 / 시즌 동시 생성 1개 / 동시 제출 1건 / 부분 고유 인덱스 P2002 / 2-인자 advisory SQL.
- READ COMMITTED에서 잠금을 얻은 뒤 다시 조회하면 앞 트랜잭션이 커밋한 값이 보이는지, `createMany skipDuplicates` → `ON CONFLICT DO NOTHING`, 마이그레이션 적용, `prisma validate`(이번 지시 범위 밖이라 미실행).

## 백엔드 보고서 「계약 변경 요청」 의견

| # | 요청 | 의견 |
| --- | --- | --- |
| 1 | 새 참가(joined로 들어감)에서도 팀 초기화 | **타당.** D110 「joined 집합이 바뀌면」에 해당한다. full에서 팀 저장 → 승격 없는 정원 확대 → 새 참가 경로에서 옛 팀이 남는 틈을 막는다. 대기 등록(waitlist)은 초기화하지 않으므로 5-1 취지와 맞는다. 5-1 문구에 「참가 확정」 추가 찬성 |
| 2 | 최근 결과 동점 규칙: created_at DESC → 활성 먼저 → id DESC | **타당.** 활성 행은 최대 1개이고 항상 마지막 행이라 정상 상태에서는 결과가 같다. 같은 ms 반려·재제출에서 uuid 순서 때문에 반려 행이 「최근」이 되는 것을 막는다. 목록·상세가 같은 `latestFirst`를 쓴다(views.ts:100–106, :253, :274) |
| 3 | 목록 result_status: DISTINCT ON 대신 IN 조회 1회 + 메모리 선택 | **타당.** 쿼리 수가 같고 결과 행은 내전당 (반려 수 + 1)개라 크기가 작다. raw SQL이 없어 FakePrisma로 검증할 수 있다 |
| 4 | 팀 저장 쓰기 횟수: 포지션 사용 시 슬롯별 updateMany(최대 16 + 1) | **타당.** 잠금 아래 한 트랜잭션이라 정합성 문제가 없고, 최대 17문장이라 성능 영향도 작다. 5-3 문구 완화 찬성 |
| 5 | skill 입력을 `ratings/rating-inputs.service.ts`에, 프로필 블록을 `profile-scrim.service.ts`에 | **타당.** ScrimViews ↔ ScrimTeams 순환을 피하고 상세·밸런스가 같은 함수를 쓴다. 동작 차이 없음. 10절 표 갱신 |
| 6 | rating-history: games 시드 행 없음 → INTERNAL_ERROR | **타당.** GameCode enum은 통과했는데 DB 시드가 없는 것은 운영 오류이고 사용자 입력 오류가 아니다. 계약 오류 목록에 「시드 누락 = INTERNAL_ERROR」 한 줄 추가 권장 |
