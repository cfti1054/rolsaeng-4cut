# 계약: S3 팀 자동 밸런스, 결과 입력·승인, ELO 반영, 레이팅 그래프

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서") 7-1, 7-2, 5·6·8장. 슬라이스: `_workspace/00_input/slice.md`(메인 기본값 1–10 반영)
선행 계약: `_workspace/S0/01_architect_contract.md`(D1–D31), `_workspace/S1/01_architect_contract.md`(D32–D72), `_workspace/S2/01_architect_contract.md`(D73–D102). 와이어 형식(S0 3절), 외부 식별자 비노출(S1 D38), 자리 필드 확장 규칙(D39), 상태 변경 응답 = ScrimDetail(D87), 내전 행 잠금(D85), 화면 env 값 노출 규칙(D101)은 그대로 쓴다. 이 문서는 세 계약을 **확장**한다.
실제 계약은 코드가 우선한다: `packages/shared/src/**`, `apps/api/prisma/schema.prisma`.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-30 | S3 최초 작성: 엔드포인트 신규 8개(밸런스·팀 저장·결과 제출·제출 취소·승인·반려·시즌 목록·레이팅 그래프) + 기존 3개 응답 확장(목록·상세·프로필), 오류 코드 7개(전체 43개), 스키마 증분(마이그레이션 `20261030120000_s3`), core 함수 23개, 환경 변수 4개, 결정 D103–D127 | architect |
| 2026-10-30 | 구현·QA 반영(리더): D128–D135. 5-5 now 시점, 11절 시즌 잠금 조건, 5-1 새 참가 팀 초기화, 4-1 최근 결과 동점·조회 방식, 5-3 쓰기 횟수, 9절 결과 표 NEW 제거·최근 내전 게임 이름, 7-4 포지션 ≤ 5 전제·홀수 동점 사전순, 오류 목록 보강 | 리더 |
| 2026-10-30 | 본문 동기화(교차 QA 결함 5): D128–D135를 2절 INTERNAL_ERROR, 4-1 결과 정렬·조회 방식, 5-0 트랜잭션 옵션, 5-1 새 참가, 5-5 now·시즌 잠금 순서(7a/7b, `lockIfMayCreate`·`resolveForApproval`), 7-4 5·6번, 8절 표, 9절 최근 내전·노쇼 무효화, 10절 파일 위치, 11절에 반영. 리더 결정 D136(프로필 최근 내전 개인 순위 승패 = 반영 기준, 4-1)·D137(7-4 성능 목표와 테스트 상한 1000ms) 추가. 코드 변경 없음 | architect |

---

## 1. 범위

### 포함 (문서 2장 행 기준)

| 문서 2장 행 | S3 범위 |
| --- | --- |
| 내전 · 팀 자동 밸런스 (P0) | 실력값(7-2 1번), 모든 팀 나누기 전수 탐색(정원 2–16 일반화), 팀별 포지션 배정 전수, 비용 상위 3안 반환(저장 안 함), 안 선택·직접 수정 저장(`PUT /teams`) |
| 내전 · 결과 입력·승인 (P0) | 방장(또는 운영진) 결과 제출 — 팀 게임은 승리 팀, 개인 순위 게임은 순위. 제출 취소(목업 「제출 취소」). 운영진 승인(자기 제출 금지) → `finished` + rated면 레이팅·이력 한 트랜잭션. 반려(사유 필수) → 재입력 |
| (7-1) 내전 ELO | 팀 평균 기대 승률, 참가자별 K(32/40), 정수 반올림, 티어 시드, 개인 순위 게임은 쌍대결 합산 |
| 프로필 (P0, 7-1 마지막 줄) | 내전 레이팅 카드(현재 시즌), 레이팅 변동 그래프(게임·시즌 선택), 최근 내전 5개 |
| (8장) 화면 | `/scrims/[id]` 밸런스·팀 구성·결과·승인 대기·승인/반려·ELO 변동·진행 단계, `/scrims` 종료 카드 결과, `/members/[id]` 내전 블록 |

### 제외

ELO·티어 랭킹 화면과 캐시·「5경기 이상」(S4), 홈 대시보드(S4), 시즌 종료 처리·소프트 리셋·뱃지(S4 이후 — S3는 조회와 「시즌 없음」 자동 생성만, 6절), 이의 제기·승인 되돌리기·관리자 승인 대기 화면(S6 — S3 운영진은 상세 화면에서 처리), 디스코드 알림, 토너먼트 대진(P2), 프로필 「내전 기준 주 포지션」(목업 「내전 기준 탑 71%」, 슬라이스에 없음 — `MainPosition.source` 확장은 이후), 프로필 레이팅 카드의 순위 「#3」(랭킹 S4).

---

## 2. 오류 코드 (S3 추가분, `packages/shared/src/common/errors.ts`)

S2까지 36개 그대로. 아래 7개 추가(전체 43개).

| code | HTTP | 발생 |
| --- | --- | --- |
| SCRIM_TEAMS_NOT_EDITABLE | 409 | 밸런스·팀 저장: `game.has_teams = false`, status ∉ {full, playing}, 활성 결과(pending·approved) 있음 |
| SCRIM_BALANCE_UNAVAILABLE | 409 | 밸런스: `options.auto_balance = false`, 팀에 넣을 참가 확정자(joined, 노쇼 제외) 2명 미만·16명 초과, 포지션 사용 내전인데 한 팀 인원 > 포지션 수 |
| SCRIM_RESULT_NOT_ALLOWED | 409 | 결과 제출: status ≠ playing |
| SCRIM_RESULT_EXISTS | 409 | 결과 제출: 활성 결과(pending·approved) 있음. 부분 고유 인덱스 위반(P2002)도 이 코드 |
| SCRIM_TEAMS_REQUIRED | 409 | 팀 게임 결과 제출: 블루·오렌지 중 joined 참가자가 배정되지 않은 팀이 있음 |
| SCRIM_RESULT_NOT_PENDING | 409 | 승인·반려: pending 결과 없음 또는 `result_id` ≠ 현재 pending 행 id. 제출 취소: pending 결과 없음 |
| SCRIM_RESULT_SELF_REVIEW | 403 | 승인·반려: 요청자 = 제출자(메인 기본값 8) |

- 기존 코드 재사용: `NOT_FOUND`(내전·사용자·시즌 없음), `FORBIDDEN`(방장·운영진 아닌 사람의 밸런스·팀 저장·결과 제출, 운영진 아닌 사람의 승인·반려, 제출자·방장 아닌 사람의 제출 취소), `VALIDATION_FAILED`(zod + 서버 검사: 팀 슬롯 user_id·position, 결과 모양이 게임과 안 맞음, placements user_id — `details[{path, message}]`, path 예 `blue.2.position`, `placements.0.user_id`, `winner_team`).
- 승인 트랜잭션 안의 `rating_history (scrim_id, user_id)` 유일 위반은 정상 흐름에서 생기지 않는다(내전 잠금 + 결과 조건부 갱신) → `INTERNAL_ERROR` + 로그, 전체 롤백.
- 그 밖의 `INTERNAL_ERROR`(오류 목록 밖, 서버 데이터·설정 오류. 모두 로그 + 롤백, 결과는 pending 유지):
  - 승인: 내전 status ≠ playing(5-5 3단계), 개인 순위 결과의 저장 placements가 null·형식 불량(D130), 팀 게임 결과에 winner_team 없음, 승인 시각에 시즌이 없는데 시즌 생성 잠금을 잡지 않은 경우(5-5 7b, 트랜잭션 timeout 초과 의심, D128).
  - `GET /users/:id/rating-history`: 쿼리 game이 유효한 GameCode인데 games 시드 행이 없음(D135).
  - 직렬화: 내전의 games 행 없음.

---

## 3. 스키마 변경 (`apps/api/prisma/schema.prisma`)

마이그레이션: `apps/api/prisma/migrations/20261030120000_s3/migration.sql` — `prisma migrate diff --from-schema-datamodel <S2 최종 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script` 출력(2문장)과 **일치 확인함** + 맨 끝 수동 블록 1문장(부분 고유 인덱스). `DROP INDEX` 줄 없음. `prisma validate` 통과. DB 적용 미실행(Docker 없음).

S0에서 이미 만든 `seasons`·`ratings`·`rating_history`·`scrim_results`·`scrim_players.team/position`을 그대로 쓰고 증분은 작다.

| 대상 | 변경 | 근거 |
| --- | --- | --- |
| rating_history | **추가**: `k_factor int NOT NULL`(기본값 없음 — S3 전에는 쓰는 코드가 없어 표가 비어 있다) | D125 |
| rating_history | **인덱스 추가**: `(user_id, game_id, season_id, created_at)` — 그래프 조회, K 판정 경기 수 `(user_id, game_id)` 접두 사용 | D106, D118 |
| scrim_results | **부분 고유 인덱스(수동 SQL)** `scrim_results_one_active_per_scrim ON (scrim_id) WHERE status IN ('pending','approved')` | D113 |
| seasons, ratings, scrim_players, scrims | 변경 없음 | - |

컬럼 의미(S3 확정):

| 컬럼 | 의미 |
| --- | --- |
| scrim_players.team / position | `PUT /teams`로 저장. joined·no_show 행에만 의미. 명단(joined 집합)이 바뀌는 S2 경로에서 전원 null(5-1). 포지션 미사용 내전은 position 항상 null |
| scrim_results.winner_team | 팀 게임만. 개인 순위 게임 null |
| scrim_results.placements | 개인 순위 게임만, shared `ScrimResultPlacementsJson`(`[{user_id, placement}]`, 제출 그대로). 팀 게임 null |
| scrim_results.submitted_by / created_at | 제출자 / 제출 시각(`submitted_at`) |
| scrim_results.approved_by·approved_at / rejected_by·rejected_at·reject_reason | 승인 / 반려 기록. approved_at = 내전 종료 시각(목록·프로필 `finished_at`) |
| ratings | (user, game, season) 현재값. 행은 그 시즌 첫 반영 때 시드 elo로 만든다(D103). wins/losses는 rated 반영 때만 |
| rating_history | rated 반영 1건 = 1행. created_at = 승인 트랜잭션의 now(= approved_at). season_id = 반영한 시즌 |
| seasons | [starts_at, ends_at) 반열림. S3는 자동 생성만 쓴다(6절) |

---

## 4. 엔드포인트 (S3)

모두 `/api/v1`, JWT. 이름은 shared export, 경로는 `ApiPath`. path `:id`는 UUID(아니면 VALIDATION_FAILED). 오류 판정 순서 = 표의 왼쪽부터(5절 단계 순서).

