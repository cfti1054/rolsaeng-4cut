# 계약: S2 내전 모집·참가·대기열·노쇼 제한, 목록·작성·상세 화면 + 인증 보완 2건

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서"), 슬라이스: `_workspace/00_input/slice.md`
선행 계약: `_workspace/S0/01_architect_contract.md`(D1–D31), `_workspace/S1/01_architect_contract.md`(D32–D72). 와이어 형식(S0 3절), 인증(S0 5절, 이 문서 9-1이 5-3을 일부 바꿈), 테마 규칙(S0 9절), 외부 식별자 비노출(S1 D38)은 그대로 쓴다. 이 문서는 두 계약을 **확장**한다.
실제 계약은 코드가 우선한다: `packages/shared/src/**`, `apps/api/prisma/schema.prisma`.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-29 | S2 최초 작성: 내전 엔드포인트 11개(게임 목록·노쇼 제한 조회 포함), 스키마 증분(마이그레이션 `20261029120000_s2`), 오류 코드 7개(전체 36개), 상태 전이 맵 보강, core 함수 13개, 인증 보완 2건(리프레시 하루 1회 회전, 스팀 팝업), 환경 변수 8개 | architect |
| 2026-10-29 | 구현 반영(리더 승인): 목록 집계는 페이지 내전 id로 참가자 행 1회 조회해 개수·1지망·my_status 계산 / `last_no_show_at`은 조회 범위(37일) 안의 마지막 노쇼, 없으면 null / `POST /scrims/{id}/join` 본문 필수(포지션 없는 게임도 `{}`) / `viewer.preferred_positions`는 참가·대기 중일 때만, no_show면 `[]` / ScrimsModule이 ScheduleModule을 직접 import(중복 등록 방지 테스트 유지) / 잠금 경로 수 7개로 정정. 사용자 확인 Q1~Q3은 계약 기본값(D76·D78·D83) 확정 | 리더 |

---

## 1. 범위

### 포함 (문서 2장 행 기준)

| 문서 2장 행 | S2 범위 |
| --- | --- |
| 내전 · 모집글 (P0) | 작성(게임·제목·시작 시각·정원·규칙·진행 방식 3개), 수정(방장), 모집 취소(방장·운영진), 시작(방장·운영진), 시작 시각 + 60분 자동 마감 |
| 내전 · 참가 관리 (P0) | 참가·대기 등록·취소, 1지망·2지망 포지션(포지션 게임), 정원 초과 시 대기열, 취소·정원 확대 시 대기 1번 자동 확정, `recruiting ↔ full` |
| (7-4) 노쇼 패널티 | 운영진 노쇼 표시·정정 API, 최근 30일 3회 → 7일 참가·대기 등록·작성 제한, 제한 상태 조회 |
| (8장) 화면 | `/scrims` 목록, `/scrims/new` 작성, `/scrims/[id]` 상세(슬롯·포지션 선택·대기열·참가/취소·방장 메뉴·진행 단계·운영진 노쇼 버튼) |
| 인증 보완 (사용자 결정) | 리프레시 토큰 하루 1회 회전(9-1), 스팀 연동 팝업(9-2) |

### 제외

팀 자동 밸런스·결과 입력·승인·ELO 반영·레이팅 그래프(S3 — 상세 응답 `balance: null`, `result: null` 자리만), 홈 모집 중 카드(S4), 관리자 화면(S6 — S2는 상세 화면의 운영진 노쇼 버튼까지), 디스코드 알림, 방장 위임, 스팀 내전의 세부 게임 선택(제목으로 대체, D89), 같은 시간대 중복 참가 제한(메인 기본값 5: 막지 않음).

---

## 2. 오류 코드 (S2 추가분, `packages/shared/src/common/errors.ts`)

S0 15개 + S1 14개는 그대로. 아래 7개 추가(전체 36개).

| code | HTTP | 발생 |
| --- | --- | --- |
| SCRIM_NOT_RECRUITING | 409 | 모집 중(recruiting·full)이 아닌 내전에 참가·취소·수정·시작·모집 취소 |
| SCRIM_JOIN_CLOSED | 409 | 서버 시각 ≥ scheduled_at인데 참가·대기 등록·희망 포지션 변경·참가 취소 |
| SCRIM_HOST_CANNOT_LEAVE | 409 | 방장이 `DELETE /scrims/:id/join` |
| SCRIM_BANNED | 403 | 노쇼 제한 중 참가·대기 등록(새 신청)·모집글 작성. **`Retry-After` 헤더 = 해제까지 초(올림)** |
| SCRIM_CAPACITY_BELOW_JOINED | 409 | 수정에서 capacity < 현재 joined 인원 |
| SCRIM_CANNOT_START | 409 | 시작 조건 미충족(core `canStartScrim`: 고정 정원 게임은 꽉 차야, 그 외 2명 이상) |
| SCRIM_NO_SHOW_NOT_ALLOWED | 409 | 노쇼 표시: 내전이 playing·finished 아님, 표시(true) 기한 경과, 대상 행이 joined·no_show 아님 |

- 기존 코드 재사용: `NOT_FOUND`(내전 없음, 노쇼 대상 사용자가 그 내전 참가 기록 없음), `FORBIDDEN`(방장 아닌 사람의 수정, 방장·운영진 아닌 사람의 시작·모집 취소, 운영진 아닌 사람의 노쇼 표시), `VALIDATION_FAILED`(zod 실패 + **서버가 DB 기준으로 검사하는 필드**: 정원 범위, 시작 시각 범위, 희망 포지션 — `details[{path, message}]`, path는 snake_case 필드명. D82).
- `SCRIM_FULL`·`SCRIM_ALREADY_JOINED`·`POSITION_REQUIRED`는 만들지 않는다: 정원 초과는 대기열로 가고(오류 아님), 이미 참가 중인 사람의 POST는 희망 포지션 변경(멱등, D81), 포지션 누락은 VALIDATION_FAILED.
- `Retry-After`는 S1과 같이 **헤더로만**(본문은 `{code, message}`). backend는 `AppError(..., { retryAfterSec })`, 웹 `ApiError.retryAfterSec`가 이미 있다. 웹은 SCRIM_BANNED를 받으면 `GET /me/scrim-restriction`을 다시 불러 해제 시각을 표시한다.

---

## 3. 스키마 변경 (`apps/api/prisma/schema.prisma`)

마이그레이션: `apps/api/prisma/migrations/20261029120000_s2/migration.sql` — `prisma migrate diff --from-schema-datamodel <7016593의 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`로 만든 **S1 이후 증분** + 맨 끝 수동 블록(기존 games 행의 정원 값 UPDATE 2줄). **`DROP INDEX` 줄 없음** — S1 부분 고유 인덱스 `game_accounts_one_primary_per_user_game`(S1 migration 수동 블록)는 그대로다. DB 적용은 미실행(Docker 없음).

| 대상 | 변경 | 근거 |
| --- | --- | --- |
| enum `scrim_cancel_reason` (새로) | host, admin, not_started | D80, D78 |
| games | **추가**: capacity_min int(기본 2), capacity_max int(기본 16), capacity_default int(기본 8). 수동 블록이 lol = 10/10/10, tft = 2/8/8로 갱신(steam은 기본값). 시드(`GAME_SEED`, `seed.ts`)도 같은 값 | D76, 메인 기본값 3 |
| scrims | **추가**: rated bool(기본 true), auto_balance bool(기본 true), use_positions bool(기본 true), started_at?, cancelled_at?, cancel_reason? | D77, D78, D80 |
| scrim_players | **변경 없음**. S0 컬럼으로 충분: preferred_positions text[](= [1지망, 2지망?]), joined_at(대기 순번 기준), no_show_marked_at·no_show_marked_by. 인덱스 (scrim_id, status), (user_id, status, no_show_marked_at) 그대로 사용 | D82, D83, D85 |
| refresh_tokens | **변경 없음**. 회전 판단은 `created_at`(= 현재 토큰 발급 시각)으로 한다 | D73 |

컬럼 의미(S2 확정):

| 컬럼 | 의미 |
| --- | --- |
| scrims.capacity | 정원(방장 포함). games.capacity_min ≤ capacity ≤ capacity_max |
| scrims.rated / auto_balance / use_positions | 진행 방식 **적용값**(작성 시 서버가 auto_balance = 입력 && games.has_teams, use_positions = 입력 && games.has_positions로 저장). rated·auto_balance는 S3가 쓴다. use_positions는 S2 참가 검증에 쓴다 |
| scrims.started_at | playing으로 바뀐 시각(수동·자동) |
| scrims.cancelled_at / cancel_reason | cancelled로 바뀐 시각·이유 |
| scrim_players.preferred_positions | use_positions 내전: 1–2개(1지망 필수, 2지망 선택), 그 외 `[]` |
| scrim_players.joined_at | 마지막 참가 신청 시각. 재참가(cancelled → joined/waitlist) 때 갱신 → 대기열 맨 뒤. **대기 → 승격 때는 갱신하지 않는다** |
| scrim_players.no_show_marked_at / _by | no_show로 표시한 시각·운영진. 정정(no_show → joined) 시 둘 다 null. 노쇼 집계 기준 시각(D83) |
| scrim_players.position / team | S3 팀 밸런스 확정 시 채움. S2는 항상 null |

---

## 4. 엔드포인트 (S2)

모두 `/api/v1` 접두사, Request/Response 이름은 `packages/shared` export 이름, 경로 상수는 `ApiPath`(웹은 `fillPath`). path `:id`·`:userId`는 UUID(아니면 VALIDATION_FAILED). 인증은 모두 JWT(S0 가드). 오류 판정 순서는 표의 왼쪽부터(5절 흐름 단계 순서와 같다).

| 메서드 | 경로 (`ApiPath`) | 권한 | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- | --- |
| GET | /games (`games`) | 멤버 | - | 200 `ListGamesResponse` | - |
| GET | /scrims (`scrims`) | 멤버 | `ListScrimsQuery` | 200 `ListScrimsResponse` | VALIDATION_FAILED(커서 해석 실패·다른 탭 커서 포함) |
| POST | /scrims (`scrims`) | 멤버 | `CreateScrimRequest` | **201** `CreateScrimResponse` | VALIDATION_FAILED, SCRIM_BANNED |
| GET | /scrims/:id (`scrim`) | 멤버 | `IdParam` | 200 `GetScrimResponse` | VALIDATION_FAILED, NOT_FOUND |
| PATCH | /scrims/:id (`scrim`) | 방장 | `UpdateScrimRequest` | 200 `UpdateScrimResponse` | VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, SCRIM_NOT_RECRUITING, SCRIM_CAPACITY_BELOW_JOINED |
| POST | /scrims/:id/join (`scrimJoin`) | 멤버 | `JoinScrimRequest` | 200 `JoinScrimResponse` | VALIDATION_FAILED, NOT_FOUND, SCRIM_NOT_RECRUITING, SCRIM_JOIN_CLOSED, SCRIM_BANNED |
| DELETE | /scrims/:id/join (`scrimJoin`) | 멤버 | 본문 없음 | 200 `LeaveScrimResponse` | VALIDATION_FAILED, NOT_FOUND, SCRIM_NOT_RECRUITING, SCRIM_JOIN_CLOSED, SCRIM_HOST_CANNOT_LEAVE |
| POST | /scrims/:id/start (`scrimStart`) | 방장·운영진 | 본문 없음 | 200 `StartScrimResponse` | VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, SCRIM_NOT_RECRUITING, SCRIM_CANNOT_START |
| POST | /scrims/:id/cancel (`scrimCancel`) | 방장·운영진 | 본문 없음 | 200 `CancelScrimResponse` | VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, SCRIM_NOT_RECRUITING |
| PUT | /scrims/:id/players/:userId/no-show (`scrimPlayerNoShow`) | **운영진(admin)** | `SetScrimNoShowParams` + `SetScrimNoShowRequest` | 200 `SetScrimNoShowResponse` | VALIDATION_FAILED, FORBIDDEN, NOT_FOUND, SCRIM_NO_SHOW_NOT_ALLOWED |
| GET | /me/scrim-restriction (`myScrimRestriction`) | 멤버 | - | 200 `GetMyScrimRestrictionResponse` | - |

- 문서 6장에 없는 경로: `/games`(D75), `PATCH /scrims/:id`·`/start`·`/cancel`(D78, D80), `PUT …/no-show`(D83), `/me/scrim-restriction`(D84). 문서 6장 `POST /scrims/{id}/balance`·`/result*`는 S3.
- **상태를 바꾸는 엔드포인트 응답은 전부 갱신 후 `ScrimDetail`**(D87). 직렬화는 반드시 shared 스키마 parse를 거친다(S1 D38 규칙 — users의 email·discord_id 미포함, `ScrimUserRef`는 id·nickname·avatar_url만).
- `FORBIDDEN`은 내전 존재 확인(NOT_FOUND) 다음에 판정한다. 노쇼 표시는 역할 검사가 먼저(`@Roles('admin')` 가드)라 FORBIDDEN이 NOT_FOUND보다 앞선다.
- `DELETE /scrims/:id/join`은 본문 있는 200(D81, D87). 참가 기록이 없거나 이미 취소면 변경 없이 200.

### 4-1. 목록 `GET /scrims`

| 탭(`status`) | 포함 상태 | 정렬(커서 키) |
| --- | --- | --- |
| `open`(기본) | recruiting, full (시작 시각이 지났지만 아직 시작·자동 마감 전인 것 포함) | scheduled_at ASC, id ASC |
| `playing` | playing | scheduled_at DESC, id DESC |
| `ended` | finished, cancelled | scheduled_at DESC, id DESC |

- `game` 있으면 그 게임만. 인덱스 `(game_id, status, scheduled_at)` / `(status, scheduled_at)`.
- 커서 = base64url(JSON `{ t: 탭, s: scheduled_at ISO, id }`). 해석 실패·`t`가 요청 탭과 다름 → VALIDATION_FAILED(details path `cursor`). 다음 페이지는 `(scheduled_at, id)` 튜플 비교(ASC는 `>`, DESC는 `<`).
- 집계: 페이지의 내전 id들로 `scrim_players`를 status별 groupBy(joined·waitlist·no_show 수), 요청자 행 1회 조회, use_positions 내전은 joined 행의 `preferred_positions[1]`(1지망)로 `computeOpenPositions`. N+1 금지.
- 탭별 개수(목업 필터의 「전체 6」 숫자)는 내려주지 않는다(D86).

### 4-2. `ScrimSummary` / `ScrimDetail` 필드 (shared `scrims.ts`가 원본)

| 필드 | 값 |
| --- | --- |
| game | `ScrimGameRef {code, name, has_positions, has_teams, positions}` |
| host | `ScrimUserRef {id, nickname, avatar_url}`(avatar_url 조립은 S0 `Me`와 같은 함수) |
| joined_count | 모집 중: joined 수. 시작 후: joined + no_show 수 |
| waitlist_count | waitlist 수 |
| options | `{rated, auto_balance, use_positions}` 저장된 적용값 |
| open_positions | status가 recruiting·full이고 use_positions일 때만 계산, 그 외 `[]` |
| join_closed | `now ≥ scheduled_at`(core `isJoinClosed`) |
| my_status | 요청자 행 status, cancelled·없음 → null |
| players (상세) | joined + no_show 행. 순서: 방장 먼저, 그다음 joined_at ASC, 같으면 user id ASC |
| waitlist (상세) | waitlist 행, core `orderWaitlist` 순서, `order` 1부터. 시작·취소 뒤에도 그대로 보여준다(D95) |
| viewer (상세) | `ScrimViewer` — shared 주석의 can_* 규칙. `restricted_until` = core `computeScrimRestriction(...).until`(제한 아니면 null). can_join은 제한 중이면 false |
| balance, result | 항상 null(S3 자리, `z.null()` — 이후 nullable로 넓히기만) |

---

## 5. 흐름 (서버)

### 5-0. 공통: 내전 행 잠금 (D85)

참가·취소·수정·시작·모집 취소·노쇼 표시·자동 마감은 모두 **한 트랜잭션 안에서 먼저 내전 행을 잠근다**:

```sql
SELECT id, status, capacity, scheduled_at, host_id, use_positions, game_id
FROM scrims WHERE id = $1 FOR UPDATE
```

- 없으면 NOT_FOUND. 이후 참가자 수 조회·변경은 이 잠금 아래에서 한다(READ COMMITTED에서 잠금 대기 후 다음 문장은 앞 트랜잭션의 커밋을 본다). 같은 내전의 동시 요청은 직렬화되고, 마지막 자리에 동시에 참가하면 한 명만 joined, 나머지는 waitlist(메인 기본값 6).
- 불변식(서비스가 매 변경 후 유지, QA 대조): **waitlist가 1명 이상이면 joined 수 = capacity**, **joined 수 ≤ capacity**, status = joined 수 ≥ capacity ? full : recruiting(모집 중일 때).
- 상태 변경은 `canTransition`(shared 맵) 검사 후에만. 위반이면 INTERNAL_ERROR + 로그(잠금 아래라 정상 흐름에서는 생기지 않음).
- 같은 사용자의 중복 행은 `(scrim_id, user_id)` UNIQUE가 막는다. 잠금 + 기존 행 조회가 1차 방어.

### 5-1. 작성 `POST /scrims`