| 메서드 | 경로 (`ApiPath`) | 권한 | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- | --- |
| POST | /scrims/:id/balance (`scrimBalance`) | 방장·운영진 | `IdParam` + `BalanceScrimRequest`(`{}` 또는 본문 없음) | 200 `BalanceScrimResponse` | VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, SCRIM_TEAMS_NOT_EDITABLE, SCRIM_BALANCE_UNAVAILABLE |
| PUT | /scrims/:id/teams (`scrimTeams`) | 방장·운영진 | `SaveScrimTeamsRequest` | 200 `SaveScrimTeamsResponse`(=ScrimDetail) | VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, SCRIM_TEAMS_NOT_EDITABLE, VALIDATION_FAILED(서버 검사) |
| POST | /scrims/:id/result (`scrimResult`) | 방장·운영진 | `SubmitScrimResultRequest` | 200 `SubmitScrimResultResponse` | VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, SCRIM_RESULT_NOT_ALLOWED, SCRIM_RESULT_EXISTS, VALIDATION_FAILED(모양·user_id), SCRIM_TEAMS_REQUIRED |
| DELETE | /scrims/:id/result (`scrimResult`) | 제출자·방장 | 본문 없음 | 200 `WithdrawScrimResultResponse` | VALIDATION_FAILED, NOT_FOUND, SCRIM_RESULT_NOT_PENDING, FORBIDDEN |
| POST | /scrims/:id/result/approve (`scrimResultApprove`) | **운영진** | `ApproveScrimResultRequest {result_id}` | 200 `ApproveScrimResultResponse` | FORBIDDEN, VALIDATION_FAILED, NOT_FOUND, SCRIM_RESULT_NOT_PENDING, SCRIM_RESULT_SELF_REVIEW |
| POST | /scrims/:id/result/reject (`scrimResultReject`) | **운영진** | `RejectScrimResultRequest {result_id, reason}` | 200 `RejectScrimResultResponse` | FORBIDDEN, VALIDATION_FAILED, NOT_FOUND, SCRIM_RESULT_NOT_PENDING, SCRIM_RESULT_SELF_REVIEW |
| GET | /seasons (`seasons`) | 멤버 | - | 200 `ListSeasonsResponse`(next_cursor 항상 null) | - |
| GET | /users/:id/rating-history (`userRatingHistory`) | 멤버 | `GetUserRatingHistoryParams` + `GetUserRatingHistoryQuery {game, season?}` | 200 `GetUserRatingHistoryResponse` | VALIDATION_FAILED, NOT_FOUND(사용자·시즌) |
| GET | /scrims (기존) | 멤버 | 그대로 | `ScrimSummary`에 `result_status`·`outcome` 추가 | 그대로 |
| GET | /scrims/:id (기존) | 멤버 | 그대로 | `ScrimDetail`: `balance`·`result` 객체화, players·viewer 필드 추가 | 그대로 |
| GET | /users/:id/profile (기존) | 멤버 | 그대로 | `scrim`이 `ProfileScrim`(S3부터 항상 객체) | 그대로 |

- 문서 6장 대비: `balance`·`result`·`result/approve`는 문서 경로 그대로. 문서에 없는 것: `PUT /teams`(7-2 4번 「선택하거나 직접 수정」 저장, D109), `DELETE /result`(목업 「제출 취소」, D112), `/result/reject`(슬라이스 「반려 API」), `/seasons`(D120), `/users/:id/rating-history`(D118). 문서 6장 「결과 입력(방장)」을 메인 기본값 8에 따라 운영진도 허용.
- 상태를 바꾸는 5개(팀 저장·제출·제출 취소·승인·반려)는 갱신 후 `ScrimDetail`(D87). 밸런스는 계산만 하므로 잠금·쓰기 없음.
- 승인·반려는 `@Roles('admin')` 가드가 먼저라 FORBIDDEN이 NOT_FOUND보다 앞선다(S2 노쇼와 같음). 나머지는 내전 존재 확인(NOT_FOUND) 다음에 권한.
- 직렬화는 반드시 shared parse(D38). 새 필드가 모두 필수라 **backend·목이 채우기 전에는 기존 GET /scrims·/scrims/:id·/users/:id/profile도 parse 실패(500)**다(typecheck로 안 잡힘, 15절).

### 4-1. 응답 노출 매핑

**`ScrimSummary` 추가 필드(목록·상세 공통)**

| 필드 | 값 | 계산 |
| --- | --- | --- |
| result_status | 가장 최근 결과 행의 status, 없으면 null. 정렬 = created_at DESC → 활성 행(pending·approved) 먼저 → id DESC(D131, `scrim-views.service.ts` `latestFirst`) | 페이지 내전 id로 scrim_results `findMany` 1회 + 메모리에서 내전별 첫 행 선택(D131. 내전당 행 = 반려 횟수 + 1이라 작다. `DISTINCT ON`과 결과·쿼리 수 같음) |
| outcome | status finished일 때만: 팀 게임 `{winner_team, winner: null}`, 개인 순위 `{winner_team: null, winner: placement 1 사용자}`. 그 외 null | 같은 조회 + 1위 사용자 1회 조회(N+1 금지) |

**`ScrimDetail` 변경**

| 필드 | 값 |
| --- | --- |
| players[].team·position | 저장값 그대로(no_show 행도 저장값 표시) |
| players[].position_preference | team·position 있고 use_positions일 때 core `positionPreferenceOf(preferred_positions, position)`, 그 외 null |
| players[].skill | core `computeSkill({seasonElo, gamesPlayed, tierSeed})` — 현재 시즌(now 기준, 조회는 시즌을 만들지 않음) ratings.elo(없으면 null), (user, game) rating_history 수, 티어 시드(D103). 시즌이 없으면 seasonElo null |
| players[].is_new | gamesPlayed < `SCRIM_ELO_NEW_PLAYER_GAMES` |
| balance | `ScrimTeamsView` — has_teams이고 블루·오렌지 모두 joined(노쇼 제외) 배정자 1명 이상일 때 core `evaluateTeams` 결과, 그 외 null. `unassigned_user_ids` = joined인데 team null(players 순서). elo_preview는 rated일 때만 |
| result | 최근 결과 행(위 result_status와 같은 정렬, D131) → `ScrimResultView`. placements는 저장 JSON을 placement 오름차순으로, 사용자 정보 조인(탈퇴 등으로 없으면 그 행 생략). rating_status = rated=false → not_rated / approved & 이력 행 ≥ 1 → applied / approved & 이력 0 → skipped / 그 외 waiting. rating_changes = 이 내전 rating_history 전원(delta DESC, user id ASC), team = 그 사용자의 현재 scrim_players.team(팀 게임), placement = 반영 때 다시 매긴 순위(아래), outcome = 팀 게임 team = winner_team, 개인 순위 `isPlacementWin(rank, 반영 인원)`. season = 이력의 season |
| viewer.can_* 5개 | shared `ScrimViewer` 주석 규칙(서버 계산, 요청 처리 때 다시 검사) |

개인 순위 `rating_changes[].placement`: 저장 placements에서 이력 행이 있는 사용자만 placement 오름차순으로 1부터 다시 매긴 값(core `selectRatedParticipants`와 같은 규칙). 이력 행에 순위를 따로 저장하지 않는다.

**`ProfileScrim`(프로필 `scrim`)**

| 필드 | 값 |
| --- | --- |
| season | core `resolveSeasonAt(seasons, now)`, 없으면 null(조회는 시즌을 만들지 않는다) |
| ratings | season의 ratings 행(이 사용자) 게임별, games.sort_order 순. games = wins + losses, win_rate = core `computeWinRate` |
| recent | 이 사용자 scrim_players 행이 joined·no_show이고 scrim.status = finished인 내전, 승인 결과 approved_at DESC(같으면 id ASC) 최신 10개(`PROFILE_RECENT_SCRIMS_SCAN_LIMIT`, D138) 중 최대 5. outcome: no_show 행 → no_show / 팀 게임 team null 또는 개인 순위 placements에 없음 → unassigned / 팀 게임 team = winner_team → win, 아니면 loss / 개인 순위는 **레이팅 반영과 같은 기준(D136)**: 그 내전의 **승인 때 반영된 참가자**(rating_history 행 사용자, D138) — 이력이 없으면(rated=false·skip) 그 내전 참가자 전원의 현재 status — 로 core `selectRatedParticipants({hasTeams: false, players, placements})`(노쇼·순위 없음 제외 후 1..M 재순위) → 내가 ranked에 있으면 `isPlacementWin(재순위, M)`(상위 절반 승, D105), 없으면(kind skip, M < 2) unassigned. **rated=false 내전도 같은 기준**(이력이 없어도 계산, 현재 status 기준). 이력이 없는 개인 순위 내전들의 참가자 행만 한 번에 조회(N+1 금지). elo_delta = 이 내전 rating_history 행 delta(없으면 null). placement = 제출 순위 그대로(표시용, 승패 판정에는 재순위) |

**`GET /users/:id/rating-history`**: season 없음 → `resolveSeasonAt(now)` → 없으면 `latestStartedSeason(now)` → 없으면 `{season: null, rating: null, points: [], truncated: false}`. 쿼리 season이 없는 id → NOT_FOUND. points = (user, game, season) 이력 created_at DESC로 101개 조회 → 100개만, 오래된 순으로 뒤집음, truncated = 101번째 있음. scrim_title = scrims.title. rating = 그 시즌 ratings 행.

**`GET /seasons`**: 전체, starts_at DESC·id ASC. is_current = `resolveSeasonAt(seasons, now)`가 고른 행만 true.

---

## 5. 흐름 (서버)

### 5-0. 공통

- 쓰기 경로(팀 저장·제출·제출 취소·승인·반려)는 모두 한 트랜잭션에서 **S2 5-0 내전 행 잠금**(`SELECT … FROM scrims WHERE id=$1 FOR UPDATE`)을 첫 문장으로 한다. 잠금 경로는 S2 7개 + S3 5개 = 12개.
- 내전 잠금 경로의 트랜잭션은 모두 `apps/api/src/common/scrim-tx.ts` `scrimWriteTx`로 연다: timeout `SCRIM_TX_TIMEOUT_MS` 15000ms(잠금 대기 포함, 커밋까지), maxWait `SCRIM_TX_MAX_WAIT_MS` 5000ms. 승인만 isolation READ COMMITTED 명시(D129).
- 「활성 결과」 = 그 내전의 status ∈ {pending, approved} 결과 행(최대 1개, D113). 「eligible 참가자」 = scrim_players.status = joined(노쇼·대기·취소 제외).
- 상태 변경은 `canTransition` 검사 후에만(scrims playing → finished, scrim_results pending → approved | rejected).

### 5-1. S2 경로 보완: 명단이 바뀌면 팀 초기화 (D110)

S2 참가(새 참가 확정·재참가, D131), 5-3(참가 취소: joined → cancelled, 대기 승격 포함), 5-4(정원 수정으로 승격)에서 **joined 집합이 바뀐 경우** 같은 트랜잭션에서 `resetTeams`(`scrims.service.ts`) = `UPDATE scrim_players SET team = NULL, position = NULL WHERE scrim_id = $1`. 대기 등록·대기자 취소처럼 joined 집합이 그대로면 하지 않는다. 노쇼 표시·정정(5-7)은 팀을 지우지 않는다(노쇼는 반영 단계에서 빠진다). 재참가(cancelled → joined)는 위 초기화로 이미 null이지만 방어적으로 그 행의 team·position도 null로 쓴다.

### 5-2. 밸런스 `POST /scrims/:id/balance` (잠금 없음, 쓰기 없음)

1. 내전 조회 → NOT_FOUND. 요청자 ≠ 방장 && role ≠ admin → FORBIDDEN.
2. `!game.has_teams` 또는 status ∉ {full, playing} 또는 활성 결과 있음 → SCRIM_TEAMS_NOT_EDITABLE.
3. `!scrim.auto_balance` → SCRIM_BALANCE_UNAVAILABLE. eligible 참가자 n ∉ [2, 16] → SCRIM_BALANCE_UNAVAILABLE.
4. 참가자별 입력 모으기(한 번에 조회): 현재 시즌 ratings.elo, (user, game) rating_history 수, 티어 시드(D103) → `computeSkill`, rating = seasonElo ?? tierSeed.
5. `balanceTeams({players(players 순서 = 상세 슬롯 순서), usePositions: scrim.use_positions && game.has_positions, positions: game.positions})`. RangeError(한 팀 > 포지션 수) → SCRIM_BALANCE_UNAVAILABLE.
6. 응답: options(rank 1부터), 각 side에 elo_preview(rated일 때 `previewTeamElo({blueAvg: ratingAvg, orangeAvg, k: kBase})`), total_cost·power_diff 반올림, `partitions_evaluated`, `used_positions`, `rating_policy`(env 실제 값 + `BALANCE_FULL_WEIGHT_GAMES`).