1. zod `CreateScrimRequest`(제목 정규화 2–40자, rules 1000자, 포지션 형식·중복·최대 2) → VALIDATION_FAILED.
2. games 행(code) 조회. 서버 검사 → VALIDATION_FAILED(details 모아서 한 번에):
   - `scheduled_at`: core `validateScrimSchedule(scheduledAt, now, SCRIM_SCHEDULE_MAX_DAYS_AHEAD)` — now < scheduled_at ≤ now + 30일.
   - `capacity`: core `isCapacityInRange`.
   - `host_preferred_positions`: core `validatePreferredPositions(입력, game.positions, 적용 use_positions)`.
3. 노쇼 제한(5-6) → SCRIM_BANNED + Retry-After.
4. 트랜잭션: scrims insert(status recruiting, 적용값 options) + scrim_players insert(방장, joined, preferred_positions, joined_at = now). capacity가 1인 경우는 범위상 없음(min 2). 201 `ScrimDetail`.

### 5-2. 참가·대기 등록·희망 포지션 변경 `POST /scrims/:id/join`

트랜잭션 + 5-0 잠금:
1. status ∉ {recruiting, full} → SCRIM_NOT_RECRUITING.
2. `isJoinClosed(scheduled_at, now)` → SCRIM_JOIN_CLOSED.
3. `validatePreferredPositions(body.preferred_positions, game.positions, scrim.use_positions)` 실패 → VALIDATION_FAILED(path `preferred_positions`).
4. 요청자 행이 joined·waitlist → preferred_positions만 갱신(상태·joined_at 그대로). 200.
5. 노쇼 제한(5-6) → SCRIM_BANNED + Retry-After. (4번보다 뒤: 이미 참가한 사람의 포지션 변경은 막지 않는다, D83)
6. joined 수 n. `placeNewParticipant(n, capacity)` → joined | waitlist. 행이 없으면 insert, cancelled면 같은 행 update(전이 cancelled → joined | waitlist). joined_at = now.
7. joined로 들어갔고 n + 1 = capacity면 recruiting → full.
8. 200 `ScrimDetail`(웹은 `viewer.status`·`viewer.waitlist_order`로 「참가 확정」/「대기 N번」 안내).

### 5-3. 참가 취소 `DELETE /scrims/:id/join`

트랜잭션 + 5-0 잠금:
1. status ∉ {recruiting, full} → SCRIM_NOT_RECRUITING.
2. join_closed → SCRIM_JOIN_CLOSED.
3. 요청자 = 방장 → SCRIM_HOST_CANNOT_LEAVE(메인 기본값 4).
4. 요청자 행 없음·cancelled → 변경 없이 200.
5. waitlist → cancelled. 200.
6. joined → cancelled, 그다음 `planRosterAfterChange({capacity, joinedCount: n − 1, waitlist})`:
   - `promoteIds`(대기 1번부터 빈 자리만큼) → waitlist → joined. **preferred_positions·joined_at은 그대로**(메인 기본값 7).
   - `nextStatus`가 현재와 다르면 전이(full → recruiting).
7. 200 `ScrimDetail`. (승격 알림은 알림 슬라이스)

### 5-4. 수정 `PATCH /scrims/:id`

트랜잭션 + 5-0 잠금:
1. 방장 아님 → FORBIDDEN. status ∉ {recruiting, full} → SCRIM_NOT_RECRUITING.
2. 서버 검사(보낸 필드만): scheduled_at·capacity 범위 → VALIDATION_FAILED.
3. capacity < joined 수 → SCRIM_CAPACITY_BELOW_JOINED.
4. 갱신. capacity를 바꿨으면 `planRosterAfterChange({capacity: 새 값, joinedCount, waitlist})`로 승격 + 상태(recruiting ↔ full).
5. auto_balance는 적용값 규칙(has_teams) 적용. game·use_positions는 스키마가 막는다.
6. **시작 시각이 이미 지난 모집글도 수정 가능**(미래로 미루면 join_closed가 풀린다, D92). join_closed 상태에서 다른 필드만 바꾸는 것도 허용.

### 5-5. 시작·모집 취소·자동 마감 (D78, D80)

**시작 `POST /scrims/:id/start`** — 방장 또는 운영진. 잠금 → 권한(FORBIDDEN) → status ∉ {recruiting, full} → SCRIM_NOT_RECRUITING → `canStartScrim({requiresFull: game.start_requires_full, capacity, joinedCount})`(D97) false → SCRIM_CANNOT_START → status = playing, started_at = now. 시각 제한 없음(시작 시각 전이어도 시작 가능). 대기열 행은 그대로 둔다(D95).

**모집 취소 `POST /scrims/:id/cancel`** — 방장(reason host) 또는 운영진(방장이 아니면 reason admin). 잠금 → 권한 → status ∉ {recruiting, full} → SCRIM_NOT_RECRUITING → status = cancelled, cancelled_at = now, cancel_reason. 참가자 행은 그대로(이력).

**자동 마감 cron** — `*/5 * * * *`(Asia/Seoul), `SCRIM_JOBS_ENABLED=true`일 때만 등록, 트랜잭션 안 `pg_try_advisory_xact_lock(hashtext('scrim-auto-close'))`를 얻은 경우에만 실행(S1 D62와 같은 방식).
1. 대상: `status IN ('recruiting','full') AND scheduled_at <= now() - SCRIM_AUTO_CLOSE_AFTER_MIN분`, scheduled_at 오름차순 최대 100건.
2. 건마다 별도 트랜잭션 + 5-0 잠금 후 다시 판정: `decideOverdueScrim({status, scheduledAt, now, autoCloseAfterMin, canStart})`
   - `'start'` → playing, started_at = now.
   - `'cancel'` → cancelled, cancelled_at = now, cancel_reason = not_started.
   - null(그사이 수정·시작됨) → 건너뜀.
3. 프로세스 시작 시 1회 실행(서버가 꺼져 있던 동안 밀린 것 처리).

### 5-6. 노쇼 제한 판정 (문서 7-4, D83)

```
조회: SELECT no_show_marked_at FROM scrim_players
      WHERE user_id = $1 AND status = 'no_show'
        AND no_show_marked_at > noShowLookbackStart(now, policy)     -- now − (window + restriction)
판정: computeScrimRestriction(marks, now, policy)
```

- 규칙: 노쇼 표시 시각 m마다, 구간 (m − 30일, m]의 노쇼가 3회 이상이면 m이 「제한 발동」. 제한 해제 시각 `until` = 가장 늦은 발동 m + 7일. `now < until`이면 제한 중.
- 「일」은 24시간 단위 이동 구간(**KST 날짜 경계 아님**). 화면 표시는 KST.
- 노쇼 표시 시각이 now보다 뒤인 행은 무시(시계 오차).
- policy = 환경 변수 `SCRIM_NO_SHOW_THRESHOLD`(3), `SCRIM_NO_SHOW_WINDOW_DAYS`(30), `SCRIM_NO_SHOW_RESTRICTION_DAYS`(7).
- 제한 대상: **새 참가·새 대기 등록·모집글 작성**. 이미 참가·대기 중인 내전은 그대로 두고, 그 내전의 희망 포지션 변경과 참가 취소도 허용한다.
- 캐시 컬럼을 두지 않고 요청마다 계산한다(사용자당 최근 37일 노쇼 행 몇 개).
- `SCRIM_BANNED`의 `Retry-After` = `ceil((until − now) / 1000)`.
- `GET /me/scrim-restriction` = 같은 판정 결과 + `policy`(웹 안내 문구용).

### 5-7. 노쇼 표시·정정 `PUT /scrims/:id/players/:userId/no-show`

`@Roles('admin')` → 트랜잭션 + 5-0 잠금:
1. status ∉ {playing, finished} → SCRIM_NO_SHOW_NOT_ALLOWED.
2. 대상 사용자 행 없음 → NOT_FOUND. 행 status ∉ {joined, no_show} → SCRIM_NO_SHOW_NOT_ALLOWED(대기·취소자는 표시 대상 아님).
3. `no_show: true`:
   - 이미 no_show → 변경 없이 200.
   - `isNoShowMarkWindowOpen(scheduled_at, now, SCRIM_NO_SHOW_MARK_WINDOW_DAYS)` false → SCRIM_NO_SHOW_NOT_ALLOWED.
   - joined → no_show, no_show_marked_at = now, no_show_marked_by = 요청자.
4. `no_show: false`: 이미 joined → 200. no_show → joined, 두 컬럼 null(기한 없음).
5. 방장도 표시 대상이 될 수 있다. 200 `ScrimDetail`.
6. S3 이후 레이팅·결과와의 관계(노쇼자를 결과에서 뺄지)는 S3 계약에서 정한다.

---

## 6. 상태 전이 (`packages/shared/src/constants/transitions.ts`, S2 확정)

```
scrims:        recruiting → full | playing | cancelled         (recruiting → playing 추가, D78)
               full → recruiting | playing | cancelled
               playing → finished                              (S3 결과 승인)
scrim_players: waitlist → joined | cancelled
               joined → cancelled | no_show                    (joined → waitlist 삭제, D79)
               cancelled → joined | waitlist                   (재참가: 같은 행, joined_at 갱신)
               no_show → joined                                (운영진 정정)
```

| 전이 | 일으키는 곳 |
| --- | --- |
| scrims recruiting → full | 5-2 7단계, 5-4 정원 축소 |
| scrims full → recruiting | 5-3 6단계(대기열 없음), 5-4 정원 확대(대기열 부족) |
| scrims recruiting·full → playing | 5-5 시작, 자동 마감 'start' |
| scrims recruiting·full → cancelled | 5-5 모집 취소, 자동 마감 'cancel' |
| players waitlist → joined | 5-3 승격, 5-4 정원 확대 승격 |
| players joined·waitlist → cancelled | 5-3 |
| players cancelled → joined·waitlist | 5-2 6단계 |
| players joined ↔ no_show | 5-7 |

웹 진행 단계 표시(목업 ScrimDetail 「모집 · 팀 구성 · 경기 진행 · 결과 승인」):

| 상태 | 표시 |
| --- | --- |
| recruiting | 1단계 진행 중. join_closed면 배지 「시작 대기」 |
| full | 1단계 완료, 2단계(팀 구성) 진행 중 — 「정원 마감 · 팀 구성 중」. join_closed면 「시작 대기」 |
| playing | 1–2단계 완료, 3단계 진행 중 |
| finished | 4단계 모두 완료 |
| cancelled | 단계 표시 대신 「취소된 내전」 + cancel_reason 문구(방장 취소 / 운영진 취소 / 시작되지 않아 자동 취소) |

---

## 7. core 함수 (`packages/core`, domain-logic) — 새 파일 `src/scrim.ts`, `src/no-show.ts`

I/O 없음, 시각은 인자로. 모두 단위 테스트 필수. 환경 변수 값은 인자로 받는다(core는 env를 읽지 않는다).

```ts
export type NoShowPolicy = { threshold: number; windowDays: number; restrictionDays: number };
export type ScrimRestrictionState = { restricted: boolean; until: Date | null; recentCount: number; lastNoShowAt: Date | null };
export type WaitlistRow = { id: string; joinedAt: Date };
export type OpenScrimStatus = 'recruiting' | 'full';
```

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| computeScrimRestriction | `(noShowMarkedAt: readonly Date[], now: Date, policy: NoShowPolicy) => ScrimRestrictionState` | 5-6. now보다 뒤인 값 무시. 발동 m: (m − window, m] 안 개수 ≥ threshold. until = 최대 발동 m + restriction(제한 아니면 null). recentCount = (now − window, now] 개수. lastNoShowAt = now 이하 최대값. 입력 순서 무관 |
| noShowLookbackStart | `(now: Date, policy: NoShowPolicy) => Date` | now − (windowDays + restrictionDays)일. 이 시각 **초과**만 조회하면 판정이 같음을 테스트로 보인다 |
| orderWaitlist | `<T extends WaitlistRow>(rows: readonly T[]) => T[]` | joinedAt ASC, 같으면 id 문자열 ASC. 입력 불변 |
| placeNewParticipant | `(joinedCount: number, capacity: number) => 'joined' \| 'waitlist'` | joinedCount < capacity → joined |
| statusForJoinedCount | `(joinedCount: number, capacity: number) => OpenScrimStatus` | joinedCount ≥ capacity → full |
| planRosterAfterChange | `(input: { capacity: number; joinedCount: number; waitlist: readonly WaitlistRow[] }) => { promoteIds: string[]; nextStatus: OpenScrimStatus }` | 빈 자리 = max(0, capacity − joinedCount), `orderWaitlist` 앞에서 그만큼. nextStatus = statusForJoinedCount(joinedCount + 승격 수). joinedCount > capacity면 RangeError |
| validatePreferredPositions | `(input: readonly string[], gamePositions: readonly string[], usePositions: boolean) => { ok: true } \| { ok: false; message: string }` | usePositions: 1–2개, 모두 gamePositions 안, 중복 없음. 아니면 `[]`만 허용 |
| validateScrimSchedule | `(scheduledAt: Date, now: Date, maxDaysAhead: number) => 'ok' \| 'not_future' \| 'too_far'` | scheduledAt ≤ now → not_future, > now + maxDaysAhead일 → too_far |
| isCapacityInRange | `(capacity: number, range: { min: number; max: number; step?: number }) => boolean` | 정수 && min ≤ capacity ≤ max && (capacity − min) % step = 0 (D97) |
| canStartScrim | `(input: { requiresFull: boolean; capacity: number; joinedCount: number }) => boolean` | requiresFull → joinedCount = capacity, 아니면 joinedCount ≥ `SCRIM_MIN_PLAYERS_TO_START`(2) (D97) |
| decideOverdueScrim | `(input: { status: ScrimStatus; scheduledAt: Date; now: Date; autoCloseAfterMin: number; canStart: boolean }) => 'start' \| 'cancel' \| null` | status가 recruiting·full이고 now ≥ scheduledAt + autoCloseAfterMin분일 때만: canStart → start, 아니면 cancel. 그 외 null |
| computeOpenPositions | `(positions: readonly string[], capacity: number, firstChoices: readonly (string \| null)[]) => { position: string; count: number }[]` | 빈 자리(capacity − firstChoices.length) 0이면 `[]`. capacity가 positions.length로 나누어떨어지지 않으면 `[]`. 포지션당 정원 = capacity / positions.length, 남은 수 = 그 값 − 1지망이 그 포지션인 수, 1 이상만 positions 순서로 |
| isJoinClosed | `(scheduledAt: Date, now: Date) => boolean` | now ≥ scheduledAt |
| isNoShowMarkWindowOpen | `(scheduledAt: Date, now: Date, windowDays: number) => boolean` | now ≤ scheduledAt + windowDays일 |

`packages/core/src/index.ts`에 export 추가. 기존 S1 함수는 그대로.

---

## 8. 화면 (frontend)

### `/scrims` (목업 Scrims)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 헤더 | - | 「모집글 작성」 → `/scrims/new`. 제한 중이면 비활성 + 해제 시각 툴팁 |
| 노쇼 제한 배너 | `GET /me/scrim-restriction` restricted | 「노쇼 {recent_no_show_count}회로 {until KST MM.DD HH:mm}까지 내전 참가·모집이 제한돼요」 |
| 게임 필터 | `GET /games`(sort_order) + 「전체」 | 쿼리 `game`. 숫자 배지 없음(D86) |
| 상태 탭 | 모집 중 / 진행 중 / 종료 = open / playing / ended | 쿼리 `status`. URL 쿼리와 동기화 |
| 카드 | `ScrimSummary` | 게임 태그(`GAME_META`), 상태 배지(my_status joined → 「참가 중」, waitlist → 「대기 중」, 그 외 status·join_closed로 「모집 중 / 정원 마감 / 시작 대기 / 진행 중 / 종료 / 취소됨」), 제목, KST 시각(「오늘 21:00」 「토요일 20:00」), 방장, 태그(options: 「자동 밸런스」 「포지션 선택」 「ELO 반영 / ELO 미반영」), 인원 `joined/capacity` + 점 표시, 보조 줄(open_positions → 「서폿 1 · 정글 1 구함」, 정원 마감·대기 있음 → 「대기 N명」, 그 외 「N자리 남음」) |
| 카드 버튼 | - | 모두 상세로 이동(문구만 「참가하기」 / 「대기열 등록」 / 「참가 중 · 상세 보기」) — 포지션 선택이 상세에 있어서(D91) |
| 페이징 | next_cursor | 「더 보기」(무한 스크롤 아님) |
| 빈 상태 | items [] | 탭별 문구 + 「모집글 작성」 |

### `/scrims/new` (목업 ScrimNew)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 01 게임 선택 | `GET /games` | 카드(이름, 설명 = has_teams·has_positions로 「팀전 · 포지션 있음」 「개인 순위전」 「팀전」). 고르면 정원 = capacity.default |
| 02 기본 정보 | - | 제목(2–40자), 날짜 + 시작 시간(KST 입력 → `YYYY-MM-DDTHH:mm:00+09:00`), 정원 스테퍼(capacity.min–max, min = max면 고정 표시) |
| 내 희망 포지션 | game.positions | 포지션 받는 내전일 때만: 1지망(필수)·2지망(선택). 목업에 없지만 방장이 참가자 1번이라 필요(D82) |
| 03 진행 방식 | - | 토글 3개: 팀 자동 밸런스(has_teams 아니면 비활성), 포지션 희망 받기(has_positions 아니면 비활성), 시즌 ELO에 반영 |
| 04 규칙 | - | textarea 1000자 |
| 미리보기 | 입력값 | 목업 PREVIEW 카드 |
| 제출 | `POST /scrims` | 성공 → `/scrims/{id}`. VALIDATION_FAILED details를 필드 아래에. 노쇼 제한 중이면 상단 배너 + 제출 비활성 |