### 5-3. 팀 저장 `PUT /scrims/:id/teams` (D109)

트랜잭션 + 잠금:
1. NOT_FOUND → FORBIDDEN(방장·운영진 아님) → SCRIM_TEAMS_NOT_EDITABLE(5-2 2번과 같은 조건). `auto_balance=false`여도 허용(메인 기본값 4).
2. core `validateTeamAssignment({eligibleUserIds, blue, orange, usePositions, positions})` → issues 있으면 VALIDATION_FAILED(details 모아서). 규칙: user_id ∈ eligible, usePositions면 position 필수·positions 안·팀 인원 ≤ positions 수, 아니면 position null.
3. 그 내전 joined·no_show 전원 team·position = null → 요청 슬롯대로 갱신(포지션 미사용 2–3회, 포지션 사용 슬롯별 최대 16회). 상태 전이 없음.
4. 200 ScrimDetail.

### 5-4. 결과 제출 `POST /scrims/:id/result`, 제출 취소 `DELETE /scrims/:id/result`

**제출** — 트랜잭션 + 잠금:
1. NOT_FOUND → FORBIDDEN(방장·운영진 아님) → status ≠ playing → SCRIM_RESULT_NOT_ALLOWED → 활성 결과 있음 → SCRIM_RESULT_EXISTS.
2. 모양 검사: has_teams인데 `placements` 모양, 또는 개인 순위 게임인데 `winner_team` 모양 → VALIDATION_FAILED(path = 잘못 보낸 필드: 팀 게임에 placements면 `placements`, 개인 순위 게임에 winner_team이면 `winner_team`. 목도 같다 — 교차 QA 결함 2, 리더 결정).
3. 팀 게임: 블루·오렌지 각각 eligible 배정자 ≥ 1 아니면 SCRIM_TEAMS_REQUIRED. 개인 순위: core `validatePlacementUsers({eligibleUserIds, placements})` → VALIDATION_FAILED. (빠진 joined 참가자 허용, D111)
4. insert scrim_results(status pending, winner_team | placements JSON, submitted_by = 요청자). P2002(부분 고유) → SCRIM_RESULT_EXISTS. 팀은 이때부터 잠긴다(5-2·5-3 조건).
5. 200 ScrimDetail. 내전 상태는 playing 그대로.

**제출 취소** — 트랜잭션 + 잠금: NOT_FOUND → pending 행 없음 → SCRIM_RESULT_NOT_PENDING → 요청자 ≠ 제출자 && ≠ 방장 → FORBIDDEN → pending 행 DELETE(D112) → 200 ScrimDetail. approved·rejected 행은 지우지 않는다.

### 5-5. 승인 `POST /scrims/:id/result/approve` (D114–D117)

`@Roles('admin')` → `scrimWriteTx`(READ COMMITTED, 5-0) 안에서 아래 순서. 잠금 순서는 **내전 행 → 시즌 advisory(필요할 수 있을 때만) → 사용자 advisory(user_id 오름차순)** 고정(교착 방지, D117). 구현: `scrim-results.service.ts` `approve`, `ratings/seasons.service.ts` `lockIfMayCreate`·`resolveForApproval`, `ratings/rating-locks.ts`.

단계 번호는 다른 절의 참조용이고, **실행 순서**는 rated 반영이 있으면 1 → 2 → 3 → 5 → 6 → 7a → 8 → 4 → 7b → 9 → 10 → 11 → 12 → 13, 없으면 1 → 2 → 3 → 5 → 6 → 4 → 12 → 13이다(D128).

1. 내전 행 FOR UPDATE → NOT_FOUND.
2. pending 결과 행 조회. 없거나 id ≠ body.result_id → SCRIM_RESULT_NOT_PENDING. submitted_by = 요청자 → SCRIM_RESULT_SELF_REVIEW.
3. status ≠ playing → INTERNAL_ERROR + 로그(제출은 playing에서만, playing은 finished로만 가므로 생기지 않음).
4. **now 확정(D128)**: rated 반영이 있으면 8단계 사용자 잠금을 모두 얻은 **직후**, 없으면(rated=false·skip — 잠금이 내전 행뿐) 5·6단계 판정 직후 `clock.now()` 한 번. approved_at, rating_history.created_at, 시즌 판정(7b)에 같은 값. 잠금 대기 전에 정하면 같은 사용자를 먼저 반영한 다른 승인보다 이른 created_at이 찍혀 그래프(created_at 순)가 어긋난다.
5. **반영 대상**: core `selectRatedParticipants({hasTeams, players(현재 status·team), placements})` (D115). 개인 순위 게임인데 저장 placements가 null·형식 불량이면 INTERNAL_ERROR(롤백, D130).
   - 팀 게임: status joined && team != null. 한 팀이라도 0명 → `skip`.
   - 개인 순위: placements 중 status joined인 사용자, placement 오름차순으로 1..M 다시 매김. M < 2 → `skip`.
6. `scrim.rated && kind ≠ skip`일 때만 7–11단계.
7. 시즌(두 부분, D116·D128):
   - **7a(8단계 전)** `lockIfMayCreate(tx, 지금 시각, SCRIM_TX_TIMEOUT_MS)`: 시즌 전체 조회 → `resolveSeasonAt(seasons, 지금)`. 시즌이 없거나, 있어도 `ends_at − 지금 ≤ 15000ms`(트랜잭션 timeout 안에 끝날 수 있음)면 `SELECT pg_advisory_xact_lock(hashtext('season-auto-create'))`(1-인자 형식)를 잡고 true. 그 외에는 잠금 없이 false — 트랜잭션은 timeout 15초 안에 끝나므로 now도 그 시즌 안이다. now를 아직 모르므로 「지금 + 트랜잭션 상한」으로 미리 판정해 잠금 순서(시즌 → 사용자)를 지킨다.
   - **7b(4단계 now 확정 뒤)** `resolveForApproval(tx, now, holdsCreateLock)`: 시즌 전체 다시 조회(READ COMMITTED라 먼저 커밋된 다른 승인의 자동 생성 시즌이 보인다) → `resolveSeasonAt(seasons, now)`. 있으면 그 시즌. 없고 7a에서 잠금을 잡았으면 `planAutoSeason({seasons, at: now, lengthMonths: SEASON_AUTO_LENGTH_MONTHS})`로 1개 insert(6절). 없는데 잠금이 없으면 INTERNAL_ERROR + 로그(timeout 초과 의심, 롤백).
8. 대상 user_id 오름차순(중복 제거, uuid 소문자 문자열 비교)으로 `SELECT pg_advisory_xact_lock(hashtext('rating:' || $game_id), hashtext($user_id))`(2-인자 형식, `lockUserRatings`). 같은 사용자의 다른 내전 승인과 레이팅 갱신·경기 수 집계를 직렬화한다(D117).
9. 잠금 아래에서: ratings (user, game, season) 조회, 없는 사용자는 시드로 `createMany({ skipDuplicates: true })`(= `INSERT … ON CONFLICT DO NOTHING`, 유일 키 `(user_id, game_id, season_id)`) 후 다시 조회(시드 = D103, 그 시점 티어). gamesPlayed = (user, game) rating_history 수(이번 내전 반영 전, groupBy 1회).
10. core 계산: 팀 → `computeTeamEloUpdates({blue, orange, winner, policy})`, 개인 → `computePlacementEloUpdates({players, policy})`. policy = env K 값.
11. 쓰기: ratings 각 행 `elo = eloAfter`, outcome win → wins + 1, loss → losses + 1. rating_history insert(elo_before·after, k_factor, scrim_result_id, game_id, season_id, created_at = now). 유일 위반 → INTERNAL_ERROR(롤백).
12. 결과 행 `UPDATE scrim_results SET status='approved', approved_by, approved_at = now WHERE id = $1 AND status = 'pending'` — 영향 행 1 아니면 롤백 + SCRIM_RESULT_NOT_PENDING(이중 승인 마지막 방어, 메인 기본값 10).
13. scrims playing → finished(`canTransition`). `scrims` 다른 컬럼 변경 없음.
14. 커밋 후 200 ScrimDetail(result.rating_status: applied | skipped | not_rated).

- 같은 결과 동시 승인 2건: 둘째는 1단계 잠금 대기 → 첫째 커밋 후 2단계에서 pending 없음 → SCRIM_RESULT_NOT_PENDING.
- 같은 사용자가 낀 두 내전 동시 승인: 내전 잠금은 다르고, 8단계 사용자 잠금에서 직렬화 → 둘째는 첫째의 elo·경기 수를 보고, now가 잠금 뒤라 둘째 created_at ≥ 첫째 created_at.
- 시즌 없음에서 동시 승인 2건: 둘 다 7a에서 `season-auto-create`를 기다려 직렬화 → 둘째는 7b 재조회에서 첫째가 만든 시즌을 쓴다(시즌 1개).
- 승인 뒤 노쇼 표시·정정(S2 5-7, 시작 후 7일)은 허용되고 이미 반영된 레이팅·이력을 바꾸지 않는다(메인 기본값 7). 승인된 결과는 수정·취소 불가(메인 기본값 9, S6).

### 5-6. 반려 `POST /scrims/:id/result/reject`

`@Roles('admin')` → 트랜잭션 + 잠금 → 5-5 1–2단계와 같은 검사(NOT_FOUND, NOT_PENDING, SELF_REVIEW) → `UPDATE … SET status='rejected', rejected_by, rejected_at = now, reject_reason = body.reason WHERE id AND status='pending'`(0행이면 NOT_PENDING) → 200 ScrimDetail. 내전은 playing 유지, 활성 결과가 없어져 팀 수정·재제출이 다시 열린다.

---

## 6. 시즌 (D116)

- 반영 시즌 = **승인 시각이 속한 시즌**: `starts_at ≤ now < ends_at`. 여럿이면 starts_at 최신, 같으면 id 문자열 작은 것.
- 시즌이 없을 때(행이 하나도 없거나, 승인 시각이 어느 구간에도 없음): 승인 트랜잭션이 자동으로 만든다(`planAutoSeason`):
  1. prev = ends_at ≤ at인 시즌 중 ends_at 최대. start = prev ? prev.ends_at : `kstMonthStart(at)`(at의 KST 달 1일 00:00).
  2. end = `addKstMonths(start, lengthMonths)`. end ≤ at이면 start = end로 넘겨 반복(빈 기간은 빈 시즌을 만들지 않고 건너뛴다 — 만드는 행은 at을 포함하는 1개뿐).
  3. next = starts_at > at인 시즌 중 starts_at 최소. end > next.starts_at이면 end = next.starts_at(겹치지 않게).
  4. name = `autoSeasonName(기존 행 수 + 1)` → 「시즌 N」.
  - 예: 시즌 없음, at = 2026-11-03 KST → 2026-11-01 00:00 KST ~ 2027-02-01 00:00 KST 「시즌 1」. 그 시즌이 끝난 뒤 2027-03-10 승인 → 2027-02-01 ~ 2027-05-01 「시즌 2」.
- 조회 경로(상세 skill·밸런스·프로필·그래프·`/seasons`)는 시즌을 만들지 않는다. 현재 시즌이 없으면 seasonElo = null(→ 실력값 = 시드)로 계산한다.
- 시즌이 바뀌면(새 시즌 첫 반영) 그 시즌 ratings 행을 시드로 새로 만든다(D103). 이전 시즌 값 이월·소프트 리셋은 S4 이후. K 판정 경기 수는 시즌과 무관(D106)이라 시즌이 바뀌어도 신규 K로 돌아가지 않는다.
- `addKstMonths`: KST 달력 기준 월 더하기, 일이 그 달 말일을 넘으면 말일로 자르고 시각(KST)은 유지.