### `/scrims/[id]` (목업 ScrimDetail)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 헤더 | game, status, title, scheduled_at, host, options, rules | 「오늘 21:00 · 방장 X · 시즌 ELO 반영」, 규칙 본문(접기), 모집 중이면 「시작까지 HH:MM:SS」 카운트다운 |
| 진행 단계 | status | 6절 표 |
| ROSTER 참가자 | players, capacity | 슬롯 capacity개(빈 슬롯 포함). 닉네임(프로필 링크), 방장 표시, 1지망·2지망 칩, no_show 배지. 실력값·NEW 배지는 S3(표시 안 함) |
| WAITLIST | waitlist | 순번·닉네임·희망 포지션. 모집 중일 때만 섹션 표시 |
| 참가 영역 | viewer | 포지션 받는 내전: 1지망·2지망 선택(현재 값 = viewer.preferred_positions). 버튼: can_join → 「참가하기」(정원 마감이면 「대기열 등록」), 참가·대기 중 → 「포지션 변경」(같은 POST) + can_leave → 「참가 취소」. 결과 토스트: 「참가 확정」 / 「대기 {waitlist_order}번으로 등록」. join_closed → 「시작 시각이 지나 참가·취소할 수 없어요」. restricted_until → 제한 안내 |
| 방장 메뉴 | viewer.can_edit / can_start / can_cancel | 「수정」(대화상자: 제목·날짜·시간·정원·규칙·ELO 반영·자동 밸런스), 「시작」(확인 대화상자, can_start false면 비활성 + 이유), 「모집 취소」(확인 대화상자). 운영진도 can_start·can_cancel이면 같은 메뉴 |
| 운영진 노쇼 | role admin, status playing·finished | 참가자 슬롯마다 joined → 「노쇼 표시」(can_mark_no_show일 때), no_show → 「노쇼 정정」(항상). `PUT …/no-show` |
| AUTO BALANCE / RESULT | balance, result (null) | 빈 상태 카드(「팀 밸런스는 곧 열려요」 「결과 입력은 곧 열려요」). 목업 내용은 S3 |
| 갱신 | - | 모집 중이면 20초 간격 재조회 + 창 포커스 시 재조회. 상태 변경 응답(ScrimDetail)으로 캐시를 바로 교체하고 목록 캐시 무효화 |

- 훅: `useGames`, `useScrims`(useInfiniteQuery), `useScrim`, `useCreateScrim`, `useUpdateScrim`, `useJoinScrim`, `useLeaveScrim`, `useStartScrim`, `useCancelScrim`, `useSetScrimNoShow`, `useMyScrimRestriction`.
- `lib/routes.ts`: `scrims(q?: {game?, status?})`, `scrimNew()`, `scrim(id)`, `steamLinkComplete()`. 포지션 표기는 기존 `POSITION_META`(lib/games.ts) 재사용, 게임 색은 `GAME_META`·토큰 클래스(hex 금지, D53).
- 목 백엔드(`NEXT_PUBLIC_API_MOCK`)에 S2 엔드포인트 11개(대기열 승격·노쇼 제한 흉내 포함).

---

## 9. 인증 보완 (사용자 결정)

### 9-1. 리프레시 토큰 하루 1회 회전 (D73) — S0 5-3 5단계 변경

`POST /auth/refresh` 흐름(S0 5-3) 중 1–4단계(Origin, 쿠키 없음, 조회·만료, 폐기된 토큰 처리 = 유예 10초·재사용 감지·D26)는 **그대로**. 5단계만 둘로 나눈다:

| 조건(현재 토큰, `revoked_at IS NULL`, 미만료) | 처리 | 응답 |
| --- | --- | --- |
| `now − created_at < REFRESH_ROTATE_AFTER_HOURS`(기본 24시간) | **회전하지 않음**. DB 쓰기 없음 | 200 `RefreshTokenResponse`(새 액세스 토큰, DB 최신 role), **Set-Cookie 없음** |
| `now − created_at ≥ REFRESH_ROTATE_AFTER_HOURS` | S0 5단계 그대로 회전(같은 family, **같은 expires_at**, 조건부 update로 기존 토큰 폐기 + replaced_by_id) | 200 + Set-Cookie `gcd_rt`(새 토큰, Max-Age = 남은 수명) |

- `created_at`은 「이 토큰이 발급된 시각」이다(로그인 또는 직전 회전). 그래서 같은 계열에서 회전은 최대 하루 1번.
- 재사용 감지와의 관계: 감지 대상은 여전히 「회전으로 폐기된 토큰(`replaced_by_id` 있음)」뿐이다. 회전하지 않은 동안 같은 토큰을 여러 번 쓰는 것은 정상 사용이다. 회전 직후 옛 토큰은 10초 유예(동시 탭) 후 재사용 감지 대상(D3, D26 그대로).
- 절대 만료: 로그인 시점부터 `REFRESH_TOKEN_TTL_DAYS`(30일) 그대로. 회전·미회전 모두 expires_at을 늘리지 않는다. 「마지막 사용부터 30일」은 채택하지 않음(사용자 결정).
- 동시 요청: 24시간이 지난 토큰으로 두 탭이 동시에 refresh → 한쪽은 회전, 다른 쪽은 조건부 update 0행 → 유예 경로(S0 5-3 6번)로 액세스 토큰만. 변경 없음.
- `REFRESH_ROTATE_AFTER_HOURS=0`이면 매번 회전(S1까지 동작). 0 이상 정수.
- backend: `RotateResult`에 `{ kind: 'kept'; userId }` 추가, 컨트롤러는 `rotated`일 때만 Set-Cookie. 웹 변경 없음.
- 보안 영향: 탈취된 리프레시 쿠키는 다음 회전(최대 24시간) 전까지 재사용 감지에 걸리지 않는다. 사용자 보고(「접속할 때마다 로그인」)를 줄이는 대가로 받아들인 위험이다(D73).
- 테스트(backend): 24시간 미만 → Set-Cookie 없음·DB 행 수 변화 없음, 정확히 24시간 → 회전, 0 → 항상 회전, 회전 후 10초 안 옛 토큰 → 유예, 10초 후 → REUSED + 계열 폐기, 로그아웃 후 → INVALID(D26), 미회전 토큰도 expires_at 지나면 INVALID.

### 9-2. 스팀 연동 팝업 (D74) — S1 5-2 확장

**요청**: `LinkGameAccountRequest` steam 변형에 `display: 'redirect' | 'popup'`(기본 redirect, shared `SteamLinkDisplay`). 기존 `{provider:'steam'}` 요청은 redirect로 그대로 동작(호환).

**API 시작(S1 5-2 시작 2·3단계 변경)**
- `gcd_steam` 쿠키 payload에 `display` 추가: `{ state, user_id, iat, display }`. 검증 스키마는 `display`를 선택값으로 받고 없으면 redirect(배포 직후 10분 안의 옛 쿠키 호환).
- `return_to = {WEB_ORIGIN}/api/v1/me/game-accounts/steam/callback?state={state}` — popup이면 끝에 `&display=popup`. 파라미터 순서 고정(state 먼저).

**API 콜백(S1 5-2 콜백 변경점)**
- 4단계 `openid.return_to` 비교 기준 = `steamReturnTo(config, 쿠키.state, 쿠키.display)`.
- 도착지 결정: 쿠키가 유효하면 쿠키의 display, 쿠키가 없거나 깨졌으면 쿼리 `display === 'popup'`일 때만 popup(쿼리는 오류를 보여줄 페이지 선택에만 쓰고 검증에는 쓰지 않는다).
- popup: `302 {WEB_ORIGIN}/steam-link/complete?steam=linked` 또는 `?steam_error={SteamLinkErrorCode}`(`STEAM_LINK_COMPLETE_PATH`). redirect: S1 그대로 `/settings?steam=linked|steam_error=…`.