---

## 7. core 함수 (`packages/core`, domain-logic) — 새 파일 `src/rating.ts`, `src/balance.ts`, `src/season.ts`

I/O 없음, 시각은 인자. env 값은 인자로. 모두 단위 테스트 필수(문서 10장 「한번 잘못 반영된 레이팅은 되돌리기 어렵다」). `index.ts`에 export 추가.

### 7-1. 상수 (`src/config.ts`에 추가, 설정값 아님)

```ts
/** 티어 시드(D103, 메인 기본값 1). 디비전·LP 무시. UNRANKED·티어 없음 = RATING_SEED_DEFAULT */
export const RATING_SEED_BY_TIER: Readonly<Record<RiotTier, number>> = {
  IRON: 600, BRONZE: 800, SILVER: 1000, GOLD: 1200, PLATINUM: 1400,
  EMERALD: 1600, DIAMOND: 1800, MASTER: 2000, GRANDMASTER: 2000, CHALLENGER: 2000,
};
export const RATING_SEED_DEFAULT = 1000;
/** 기대 승률 식 분모(문서 7-1) */
export const ELO_SCALE = 400;
/** 포지션 비용(문서 7-2 3번) */
export const POSITION_PREFERENCE_COST = { first: 0, second: 1, other: 3 } as const;
/** 총 비용 = 전력 차 + λ × 포지션 비용 (D108, 메인 기본값 5) */
export const BALANCE_POSITION_COST_WEIGHT = 50;
// BALANCE_FULL_WEIGHT_GAMES(10), BALANCE_OPTIONS_MAX(3), BALANCE_PLAYERS_MIN/MAX(2/16)는 @gcd/shared 값을 쓴다
```

### 7-2. 타입

```ts
export type EloPolicy = { kBase: number; kNew: number; newPlayerGames: number };
export type RatedPlayer = { userId: string; elo: number; gamesPlayed: number };
export type EloUpdate = {
  userId: string; eloBefore: number; eloAfter: number; delta: number; kFactor: number;
  outcome: 'win' | 'loss'; placement: number | null; // 개인 순위: 다시 매긴 순위, 팀: null
};
export type BalancePlayer = { userId: string; skill: number; rating: number; preferredPositions: readonly string[] };
export type TeamMemberPlan = { userId: string; position: string | null; preference: PositionPreference | null };
export type TeamPlan = { members: TeamMemberPlan[]; skillSum: number; skillAvg: number; ratingAvg: number; positionCost: number };
export type TeamsEvaluation = { blue: TeamPlan; orange: TeamPlan; powerDiff: number; positionCost: number; blueWinProbability: number };
export type BalanceResult = TeamsEvaluation & { totalCost: number };
export type SeasonLike = { id: string; startsAt: Date; endsAt: Date };
export type ValidationIssue = { path: string; message: string };
```

### 7-3. 레이팅 (`src/rating.ts`, 문서 7-1)

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| tierSeedRating | `(tier: RankTier \| null \| undefined) => number` | RATING_SEED_BY_TIER, UNRANKED·null·undefined → 1000 |
| eloKFactor | `(gamesPlayed: number, policy: EloPolicy) => number` | gamesPlayed < newPlayerGames → kNew, 아니면 kBase. gamesPlayed = 이번 경기 반영 **전** 수 |
| expectedScore | `(ratingA: number, ratingB: number) => number` | `1 / (1 + 10^((B − A)/400))` |
| roundHalfAwayFromZero | `(x: number) => number` | `sign(x) × round(|x|)` (−2.5 → −3, 2.5 → 3). 부동소수 오차 대비 `|x|`에 1e-9를 더한 뒤 floor(+0.5) |
| meanRating | `(values: readonly number[]) => number` | 산술 평균(반올림 안 함). 빈 배열 RangeError |
| computeTeamEloUpdates | `(input: { blue: readonly RatedPlayer[]; orange: readonly RatedPlayer[]; winner: ScrimTeam; policy: EloPolicy }) => EloUpdate[]` | R_blue = mean(blue elo), R_orange 동일. E_blue = expectedScore(R_blue, R_orange), E_orange = 1 − E_blue. 각 i: S = 1(승리 팀)/0, k = eloKFactor(i.gamesPlayed), delta = roundHalfAwayFromZero(k × (S − E_team)), eloAfter = elo + delta. 한 팀이 비면 RangeError. 출력 순서 = blue 입력 순서 → orange. 하한 없음 |
| computePlacementEloUpdates | `(input: { players: readonly (RatedPlayer & { placement: number })[]; policy: EloPolicy }) => EloUpdate[]` | M = 인원 ≥ 2(아니면 RangeError), placement 중복 RangeError. placement 오름차순으로 rank 1..M. 각 i: raw = Σ_{j≠i} (S_ij − expectedScore(R_i, R_j)), S_ij = rank_i < rank_j ? 1 : 0. delta = roundHalfAwayFromZero(k_i / (M − 1) × raw)(메인 기본값 3). outcome = isPlacementWin(rank, M). placement = rank. 출력 rank 순 |
| isPlacementWin | `(rank: number, count: number) => boolean` | `2 × rank ≤ count`(상위 절반, 8명이면 1–4위, 3명이면 1위만) (D105) |
| computeWinRate | `(wins: number, losses: number) => number \| null` | 합 0 → null, 아니면 wins ÷ 합을 소수 셋째 자리 반올림 |
| previewTeamElo | `(input: { blueAvg: number; orangeAvg: number; k: number }) => { blue: { win: number; lose: number }; orange: { win: number; lose: number } }` | E_b = expectedScore(blueAvg, orangeAvg). blue.win = round(k(1 − E_b)), blue.lose = round(k(0 − E_b)), orange는 E_o = 1 − E_b로 같은 식. 반올림 = roundHalfAwayFromZero |
| selectRatedParticipants | `(input: { hasTeams: boolean; players: readonly { userId: string; status: ScrimPlayerStatus; team: ScrimTeam \| null }[]; placements: readonly { userId: string; placement: number }[] \| null }) => { kind: 'teams'; blue: string[]; orange: string[] } \| { kind: 'placements'; ranked: { userId: string; placement: number }[] } \| { kind: 'skip' }` | D115. 팀: status joined && team, 한 팀 0명 → skip. 개인: placements 중 status joined, placement 오름차순으로 1..M 재부여, M < 2 → skip. blue·orange·ranked는 입력 players 순서 / 순위 순 |

검증 예(테스트 필수): 1000 vs 1000, K 32 → 승 +16 / 패 −16. 팀 평균 1400 vs 1300, K 32 → E = 0.640 → 승 +12, 패 −20(목업 「승리 +X · 패배 −Y」와 같은 식). 신규(경기 9) → K 40, 경기 10 → 32. 개인 순위 4명 동일 1000, K 32 → 1위 +16, 2위 +5(+5.33), 3위 −5, 4위 −16 → 합계 0. 반올림 경계 x.5 양쪽 부호.

### 7-4. 밸런스 (`src/balance.ts`, 문서 7-2)

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| computeSkill | `(input: { seasonElo: number \| null; gamesPlayed: number; tierSeed: number }) => number` | rating = seasonElo ?? tierSeed. w = min(gamesPlayed / BALANCE_FULL_WEIGHT_GAMES, 1). roundHalfAwayFromZero(w × rating + (1 − w) × tierSeed). 정수 (D107) |
| positionPreferenceOf | `(preferred: readonly string[], position: string) => PositionPreference` | preferred[0] = position → first, preferred[1] → second, 그 외 other |
| bestPositionAssignment | `(members: readonly BalancePlayer[], positions: readonly string[]) => { positions: string[]; cost: number }` | 서로 다른 포지션을 한 명씩 배정하는 모든 경우(P(|positions|, k), 5명이면 120) 중 비용 합 최소. 동점 → members 순서대로 본 포지션 index 수열이 사전순 가장 작은 것. k > |positions| → RangeError. k = 0 → `{[], 0}`. **포지션 5개 이하 게임 전제(D134)**: 6개 이상 게임을 추가하기 전에 비트마스크 DP로 바꾼다 |
| balanceTeams | `(input: { players: readonly BalancePlayer[]; usePositions: boolean; positions: readonly string[]; maxOptions?: number }) => { options: BalanceResult[]; partitionsEvaluated: number }` | 아래 규칙 |
| evaluateTeams | `(input: { blue: readonly (BalancePlayer & { position: string \| null })[]; orange: readonly (BalancePlayer & { position: string \| null })[]; usePositions: boolean }) => TeamsEvaluation` | 저장된 팀 요약(상세 balance). 포지션은 주어진 값으로 비용 계산(usePositions && position 있을 때만, 없으면 그 사람 비용 0·preference null). 공식은 balanceTeams와 같다. members 순서 = 입력(슬롯) 순서 그대로(D134). 한 팀이 비면 RangeError(backend는 그 경우 balance null) |
| validateTeamAssignment | `(input: { eligibleUserIds: readonly string[]; blue: readonly { userId: string; position: string \| null }[]; orange: readonly { userId: string; position: string \| null }[]; usePositions: boolean; positions: readonly string[] }) => ValidationIssue[]` | 5-3 2번. path는 `blue.{i}.user_id`·`blue.{i}.position`·`blue`(인원 초과). 빈 배열 = 통과 |
| validatePlacementUsers | `(input: { eligibleUserIds: readonly string[]; placements: readonly { userId: string }[] }) => ValidationIssue[]` | user_id ∉ eligible → `placements.{i}.user_id`. 형식(1..n·중복)은 shared zod가 이미 검사 |

**balanceTeams 규칙 (D108)**

1. n = players.length, 2 ≤ n ≤ 16 아니면 RangeError. usePositions && ⌈n/2⌉ > positions.length → RangeError. maxOptions 기본 BALANCE_OPTIONS_MAX(3).
2. 팀 나누기: 크기 ⌊n/2⌋인 부분집합 S를 모두 본다. n 짝수면 players[0]을 포함하는 S만(거울상 제외). n 홀수면 모든 S(작은 팀 S, 큰 팀 나머지). **블루 = players[0]이 있는 쪽**, 오렌지 = 다른 쪽. partitionsEvaluated = 짝수 C(n, n/2)/2, 홀수 C(n, ⌊n/2⌋)(10명 126, 16명 6435, 9명 126).
3. 팀별: skillSum, skillAvg = skillSum / 인원(반올림 전), ratingAvg = rating 평균(반올림 전). usePositions면 팀마다 `bestPositionAssignment` → positionCost, 아니면 0·position null.
4. powerDiff = |skillAvg_blue − skillAvg_orange| × n / 2 (두 팀 인원이 같으면 = |합의 차|, 문서 7-2 2번). positionCost = 두 팀 합. totalCost = powerDiff + BALANCE_POSITION_COST_WEIGHT × positionCost. blueWinProbability = expectedScore(skillAvg_blue, skillAvg_orange)(실력값 기준, D108).
5. 정렬(동점 처리): totalCost ASC → powerDiff ASC → positionCost ASC → 블루 쪽 players index 오름차순 수열 사전순 ASC(홀수 인원은 블루가 ⌊n/2⌋명일 수도 ⌈n/2⌉명일 수도 있어 길이가 다를 수 있다 — 접두가 같으면 짧은 쪽 먼저, D134). 실수 비교는 |a − b| ≤ 1e-9를 같음으로. 서로 다른 팀 나누기만 상위 maxOptions개(같은 나누기의 다른 포지션 배정은 별도 안이 아니다).
6. members 순서: usePositions면 positions 순서, 아니면 skill DESC → userId ASC. (evaluateTeams는 이 규칙을 쓰지 않고 입력 순서, D134)
7. 표시 값 반올림(skill_avg·rating_avg·power_diff·total_cost 정수, blue_win_probability 소수 셋째 자리)은 backend 직렬화에서 한다. core 결과는 반올림 전 값.

테스트(필수): 10명 → partitionsEvaluated 126, 결과 3개가 서로 다른 나누기·비용 오름차순, 무작위 입력을 단순 전수(브루트포스 기준 구현)와 대조, 포지션 비용 1지망 0·2지망 1·그 외 3, λ 효과(전력 차 40 + 비용 0 vs 전력 차 0 + 비용 1 → 앞이 낮음), 2명(1:1, 나누기 1가지 → 안 1개), 4명 포지션 사용(2:2, 팀당 P(5,2) = 20), 9명 홀수, 16명 성능, 입력 순서 동일하면 결과 동일(결정적), 모든 실력값 동일 → 동점 규칙으로 index 사전순.

16명 성능(D137): 「16명 < 200ms」는 **성능 목표**(단독 실행 기준, 6435가지 나누기·포지션 미사용)다. 단위 테스트는 같은 입력으로 1회 워밍업한 뒤 측정하고, vitest 병렬 실행 부하를 감안한 **회귀 상한 1000ms**로 단언한다(`partitionsEvaluated = 6435`도 함께). 상한은 지수적 회귀(예: D134 전제를 깬 포지션 6개 이상 탐색)를 잡기 위한 값이며, 200ms 목표를 완화하는 것이 아니다.

### 7-5. 시즌 (`src/season.ts`, D116)

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| resolveSeasonAt | `<T extends SeasonLike>(seasons: readonly T[], at: Date) => T \| null` | startsAt ≤ at < endsAt. 여럿 → startsAt 최신, 같으면 id ASC |
| latestStartedSeason | `<T extends SeasonLike>(seasons: readonly T[], at: Date) => T \| null` | startsAt ≤ at 중 startsAt 최신(같으면 id ASC). 그래프 기본 시즌 대체용 |
| kstMonthStart | `(d: Date) => Date` | d의 KST 달 1일 00:00:00.000 KST |
| addKstMonths | `(d: Date, months: number) => Date` | 6절 마지막 줄 |
| planAutoSeason | `(input: { seasons: readonly SeasonLike[]; at: Date; lengthMonths: number }) => { name: string; startsAt: Date; endsAt: Date }` | 6절 1–4. 결과는 항상 startsAt ≤ at < endsAt, 기존 시즌과 겹치지 않음(테스트로 보인다). name = shared `autoSeasonName(seasons.length + 1)`. resolveSeasonAt(seasons, at) ≠ null인 입력이면 RangeError |

---

## 8. 상태 전이 (`packages/shared/src/constants/transitions.ts` — 맵 변경 없음, 주석만)

```
scrims:         … playing → finished      (5-5 승인 13단계. S3에서 처음 쓰는 전이)
scrim_results:  (insert) → pending         (5-4 제출)
                pending → approved          (5-5 승인)
                pending → rejected          (5-6 반려)
                pending → (delete)          (5-4 제출 취소, 전이 아님)
scrim_players:  status 전이 추가 없음. team·position만 5-1·5-3에서 바뀐다
```

S2 전이와의 관계: 팀 구성은 full·playing에서, 결과는 playing에서만 다룬다. playing → finished는 결과 승인으로만 일어나므로 S2 자동 마감(recruiting·full만 대상)과 겹치지 않는다. 반려·제출 취소는 내전 상태를 바꾸지 않는다(playing 유지).

| 전이·변경 | 일으키는 곳 |
| --- | --- |
| scrims playing → finished | 5-5 |
| scrim_results insert pending | 5-4 제출 |
| scrim_results pending → approved / rejected | 5-5 / 5-6 |
| scrim_results pending delete | 5-4 제출 취소 |
| scrim_players.team·position 저장 | 5-3 |
| scrim_players.team·position 전원 null | 5-1(S2 새 참가·참가 취소·정원 수정에서 joined 집합 변경, D131) |
| ratings insert(시드) / update | 5-5 9·11단계 |
| rating_history insert | 5-5 11단계 |
| seasons insert | 5-5 7b단계(자동 생성, 7a에서 잡은 잠금 아래) |

웹 진행 단계(목업 「모집 · 팀 구성 · 경기 진행 · 결과 승인」, S2 6절 표 대체):

| 조건 | 표시 |
| --- | --- |
| recruiting | 1단계 진행 중(join_closed면 「시작 대기」) |
| full | 1단계 완료, 2단계 진행 중 — balance 있으면 「팀 구성 완료 · 시작 대기」, 없으면 「정원 마감 · 팀 구성 중」 |
| playing, result_status null·rejected | 1–2단계 완료, 3단계 진행 중(rejected면 3단계에 「결과 반려됨」 표시) |
| playing, result_status pending | 1–3단계 완료, 4단계 진행 중 「승인 대기」 |
| finished | 4단계 모두 완료 |
| cancelled | S2 그대로 |

개인 순위 게임(has_teams=false)은 2단계 이름을 「팀 구성」 대신 「참가 확정」으로 쓰고, full이면 완료로 표시한다.

---

## 9. 화면 (frontend)

### `/scrims/[id]` (목업 ScrimDetail)

| 영역 | 데이터 | 동작·문구 |
| --- | --- | --- |
| 진행 단계 | status, result_status, balance | 8절 표 |
| ROSTER | players[].skill·is_new·team·position·position_preference | 슬롯에 실력값 숫자, `is_new` → 「NEW」 배지, 팀 배정이 있으면 팀 색 점(블루/오렌지 토큰)과 배정 포지션 |
| AUTO BALANCE (has_teams 게임만) | viewer.can_balance·can_edit_teams, `POST /balance` 응답 | can_balance → 「팀 자동 밸런스 실행」 버튼. 응답 후: 부제 「{partitions_evaluated}가지 팀 구성 × 포지션 배정 중 비용이 가장 낮은 {options.length}개 안」(used_positions false면 「× 포지션 배정」 빼고), 탭 「{rank}안 · 차 {power_diff}」, 요약 「{blue %} 블루 기대 승률 · 전력 차 {power_diff} · 포지션 비용 {position_cost} · 오렌지 기대 승률 {orange %}」(% = 소수 첫째 자리), 팀 카드 2개(「BLUE 평균 {skill_avg}」, 행 = 포지션 코드(POSITION_META 약칭) · 닉네임 · 희망 칩 「1지망/2지망/그 외」 · 실력값, 바닥 「합계 {skill_sum} · 승리 +{win} · 패배 −{|lose|}」 — elo_preview null이면 승패 문구 생략). 설명 「실력값 = w × 내전 레이팅 + (1 − w) × 티어 시드, w = 내전 경기 수 ÷ {full_weight_games} (최대 1). K = {k_base}, 신규 멤버 K = {k_new}.」 — **rating_policy 값으로만, 밸런스 응답 전에는 숫자 없는 문구**(「실력값은 내전 레이팅과 티어로 계산해요」). 버튼 「{rank}안으로 팀 확정」 → `PUT /teams`(선택 안의 members 그대로), 「직접 수정」 → 편집기(참가자마다 블루/오렌지/미배정 + 포지션 사용 내전은 포지션 선택) → `PUT /teams`. auto_balance=false면 밸런스 버튼 없이 「팀 직접 구성」만(can_edit_teams). 밸런스 결과는 저장 전까지 화면 상태로만 두고, 상세 재조회로 명단이 바뀌면 지운다 |
| 팀 구성 표시 | balance(ScrimTeamsView), players | 저장된 팀이 있으면 블루·오렌지 두 열(팀원 = players.team), 평균·합계·기대 승률·전력 차·포지션 비용, 미배정자 「팀 미배정 {n}명 — 레이팅에 반영되지 않아요」. can_edit_teams면 「팀 다시 구성」 |
| RESULT | result, viewer.can_submit_result·can_withdraw_result·can_review_result | 아래 표 |
| 운영진 노쇼 | S2 그대로 | finished 이후에도 기한 안이면 표시 가능. 확인 대화상자에 「이미 반영된 레이팅은 바뀌지 않아요」 한 줄 추가(승인 후일 때) |
| 갱신 | - | S2 20초 재조회를 playing에도 적용(승인 대기 반영). 상태 변경 응답으로 캐시 교체, 목록·프로필 캐시 무효화. 노쇼 표시·정정 응답에서도 프로필 캐시를 무효화한다(최근 내전 칩이 바뀜, D133) |

RESULT 영역(부제 「방장 입력 → 운영진 승인 → 레이팅 반영」, rated=false면 「방장 입력 → 운영진 승인」):

| 상태 | 표시 |
| --- | --- |
| status recruiting·full | 「경기가 시작되면 결과를 입력할 수 있어요」 |
| playing, 결과 없음·rejected, can_submit_result | 팀 게임: 「승리 팀을 고르세요」 + 「BLUE 승리」「ORANGE 승리」 선택 → 「결과 제출」. 개인 순위: joined 참가자 목록에서 순위 지정(1위부터, 「순위 없음」 선택 가능, 2명 이상) → 「결과 제출」. rejected면 위에 「운영진이 결과를 반려했어요: {reject_reason}」 |
| playing, 제출 권한 없음 | 「방장이 결과를 입력하면 운영진 승인 후 확정돼요」. 팀 게임인데 팀이 없으면(방장에게) 「결과를 입력하기 전에 팀을 구성해 주세요」 |
| pending | 「{블루팀\|오렌지팀} 승리로 제출했어요. 운영진이 승인하면 레이팅이 반영됩니다.」(목업 문구. 개인 순위: 「순위를 제출했어요. …」, rated=false: 「…운영진이 승인하면 결과가 확정돼요.」) + 제출자·제출 시각(KST). can_withdraw_result → 「제출 취소」. can_review_result → 「승인」(확인 대화상자: rated면 「승인하면 참가자 레이팅이 바로 반영되고 되돌릴 수 없어요」), 「반려」(사유 입력 2–200자 필수). 운영진인데 본인 제출 → 「내가 제출한 결과는 다른 운영진이 승인해야 해요」 |
| approved | 승리 팀(또는 순위표) + 「{approved_by} 승인 · {approved_at KST}」. rating_status applied → 참가자별 표(닉네임 · 팀/순위 · `elo_before → elo_after` · `+16`/`−15`(U+2212) · `K {k_factor}`, NEW 배지 없음(D132)), skipped → 「반영할 참가자가 부족해 레이팅은 바뀌지 않았어요」, not_rated → 「ELO 미반영 내전이라 레이팅은 바뀌지 않았어요」 |

오류 처리: SCRIM_RESULT_NOT_PENDING·SCRIM_TEAMS_NOT_EDITABLE·SCRIM_RESULT_EXISTS를 받으면 토스트 후 상세 재조회. VALIDATION_FAILED details는 해당 입력 아래.

### `/scrims` (목업 Scrims)

| 영역 | 동작 |
| --- | --- |
| 카드 상태 배지 | playing && result_status pending → 「승인 대기」(S2 「진행 중」 대신) |
| 종료 탭 카드 보조 줄 | finished && outcome: 팀 → 「블루팀 승리」/「오렌지팀 승리」(팀 색 토큰), 개인 순위 → 「1위 {winner.nickname}」. cancelled는 S2 그대로 |