**웹: 설정 화면 「Steam으로 로그인」**
1. 클릭 핸들러에서 **동기적으로** 먼저 `window.open('', 'gcd-steam-link', 'popup,width=520,height=720')`(사용자 동작 안에서 열어야 차단되지 않음).
2. 반환값이 null(차단) → `POST {provider:'steam', display:'redirect'}` → `location.assign(authorize_url)`(S1 흐름, `/settings?steam=…` 토스트 그대로).
3. 열렸으면 `POST {provider:'steam', display:'popup'}` → 성공 시 `popup.location.href = authorize_url`, 실패 시 `popup.close()` + 오류 토스트.
4. 결과 수신(둘 다 등록, **첫 메시지 하나만** 처리):
   - `BroadcastChannel(STEAM_LINK_BROADCAST_CHANNEL)` 메시지
   - `window` `message` 이벤트: `event.origin === window.location.origin`인 것만
   - 공통: `SteamLinkPopupMessage.safeParse(data)` 성공만. 처리 = `useMyGameAccounts` 무효화(새로고침 없이 재조회) + 토스트(linked → 성공, error → `ERROR_MESSAGES[code]`) + 리스너 정리.
5. 팝업 닫힘 감시: 1초마다 `popup.closed` 확인, 메시지 없이 닫혔으면 계정 목록을 한 번 재조회하고 버튼을 다시 활성화한다. **BroadcastChannel 리스너는 `STEAM_LINK_STATE_TTL_SEC`(600초)까지 유지**(스팀 페이지가 COOP로 opener 관계를 끊으면 `popup.closed`가 일찍 true가 될 수 있어서).

**웹: 완료 페이지 `/steam-link/complete`** (`app/steam-link/complete/page.tsx`, `(main)`·`(auth)` 그룹 밖)
- 인증 부팅(`/auth/refresh`)을 하지 않는다 — 팝업이 refresh를 부르면 원래 창과 회전 경쟁이 생긴다. middleware matcher에서 `steam-link/` 제외.
- `SteamLinkCompletePageQuery`로 쿼리 파싱(실패 → `{status:'error', code:'INTERNAL_ERROR'}`) → 메시지 생성 → `new BroadcastChannel(...).postMessage(msg)`(지원 시) + `window.opener?.postMessage(msg, window.location.origin)` → `window.close()`.
- 300ms 뒤에도 열려 있으면(opener 없음·닫기 거부) 결과 문구 + 「설정으로 돌아가기」 링크(`routes.settings(query)` — 기존 토스트 흐름) 표시.
- 목 백엔드: popup이면 `authorize_url = /steam-link/complete?steam=linked`.

---

## 10. 구현 경계 (backend 모듈)

| 위치 | 내용 |
| --- | --- |
| `apps/api/src/modules/games/` | `GET /games`(GameCatalog 재사용 가능) |
| `apps/api/src/modules/scrims/` | 4절 엔드포인트(games·restriction 제외 9개), 5절 흐름, 직렬화(`ScrimSummary`/`ScrimDetail` parse), 커서 |
| `apps/api/src/modules/scrims/scrim-restriction.service.ts` | 5-6(조회 + core 판정), `GET /me/scrim-restriction`, 작성·참가에서 재사용 |
| `apps/api/src/modules/scrims/scrim-auto-close.ts` | 5-5 cron(`@nestjs/schedule`, `SCRIM_JOBS_ENABLED`) |
| `apps/api/src/common/scrim-lock.ts`(또는 scrims 안) | 5-0 `SELECT … FOR UPDATE` 헬퍼(`$queryRaw`) |
| `modules/auth/refresh-token.service.ts`, `auth.controller.ts` | 9-1 |
| `modules/game-accounts/steam-link*.ts`, `game-accounts.controller.ts` | 9-2 API |
| `config/env.ts` | 11절 8개 |

---

## 11. 환경 변수 (`.env.example` 반영됨, 신규 8개)

| 변수 | 사용처 | 기본 | 비고 |
| --- | --- | --- | --- |
| REFRESH_ROTATE_AFTER_HOURS | api | 24 | 0 이상 정수. 9-1 |
| SCRIM_SCHEDULE_MAX_DAYS_AHEAD | api | 30 | 양의 정수. 시작 시각 상한(메인 기본값 2) |
| SCRIM_AUTO_CLOSE_AFTER_MIN | api | 60 | 양의 정수. 5-5 |
| SCRIM_JOBS_ENABLED | api | true | `true`/`false`만(D72와 같은 엄격 파싱). false면 자동 마감 cron 미등록 |
| SCRIM_NO_SHOW_THRESHOLD | api | 3 | 양의 정수(메인 기본값 1) |
| SCRIM_NO_SHOW_WINDOW_DAYS | api | 30 | 양의 정수 |
| SCRIM_NO_SHOW_RESTRICTION_DAYS | api | 7 | 양의 정수 |
| SCRIM_NO_SHOW_MARK_WINDOW_DAYS | api | 7 | 양의 정수. 노쇼 표시 기한(D83) |

기본값 상수는 shared(`REFRESH_ROTATE_AFTER_HOURS_DEFAULT`, `SCRIM_*_DEFAULT`, `NO_SHOW_*_DEFAULT`)에 있다. Railway 배포에서 값을 안 넣어도 기본값으로 동작한다.

---

## 12. 담당 배정

S2 실행 구현자: **logic**, **backend**, **frontend** (+ qa). integration은 할 일 없음(외부 API 호출 없음).

### 의존 순서

```
architect(완료)
  ├─ logic(core 13개) ───────────────┐
  ├─ backend(core import 이름만 맞추고 시작) ─┼─ backend 테스트 통과 → qa
  └─ frontend(목 백엔드로) ─────────────┘
```
셋 다 바로 시작. backend는 core 함수를 7절 시그니처대로 import하고, logic 완료 전에는 core 의존 테스트가 실패해도 된다(S1과 같은 방식). 인증 보완 2건은 내전과 독립이라 backend·frontend가 먼저 끝내도 된다.

### logic (domain-logic-dev) — `packages/core/src/**`

1. 7절 함수 13개 + vitest. 경계: 노쇼 정확히 3회·30일 경계(구간 시작 배제·끝 포함)·until 경계(now = until이면 해제)·발동 후 4번째 노쇼로 연장·오래된 발동 + 최근 1회(L 기준만 보면 틀리는 경우, 5-6 규칙)·미래 시각 무시·`noShowLookbackStart`로 자른 입력과 전체 입력의 판정 동일, 대기열 동률(joinedAt 같음 → id), 승격 수 > 대기 수, joinedCount > capacity 예외, 포지션 중복·범위 밖·포지션 없는 게임에 값, 시작 시각 = now·정확히 30일, 고정 정원 9/10, open_positions 1지망 쏠림·나누어떨어지지 않는 정원, 자동 마감 경계(정확히 60분).
2. 보고서: `_workspace/02_logic-dev_s2.md`.

### backend (backend-dev) — `apps/api/src/**`, `apps/api/test/**`