### `/members/[id]` (목업 Profile)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 내전 레이팅 카드 | profile.scrim.ratings | 대표 게임 = games가 가장 많은 행(같으면 목록 순서). 값 elo, 보조 「{wins}승 {losses}패 · 승률 {round(win_rate×100)}%」(win_rate null → 「아직 경기 없음」). ratings [] → 「내전 기록 없음」. 순위 「#3」은 S4 |
| RATING HISTORY | `GET /users/:id/rating-history?game&season`, `GET /seasons`, `GET /games` | 게임 선택(기본 = 카드의 대표 게임, ratings가 없으면 has_teams 게임 중 sort_order 첫 번째), 시즌 선택(기본 = 생략 → 서버 기본). Recharts 선 그래프: 첫 점 = points[0].elo_before, 이후 elo_after. 상승 점 accent, 하락 점 orange 토큰. 머리 「{마지막 elo_after} {마지막 delta 부호 포함} · {season.name}」, x축 「{n}경기 전 … 최근」. points [] → 「이 시즌 내전 기록이 없어요」. truncated → 「최근 100경기만 보여요」 |
| SCRIMS 최근 내전 | profile.scrim.recent | 행: 칩(win 「WIN」 accent / loss 「LOSS」 orange / no_show 「노쇼」 / unassigned 「미배정」), 제목(상세 링크), 「{MM.DD KST} · {게임 이름 `GAME_META[game].short`} · {포지션 라벨 또는 {placement}위}」(예 「10.26 · 롤 · 탑」, D133), 오른쪽 delta(`+16`/`−15`) 또는 「미반영」(rated=false·null). [] → 「아직 끝난 내전이 없어요」 |

- 훅: `useBalanceScrim`(mutation, 캐시 저장 안 함), `useSaveScrimTeams`, `useSubmitScrimResult`, `useWithdrawScrimResult`, `useApproveScrimResult`, `useRejectScrimResult`, `useSeasons`, `useUserRatingHistory`.
- 색: 블루/오렌지 = 기존 `blue`·`orange` 토큰 클래스(hex 금지, D53). 마이너스 기호 U+2212.
- 화면 코드는 `SCRIM_ELO_*_DEFAULT`를 import하지 않는다(목 백엔드만 사용, D101 규칙 확장).
- 목 백엔드(`NEXT_PUBLIC_API_MOCK`): 새 엔드포인트 8개, 기존 3개 응답 필드, 밸런스는 `@gcd/core` `balanceTeams`를 import하거나(가능하면) 간단 구현, 승인 시 ELO 반영 흉내(core 함수 import 권장 — 목에 공식 복사본을 두지 않는다).

---

## 10. 구현 경계 (backend 모듈)

| 위치 | 내용 |
| --- | --- |
| `apps/api/src/modules/scrims/scrim-teams.service.ts`(새) | 5-2 밸런스, 5-3 팀 저장 |
| `apps/api/src/modules/scrims/scrim-results.service.ts`(새) | 5-4 제출·제출 취소, 5-5 승인, 5-6 반려 |
| `apps/api/src/modules/scrims/scrim-result-json.ts`(새) | 저장 placements JSON 읽기(`readPlacements`, 형식 불량 → null, D130), 활성 결과 판정 `isActiveResultStatus` |
| `apps/api/src/modules/ratings/`(새) | `rating-seed.ts`(대표 계정 최신 스냅샷 → 티어 → 시드, D103, `loadTierSeeds`), `rating-inputs.service.ts`(참가자 skill 입력 모으기 — 상세·밸런스 공용: 현재 시즌 ratings·이력 수 `countRatedGames`·티어 시드 일괄 조회), `seasons.service.ts`(조회·`GET /seasons`, 승인용 `lockIfMayCreate`·`resolveForApproval` 자동 생성), `rating-locks.ts`(`season-auto-create`·`rating:{game}` advisory), `ratings.controller.ts`(`GET /seasons` → seasons.service, `GET /users/:id/rating-history` → `rating-history.service.ts`) |
| `apps/api/src/common/scrim-tx.ts`(새) | `scrimWriteTx` — 내전 잠금 경로 트랜잭션 옵션(timeout 15s·maxWait 5s, D129) |
| `apps/api/src/modules/scrims/scrim-views.service.ts` | 4-1 직렬화(result_status·outcome·balance·result·players 추가 필드·viewer can_* 5개), 결과 행 정렬 `latestFirst`(D131) |
| `apps/api/src/modules/scrims/scrims.service.ts` | 5-1 `resetTeams`(새 참가 확정·참가 취소·정원 수정에서 joined 집합이 바뀔 때, D131) |
| `apps/api/src/modules/scrims/scrims.controller.ts` | 6개 라우트(balance, teams, result POST/DELETE, approve, reject) |
| `apps/api/src/modules/profile/profile-scrim.service.ts`(새) | `scrim` 블록(4-1 ProfileScrim, D136 개인 순위 승패). `profile.service.ts`는 이를 호출만 |
| `config/env.ts` | 12절 4개 |

---

## 11. 트랜잭션·잠금 요약 (QA 대조용)

| 경로 | 잠금 | 마지막 방어 |
| --- | --- | --- |
| PUT /teams | 내전 행 FOR UPDATE | - |
| POST /result | 내전 행 FOR UPDATE | 부분 고유 `scrim_results_one_active_per_scrim` → SCRIM_RESULT_EXISTS |
| DELETE /result | 내전 행 FOR UPDATE | `DELETE … WHERE id AND status='pending'` 0행 → NOT_PENDING |
| approve | 내전 행 → (rated 반영이 있고, 사용자 잠금 전 시각 기준으로 시즌이 없거나 현재 시즌이 트랜잭션 timeout 15초 안에 끝날 때 — 5-5 7a `lockIfMayCreate`) `season-auto-create` advisory → 사용자별 `rating:{game}` advisory(user_id 오름차순) → now 확정 → 7b 시즌 판정·생성(잠금 없이 생성이 필요하면 INTERNAL_ERROR) | 결과 조건부 update 1행, `rating_history (scrim_id, user_id)` 유일, `ratings (user, game, season)` 유일 + ON CONFLICT |
| reject | 내전 행 FOR UPDATE | 조건부 update 1행 |
| S2 새 참가·참가 취소·정원 수정(팀 초기화, D131) | S2 그대로 | - |

모든 쓰기 단계가 한 트랜잭션: 승인 중 어느 단계라도 실패하면 결과 상태·내전 상태·ratings·rating_history·seasons 모두 롤백된다.

---

## 12. 환경 변수 (`.env.example` 반영됨, 신규 4개)

| 변수 | 사용처 | 기본 | 비고 |
| --- | --- | --- | --- |
| SCRIM_ELO_K_BASE | api | 32 | 양의 정수. 문서 7-1 |
| SCRIM_ELO_K_NEW | api | 40 | 양의 정수 |
| SCRIM_ELO_NEW_PLAYER_GAMES | api | 10 | 양의 정수. 신규 판정·`is_new` |
| SEASON_AUTO_LENGTH_MONTHS | api | 3 | 1–24 정수. 자동 시즌 길이(6절) |

기본값 상수: shared `SCRIM_ELO_K_BASE_DEFAULT`·`SCRIM_ELO_K_NEW_DEFAULT`·`SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT`(scrims.ts), `SEASON_AUTO_LENGTH_MONTHS_DEFAULT`(seasons.ts). 화면 노출(D124): K 3개 → `BalanceScrimResponse.rating_policy.k_base / k_new / new_player_games`(+ `full_weight_games` = 상수 10). SEASON_AUTO_LENGTH_MONTHS는 화면에 쓰지 않는다. λ(50)·포지션 비용(0/1/3)·시드 표는 core 상수(설정값 아님, 메인 기본값 5).

---

## 13. 담당 배정

S3 실행 구현자: **logic**, **backend**, **frontend** (+ qa). integration 할 일 없음(외부 호출 없음 — 티어는 S1이 저장한 스냅샷을 읽기만).

### 의존 순서

```
architect(완료)
  ├─ logic(core 23개) ─────────────────────────┐
  ├─ backend(7절 시그니처대로 import하고 시작) ──┼─ backend 테스트 통과 → qa
  └─ frontend(목 백엔드로, core import) ─────────┘
```
셋 다 바로 시작. logic 완료 전 backend·frontend의 core 의존 테스트는 실패해도 된다(S1·S2와 같은 방식).

### logic (domain-logic-dev) — `packages/core/src/**`

1. 7-1 상수를 `config.ts`에, 7-3·7-4·7-5 함수 23개(`tierSeedRating`, `eloKFactor`, `expectedScore`, `roundHalfAwayFromZero`, `meanRating`, `computeTeamEloUpdates`, `computePlacementEloUpdates`, `isPlacementWin`, `computeWinRate`, `previewTeamElo`, `selectRatedParticipants`, `computeSkill`, `positionPreferenceOf`, `bestPositionAssignment`, `balanceTeams`, `evaluateTeams`, `validateTeamAssignment`, `validatePlacementUsers`, `resolveSeasonAt`, `latestStartedSeason`, `kstMonthStart`, `addKstMonths`, `planAutoSeason`)와 7-2 타입을 새 파일 3개에 + `index.ts` export.
2. 테스트: 7-3 검증 예, 7-4 테스트 목록, 시즌(빈 목록, 끝난 시즌 뒤 공백 건너뛰기, 미래 시즌과 겹치지 않게 자르기, 1월 31일 + 1개월 = 2월 28일, KST 자정 경계 UTC 15:00, 겹치는 시즌 해석), 개인 순위 합계 0 근방(반올림 오차 ±M), K 경계 9/10, 동점·결정성, 시드 표 전 티어.
3. dist 재빌드. 보고서 `_workspace/02_domain-logic-dev_report.md`.

### backend (backend-dev) — `apps/api/src/**`, `apps/api/test/**`

1. `config/env.ts`: 12절 4개(양의 정수, SEASON 1–24).
2. 10절 모듈: 엔드포인트 6개(scrims) + `/seasons` + `/users/:id/rating-history`, 5절 흐름 전부, 11절 잠금, `canTransition`, 직렬화 parse.
3. 기존 응답 확장: 목록 `result_status`·`outcome`(배치 조회), 상세 `balance`·`result`·players(`position_preference`·`skill`·`is_new`)·viewer can_* 5개, 프로필 `scrim`(항상 객체).
4. S2 경로 보완 5-1(새 참가·참가 취소·정원 수정에서 joined 집합 변경 시 팀 초기화, 재참가 행 team·position null).
5. 티어 시드(D103): 사용자·게임의 대표(`is_primary`) game_account → `RANKED_QUEUE_BY_GAME[game.code]` 큐의 최신 rank_snapshot tier → `tierSeedRating`. 큐가 없는 게임(steam 등)·계정 없음·스냅샷 없음 → 1000. 여러 사용자는 한 번에 조회.
6. `test/support/fake-prisma.ts`에 scrim_results·ratings·rating_history·seasons 추가.
7. 테스트(DB 없이): 밸런스(권한 403·팀 없는 게임·auto_balance off·인원 부족 409·응답 3안·rating_policy env 반영), 팀 저장(남의 user_id·노쇼·포지션 누락/범위 밖/팀 내 중복 400, 결과 pending 후 409, auto_balance off 허용, 미배정 허용), 결과 제출(playing 아님 409, 중복 409, 팀 미구성 409, 모양 불일치 400, 순위에 비참가자 400, 운영진 대리 제출), 제출 취소(제출자·방장만, pending 없음 409), 승인(비운영진 403, 자기 제출 403, result_id 불일치 409, rated 반영·이력·wins/losses·k_factor, rated=false → 레이팅 불변·finished, 노쇼·미배정 제외, 한 팀 전원 노쇼 → skipped·finished, 시즌 자동 생성, 시드 행 생성), 반려(사유 필수·재제출 가능·팀 수정 재개), 참가 취소 후 팀 초기화, 상세 viewer can_* 조합, 프로필 scrim 블록, 그래프 기본 시즌·truncated, 응답에 email·discord_id 없음. **DB 필요(작성만)**: 같은 결과 동시 승인 `Promise.all` 2건 → 1건 성공·1건 SCRIM_RESULT_NOT_PENDING·이력 중복 없음, 같은 사용자가 낀 두 내전 동시 승인 → 순차 반영(둘째 elo_before = 첫째 elo_after), 시즌 없음에서 동시 승인 2건 → 시즌 1개만 생성, 부분 고유 인덱스로 동시 제출 1건만.
8. 보고서 `_workspace/02_backend-dev_s3.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 9절 세 화면(`/scrims/[id]` 밸런스·팀·결과, `/scrims` 카드, `/members/[id]` 내전 블록), 훅 8개, Recharts 그래프(이미 의존성에 없으면 추가).
2. `lib/errors.ts` S3 7개 문구 다듬기(architect 초안 있음).
3. 목 백엔드: 새 엔드포인트 8개 + 기존 응답 필드(목록 `result_status`·`outcome`, 상세 players·viewer·balance·result, 프로필 `scrim`). `lib/api/mock/scrims.test.ts` 기대값 갱신.
4. 검증: `corepack pnpm --filter web typecheck && test && build`, 목 모드로 데스크톱·모바일 × 라이트·다크(밸런스 3안, 팀 확정, 결과 제출·승인 대기·반려·승인 후 ELO 표, 롤체 순위 입력, 프로필 그래프 빈/있음).
5. 보고서 `_workspace/02_frontend-dev_s3.md`.

### qa (qa-verifier)

- 교차 대조: 4절 엔드포인트 ↔ 컨트롤러 ↔ 웹 훅, 오류 코드 43개 ↔ `DEFAULT_ERROR_MESSAGE` ↔ 웹 `ERROR_MESSAGES`, 전이(8절 표) ↔ 갱신 코드, 7-3 공식 ↔ core 테스트 수치, env 4개 ↔ `.env.example` ↔ `config/env.ts`.
- 잠금: 11절 표가 실제 코드와 같은지(쓰기 5경로 모두 내전 잠금, 승인 잠금 순서), 승인이 한 트랜잭션인지, 조건부 update 결과 검사.
- 보안 경계: 비운영진 승인·반려 403, 자기 제출 승인·반려 403(운영진이 방장이어도), 남의 내전 팀 저장·결과 제출 403, 제출 취소 권한, 승인 후 결과·팀 변경 불가.
- 마이그레이션에 `DROP INDEX` 없음(`game_accounts_one_primary_per_user_game`, `scrim_results_one_active_per_scrim` 둘 다 유지).
- 화면 코드에 `SCRIM_ELO_*_DEFAULT`·숫자 32/40 리터럴 없음(목 제외).

---

## 14. 결정 사항 (S3, D103부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D103 | (메인 기본값 1) 시드 = 아이언 600 … 다이아 1800, 마스터 이상 2000, 언랭·티어 없음 1000(디비전·LP 무시). 티어 출처 = 그 게임 **대표 계정**(D56)의 `RANKED_QUEUE_BY_GAME` 큐 최신 스냅샷. 큐가 없는 게임(steam, 이후 추가 게임)은 1000. 시드는 (사용자, 게임, 시즌) ratings 행을 처음 만들 때 한 번만 쓰고, 밸런스 실력값의 「티어 시드」는 요청 시점 티어로 매번 계산 | 문서 7-1 「티어당 200점」. 게임 코드 분기 대신 기존 큐 맵을 써서 게임 데이터 원칙 유지. 프로필 티어 카드와 같은 계정·큐라 사용자가 보는 티어와 시드가 일치 |
| D104 | 팀 ELO: 팀 레이팅 = 반영 대상 팀원 현재 시즌 elo 평균(반올림 전), 참가자별 K, delta = k(S − E) 를 0에서 먼 쪽 반올림, elo 하한 없음 | 문서 7-1. 반올림을 delta에 하면 승패 대칭(+16/−16)이 유지된다. 하한은 문서에 없고 정상 범위에서 닿지 않는다 |
| D105 | (메인 기본값 3) 개인 순위: 모든 쌍 1:1(위가 승), K/(M−1)로 나눠 합산. 승패 집계(wins/losses·승률·「WIN/LOSS」)는 **상위 절반(2 × 순위 ≤ M)을 승**으로 센다 | 문서 7-2 끝 「순위로 갱신」. ratings에 wins/losses 컬럼만 있어 개인 순위 게임에도 승패 정의가 필요하다. 롤체 관례(4등 이상 「순방」)와 같다 |
| D106 | (메인 기본값 2) K 판정 경기 수 = (사용자, 게임) rating_history 행 수(모든 시즌, 이번 경기 반영 전). 밸런스 w의 「내전 경기 수」도 같은 값 | 「승인된 rated 내전」 = 이력 행이라 별도 카운터가 필요 없다. 시즌이 바뀌어도 신규 K로 돌아가지 않게 |
| D107 | 밸런스 실력값의 「내전 레이팅」 = 현재 시즌 ratings.elo, 행이 없으면 시드(= 그 시즌 첫 반영 때 쓰일 값). 실력값은 정수로 반올림 후 사용 | 실제 반영될 레이팅과 같은 기준. 정수화로 비교·동점 처리가 결정적이 된다 |
| D108 | (메인 기본값 5) 밸런스: 대상 = joined(노쇼 제외) 2–16명, 블루 = 슬롯 첫 참가자가 있는 쪽, 홀수 인원은 ⌊n/2⌋ : ⌈n/2⌉, 전력 차 = |평균 차| × n/2(짝수면 합의 차), 총 비용 = 전력 차 + **λ 50** × 포지션 비용, 동점 = 전력 차 → 포지션 비용 → 블루 index 사전순, 서로 다른 나누기 상위 3안. 기대 승률은 실력값 평균, 승패 예상 변동(elo_preview)은 레이팅 평균 + K 기본값 | λ 50: 「그 외 포지션」 1명(비용 3) = 실력값 합 150점(5인 팀 평균 30점) 차이와 같게 봐서 포지션을 크게 해치지 않는 선에서 전력을 우선. 스팀은 정원 16·홀수가 가능해 일반화 필요(16명 6435가지라 전수 가능). 블루 고정 규칙으로 거울상 중복 제거·결정성 확보 |
| D109 | 팀 저장 `PUT /scrims/:id/teams`(전체 덮어쓰기). 방장·운영진, status full·playing, 활성 결과 없을 때. auto_balance=false도 허용, 미배정 허용, 포지션 사용 내전은 팀원마다 포지션 필수·팀 안 중복 금지 | 문서 7-2 4번 「선택하거나 직접 수정」을 하나의 저장 API로. 밸런스 안을 서버에 저장하지 않으므로(슬라이스) 클라이언트가 고른 안을 그대로 보낸다 |
| D110 | 모집 중 명단(joined 집합)이 바뀌면 그 내전 팀 배정 전원 초기화 | 한 명만 지우면 나머지 배정이 균형을 잃은 채 남는다. 밸런스는 명단 전체가 전제 |
| D111 | 결과 제출은 playing에서만, 방장·운영진(메인 기본값 8). 팀 게임은 두 팀 모두 배정자 필요, 개인 순위는 joined 중 2명 이상의 순위(빠진 사람 허용). 응답 200(201 아님) | S2 D78 「결과 입력은 playing 필요」. 결과 행 생성이지만 상세를 돌려주는 상태 변경 API들과 맞춘다(D87). 불참자를 방장이 순위에서 뺄 수 있어야 운영진 노쇼 표시를 기다리지 않는다 |
| D112 | `DELETE /scrims/:id/result`: pending 결과 제출 취소(제출자 또는 방장), 행 삭제 | 목업 「제출 취소」. 승인 전 잘못 입력을 운영진 반려 없이 고칠 수 있게. 승인 전 행이라 이력 가치가 낮다 |
| D113 | 한 내전 활성 결과(pending·approved) 최대 1개: 내전 행 잠금 + 부분 고유 인덱스 `scrim_results_one_active_per_scrim` | S0 주석 「서비스에서 보장」에 DB 방어선 추가. 이중 제출을 DB가 최종 차단 |
| D114 | 승인·반려 본문에 `result_id` 필수(현재 pending과 다르면 409), 자기 제출은 승인·반려 모두 금지(`SCRIM_RESULT_SELF_REVIEW` 403). 반려 사유 2–200자 | 반려 → 재제출 사이에 오래된 화면에서 다른 결과를 승인하는 것 방지. 자기 반려를 허용하면 「제출 취소」와 겹치고 감사 기록이 흐려진다 |
| D115 | (메인 기본값 7) 반영 대상은 **승인 시점** status joined이면서 팀 배정(팀 게임) 또는 순위 포함(개인 순위). 한 팀이 비거나 개인 순위 대상 2명 미만이면 레이팅 반영 없이 승인(`rating_status: skipped`) | 제출 뒤 노쇼가 표시될 수 있다(시작 후 7일). 상대가 없는 ELO는 정의되지 않으므로 결과 확정만 한다 |
| D116 | 시즌 = 승인 시각이 속한 [starts_at, ends_at) 구간. 없으면 승인 트랜잭션이 KST 달 1일 시작(또는 직전 시즌 끝), `SEASON_AUTO_LENGTH_MONTHS`(3)개월 시즌을 「시즌 N」으로 자동 생성(advisory lock). 조회는 생성하지 않음 | 시즌 관리 화면은 아직 없고(S4·S6), 시즌이 없다고 승인을 막으면 P0 흐름이 멈춘다. 이어 붙이기·미래 시즌 앞에서 자르기로 겹침을 막는다 |
| D117 | (메인 기본값 10) 승인 잠금 순서: 내전 행 → 시즌 생성 advisory → 사용자별 `rating:{game}` advisory(user_id 오름차순). 결과 조건부 update + 이력 유일로 마지막 방어 | 같은 결과 이중 승인은 내전 잠금이, 같은 사용자 동시 갱신·경기 수 집계는 사용자 잠금이 막는다. ratings 행이 없을 때도 잠글 수 있어 advisory를 쓴다. 고정 순서로 교착 방지 |
| D118 | `GET /users/:id/rating-history`는 목록이 아니라 그래프 데이터셋: `paginated` 대신 `{game, season, rating, points(최근 100, 오래된 순), truncated}` | 그래프는 한 번에 그려야 하고 커서 페이징이 의미 없다. 100경기면 한 시즌 그래프로 충분 |
| D119 | 프로필 `scrim` = `{season(현재), ratings(현재 시즌 게임별), recent(5)}`, S3부터 항상 객체(nullable은 유지) | 목업 카드·최근 내전. 그래프는 게임·시즌 선택이 있어 별도 API(D118). D39 확장 규칙 |
| D120 | `GET /seasons` 추가(next_cursor 항상 null) | 그래프 시즌 선택. D75와 같은 방식 |
| D121 | 상세 `balance` = 저장된 팀 요약(밸런스 3안은 저장 안 함), `result` = 최근 결과 행, 목록 `result_status`·`outcome`, players `skill`·`is_new`·`position_preference`, viewer can_* 5개 추가(D93처럼 서버 계산) | 문서 6장 「상세(참가자, 팀 구성, 결과)」, 목업 ROSTER 실력값·NEW, 종료 카드 결과 |
| D122 | (메인 기본값 6) rated=false도 같은 제출·승인 흐름, 레이팅·이력만 없음(`not_rated`). 승률·승패(ratings)에도 넣지 않는다. 프로필 최근 내전에는 보인다(elo_delta null) | 메인 기본값. ratings는 「시즌 내전 레이팅」이라 미반영 경기를 섞지 않는다 |
| D123 | (메인 기본값 9) 승인된 결과·반영된 레이팅은 S3에서 수정·취소 없음. 승인 뒤 노쇼 표시는 레이팅을 바꾸지 않는다 | 되돌리기는 S6(분쟁 처리)에서 설계 |
| D124 | K 값 3개는 env(`SCRIM_ELO_K_BASE`·`K_NEW`·`NEW_PLAYER_GAMES`), 화면 설명은 밸런스 응답 `rating_policy`로만. λ·포지션 비용·시드 표·w 기준 10은 core·shared 상수 | 슬라이스 「값(K, 기준 경기 수)은 설정값」. D101과 같은 노출 규칙. 메인 기본값 5에 따라 λ는 설정값으로 빼지 않음 |
| D125 | `rating_history.k_factor` 추가 | 「잘못 반영된 레이팅은 되돌리기 어렵다」(문서 10장) — S6 되돌리기·감사에서 적용 K를 재구성하지 않아도 되게 |
| D126 | 팀 구성·밸런스 오류를 `SCRIM_TEAMS_NOT_EDITABLE`(상태·게임·결과 잠금)과 `SCRIM_BALANCE_UNAVAILABLE`(자동 밸런스 꺼짐·인원)으로 나눈다 | 웹이 「직접 구성은 가능」 안내를 구분해서 보여줄 수 있다 |
| D127 | 프로필 레이팅 카드의 순위 「#3」과 「내전 기준 주 포지션」은 S3에서 내리지 않는다 | 순위는 ELO 랭킹(S4, 5경기 이상 규칙)과 같은 기준이어야 하고, 주 포지션은 슬라이스 범위 밖 |
| D128 | 승인 now = 모든 잠금 직후 시각(레이팅 반영 없으면 내전 잠금·검사 직후). 시즌 생성 잠금은 사용자 잠금 전에 「시즌 없음 또는 15초 안에 끝남」이면 미리 잡는다 | backend QA minor 1: 잠금 대기 중 정한 시각이면 동시 승인 시 이력 순서가 반영 순서와 어긋남 |
| D129 | 내전 쓰기 트랜잭션은 timeout 15000ms·maxWait 5000ms(`apps/api/src/common/scrim-tx.ts`), 승인은 READ COMMITTED 명시 | backend QA minor 2: Prisma 기본 5초로 16명 승인이 경합 시 P2028 |
| D130 | 개인 순위 승인에서 저장된 placements가 null·형식 불량이면 INTERNAL_ERROR로 롤백(pending 유지), skipped로 확정하지 않는다 | backend QA minor 3: 되돌릴 수 없는 미반영 확정 방지 |
| D131 | 새 참가(대기 승격 포함)로 joined 명단이 바뀌어도 팀 배정 전원 초기화(5-1 확장). 최근 결과 행 정렬 = created_at DESC → 활성 행(pending·approved) 먼저 → id DESC. 목록 result_status는 findMany 1회 + 메모리 선택(DISTINCT ON 대신, 쿼리 수 같음) | backend 계약 변경 요청 1·2·3, D110 원칙 |
| D132 | 승인 결과 ELO 변동 표는 NEW 배지 없이 `K {k_factor}`만. ROSTER의 NEW(`is_new`)는 유지 | frontend 요청 1: 화면 코드에 K 40을 쓸 수 없고 현재 is_new 대체는 틀릴 수 있음 |
| D133 | 프로필 최근 내전 보조 줄에 게임 이름(「10.26 · 롤 · 탑」). 노쇼 표시 응답에서도 프로필 캐시 무효화 | frontend 요청 2·3 |
| D134 | 포지션 배정 탐색은 포지션 5개 이하 게임을 전제한다(롤). 6개 이상 게임을 추가하기 전에 비트마스크 DP로 바꾼다. 홀수 인원 동점 비교 수열은 사전순(접두가 같으면 짧은 쪽 먼저), evaluateTeams members는 입력(슬롯) 순서 | core QA minor 1, core 요청 R1·R2 |
| D135 | rating-history에서 GameCode는 유효하지만 games 시드 행이 없으면 INTERNAL_ERROR(오류 목록 밖 서버 설정 오류) | backend 요청 6 |
| D136 | 프로필 최근 내전의 개인 순위 게임 승패는 레이팅 반영과 같은 기준: 그 내전 참가자 현재 status로 `selectRatedParticipants`(노쇼·순위 없음 제외 후 1..M 재순위) → `isPlacementWin(재순위, M)`(상위 절반 승, D105). 대상에서 빠지거나 skip이면 unassigned. rated=false 내전도 같은 기준. `placement` 필드는 제출 순위 그대로(4-1 ProfileScrim recent) | 교차 QA 결함 3: 제출 순위 전체 인원 기준이면 제출 뒤 노쇼가 빠졌을 때 프로필 칩 LOSS · 상세 ELO 표 win · delta +3 · ratings.wins +1로 엇갈린다. rated 여부로 기준을 나누면 같은 순위가 내전마다 다르게 보인다 |
| D137 | 7-4 「16명 < 200ms」는 성능 목표(단독 실행 기준). 단위 테스트는 1회 워밍업 뒤 측정하고 병렬 부하를 감안한 회귀 상한 1000ms로 단언한다 | 교차 QA 결함 1: 벽시계 단언이 `pnpm -r test` 병렬 부하에서 210–265ms로 실패(단독 23–49ms)해 api·web 테스트가 돌지 않았다. 상한은 지수적 회귀(D134 전제 위반)를 잡기에 충분하다 |
| D138 | (a) 프로필 개인 순위 승패의 기준 참가자는 승인 때 레이팅이 반영된 사용자(rating_history 행)로 고정한다 — 승인 뒤 노쇼 표시로 순위가 바뀌지 않는다. 이력이 없으면(rated=false·skip) D136대로 현재 status. (b) 프로필 최근 내전은 최신 승인 결과 `PROFILE_RECENT_SCRIMS_SCAN_LIMIT`(10)개만 조회해(결과·내전·이력·명단 읽기를 묶음) 그중 최신 5개를 내린다. 내 참가 행 목록은 전체를 읽는다(가벼운 행) | 교차 QA r2 N1: 승인 뒤 노쇼 표시로 프로필만 WIN으로 뒤집히고 ELO 표·delta는 LOSS 그대로. 사용자 요청: 이력이 많아져도 최근 10개 기준 |

---

## 15. 확인 필요 (사용자 판단)

메인 기본값 1–10은 모두 반영했다(1 → D103, 2 → D106, 3 → D105, 4 → D109, 5 → D108, 6 → D122, 7 → D115·D123, 8 → D111·D114, 9 → D123, 10 → D117). 아래만 사용자 확인이 필요하다. 답이 오기 전에는 「현재 계약」대로 구현한다.

| # | 질문 | 현재 계약(기본) | 다른 선택지 |
| --- | --- | --- | --- |
| Q1 | 시즌을 아직 만들지 않은 상태에서 결과가 승인되면, 그 달 1일부터 3개월짜리 「시즌 1」을 자동으로 만들어 레이팅을 넣는다. 괜찮은가? | D116(길이는 `SEASON_AUTO_LENGTH_MONTHS`로 변경 가능) | (a) 시즌 하나를 미리 만들어 두는 시드 데이터로 대신 (b) 자동 시즌 길이를 1개월·6개월 등으로 (c) 시즌이 없으면 레이팅 반영을 미루기(승인만) |
| Q2 | 롤체 같은 개인 순위 내전의 「승/패」를 상위 절반(8명 중 1–4위)을 승리로 센다. 내전 레이팅 카드의 승률도 이 기준이다. 괜찮은가? | D105 | (a) 1위만 승리 (b) 개인 순위 게임은 승패·승률 대신 평균 순위 표시(응답 필드 추가 필요) |

---

## 16. 영향받는 파일

architect가 이번에 바꾼 것:

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/common/errors.ts` | 오류 코드 7개·HTTP 상태 |
| `packages/shared/src/paths.ts` | 경로 7개(scrimBalance, scrimTeams, scrimResult, scrimResultApprove, scrimResultReject, seasons, userRatingHistory) |
| `packages/shared/src/scrims.ts` | S3 상수(K·밸런스·반려 사유), 응답 조각(`PositionPreference`, `EloPreview`, `ScrimTeamSide`, `ScrimTeamsView`, `ScrimPlacementView`, `ScrimRatingChange`, `ScrimRatingStatus`, `ScrimResultView`, `ScrimOutcome`), `ScrimSummary.result_status·outcome`, `ScrimPlayerView.position_preference·skill·is_new`, `ScrimViewer` can_* 5개, `ScrimDetail.balance·result` 객체화, 머리 주석 |
| `packages/shared/src/profile.ts` | `GetUserProfileResponse.scrim` → `ProfileScrim.nullable()` |
| `packages/shared/src/constants/transitions.ts` | 주석(맵 변경 없음) |
| `packages/shared/src/index.ts` | 새 모듈 export 3개 |
| 새 파일 | `packages/shared/src/seasons.ts`, `scrim-results.ts`, `ratings.ts`, `contract.s3.test.ts` |
| `packages/shared/src/contract.s2.test.ts` | detail 픽스처에 S3 필드 추가, 오류 개수 단정을 「≥ 36」으로(전체 개수는 s3 테스트) |
| `apps/api/prisma/schema.prisma` + `migrations/20261030120000_s3/` | 3절 |
| `apps/api/src/common/app-error.ts` | `DEFAULT_ERROR_MESSAGE` S3 7개 |
| `apps/web/src/lib/errors.ts` | `ERROR_MESSAGES` S3 7개(초안) |
| `apps/web/src/components/scrims/scrim-new-form.tsx` | 미리보기 `ScrimSummary`에 `result_status: null, outcome: null`(typecheck 통과용 2줄) |
| `.env.example` | 12절 4개 |