1. `config/env.ts`: 11절 8개.
2. 9-1 리프레시 회전(테스트 포함, DB 필요분은 작성만).
3. 9-2 스팀 팝업 API: 요청 display, 쿠키 payload, return_to, 콜백 도착지. 테스트: popup 성공·각 오류 → `/steam-link/complete?…`, 쿠키 없음 + 쿼리 display=popup → 완료 페이지로 STATE_INVALID, redirect는 S1 테스트 그대로 통과, 쿠키 display ≠ return_to display(변조) → STEAM_OPENID_INVALID.
4. `GET /games`, 내전 9개 + `GET /me/scrim-restriction`. 5절 흐름 전부, 5-0 잠금, `canTransition` 검사, 직렬화 parse, 커서, 자동 마감 cron(advisory xact lock, 시작 시 1회).
5. `test/support/fake-prisma.ts`에 S2 모델(scrims·scrim_players·games capacity) 추가.
6. 테스트(DB 없이): 작성(검증 details·노쇼 제한 Retry-After·방장 자동 참가), 목록(탭·정렬·커서·다른 탭 커서 거부·my_status·open_positions), 참가(joined/waitlist/재참가 맨 뒤/포지션 변경 멱등/포지션 없는 게임에 포지션 → 400/join_closed/제한 중 새 신청 403·포지션 변경은 허용), 취소(대기 1번 승격·포지션 유지·full→recruiting·방장 409·멱등), 수정(정원 축소 409·확대 승격·미루기로 join_closed 해제·비방장 403), 시작(고정 정원 미달 409·2명·운영진 가능), 모집 취소(이유 host/admin), 노쇼(비운영진 403·시작 전 409·기한 경과 409·정정은 기한 없음·대기자 409·멱등), 자동 마감 분기, 응답에 email·discord_id 없음. **DB 필요(작성만)**: 마지막 자리 동시 참가 `Promise.all` 10건 → joined = capacity·나머지 waitlist, 동시 취소+참가에서 불변식 유지, 동시 refresh 24시간 경계.
7. 보고서: `_workspace/02_backend-dev_s2.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 8절 세 화면, 훅 11개, `lib/routes.ts`, `lib/errors.ts` S2 문구 다듬기(architect 초안 있음), 목 백엔드 S2.
2. 9-2 스팀 팝업(설정 카드 수정, 완료 페이지, middleware matcher 제외, 목 동작).
3. KST 표시·입력(날짜+시간 → `+09:00`), 카운트다운, 빈 상태(balance·result·목록).
4. 검증: `corepack pnpm --filter web typecheck && test && build`, 목 모드로 데스크톱·모바일 × 라이트·다크. 팝업 차단 대체 경로는 수동 확인 절차를 보고서에 적는다.
5. 보고서: `_workspace/02_frontend-dev_s2.md`.

### qa (qa-verifier)

- 교차 대조: 4절 11개 엔드포인트 ↔ 컨트롤러 ↔ 웹 훅, 오류 코드 36개 ↔ `DEFAULT_ERROR_MESSAGE` ↔ 웹 `ERROR_MESSAGES`, Prisma enum `scrim_cancel_reason` ↔ shared `ScrimCancelReason`, 전이 맵 2개 ↔ 상태 갱신 코드(6절 표), `GAME_SEED` 정원 ↔ 마이그레이션 수동 UPDATE.
- 5-0 잠금이 7개 변경 경로(수정·참가·참가 취소·시작·모집 취소·노쇼·자동 마감) 모두에 있는지, 불변식(대기 있으면 꽉 참) 위반 경로가 없는지.
- 마이그레이션에 `DROP INDEX "game_accounts_one_primary_per_user_game"` 없음.
- 보안 경계: 비방장 수정·시작·취소 → 403, 비운영진 노쇼 → 403, 제한 우회(취소 후 재참가·작성), 스팀 팝업 메시지 origin·스키마 검사, 완료 페이지가 refresh를 부르지 않음, 리프레시 미회전 시 Set-Cookie 없음.

---

## 13. 결정 사항 (S2, D73부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D73 | **(사용자 결정)** 리프레시 토큰은 현재 토큰 발급(`created_at`) 후 `REFRESH_ROTATE_AFTER_HOURS`(24) 이상 지났을 때만 회전, 아니면 같은 토큰 유지·Set-Cookie 없음. 재사용 감지·10초 유예·D26·30일 절대 만료 그대로. 스키마 변경 없음 | 회전된 쿠키가 저장되지 못하면 다음 접속 때 재사용 감지로 로그인이 끊김(사용자 보고). 회전 빈도를 하루 1번으로 줄여 그 위험 창을 줄인다. 대가: 탈취 쿠키 감지가 최대 24시간 늦어짐 |
| D74 | **(사용자 결정)** 스팀 연동 팝업. 결과 전달은 BroadcastChannel + `opener.postMessage`(targetOrigin·origin 검사) **둘 다** 보내고 첫 메시지만 처리. 팝업 여부는 요청 `display` → 쿠키 payload·return_to 쿼리. 팝업 도착지 `/steam-link/complete`(인증 부팅 없음). 차단 시 redirect | 스팀 페이지가 COOP를 쓰면 opener가 끊겨 postMessage만으로는 실패할 수 있고, 구형 Safari는 BroadcastChannel이 없다. 둘 다 같은 오리진 한정이라 위조 위험이 없다. 쿠키 없이도 오류 페이지를 고를 수 있게 return_to에 display를 싣는다 |
| D75 | `GET /games` 추가(정원 범위·포지션·속성). 응답은 `paginated` 모양, next_cursor 항상 null | 작성 폼이 정원 범위를 알아야 하고, 게임은 데이터(설계 원칙 3)라 웹 상수 대신 DB에서 받는다 |
| D76 | 정원 범위를 games 컬럼 `capacity_min/max/default`로. 롤 10 고정, 롤체 2–8(기본 8), 스팀 2–16(기본 8). 마이그레이션 수동 UPDATE로 기존 행도 맞춤 | 메인 기본값 3. 롤 5:5 밸런스(7-2)는 10명 전제. 목업 기본값(롤 10, 롤체 8, 스팀 8) |
| D77 | 목업 「진행 방식」 토글 3개를 scrims 컬럼 `rated`·`auto_balance`·`use_positions`로 저장(적용값). S2는 use_positions만 동작에 쓰고 나머지는 S3 | 목업 ScrimNew·Scrims 태그(「ELO 미반영」)에 있고, 나중에 컬럼을 추가하면 기존 모집글 값이 비게 된다 |
| D78 | 시작: 방장·운영진 수동(`POST /start`, 시각 제한 없음). 조건 = 고정 정원 게임은 꽉 참, 그 외 2명 이상. 시작 시각 + 60분이 지나도 시작 안 했으면 cron이 자동 마감(조건 충족 → playing, 미달 → cancelled `not_started`). 전이 recruiting → playing 추가 | 슬라이스가 architect에 위임. 방장이 버튼을 잊어도 결과 입력(S3, playing 필요)이 막히지 않게 자동 시작을 두고, 사람이 안 모인 모집글이 목록에 계속 남지 않게 자동 취소 |
| D79 | 정원을 joined 수 아래로 줄이지 못하게 하고(SCRIM_CAPACITY_BELOW_JOINED) 전이 joined → waitlist 삭제 | 확정 참가자를 대기로 밀어내는 규칙(누구를?)이 필요 없어진다 |
| D80 | 모집 취소는 `POST /scrims/:id/cancel`(삭제 아님), 방장·운영진. `cancelled_at`·`cancel_reason` 기록, 참가자 행은 그대로 | 문서 6장에 경로 없음. 취소 이력·이유 표시(목업 「종료」 탭). 운영진 정리 권한 필요 |
| D81 | `POST /join`은 이미 참가·대기 중이면 희망 포지션만 바꾸는 멱등 요청. `DELETE /join`은 참가 기록 없으면 200. 둘 다 200 + ScrimDetail. `SCRIM_ALREADY_JOINED` 없음 | 상세 화면 「포지션 변경」을 별도 경로 없이 처리, 더블 클릭·재시도에 안전 |
| D82 | 희망 포지션 1–2개(1지망 필수, 2지망 선택, 중복 금지), 값 검증은 games.positions 기준(서버). 실패는 `VALIDATION_FAILED` + details. 방장도 작성 시 고른다(`host_preferred_positions`) | 「미드 고정」처럼 1지망만 있는 사람 허용. 게임은 데이터라 enum 대신 DB 값. 방장 = 참가자 1번(메인 기본값 4) |
| D83 | 노쇼: 운영진만, 대상 joined·no_show 행, 내전 playing·finished, 표시는 시작 시각부터 7일 안(정정은 기한 없음). 집계 기준 = `no_show_marked_at`, 24시간 단위 이동 구간(KST 아님), 발동한 노쇼마다 7일(가장 늦은 것 기준). 제한은 새 참가·대기 등록·작성만 막고 기존 참가와 포지션 변경·취소는 허용. 캐시 컬럼 없이 요청마다 계산 | 문서 7-4. S0 인덱스 `(user_id, status, no_show_marked_at)` 그대로 사용. 표시 기한으로 「한 달 지난 노쇼를 몰아서 표시」해 바로 제한이 걸리는 것 방지. 기간은 시간 길이라 KST 경계가 필요 없다 |
| D84 | SCRIM_BANNED(403)는 `Retry-After`(해제까지 초) 헤더로 해제 시각을 전하고, 본문은 S0 형식 유지. 상세 안내는 `GET /me/scrim-restriction`. 상세 응답 `viewer.restricted_until`에도 포함 | 오류 본문에 필드를 늘리지 않는다는 S0·S1 규칙 유지 |
| D85 | 동시성: 명단을 바꾸는 모든 경로가 트랜잭션 첫 문장에서 `SELECT … FROM scrims WHERE id=? FOR UPDATE`. 대기 순번 = (joined_at, id) | 메인 기본값 6. 조건부 update보다 승격·상태 변경을 한 번에 다루기 쉽고, 잠금 범위가 내전 1행이라 경합이 작다 |
| D86 | 목록 `status`는 탭 값(open·playing·ended, 기본 open)이고 raw 상태값이 아니다. 탭별 개수는 내려주지 않는다. 커서에 탭을 넣어 다른 탭 커서를 거부 | 목업 탭이 상태 묶음(모집 중 = recruiting+full). 목업 필터 숫자는 별도 count 쿼리가 필요해 S2에서 뺌 |
| D87 | 내전 상태 변경 응답은 모두 ScrimDetail | 웹이 응답으로 상세를 바로 갱신(재조회 왕복 제거), 대기 순번 안내에 필요 |
| D88 | 상세는 모든 멤버가 조회(취소된 내전 포함). 슬롯 순서 = 방장 먼저, joined_at 순. balance·result는 `z.null()` 자리 | 목업 상세. D39와 같은 확장 규칙 |
| D89 | 스팀 내전의 세부 게임 선택 필드는 만들지 않는다(제목에 게임 이름) | 슬라이스 기본값. S5 플레이타임 랭킹과 묶을 때 app_id 필드를 다시 검토 |
| D90 | 상세 화면에 운영진 노쇼 표시·정정 버튼 포함 | 버튼 2개 수준이라 간단하고, 없으면 S6 전까지 노쇼 규칙을 쓸 방법이 없다 |
| D91 | 목록 카드 버튼은 모두 상세로 이동(목록에서 바로 참가하지 않음) | 포지션 게임은 참가 전에 1지망을 골라야 한다. 게임별로 버튼 동작이 갈리지 않게 |
| D92 | 참가·대기·취소·포지션 변경은 시작 시각에 마감. 방장은 마감 뒤에도 시작 시각을 미래로 미뤄 다시 열 수 있다 | 메인 기본값 2. 연기할 방법이 없으면 취소 후 다시 모집해야 한다 |
| D93 | 버튼 노출(can_*)과 join_closed는 서버가 계산해 응답에 넣는다(표시용, 서버는 요청 때 다시 검사) | 클라이언트 시계 오차·역할 판단 중복 방지 |
| D94 | 방장은 참가 취소 불가, 위임 없음. 방장의 포지션 변경은 같은 `POST /join` | 메인 기본값 4 |
| D95 | 시작·모집 취소·자동 마감 때 대기열 행은 waitlist 그대로 둔다(자동 cancelled 하지 않음). 상세의 대기열 섹션은 모집 중일 때만 보인다 | 이력 보존, 전이 하나 덜 씀 |
| D96 | 자동 마감 cron은 `SCRIM_JOBS_ENABLED`로 따로 끈다(SYNC_JOBS_ENABLED와 분리), 5분 주기, `pg_try_advisory_xact_lock` | 동기화 작업과 성격이 달라 테스트에서 따로 끄고 싶다. D62 방식 재사용 |
| D97 | (사용자 결정, D76·D78 수정) 롤 정원 10 고정 → 2–10명 2명 단위(1:1–5:5), 정한 정원이 꽉 차야 시작. games에 `capacity_step`(기본 1)·`start_requires_full`(기본 false) 추가(마이그레이션 `20261029160000_s2_capacity_step`), `GameCapacityRange`에 `step`·`start_requires_full`. core `isCapacityInRange(capacity, {min, max, step?})`는 (capacity − min)이 step의 배수인지도 검사, `canStartScrim({requiresFull, …})`. 롤체·스팀은 단위 1, 2명 이상 시작(변경 없음). 정원 6·8처럼 포지션 수(5)로 나누어떨어지지 않으면 open_positions는 [] | 소규모 내전 허용, 두 팀 인원 동일 유지 |
| D98 | (사용자 결정) 스팀 내전은 어떤 스팀 게임인지 필수로 고른다. games에 `requires_steam_app`(기본 false, steam만 true), scrims에 `steam_app_id`·`steam_app_name`(nullable) 추가(마이그레이션 `20261029170000_s2_steam_app`). `GameView.requires_steam_app`, `ScrimSummary.steam_app: {app_id, name} \| null`, 작성 `steam_app_id`(requires_steam_app 게임만 필수, 다른 게임이면 400), 수정 `steam_app_id`(바꿀 때만). `GET /steam-apps?q=`(로그인 필요): q가 비면 멤버 보유 게임(steam_playtime 보유 계정 수 많은 순, 최대 20), q가 있으면 보유 게임 이름 일치(최대 10) 다음 스팀 상점 검색(키 불필요 `storesearch`, 검색어별 10분 캐시) — 합쳐 최대 20, 상점 실패는 `store_unavailable: true`로 보유 결과만. 이름은 보유 기록 → 최근 상점 검색 결과 → 상점 `appdetails` 순으로 서버가 정해 저장(상점에 없으면 400, 상점 오류면 502). 외부 호출은 잠금 트랜잭션 밖에서. 배너 이미지는 `steamAppHeaderImageUrl`(CDN header.jpg). 웹 배너 태그: 롤은 정원/2로 `LEAGUE · 2V2`처럼 표시 | 같은 "스팀" 내전이라도 게임이 달라 고르는 기준이 필요. 이름을 저장해 상점 장애에도 목록이 깨지지 않게 |
---

## 14. 확인 필요 (사용자 판단)

메인 기본값 1–7은 그대로 반영했다(1 → D83·11절, 2 → D92·11절, 3 → D76, 4 → D94, 5 → 1절 제외, 6 → D85, 7 → 5-3). 아래만 사용자 확인이 필요하다. 답이 오기 전에는 표의 「현재 계약」대로 구현한다.

| # | 질문 | 현재 계약(보수적 기본) | 다른 선택지 |
| --- | --- | --- | --- |
| Q1 | 내전 시작 처리: 방장(또는 운영진)이 「시작」을 누르고, 시작 시각 60분 뒤까지 안 누르면 자동 처리(조건 충족 → 진행 중, 미달 → 자동 취소)해도 되나? | D78 | (a) 시작 시각에 즉시 자동 시작 (b) 자동 처리 없이 방장만 (c) 60분 대신 다른 값(환경 변수로 바꿀 수 있음) |
| Q2 | 롤 내전은 10명 고정이고 10명이 다 차야 시작할 수 있다. 8명·6명 내전(4:4, 3:3)도 허용할까? | D76, D78 | 롤 정원 범위를 6–10 짝수로 열기(밸런스 S3 영향: 포지션 5개 전제가 깨짐) |
| Q3 | 노쇼 30일·7일 계산 기준을 「운영진이 표시한 시각」으로 하고, 표시는 내전 시작 후 7일 안에만 받는다. 「내전 시작 시각」 기준이 더 맞나? | D83 | 내전 시작 시각 기준(늦게 표시해도 과거 시점으로 계산) |

---

## 15. 영향받는 기존 파일

architect가 이번에 바꾼 것:

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/common/errors.ts` | 오류 코드 7개·HTTP 상태 |
| `packages/shared/src/constants/enums.ts` | `ScrimCancelReason` |
| `packages/shared/src/constants/games.ts` | `GameSeed.capacity_min/max/default`, `GAME_SEED` 값 |
| `packages/shared/src/constants/transitions.ts` | scrims recruiting → playing 추가, scrim_players joined → waitlist 삭제, 주석 |
| `packages/shared/src/paths.ts` | S2 경로 8개(games, scrims, scrim, scrimJoin, scrimStart, scrimCancel, scrimPlayerNoShow, myScrimRestriction) |
| `packages/shared/src/auth.ts` | `REFRESH_ROTATE_AFTER_HOURS_DEFAULT`, refresh 주석 |
| `packages/shared/src/game-accounts.ts` | `SteamLinkDisplay`, `LinkGameAccountRequest` steam `display`, `SteamLinkCallbackQuery.display`, `STEAM_LINK_COMPLETE_PATH`, `STEAM_LINK_BROADCAST_CHANNEL`, `STEAM_LINK_MESSAGE_TYPE`, `SteamLinkCompletePageQuery`, `SteamLinkPopupMessage` |
| `packages/shared/src/index.ts` | 새 모듈 export |
| 새 파일 | `packages/shared/src/scrims.ts`, `game-catalog.ts`, `contract.s2.test.ts` |
| `packages/shared/src/contract.s1.test.ts` | steam 요청 parse 결과에 `display: 'redirect'`(1줄) |
| `apps/api/prisma/schema.prisma` + `migrations/20261029120000_s2/` | 3절 |
| `apps/api/prisma/seed.ts` | games 정원 3개 컬럼 upsert |
| `apps/api/src/common/app-error.ts` | `DEFAULT_ERROR_MESSAGE` S2 7개 |
| `apps/web/src/lib/errors.ts` | `ERROR_MESSAGES` S2 7개(초안) |
| `.env.example` | 11절 8개 |

구현자가 바꿔야 하는 기존 파일(계약 변경 영향): `apps/api/src/modules/auth/refresh-token.service.ts`·`auth.service.ts`·`auth.controller.ts`(9-1), `modules/game-accounts/steam-link.service.ts`·`steam-link-cookie.ts`·`game-accounts.controller.ts`(9-2), `config/env.ts`(11절), `test/support/fake-prisma.ts`(S2 모델), `apps/web/src/components/settings/game-accounts-section.tsx`(팝업), `apps/web/src/middleware.ts`(matcher), `apps/web/src/lib/routes.ts`, `apps/web/src/lib/api/mock/**`, `apps/web/src/app/(main)/scrims/page.tsx`(자리 → 목록).