**기존 응답 필드 추가의 영향(구현자가 바꿔야 함)** — 새 필드가 모두 필수라 채우기 전에는 parse 500:

| 응답 | 추가 필드 | backend | 웹 목 |
| --- | --- | --- | --- |
| `ScrimSummary`(GET /scrims, 상세·모든 상태 변경 응답) | result_status, outcome | `scrim-views.service.ts` 목록·상세 직렬화 | `lib/api/mock/scrims.ts` 요약 생성, `scrims.test.ts` |
| `ScrimPlayerView` | position_preference, skill, is_new | 같은 파일 + skill 입력 일괄 조회 | 같음 |
| `ScrimViewer` | can_edit_teams, can_balance, can_submit_result, can_withdraw_result, can_review_result | 같은 파일 | 같음 |
| `ScrimDetail.balance/result` | null → 객체 허용(null 그대로도 통과) | 계산 추가 | 계산 추가 |
| `GetUserProfileResponse.scrim` | null → 객체(null도 통과) | `profile.service.ts` | `lib/api/mock/backend.ts` 프로필 |

검증 결과(architect): `corepack pnpm --filter shared typecheck` 통과, `test` 71개 통과(s3 14개 포함), shared dist 재빌드, `corepack pnpm -r typecheck` 4개 패키지 모두 통과, `prisma validate` 통과, `prisma migrate diff`(S2 schema → 현재) 출력 = 마이그레이션 자동 부분.
예상된 실패(위 표의 필수 필드를 아직 안 채워서 parse 실패): api `test` 33개 실패(`test/scrims.e2e.spec.ts` 31, `test/steam-apps.e2e.spec.ts` 2) / web `test` 17개 실패(`lib/api/mock/scrims.test.ts`). backend·frontend가 필드를 채우면 해소된다 — 구현 시작 기준선으로 쓴다.
