# 계약: S6 관리자 도구, 승인 되돌리기, 시즌 관리, 공지·패치노트·이벤트, API 키 관리, 감사 로그

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서") 2장 운영 「관리자 도구(멤버 관리, 결과 분쟁 처리, 공지, 통계)」·정보 「패치노트·이벤트」, 5장, 6장 `GET /patch-notes`·`GET /events`, 7-1·7-3(되돌리기·시즌), 8장 `/admin`·`/news`·`/`·`/settings`, 10장 「잘못 반영된 레이팅은 되돌리기 어렵다」. 슬라이스: `_workspace/00_input/slice.md`(S6, 메인 기본값 1–5 반영).
선행 계약: `_workspace/S0`(D1–D31), `S1`(D32–D72), `S2`(D73–D102), `S3`(D103–D139), `S4`(D140–D201), `S5`(D202–D240)의 `01_architect_contract.md`. 와이어 형식(S0 3절), 외부 식별자 비노출(D38), 화면 env 값 노출(D101), 승인 흐름·잠금(S3 5-5, S4 6-2·15절), 시즌 종료(S4 6-3), 랭킹 캐시(S4 7절), 봇 인증(S5 6-1)은 그대로 쓴다. 이 문서는 여섯 계약을 **확장**하고, 깨는 것은 1-3절에 모두 적는다.
실제 계약은 코드가 우선한다: `packages/shared/src/**`(특히 새 파일 `admin.ts`, `news.ts`, `scrim-results.ts` 끝 S6 절, `bot.ts` 끝 S6 절, `me.ts` 끝 알림 설정, `dashboard.ts` news, `scrims.ts` ScrimViewer·ScrimResultView·ScrimResultRevertBlock, S6 후속 `calendar.ts`, 사용자 결정 반영 `news.ts` EventTime·`eventScheduleIssues`·`admin.ts` AdminUpcoming), `apps/api/prisma/schema.prisma`.

목업: `Admin.dc.html`(통계 4칸, APPROVAL QUEUE, NO-SHOW, NOTICE, MEMBERS)만 있다. **패치노트·이벤트·`/news`·시즌 관리·API 키·감사 로그 화면은 목업 없음** → 기존 토큰(`tokens.css`)·카드·표 패턴으로 설계(13절). 보고서에 「목업 없음」을 적는다.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-31 | S6 최초 작성: 엔드포인트 신규 35개(멤버 JWT 6 + 운영진 25 + 봇 4), 요약 응답 필수 블록 1개(`news`), ScrimDetail 필드 8개(필수), 오류 코드 11개 추가(전체 57개), API 키 scope 2개 추가(전체 8개), 결과 상태 `reverted`·내전 전이 `finished → playing`, 스키마 증분(마이그레이션 `20261031230000_s6`), core 함수 14개, 새 환경 변수 없음, 결정 D241–D280, 확인 필요 Q1–Q18 | architect |
| 2026-11-01 (4) | **D305 2단계 전환 완료 + QA 반영 정리(23-8, D311–D315).** shared `EventView.start_time·end_time`·`DashboardNewsItem`(event) `start_time·end_time`·`AdminOverview.upcoming`의 `.optional()` 삭제(필수, 시각 값은 nullable 유지), 계약 테스트 「1단계」 단언 2개 뒤집기 + 필수 키가 빠진 픽스처 2곳 채움, dist 재빌드. api·web은 필드 누락 픽스처·옛 분기만 최소 수정(동작 변경 없음, 19절 「D305 2단계 후」). QA 제안 A(`upcomingRows`·`UpcomingCard`에서 `now` 제거)·B(내전 링크 이름: 제목이 칩 문구로 끝나면 칩 생략)·C(시각 오류 문구 = shared 메시지 유지 + 웹 `eventScheduleIssueText` 해요체 매핑)를 23-8-5·23-8-7에 반영(구현과 일치, D313–D315). 23-7·23-8-7 KST 오프셋 출처 정정(core `config.ts` `KST_OFFSET_MS`). 기록: 이벤트 PATCH 동시 수정 = 조건부 updateMany + 3회 재시도 후 INTERNAL_ERROR(D311), `common/list-cursor.ts` 값 null 허용(events2, D312). QA 제안 D(홈 캘린더가 요약 실패에 묶임)는 변경 없이 Q30. Q26–Q29 상태 갱신(구현 = 추천안, 사용자 답 대기). 「명세 문서 갱신 필요」에 캘린더 항목 추가. 엔드포인트·경로·오류 코드·감사 action 수 변화 없음(33개·26개·54개) | architect |
| 2026-11-01 (3) | **캘린더 사용자 결정 3건 반영(23-8절, D298–D310).** (1) Q21: `/admin` 결과 탭 통계를 다시 **4칸**으로 — 승인 대기 · 이번 주 내전 · 이번 달 노쇼 + 4번째 칸 **「다가오는 일정」 목록 카드**. 데이터는 새 엔드포인트 없이 `AdminOverview.upcoming`(`AdminUpcoming`: 오늘부터 30일, 최대 5건, 항목 = `CalendarItem`, `has_more`) — 비교는 D306. 통계 아래 전체 폭 관리자 캘린더(편집)는 유지(D309, 해석 확인 Q26). (2) Q22: 운영진 일정에 선택 시각 `start_time`·`end_time`(KST `HH:mm`, DB `time(0)` nullable, 없으면 종일). 새 마이그레이션 `20261101120000_s6_event_times`(ADD COLUMN 2개, s6에 합치지 않음 — D301). 검증 shared `eventScheduleIssues`(D300), 정렬 `starts_on, start_time NULLS FIRST, ends_on, id`(D302, `GET /events` 커서 형식 변경), EventView·캘린더 일정 항목·홈 news 이벤트 행·감사 스냅샷에 시각. 봇 응답에는 events가 없어 변경 없음(D304). 새 응답 필드는 **1단계 optional → 2단계 필수**(D305, 23-8-6). (3) Q23·Q24·Q25 사용자 확인 → 해소(변경 없음, D310). 엔드포인트·경로·오류 코드·감사 action 수 변화 없음(33개·26개·54개). shared 계약 테스트 `contract.s6.event-times.test.ts` 새 파일 26개, core 함수 4개 추가 예정(14-7, 합계 19개). Q21–Q25 해소, Q26–Q29 추가 | architect |
| 2026-11-01 (2) | **커뮤니티 캘린더 추가(사용자 요청, 23절, D282–D297).** 읽기 엔드포인트 1개 `GET /calendar`(멤버) → 신규 **33개**(멤버 6 + 운영진 23 + 봇 4), `ApiPath` S6 키 25 → **26개**(`calendar`). 새 shared 파일 `calendar.ts`(쿼리·응답·상수 2개), 계약 테스트 `contract.s6.calendar.test.ts`(10개). 일정 쓰기는 기존 `/admin/events…` 재사용(새 쓰기 엔드포인트·오류 코드·감사 action 없음). **스키마·마이그레이션 변경 없음**(events는 날짜만, D283). core 함수 2개 추가 예정(`calendarMonthRange`·`resolveCalendarMonth`, 14-7). 화면: `/admin` 결과 탭 통계 4 → **3칸**(「참가 제한 중」 제거, `AdminOverview` 응답은 그대로) + 통계 아래 전체 폭 관리자 캘린더, 홈 읽기 전용 캘린더(13절). 권한 5절 2행 추가. Q20 해소, Q21–Q25 추가 | architect |
| 2026-11-01 | **결과 이의 제기 기능 제거(D281, 사용자 결정).** 엔드포인트 3개 삭제(`POST /scrims/:id/result/disputes`, `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`) → 신규 **32개**(멤버 5 + 운영진 23 + 봇 4), 경로 28 → **25개**. 오류 코드 3개 삭제(`SCRIM_DISPUTE_NOT_ALLOWED`·`SCRIM_DISPUTE_EXISTS`·`DISPUTE_ALREADY_RESOLVED`) → S6 추가 **8개**(전체 **54개**). ScrimDetail 필드 8 → **5개**(`result.open_dispute_count`, viewer `can_dispute_result`·`has_open_dispute` 삭제). `AdminResultItem.open_dispute_count`·`AdminResultView` `disputed`·`AdminOverview.open_disputes` 삭제, 감사 action `dispute.resolve`·target `dispute` 삭제, `DISPUTE_STATUS_TRANSITIONS`·이의 제기 상수·스키마 삭제. 반려·되돌리기의 「열린 이의 제기 자동 처리」 삭제. core `disputeBlock`·`DisputeBlock` 삭제(core 함수 14 → **13개**). DB `dispute_status` enum·`scrim_result_disputes` 표는 **유지**(DROP 없음, 앱 코드 사용 안 함). 7절 제거 표시, 18-1절에 api·web 작업 목록. 결정 D281, Q3·Q4 해소 | architect |

---

## 1. 범위

### 1-1. 포함

| 문서 행 | S6 범위 |
| --- | --- |
| 2장 운영 「관리자 도구」, 8장 `/admin` | 통계(`GET /admin/overview`), 결과 승인 큐(`GET /admin/results`), 노쇼 후보(`GET /admin/no-show/scrims` + 기존 노쇼 API), 공지 작성·수정·삭제, 멤버 관리 표·역할 변경, API 키 발급·목록·폐기, 시즌 관리, 감사 로그 |
| 2장 「결과 분쟁 처리」 | 운영진이 승인 큐에서 처리한다: 승인 대기 결과는 S3 반려, 승인된 결과는 S6 되돌리기(6절). **참가자 이의 제기 접수·처리 기능은 제거됨(D281, 사용자 결정, 7절)** |
| S3 D123·D125, S4 계약 「되돌리기는 S6」 | **승인 되돌리기** `POST /scrims/:id/result/revert` — 안전한 가장 좁은 범위(6절, D242) |
| S4 1-2 「시즌 수동 생성·수정 → S6」 | `GET·POST /admin/seasons`, `PATCH·DELETE /admin/seasons/:id`. 단계별 허용 범위(11절, D268) |
| 2장 정보 「패치노트·이벤트」, 6장 `GET /patch-notes`·`/events`, 8장 `/news`·홈 「패치 소식」 | 새 표 `patch_notes`·`events`, 공개 조회 + 운영진 CRUD, `/news` 화면, 홈 `news` 블록 |
| 목업 Admin NOTICE, 문서 6장 봇 | `GET /notices`, 운영진 CRUD, 봇 전송 `GET /bot/notices/pending`·`POST /bot/notices/:id/delivered` |
| 목업 Settings NOTIFICATIONS 「새 패치 요약」, S1 D48 | `GET·PATCH /me/notification-settings`(`scrim_start`·`patch` 2개), 봇 `GET /bot/patch-notes/pending`(notify_patch 회원 DM)·`POST /bot/patch-notes/:id/delivered` |
| S5 D221 「관리자 화면은 S6」 | `GET·POST /admin/api-keys`, `POST /admin/api-keys/:id/revoke` |
| 슬라이스 「감사」 | 새 표 `admin_audit_logs`, `GET /admin/audit-logs` |
| 사용자 요청 2026-11-01 (2) 「캘린더」 | `GET /calendar`(내전 + 운영진 일정), `/admin` 통계 ~~3칸~~ **4칸(3 + 「다가오는 일정」, 2026-11-01 (3))** + 관리자 캘린더, 홈 읽기 전용 캘린더 — **23절** |
| 사용자 결정 2026-11-01 (3) | 운영진 일정 선택 시각(`start_time`·`end_time`), 「다가오는 일정」 카드(`AdminOverview.upcoming`) — **23-8절** |

### 1-2. 제외

| 항목 | 이유 |
| --- | --- |
| 이후 경기가 있는 결과의 되돌리기(이후 경기 재계산·replay) | 6-1. K 판정·시작 점수가 연쇄로 바뀌어 이미 반영된 다른 내전의 변동값·standings·뱃지를 다시 써야 한다. 문서 10장 위험 그대로 → **제외 확정**(D242, Q1) |
| 종료 처리된 시즌(closed_at)의 결과 되돌리기 | 최종 순위·뱃지가 확정돼 있다(S4 D141). 되돌리면 standings·user_badges를 다시 계산해야 한다 → **제외 확정**(D242) |
| 진행 중 시즌의 시작 시각 변경, 끝난 시즌의 기간 변경, 시작한 시즌 삭제 | 11절. 이미 반영된 rating_history의 시즌 귀속(D116)이 바뀌거나 종료 작업과 충돌한다 → **제외 확정**(D268) |
| 스팀 할인 정보·공통 게임 추천 | 문서 9장: 데이터 출처 미정(슬라이스 제외) |
| 패치노트 외부 자동 수집(크롤링) | 출처·약관(메인 기본값 1) |
| 회원 삭제·차단 | 슬라이스 제외. Q14 |
| 라이엇 운영진 수동 소유 승인(S1 예약 `/admin/riot-verifications/:id/approve`) | 슬라이스에 없다. Q13 |
| 결과 승인·대기 승격 디스코드 DM(설정 `notify_result`·`notify_waitlist`) | S5 Q12 그대로. 알림 설정에도 노출하지 않는다(D259) |
| 노쇼 일괄 저장 API | 기존 참가자별 API를 그대로 쓴다(D252) |
| 디스코드 봇 프로세스 | 봇이 가져가는 API까지(호출 예시 8-5절) |
| 하이라이트·업적·포인트·토너먼트 | P2 |
| 결과 이의 제기(참가자 접수, 운영진 목록·처리 완료, 반려·되돌리기 때 자동 처리) | **제거됨(D281, 사용자 결정 2026-11-01).** 결과 분쟁은 운영진 반려·되돌리기로만 처리한다. DB 표·enum은 남기고 쓰지 않는다(3절) |

### 1-3. 기존 결정 변경

| 기존 | 변경 | 이유 |
| --- | --- | --- |
| **S3 D123** 「승인된 결과·반영 레이팅은 수정·취소 없음(되돌리기는 S6)」 | 6절 조건을 모두 만족하면 운영진이 되돌릴 수 있다. 조건 밖은 여전히 불가 | 슬라이스 포함. 범위는 D242 |
| **S3/S0 `SCRIM_STATUS_TRANSITIONS.finished = []`**(「finished는 종착」) | `finished: ['playing']`(되돌리기 전용) | 되돌린 내전은 결과를 다시 받아야 한다. `cancelled`는 그대로 종착 |
| **S3 `SCRIM_RESULT_STATUS_TRANSITIONS.approved = []`** | `approved: ['reverted']`, 새 상태 `reverted: []`. DB enum에 값 추가 | 되돌린 사실을 행에 남긴다(pending으로 되돌리면 승인 기록과 섞인다, D243) |
| **S0 `JwtGuard`** `req.authUser.role = 토큰 claim` | `role`을 DB에서 읽는다(이미 하는 사용자 조회에 `role` 추가). 토큰의 role은 무시 | 웹 강등이 생겼다. 토큰 수명(기본 15분) 동안 강등된 운영진이 /admin을 쓰면 안 된다(D263) |
| **S0 D5** `ADMIN_DISCORD_IDS` 「승격만, 강등 없음」 | 그대로 둔다. 대신 이 목록의 회원은 웹에서 강등할 수 없다(`ADMIN_ROLE_LOCKED`) | 강등해도 다음 로그인에 다시 승격돼 화면과 실제가 어긋난다(메인 기본값 3, D264) |
| **S1 D48** 「알림 설정은 발송 기능이 생기는 슬라이스」 | S6에서 `scrim_start`·`patch` 두 항목만 API·화면에 연다 | 발송 경로가 있는 항목만(D259) |
| ~~**S3 `reject`** 결과만 반려~~ | ~~그 결과의 open 이의 제기를 함께 자동 처리~~ → **제거됨(D281)**. S3 `reject`는 바뀌지 않는다 | D250 폐기 |
| **S5 `BOT_ENDPOINT_SCOPE`** 「엔드포인트 = scope 1:1」 | 키는 리소스 단위. 공지 2개 엔드포인트가 `bot:notices` 하나, 패치노트 2개가 `bot:patch-notes` 하나. 값 ↔ `ApiKeyScope` 1:1은 유지 | 「가져오기」만 되고 「보냈음 기록」이 안 되는 키는 쓸모가 없다(D255) |
| **S4 `GetDashboardSummaryBody`** | 필수 블록 `news` 추가 | D258. api·web 같은 커밋 배포(15절) |
| **S3 `ScrimResultView`·`ScrimViewer`**(ScrimDetail) | 필수 필드 추가: 결과 `reverted_by`·`reverted_at`·`revert_reason`, viewer `can_revert_result`·`revert_blocked_reason`(5개). S6 초안의 `open_dispute_count`·`can_dispute_result`·`has_open_dispute`는 **제거됨(D281)** | 상세 화면의 되돌리기 버튼·되돌림 표시(D276) |

그대로 유지: D38(웹 응답에 discord_id 없음 — 멤버 관리 표도 `discord_username`·`discord_linked`만), D87(상태 변경 응답 = 커밋 후 ScrimDetail), D101(정책 값은 응답으로), D106(K 판정 경기 수 = 모든 시즌 이력 수), D116(시즌 = 승인 시각 기준), D141(종료 작업 잠금), D146–D148(랭킹 캐시), D156(요약 전체 캐시 금지), D196–D201(요약 부분 실패는 top_rankers만), D209(봇 요청 `.strict()`), D221(키 형식·해시).

---

## 2. 오류 코드

**8개 추가(전체 54개).** S6 초안의 이의 제기 코드 3개는 제거됨(D281, 아래 표 취소선). `packages/shared/src/common/errors.ts`, 기본 문구 `apps/api/src/common/app-error.ts`, 화면 문구 `apps/web/src/lib/errors.ts`(architect 반영 완료).

| code | HTTP | 상황 |
| --- | --- | --- |
| SCRIM_RESULT_NOT_APPROVED | 409 | 되돌리기: 그 내전에 approved 결과가 없거나 `result_id`가 그 행이 아님(오래된 화면) |
| SCRIM_RESULT_REVERT_NOT_ALLOWED | 409 | 되돌리기: `window_passed`·`season_closed`·`later_games`·`rating_mismatch`(6-2). message에 이유 문구 |
| ~~SCRIM_DISPUTE_NOT_ALLOWED~~ | - | **제거됨(D281)** |
| ~~SCRIM_DISPUTE_EXISTS~~ | - | **제거됨(D281)** |
| ~~DISPUTE_ALREADY_RESOLVED~~ | - | **제거됨(D281)** |
| ADMIN_SELF_ROLE_CHANGE | 403 | 역할 변경 대상이 나 |
| ADMIN_ROLE_LOCKED | 409 | 강등 대상이 `ADMIN_DISCORD_IDS`에 있음 |
| ADMIN_LAST_ADMIN | 409 | 강등하면 admin이 0명 |
| SEASON_NOT_EDITABLE | 409 | 11-1 표에서 허용하지 않는 필드 변경·삭제 |
| SEASON_OVERLAP | 409 | 다른 시즌과 [starts_at, ends_at) 겹침 |
| DISCORD_ALREADY_NOTIFIED | 409 | 공지·패치노트 PATCH에서 `notify_discord`를 바꾸려는데 `discord_notified_at`이 있음 |

기존 코드 재사용:

| code | 상황 |
| --- | --- |
| FORBIDDEN | 모든 `/admin/*`·되돌리기에 비운영진(RolesGuard, **없는 리소스여도 403 먼저** — S2·S3와 같음). 역할 변경 중 요청자가 이미 강등됨 |
| SCRIM_RESULT_SELF_REVIEW | 되돌리기: 내가 제출한 결과(403, D246) |
| NOT_FOUND | 없는 내전·공지·패치노트·이벤트·회원·키·시즌, 봇 delivered 대상 삭제됨 |
| VALIDATION_FAILED | shared 스키마 위반, 시즌 시각·길이(11-2), 이벤트 PATCH에서 합친 기간 위반(path `ends_on`)·합친 시각 위반(path `end_time`, 23-8-2), 패치노트·이벤트 `game` 행 없음(path `game`), 경로 `:id` uuid 아님 |

---

## 3. 스키마 변경 (`apps/api/prisma/schema.prisma`)

마이그레이션: `apps/api/prisma/migrations/20261031230000_s6/migration.sql` — `prisma migrate diff --from-schema-datamodel <HEAD 775507c schema> --to-schema-datamodel prisma/schema.prisma --script`의 **stdout만** 저장했고, 머리 주석 4줄을 뺀 비교에서 차이가 없다(architect 확인). 수동 블록 없음, `DROP` 없음(대소문자 무시 0건). `prisma format`·`validate`(가짜 `DATABASE_URL`)·`generate` 통과. DB 적용 미실행(Docker 없음).

| 대상 | 변경 | 근거 |
| --- | --- | --- |
| enum `scrim_result_status` | **값 추가** `reverted`(`ALTER TYPE … ADD VALUE`). 마이그레이션 안에서 쓰지 않는다(PostgreSQL: 같은 트랜잭션에서 새 값 사용 불가) | D243 |
| scrim_results | **추가** `reverted_by uuid NULL` FK users(SET NULL), `reverted_at timestamptz NULL`, `revert_reason text NULL` | D243 |
| patch_notes | **새 표** `id`, `game_id` FK games(RESTRICT), `version?`, `title`, `summary`, `url?`, `published_on date`, `notify_discord bool DEFAULT false`, `discord_notified_at?`, `created_by?` FK users(SET NULL), `created_at`, `updated_at`. 인덱스 `(published_on DESC)`, `(game_id, published_on DESC)` | D254 |
| events | **새 표**(Prisma 모델 `CalendarEvent`) `id`, `game_id?` FK games(SET NULL), `title`, `description?`, `url?`, `starts_on date`, `ends_on date`, `created_by?`, `created_at`, `updated_at`. 인덱스 `(starts_on, ends_on)`, `(ends_on)` | D254 |
| events (2026-11-01 (3)) | **추가** `start_time time(0) NULL`, `end_time time(0) NULL`(Prisma `startTime`·`endTime DateTime? @db.Time(0)`) — **별도 마이그레이션 `20261101120000_s6_event_times`**(아래). 기존 행 NULL = 종일. 인덱스 변경 없음 | D298–D301 |
| admin_audit_logs | **새 표** `id`, `actor_id?` FK users(SET NULL), `action text`, `target_type text`, `target_id uuid?`(FK 없음), `summary text`, `details jsonb DEFAULT '{}'`, `created_at`. 인덱스 `(created_at DESC)`, `(action, created_at DESC)`, `(target_type, target_id)` | D261 |
| notices, scrim_result_disputes, users(notify_patch), api_keys | **컬럼 변경 없음**(S0에 이미 있다). 주석만 | - |
| enum `dispute_status`, scrim_result_disputes | **유지, 사용 안 함**(D281). S0 마이그레이션으로 운영 DB에 있을 수 있어 DROP하지 않는다. `20261031230000_s6`에는 이 표·enum에 대한 변경이 **없다**(확인: `grep -i dispute` 0건). schema.prisma는 모델 주석만 바꿨다(SQL 영향 없음) | D281 |

- `scrim_results_one_active_per_scrim`(S3, `status IN ('pending','approved')`)은 그대로라 `reverted` 행은 활성 결과가 아니다 → 되돌린 뒤 새 결과를 제출할 수 있다.
- `scrim_result_disputes`: 앱 코드(서비스·컨트롤러·화면·목)는 읽거나 쓰지 않는다. 남아 있는 행(개발 DB의 시험 행 등)은 결과 제출 취소·내전 삭제 때 FK cascade로만 지워진다. 나중에 표를 지우려면 별도 마이그레이션 + 사용자 확인이 필요하다(D281).
- `rating_history`에 `outcome` 컬럼을 **추가하지 않는다**. 되돌리기 승패는 결과 행에서 다시 구한다(D245).
- 문서 5장 인덱스 3개·`activity_logs.idempotency_key` UNIQUE는 그대로.

기존 행: `scrim_results.reverted_*` NULL. 새 표는 비어 있다(시드 없음).

**`20261101120000_s6_event_times`(2026-11-01 (3), D301):** `prisma migrate diff --from-schema-datamodel <이번 변경 직전 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`의 stdout만 저장, 머리 주석 4줄을 뺀 비교에서 차이 없음(architect 확인). 내용 = `ALTER TABLE "events" ADD COLUMN "end_time" TIME(0), ADD COLUMN "start_time" TIME(0);` 한 문장. `DROP`·`NOT NULL`·`DEFAULT`·데이터 변경 없음(대소문자 무시 `drop` 0건). 같은 확인에서 `20261031230000_s6`도 HEAD 775507c → 이번 변경 직전 schema diff와 여전히 일치(파일 손대지 않음). `prisma format`·`validate`·`generate` 통과. DB 적용 미실행(Docker 없음). 적용 순서: s6 → s6_event_times(타임스탬프 순).

---

## 4. 엔드포인트 (S6)

모두 `/api/v1`. 이름은 shared export, 경로는 `ApiPath`. 직렬화는 반드시 shared parse(D38). 목록은 `{ items, next_cursor }`, `cursor`·`limit`(기본 20, 최대 100) — 「페이징 없음」이라고 적은 것은 `next_cursor` 항상 null.

### 4-1. 멤버 (JWT, 로그인 회원 전원)

| 메서드 | 경로 (`ApiPath`) | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- |
| GET | /notices (`notices`) | `ListNoticesQuery` | 200 `ListNoticesResponse` | VALIDATION_FAILED |
| GET | /patch-notes (`patchNotes`) | `ListPatchNotesQuery {game?}` | 200 `ListPatchNotesResponse` | VALIDATION_FAILED |
| GET | /events (`events`) | `ListEventsQuery {from?, to?, game?}` | 200 `ListEventsResponse` | VALIDATION_FAILED |
| GET | /calendar (`calendar`) — S6 후속(23절) | `GetCalendarQuery {month?, game?}` | 200 `GetCalendarResponse` | VALIDATION_FAILED |
| GET | /me/notification-settings (`myNotificationSettings`) | - | 200 `GetMyNotificationSettingsResponse` | - |
| PATCH | /me/notification-settings | `UpdateMyNotificationSettingsRequest` | 200 `UpdateMyNotificationSettingsResponse` | VALIDATION_FAILED |
| GET | /dashboard/summary (기존) | 그대로 | `news` 필수 블록 추가(8-3) | 그대로 |
| GET | /scrims/:id 등 ScrimDetail 응답 전부(기존) | 그대로 | 결과·viewer 필드 추가(6-4) | 그대로 |

### 4-2. 운영진 (JWT + `@Roles('admin')`, 비운영진 403)

| 메서드 | 경로 (`ApiPath`) | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- |
| POST | /scrims/:id/result/revert (`scrimResultRevert`) | `RevertScrimResultRequest {result_id, reason}` | 200 `RevertScrimResultResponse`(ScrimDetail) | FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, SCRIM_RESULT_NOT_APPROVED, SCRIM_RESULT_SELF_REVIEW, SCRIM_RESULT_REVERT_NOT_ALLOWED |
| GET | /admin/overview (`adminOverview`) | - | 200 `GetAdminOverviewResponse`(2026-11-01 (3): `upcoming` 블록 추가, 23-8-4) | FORBIDDEN |
| GET | /admin/results (`adminResults`) | `ListAdminResultsQuery {view}` | 200 `ListAdminResultsResponse` | FORBIDDEN, VALIDATION_FAILED |
| GET | /admin/no-show/scrims (`adminNoShowScrims`) | `ListAdminNoShowScrimsQuery` | 200 `ListAdminNoShowScrimsResponse` | FORBIDDEN, VALIDATION_FAILED |
| GET | /admin/members (`adminMembers`) | `ListAdminMembersQuery {q?, role?, sort}` | 200 `ListAdminMembersResponse` | FORBIDDEN, VALIDATION_FAILED |
| PATCH | /admin/members/:id/role (`adminMemberRole`) | `ChangeMemberRoleRequest {role}` | 200 `ChangeMemberRoleResponse` | FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, ADMIN_SELF_ROLE_CHANGE, ADMIN_ROLE_LOCKED, ADMIN_LAST_ADMIN |
| POST | /admin/notices (`adminNotices`) | `CreateNoticeRequest` | 201 `CreateNoticeResponse` | FORBIDDEN, VALIDATION_FAILED |
| PATCH | /admin/notices/:id (`adminNotice`) | `UpdateNoticeRequest` | 200 `UpdateNoticeResponse` | FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, DISCORD_ALREADY_NOTIFIED |
| DELETE | /admin/notices/:id | - | 204 | FORBIDDEN, NOT_FOUND |
| POST | /admin/patch-notes (`adminPatchNotes`) | `CreatePatchNoteRequest` | 201 `CreatePatchNoteResponse` | FORBIDDEN, VALIDATION_FAILED |
| PATCH | /admin/patch-notes/:id (`adminPatchNote`) | `UpdatePatchNoteRequest` | 200 `UpdatePatchNoteResponse` | FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, DISCORD_ALREADY_NOTIFIED |
| DELETE | /admin/patch-notes/:id | - | 204 | FORBIDDEN, NOT_FOUND |
| POST | /admin/events (`adminEvents`) | `CreateEventRequest` | 201 `CreateEventResponse` | FORBIDDEN, VALIDATION_FAILED |
| PATCH | /admin/events/:id (`adminEvent`) | `UpdateEventRequest` | 200 `UpdateEventResponse` | FORBIDDEN, NOT_FOUND, VALIDATION_FAILED |
| DELETE | /admin/events/:id | - | 204 | FORBIDDEN, NOT_FOUND |
| GET | /admin/api-keys (`adminApiKeys`) | - | 200 `ListAdminApiKeysResponse` | FORBIDDEN |
| POST | /admin/api-keys | `CreateApiKeyRequest {name, scopes}` | 201 `CreateApiKeyResponse` | FORBIDDEN, VALIDATION_FAILED |
| POST | /admin/api-keys/:id/revoke (`adminApiKeyRevoke`) | - | 200 `RevokeApiKeyResponse` | FORBIDDEN, NOT_FOUND |
| GET | /admin/seasons (`adminSeasons`) | - | 200 `ListAdminSeasonsResponse` | FORBIDDEN |
| POST | /admin/seasons | `CreateSeasonRequest` | 201 `CreateSeasonResponse` | FORBIDDEN, VALIDATION_FAILED, SEASON_OVERLAP |
| PATCH | /admin/seasons/:id (`adminSeason`) | `UpdateSeasonRequest` | 200 `UpdateSeasonResponse` | FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, SEASON_NOT_EDITABLE, SEASON_OVERLAP |
| DELETE | /admin/seasons/:id | - | 204 | FORBIDDEN, NOT_FOUND, SEASON_NOT_EDITABLE |
| GET | /admin/audit-logs (`adminAuditLogs`) | `ListAdminAuditLogsQuery {action?}` | 200 `ListAdminAuditLogsResponse` | FORBIDDEN, VALIDATION_FAILED |

- 승인·반려는 **기존** `POST /scrims/:id/result/approve|reject`(S3)를 그대로 쓴다. 응답 ScrimDetail, 큐는 성공 후 다시 조회(D251).
- 노쇼 표시는 **기존** `PUT /scrims/:id/players/:userId/no-show`(S2)를 참가자별로 쓴다(D252).
- 관리자 화면의 공지·패치노트·이벤트 목록은 공개 GET(4-1)을 쓴다(운영진 전용 목록 없음).
- `/admin/*`의 경로 `:id`는 `AdminIdParams`(uuid) parse. 인증은 다른 웹 API와 같은 `Authorization: Bearer`(쿠키 아님)라 `OriginGuard`는 붙이지 않는다(S0: 쿠키를 쓰는 /auth 경로만).

### 4-3. 봇 (`X-API-Key`, S5 6-1 가드)

| 메서드 | 경로 (`ApiPath`) | scope | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- | --- |
| GET | /bot/notices/pending (`botPendingNotices`) | bot:notices | - | 200 `GetBotPendingNoticesResponse` | API_KEY_* |
| POST | /bot/notices/:id/delivered (`botNoticeDelivered`) | bot:notices | `PostBotDeliveredRequest`(빈 객체) | 200 `PostBotDeliveredResponse` | API_KEY_*, VALIDATION_FAILED, NOT_FOUND |
| GET | /bot/patch-notes/pending (`botPendingPatchNotes`) | bot:patch-notes | - | 200 `GetBotPendingPatchNotesResponse` | API_KEY_* |
| POST | /bot/patch-notes/:id/delivered (`botPatchNoteDelivered`) | bot:patch-notes | `PostBotDeliveredRequest` | 200 `PostBotDeliveredResponse` | API_KEY_*, VALIDATION_FAILED, NOT_FOUND |

엔드포인트 합계: 멤버 **6**(GET 3 + 캘린더 1 + 알림 설정 2) + 운영진 23 + 봇 4 = **33개**(2026-11-01 (2) 캘린더 `GET /calendar` 1개 추가 → `ApiPath` S6 키 **26개**. 이하 D281 기록: 32개였을 때 D281로 이의 제기 3개 삭제: 멤버 `POST /scrims/:id/result/disputes`, 운영진 `GET /admin/disputes`·`POST /admin/disputes/:id/resolve`). `ApiPath` S6 키 25개. 삭제된 경로는 404(Nest 기본 — 라우트 없음). 문서 6장의 `GET /patch-notes, /events`는 경로 그대로.

---

## 5. 권한 매트릭스

○ = 허용, ✕ = 403(FORBIDDEN 또는 표의 코드), - = 해당 없음. (S6 초안의 「참가자」 열은 이의 제기 전용이라 D281로 뺐다.) 봇은 JWT 엔드포인트를 쓸 수 없고(401) 웹 사용자는 봇 엔드포인트를 쓸 수 없다(API_KEY_INVALID).

| 기능 | 비로그인 | 멤버 | 운영진 | 봇(scope) |
| --- | --- | --- | --- | --- |
| 공지·패치노트·이벤트 읽기 | ✕ 401 | ○ | ○ | - |
| 캘린더 읽기 `GET /calendar`(내전 + 운영진 일정, 23절) | ✕ 401 | ○ | ○ | ✕ 401(JWT 전용) |
| 캘린더에서 일정 추가·수정·삭제(= 기존 `/admin/events…`) | ✕ 401 | ✕ 403 | ○(작성자 무관, 감사 로그) | - |
| 캘린더의 내전 항목 쓰기 | - | 없음(읽기 전용, 누르면 상세) | 없음(관리자 캘린더도 읽기 전용) | - |
| 「다가오는 일정」 카드(`GET /admin/overview`의 `upcoming`, 23-8-4) | ✕ 401 | ✕ 403(overview 전체가 운영진 전용) | ○ 읽기 전용(내전 행 = 상세 링크, 일정 편집은 아래 캘린더) | - |
| 내 알림 설정 | ✕ 401 | ○ | ○ | - |
| 결과 승인·반려(S3) | ✕ | ✕ | ○ 제출자 본인 제외 | - |
| 승인 되돌리기 | ✕ | ✕ | ○ 제출자 본인 제외(승인자 본인은 가능) | - |
| 노쇼 표시(S2) | ✕ | ✕ | ○ | - |
| 통계·큐·노쇼 후보·감사 로그 읽기 | ✕ | ✕ | ○ | - |
| 멤버 목록 | ✕ | ✕ | ○ | - |
| 역할 변경 | ✕ | ✕ | ○ 자기 자신·ENV 지정 강등·마지막 admin 강등 제외 | - |
| 공지·패치노트·이벤트 작성·수정·삭제 | ✕ | ✕ | ○(작성자 무관) | - |
| API 키 발급·폐기 | ✕ | ✕ | ○ | - |
| 시즌 생성·수정·삭제 | ✕ | ✕ | ○(11-1 단계 규칙) | - |
| 공지 대기·전송 기록 | - | - | - | bot:notices |
| 패치노트 대기·전송 기록 | - | - | - | bot:patch-notes |

「다가오는 일정」 항목은 캘린더와 같은 `CalendarItem`이라 공개 범위가 같다(운영진만 보므로 더 좁다, D308). 캘린더 공개 범위(D287): `GET /scrims`와 같다 — 로그인 회원이면 모든 내전을 볼 수 있고 비공개 내전 개념이 없다(스키마에 공개 여부 컬럼 없음, 2026-11-01 확인). 캘린더는 그중 취소를 빼고 목록 카드 필드의 부분집합만 준다(참가자 명단·방장 없음, `my_status`는 요청자 본인 것). 홈 캘린더는 운영진이 봐도 읽기 전용이다(편집 UI는 `/admin`에만, D294).

화면: 사이드바 STAFF·`/admin`은 `me.role === 'admin'`일 때만 렌더한다(숨김이 아니라 렌더하지 않음). 서버 검사가 기준이다(메인 기본값 5). 강등은 다음 요청부터 반영(D263) → 화면은 403을 받으면 `['me']`를 다시 읽고 `/admin`에서 FORBIDDEN 상태를 그린다.

---

## 6. 승인 되돌리기 (D242–D248)

### 6-1. 안전 범위 판단

| 영향 | 문제 | S6 처리 |
| --- | --- | --- |
| 이후 경기 순서 | 결과 X 뒤에 같은 참가자의 같은 게임 경기 Y가 반영됐으면 Y의 `elo_before`는 X 반영 값이다. X만 지우면 Y 이후 값이 틀린다. 다시 계산하면 Y의 변동·이후 모든 경기·다른 참가자까지 바뀐다(연쇄) | **참가자 전원에 대해 X가 그 게임의 마지막 이력일 때만** 허용(`later_games`) |
| K 판정(D106) | K는 「모든 시즌」 (user, game) 이력 수. X를 지우면 이후 경기의 K가 다른 값이었어야 한다 | 위 조건을 **모든 시즌**으로 본다(다음 시즌 경기도 막는다) |
| 시즌 경계 | 시즌 종료 처리(standings·뱃지)는 그 시즌 ratings로 확정된다 | 반영 시즌 `closed_at`이 있으면 불가(`season_closed`). 끝났지만 아직 닫히지 않은 시즌은 허용 — 종료 작업이 잠금으로 기다렸다가 되돌린 값을 읽는다(6-3) |
| 뱃지·standings | 닫힌 시즌만 있다 | 위 조건으로 손대지 않는다 |
| 랭킹 캐시 | 5분 캐시 | 승인과 같이 다음 갱신 주기에 반영(D248) |
| 홈·프로필·활동 랭킹 `scrim_count` | approved만 센다 | reverted는 자동으로 빠진다 |
| 오래된 실수 | 몇 주 뒤 되돌리면 그동안 화면·디스코드에 나간 값이 많다 | 승인 후 `SCRIM_RESULT_REVERT_WINDOW_DAYS`(7일) 안(`window_passed`) |
| 자기 검토 | 자기가 낸 결과를 남의 승인 뒤 되돌리는 것 | 제출자 본인 불가(`self_submitted`, 응답 코드 `SCRIM_RESULT_SELF_REVIEW`) |

결론: 목업의 「승인 직후 되돌리기」와 「분쟁으로 잘못 승인된 결과 바로잡기」를 다루는 가장 좁은 범위. 조건 밖은 되돌릴 수 없다는 것을 화면이 미리 보여 준다(`revert_blocked_reason`).

### 6-2. 막는 이유 (`ScrimResultRevertBlock`, 우선순위 = 나열 순서)

| 값 | 판정 | 판정 위치 |
| --- | --- | --- |
| self_submitted | `result.submitted_by === 요청자` | 큐·상세·시도 |
| window_passed | `now ≥ approved_at + 7일` | 큐·상세·시도 |
| season_closed | 이 결과의 `rating_history.season_id` 시즌에 `closed_at` 있음(이력 없으면 해당 없음) | 큐·상세·시도 |
| later_games | 이 결과 이력의 각 (user_id, game_id)에 대해, `scrim_result_id ≠ 이 결과`이고 `created_at ≥ 이 이력 created_at`인 rating_history가 있음(모든 시즌, 같은 시각도 막는다, D247) | 큐·상세·시도 |
| rating_mismatch | 승패를 다시 구할 수 없음, ratings 행 없음, `ratings.elo ≠ elo_after`, wins·losses가 음수가 됨, 이력 user 중복 | **시도 때만**(core planRatingRevert). 큐·상세 `revert_blocked_reason`에는 나오지 않는다 |

### 6-3. `POST /scrims/:id/result/revert` 흐름

`scrimWriteTx`, READ COMMITTED, 승인과 같은 timeout. 잠금 순서는 승인(S4 15절)과 같다 → 교착 없음.

1. `lockOrNotFound(tx, id)` — 내전 행 잠금(없으면 NOT_FOUND. 비운영진은 가드에서 이미 403).
2. `approved = scrimResult.findFirst({ scrimId, status: 'approved' })`. 없음 또는 `approved.id ≠ result_id` → `SCRIM_RESULT_NOT_APPROVED`.
3. `history = ratingHistory.findMany({ where: { scrimResultId: approved.id } })`.
4. 이력이 있으면: `lockUserRatings(tx, scrim.gameId, history.userIds)`(user_id 오름차순) → **now 확정** → `SELECT closed_at FROM seasons WHERE id = history[0].seasonId FOR SHARE`(새 도우미 `lockSeasonForRevert` — 닫힌 시즌이면 INTERNAL_ERROR가 아니라 `{ closed: true }`를 돌려준다. 이력의 season_id가 여럿이면 로그 + `rating_mismatch`). 이력이 없으면(rated=false·skipped) now = 내전 잠금 직후.
5. `later` = 6-2 later_games 쿼리(잠금 아래에서 읽는다 — 같은 사용자의 다른 승인은 4번 잠금을 기다린다).
6. `block = revertBlockReason({...})` → 있으면 `SCRIM_RESULT_SELF_REVIEW`(self_submitted) 또는 `SCRIM_RESULT_REVERT_NOT_ALLOWED`(나머지, message = 이유 문구).
7. 이력이 있으면: `outcomes = inferRevertOutcomes({ ratedUserIds, winnerTeam: approved.winnerTeam, teamByUser: scrim_players.team, placements: readPlacements(approved.placements) })` → null이면 rating_mismatch. `ratings = rating.findMany({ userId in, gameId, seasonId })` → `planRatingRevert({ history, ratings, outcomes })` → `ok: false`면 로그(userIds) + `SCRIM_RESULT_REVERT_NOT_ALLOWED`.
8. 쓰기: 각 `ratings` 행 `update({ elo, wins, losses })`(plan 값 그대로, increment 아님) → `ratingHistory.deleteMany({ scrimResultId })`(삭제 수 = history 수가 아니면 롤백) → `assertResultTransition('approved','reverted')` + `scrimResult.updateMany({ where: { id, status: 'approved' }, data: { status: 'reverted', revertedById, revertedAt: now, revertReason } })` 1행 → `assertScrimTransition('finished','playing')` + `scrim.update({ status: 'playing' })`(`startedAt`은 그대로) → 감사 `result.revert`(10-2). (S6 초안의 「open 이의 제기 자동 처리」 단계는 D281로 삭제 — `scrim_result_disputes`에 쓰지 않는다.)
9. 커밋 후 `views.detail(id, admin, now)`.

- ratings 행은 0경기가 돼도 지우지 않는다(elo = 시작값). ELO 랭킹은 5경기 미만을 숨기고, K 판정은 이력 수라 영향이 없다.
- `scrim_players`(팀·포지션·노쇼)는 건드리지 않는다. 방장은 같은 팀으로 결과를 다시 제출하거나 팀을 다시 저장할 수 있다(`can_edit_teams`는 활성 결과가 없으므로 다시 true).
- 되돌린 내전은 `playing`이라 자동 마감(S2 `decideOverdueScrim`, recruiting·full 대상)과 무관하다. 운영진은 되돌린 뒤 삭제(`DELETE /scrims/:id`)도 할 수 있다(승인 결과 없음).
- 반려(S3 `reject`)는 **S3 그대로**다(S6 초안의 「반려 시 open 이의 제기 자동 처리」는 D281로 삭제). 반려·되돌리기 어느 쪽도 `scrim_result_disputes`를 읽거나 쓰지 않는다.
- 결과 분쟁 처리 흐름(D281): 운영진이 승인 큐(12-7)에서 pending → 반려(사유, S3) 후 방장 재제출 / approved → 되돌리기(사유, 6-2 조건) 후 방장 재제출·재승인. 참가자가 따로 신고하는 경로는 없다(디스코드 등 커뮤니티 채널로 운영진에게 알린다).

### 6-4. ScrimDetail 필드 (D276)

| 필드 | 값 |
| --- | --- |
| `result.reverted_by`·`reverted_at`·`revert_reason` | status reverted일 때만 값 |
| `result.rating_status` | reverted는 rated 내전이면 `waiting`, rated=false면 `not_rated`. `rating_changes` [], `season` null |
| `viewer.can_revert_result` | 운영진 && 최근 결과 approved && `revert_blocked_reason` null |
| `viewer.revert_blocked_reason` | 운영진 && 최근 결과 approved일 때 6-2(rating_mismatch 제외). 그 외 null |
| `summary.result_status`(목록 카드) | `reverted` 가능 → 화면 「결과 되돌림」 |

architect가 `scrim-views.service.ts`에 넣은 임시값(viewer `can_revert_result`·`revert_blocked_reason`)은 backend가 교체한다. `reverted_by`·`reverted_at`·`revert_reason` 직렬화는 architect가 완료(사용자 id 수집 포함). `open_dispute_count`·`can_dispute_result`·`has_open_dispute`는 D281로 스키마에서 빠졌다 — 서버는 내보내지 않는다(남겨도 zod가 버리지만 쿼리 낭비라 지운다, 18-1).

---

## 7. 결과 이의 제기 — 제거됨(D281, 사용자 결정 2026-11-01)

S6 초안의 7-1(`POST /scrims/:id/result/disputes`), 7-2(`GET /admin/disputes`, `POST /admin/disputes/:id/resolve`, 반려·되돌리기의 자동 처리), 7-3(viewer `can_dispute_result`·`has_open_dispute`)은 **모두 삭제**한다. 결정 D249·D250은 폐기, Q3·Q4는 해소.

| 삭제된 것 | 위치 |
| --- | --- |
| 엔드포인트 3개, `ApiPath` `scrimResultDisputes`·`adminDisputes`·`adminDisputeResolve` | shared `paths.ts` |
| `CreateScrimDisputeRequest(Input)`·`CreateScrimDisputeResponse`·`DisputeReason`·`DisputeResolution`, 상수 `SCRIM_DISPUTE_WINDOW_DAYS`·`SCRIM_DISPUTE_REASON_*`·`DISPUTE_RESOLUTION_*`·`DISPUTE_AUTO_RESOLUTION` | shared `scrim-results.ts` |
| `AdminDisputeStatusFilter`·`ListAdminDisputesQuery`·`AdminDisputeItem`·`ListAdminDisputesResponse`·`ResolveDisputeRequest(Input)`·`ResolveDisputeResponse`, `AdminResultItem.open_dispute_count`, `AdminResultView` 값 `disputed`, `AdminOverview.open_disputes` | shared `admin.ts` |
| `ScrimResultView.open_dispute_count`, `ScrimViewer.can_dispute_result`·`has_open_dispute` | shared `scrims.ts` |
| 오류 코드 3개 | shared `common/errors.ts` |
| `AdminAuditAction` `dispute.resolve`, `AdminAuditTargetType` `dispute`, `ADMIN_AUDIT_TARGET_BY_ACTION` 항목 | shared `constants/enums.ts` |
| `DISPUTE_STATUS_TRANSITIONS`(S0부터 있던 맵) | shared `constants/transitions.ts` |
| `disputeBlock`, `DisputeBlock` | core `result-review.ts`, `index.ts` |

남는 것: shared `DisputeStatus` enum(DB enum 값 기록용, 앱 코드 사용 금지), Prisma `ScrimResultDispute` 모델·`DisputeStatus` enum·`User.disputes`·`resolvedDisputes`·`ScrimResult.disputes` 관계(DB 표가 남아 있어 스키마와 DB를 맞춘다). 앱 코드에서 `prisma.scrimResultDispute`를 부르지 않는다(QA: `grep -rn scrimResultDispute apps/api/src` 0건).

---

## 8. 공지·패치노트·이벤트·홈 (D253–D258)

### 8-1. 쓰기 공통

- 모든 운영진 쓰기는 한 트랜잭션: 행 쓰기 + 감사 1행(10-2). 삭제는 `delete` 후 감사(details에 삭제 전 값).
- 공지 `author_id`는 작성자로 고정(수정자는 감사 로그로만). 패치노트·이벤트 `created_by` = 작성 운영진.
- `notify_discord` 변경: `discord_notified_at`이 있고 요청값이 지금 값과 다르면 `DISCORD_ALREADY_NOTIFIED`. 같으면 통과. 전송 뒤 제목·본문을 고쳐도 다시 보내지 않는다(D257).
- 패치노트·이벤트의 `game`은 `games.code`로 찾는다. 행이 없으면 VALIDATION_FAILED(path `game`).
- 이벤트 PATCH는 저장된 `starts_on`·`ends_on`과 요청값을 합쳐 `ends_on ≥ starts_on`·기간 ≤ `EVENT_SPAN_MAX_DAYS`를 검사(path `ends_on`).
- 날짜 컬럼은 `@db.Date`. 쓸 때 `new Date('YYYY-MM-DDT00:00:00.000Z')`, 읽을 때 `toISOString().slice(0, 10)` — 시간대 변환을 하지 않는다(KST 날짜를 날짜 그대로 저장, D254).
- **이벤트 시각(2026-11-01 (3), D299):** `start_time`·`end_time`은 `@db.Time(0)`. 쓸 때 `new Date('1970-01-01THH:mm:00.000Z')`, 읽을 때 `toISOString().slice(11, 16)` — 날짜와 같이 KST 벽시계 값을 그대로 저장한다. 도우미 `toDbTime`·`fromDbTime`(`apps/api/src/common/db-date.ts`, backend).
- **이벤트 PATCH 병합 검사(D300):** 저장값과 요청값을 합친 `{ starts_on, ends_on, start_time, end_time }`(생략 = 저장값, null = 비움)을 shared `eventScheduleIssues`로 검사해 문제를 VALIDATION_FAILED details(path `ends_on` 또는 `end_time`)로 낸다. 기존 기간 검사(news.service.ts:519-531)를 이 함수 호출로 바꾼다(기간 메시지 동일).

### 8-2. 읽기

| 엔드포인트 | 조건·정렬 |
| --- | --- |
| GET /notices | 전체, created_at DESC, id DESC |
| GET /patch-notes | `game` 있으면 그 게임, published_on DESC, created_at DESC, id DESC |
| GET /events | `starts_on ≤ to && ends_on ≥ from`, `game` 있으면 그 게임(game null 행 제외). ~~starts_on ASC, ends_on ASC, id ASC~~ → **starts_on ASC, start_time ASC NULLS FIRST, ends_on ASC, id ASC**(D302, 커서 23-8-3). from·to 기본값 = core `resolveEventsRange(query, now)`(오늘 KST가 속한 달). 응답 `from`·`to` = 적용 구간 |

커서는 정렬 키 + id를 담은 불투명 문자열(기존 `scrim-cursor.ts`와 같은 방식).

### 8-3. 홈 `news` 블록 (`DashboardNews`, 필수)

| 칸 | 규칙 |
| --- | --- |
| notice | 최신 공지 1개(`id`, `title`, `created_at`), 없으면 null |
| items 앞부분 | 패치노트 `published_on ≥ today − 30` 최대 2개(published_on DESC, created_at DESC, id DESC), `kind: 'patch_note'`, date = published_on |
| items 뒷부분 | 이벤트 `ends_on ≥ today && starts_on ≤ today + 30` 최대 2개(~~starts_on ASC, ends_on ASC, id ASC~~ → D302 정렬), `kind: 'event'`, date = starts_on, **`start_time`·`end_time`(2026-11-01 (3), EventView와 같은 값, D303)**. 선택은 날짜 기준 그대로(오늘 이미 끝난 시각 일정도 오늘은 남는다) |
| subtitle | core `newsSubtitle(text, 60)` — 첫 줄, 60자 넘으면 59자 + 「…」, 비면 null |

`today` = core `kstDateKey(now)`. 요청마다 쿼리 3개(캐시 없음). 실패하면 요약 전체 500(stats와 같음, 부분 실패는 top_rankers만 — D196 유지). architect 임시값 `news: { notice: null, items: [] }`(dashboard.service.ts, 웹 목)은 backend·frontend가 교체한다.

### 8-4. 봇 전송 (D255, D256)

| 엔드포인트 | 규칙 |
| --- | --- |
| GET /bot/notices/pending | `notify_discord && discord_notified_at IS NULL && created_at ≥ now − 72h`, created_at ASC, id ASC, 최대 20. `author` = BotUserRef, `web_url` = `{WEB_ORIGIN}/news` |
| GET /bot/patch-notes/pending | 조건 같음. `notify_discord_ids` = `isLinkedDiscordId(discord_id) && notify_patch && left_at IS NULL`인 회원 전원(요청마다 1쿼리, 행마다 같은 배열) |
| POST …/:id/delivered | `updateMany({ where: { id, discordNotifiedAt: null }, data: { discordNotifiedAt: now } })` 1행 → delivered, 0행이면 다시 읽어 있으면 already_delivered(저장값 반환), 없으면 NOT_FOUND. notify_discord 값과 무관 |

봇 응답은 공지·패치노트만 다루고 events를 싣는 봇 엔드포인트는 없다 → 일정 시각 추가(D298)로 봇 계약은 바뀌지 않는다(D304, `bot.ts`에 EventView·events 참조 0건 확인).

72시간보다 오래된 미전송 행은 대기에 나오지 않는다(봇이 오래 꺼졌다 켜져도 몰아서 보내지 않음). 관리자 화면은 `notify_discord && discord_notified_at null`을 「전송 대기」, 72시간이 지났으면 「전송 안 됨」으로 표시한다.

### 8-5. 봇 호출 예시

```
# 1분마다
GET /api/v1/bot/notices/pending            (X-API-Key: gcd_…, scope bot:notices)
→ 200 {"items":[{"id":"…","title":"11월 내전 일정","body":"…","author":{…,"discord_id":"1234…"},"created_at":"…","web_url":"https://…/news"}],"next_cursor":null,"generated_at":"…"}
# 공지 채널에 올린 뒤
POST /api/v1/bot/notices/{id}/delivered  {}
→ 200 {"id":"…","status":"delivered","discord_notified_at":"…"}   # 재시도해도 already_delivered

GET /api/v1/bot/patch-notes/pending        (scope bot:patch-notes)
→ items[].notify_discord_ids 각각에 DM → POST /api/v1/bot/patch-notes/{id}/delivered {}
# 재전송 정책: 5xx·네트워크 실패면 delivered를 다시 보낸다(멱등). DM 일부 실패는 봇이 기록하고 delivered는 보낸다
```

---

## 9. 알림 설정 (D259, D260)

- `GET /me/notification-settings` → `{ scrim_start: users.notify_scrim_start, patch: users.notify_patch, discord_linked: isLinkedDiscordId(discord_id) }`.
- `PATCH` → 보낸 항목만 update → 같은 모양. `notify_result`·`notify_waitlist`는 API에 없다(값은 DB에 그대로).
- `GET /me`(Me) 모양은 바꾸지 않는다.
- S5 봇 upcoming의 `notify_discord_ids`(notify_scrim_start)는 그대로 이 값을 쓴다.

---

## 10. 감사 로그 (D261, D262)

### 10-1. 쓰기 규칙

- 도우미 `apps/api/src/common/audit.ts`: `writeAudit(tx, { actorId, action, targetId, summary, details })`. `target_type = ADMIN_AUDIT_TARGET_BY_ACTION[action]`. **행위와 같은 트랜잭션**(롤백되면 감사도 없다). 실패하면 행위 전체 롤백.
- summary는 서버가 만든 한국어 한 줄(예 「새벽감자 역할을 운영진으로 변경」, 「공지 '11월 내전 일정' 삭제」). 사용자 입력은 따옴표 안에 40자까지.
- 수정·삭제 API 없음. 보존 기간 없음(Q).
- 「변경 없음」(같은 역할, 같은 값 PATCH, 이미 폐기된 키 폐기)은 감사 행을 쓰지 않는다.

### 10-2. 행위별 details

| action | target_id | details |
| --- | --- | --- |
| member.role_change | 대상 user id | `{ from, to }` |
| notice.create / patch_note.create / event.create | 새 행 id | 저장 값(snake_case). event는 2026-11-01 (3)부터 `start_time`·`end_time`(`HH:mm` 또는 null) 포함(D304) |
| notice.update / patch_note.update / event.update | 행 id | `{ before: {바뀐 필드}, after: {바뀐 필드} }`. event 비교 대상에 `start_time`·`end_time` 추가(같은 값이면 변경 없음 → 감사 없음) |
| notice.delete / patch_note.delete / event.delete | 지운 행 id | 삭제 전 전체 값(event는 `start_time`·`end_time` 포함) |
| api_key.create | 키 id | `{ name, key_prefix, scopes }`(원문·해시 없음) |
| api_key.revoke | 키 id | `{ name, key_prefix }` |
| season.create | 시즌 id | `{ name, starts_at, ends_at }` |
| season.update | 시즌 id | `{ before, after }`(바뀐 필드) |
| season.delete | 시즌 id | 삭제 전 값 |
| result.revert | 결과 id | `{ scrim_id, reason, season_id, history: [{ user_id, elo_before, elo_after, k_factor, outcome }] }`(지운 rating_history 스냅샷) |

S6 초안의 `dispute.resolve` 행위는 D281로 삭제했다(S6 미배포라 운영 DB에 그 감사 행은 없다. 로컬 개발 DB에 남아 있으면 `GET /admin/audit-logs` parse가 실패하므로 `DELETE FROM admin_audit_logs WHERE action = 'dispute.resolve'`로 지운다 — 코드로 우회하지 않는다). 승인·반려·노쇼 표시는 기존 `*_by`·`*_at` 컬럼으로 충분해 감사에 넣지 않는다.

---

## 11. 시즌 관리 (D268–D271)

### 11-1. 단계별 허용 (`seasonPhase(season, now)`)

| 단계 | 조건 | name | starts_at | ends_at | 삭제 |
| --- | --- | --- | --- | --- | --- |
| upcoming | `starts_at > now` | ○ | ○ | ○ | ○ |
| current | `starts_at ≤ now < ends_at` | ○ | ✕ SEASON_NOT_EDITABLE | ○ 새 끝 ≥ now + 1시간 | ✕ |
| ended | `ends_at ≤ now`, `closed_at` null(종료 작업 대기) | ○ | ✕ | ✕ | ✕ |
| closed | `closed_at` 있음 | ○ | ✕ | ✕ | ✕ |

이유: 시작한 시즌의 `starts_at`을 바꾸면 이미 반영된 rating_history의 시즌 귀속(승인 시각 기준, D116)이 바뀐다. 끝난 시즌은 종료 작업(standings·뱃지)이 그 기간으로 돌았거나 돌 예정이다. 진행 중 시즌의 끝을 앞당기거나 늘리는 것만 허용하고, 1시간 여유로 진행 중 승인(상한 15초)·종료 유예(60초)와 겹치지 않게 한다. 이름은 표시용이라 언제든 바꾼다(지난 시즌 뱃지 화면 이름도 바뀐다).

### 11-2. 값 규칙 (`validateSeasonWrite`)

- 생성, 또는 upcoming 시즌의 `starts_at`을 바꿀 때만: `starts_at ≥ now + SEASON_EDIT_MIN_LEAD_SEC`(path starts_at). 기간이 바뀌지 않는 수정(이름만 변경)에는 적용하지 않는다(core `validateSeasonWrite` 구현·shared 주석과 같다, QA s6_core 확인).
- 모든 기간 변경: `ends_at > starts_at`, 길이 `SEASON_LENGTH_MIN_DAYS`(7)–`MAX_DAYS`(366)일(path ends_at), current의 새 끝은 `≥ now + lead`(path ends_at).
- 겹침: 자기 자신을 뺀 모든 시즌과 [a.start, a.end) ∩ [b.start, b.end) ≠ ∅ → `SEASON_OVERLAP`. 기존 데이터에 이미 겹침이 있어도 이번에 쓰는 행 기준으로만 본다.
- 판정 순서: not_editable → invalid → overlap. 서버는 첫 종류만 응답한다(invalid는 details에 전부).

### 11-3. 잠금

`scrimWriteTx` 아님, 별도 `$transaction` READ COMMITTED:

1. `lockSeasonAutoCreate(tx)`(S3 `season-auto-create` advisory) — 승인의 자동 시즌 생성과 직렬화.
2. 수정·삭제: `SELECT … FROM seasons WHERE id = $1 FOR NO KEY UPDATE`(없으면 NOT_FOUND). 진행 중 승인(`FOR SHARE`)이 끝날 때까지 기다리고, 종료 작업(`FOR NO KEY UPDATE`)과도 직렬화된다.
3. 잠금 뒤 `now` 확정 → `season.findMany()` → core 판정 → 쓰기 + 감사.

교착: 승인 = 내전 → (season-auto-create) → 사용자 → 시즌 FOR SHARE. 시즌 쓰기 = season-auto-create → 시즌 FOR NO KEY UPDATE. 승인이 season-auto-create를 잡은 경우 그 뒤 시즌 FOR SHARE를 원하고, 시즌 쓰기는 season-auto-create를 먼저 기다리므로 순환이 없다. 종료 작업은 season-close → 시즌 행만.

자동 시즌(D116)과의 관계: `planAutoSeason`은 다음 시즌 시작에서 끝을 자른다. 운영진이 미래 시즌을 만들어 두면 공백 기간의 자동 시즌은 그 시작 전에 끝난다. 수동 시즌이 이어지면 자동 생성은 일어나지 않는다.

### 11-4. 응답

`AdminSeasonItem.editable`은 11-1 표 그대로(서버 now 기준). `rated_games` = 그 시즌 rating_history의 distinct scrim_id 수.

---

## 12. 멤버·역할·API 키·통계·노쇼 후보 (D263–D267, D272, D277)

### 12-1. 멤버 목록

- 기준 집합: users 전체(탈퇴 포함). `q`: `nickname ILIKE %q%` 또는 `discord_username ILIKE %q%`(LIKE 특수문자 이스케이프). `role` 필터.
- `scrim_count`: S5 D239와 같은 정의(그 회원 joined, 결과 approved, 취소 아닌 내전), 기간 없음. 원시 SQL 집계 1회.
- `no_show_30d`·`restricted_until`: 페이지 회원의 `no_show_marked_at > noShowLookbackStart(now)` 행을 한 번에 읽고 회원별 `computeScrimRestriction`.
- `status`: core `adminMemberStatus({ leftAt, restrictedUntil, now })` → left > restricted > active.
- `role_locked`: `config.adminDiscordIds.has(discord_id)`.
- 정렬·커서: `sort`별 ORDER BY(+ id ASC). `scrims_desc`·`no_show_desc`가 계산 열이라 **cursor = base64url(JSON `{ o: offset, s: sort }`)**, sort가 다르면 VALIDATION_FAILED(path cursor). (D266)

### 12-2. 역할 변경

`$transaction`: 1) `advisoryXactLock(tx, 'admin-roles')` 2) 요청자 행 다시 읽기 — role이 admin이 아니면 FORBIDDEN 3) 대상 행(없으면 NOT_FOUND) 4) `adminCount = user.count({ role: 'admin' })` 5) `planRoleChange({ actorId, targetId, currentRole, nextRole, targetLocked, adminCount })` 6) change면 update + 감사, noop이면 그대로 7) AdminMemberItem.

- 강등된 회원의 리프레시 토큰은 폐기하지 않는다(로그인은 유지, role만 바뀐다). JwtGuard가 DB role을 읽으므로 다음 요청부터 운영진 API가 403(D263).
- 승격된 회원은 다음 `GET /me`부터 admin(웹은 역할 변경 성공 후 대상이 나일 수 없으므로 별도 처리 없음).

### 12-3. JwtGuard 변경 (D263)

`prisma.user.findUnique({ where: { id: sub }, select: { id: true, role: true } })` → `req.authUser = { id, role: user.role }`. 토큰 claim의 role은 쓰지 않는다(발급은 그대로 넣는다 — 옛 클라이언트 호환). 쿼리 수 변화 없음.

### 12-4. API 키 (D272)

- 발급: `generateApiKey()`(S5 `common/api-key.ts`) → insert(`createdById = 운영진`) + 감사 → `{ api_key, key }`. 원문은 이 응답에만. 로그에 원문 금지.
- 목록: 전체(폐기 포함), 폐기 안 된 것 먼저 → created_at DESC → id DESC. DB scopes 중 `ApiKeyScope`에 없는 값은 빼고 로그(S5 `bot:link` 잔재 대비).
- 폐기: `updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } })` 1행이면 감사, 0행이면 다시 읽어(없으면 NOT_FOUND) 그대로 200. 행 삭제는 없다(activity_logs.api_key_id 감사 유지, S5 D223).
- CLI(`pnpm --filter api api-key`)는 그대로 쓴다(감사 로그 없음 — 서버 셸 접근자는 운영 책임자).

### 12-5. 통계 `GET /admin/overview`

`AdminOverview` 주석 그대로(`open_disputes` 블록은 D281로 삭제 — `scrim_result_disputes`를 세지 않는다). `restricted_members`: `no_show_marked_at > noShowLookbackStart(now)` 행을 회원별로 묶어 `computeScrimRestriction` → restricted 수, until 최솟값. `week_start`·`month_start` = core `kstWeekWindow`·`kstMonthWindow`. 지난달 = `kstMonthWindow(month_start − 1ms)`. 캐시 없음(운영진만 보는 화면). **`upcoming`(2026-11-01 (3)) = 23-8-4.** 내전 항목 `my_status`에 요청한 운영진이 필요하다 → 컨트롤러가 `@CurrentUser()`를 넘긴다.

### 12-6. 노쇼 후보 `GET /admin/no-show/scrims`

- 내전: `status IN (playing, finished) && scheduled_at ≥ now − mark_window_days일`(= `isNoShowMarkWindowOpen`), scheduled_at DESC, id DESC, 커서.
- 참가자: joined·no_show, 상세 `players`와 같은 슬롯 순서. 회원별 노쇼 표시 시각(lookback 이후)으로 `computeScrimRestriction` → `no_show_count_30d = recentCount`, `restricted_until`. `restrict_if_marked` = status joined && core `previewNoShowRestriction(marks, now, policy).newlyRestricted`.
- `policy` = 서버 노쇼 정책(`NoShowPolicyView`). 화면 문구 「30일 안에 N회면 M일간 참가 제한」은 이 값으로(목업의 「7일」은 예시값, 문서 7-4·env 기본은 1일 — Q17).

### 12-7. 승인 큐 `GET /admin/results`

`AdminResultItem` 주석 그대로. 보기는 `pending`·`approved` 2종(`disputed`는 D281로 삭제). approved 행의 `revert_blocked_reason`은 6-2 판정(시도 때와 같은 core `revertBlockReason`, 잠금 없이 읽는다 — 표시용). 페이지당 쿼리: 결과·내전·사용자·이력·이후 이력 존재(각 1회, N+1 금지).

---

## 13. 화면 (frontend)

목업이 있는 것은 Admin뿐이다. 나머지는 「목업 없음」이고 기존 카드·표·필터 칩·빈 상태·오류 상태 컴포넌트와 `tokens.css` 색만 쓴다.

### `/admin` (목업 Admin)

- 머리: 「ADMIN 관리자」 + 설명 + 「랭킹 캐시 HH:mm 갱신」(`ranking_cache.last_computed_at`, failing_keys > 0이면 경고 점).
- 탭(쿼리 `?tab=`, 기본 `results`): **결과·노쇼**(통계 **4칸 = 3칸 + 「다가오는 일정」**(2026-11-01 (3), 23-8-5) + **관리자 캘린더(23-6, 전체 폭)** + APPROVAL QUEUE + NO-SHOW) · **멤버**(MEMBERS 표) · **공지·소식**(NOTICE 작성 + 공지 목록, 패치노트·이벤트 작성·목록 — 목업 없음) · **시즌**(목업 없음) · **API 키**(목업 없음) · **감사 로그**(목업 없음).
- 통계 **4칸**(2026-11-01 (3) D306 — D291의 3칸을 대체, 「참가 제한 중」은 계속 없음): 결과 승인 대기(count, 「가장 오래된 제출 · N시간 전」), **이번 주 내전**(`scrims_this_week`, 보조 문구 「월요일부터 · 취소 제외」 — 목업의 「결과 이의 제기」 칸을 D281로 교체), 이번 달 노쇼(this_month, 지난달 대비 문구). ~~참가 제한 중~~은 사용자 요청(2026-11-01)으로 화면에서 뺐다(응답 `restricted_members`는 그대로, 멤버 탭 STATUS 열이 같은 정보를 보인다). 네 번째 칸 = **「다가오는 일정」 목록 카드**(23-8-5). 배치: 23-8-5 표(모바일 2열, md 3열 + 목록 카드 다음 줄 전체 폭, xl 4열).
- 관리자 캘린더(23-6): 통계 바로 아래 전체 폭 카드 「CALENDAR 일정」(D309로 유지 — 4번째 칸 목록은 보기용, 이 캘린더가 편집용). 운영진이 날짜를 눌러 일정 추가, 일정 막대를 눌러 수정·삭제. 내전은 읽기 전용(상세 링크).
- APPROVAL QUEUE: 보기 칩 `대기 · 최근 승인`(view 2종, D281). 행: 게임 약칭, 제목, `when · 제출 {닉네임}`, 결과 문구(팀 「블루팀 승리」, 개인 「1위 {닉네임}」). 버튼: pending → 반려(사유 입력 대화상자, S3 RejectReason) · 「승인 · 레이팅 반영」(`can_review` false면 비활성 + 「내가 제출한 결과」). approved → 「되돌리기」(사유 입력 + 「참가자 레이팅이 승인 전으로 돌아가고 내전은 결과 재입력 상태가 돼요」 확인 대화상자). `can_revert` false면 비활성 + `revert_blocked_reason` 문구(아래). 행 제목은 `/scrims/{id}` 링크. 처리 후 큐·overview 다시 조회.
- 막는 이유 문구: self_submitted 「내가 제출한 결과는 다른 운영진이 되돌려야 해요」, window_passed 「승인 후 7일이 지나 되돌릴 수 없어요」(7 = shared 상수), season_closed 「시즌 종료 처리가 끝나 되돌릴 수 없어요」, later_games 「참가자의 다음 경기가 이미 반영돼 되돌릴 수 없어요」, rating_mismatch(시도 응답만) 「레이팅 기록이 맞지 않아요. 개발자에게 알려 주세요」.
- NO-SHOW: 내전 선택(select, `GET /admin/no-show/scrims`) → 참가자 체크(현재 no_show는 체크됨) → 「노쇼 N명 저장」 = 바뀐 참가자만 기존 노쇼 API를 차례로 호출, 첫 실패에서 멈추고 오류 + 다시 조회. 행: 번호, 닉네임, 「최근 30일 노쇼 N회」, 태그(`restrict_if_marked`면 「표시하면 참가 제한」, 제한 중이면 「제한 중 ~MM.DD」). 아래 안내 = policy 값 문구. 마감 지난 내전은 목록에 없다.
- NOTICE: 제목·내용·「디스코드에도 알림 (봇 연동 후)」 체크·게시. 목록 행: 제목, 작성자, 시각, 디스코드 상태(전송 대기 / 전송됨 HH:mm / 전송 안 됨(72시간 경과)), 수정·삭제(확인 대화상자).
- MEMBERS: 검색창(q, 300ms debounce), 역할 필터, 정렬 select. 열 MEMBER(아바타·닉네임·가입일) · ROLE(select member/admin, `role_locked`면 잠금 아이콘 + 「서버 설정(ADMIN_DISCORD_IDS)으로 지정된 운영진이에요」, 나 자신은 비활성) · LINKED(디스코드 username 또는 「미연동」) · SCRIMS · NO-SHOW 30D · STATUS(활동 중 / 참가 제한 ~MM.DD / 서버 나감). 「더 보기」로 next_cursor.
- 시즌: 표(이름, 기간, 단계 배지, 경기 수) + 「새 시즌」 폼(이름, 시작·끝 datetime-local KST → ISO +09:00). 수정 폼은 `editable`에 따라 입력칸 잠금. current 끝 변경 확인 대화상자 「시즌이 MM.DD HH:mm에 끝나고 종료 처리(최종 순위·뱃지)가 돌아요」. 삭제는 upcoming만.
- API 키: 목록(이름, prefix `gcd_AbCd…`, scope 칩, 마지막 사용, 상태) + 발급 폼(이름, scope 체크박스 8개, 기본 전부 체크) → 원문을 한 번 보여 주는 대화상자(복사 버튼, 「닫으면 다시 볼 수 없어요」). 폐기 확인 대화상자.
- 감사 로그: 최근 목록(시각, 운영진, summary), action 필터, 행 펼치면 details JSON.
- 비운영진: `FORBIDDEN` 상태(지금과 같음). 사이드바 링크는 admin만 렌더.

### `/news` (목업 없음, 문서 8장)

- 머리 「NEWS 정보」. 섹션 3개: 공지(최신 3개 + 펼치기·더 보기), 패치노트(게임 필터 칩: 전체·롤·롤체·스팀, 카드: 게임 태그·버전·제목·게시일·요약·「원문 보기 ↗」 외부 링크 `target=_blank rel=noopener noreferrer`), 이벤트 캘린더(월 이동 ‹ › + 「오늘」, 게임 필터, 월 격자 7열 KST, 여러 날 이벤트는 막대, 모바일은 목록형). 스팀 할인 영역은 그리지 않는다.
- 운영진에게만 각 섹션 「관리」 링크(`/admin?tab=news`).
- 이벤트 캘린더 섹션은 **그대로**(`GET /events`, 운영진 일정만 — Q24 사용자 확인으로 확정, D310). 2026-11-01 (3): 일정 시각 표시만 추가(막대 앞 `21:00`, 상세 `eventScheduleText`, 23-8-5). 커뮤니티 캘린더(내전 포함)는 홈·`/admin`에만 둔다(D296, Q24). 격자 도우미는 23-6대로 공용 모듈로 옮겨도 되지만 화면 동작은 바꾸지 않는다.
- 쿼리 `tab`(`notices`·`patch-notes`·`events`)은 그 섹션 하나만 보여 주고, 없으면 세 섹션 모두 보여 준다(구현 결정, QA s6_web 수용). `game`·`month=YYYY-MM`은 `routes.news(q)`가 쓴다.
- 빈 상태: 「등록된 공지가 없어요」 등. 오류: ErrorState + 다시 시도.

### `/` 홈 (목업 Main 「패치 · 이벤트」)

- 카드 「패치 · 이벤트」: `news.items` 순서대로 행(월·일 블록, 게임 태그 색 = 기존 게임 칩, 제목, subtitle). 2026-11-01 (3): 이벤트 행에 `start_time`이 있으면 태그 옆에 `21:00`(끝이 있으면 `21:00–23:00`). 카드는 Q23 사용자 확인으로 캘린더와 함께 유지(D310). 비면 「등록된 소식이 없어요」(운영진은 관리 링크). 카드 머리 「전체 보기」 → `/news`.
- `news.notice`가 있으면 홈 상단 얇은 공지 줄(제목 + 시각, 누르면 `/news`).
- **커뮤니티 캘린더(읽기 전용, 23-6, D293)**: 패널 그리드(모집 중 · 상위 랭커 · 최근 결과 · 패치 · 이벤트) 아래 전체 폭. `GET /calendar`를 따로 부른다(요약 응답에 넣지 않음). 운영진에게도 편집 UI 없음 — 머리 오른쪽에 운영진만 「관리 →」(`/admin`) 링크. 「패치 · 이벤트」 카드는 유지(앞으로 30일 짧은 목록 + 패치노트, 캘린더는 한 달 전체 — 역할이 달라 둘 다 둔다, Q23).

### `/settings` 알림 (목업 Settings NOTIFICATIONS)

- 두 토글만: 「참가한 내전 시작 30분 전 · 디스코드 연동 시 DM」(scrim_start), 「새 패치 요약 · 롤, 롤체 패치 노트 요약이 올라오면」(patch). `discord_linked` false면 「디스코드로 로그인한 회원만 DM을 받아요」 안내 + 토글은 동작. 즉시 저장(낙관적 갱신 + 실패 시 되돌림).
- `notify_result`·`notify_waitlist` 행은 그리지 않는다.

### `/scrims/[id]` 상세

- 결과 영역: `result.status === 'reverted'` → 「승인 되돌림 · {운영진} · 사유」 표시, 결과 입력 영역이 다시 열린다(`can_submit_result`).
- 운영진: `can_revert_result` → 「승인 되돌리기」(큐와 같은 대화상자). approved이고 `revert_blocked_reason`이 있으면 비활성 + 문구.
- 이의 제기 배지·버튼·「이의 제기 접수됨」은 그리지 않는다(D281).

### 사이드바·모바일

- 사이드바 MENU에 「정보」(`/news`, 홈·내전/모집·랭킹 다음). `routes.news(q)` 추가(`tab`·`game`·`month=YYYY-MM`).
- 모바일 하단 탭이 이미 꽉 차 있으면 「정보」는 홈 카드 「전체 보기」와 모바일 머리 메뉴로 연결한다(frontend가 현재 탭 수를 보고 정하고 보고서에 적는다).

### 훅·목

- `lib/api/admin.ts`, `lib/api/news.ts`, `lib/api/notification-settings.ts`, 결과 되돌리기는 `lib/api/scrims.ts`. 쿼리 키 `['admin', …]`, `['news', …]`, `['me', 'notification-settings']`.
- 목 백엔드: 새 엔드포인트 32개 중 웹이 부르는 28개(봇 4개 제외) 전부. 목 되돌리기는 6-2 규칙(core 함수 사용)과 같은 결과를 내야 한다. architect 임시값(`mock/scrims.ts` viewer 2개, `mock/ratings.ts` 결과 3개, `mock/rankings.ts` news)을 교체. 목의 이의 제기 상태·자동 처리는 D281로 삭제.
- 성공 후 무효화: 되돌리기·승인·반려 → `['scrims']`, `['admin']`, `['dashboard']`, `['rankings']`. 공지·패치·이벤트 쓰기 → `['news']`, `['dashboard']`, `['admin','audit']`. 역할 변경 → `['admin','members']`, `['admin','overview']`. **S6 후속(D295):** 캘린더 키 `['calendar', month, game|'all']` — 이벤트 쓰기와 모든 내전 상태 변경(작성·수정·참가·취소·시작·삭제·결과 승인·반려·되돌리기)에서 `['calendar']`도 무효화한다. **2026-11-01 (3):** 같은 자리에서 `['admin', 'overview']`도 무효화한다(「다가오는 일정」, D308).

---

## 14. core 함수 (`packages/core`, domain-logic)

`@gcd/shared` 상수·타입만 의존. I/O 없음, 시각은 인자.

### 14-1. `src/result-review.ts` (새 파일)

```ts
export type RatingOutcome = 'win' | 'loss';
export type RevertHistoryRow = { id: string; userId: string; eloBefore: number; eloAfter: number; createdAt: Date };
export type RevertRatingRow = { userId: string; elo: number; wins: number; losses: number };

/** 승인 때의 승패를 다시 구한다(D245). 팀: teamByUser.get(u) === winnerTeam이면 win(팀 null·없음 → null 반환).
 *  개인: placements 중 ratedUserIds만 placement ASC(같으면 입력 순서)로 1..M 재순위 → isPlacementWin(rank, M). ratedUserIds 중 placements에 없는 사람 → null.
 *  winnerTeam과 placements가 둘 다 null이거나 둘 다 값 → null. ratedUserIds 중복 → null */
export function inferRevertOutcomes(input: {
  ratedUserIds: readonly string[];
  winnerTeam: ScrimTeam | null;
  teamByUser: ReadonlyMap<string, ScrimTeam | null>;
  placements: readonly { userId: string; placement: number }[] | null;
}): Map<string, RatingOutcome> | null;

/** 6-2 우선순위(self_submitted → window_passed → season_closed → later_games). 없으면 null. rating_mismatch는 반환하지 않는다 */
export function revertBlockReason(input: {
  approvedAt: Date;
  now: Date;
  windowDays: number;            // SCRIM_RESULT_REVERT_WINDOW_DAYS
  submittedById: string;
  actorId: string;
  seasonClosed: boolean;         // 이력이 없으면 false
  laterGameUserIds: readonly string[];
}): Exclude<ScrimResultRevertBlock, 'rating_mismatch'> | null;

/** ratings 역반영 계획. 각 이력 user: ratings 행 있음 && elo === eloAfter && outcome 있음 → elo = eloBefore, win이면 wins − 1, loss면 losses − 1(음수면 실패).
 *  하나라도 실패 → { ok: false, reason: 'rating_mismatch', userIds(실패 user, 입력 순서) }. 이력 user 중복도 실패. 성공 updates는 history 입력 순서 */
export function planRatingRevert(input: {
  history: readonly RevertHistoryRow[];
  ratings: readonly RevertRatingRow[];
  outcomes: ReadonlyMap<string, RatingOutcome>;
}):
  | { ok: true; updates: { userId: string; elo: number; wins: number; losses: number }[] }
  | { ok: false; reason: 'rating_mismatch'; userIds: string[] };

// disputeBlock·DisputeBlock: D281로 삭제(결과 이의 제기 제거)
```

### 14-2. `src/season.ts` 추가

```ts
export type SeasonPhase = 'upcoming' | 'current' | 'ended' | 'closed';   // shared AdminSeasonPhase와 같은 값
export function seasonPhase(season: SeasonLike & { closedAt: Date | null }, now: Date): SeasonPhase;
/** 11-1 표 */
export function seasonEditable(phase: SeasonPhase): { name: boolean; startsAt: boolean; endsAt: boolean; delete: boolean };

export type SeasonWriteIssue =
  | { kind: 'not_editable'; field: 'starts_at' | 'ends_at' | 'delete' }
  | { kind: 'invalid'; path: 'starts_at' | 'ends_at'; message: string }
  | { kind: 'overlap'; seasonId: string };
/** 11-1·11-2. target null = 생성. next = 수정 후 값(안 바꾼 필드는 현재 값). changed = 요청에 있고 값이 다른 필드.
 *  반환 순서: not_editable 전부 → invalid 전부 → overlap(겹치는 시즌 startsAt ASC, id ASC). 문제 없으면 [] */
export function validateSeasonWrite(input: {
  seasons: readonly (SeasonLike & { closedAt: Date | null })[];
  target: (SeasonLike & { closedAt: Date | null }) | null;
  next: { startsAt: Date; endsAt: Date };
  changed: { startsAt: boolean; endsAt: boolean };
  now: Date;
  policy: { minLeadMs: number; minLengthMs: number; maxLengthMs: number };
}): SeasonWriteIssue[];
/** upcoming만 [] */
export function validateSeasonDelete(season: SeasonLike & { closedAt: Date | null }, now: Date): SeasonWriteIssue[];
```

### 14-3. `src/admin.ts` (새 파일)

```ts
/** 12-2. 순서: next === current → noop / actor === target → ADMIN_SELF_ROLE_CHANGE / 강등 && targetLocked → ADMIN_ROLE_LOCKED /
 *  강등 && adminCount ≤ 1 → ADMIN_LAST_ADMIN / 그 외 change. adminCount = 변경 전 admin 수(0 이상 정수, 아니면 RangeError) */
export function planRoleChange(input: {
  actorId: string; targetId: string; currentRole: UserRole; nextRole: UserRole; targetLocked: boolean; adminCount: number;
}): { kind: 'noop' } | { kind: 'change' } | { kind: 'error'; code: 'ADMIN_SELF_ROLE_CHANGE' | 'ADMIN_ROLE_LOCKED' | 'ADMIN_LAST_ADMIN' };

/** left(leftAt 있음) > restricted(restrictedUntil > now) > active */
export function adminMemberStatus(input: { leftAt: Date | null; restrictedUntil: Date | null; now: Date }): AdminMemberStatus;
```

### 14-4. `src/no-show.ts` 추가

```ts
/** 지금 노쇼 하나를 더 표시하면(now 시각): computeScrimRestriction([...marks, now], now, policy).
 *  newlyRestricted = 지금 제한 중이 아니고 표시 후 제한 중. until = 표시 후 해제 시각(제한 아니면 null) */
export function previewNoShowRestriction(marks: readonly Date[], now: Date, policy: NoShowPolicy):
  { newlyRestricted: boolean; until: Date | null };
```

### 14-5. `src/news.ts` (새 파일)

```ts
/** 첫 줄(앞뒤 공백 제거). 비면 null. max자 초과면 앞 (max − 1)자 + '…'. max < 2면 RangeError. 글자 수는 코드 포인트 기준 */
export function newsSubtitle(text: string | null, max: number): string | null;
/** 8-2 GET /events 기본 구간. 둘 다 없으면 kstDateKey(now)가 속한 달의 1일·말일. 하나만 있으면 그 날짜가 속한 달의 1일·말일로 나머지를 채운다.
 *  반환 { from, to } 'YYYY-MM-DD'. 검증(to ≥ from, 92일)은 shared가 이미 했다 */
export function resolveEventsRange(query: { from?: string; to?: string }, now: Date): { from: string; to: string };
/** 홈 news 구간: { patchSince: today − 30일, eventUntil: today + 30일, today } (YYYY-MM-DD, KST) */
export function dashboardNewsWindow(now: Date, patchRecentDays: number, eventAheadDays: number): { today: string; patchSince: string; eventUntil: string };
```

`index.ts` export 추가. 합계 **13개**(result-review 3, season 4, admin 2, no-show 1, news 3 — `disputeBlock`은 D281로 삭제). dist 재빌드.

### 14-7. `src/calendar.ts` (새 파일, S6 후속 캘린더 — 23절, D285)

```ts
/** month 'YYYY-MM'(shared CalendarMonth 형식)의 격자 구간. 월요일 시작 7열:
 *  first = 그 달 1일, last = 말일, from = first가 든 주의 월요일, to = last가 든 주의 일요일(35 또는 42일, 2월 평년 1일이 월요일이면 28일).
 *  fromAt = from의 KST 00:00(= `${from}T00:00:00+09:00`), toBefore = (to + 1일)의 KST 00:00. 내전 조회는 scheduled_at ∈ [fromAt, toBefore).
 *  형식이 틀리면(13월, 'YYYY-M' 등) RangeError */
export function calendarMonthRange(month: string): {
  first: string; last: string; from: string; to: string; fromAt: Date; toBefore: Date;
};
/** month가 있으면 그대로(형식 검사 — 틀리면 RangeError), 없으면 kstDateKey(now).slice(0, 7) */
export function resolveCalendarMonth(month: string | undefined, now: Date): string;
```

테스트 필수: 2026-11 → from 2026-10-26·to 2026-12-06(42일), 1일이 월요일인 달(2027-02: from = 2027-02-01, to = 2027-02-28, 28일), 말일이 일요일인 달, 연 넘김(2026-12 → to 2027-01-03), 윤년 2028-02, fromAt·toBefore가 KST 자정(UTC 전날 15:00), now 10-31T15:00Z → '2026-11'(KST 자정 경계), 형식 오류 RangeError. **웹 `lib/news.ts` `monthGrid(month)`의 from·to와 같은지 비교**(웹 테스트에서, 23-7 frontend). 합계 core 함수 **15개**.

**2026-11-01 (3) 추가(23-8, D302·D306–D308) — 같은 파일 `src/calendar.ts`:**

```ts
import type { CalendarEventItem, CalendarItem, CalendarScrimItem } from '@gcd/shared';

export type EventScheduleKey = { id: string; starts_on: string; ends_on: string; start_time?: string | null };
/** D302 일정 정렬(Array.sort 비교 함수): starts_on ASC → start_time ASC(null·undefined = 종일 먼저) → ends_on ASC → id ASC.
 *  서버 orderBy `[startsOn asc, startTime asc nulls first, endsOn asc, id asc]`와 같은 순서(id는 문자열 비교 — uuid 소문자라 PostgreSQL과 같다) */
export function compareEventSchedule(a: EventScheduleKey, b: EventScheduleKey): number;

/** 일정 시작 순간 = `${startsOn}T${startTime ?? '00:00'}:00+09:00`(KST). 형식이 틀리면 RangeError */
export function eventStartsAt(startsOn: string, startTime: string | null | undefined): Date;

/** 「다가오는 일정」 구간(D307). from = kstDateKey(now), to = from + days일, scrimBefore = (to + 1일)의 KST 00:00.
 *  내전은 scheduled_at ∈ [now, scrimBefore), 일정은 ends_on ≥ from && starts_on ≤ to. days가 0 이상 정수가 아니면 RangeError */
export function upcomingWindow(now: Date, days: number): { from: string; to: string; scrimBefore: Date };

/** 시작 순 병합(D308). 입력은 이미 정렬됨: events = compareEventSchedule 순, scrims = scheduled_at ASC·id ASC. 각 최대 max + 1개를 받는다.
 *  키: 일정 eventStartsAt(starts_on, start_time), 내전 scheduled_at. 같은 순간이면 일정 먼저, 같은 종류끼리는 입력 순서(안정).
 *  반환 items = 앞 max개, hasMore = events.length + scrims.length > max. max < 1이면 RangeError */
export function mergeUpcomingItems(
  events: readonly CalendarEventItem[],
  scrims: readonly CalendarScrimItem[],
  max: number,
): { items: CalendarItem[]; hasMore: boolean };
```

테스트 필수: compareEventSchedule — 같은 날 종일 < 08:00 < 21:00, 종일과 `start_time` undefined 같음, 앞 날짜가 시각과 무관하게 먼저, 같은 시작이면 ends_on·id. eventStartsAt — `('2026-11-08', '21:00')` = `2026-11-08T12:00:00.000Z`, null = 전날 15:00Z, 형식 오류 RangeError. upcomingWindow — now 2026-10-31T15:00Z(KST 11-01) → from 11-01·to 12-01·scrimBefore 2026-12-01T15:00Z, 월·연 넘김. mergeUpcomingItems — 진행 중 여러 날 일정(어제 시작)이 가장 먼저, 같은 순간 일정 먼저, 21:00 일정 vs 20:00 내전 → 내전 먼저, max 5에서 6개 → 5개 + hasMore, 정확히 5개 → false, 입력 순서 안정. 합계 core 함수 **19개**.

### 14-6. 테스트 필수

| 함수 | 필수 경우 |
| --- | --- |
| inferRevertOutcomes | 팀 블루 승 → 블루 win·오렌지 loss / team null인 참가자 → null / 개인 4명 중 3명만 rated(1위 노쇼 제외) → 재순위 1..3, M=3에서 1위 win, 2·3위 loss / 동순위 입력 순서 / placements에 없는 rated user → null / 둘 다 null → null / 롤체 8명 상위 4명 win. **S3 승인 결과(computeTeamEloUpdates·computePlacementEloUpdates의 outcome)와 같은지 비교하는 왕복 테스트**(팀 1, 개인 2) |
| revertBlockReason | 각 이유 단독, 둘 이상이면 우선순위, 기한 경계(approvedAt + 7일 − 1ms 허용, 정확히 7일 막음), 승인자 본인(= actor)이어도 제출자가 아니면 null, 이력 없음(seasonClosed false·later []) → 기한·본인만 |
| planRatingRevert | 정상 팀 2명·개인 3명, elo ≠ eloAfter 1명 → 실패 userIds, ratings 행 없음, wins 0인데 win → 실패, outcome 없음, 중복 user, 0경기로 돌아가도 성공(elo = eloBefore) |
| seasonPhase·seasonEditable | 경계: now = startsAt → current, now = endsAt → ended, closedAt 있으면 시간 무관 closed |
| validateSeasonWrite | 생성 정상 / lead 1시간 − 1ms 실패 / 길이 7일 정확 허용·6일 실패·366일 허용·367일 실패 / 반열림 겹침: 끝 = 다음 시작이면 겹치지 않음, 1ms 겹침 실패 / current starts_at 변경 → not_editable / current 끝 단축 now + 1h 허용·그보다 이르면 invalid / ended·closed 끝 변경 → not_editable / 자기 자신과는 겹침으로 보지 않음 / 반환 순서 |
| validateSeasonDelete | upcoming만 [] |
| planRoleChange | 표의 5분기, 자기 자신 noop(같은 역할)은 noop, 승격은 locked여도 change, adminCount 2에서 강등 change, 1에서 실패 |
| adminMemberStatus | left가 restricted보다 우선, restrictedUntil = now → active |
| previewNoShowRestriction | 2회 + 표시 = 3회 → newlyRestricted(threshold 3), 이미 제한 중이면 false, 30일 밖 기록은 세지 않음 |
| newsSubtitle | null·빈 문자열·공백만 → null, 여러 줄 → 첫 줄, 정확히 max자 그대로, max+1자 → max−1자 + '…', 이모지(서로게이트)를 자르지 않음 |
| resolveEventsRange | 둘 다 없음(KST 자정 경계: 10-31T15:00Z = 11-01 KST → 11월), 2월 윤년 말일, from만·to만 |
| dashboardNewsWindow | KST 날짜 경계, 월·연 넘김 |

---

## 15. 구현 경계 (backend 모듈)

| 파일 | 내용 |
| --- | --- |
| `src/common/audit.ts`(새) | `writeAudit` |
| `src/common/guards/jwt.guard.ts` | DB role(12-3) |
| `src/modules/ratings/rating-locks.ts` | `lockSeasonForRevert(tx, seasonId): Promise<{ closed: boolean }>` |
| `src/modules/scrims/scrim-results.service.ts` | `revert`(`reject`는 S3 그대로) |
| `src/modules/scrims/scrims.controller.ts` | `POST :id/result/revert`(`@Roles('admin')`) |
| `src/modules/scrims/scrim-views.service.ts` | 임시값 교체(6-4), 막는 이유 조회(상세 1회 쿼리씩) |
| `src/modules/news/*`(새) | 공개 GET 3개, 운영진 CRUD 9개, 날짜 변환 도우미, 커서 |
| `src/modules/admin/*`(새) | overview, results 큐, no-show 후보, members·role, api-keys, seasons, audit-logs. 컨트롤러 클래스에 `@UseGuards(JwtGuard, RolesGuard)` + `@Roles('admin')` |
| `src/modules/bot/bot-announcements.service.ts`(새) + `bot.controller.ts` | 봇 4개(`@BotScope(BOT_ENDPOINT_SCOPE.notices|patchNotes)`) |
| `src/modules/users/*` | `GET·PATCH /me/notification-settings` |
| `src/modules/dashboard/dashboard.service.ts` | `news` 블록(8-3) |
| `src/app.module.ts` | 새 모듈 등록 |
| `test/support/fake-prisma.ts` | patchNote, calendarEvent, adminAuditLog, notice 테이블(필요한 것), raw SQL 흉내 |

컨트롤러는 shared 스키마로 parse(`ZodValidationPipe`), 응답도 shared parse 후 반환(D38). 운영진 쓰기의 `now`는 `APP_CLOCK`.

---

## 16. 상태 전이

```
scrims.status (S6 추가: finished → playing)
  recruiting → full | playing | cancelled
  full → recruiting | playing | cancelled
  playing → finished                 (결과 승인)
  finished → playing                 (S6 승인 되돌리기만)
  cancelled: 종착

scrim_results.status (S6 추가: approved → reverted)
  pending → approved (운영진, 제출자 제외) | rejected (운영진, 제출자 제외)
  approved → reverted (운영진, 제출자 제외, 6-2 조건)
  rejected, reverted: 종착. 재입력은 새 pending 행. 제출 취소 = pending 행 삭제

scrim_result_disputes.status — 사용 안 함(D281). 전이 맵 없음(S0 DISPUTE_STATUS_TRANSITIONS 삭제)
  앱 코드는 행을 만들거나 바꾸지 않는다. 남은 행은 결과 제출 취소·내전 삭제 때 cascade로만 지워진다

seasons (파생 단계, 저장 컬럼 아님 — core seasonPhase)
  upcoming ─(now ≥ starts_at)→ current ─(now ≥ ends_at)→ ended ─(종료 작업 closed_at)→ closed
  운영진: upcoming 삭제·기간 변경, current 끝 변경(≥ now + 1h), 이름은 모든 단계

notices·patch_notes 디스코드 전송(파생)
  notify_discord false: 보내지 않음
  notify_discord true && discord_notified_at null && created_at ≥ now − 72h: 대기 → (봇 delivered) → 전송됨
  72h 지남: 전송 안 됨(대기에서 빠짐, 값은 null 그대로)
  전송됨 이후 notify_discord 변경 불가(DISCORD_ALREADY_NOTIFIED)

users.role (S6 추가 경로)
  member ⇄ admin : 운영진 웹 변경(자기 자신 불가, ENV 지정 강등 불가, 마지막 admin 강등 불가)
  member → admin : 로그인 시 ADMIN_DISCORD_IDS(S0 D5, 그대로)

api_keys.revoked_at: null → now(웹·CLI 폐기). 되돌리기 없음
```

---

## 17. 환경 변수

**신규 없음(D280).** `.env.example`에 주석 2줄(ADMIN_DISCORD_IDS 강등 불가 안내, 웹 키 발급·새 scope)을 추가했다.

| 변수 | 사용처 | S6에서의 뜻 |
| --- | --- | --- |
| ADMIN_DISCORD_IDS | api | 로그인 승격(그대로) + 멤버 표 `role_locked` + 강등 거부 |
| WEB_ORIGIN | api | 봇 응답 `web_url`(`/news`), `profile_url` |
| SCRIM_NO_SHOW_THRESHOLD / _WINDOW_DAYS / _RESTRICTION_DAYS / _MARK_WINDOW_DAYS | api | 노쇼 후보·멤버 표·통계의 제한 계산과 화면 정책 문구 |
| SEASON_AUTO_LENGTH_MONTHS | api | 자동 시즌(수동 시즌과 공존, 11-3) |
| SCRIM_ELO_* | api | 되돌리기는 정책을 쓰지 않는다(저장값 역반영). 표에만 적는다 |
| RANKING_JOBS_ENABLED | api | 되돌리기 후 랭킹 반영 주기 |
| DATABASE_URL | api, CLI | 그대로 |

설정값이 아닌 상수(shared): `SCRIM_RESULT_REVERT_WINDOW_DAYS`(7), 되돌리기 사유 길이(2–200, 이의 제기 상수는 D281로 삭제), `SEASON_EDIT_MIN_LEAD_SEC`(3600), `SEASON_LENGTH_MIN_DAYS`(7)·`MAX_DAYS`(366), `SEASON_NAME_MAX_LENGTH`(30), `BOT_ANNOUNCEMENT_PENDING_LIMIT`(20)·`_MAX_AGE_HOURS`(72), 공지·패치·이벤트 길이, `EVENT_SPAN_MAX_DAYS`(366), `EVENTS_RANGE_MAX_DAYS`(92), `DASHBOARD_NEWS_*`, `ADMIN_MEMBER_QUERY_MAX_LENGTH`(30), `API_KEY_NAME_MAX_LENGTH`(40). 운영 중 바꿀 근거가 생기면 env로 올린다(D226과 같은 원칙).

---

## 18. 담당 배정과 실행 순서

S6 실행 구현자: **logic**, **backend**, **frontend** (+ qa). **integration은 실행하지 않는다**(CLI는 `ApiKeyScope`를 parse하므로 새 scope가 코드 변경 없이 들어간다. 외부 API 없음) — 리더가 원하면 CLI `--help` 문구에 새 scope만 추가.

```
architect(완료)
  ├─ logic(14절) ─────────────────────────────┐
  ├─ backend(14절 시그니처로 시작, 15절) ──────┼─ 전체 테스트 → qa
  └─ frontend(목 백엔드로 시작, 13절) ─────────┘
```

셋 다 바로 시작한다. backend는 core가 나오기 전 14절 시그니처로 import하고, 되돌리기·시즌·역할 테스트는 core 완료 뒤 돌린다. frontend 목의 되돌리기·시즌 판정은 core 함수를 그대로 쓴다(웹은 core 의존이 이미 있다 — 없으면 같은 규칙을 목에 쓰고 보고서에 적는다).

### logic (domain-logic-dev) — `packages/core/src/**`

1. 14-1 `result-review.ts` 4개, 14-2 `season.ts` 4개, 14-3 `admin.ts` 2개, 14-4 `previewNoShowRestriction`, 14-5 `news.ts` 3개. `index.ts` export.
2. 14-6 테스트 필수 전부(특히 inferRevertOutcomes 왕복 테스트).
3. dist 재빌드. 보고서 `_workspace/02_domain-logic-dev_report.md`.

### backend (backend-dev) — `apps/api/src/**`, `apps/api/test/**`

순서(의존): ① JwtGuard DB role, `audit.ts` → ② news 모듈(공개 GET + CRUD) + 봇 4개 + 알림 설정 + 홈 news → ③ 상세 viewer·결과 필드 → ④ 되돌리기(6-3, core 필요) → ⑤ admin 읽기(overview, results 큐, no-show, members, audit) → ⑥ 역할 변경, API 키, 시즌(core 필요). (S6 초안의 「이의 제기」 단계는 D281로 삭제, 18-1)

테스트(DB 없이, FakePrisma):
- 권한: 모든 `/admin/*`·되돌리기 비운영진 403(없는 id도 403), 비로그인 401, 봇 키로 `/admin` 401, JWT로 봇 엔드포인트 401. **강등 직후 같은 액세스 토큰으로 `/admin/overview` 403**(D263). 토큰 claim이 admin이어도 DB가 member면 403.
- 되돌리기: 팀 정상(ratings 값·wins/losses·이력 삭제·결과 reverted·내전 playing·감사 details), 개인 순위 정상(노쇼 제외 재순위), rated=false 정상(레이팅 무관), 이후 경기 있으면 409(다른 시즌 경기도), 같은 created_at도 409, 닫힌 시즌 409, 7일 경계, 제출자 403 SELF_REVIEW, 승인자 본인 성공, result_id 불일치 409 NOT_APPROVED, ratings elo 불일치 409 + 롤백(아무것도 안 바뀜), 되돌린 뒤 재제출·재승인으로 같은 값(왕복), 되돌린 뒤 내전 삭제 가능, 잠금 순서(내전 → 사용자 → 시즌 FOR SHARE, rawCalls), 랭킹·홈·`scrim_count`에서 빠짐.
- ~~이의 제기~~: D281로 삭제. 대신 삭제 확인 테스트: 세 경로 404(라우트 없음), 반려·되돌리기가 `scrimResultDispute`를 건드리지 않음(시드한 open 행이 그대로 open), 상세·큐 응답에 이의 제기 필드 없음.
- 공지·패치·이벤트: CRUD + 감사(before/after), 영구 삭제, 전송 뒤 notify 변경 409, 같은 값은 통과, 날짜 저장·읽기가 하루 밀리지 않음(KST 자정 전후 시계), 이벤트 PATCH 합친 기간 검사, game 행 없음 400, 목록 정렬·커서·from/to 기본값(월말 경계).
- 봇: 대기 조건 4개(72h 경계 포함), delivered 멱등·NOT_FOUND·notify 꺼진 뒤 delivered 기록, scope 없는 키 403, 패치 `notify_discord_ids`(미연동·notify_patch false·탈퇴 제외).
- 홈 news: 패치 2 + 이벤트 2 순서, 30일 경계, subtitle 자르기, 빈 DB 기대값(architect 테스트 그대로).
- 알림 설정: GET·PATCH, 빈 본문 400, `GET /me` 모양 불변.
- 멤버: 검색(대소문자·`%` 이스케이프), 정렬 5종·커서(sort 바뀐 커서 400), scrim_count·no_show_30d·status, role_locked. 역할: 5분기, 동시 강등 2건(A가 B, B가 A) → 하나만 성공·admin ≥ 1.
- API 키: 발급 원문 형식·해시 저장·원문 미저장·감사에 원문 없음, 발급 키로 봇 엔드포인트 통과, 폐기 후 401, 폐기 멱등.
- 시즌: 생성·수정·삭제 11-1 표 전부, 겹침, lead, 감사, 자동 시즌 생성과 같은 잠금(advisory 호출 기록).
- **DB 필요(작성만)** `test/db/admin.db.e2e.spec.ts`: 되돌리기 동시 승인 경합(같은 사용자 다른 내전), 시즌 FOR NO KEY UPDATE vs 승인 FOR SHARE, `@db.Date` 왕복, ILIKE 이스케이프, `ALTER TYPE ADD VALUE` 후 reverted 저장.
- 보고서 `_workspace/02_backend-dev_s6.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 13절 화면: `/admin`(탭 6개), `/news`, 홈 카드·공지 줄, 설정 알림, 상세 되돌리기·되돌림 표시, 사이드바·모바일, `routes.news`·`routes.admin(tab)`.
2. 훅·`lib/api/*`, 목 백엔드(13절 「훅·목」), architect 임시값 교체.
3. 테스트: 목 되돌리기 규칙(이후 경기 있으면 비활성), 막는 이유 문구 5종, 노쇼 저장(바뀐 행만 호출·첫 실패 멈춤), API 키 원문 대화상자 1회, 시즌 폼 editable 잠금, 캘린더 월 격자(KST, 여러 날 이벤트), 외부 링크 rel, 비운영진 `/admin` FORBIDDEN·STAFF 미렌더.
4. 보고서 `_workspace/02_frontend-dev_s6.md`(목업 없는 화면 목록 포함).

### qa (qa-verifier)

- 엔드포인트 32개 ↔ 컨트롤러·`ApiPath` 일대일, 웹 훅 28개 ↔ 엔드포인트. 이의 제기 잔재 0건(`grep -rniE "dispute|이의 ?제기" apps/api/src apps/web/src` — 주석의 「D281 제거됨」 표기만 허용).
- 권한 매트릭스(5절) 행마다 테스트 존재.
- 되돌리기 6-2·6-3 단계별 대조(잠금 순서, 조건부 update, 감사 스냅샷), core 왕복 테스트.
- 상태 전이 맵(16절) ↔ `assert*Transition` 호출 위치.
- 마이그레이션 diff 재확인, `DROP` 없음.
- 화면: 목업 Admin 대조, 목업 없는 화면은 토큰·패턴 일관성.

### 18-1. D281 결과 이의 제기 제거 작업 (2026-11-01, 사용자 결정)

architect가 shared·core·schema 주석·계약 문서를 끝냈다(19절 하단). **api·web은 지금 typecheck가 깨진다**(api 41건, web 64건 — 아래 파일이 전부). 줄 번호는 2026-11-01 architect 작업 직후 기준. 동작 규칙: 이의 제기 관련 코드는 「표시만 숨김」이 아니라 **삭제**한다. 반려·되돌리기·노쇼 흐름의 나머지 동작은 바꾸지 않는다.

#### backend (backend-dev) — `apps/api/**`

| 파일:줄 | 작업 |
| --- | --- |
| `src/common/app-error.ts:55-57` | `SCRIM_DISPUTE_NOT_ALLOWED`·`SCRIM_DISPUTE_EXISTS`·`DISPUTE_ALREADY_RESOLVED` 문구 3줄 삭제(Record 키 초과로 TS 오류) |
| `src/modules/scrims/scrims.controller.ts:9-10, 229, 244-253` | `CreateScrimDispute*` import, `createDispute` 핸들러(`POST ApiPath.scrimResultDisputes`) 삭제, 229 주석 「승인 되돌리기」로 |
| `src/modules/scrims/scrim-results.service.ts:7, 16-19, 23` | import `disputeBlock`, `CreateScrimDisputeRequest`, `DISPUTE_AUTO_RESOLUTION`, `DISPUTE_STATUS_TRANSITIONS`, `DisputeStatus`, `SCRIM_DISPUTE_WINDOW_DAYS` 삭제 |
| 같은 파일 `:65-70` | `assertDisputeTransition` 삭제(admin-review.service.ts가 import — 함께 삭제) |
| 같은 파일 `:340, 353` | `reject`: 주석 S6(D250) 줄과 `autoResolveDisputes(...)` 호출 삭제 → S3 반려 그대로 |
| 같은 파일 `:358-368` | `autoResolveDisputes` 메서드 삭제 |
| 같은 파일 `:371, 485-486` | `revert`: 머리 주석의 「open 이의 제기 자동 처리」 삭제, 8d 호출 삭제(감사 `result.revert`는 유지) |
| 같은 파일 `:502-537` | `createDispute` 메서드 전체 삭제 |
| `src/modules/scrims/scrim-views.service.ts:6, 22` | import `disputeBlock`·`SCRIM_DISPUTE_WINDOW_DAYS` 삭제 |
| 같은 파일 `:333-352` | 상세의 open 이의 제기 조회(`scrimResultDispute.findMany`)·`hasOpenDispute`·`isParticipant`(다른 곳에서 안 쓰면)·`canDispute` 계산 삭제, 333 주석 「S6 되돌리기(6-4)」로. 되돌리기 판정(`revertBlockReason`)은 유지 |
| 같은 파일 `:445-446` | viewer `can_dispute_result`·`has_open_dispute` 삭제 |
| 같은 파일 `:452, 496, 562` | `resultView(..., openDisputes.length)` 인자·`openDisputeCount` 매개변수·`open_dispute_count` 필드 삭제 |
| `src/modules/admin/admin.controller.ts:15-16, 24-25, 74-87`(`adminNoShowScrims` 앞까지) | `ListAdminDisputes*`·`ResolveDispute*` import, `disputes`·`resolveDispute` 핸들러 삭제 |
| `src/modules/admin/admin-review.service.ts:9, 12-13, 18, 22, 35` | `AdminDisputeItem`·`ListAdminDisputes*`·`ResolveDisputeRequest`·`ScrimResultDispute` 타입·`assertDisputeTransition` import 삭제 |
| 같은 파일 `:53` | 클래스 주석 「결과·노쇼 후보」로 |
| 같은 파일 `:99-110 부근` | `results()`의 `disputed` 보기 분기 삭제(보기 `pending`·`approved`만) |
| 같은 파일 `:129, 136-141, 202` | 큐 행 조립의 open 이의 제기 수 쿼리·`disputeCount`·`open_dispute_count` 삭제(N+1 규칙 유지) |
| 같은 파일 `:211-299` | `disputes()`, `disputeItems()`, `resolve()` 전부 삭제. 목록 커서 키 `'disputes'` 사용처도 없어진다 |
| `src/modules/admin/admin-overview.service.ts:38-39, 72` | `scrimResultDispute.count`·`findFirst` 2쿼리와 `open_disputes` 블록 삭제(구조 분해·latestScrim 조회 정리) |
| `test/scrim-disputes.e2e.spec.ts` | **파일 삭제**. 대신 짧은 회귀 테스트 추가(위치 자유, 예 `scrim-revert.e2e.spec.ts` 끝): ① `POST /scrims/:id/result/disputes`·`GET /admin/disputes`·`POST /admin/disputes/:id/resolve` → 404 ② 시드한 open 행이 반려·되돌리기 뒤에도 open(앱이 표를 건드리지 않음) |
| `test/scrim-revert.e2e.spec.ts:9, 66, 73, 78, 91, 105, 320, 327` | `seedDispute` 사용·`open_dispute_count` 기대값·「이의 제기 자동 처리」 단언 삭제(① ②의 회귀 테스트로 옮기면 seedDispute는 그쪽에만) |
| `test/admin-overview.e2e.spec.ts:14, 39, 50-52, 73, 87, 95, 134-144` | `open_disputes`·`disputed` 보기·`open_dispute_count` 기대값·이의 제기 시드 삭제 |
| `test/admin-auth.e2e.spec.ts:27-28` | 권한 표에서 `/admin/disputes` 2행 삭제(라우트가 없어 403이 아니라 404) |
| `test/support/s6-helpers.ts:33-34, 48-60 부근` | `dispute()` 호출 도우미 삭제. `seedDispute`는 위 회귀 테스트가 쓰면 남기고 아니면 삭제 |
| `test/support/fake-prisma.ts:27, 65-66, 186, 214-225 부근, 293-296, 456` | **남겨도 된다**(DB 표가 남아 있고 cascade 흉내는 DB와 같다). 회귀 테스트 ②가 쓰므로 유지 권장. 주석의 S6 설명만 「D281 이후 앱 코드는 쓰지 않음」으로 |
| `test/db/admin.db.e2e.spec.ts:84` | TRUNCATE 목록의 `scrim_result_disputes`는 **유지**(표가 있다) |

검증: `corepack pnpm --filter api typecheck`, `corepack pnpm exec vitest run`(api), `grep -rn "scrimResultDispute" apps/api/src` 0건.

#### frontend (frontend-dev) — `apps/web/**`

| 파일:줄 | 작업 |
| --- | --- |
| `src/lib/errors.ts:68-70` | 이의 제기 오류 문구 3줄 삭제 |
| `src/lib/api/scrims.ts:9, 11, 172, 180-183` | `CreateScrimDispute*` import·`createScrimDispute` 삭제, 172 주석 「승인 되돌리기」로 |
| `src/lib/hooks/scrims.ts:4, 26, 353, 373-380 부근` | `useCreateScrimDispute`와 import 삭제, 주석 정리 |
| `src/lib/api/admin.ts:12, 17, 25, 34, 60, 72-80` | `listAdminDisputes`·`resolveAdminDispute`와 import 삭제 |
| `src/lib/hooks/admin.ts:5, 34, 39, 64, 138-150 부근, 251-262 부근` | `adminKeys.disputes`, `useAdminDisputes`, `useResolveDispute`와 import 삭제. 다른 훅의 무효화 목록에 `['admin','disputes']`가 있으면 삭제 |
| `src/lib/admin.ts:60` | 큐 보기 라벨 `disputed` 삭제(`AdminResultView` 2종) |
| `src/lib/admin.ts:72, 93-97` | 통계 칸 key `'disputes'` → `'scrims_week'`(이름 자유): 라벨 「이번 주 내전」, 값 `o.scrims_this_week`, 보조 문구 「월요일부터 · 취소 제외」(13절, D281) |
| `src/lib/admin.ts:304` | 감사 action 라벨 `'dispute.resolve'` 삭제(Record 키 초과) |
| `src/lib/admin.test.ts:46` | overview 픽스처 `open_disputes` 삭제, 4번째 칸 기대값을 이번 주 내전으로 |
| `src/components/admin/admin-results.tsx:4-6, 13-14, 45` | `DISPUTE_RESOLUTION_*`·`DisputeResolution`·`AdminDispute*` 타입·`useAdminDisputes`·`useResolveDispute` import 삭제 |
| 같은 파일 `:53, 64` | 머리 주석에서 「이의 제기」 삭제, `<DisputesPanel />` 렌더 삭제 |
| 같은 파일 `:114, 139` | `VIEWS = ['pending', 'approved']`, 빈 상태 문구의 disputed 분기 삭제 |
| 같은 파일 `:197, 208` | 행 테두리의 `open_dispute_count > 0` 분기와 「이의 제기 N건」 배지 삭제 |
| 같은 파일 `:278` | 되돌리기 사유 placeholder 「예: 승리 팀이 반대로 입력됐어요」로(이의 제기 언급 삭제) |
| 같은 파일 `:293-395 부근` | `DISPUTE_FILTERS`, `DisputesPanel`, `DisputeRow` 전부 삭제 |
| `src/components/scrims/scrim-result.tsx:4, 6-8, 29` | `DisputeReason`·`SCRIM_DISPUTE_*`·`useCreateScrimDispute` import 삭제 |
| 같은 파일 `:63, 76` | `open_dispute_count` 읽기·「이의 제기 N건 검토 중」 배지 삭제 |
| 같은 파일 `:107` | `<DisputeBar />` 렌더 삭제 |
| 같은 파일 `:460` | 절 주석 「S6 승인 되돌리기(운영진)」로 |
| 같은 파일 `:520-575 부근` | `DisputeBar` 컴포넌트 삭제 |
| `src/components/ui/form.tsx:165` | 주석 「(반려·되돌리기)」로 |
| `src/lib/api/mock/ratings.ts:400-401, 444` | `openDisputes` 옵션·`open_dispute_count` 필드 삭제 |
| `src/lib/api/mock/scrims.ts:72-73, 79` | `autoResolveDisputes`·`dropDisputesOf`·`openDisputeCount` import 삭제 |
| 같은 파일 `:203, 1131` | 주석의 「이의 제기」 삭제 |
| 같은 파일 `:1058-1080 부근` | 상세 viewer·결과 조립에서 이의 제기 값(`openDisputes:` 인자, viewer 2필드) 삭제 |
| 같은 파일 `:1347-1348` | 반려의 `autoResolveDisputes` 호출 삭제 |
| 같은 파일 `:1496, 1664` | 제출 취소·내전 삭제의 `dropDisputesOf` 호출 삭제 |
| `src/lib/api/mock/admin.ts:5, 35, 42, 48, 55, 57, 74` | `disputeBlock`·이의 제기 스키마·상수·`AdminDisputeItem` import 삭제 |
| 같은 파일 `:97-102` | 머리 주석: 「웹이 부르는 28개」, 이의 제기 언급 삭제 |
| 같은 파일 `:162-173, 215, 225, 235` | `MockDispute` 스키마·`disputes` 상태 필드 삭제(저장된 목 상태에 `disputes`가 있어도 zod 객체가 버린다) |
| 같은 파일 `:298-340` | `openDisputeCount`, viewer 도우미의 `can_dispute_result`·`has_open_dispute`(반환 Pick도 2필드로), `autoResolveDisputes`, `dropDisputesOf` 삭제 |
| 같은 파일 `:522-546` | 시드 이의 제기 3건 삭제 |
| 같은 파일 `:591` | 경로 정규식 `(revert|disputes)` → `revert` |
| 같은 파일 `:716-745 부근` | 참가자 이의 제기 핸들러 삭제 |
| 같은 파일 `:772` | 되돌리기의 `autoResolveDisputes` 호출 삭제 |
| 같은 파일 `:803, 817` | overview의 open 이의 제기 계산·`open_disputes` 삭제 |
| 같은 파일 `:842, 849, 864` | 큐의 `disputed` 보기·`latestOpen`·`open_dispute_count` 삭제 |
| 같은 파일 `:873-910 부근` | `disputeView`, `GET adminDisputes`, `POST adminDisputeResolve` 핸들러 삭제 |
| `src/lib/api/mock/admin.test.ts:6, 9, 16, 102, 105-122, 146-170 부근` | 이의 제기 import·「S6 목: 이의 제기」 describe·되돌리기 테스트의 자동 처리 단언 삭제. 큐 기대값에서 `open_dispute_count` 삭제 |

검증: `corepack pnpm --filter web typecheck`, `corepack pnpm exec vitest run`(web), `grep -rniE "dispute|이의 ?제기" apps/web/src` 0건.

#### qa (qa-verifier)

- 18절 qa 목록 + 위 grep 2개. 화면: `/admin` 결과 탭에 이의 제기 패널·보기 칩·배지 없음, 통계 4번째 칸이 「이번 주 내전」, 상세에 이의 제기 버튼·배지 없음.
- 반려·되돌리기·노쇼 회귀(기존 테스트 통과 + 18-1 backend 회귀 테스트 ① ②).

---

## 19. 영향받는 파일·배포

architect가 바꾼 것:

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/common/primitives.ts` | `IsoDate`, `isoDateDiffDays`, `ExternalUrl` |
| `packages/shared/src/constants/enums.ts` | `ScrimResultStatus` + reverted, `ApiKeyScope` + 2, `AdminAuditAction`, `AdminAuditTargetType`, `ADMIN_AUDIT_TARGET_BY_ACTION`(D281: dispute 항목 삭제, `DisputeStatus` 주석) |
| `packages/shared/src/constants/transitions.ts` | finished → playing, approved → reverted, reverted 종착. D281: `DISPUTE_STATUS_TRANSITIONS` 삭제 |
| `packages/shared/src/common/errors.ts` | 오류 8개 + 상태 표(D281로 3개 삭제) |
| `packages/shared/src/scrims.ts` | `ScrimResultRevertBlock`, `ScrimViewer` 2필드, `ScrimResultView` 3필드, 주석 |
| `packages/shared/src/scrim-results.ts` | 되돌리기 스키마·상수(이의 제기 스키마·상수는 D281로 삭제) |
| `packages/shared/src/news.ts`(새) | 공지·패치노트·이벤트 스키마·상수, 홈 news 상수 |
| `packages/shared/src/admin.ts`(새) | 운영진 엔드포인트 스키마·상수(D281: 이의 제기 스키마·`open_dispute_count`·`disputed`·`open_disputes` 삭제) |
| `packages/shared/src/me.ts` | 알림 설정 |
| `packages/shared/src/bot.ts` | `BOT_ENDPOINT_SCOPE` + 2, 봇 공지·패치노트 스키마 |
| `packages/shared/src/dashboard.ts` | `DashboardNewsItem`, `DashboardNews`, 요약 `news` 필수 |
| `packages/shared/src/paths.ts`, `index.ts` | 경로 25개(D281로 3개 삭제), export 2줄 |
| `packages/shared/src/contract.s6.test.ts`(새) | 계약 테스트 24개(D281: 이의 제기 1개 삭제, 경로·오류·감사·큐에 「없음」 단언 추가) |
| `packages/shared/src/contract.s2/s3/s4/s5.test.ts` | 픽스처에 S6 필드·news(D281: s2·s3 픽스처의 이의 제기 3필드 삭제), s3 finished 전이 단언, s5 개수 단언을 「이상」으로 |
| `packages/shared/dist`, `packages/core/dist` | 재빌드(D281 반영 후 다시) |
| `packages/core/src/result-review.ts`, `result-review.test.ts`, `index.ts` | D281: `disputeBlock`·`DisputeBlock`·테스트 8개 삭제, 미사용 import `ScrimResultStatus` 삭제 |
| `apps/api/prisma/schema.prisma` + `migrations/20261031230000_s6/` | 3절. D281: `ScrimResultDispute` 모델 주석만 변경(마이그레이션 변경 없음) |
| `apps/api/src/common/app-error.ts`, `apps/web/src/lib/errors.ts` | 새 오류 문구(Record라 필수) |
| `apps/api/src/modules/scrims/scrim-views.service.ts` | reverted_* 직렬화(완료), viewer 임시값(D281 이후 이의 제기 값은 18-1에서 삭제) |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | 임시 `news` |
| `apps/api/test/dashboard.e2e.spec.ts` | 빈 DB 기대값에 `news` |
| `apps/api/test/support/fake-prisma.ts` | scrimResult 기본값 reverted_* 3개 |
| `apps/web/src/lib/api/mock/scrims.ts`, `mock/ratings.ts`, `mock/rankings.ts` | 임시값 |
| `.env.example` | 주석 2줄 |
| `packages/shared/src/calendar.ts`(새, 2026-11-01 (2)) | `GetCalendarQuery`·`GetCalendarResponse`·`CalendarItem`(`CalendarScrimItem`·`CalendarEventItem`)·`CalendarMonth`·`CalendarScrimStatus`, 상수 `CALENDAR_SCRIMS_MAX`(300)·`CALENDAR_EVENTS_MAX`(100) |
| `packages/shared/src/paths.ts`, `index.ts`(2026-11-01 (2)) | `ApiPath.calendar = '/calendar'`, `export * from './calendar'` |
| `packages/shared/src/contract.s6.calendar.test.ts`(새, 2026-11-01 (2)) | 계약 테스트 10개(경로, 월 형식, 취소 제외, 명단·방장 없음, EventView 호환, 날짜만, truncated 필수·상수) |
| `packages/shared/dist`(2026-11-01 (2)) | 재빌드 |
| `packages/shared/src/news.ts`(2026-11-01 (3)) | `EventTime`, `EventView.start_time·end_time`(1단계 optional), `CreateEventRequest`·`UpdateEventRequest` 시각 필드, `eventScheduleIssues`·`EventScheduleIssue`(export), 내부 `checkEventSpan` → `checkEventPatch`, 정렬 주석(D302) |
| `packages/shared/src/dashboard.ts`(2026-11-01 (3)) | `DashboardNewsItem`(event) `start_time·end_time`(1단계 optional), 정렬 주석 |
| `packages/shared/src/admin.ts`(2026-11-01 (3)) | `ADMIN_UPCOMING_MAX`(5)·`ADMIN_UPCOMING_DAYS`(30), `AdminUpcoming`, `AdminOverview.upcoming`(1단계 optional). `calendar.ts` import(순환 없음) |
| `packages/shared/src/calendar.ts`(2026-11-01 (3)) | 주석만(시각·정렬) |
| `packages/shared/src/contract.s6.event-times.test.ts`(새, 2026-11-01 (3)) | 계약 테스트 26개(시각 형식, 생성·수정 검증, 합친 값 검사, 응답 시각 필드, 1단계 optional, 「다가오는 일정」 모양·한도·공개 범위) |
| `packages/shared/src/contract.s6.calendar.test.ts`(2026-11-01 (3)) | 「날짜만」 테스트 1개를 「시각 생략 = 종일」로 바꿈 |
| `apps/api/prisma/schema.prisma` + `migrations/20261101120000_s6_event_times/`(새, 2026-11-01 (3)) | `CalendarEvent.startTime·endTime @db.Time(0)`, ADD COLUMN 2개(3절) |
| `packages/shared/dist`(2026-11-01 (3)) | 재빌드 |

**배포 영향:** `news`와 ScrimDetail 새 필드가 필수라 **api와 web을 같은 커밋으로 배포**한다(S4 D200, S5와 같음). 새 웹 + 옛 api → 요약·상세 parse 실패. 옛 웹 + 새 api → 모르는 필드는 버리지만 `result.status: 'reverted'`·`result_status: 'reverted'`는 옛 웹 enum parse 실패(되돌린 내전이 생긴 뒤에만). 마이그레이션은 추가만이라 옛 api가 새 스키마에서 돈다. 단 `ALTER TYPE ADD VALUE`는 롤백할 수 없다(값 제거 불가) — 되돌리기 전에 배포를 되돌리면 enum 값만 남고 무해하다. 봇은 새 scope 키를 발급해야 공지·패치 전송을 쓴다(기존 키는 401이 아니라 403 SCOPE_MISSING).

**사용자 결정 반영 후(architect, 2026-11-01 (3)):** shared typecheck 통과·테스트 **195 passed**(9파일, 새 파일 26개), dist 재빌드. `corepack pnpm -r typecheck` 4개 **Done**(1단계 optional이라 api·web 깨진 곳 없음). 관련 테스트 api 7파일 64 passed(news·admin 4종·calendar·dashboard), web 4파일 60 passed(admin·news·calendar·mock admin). `prisma format`·`validate`·`generate` 통과, 두 마이그레이션 모두 migrate diff stdout 일치. 배포: S6와 같은 커밋(마이그레이션 2개 순서대로). 옛 api + 새 web은 S6 규칙상 없는 조합. 2단계(D305) 뒤에는 시각·upcoming이 필수라 api·web 같은 커밋이 필요하다(기존 규칙과 같음).

**D305 2단계 후(architect, 2026-11-01 (4)):** 변경 파일 — shared `news.ts`·`dashboard.ts`·`admin.ts`(세 곳 `.optional()` 삭제, 주석 「전환」 문구 정리), `contract.s6.event-times.test.ts`(「1단계」 단언 2개 → 실패 기대: EventView 시각 키 생략·`start_time`만 있음·CalendarItem(event)·DashboardNewsItem(event) 시각 키 생략은 실패, AdminOverview `upcoming` 생략·null은 실패), `contract.s6.calendar.test.ts`·`contract.s6.test.ts`(이벤트 픽스처에 `start_time: null, end_time: null`), dist 재빌드. web — `lib/admin.ts`(`upcomingRows(u: AdminUpcoming)`, `if (!u) return []`·「1단계」 주석 삭제), `components/admin/admin-results.tsx`(「1단계」 주석 1줄 삭제, `UpcomingCard` prop `AdminUpcoming`, `upcoming?.has_more` → `upcoming.has_more`), `lib/admin.test.ts`(「1단계: upcoming 없음」 → 「항목 없음」, `upcomingRows(undefined)` 단언 삭제, 통계 픽스처에 빈 `upcoming`), `lib/calendar.test.ts`·`lib/news.test.ts`(EventView 픽스처에 시각 null 2개), `lib/api/mock/admin.test.ts`(주석만). api — `test/calendar.e2e.spec.ts`·`test/admin-overview.e2e.spec.ts`(주석만). **api·목 런타임 코드는 이미 세 필드를 항상 채워 변경 0줄**(QA 확인 그대로). 결과: `corepack pnpm -r typecheck` 4개 Done, 테스트 shared 195·core 542·api 664 passed(52 skipped, DB e2e)·web 383 passed, `corepack pnpm -r build` 4개 Done. 남긴 것: web `lib/news.ts` `EventSchedule`의 `start_time?`·`end_time?`(표시 함수 입력 타입 — 필수 타입도 받으므로 그대로)와 `news.test.ts` 「옛 응답 = 종일」 테스트(함수 폴백 동작이라 동작 변경 금지 원칙으로 유지).

**캘린더 추가 후(architect, 2026-11-01 (2)):** shared typecheck 통과·테스트 **169 passed**(8파일, 캘린더 10개 추가), dist 재빌드. core 변경 없음(typecheck 통과·501 passed — 14-7 함수는 logic 담당). api·web typecheck **통과**(추가만이라 깨진 곳 없음). 스키마 변경 없음 → 마이그레이션 없음(`prisma migrate diff` 대상 없음). 배포: `GET /calendar`는 새 엔드포인트라 옛 api + 새 web이면 캘린더 칸만 404 오류 상태(홈·관리자 다른 블록은 정상). S6 규칙대로 api·web 같은 커밋 배포.

**D281 이후(architect, 2026-11-01):** shared typecheck 통과·테스트 159 passed, core typecheck 통과·테스트 501 passed, 두 패키지 dist 재빌드. api·web typecheck는 18-1 작업 전까지 실패(api 41, web 64). D281은 S6 미배포 상태에서의 변경이라 S6 api·web을 같은 커밋으로 배포하는 규칙은 그대로다.

**기준선(architect, 2026-10-31, 구현 전):** `corepack pnpm -r typecheck` 4개 Done. 테스트 shared 160(s6 25개 포함)·core 418·web 305·api 583 passed / 47 skipped(DB e2e). `prisma validate`·`generate` 통과, migrate diff 일치. Node 24(임시)로 `corepack pnpm exec vitest run` 저장소 설정 그대로 실행.

---

## 20. 결정 사항 (S6, D241부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D241 | S6 포함·제외는 1-1·1-2 표. 라이엇 수동 소유 승인·회원 삭제·차단·스팀 할인은 제외 | 슬라이스 범위. 제외 항목은 확인 필요에 남긴다 |
| D242 | **승인 되돌리기 안전 범위**: (a) 결과 approved (b) 승인 후 7일 안 (c) 요청자 ≠ 제출자 (d) 반영 시즌 closed_at 없음 (e) 반영된 참가자 전원에게 이 결과가 같은 게임의 마지막 rating_history(모든 시즌) (f) 현재 ratings가 이력 elo_after·승패와 맞음. 이후 경기 재계산(replay)과 닫힌 시즌 되돌리기는 **제외 확정** | 이후 경기를 다시 계산하면 K 판정(D106)·시작 점수가 연쇄로 바뀌어 다른 내전·다른 회원의 확정 변동, standings·뱃지까지 다시 써야 한다. 조건 (e)면 「승인 전 값으로 되돌리기」가 정확하고 다른 행에 영향이 없다 |
| D243 | 되돌리기 효과: 결과 `reverted`(새 상태, reverted_by·at·reason), 이력 행 삭제, ratings `elo = elo_before`·wins/losses 1 감소(0경기 행도 남김), 내전 finished → playing, 감사 스냅샷(D281: 「open 이의 제기 자동 처리」 삭제). 재입력은 새 pending 행 | pending으로 되돌리면 승인 기록·반려 흐름과 섞인다. 새 상태라 부분 고유 인덱스가 그대로 「활성 결과 없음」을 보장한다. 이력은 감사 details에 남기고 표에서는 지워야 그래프·K·랭킹이 맞다 |
| D244 | 되돌리기 기한 7일 — shared 상수(설정값 아님). (이의 제기 기한 3일은 D281로 삭제) | 노쇼 표시 기한(7일, D83)과 맞춘다. 운영 근거가 생기면 env로(Q2) |
| D245 | `rating_history.outcome` 컬럼을 추가하지 않고 승패를 결과 행(winner_team·팀, placements 재순위)으로 다시 구한다(core inferRevertOutcomes). 구할 수 없으면 rating_mismatch | 승인 이후 팀·placements는 바뀌지 않는다(팀 편집은 활성 결과가 있으면 막힘, S3). 상세 화면(scrim-views)이 이미 같은 규칙으로 outcome을 그린다. 컬럼을 추가해도 기존 행은 비어 같은 추론이 필요하다 |
| D246 | 되돌리기 잠금 = 승인과 같은 순서(내전 → 사용자 advisory → 시즌 FOR SHARE). 제출자 본인은 `SCRIM_RESULT_SELF_REVIEW`(403), 승인자 본인은 허용 | 순서가 같아 교착이 없고, 같은 사용자의 다른 승인과 직렬화돼 「마지막 이력」 판정이 경합에서 흔들리지 않는다. 승인 실수를 승인자가 바로 고칠 수 있어야 한다(목업 「되돌리기」). 자기 결과 되돌리기는 자기 승인 금지(메인 기본값 8)와 같은 이유로 막는다 |
| D247 | 「이후 경기」 = 같은 (user, game)에서 다른 결과의 이력 중 created_at ≥ 이 이력 created_at. 같은 시각도 막는다 | created_at은 사용자 잠금 뒤 정해져 순서가 보장되지만, 같은 ms면 순서를 알 수 없다. 보수적으로 막는다 |
| D248 | 되돌리기 후 랭킹 캐시를 즉시 무효화하지 않는다(다음 5분 주기) | 승인도 같다(S4). 화면 갱신 시각이 있어 늦은 반영이 드러난다 |
| ~~D249~~ | **제거됨(D281, 사용자 결정).** ~~이의 제기 = 참가자(방장·joined·no_show)만, pending은 언제든·approved는 3일, (결과, 사용자)당 open 1개를 내전 행 잠금으로 보장, 사유 2–300자. 내용은 운영진만 | 결과를 아는 사람만 이의를 낼 수 있다. 노쇼 회원은 결과·노쇼 판정에 이의가 있을 수 있다. 부분 고유 인덱스는 migrate diff 밖 SQL이 필요해 쓰지 않는다~~ |
| ~~D250~~ | **제거됨(D281, 사용자 결정).** ~~반려·되돌리기는 그 결과의 open 이의 제기를 자동 처리, 승인은 하지 않는다. 처리 API는 기록만 남긴다 | 결과가 바뀌면 이의 제기의 대상이 사라진다. 승인 뒤에도 이의가 남아야 운영진이 되돌릴지 판단한다(문서 「결과 분쟁 처리」). 처리 API에 결과 변경을 섞으면 같은 일을 하는 경로가 둘이 된다~~ |
| D251 | 승인 큐는 읽기 엔드포인트 1개(view 2종 — D281로 `disputed` 삭제)만 새로 두고, 승인·반려는 S3 엔드포인트를 재사용 | 승인 흐름(잠금·레이팅)을 한 곳에만 둔다 |
| D252 | 노쇼는 후보 목록 API만 새로 두고 저장은 기존 참가자별 API를 차례로 호출 | 노쇼 규칙(기한·전이·제한 계산)이 S2 한 곳에 있다. 일괄 API는 부분 실패 의미를 새로 정해야 한다. 한 내전 10명 수준이라 호출 수가 문제 되지 않는다(Q16) |
| D253 | 공지는 운영진 누구나 수정·삭제, author 불변, 영구 삭제 + 감사(삭제 전 전체 값) | 메인 기본값 2. 운영진은 같은 권한이다. 수정 이력은 감사로 충분하다 |
| D254 | `patch_notes`·`events` 새 표. 날짜는 `date`(KST 날짜 그대로), 패치노트 게임 필수·이벤트 선택, 외부 링크 http(s)만, 서버는 링크를 열지 않는다. Prisma 모델 이름 `CalendarEvent` | 패치 게시일·출시일은 날짜 정보다(시각을 넣으면 KST 자정 변환 오류가 생긴다). 메인 기본값 1. `javascript:` 링크 차단. `Event`는 DOM 타입과 헷갈린다 |
| D255 | 봇 scope 2개(`bot:notices`, `bot:patch-notes`), `BOT_ENDPOINT_SCOPE` 키는 리소스 단위 | 대기 조회와 전송 기록은 함께 쓰여야 의미가 있다. 값 ↔ ApiKeyScope 1:1은 S5 테스트 그대로 |
| D256 | 봇 대기 = 72시간 안에 만든 미전송 행 20개, delivered는 멱등이고 notify가 꺼진 뒤에도 기록 | 봇이 며칠 꺼졌다 켜져도 지난 공지를 몰아 보내지 않는다. 실제로 보낸 사실이 기록돼야 다시 보내지 않는다 |
| D257 | 전송 뒤 `notify_discord` 변경은 409, 제목·본문 수정은 재전송하지 않는다 | 「다시 보내기」 의미가 없다(Q). 끄기도 이미 보낸 것을 되돌리지 못한다 |
| D258 | 홈 `news` 필수 블록(공지 1 + 패치 2 + 이벤트 2), 요청마다 3쿼리 | 목업 「패치 · 이벤트」 3행 + 공지. 내용이 자주 바뀌지 않지만 쓰기 직후 보여야 하고 쿼리가 가볍다. 필수라 배포 순서 규칙(15절) |
| D259 | 알림 설정은 `scrim_start`·`patch` 두 개만 새 엔드포인트로 연다. `GET /me` 모양 불변 | 발송 경로가 있는 것만 연다(설정해도 아무 일 없는 토글 금지). Me를 바꾸면 인증 응답 전부가 바뀐다 |
| D260 | 패치 DM 대상 = 연동 && notify_patch && 탈퇴 아님, 게임 구분 없음 | 설정이 게임별이 아니다(목업). 게임별은 Q12 |
| D261 | `admin_audit_logs`(text action, FK 없는 target_id, details jsonb), 행위와 같은 트랜잭션, 수정·삭제 API 없음 | 대상이 지워져도 기록이 남아야 한다. 감사 실패를 무시하면 감사가 아니다. action이 늘 때 마이그레이션이 필요 없게 text |
| D262 | 감사 대상 = S6 운영진 쓰기 전부(슬라이스 5종 + 생성·수정. 이의 제기 처리는 D281로 삭제). 승인·반려·노쇼·CLI 키 발급은 제외 | 슬라이스 목록보다 넓게 잡아 「누가 공지를 고쳤나」도 답한다. 승인·반려·노쇼는 이미 *_by·*_at 컬럼에 남는다 |
| D263 | JwtGuard가 role을 DB에서 읽는다(S0 동작 변경) | 웹 강등이 생겨 토큰 claim은 최대 15분 낡는다. 이미 하는 사용자 조회에 컬럼 하나라 비용이 없다 |
| D264 | `ADMIN_DISCORD_IDS` 회원은 웹에서 강등 불가(`role_locked`, 409 ADMIN_ROLE_LOCKED). 승격은 가능 | 메인 기본값 3. 강등해도 다음 로그인에 다시 승격돼 화면이 거짓말을 한다. 환경 변수가 「고정 운영진」이라는 뜻을 화면에 그대로 보인다(Q5) |
| D265 | 자기 역할 변경 금지(403), 마지막 admin 강등 금지(409), `admin-roles` advisory 잠금 아래 요청자 role 재확인 | 실수로 스스로 권한을 잃지 않게. 동시 맞강등(A→B, B→A)에서 둘 다 member가 되는 경합을 막는다 |
| D266 | 멤버 목록 커서 = 불투명 오프셋(sort 포함) | 계산 열(내전 수·노쇼) 정렬은 키셋 커서가 어렵다. 회원 수가 수백 명 규모라 오프셋 비용이 작다. 클라이언트는 여전히 불투명 문자열로 다룬다 |
| D267 | 멤버 `scrim_count` = S5 D239 정의(승인된 결과 + joined), 기간 없음 | 활동 랭킹 열과 같은 뜻이어야 숫자가 어긋나지 않는다 |
| D268 | 시즌 수정 단계별 허용 = 11-1 표. 진행 중 시즌의 끝 변경만 허용(≥ now + 1시간), 시작 변경·끝난 시즌 변경·시작한 시즌 삭제 불가 | 이미 반영된 이력의 시즌 귀속(D116)과 종료 작업(D141)을 건드리지 않는 범위. 끝 변경은 미래 구간만 바꾼다 |
| D269 | 값 규칙: lead 1시간, 길이 7–366일, 반열림 겹침 금지(이번에 쓰는 행 기준) | lead는 승인 상한(15초)·종료 유예(60초)보다 충분히 길다. 겹침은 resolveSeasonAt 동점 규칙에 기대지 않게 한다 |
| D270 | 시즌 쓰기 잠금 = `season-auto-create` advisory → 대상 행 FOR NO KEY UPDATE → now → 검증 | 자동 시즌 생성과 직렬화하고, 진행 중 승인(FOR SHARE)·종료 작업과 충돌을 잠금으로 해결한다 |
| D271 | 시즌 삭제는 upcoming만, 행 삭제(감사) | 시작 전이라 ratings·이력·standings가 없다 |
| D272 | 웹 API 키 발급은 CLI와 같은 생성 함수, created_by = 운영진, 원문 1회, 폐기 멱등, 행 삭제 없음. CLI는 그대로(감사 없음) | S5 D221 원칙. activity_logs.api_key_id 감사를 위해 키 행을 지우지 않는다 |
| D273 | `/admin`은 탭 6개(결과·노쇼 / 멤버 / 공지·소식 / 시즌 / API 키 / 감사 로그), 목업 Admin은 첫 탭 + 멤버·공지에 그대로 | 목업 한 화면에 모든 기능을 넣으면 길어진다. 목업에 있는 블록 모양은 바꾸지 않는다 |
| D274 | `/news`는 공지·패치노트·이벤트 캘린더 세 섹션, 스팀 할인 영역 없음. 사이드바 「정보」 추가, 모바일은 탭 수에 따라 | 문서 8장. 할인은 출처 미정 |
| D275 | 되돌리기 경로는 `/scrims/:id/result/*` 아래(승인·반려와 같은 자리, 이의 제기 경로는 D281로 삭제) | 내전 행 잠금 경로·권한 검사를 같은 서비스에서 공유한다 |
| D276 | ScrimDetail 결과·viewer 필드 5개 필수 추가(D281로 8 → 5), 판정은 core 함수와 같게 | 상세 화면 버튼은 viewer 플래그로만 그린다(S2 규칙). 필수라 배포 규칙 |
| D277 | 통계 overview = AdminOverview 주석 정의, 캐시 없음 | 목업 4칸 + 캐시 시각. 운영진만 보는 화면이라 요청마다 계산해도 된다 |
| D278 | 감사 summary는 서버가 만든 한국어 한 줄, 사용자 입력은 40자까지 인용 | 목록이 details JSON 없이 읽힌다 |
| D279 | 라이엇 수동 소유 승인(S1 예약 경로)은 S6에서도 만들지 않는다 | 슬라이스에 없다(Q13) |
| D280 | 새 환경 변수 없음 | 정책 값은 shared 상수(D226과 같은 원칙) |
| D281 | **결과 이의 제기 기능 제거(사용자 결정 2026-11-01).** 참가자 접수·운영진 목록·처리 완료·반려·되돌리기 때 자동 처리·상세 배지·버튼·큐 보기·통계 칸·감사 action·오류 코드·전이 맵·core 판정을 모두 지운다(7절 표). 결과 분쟁은 운영진이 승인 큐에서 반려(pending)·되돌리기(approved)로만 처리한다. 반려·승인 되돌리기·노쇼 처리는 유지. DB `dispute_status` enum·`scrim_result_disputes` 표는 **DROP하지 않는다**(S0 마이그레이션으로 운영 DB에 있을 수 있다, 앱 코드 사용 안 함). shared `DisputeStatus` enum은 DB 값 기록용으로 남긴다. 통계 4번째 칸은 기존 필드 `scrims_this_week`(「이번 주 내전」)로 채운다(새 필드 없음). 삭제 경로는 404 | 사용자 결정. 표를 지우는 마이그레이션은 되돌릴 수 없고 이득이 없어(빈 표·enum 1개) 남긴다. S6가 아직 배포 전이라 필수 필드 삭제는 api·web 같은 커밋 배포로 호환 문제가 없다. 통계 칸은 목업 4칸 배치를 유지하려고 이미 응답에 있는 값을 쓴다 |
| D282 | **커뮤니티 캘린더(사용자 요청 2026-11-01).** 한 달 격자에 내전/모집(취소 제외)과 운영진 일정(기존 `events` 표)을 함께 보인다. 새 표 없음 — 운영진 일정 = `events` 행 | 사용자 요청. `events`가 이미 제목·게임·시작/종료일·링크·설명을 갖고 있고 CRUD·감사·`/news`·홈 news가 붙어 있다. 표를 나누면 같은 「일정」이 두 곳에 생긴다 |
| D283 | ~~운영진 일정은 **날짜만**(시각 없음).~~ **D298로 대체(2026-11-01 (3) 사용자 결정 Q22).** 기록: 스키마·마이그레이션 변경 없음 | 기존 `events`가 `date` 컬럼이고(D254: KST 자정 변환 오류 회피), 쓰기·`/news`·홈 news·목이 모두 날짜 기준이다. 시각이 있는 모임은 내전/모집으로 만든다(내전은 시각 있음). 시각이 필요하면 nullable 컬럼 추가로 비파괴 확장 가능(Q22) |
| D284 | 읽기는 **새 엔드포인트 `GET /calendar` 1개**(멤버). 쓰기는 기존 `POST·PATCH·DELETE /admin/events…` 재사용(감사·권한 그대로) | `GET /scrims`는 상태 탭(open·playing·ended)과 커서만 있고 기간 필터가 없다 — 한 달을 그리려면 세 탭을 끝까지 넘겨야 하고(ended는 과거 전체, open은 미래 전체) 요청 수가 데이터에 비례한다. `GET /scrims`에 from·to를 더하면 탭마다 다른 정렬 의미와 섞인다. 한 번에 합친 응답이 화면 2곳(홈·관리자)에서 같다 |
| D285 | 조회 구간 = 월요일 시작 격자(그 달 1일이 든 주 월요일 ~ 말일이 든 주 일요일, 28–42일, KST). core `calendarMonthRange`. month 생략 = 오늘(KST) 달 | `/news` 이벤트 캘린더(`monthGrid`)와 같은 격자라 앞뒤 달 칸에도 값이 찬다. 범위 계산을 서버·웹·목이 한 함수로 쓴다 |
| D286 | 페이징 없음, 종류별 최대 수(내전 300, 일정 100). 넘으면 앞에서부터 자르고 `truncated.{scrims,events}` = true, 화면은 안내 + 내전 목록 링크 | 격자는 한 번에 다 그려야 한다(커서 페이징은 격자에 맞지 않음). 42일 × 하루 7건 ≈ 300이면 소규모 커뮤니티에 넉넉하다. 무한정 응답을 막는다 |
| D287 | 내전 공개 범위 = `GET /scrims`와 같다(로그인 회원 전원, 비공개 내전 없음). 항목은 `ScrimSummary` 부분집합(id·제목·게임·스팀 게임·날짜·시각·상태·정원·참가 수·join_closed·본인 my_status·result_status), **참가자 명단·방장 없음**. `cancelled` 제외, 삭제된 내전은 행이 없다 | 같은 회원이 목록에서 이미 보는 값만 낸다(개인정보 확대 없음). 캘린더 칸에는 상태·인원만 필요하다. 취소는 사용자 요청 |
| D288 | `game` 필터를 주면 그 게임 내전·일정만, **게임 무관 일정(game null)은 빠진다**. games 행 없는 코드면 items [] | `GET /events`(8-2)·`GET /scrims`와 같은 규칙. 다른 규칙을 두면 같은 칩이 화면마다 다르게 동작한다(Q25) |
| D289 | 일정 항목 = `EventView` 전체 + `kind`(설명 전문 포함, 최대 500자) | 관리자 캘린더의 수정 폼이 추가 조회 없이 값을 채운다(단건 GET이 없다). 최대 100건 × 500자라 응답 크기 문제가 없다. 화면이 칸·목록에서 잘라 보인다 |
| D290 | `items` 순서: 일정 전부(starts_on ASC, ends_on ASC, id ASC) → 내전 전부(scheduled_at ASC, id ASC). 내전 `date` = `kstDateKey(scheduled_at)` | 웹이 종류별로 나눠 그린다(일정 = 막대, 내전 = 칸 안 줄). 일정 순서가 `GET /events`와 같아 기존 `weekBars` 배치를 그대로 쓴다 |
| D291 | ~~관리자 통계 **4 → 3칸**~~ → **D306으로 다시 4칸(3칸 + 「다가오는 일정」)**. 「참가 제한 중」 제거는 유지. `AdminOverview.restricted_members`는 응답에 **남긴다**(shared·api 변경 없음) | 사용자 요청(네 번째 칸 대신 캘린더). 필드를 지우면 api·web·목·테스트를 함께 바꿔야 하고 얻는 것이 없다(쿼리 1회). 같은 정보는 멤버 탭 STATUS 열에 있다 |
| D292 | 관리자 캘린더 위치 = 결과 탭 통계 카드 **바로 아래 전체 폭**(통계 칸 안이 아님). **D309로 유지**(4번째 칸에는 목록 카드) | 월 격자(7열 × 최대 6주)는 통계 카드 한 칸(약 1/4 폭)에 들어가지 않는다. 「네 번째 칸 자리」를 문자 그대로 해석하면 격자를 읽을 수 없다(Q21) |
| D293 | 홈 캘린더 = 패널 그리드 아래 전체 폭, 읽기 전용, 요약 응답과 별도 요청. 「패치 · 이벤트」 카드는 유지 | 요약(D156 전체 캐시 금지, D196 부분 실패 규칙)에 큰 블록을 넣지 않는다 — 캘린더가 실패해도 홈은 뜬다. 카드는 패치노트·공지·앞으로 30일 요약이라 캘린더와 역할이 다르다(Q23) |
| D294 | 편집 UI는 `/admin` 캘린더에만. 홈은 운영진이어도 읽기 전용. 권한은 서버(`/admin/events` RolesGuard)가 기준 | 사용자 요청(「홈은 읽기 전용, 관리자 페이지에서 추가」). 화면 모드는 보조다(메인 기본값 5) |
| D295 | 서버 캐시 없음. 웹 쿼리 키 `['calendar', month, game|'all']`, staleTime 60초, 이벤트 쓰기·내전 상태 변경 후 `['calendar']` 무효화 | 쿼리 2–3개 + 목록 카드 조립(N+1 없음)이라 가볍고, 쓰기 직후 보여야 한다 |
| D296 | `/news` 이벤트 캘린더는 바꾸지 않는다(일정만) | 요청 범위 밖(홈·관리자). `/news`는 「정보」 화면이라 내전을 섞으면 성격이 바뀐다(Q24) |
| D297 | 캘린더 달·게임 선택은 컴포넌트 상태(URL 쿼리 아님), 기본 = 오늘 달·전체 | 홈은 쿼리를 쓰지 않고 `/admin`은 `tab`만 쓴다. 한 화면에 캘린더가 하나라 주소 공유 필요가 작다 |
| D298 | **운영진 일정 선택 시각(사용자 결정 2026-11-01 (3), Q22).** `events`에 nullable `start_time`(starts_on 날 시작)·`end_time`(ends_on 날 종료). 날짜 컬럼·의미는 그대로, 둘 다 null = 종일, `start_time`만 = 시작 시각만. `end_time`만은 불가. D283 대체 | 사용자 결정. 날짜 컬럼을 유지하면 기존 행·조회(겹침 조건·홈·캘린더 칸 배치)가 그대로 맞고 시각은 표시·정렬에만 더해진다. timestamptz 두 개로 바꾸면 날짜 조회·KST 변환·종일 표현을 모두 다시 정해야 한다 |
| D299 | 시각 = KST 벽시계 `HH:mm`(00:00–23:59, 초 없음) 문자열로 주고받고, DB `time(0) without time zone`에 **변환 없이** 저장(`1970-01-01THH:mm:00Z` Date ↔ `toISOString().slice(11,16)`) | 날짜를 KST 날짜 그대로 저장하는 D254와 같은 원칙이라 한 일정의 날짜·시각이 같은 기준이다. 커뮤니티는 KST 단일 시간대라 UTC 순간이 필요 없고, 순간이 필요한 곳(「다가오는 일정」 병합)은 core `eventStartsAt`이 `+09:00`으로 만든다. `smallint` 분 단위보다 DB에서 읽기 쉽다 |
| D300 | 검증 = shared `eventScheduleIssues`(기간 → end_time만 있음 → 같은 날 end < start 순, 같으면 허용). 생성은 zod가 전부, PATCH는 zod가 요청 안에서 판단되는 것만 + 서버가 저장값과 합쳐 같은 함수로 다시 검사(path `ends_on`·`end_time`). PATCH `start_time: null`은 종일로 바꾸기이며 저장된 `end_time`이 있으면 `end_time: null`도 함께 보내야 한다(자동으로 지우지 않음). 여러 날 일정은 시각 순서를 보지 않는다 | 서버·목·웹 폼이 같은 함수를 써 규칙이 한 곳이다. 기존 「PATCH는 합친 기간 검사」(8-1)와 같은 방식. 한 필드를 보냈는데 다른 필드가 몰래 바뀌면 감사 diff·화면 기대와 어긋난다(웹 폼은 늘 두 시각을 함께 보낸다). 「같은 시각」은 시작만 알리는 일정과 구별할 이유가 없어 허용(사용자 지시 「≥」) |
| D301 | 마이그레이션 = **새 파일 `20261101120000_s6_event_times`**(ADD COLUMN nullable 2개). `20261031230000_s6`에 합치지 않는다 | s6는 미배포지만 이미 QA가 「migrate diff stdout 일치·DROP 0건」을 확인한 파일이다. 고치면 그 확인을 다시 해야 하고, 누가 로컬 DB에 s6를 적용했으면 체크섬 불일치로 `migrate dev`가 초기화를 요구한다. 새 파일은 비파괴 1문장이라 순서·롤백 위험이 없고, 배포는 S6와 같은 커밋이라 운영 영향도 같다 |
| D302 | 일정 정렬 = `starts_on ASC, start_time ASC NULLS FIRST, ends_on ASC, id ASC` — `GET /events`·`GET /calendar`·홈 `news`·「다가오는 일정」 모두. `GET /events` 커서는 접두사 `events2`, 키 `[starts_on, start_time ?? null, ends_on, id]`(옛 `events` 커서 → VALIDATION_FAILED path cursor) | 사용자 지시(같은 날 시각순, 종일 먼저). 목록마다 순서가 다르면 `/news`와 캘린더 막대 배치가 어긋난다. PostgreSQL 기본(ASC NULLS LAST)과 반대라 명시해야 한다. S6 미배포라 옛 커서를 가진 클라이언트가 없다 |
| D303 | 홈 `news`·「다가오는 일정」의 일정 선택은 **날짜 기준 그대로**(`ends_on ≥ 오늘`). 시각으로 거르지 않는다 | 오늘 18:00에 끝난 일정이 그날 밤까지 보여도 문제가 작고, 시각 필터를 넣으면 「종일」·「시작만」·여러 날의 끝 시각 규칙을 따로 정해야 한다(Q29) |
| D304 | 시각은 EventView·`CreateEventRequest`·`UpdateEventRequest`·`CalendarEventItem`(EventView 상속)·홈 `DashboardNewsItem`(event)·감사 `event.*` details에 들어간다. 봇 응답에는 events가 없어 변경 없음. 디스코드 알림 없음 | events를 쓰는 곳 전수(shared `grep EventView`, bot.ts 0건). 감사는 「저장 값 전체」 원칙(10-2) |
| D305 | **응답 새 필드 전환 2단계 — 완료(2단계, 2026-11-01 (4), 19절 「D305 2단계 후」·23-8-6).** 1단계(지금): `EventView.start_time·end_time`, `DashboardNewsItem(event).start_time·end_time`, `AdminOverview.upcoming`을 `.optional()`로 둔다. 2단계: backend·frontend가 23-8 작업을 끝내고 보고하면 architect가 `.optional()`을 지워 필수로 바꾸고(계약 테스트 「1단계」 단언 뒤집기, dist 재빌드, `pnpm -r typecheck`), 그다음 QA. 요청 필드는 처음부터 default(null)라 전환 없음 | 지금 필수로 바꾸면 api(응답 parse 런타임 실패 → news·calendar·dashboard·admin e2e 실패)와 web(목 `eventView`·overview 타입 오류)이 구현 도중 깨진다. 최종 계약은 필수여야 서버가 빠뜨린 값을 parse가 잡는다. S6는 api·web 같은 커밋 배포라 2단계 뒤 호환 문제가 없다 |
| D306 | **「다가오는 일정」 카드(사용자 결정 Q21).** `/admin` 결과 탭 통계 4번째 칸 = 목록 카드. 데이터 = `AdminOverview.upcoming`(`AdminUpcoming`). 비교: (a) `GET /calendar?upcoming=…` 모드 → 응답 `month`·`from`·`to`·`truncated`의 뜻이 모드마다 달라지고 홈·관리자 캘린더 쿼리 키·목·테스트가 함께 흔들린다. (b) `GetCalendarResponse`에 필드 추가 → 홈 캘린더 요청까지 매번 쿼리 2개가 늘고 운영진 전용 정보가 멤버 응답에 섞인다. (c) 새 엔드포인트 → 경로·컨트롤러·훅·목·권한 테스트가 하나씩 늘어난다. (d) **overview 필드(채택)** → 새 경로·훅 없음, 통계 카드와 같은 요청·로딩·오류 상태, 운영진 전용 그대로. 비용은 overview 쿼리 2개와 무효화 대상 1개 | 변경이 가장 작다(shared 필드 1개, api 서비스 1곳, web 카드 1개·무효화 2줄). overview는 캐시가 없어(D277) 쓰기 직후 반영된다 |
| D307 | 기간·건수: 오늘(KST) ~ 오늘 + `ADMIN_UPCOMING_DAYS`(30)일, 최대 `ADMIN_UPCOMING_MAX`(5)건, `has_more`. 일정 = `ends_on ≥ 오늘 && starts_on ≤ to`(진행 중 포함, 게임 필터 없음), 내전 = `status ≠ cancelled && scheduled_at ∈ [now, (to+1) 00:00 KST)`(이미 시작 시각이 지난 내전·취소 제외) | 사용자 지시(지금부터 다가오는 것, 취소 제외, KST). 30일은 홈 news 이벤트 창(D258)과 같다. 5건은 통계 카드 한 칸 높이에 들어가는 행 수 |
| D308 | 항목 = `CalendarItem`(캘린더와 같은 모양·직렬화·공개 범위), 순서 = 시작 순 병합(core `mergeUpcomingItems`, 같은 순간이면 일정 먼저). 서버는 종류별 `take: MAX + 1`로 읽고 병합 후 자른다. 무효화: 이벤트 쓰기·내전 상태 변경 뒤 `['admin','overview']` | 캘린더 직렬화(`NewsService.eventViews`·`ScrimViews.summaries` 투영)를 그대로 재사용한다. 각 종류 앞 MAX+1개만 있으면 병합 상위 MAX개와 has_more가 정확하다 |
| D309 | 통계 아래 **전체 폭 관리자 캘린더(편집)·홈 읽기 전용 캘린더는 유지**. 4번째 칸 목록은 읽기 전용(내전 행만 링크), 일정 추가·수정은 캘린더에서 | 사용자 지시(「그대로 유지」). 해석(4번째 칸 = 목록, 전체 폭 = 편집)은 Q26으로 확인 |
| D310 | Q23·Q24·Q25 사용자 확인(2026-11-01 (3)): 홈 「패치 · 이벤트」 카드 + 캘린더 동시 노출(D293), `/news` 캘린더는 내전 미포함(D296), 게임 필터 시 게임 무관 일정 제외(D288) — **현재 계약 확정, 변경 없음** | 사용자 결정 |
| D311 | **이벤트 PATCH 동시 수정(backend 구현 기록, QA backend minor 1).** `updateEvent`는 트랜잭션 안에서 `findUnique` → 합친 값 `eventScheduleIssues` 검사 → `calendarEvent.updateMany({ where: { id, startsOn, endsOn, startTime, endTime(읽은 값) } })`. 0행이면 다시 읽어 검사부터 반복하고, `EVENT_UPDATE_ATTEMPTS`(3)번째도 0행이면 500 `INTERNAL_ERROR`(message 「이벤트 일정 동시 수정 재시도 초과」). 그사이 삭제됐으면 다시 읽기에서 404. 조건은 일정 4필드만 — 제목·설명·URL·게임 경합은 공지·패치노트처럼 마지막 쓰기가 이긴다. 감사는 쓰기가 성공한 시도에서 1번. DB CHECK·`FOR UPDATE`는 쓰지 않는다 | D300 규칙(합친 값이 규칙을 지킴)이 두 운영진 동시 PATCH에서도 깨지지 않는다. 공지·패치노트 PATCH의 조건부 updateMany 관례와 같고 잠금 순서 문제를 새로 만들지 않는다. 운영진 전용·드문 경합이라 3회 재시도로 충분하고, 그래도 실패하면 새 오류 코드 대신 기존 INTERNAL_ERROR(오류 코드 54개 유지). 새 마이그레이션(CHECK) 없음 |
| D312 | **`apps/api/src/common/list-cursor.ts` 값에 null 허용(backend 구현 기록).** 커서 값 = `string(≤200) \| int \| null`, 최대 8개. null은 nullable 정렬 키(`events2`의 `start_time`, D302)용. 다른 목록 디코더는 지금처럼 `cursorDate`·`cursorId`·`typeof` 검사로 null을 거부(400 path cursor, QA backend P2 확인). `events2` 날짜 자리는 shared `IsoDate.safeParse`로 검사(달력에 없는 날 → 400, QA backend minor 2 반영 — `news.service.ts` `isCursorDate`) | 커서 형식 하나를 공유하면서 NULLS FIRST 정렬을 커서로 이어 받으려면 null을 그대로 실어야 한다. 빈 문자열 같은 대체값은 실제 값과 겹칠 수 있다 |
| D313 | (QA web 제안 A) `upcomingRows(u: AdminUpcoming)`·`<UpcomingCard upcoming={…} />`에는 `now`가 없다. 진행 중 판정은 응답 `from`(`starts_on < from`), 내전 날짜는 응답 `date` | 구현과 계약을 맞춘다. 화면이 시계를 따로 보면 서버 창(`upcomingWindow`)과 자정 직후에 어긋날 수 있다 |
| D314 | (QA web 제안 B) 「다가오는 일정」 내전 행 링크 이름 = 「{M월 D일} {HH:mm} {제목} {칩} 상세」, **제목(끝 공백 제외)이 칩 문구로 끝나면 칩을 생략**(「화요일 저녁 5:5 내전」 → 「… 화요일 저녁 5:5 내전 상세」). 칩과 다른 단어로 끝나면 그대로 붙인다(「스팀 내전」 + 칩 「모집」 → 「스팀 내전 모집 상세」) | 계약 예(「금요 5:5 내전 상세」)를 그대로 일반화하면 시드 제목 다수에서 「내전 내전」이 된다. 칩을 제목 앞으로 옮기는 안보다 화면 행 순서(제목 → 칩)와 읽는 순서가 같다. 구현(`apps/web/src/lib/admin.ts` `upcomingRows`)·테스트와 일치 |
| D315 | (QA web 제안 C) 일정 기간·시각 검사 메시지는 **shared 메시지(서버 VALIDATION_FAILED details와 같은 값)를 그대로 두고**, 웹이 `lib/admin.ts` `eventScheduleIssueText({ path, message })`로 해요체에 매핑한다(`path\|message` 키 6개: 기간 순서·최대 기간·종료 시각만·같은 날 역순·시각 형식 2). 모르는 이슈는 shared 메시지 그대로(폴백) | shared 메시지를 바꾸면 서버 응답·계약 테스트·api e2e 기대값이 함께 흔들린다. 다른 shared 검증 메시지도 평서 명사형이고 화면 문구는 웹이 정한다(기존 errText 관례). shared 이슈에 code가 없어 path + message로 구분한다 — shared 메시지가 바뀌면 웹 매핑 테스트(`admin.test.ts`)가 잡는다 |

---

## 21. 확인 필요 (사용자 판단)

메인 기본값 1–5 반영: 1 → D254, 2 → D253, 3 → D264, 4 → D242, 5 → 5절·D263. 아래는 답이 오기 전 「현재 계약(추천안)」대로 구현한다.

| # | 질문 | 현재 계약 · 추천 | 다른 선택지 |
| --- | --- | --- | --- |
| Q1 | 되돌리기는 참가자 누구도 그 뒤에 같은 게임 내전이 반영되지 않았을 때만 된다. 활발한 서버에서는 승인 후 하루 이틀이면 막힐 수 있다 | 유지(추천, D242). 잘못된 승인은 빨리 되돌리는 것이 원칙이고, 화면이 막힌 이유를 미리 보여 준다 | 이후 경기를 승인 순서대로 다시 계산(replay): 변동·K·이후 모든 경기·다른 회원 점수가 바뀌어 감사·알림이 복잡해진다. 별도 슬라이스 필요 |
| Q2 | 되돌리기 기한 7일 | 7일(추천, 노쇼 표시 기한과 같음) | 3일 / 시즌 끝까지 / 기한 없음(이후 경기 조건만) |
| ~~Q3~~ | ~~이의 제기: 참가자만, 승인 후 3일~~ | **해소: 기능 제거(D281)** | - |
| ~~Q4~~ | ~~결과를 승인해도 open 이의 제기는 그대로 남는다~~ | **해소: 기능 제거(D281)** | - |
| Q5 | `ADMIN_DISCORD_IDS` 운영진은 웹에서 강등할 수 없다(메인 기본값 3의 정책) | 강등 불가 + 안내(추천, D264) | 웹 강등 허용 + 「다음 로그인에 다시 운영진이 돼요」 경고 / 로그인 승격을 첫 가입 때만 |
| Q6 | 자기 역할은 바꿀 수 없다(스스로 강등 불가) | 유지(추천) | 확인 대화상자 후 허용(마지막 admin은 계속 막음) |
| Q7 | 진행 중 시즌의 끝 시각은 1시간 뒤 이후로 바꿀 수 있다(시작 시각은 불가) | 허용(추천, D268) | 시작 전 시즌만 수정(슬라이스 예시) |
| Q8 | 시즌 기간 겹침을 금지한다. 운영진이 미래 시즌을 만들어 두면 공백 기간 자동 시즌은 그 시작에서 끝난다 | 유지(추천) | 겹침 허용(늦게 시작한 시즌 우선, S3 동점 규칙) |
| Q9 | 공지·패치·이벤트는 작성자가 아니어도 운영진이면 수정·삭제할 수 있다 | 유지(추천) | 작성자만 수정, 삭제는 누구나 |
| Q10 | 봇이 72시간 넘게 꺼져 있으면 그사이 공지·패치 알림은 보내지 않는다 | 유지(추천) | 기한 없음 / 24시간 |
| Q11 | 알림 설정은 「내전 시작」「새 패치」 두 개만 보인다. 「결과 승인」「대기열 참가 확정」은 발송 경로가 없어 숨긴다 | 유지(추천, D259) | 네 개 모두 보이고 두 개는 「준비 중」 표시 / 봇 알림 피드 추가(S5 Q12) |
| Q12 | 패치 알림은 게임 구분 없이 모두 보낸다(롤만 하는 회원도 롤체 패치 DM) | 유지(추천) | 회원이 연동한 게임의 패치만 / 게임별 설정 |
| Q13 | 라이엇 계정 운영진 수동 소유 승인(문서 9장 「운영진이 승인하는 방식」, S1 예약)은 이번에도 만들지 않는다 | 제외(추천, 아이콘 확인으로 충분) | S6 후속으로 추가 |
| Q14 | 회원 삭제·차단 기능이 없다. 문제 회원은 디스코드 서버에서 내보내면 순위에서 빠지고(S5) 로그인 길드 검사에 막힌다 | 유지(추천) | 웹 차단 플래그(`users.banned_at`, 로그인·참가 차단) |
| Q15 | 스팀 할인·공통 보유 게임 추천(2장 P1)은 데이터 출처가 정해지지 않아 `/news`에 없다 | 제외(추천) | 공통 보유 게임 추천만 먼저(steam_playtime 집계로 가능, 출처 문제 없음) |
| Q16 | 노쇼 저장은 바뀐 참가자마다 한 번씩 호출한다. 중간 실패 시 앞 사람은 저장된 채 멈춘다 | 유지(추천, D252) | 일괄 API(전부 또는 전무) |
| Q17 | 목업 노쇼 안내 「30일 안에 3회면 7일간 참가 제한」과 문서 7-4·env 기본 「1일」이 다르다 | 화면은 서버 정책값으로 표시(추천, 현재 1일) | env `SCRIM_NO_SHOW_RESTRICTION_DAYS=7`로 운영 |
| Q18 | 감사 로그를 지우거나 보존 기간을 두지 않는다 | 유지(추천) | 1년 보존 후 정리 작업 |
| Q19 | (D281 후속) 쓰지 않는 `scrim_result_disputes` 표·`dispute_status` enum을 나중에 DROP할까 | 남김(추천, 비용 없음·되돌릴 수 없는 변경 회피) | 다음 슬라이스에서 DROP 마이그레이션 |
| ~~Q20~~ | ~~관리자 통계 4번째 칸을 「이번 주 내전」으로 채운다~~ | **해소(2026-11-01 사용자 요청):** 통계는 승인 대기 · 이번 주 내전 · 이번 달 노쇼 3칸, 「참가 제한 중」 대신 캘린더(D291) | - |
| ~~Q21~~ | ~~「통계 네 번째 칸에 캘린더」를 통계 카드 바로 아래 전체 폭 캘린더로 해석했다~~ | **해소(2026-11-01 (3) 사용자 결정):** 4번째 칸 = 「다가오는 일정」 목록 카드(D306–D308), 전체 폭 캘린더 유지(D309). 해석 확인은 Q26 | - |
| ~~Q22~~ | ~~운영진 일정은 날짜만 있다~~ | **해소(사용자 결정):** nullable 시작·종료 시각 추가(D298–D305) | - |
| ~~Q23~~ | ~~홈에 「패치 · 이벤트」 카드와 캘린더가 둘 다 있다~~ | **해소(사용자 확인, 변경 없음):** 둘 다 유지(D293, D310) | - |
| ~~Q24~~ | ~~`/news` 이벤트 캘린더는 내전 없이 일정만~~ | **해소(사용자 확인, 변경 없음):** 유지(D296, D310) | - |
| ~~Q25~~ | ~~게임 필터 시 게임 무관 일정은 사라진다~~ | **해소(사용자 확인, 변경 없음):** 유지(D288, D310) | - |
| Q26 | 「4번째 칸에 다가오는 일정, 아래 전체 폭 캘린더는 그대로」를 **두 개 모두 둔다**로 해석했다: 4번째 칸 = 앞으로 30일 최대 5건 목록(보기·내전 링크), 아래 전체 폭 캘린더 = 한 달 격자 + 일정 추가·수정·삭제 | 둘 다(추천, D309 — 목록은 한눈에 다음 일정, 격자는 편집). **상태(2026-11-01 (4)): 추천안대로 구현·QA pass, 사용자 답 대기** | 전체 폭 캘린더를 빼고 목록 카드에 「+ 일정 추가」 / 목록 카드를 누르면 캘린더로 스크롤만 |
| Q27 | 「다가오는 일정」은 오늘부터 30일, 최대 5건. 이미 시작 시각이 지난 내전(진행 중)은 빠지고, 여러 날 일정은 끝날까지 「진행 중」으로 남는다 | 유지(추천, D307). **상태(2026-11-01 (4)): 추천안대로 구현·QA pass(경계 테스트 있음), 사용자 답 대기** | 7일 / 10건 / 진행 중 내전(playing)도 포함 |
| Q28 | 캘린더 날짜 상세 목록·모바일 목록은 그 날 **일정 전부 → 내전 전부** 순서다(시각이 있어도 섞지 않는다). 21:00 일정이 19:00 내전보다 위에 보인다 | 유지(추천, D290 — 종류별 모양이 다르고 지금 구현을 흔들지 않는다). **상태(2026-11-01 (4)): 추천안대로 구현·QA pass, 사용자 답 대기** | 그 날 항목을 시각순으로 섞기(종일 일정 맨 위) |
| Q29 | 홈 「패치 · 이벤트」·「다가오는 일정」은 날짜 기준이라 오늘 18:00에 끝난 일정도 오늘 자정까지 보인다 | 유지(추천, D303). **상태(2026-11-01 (4)): 추천안대로 구현·QA pass, 사용자 답 대기** | 종료 시각(없으면 시작 시각)이 지난 오늘 일정은 빼기 |
| Q30 | (QA web 제안 D) 홈 캘린더는 `Dashboard` 안(요약 성공 뒤)에 그려져서, `GET /dashboard/summary`가 실패하면 따로 부르는 `GET /calendar`가 정상이어도 캘린더가 안 보인다 | **변경 없음(현재 구현 유지, 23-6·23-7 배치 그대로).** 요약 실패는 홈 전체 오류 상태라 드물고, 바꾸면 홈 레이아웃·로딩 순서가 함께 바뀐다 | 캘린더를 `Dashboard` 밖으로 옮겨 요약 성공 여부와 상관없이 그리기(D293 「서로 영향 없음」 취지에 더 맞음, web `home-view.tsx`만 변경) |

### 명세 문서 갱신 필요(사용자 확인 후)

- 5장 표: `patch_notes`, `events`, `admin_audit_logs` 추가. `scrim_results.status`에 reverted, `reverted_by`·`reverted_at`.
- 6장 웹 API 표: `/notices`, `/me/notification-settings`, `/scrims/{id}/result/revert`, `/admin/*` 묶음 한 줄.
- 2장 운영 「결과 분쟁 처리」: 「운영진이 승인 대기 결과는 반려, 승인된 결과는 되돌리기로 처리한다(참가자 이의 제기 접수 기능 없음, D281)」. 봇 표: `/bot/notices/*`, `/bot/patch-notes/*`.
- 7-1: 「승인 후 7일 안, 참가자의 다음 경기가 반영되기 전이면 운영진이 승인을 되돌릴 수 있다(레이팅은 승인 전 값으로). 그 뒤에는 되돌릴 수 없다」.
- 8장 `/admin`: 탭 구성, `/news`: 스팀 할인 제외.
- 2장 운영 「관리자 도구」·8장 `/`·`/admin`: **커뮤니티 캘린더** — 홈(읽기 전용)·`/admin` 결과 탭(운영진 일정 추가·수정·삭제) 한 달 격자, 내전(취소 제외) + 운영진 일정, 모바일 목록형(23절). `/admin` 통계 4칸 = 승인 대기 · 이번 주 내전 · 이번 달 노쇼 + 「다가오는 일정」(오늘부터 30일, 최대 5건, D306–D309).
- 6장 웹 API 표: `GET /calendar`(month `YYYY-MM`, game, 멤버 JWT, 23-2). `GET /admin/overview` 응답에 `upcoming`(`AdminOverview.upcoming`: from·to·items(캘린더 항목)·has_more, 23-8-4).
- 5장 `events` 표: `start_time`·`end_time` `time(0) NULL`(KST 벽시계 `HH:mm`, 둘 다 null = 종일, 종료 시각은 시작 시각이 있을 때만, 같은 날이면 종료 ≥ 시작, D298–D300). 일정 정렬 `starts_on, start_time NULLS FIRST, ends_on, id`(D302).
- 운영 규칙: 일정 시각은 KST 기준이고, 홈 「패치 · 이벤트」·「다가오는 일정」은 날짜 기준으로 보인다(D303, Q29).

---

## 22. 기존 계약 참조 요약 (구현자용)

| 필요한 것 | 위치 |
| --- | --- |
| 승인 흐름·잠금·now 규칙 | `_workspace/S3/01_architect_contract.md` 5-5, `_workspace/S4/01_architect_contract.md` 6-2·15절, `apps/api/src/modules/scrims/scrim-results.service.ts` |
| 시즌 판정·자동 생성·종료 작업 | S3 6절, S4 6-3, `apps/api/src/modules/ratings/seasons.service.ts`, `rating-locks.ts`, core `season.ts` |
| 노쇼 규칙 | S2 5-6·7절, core `no-show.ts` |
| 봇 가드·키 형식·BotUserRef | `_workspace/S5/01_architect_contract.md` 6-1, `apps/api/src/common/api-key.ts`, `modules/bot/bot-user-ref.ts` |
| scrim_count 정의 | S5 D239, `modules/rankings` 활동 집계 SQL |
| 요약 부분 실패 | S4 21절 |

---

## 23. 커뮤니티 캘린더 (S6 후속, 2026-11-01 사용자 요청, D282–D297 · 사용자 결정 반영 23-8, D298–D315)

요청: 「관리자 통계의 네 번째 칸에 다른 지표 대신 캘린더를 추가하고 싶다. 캘린더는 내전 등의 일정이 보이고, 관리자만 일정을 추가할 수 있다. 이 캘린더를 홈에도 동일하게 추가하되 홈 캘린더는 읽기 전용, 관리자 페이지 캘린더는 관리자가 일정을 추가한다.」 목업 없음 → `/news` 이벤트 캘린더(13절)의 격자·막대 모양과 토큰을 그대로 쓴다.

### 23-1. 범위

| 포함 | 제외 |
| --- | --- |
| 읽기 API `GET /calendar`(멤버, 내전 + 운영진 일정) | 새 표(D282). ~~마이그레이션(D283)~~ → 시각 컬럼 마이그레이션 1개(23-8, D301) |
| `/admin` 결과 탭: 통계 ~~3칸~~ 4칸(3 + 「다가오는 일정」, 23-8-5) + 전체 폭 관리자 캘린더(일정 추가·수정·삭제) | 캘린더에서 내전 만들기·수정(내전은 읽기 전용 + 상세 링크) |
| 홈: 같은 캘린더 읽기 전용 | `/news` 이벤트 캘린더 변경(D296) |
| 일정 쓰기 = 기존 `/admin/events…`(감사 `event.*`, RolesGuard) | 새 쓰기 엔드포인트·오류 코드·감사 action |
| core `calendarMonthRange`·`resolveCalendarMonth`(14-7), 일정 선택 시각·「다가오는 일정」(23-8) | 디스코드 알림 |

### 23-2. `GET /calendar` (`ApiPath.calendar`, JWT 멤버 전원)

Request `GetCalendarQuery`: `month?`(`CalendarMonth` 'YYYY-MM', 2000–2099), `game?`(`GameCode`). 형식 오류 → 400 VALIDATION_FAILED. 페이징 없음.

Response `GetCalendarResponse`:

| 필드 | 값 |
| --- | --- |
| month | 적용한 달(생략 시 오늘 KST 달, `resolveCalendarMonth`) |
| from, to | `calendarMonthRange(month)`의 격자 첫날(월)·끝날(일) |
| items | `CalendarItem[]` — 일정 전부(starts_on ASC, **start_time ASC NULLS FIRST**, ends_on ASC, id ASC — D302) 다음 내전 전부(scheduled_at ASC, id ASC)(D290) |
| truncated | `{ scrims, events }` — 종류별로 `CALENDAR_SCRIMS_MAX`(300)·`CALENDAR_EVENTS_MAX`(100)를 넘어 잘렸는가(D286) |

항목 두 종류(`kind`로 구분):

| kind | 조건 | 필드 |
| --- | --- | --- |
| `event` | `events.starts_on ≤ to && ends_on ≥ from`, game 필터 시 그 게임만(game null 제외, D288) | `EventView` 전체 + `kind`(D289). 2026-11-01 (3): `start_time`·`end_time` 포함(EventView 상속, D298) |
| `scrim` | `scheduled_at ∈ [fromAt, toBefore)`, `status ≠ cancelled`, game 필터 시 그 게임만 | `id, title, game, steam_app, date(= kstDateKey(scheduled_at)), scheduled_at, status(cancelled 제외 4종), capacity, joined_count, join_closed, my_status(요청자 본인), result_status` — 값은 같은 요청자의 `ScrimSummary`와 같다(D287) |

- games 행이 없는 game 코드 → `items: []`, `truncated` 둘 다 false(오류 아님).
- 오류 코드: VALIDATION_FAILED만(+ 공통 401). 봇 키로는 401(JWT 전용).
- 예시: `GET /api/v1/calendar?month=2026-11` → `{"month":"2026-11","from":"2026-10-26","to":"2026-12-06","items":[{"kind":"event","id":"…","game":null,"title":"11월 정기 내전의 날","description":"…","url":null,"starts_on":"2026-11-08","ends_on":"2026-11-08","start_time":"21:00","end_time":null,"created_at":"…","updated_at":"…"},{"kind":"scrim","id":"…","title":"금요 5:5","game":{…},"steam_app":null,"date":"2026-11-06","scheduled_at":"2026-11-06T12:00:00.000Z","status":"recruiting","capacity":10,"joined_count":7,"join_closed":false,"my_status":null,"result_status":null}],"truncated":{"scrims":false,"events":false}}`

### 23-3. 서버 처리 (backend)

1. `now = clock.now()` → `month = resolveCalendarMonth(q.month, now)` → `r = calendarMonthRange(month)`.
2. `q.game`이 있으면 `game.findUnique({ code })`, 없으면 빈 응답.
3. 일정: `calendarEvent.findMany({ where: { startsOn: { lte: date(r.to) }, endsOn: { gte: date(r.from) }, gameId? }, orderBy: EVENT_ORDER_BY(23-8-3: [startsOn asc, startTime asc nulls first, endsOn asc, id asc]), take: CALENDAR_EVENTS_MAX + 1 })` → 앞 MAX개 `NewsService.eventViews(rows)` → `kind: 'event'`. 날짜 변환은 8-1 규칙(`new Date('YYYY-MM-DDT00:00:00.000Z')`).
4. 내전: `scrim.findMany({ where: { status: { in: ['recruiting','full','playing','finished'] }, scheduledAt: { gte: r.fromAt, lt: r.toBefore }, gameId? }, orderBy: [scheduledAt asc, id asc], take: CALENDAR_SCRIMS_MAX + 1 })` → 앞 MAX개 `ScrimViews.summaries(page, viewer, now)`(목록과 같은 조립, N+1 없음) → 필드 투영 + `date = kstDateKey(scheduledAt)`.
5. `GetCalendarResponse.parse(...)`(D38). 트랜잭션 불필요(읽기, 두 목록의 순간 불일치 허용). 캐시 없음(D295).
6. 인덱스: 내전 `(status, scheduled_at)`·`(game_id, status, scheduled_at)`, 일정 `(starts_on, ends_on)` 기존 인덱스로 충분(새 인덱스 없음).

### 23-4. 쓰기 (기존 그대로)

| 화면 동작 | 엔드포인트 | 비고 |
| --- | --- | --- |
| 날짜 칸 「+」 / 「일정 추가」 | `POST /admin/events` `CreateEventRequest` | starts_on = ends_on = 누른 날짜로 폼을 채운다. 과거 날짜도 허용(기존 규칙) |
| 일정 막대·행 → 수정 | `PATCH /admin/events/:id` `UpdateEventRequest` | 폼 초기값 = 응답 항목(EventView) |
| 수정 대화상자 「삭제」 | `DELETE /admin/events/:id` | 확인 대화상자(기존 `DeleteDialog`) |

감사 `event.create|update|delete`, 오류(VALIDATION_FAILED path `ends_on`·`game`, NOT_FOUND, FORBIDDEN) 모두 8-1·10-2 그대로. 비운영진 403은 RolesGuard가 먼저.

### 23-5. 권한

5절 표의 캘린더 2행 + 「캘린더의 내전 항목 쓰기」 행. 공개 범위 확인(2026-11-01): `scrims`에 공개 여부·비밀번호·초대 컬럼이 없고 `GET /scrims`는 로그인 회원 전원에게 모든 상태를 보인다 → 캘린더가 새로 드러내는 정보 없음. 참가자 명단·방장·노쇼는 캘린더 응답에 없다.

### 23-6. 화면 (frontend, 목업 없음)

공용 컴포넌트 `components/calendar/community-calendar.tsx` `CommunityCalendar({ mode: 'read' | 'admin', onToast? })` 하나를 홈·관리자가 쓴다.

- 카드 머리: eyebrow 「CALENDAR」, 제목 「일정」, 오른쪽 = read 모드에서 운영진이면 「관리 →」(`routes.admin()`), admin 모드면 「+ 일정 추가」 버튼(오늘 날짜로 폼).
- 조작 줄: ‹ 이전 달 · 「2026년 11월」 · 다음 달 › · 「오늘」(이번 달이면 비활성) + 게임 필터 칩(전체 + 게임 목록, `/news`와 같은 라벨). 상태는 컴포넌트 state(D297). 범례: 「■ 일정」「● 내전/모집」.
- 데스크톱(md+) 월 격자: `/news` 격자 그대로(월요일 시작 7열, 오늘 원형 강조, 다른 달 날짜 흐리게, 토·일 머리 주황). 일정은 `weekBars`로 막대(게임 색 타일, 게임 무관은 chip 색), 막대 아래 그 날 내전을 최대 3줄 `HH:mm 게임약칭 제목`(상태 점 색 = `scrimCardBadge` tone, 내 참가 `my_status`면 굵게), 넘치면 「+N개」. 내전 줄은 `Link` → `routes.scrim(id)`.
- 날짜 칸 선택: 칸을 누르면(read·admin 공통) 격자 아래 「11월 6일 (금)」 상세 목록(그 날 일정 → 내전 순, 내전 행 = 시각·게임·제목·상태 배지·`joined_count/capacity`·상세 링크, 일정 행 = `/news` `EventDetail`과 같은 모양). admin 모드는 상세 목록 머리에 「+ 이 날 일정 추가」, 일정 행에 「수정」.
- admin 모드 일정 대화상자: 네이티브 `<dialog>`(scrim-edit-dialog 패턴) 안에 `admin-news.tsx`의 `EventForm`(export, `today` prop에 누른 날짜) — 수정이면 아래에 「삭제」(DeleteDialog). 성공 토스트 「일정을 추가했어요 / 고쳤어요 / 삭제했어요」. 실패는 기존 `errText`.
- 모바일(md 미만) 목록형: 그 달 날짜 중 항목이 있는 날만 날짜 머리(「11.06 금」, 오늘이면 「오늘」 배지) + 행. 지난 날짜(그 달이 이번 달일 때 오늘 이전)는 「지난 일정 N개 보기」로 접는다. 항목 없으면 EmptyState 「이 달에 등록된 일정이 없어요」. admin 모드는 머리 「+ 일정 추가」와 일정 행 「수정」.
- `truncated.scrims || truncated.events` → 격자 위 안내 「일정이 많아 일부만 보여요 · 내전 목록에서 전체 보기」(`routes.scrims()`).
- 로딩 Skeleton(h-[420px]), 오류 ErrorState + 다시 시도(카드 안에서만 — 홈·관리자 다른 블록에 영향 없음). 접근성: 격자 `role="table"`·칸 aria-label 「11월 6일 일정 1개, 내전 2개」, admin 모드 칸 추가 버튼 aria-label 「11월 6일에 일정 추가」.
- 배치: `/admin` 결과 탭 = 통계 ~~3칸~~ **4칸(3 + 「다가오는 일정」, 23-8-5)** → **캘린더** → APPROVAL QUEUE → NO-SHOW(D292·D309). 홈 = 패널 그리드 아래 전체 폭(D293).

### 23-7. 담당 배정과 실행 순서

```
architect(완료: shared calendar.ts·paths·계약 테스트·dist)
  ├─ logic: core 14-7 (먼저, 작음) ──┐
  ├─ backend: 23-3 (14-7 시그니처로 시작) ─┼─ 전체 테스트 → qa
  └─ frontend: 23-6 (목 백엔드로 시작) ─────┘
```

셋 다 바로 시작한다. backend·frontend는 core 함수가 나오기 전 14-7 시그니처로 import하고 테스트는 core 완료 뒤 돌린다.

#### logic (domain-logic-dev) — `packages/core/src/**`

| 파일 | 작업 |
| --- | --- |
| `src/calendar.ts`(새) | `calendarMonthRange`, `resolveCalendarMonth`(14-7). 날짜 계산은 `news.ts`의 `parseIsoDate`·`addIsoDays` 방식(필요하면 news.ts에서 export하지 말고 같은 방식으로 작성), KST 오프셋은 core `config.ts`의 `KST_OFFSET_MS`(정정 2026-11-01 (4)) |
| `src/calendar.test.ts`(새) | 14-7 테스트 필수 전부 |
| `src/index.ts:145` 다음 | `export { calendarMonthRange, resolveCalendarMonth } from './calendar';`, 머리 주석 S6 줄에 「커뮤니티 캘린더 구간(calendar.ts)」 |
| dist | 재빌드. 보고서 `_workspace/02_domain-logic-dev_report.md`에 절 추가 |

#### backend (backend-dev) — `apps/api/**`

순서: ① 모듈·컨트롤러 ② 서비스 ③ 테스트.

| 파일:줄 | 작업 |
| --- | --- |
| `src/modules/calendar/calendar.module.ts`(새) | `imports: [ScrimsModule.forRoot(), NewsModule]`, `controllers: [CalendarController]`, `providers: [CalendarService, JwtGuard]`(news.module.ts 패턴) |
| `src/modules/calendar/calendar.controller.ts`(새) | `@Controller() @UseGuards(JwtGuard)`, `@Get(ApiPath.calendar)` `@Query(new ZodValidationPipe(GetCalendarQuery))` → `CalendarService.get(user, q)` |
| `src/modules/calendar/calendar.service.ts`(새) | 23-3 1–5단계. `ScrimViews.summaries`(scrims.module exports 46줄에 이미 있음), `NewsService.eventViews`(news.service.ts:112, news.module exports에 이미 있음), `APP_CLOCK` |
| `src/app.module.ts:45` 다음 | `CalendarModule` import·등록 |
| `test/calendar.e2e.spec.ts`(새) | 아래 테스트 |
| `test/support/fake-prisma.ts` | `calendarEvent.findMany`의 `startsOn lte`·`endsOn gte`·`take`, `scrim.findMany`의 `status in`·`scheduledAt gte/lt` 지원이 없으면 추가(news·scrims 테스트가 이미 쓰는 것과 같으면 변경 없음) |

테스트(FakePrisma, DB 없이):
- 권한: 비로그인 401, 봇 키 401, 멤버 200, 운영진 200(같은 모양). 멤버 `POST /admin/events` 403은 기존 테스트 — 캘린더 테스트에서 「운영진이 POST /admin/events 후 GET /calendar에 나온다」「PATCH 후 바뀐 값」「DELETE 후 사라진다」 왕복 1개씩.
- 구간: month 생략 + 시계 2026-10-31T15:00Z → month '2026-11', from '2026-10-26', to '2026-12-06'. KST 경계: scheduled_at 2026-10-25T15:00:00.000Z 포함(date '2026-10-26'), 14:59:59.999Z 제외, 2026-12-06T14:59:59.999Z 포함, 15:00Z 제외. 일정 겹침: 10-20~10-26 포함, 10-20~10-25 제외, 12-06~12-10 포함.
- 상태: cancelled 제외, recruiting·full·playing·finished 포함. 값이 같은 요청자의 `GET /scrims` 카드와 같음(joined_count·join_closed·my_status·result_status). 응답 JSON에 `host`·`players` 없음, 다른 회원의 참가 상태 없음.
- game 필터: 그 게임 내전·일정만, game null 일정 제외. 잘못된 month 400(path month), 모르는 게임 400.
- 순서: 일정 → 내전, 각 정렬 키. 한도: 내전 301개 → 300개 + truncated.scrims true, 일정 101개 → 100개 + truncated.events true, 정확히 300·100이면 false.
- 보고서 `_workspace/02_backend-dev_s6_calendar.md`.

#### frontend (frontend-dev) — `apps/web/**`

| 파일:줄 | 작업 |
| --- | --- |
| `src/lib/admin.ts:69-71` | `OverviewCard.key`에서 `'restricted'` 삭제 |
| `src/lib/admin.ts:79-117` | 주석 「통계 3칸(D291)」, 네 번째 카드(`restricted`, 107-114) 삭제 |
| `src/lib/admin.test.ts:51-57` | 값 기대 `[2, 4, 3]`, `c[3]` 단언(56) 삭제, 「참가 제한 중」 칸이 없다는 단언 추가 |
| `src/components/admin/admin-results.tsx:46-56` | 주석 「통계 3칸 + 캘린더 + APPROVAL QUEUE + NO-SHOW」, `<StatsGrid />` 다음에 `<CommunityCalendar mode="admin" onToast={onToast} />` |
| 같은 파일 `:61-100` | 「통계 4칸」 주석 → 3칸, 69·78줄 `xl:grid-cols-4` → `md:grid-cols-3`(모바일 2열 + 세 번째 `col-span-2 md:col-span-1`), 70줄 스켈레톤 `[0, 1, 2]` |
| `src/components/admin/admin-news.tsx:91, 233, 478` | `DeleteDialog`·`useGameOptions`(EventForm이 쓰면)·`EventForm` export(동작 변경 없음). 필요하면 `EventForm`에 `onSaved?` 콜백만 추가 |
| `src/components/home/home-view.tsx:95-112` | 그리드 div(102-109) 다음에 `<CommunityCalendar mode="read" />`, 머리 주석(43) 「S6 후속: 커뮤니티 캘린더(읽기 전용)」 |
| `src/lib/api/calendar.ts`(새) | `getCalendar({ month?, game? }, signal)` → `GetCalendarResponse` parse(`lib/api/news.ts` query 패턴) |
| `src/lib/hooks/calendar.ts`(새) | `calendarKeys = { all: ['calendar'], month: (m, g) => ['calendar', m, g ?? 'all'] }`, `useCalendar({ month, game })` staleTime 60초·keepPreviousData·4xx 재시도 없음(hooks/news.ts 패턴) |
| `src/lib/calendar.ts`(새) + `calendar.test.ts` | 순수 함수: `splitCalendarItems(items)` → `{ events, scrims }`, `scrimsOn(date, scrims)`, `dayCellScrims(scrims, max = 3)` → `{ shown, more }`, `calendarDayLabel(date)`(「11월 6일 (금)」), `mobileCalendarDays(items, month, today)` → 날짜별 묶음 + 지난 날짜 수, 칸 aria-label 문구. `weekBars`·`eventsOn`(lib/news.ts)은 `CalendarEventItem`이 `EventView` 호환이라 그대로 쓴다. 테스트: 여러 날 일정이 주 경계에서 잘림, 내전 KST 날짜(15:00Z 경계), 「+N개」, 모바일 지난 일정 접기, **`monthGrid(month)`의 from·to = core `calendarMonthRange(month)`의 from·to**(2026-11, 2027-02, 2026-12) |
| `src/components/calendar/community-calendar.tsx`(새) | 23-6 전부. `/news`의 `Calendar`·`EventDetail`과 모양을 맞춘다(필요하면 `EventDetail`을 export해 재사용) |
| `src/lib/hooks/admin.ts:88-95, 97-101` | `invalidateAfterResultChange`·`invalidateAfterNewsWrite`에 `calendarKeys.all` 무효화 추가 |
| `src/lib/hooks/scrims.ts:153-158, 174-180, 262-271` | `applyScrimDetail`·`handleScrimMutationError`(403·404·409 분기)·`useDeleteScrim` onSuccess에 `calendarKeys.all` 무효화 추가(작성·참가·시작·취소·결과는 applyScrimDetail을 거친다) |
| `src/lib/api/mock/admin.ts:510-513` | `S6_EXACT`에 `ApiPath.calendar` |
| 같은 파일 `:483-500`(MockS6Context) | `summary: (scrimId: string) => ScrimSummary` 추가 |
| 같은 파일 `:616` 부근(GET events 다음) | `GET ApiPath.calendar`: `GetCalendarQuery` safeParse(실패 400), core `resolveCalendarMonth`·`calendarMonthRange`, `st.events` 겹침·game 필터 → `eventOrder` → `eventView` + kind, `st.scrims` cancelled 제외·KST 구간 → scheduled_at·id 정렬 → `ctx.summary(id)` 투영, 한도·truncated, `empty` 시나리오면 items [] |
| `src/lib/api/mock/scrims.ts:1127-1150` | handleS6 호출에 `summary: (id) => summary(state.scrims.find((x) => x.id === id)!)` |
| `src/lib/api/mock/admin.test.ts` | 목 캘린더: 일정·내전 합침, 취소 제외, game 필터(game null 제외), 운영진 이벤트 추가 후 캘린더에 나옴, 응답 shared parse 통과 |
| 컴포넌트 테스트(있는 패턴이면) | read 모드에 추가 버튼·수정 없음(운영진이어도), admin 모드 날짜 칸 → 폼 날짜 채움, 내전 줄 링크 = `/scrims/{id}`, 외부 링크 rel |

`/news`(news-view.tsx)는 바꾸지 않는다(D296). 보고서 `_workspace/02_frontend-dev_s6_calendar.md`(목업 없음 명시).

#### qa (qa-verifier)

- `ApiPath.calendar` ↔ 컨트롤러 1개, 웹 훅 1개. 엔드포인트 합계 33.
- 권한 5절 캘린더 3행마다 테스트(401·봇 401·멤버/운영진 200, 쓰기 403은 기존 테스트 참조).
- 23-2 구간·KST 경계·취소 제외·한도·순서, 응답에 명단·방장 없음(D287).
- 화면: ~~`/admin` 통계 3칸~~ → 23-8-7(4칸 + 「다가오는 일정」), 캘린더 위치, 홈 읽기 전용(운영진 계정으로도 편집 UI 없음), 모바일 목록형, 「패치 · 이벤트」 카드 유지, `/news` 회귀 없음.
- ~~스키마 변경 없음 확인~~ → 2026-11-01 (3)부터 마이그레이션 `20261101120000_s6_event_times` 1개(23-8-7).

### 23-8. 사용자 결정 반영 (2026-11-01 (3), D298–D310 · 2단계 전환·QA 반영 2026-11-01 (4), D311–D315)

결정: (1) Q21 → `/admin` 결과 탭 통계 4번째 칸 = 「다가오는 일정」 목록 카드, 통계 하단 전체 폭 캘린더는 유지. (2) Q22 → 운영진 일정에 시각(nullable 시작·종료 시각). (3) Q23·Q24·Q25 → 변경 없음(해소, D310).

**구현 중인 코드를 덜 흔드는 원칙:** 엔드포인트·경로·쿼리 키 추가 없음, `GET /calendar` 쿼리·응답 모양 그대로(일정 항목에 필드 2개만 늘어난다), core `calendar.ts` 기존 2함수 불변(새 함수 4개는 추가만), 웹 `CommunityCalendar`·`lib/calendar.ts` 구조 그대로(표시 문구·폼 입력칸만), 응답 새 필드는 1단계 optional(D305, **2026-11-01 (4) 2단계 완료 → 필수**). architect 반영 시점에 `pnpm -r typecheck` 4개 Done, api(news·admin·calendar·dashboard e2e 7파일 64개)·web(admin·news·calendar·mock admin 4파일 60개) 테스트 통과 — **지금 깨진 곳 없음**.

#### 23-8-1. 스키마 (architect 완료)

`events.start_time`·`end_time` `time(0) NULL`(Prisma `startTime`·`endTime DateTime? @db.Time(0)`), 마이그레이션 `20261101120000_s6_event_times`(3절). 날짜 컬럼 유지, 기존 행 = 종일.

#### 23-8-2. 일정 시각 계약 (shared `news.ts`, architect 완료)

| 항목 | 규칙 |
| --- | --- |
| 형식 `EventTime` | `HH:mm`, 00:00–23:59(`24:00`·초·한 자리 시 불가). KST 벽시계 값(D299) |
| 의미 | `start_time` = `starts_on` 날 시작, `end_time` = `ends_on` 날 종료. 둘 다 null = 종일. `start_time`만 = 시작만 알림. `end_time`만 = 불가 |
| `CreateEventRequest` | `start_time?`·`end_time?`(생략·null = null). 전체 검사 `eventScheduleIssues` |
| `UpdateEventRequest` | `start_time?`·`end_time?`(생략 = 그대로, null = 비우기). zod는 요청 안에서 판단되는 것만(둘 다 날짜·시각이 있을 때 순서, `start_time: null` + `end_time` 값). 서버는 합친 값을 `eventScheduleIssues`로 다시 검사(D300). 동시 PATCH = 읽은 일정 4값을 조건으로 한 `updateMany`, 0행이면 다시 읽어 재검사, 3번 모두 0행이면 500 INTERNAL_ERROR(D311) |
| `eventScheduleIssues(v)` | ① 기간: `ends_on < starts_on` → `ends_on`, `> EVENT_SPAN_MAX_DAYS` → `ends_on`(있으면 여기서 끝) ② `end_time` 있음 && `start_time` null → `end_time` 「종료 시각은 시작 시각이 있을 때만」 ③ `starts_on = ends_on` && 둘 다 값 && `end_time < start_time` → `end_time` 「종료 시각은 시작 시각 이후」(같으면 허용). 여러 날은 순서 검사 없음 |
| PATCH 예 | 저장 11-08 21:00–23:00. `{start_time: '23:30'}` → 합친 값 역순 → 400 path end_time. `{start_time: null}` → end_time만 남음 → 400 path end_time(`{start_time: null, end_time: null}`로 보내야 함). `{ends_on: '2026-11-09', start_time: '23:30'}` → 통과(여러 날) |
| 응답 | `EventView.start_time·end_time`(`HH:mm \| null`), `CalendarEventItem`(상속), `DashboardNewsItem`(event) `start_time·end_time`. **필수(키 항상 있음, 값 nullable) — D305 2단계 완료(2026-11-01 (4))** |
| 감사 | `event.create` details에 `start_time`·`end_time`, `event.update` diff 대상에 두 필드, `event.delete` 스냅샷에 두 필드(10-2) |
| 봇 | events를 싣는 봇 응답 없음 → 변경 없음(D304) |

#### 23-8-3. 정렬과 `GET /events` 커서 (D302)

모든 일정 목록: `orderBy: [{ startsOn: 'asc' }, { startTime: { sort: 'asc', nulls: 'first' } }, { endsOn: 'asc' }, { id: 'asc' }]`(Prisma 6.19 지원). backend는 상수 `EVENT_ORDER_BY`(news.service.ts export) 하나를 news·calendar·dashboard·upcoming이 함께 쓴다.

`GET /events` 커서: 접두사 `EVENT_CURSOR = 'events2'`, 값 `[starts_on, start_time | null, ends_on, id]`(4개). 다음 페이지 조건(so·eo = toDbDate, T = toDbTime):

- 커서 `start_time` null: `OR [{ startsOn > so }, { startsOn: so, startTime: { not: null } }, { startsOn: so, startTime: null, endsOn > eo }, { startsOn: so, startTime: null, endsOn: eo, id > id }]`
- 커서 `start_time` 값: `OR [{ startsOn > so }, { startsOn: so, startTime > T }, { startsOn: so, startTime: T, endsOn > eo }, { startsOn: so, startTime: T, endsOn: eo, id > id }]`
- 형식 오류(개수 ≠ 4, 날짜·시각 형식 — 날짜는 shared `IsoDate`로 달력에 있는 날까지, 옛 `events` 접두사) → VALIDATION_FAILED path cursor(기존 `invalidCursor()`).
- 커서 값의 null(`start_time` 자리)은 `common/list-cursor.ts`가 허용한다(값 = 문자열·정수·null). 다른 목록 디코더는 null을 계속 거부한다(D312).

화면은 서버 순서를 그대로 쓴다(`weekBars` 탐욕 배치 입력 순서 = 이 순서). 캘린더 날짜 상세·모바일 목록의 「일정 → 내전」 순서는 그대로(D290, Q28).

#### 23-8-4. 「다가오는 일정」 데이터 `AdminOverview.upcoming` (shared `admin.ts`, architect 완료 · 필수, D305 2단계)

`AdminUpcoming { from: IsoDate, to: IsoDate, items: CalendarItem[] (≤ ADMIN_UPCOMING_MAX = 5), has_more: boolean }`. 상수 `ADMIN_UPCOMING_DAYS = 30`.

서버 처리(backend, `CalendarService.upcoming(viewer, now)`):

1. `w = upcomingWindow(now, ADMIN_UPCOMING_DAYS)`(core).
2. 일정: `calendarEvent.findMany({ where: { endsOn: { gte: toDbDate(w.from) }, startsOn: { lte: toDbDate(w.to) } }, orderBy: EVENT_ORDER_BY, take: ADMIN_UPCOMING_MAX + 1 })` → `news.eventViews` → `kind: 'event'`. 게임 필터 없음(게임 무관 일정 포함).
3. 내전: `scrim.findMany({ where: { status: { in: CALENDAR_SCRIM_STATUSES }, scheduledAt: { gte: now, lt: w.scrimBefore } }, orderBy: [scheduledAt asc, id asc], take: ADMIN_UPCOMING_MAX + 1 })` → `views.summaries(rows, viewer, now)` → 캘린더와 같은 투영(`toCalendarScrimItem`으로 추출해 `get`과 공유).
4. `{ items, hasMore } = mergeUpcomingItems(events, scrims, ADMIN_UPCOMING_MAX)`(core) → `{ from: w.from, to: w.to, items, has_more: hasMore }`.
5. `AdminOverviewService.overview(viewer)`가 기존 `Promise.all`에 이 호출을 더하고 응답 `upcoming`에 넣는다. 트랜잭션 없음, 캐시 없음(D277).

예: `"upcoming":{"from":"2026-11-01","to":"2026-12-01","items":[{"kind":"event","id":"…","title":"11월 정기 내전의 날","starts_on":"2026-11-08","ends_on":"2026-11-08","start_time":"21:00","end_time":null,…},{"kind":"scrim","id":"…","title":"금요 5:5","scheduled_at":"2026-11-13T12:00:00.000Z",…}],"has_more":false}`

#### 23-8-5. 화면 (frontend, 목업 없음)

**`/admin` 결과 탭 통계 4칸(D306):**

| 폭 | 배치 |
| --- | --- |
| 모바일(md 미만) | `grid-cols-2`: 승인 대기 · 이번 주 내전 / 이번 달 노쇼(`col-span-2`) / 「다가오는 일정」(`col-span-2`) |
| md | `md:grid-cols-3`: 통계 3칸 한 줄 + 「다가오는 일정」 다음 줄 `md:col-span-3` |
| xl | `xl:grid-cols-4`: 통계 3칸 + 「다가오는 일정」 1칸(`xl:col-span-1`). 통계 칸 내용은 위 정렬(목록 카드 높이로 늘어나도 숫자가 가운데로 가지 않게) |

「다가오는 일정」 카드:

- 머리: 점(cyan) + 「다가오는 일정」, 보조 「오늘부터 30일」. 통계 칸과 같은 카드 모양(테두리·반경·패딩).
- 행(최대 5, 응답 순서 그대로): 날짜 · 시각 · 게임 약칭 · 제목(truncate) · 종류 칩.
  - 일정: 날짜 `starts_on < from`이면 「진행 중 · ~MM.DD」, 아니면 「MM.DD (요일)」. 시각 = `start_time ?? '종일'`(같은 날 `end_time`이 있으면 `21:00–23:00`). 게임 = 약칭 또는 「게임 무관」. 칩 「일정」. 링크 없음(편집은 아래 캘린더).
  - 내전: 날짜·시각 = `scheduled_at` KST. 칩 = 기존 내전/모집 구분 문구(스팀 모집이면 「모집」, 아니면 「내전」 — 화면에 이미 있는 규칙을 쓴다). 행 전체 `Link` → `routes.scrim(id)`. 내 참가(`my_status`)면 제목 굵게(캘린더와 같음).
- 비면 「다가오는 일정이 없어요」. `has_more`면 아래 「캘린더에서 더 보기 ↓」(같은 화면 캘린더 카드로 스크롤, 캘린더 카드에 `id="admin-calendar"`).
- 로딩·오류는 통계와 같은 상태(같은 요청). ~~1단계에서 `upcoming`이 없으면 비어 있는 것과 같이 그린다~~ → 2단계(2026-11-01 (4))에서 분기 삭제, `upcoming`은 항상 있다.
- 보기 모델 `upcomingRows(u: AdminUpcoming)`에는 `now`가 없다 — 진행 중 판정은 응답 `from`, 내전 날짜는 응답 `date`(D313).
- 접근성: 목록 `aria-label="다가오는 일정 N개"`, 내전 행 링크 이름 「{M월 D일} {HH:mm} {제목} {칩} 상세」(예 「11월 13일 21:00 금요 5:5 내전 상세」). **제목이 칩 문구로 끝나면 칩 생략**(「화요일 저녁 5:5 내전」 → 「10월 31일 15:00 화요일 저녁 5:5 내전 상세」, D314).

**일정 시각 표시(D298):** 새 순수 함수(`lib/news.ts`) `eventScheduleText(e)` — 종일 하루 「11.08」, 종일 여러 날 「11.08 – 11.10」, 하루 시작만 「11.08 21:00」, 하루 시작·끝 「11.08 21:00–23:00」, 여러 날 「11.08 21:00 – 11.10 18:00」(끝 시각 없으면 「11.08 21:00 – 11.10」). `eventTimeText(e)` — 「종일」 | 「21:00」 | 「21:00–23:00」(하루 목록용). 기존 `eventDateText`는 날짜만 필요한 곳에 남긴다.

| 위치 | 변경 |
| --- | --- |
| 캘린더·`/news` 막대 | 막대 첫 조각(`fromPrev` false)이고 `start_time`이 있으면 제목 앞 `21:00 `. title·aria-label은 `eventScheduleText` |
| 날짜 상세·모바일 목록 일정 행, `/news` `EventDetail` | 날짜 글자 → `eventScheduleText` |
| 관리자 「공지·소식」 이벤트 목록 meta | `eventScheduleText` |
| 홈 「패치 · 이벤트」 이벤트 행 | `start_time`이 있으면 태그 옆 `eventTimeText` |
| `EventForm` | 날짜 줄 아래 「시작 시각(선택)」「종료 시각(선택)」 `<input type="time">`(step 기본 60초 → `HH:mm`). 빈 값 = null, 시작이 비면 종료 입력 비활성 + 값 비움. 힌트 「비우면 종일 일정이에요」. 오류 표시 path에 `end_time`·`start_time` 추가. 오류 문구 = `eventScheduleIssueText(issue)`(shared 메시지 → 해요체 매핑, 모르면 shared 메시지, D315). 수정 폼 초기값 = `editing.start_time ?? ''`. 저장 본문은 지금처럼 `CreateEventRequest` 결과 전체(두 시각을 늘 함께 보낸다 → D300 PATCH 규칙에 걸리지 않음) |
| 캘린더 일정 대화상자 안내(community-calendar.tsx:567) | 「날짜만 저장돼요(…)」 → 「시각을 비우면 종일 일정으로 저장돼요」 |

#### 23-8-6. 전환 일정 (D305) — **완료(2단계, 2026-11-01 (4))**

| 단계 | 언제 | shared | 확인 |
| --- | --- | --- | --- |
| 1단계 | 지금(architect 완료) | `EventView.start_time·end_time`, `DashboardNewsItem(event).start_time·end_time` = `EventTime.nullable().optional()`, `AdminOverview.upcoming` = `AdminUpcoming.optional()`. 요청 필드는 `.default(null)`(최종 형태) | typecheck 4개 Done, 기존 테스트 통과 |
| 2단계 **(완료)** | ~~backend·frontend 23-8 보고 후, QA 전~~ → 실제: backend·frontend 구현과 QA(`03_qa-verifier_s6_calendar_{backend,web}.md`, api·web·목이 시각·upcoming을 항상 채움 확인) 뒤 2026-11-01 (4) | 세 곳 `.optional()` 삭제, `contract.s6.event-times.test.ts` 「1단계」 단언 2개(EventView 시각 생략 통과, AdminOverview upcoming 생략 통과)를 실패 기대로 뒤집기, 주석의 「전환」 문구 정리, dist 재빌드 | `pnpm -r typecheck`, shared·api·web 테스트. 웹은 `upcoming ?? 빈 목록` 분기 삭제 |

**2단계 결과:** api·목 런타임 코드는 이미 세 필드를 채워 변경 0줄. 깨진 곳은 타입 리터럴 픽스처(web `lib/admin.test.ts`·`calendar.test.ts`·`news.test.ts`, shared `contract.s6.calendar.test.ts`·`contract.s6.test.ts`)와 웹의 옛 `undefined` 분기(`lib/admin.ts` `upcomingRows`, `admin-results.tsx` `UpcomingCard`)뿐 — 필드 채움·분기 삭제만 했다(19절 「D305 2단계 후」).

(당시 예상) 2단계에서 구현이 빠졌으면 깨지는 곳: web `src/lib/api/mock/admin.ts`(`eventView` 반환 타입 `EventView`, `mockDashboardNews` 반환 `DashboardNews`, overview `const res: AdminOverview`), web 테스트 픽스처(`src/lib/test-fixtures.ts` 등 EventView·AdminOverview 리터럴), api는 타입이 아니라 **런타임 parse**(`EventView.parse`·`GetDashboardSummaryResponse`·`GetAdminOverviewResponse`·`GetCalendarResponse`)로 news·calendar·dashboard·admin-overview e2e가 실패한다.

#### 23-8-7. 담당 배정 (변경분만, 파일:줄은 2026-11-01 architect 반영 시점) — 전부 완료, QA pass

```
architect(완료: schema·마이그레이션·shared·계약 테스트·dist, 1단계)
  ├─ logic: core 14-7 추가 4함수 (먼저, 작음) ──┐
  ├─ backend: 23-8 backend 표 (시그니처로 시작) ─┼─ architect 2단계(D305) → 전체 테스트 → qa
  └─ frontend: 23-8 frontend 표 (목으로 시작) ───┘
```

##### logic (domain-logic-dev) — `packages/core/src/**`

| 파일:줄 | 작업 |
| --- | --- |
| `src/calendar.ts` 끝(기존 2함수 불변) | `compareEventSchedule`, `eventStartsAt`, `upcomingWindow`, `mergeUpcomingItems`(14-7 추가 시그니처). KST 오프셋은 core `config.ts`의 `KST_OFFSET_MS`(정정 2026-11-01 (4): ~~`time.ts` 상수~~ — `time.ts`도 config에서 import한다), 날짜 더하기는 같은 파일의 기존 방식 |
| `src/calendar.test.ts` | 14-7 추가 테스트 필수 전부 |
| `src/index.ts:146` | export 4개 추가 |
| dist | 재빌드, 보고서 `_workspace/02_domain-logic-dev_report.md`에 절 추가 |

##### backend (backend-dev) — `apps/api/**`

| 파일:줄 | 작업 |
| --- | --- |
| `src/common/db-date.ts` 끝 | `toDbTime(hhmm: string): Date`(= `new Date(\`1970-01-01T${hhmm}:00.000Z\`)`), `fromDbTime(d: Date \| null): string \| null`(`toISOString().slice(11, 16)`) |
| `src/modules/news/news.service.ts:52` | `EVENT_CURSOR = 'events2'`. 근처에 `export const EVENT_ORDER_BY = [{ startsOn: 'asc' }, { startTime: { sort: 'asc', nulls: 'first' } }, { endsOn: 'asc' }, { id: 'asc' }] satisfies Prisma.CalendarEventOrderByWithRelationInput[]` |
| 같은 파일 `:112-127` `eventViews` | `start_time: fromDbTime(r.startTime)`, `end_time: fromDbTime(r.endTime)` |
| 같은 파일 `:196-227` `listEvents` | orderBy → `EVENT_ORDER_BY`, 커서 4개 키·조건(23-8-3), `encodeListCursor(EVENT_CURSOR, [s, fromDbTime(r.startTime), e, id])` |
| 같은 파일 `:476-512` `createEvent` | data `startTime`·`endTime`(`body.x === null ? null : toDbTime(body.x)`), 감사 details에 `start_time`·`end_time` |
| 같은 파일 `:514-581` `updateEvent` | `:519-531` 기간 검사 → 합친 `{ starts_on, ends_on, start_time: body.start_time !== undefined ? body.start_time : fromDbTime(cur.startTime), end_time: … }`를 `eventScheduleIssues`로 검사, 문제 있으면 `AppError('VALIDATION_FAILED', undefined, { details: issues.map(({ path, message }) => ({ path, message })) })`. `auditDiff` 양쪽에 `start_time`·`end_time`, update data에 `startTime`·`endTime`(undefined = 그대로) |
| 같은 파일 `:583-615` `deleteEvent` | 감사 스냅샷에 `start_time`·`end_time` |
| `src/modules/dashboard/dashboard.service.ts:213` | orderBy → `EVENT_ORDER_BY` |
| 같은 파일 `:235-244` | 이벤트 행에 `start_time: fromDbTime(e.startTime)`, `end_time: fromDbTime(e.endTime)` |
| `src/modules/calendar/calendar.service.ts:52` | orderBy → `EVENT_ORDER_BY` |
| 같은 파일 `:66-81` | 내전 투영을 `export function toCalendarScrimItem(s: ScrimSummary): CalendarScrimItem`으로 추출(동작 동일) |
| 같은 파일 클래스 끝 | `async upcoming(viewer: AuthUser, now: Date): Promise<AdminUpcoming>`(23-8-4) |
| `src/modules/calendar/calendar.module.ts:16` 다음 | `exports: [CalendarService]` |
| `src/modules/admin/admin.module.ts:19` | `imports`에 `CalendarModule` 추가(CalendarModule은 AdminModule을 import하지 않는다 — 순환 없음) |
| `src/modules/admin/admin.controller.ts:57-60` | `overview(@CurrentUser() user: AuthUser)` → `this.overviewService.overview(user)` |
| `src/modules/admin/admin-overview.service.ts:23-66` | 생성자에 `CalendarService`, `overview(viewer)`의 `Promise.all`에 `this.calendar.upcoming(viewer, now)`, 응답에 `upcoming` |
| `test/support/fake-table.ts:100-120` `sortRows` | orderBy 값 `{ sort: 'asc' \| 'desc', nulls?: 'first' \| 'last' }` 지원(지정 없으면 지금 규칙: asc NULL 마지막). Date 비교는 기존 `cmp` |
| `test/support/fake-prisma.ts:246-255` | calendarEvent 기본값 `startTime: null`, `endTime: null` |
| `test/news.e2e.spec.ts` | 생성: 시각 저장·응답(`21:00`), 종일 null, `end_time`만 400 path end_time, 같은 날 역순 400, 여러 날 역순 통과. PATCH: `{start_time:'23:30'}` 역순 400, `{start_time:null}` 단독(저장된 end_time 있음) 400, `{start_time:null,end_time:null}` 종일로, 같은 값 PATCH 감사 없음. 감사 details 3종에 시각. `GET /events` 정렬(같은 날 종일 → 08:00 → 21:00, 여러 날·id 타이브레이크), 커서 페이지 경계가 종일/시각 사이에 걸려도 누락·중복 없음(limit 1로 전부 넘기기), 옛 `events` 커서 400 |
| `test/calendar.e2e.spec.ts` | 일정 항목 `start_time`·`end_time`, 같은 날 정렬 |
| `test/dashboard.e2e.spec.ts` | news 이벤트 행 시각·정렬 |
| `test/admin-overview.e2e.spec.ts` | upcoming: 비면 `items []`·`has_more false`, 취소 제외, 이미 시작 시각 지난 내전 제외(now − 1ms 제외, now 포함), 30일 경계(`scrimBefore` − 1ms 포함·정각 제외), 진행 중 여러 날 일정 포함·맨 앞, 게임 무관 일정 포함, 같은 순간 일정 먼저, 6개 → 5개 + has_more, `my_status` = 요청 운영진, 내전 항목에 host·players 없음, 멤버 403(기존) |
| 보고서 | `_workspace/02_backend-dev_s6_calendar.md`에 「23-8」 절 추가 |

##### frontend (frontend-dev) — `apps/web/**`

| 파일:줄 | 작업 |
| --- | --- |
| `src/lib/admin.ts:69-76, 78-110` | `OverviewCard`·`overviewCards` 3칸은 그대로. 주석 「통계 4칸 = 3칸 + 다가오는 일정(D306)」. 새 순수 함수 `upcomingRows(u: AdminUpcoming)`(정정 D313: ~~`\| undefined, now`~~ — `now` 없음, 2단계로 undefined 없음) → 행 보기 모델(날짜·시각·게임·제목·칩·href·linkLabel·bold), `UPCOMING_EMPTY_TEXT`. 링크 이름 규칙 D314, 일정 오류 문구 `eventScheduleIssueText`(D315) |
| `src/lib/admin.test.ts` | `upcomingRows`: 진행 중 일정 「진행 중 · ~MM.DD」, 종일·시작만·시작–끝, 내전 KST 시각(15:00Z 경계), 스팀 「모집」, 내 참가 bold, 빈 items → [](~~undefined → [] 1단계~~ 2단계에서 삭제), 링크 이름 칩 생략(D314), `eventScheduleIssueText` 매핑(D315) |
| `src/components/admin/admin-results.tsx:67-100` `StatsGrid` | 23-8-5 배치(grid `grid-cols-2 md:grid-cols-3 xl:grid-cols-4`), 스켈레톤 4개(4번째 `col-span-2 md:col-span-3 xl:col-span-1`, 높이 목록 카드만큼), `<UpcomingCard upcoming={q.data.upcoming} />` 추가(정정 D313: `now` 없음, prop 타입 `AdminUpcoming`) |
| 같은 파일 `:50-56` | 캘린더 카드 감싸는 요소에 `id="admin-calendar"`(또는 `CommunityCalendar`에 `id` prop), 주석 「통계 4칸 + 캘린더 + …」 |
| `src/lib/news.ts:107-111` 다음 | `eventScheduleText`, `eventTimeText` + `news.test.ts` 6가지 표기 |
| `src/components/calendar/community-calendar.tsx:298-299, 424, 567` | 막대 시각 접두사·title·aria-label, 일정 행 `eventScheduleText`, 대화상자 안내 문구(23-8-5) |
| `src/components/news/news-view.tsx:347, 399` | 막대 접두사·title, `EventDetail` `eventScheduleText` |
| `src/components/admin/admin-news.tsx:472` | meta `eventScheduleText` |
| 같은 파일 `:490-560` `EventForm` | 시각 입력 2개·상태·parse 입력·오류 path(23-8-5) |
| `src/components/home/home-view.tsx:599-615` | 이벤트 행 시각(`n.kind === 'event' && n.start_time`) |
| `src/lib/hooks/admin.ts:100-106` `invalidateAfterNewsWrite` | `adminKeys.overview` 무효화 추가(`invalidateAfterResultChange`는 이미 `adminKeys.all`) |
| `src/lib/hooks/scrims.ts:160, 183, 274` | 같은 자리에 `['admin', 'overview']` 무효화 추가(이 파일은 hooks/admin을 import하지 않으므로 키 리터럴 또는 `hooks/calendar.ts`에 `ADMIN_OVERVIEW_KEY` 상수를 두고 admin.ts의 `adminKeys.overview`도 그 상수를 쓴다) |
| `src/lib/api/mock/admin.ts:152-164` `MockEvent` | `start_time`·`end_time: EventTime.nullable().default(null)`(저장된 옛 목 상태 호환) |
| 같은 파일 `:314-318, 330-340` `mockDashboardNews` | 정렬 `compareEventSchedule`(core), 이벤트 행 시각 |
| 같은 파일 `:348-349` `eventOrder` | core `compareEventSchedule`로 교체 |
| 같은 파일 `:606-616` `eventView` | 시각 2개 |
| 같은 파일 `:656-672` `scrimItem` | 캘린더 분기 밖(핸들러 상단)으로 옮겨 overview와 공유 |
| 같은 파일 `:750-780` overview | `upcoming`: core `upcomingWindow`·`mergeUpcomingItems`, 일정(ends_on·starts_on 조건, `compareEventSchedule`, MAX+1), 내전(cancelled 제외, [now, scrimBefore), MAX+1), `empty` 시나리오면 빈 목록 |
| 같은 파일 `:999-1033` 이벤트 POST·PATCH | POST는 그대로(`p.data`에 시각 포함), PATCH 병합 검사 → shared `eventScheduleIssues`(합친 4필드), 오류 details path 그대로 |
| 같은 파일 시드(`:223` events 시드, `:466` 근처) | 시각 있는 일정 1개(예 21:00–23:00)와 시작만 있는 일정 1개 |
| `src/lib/api/mock/admin.test.ts` | 목: 시각 저장·PATCH 병합 오류, 정렬, overview upcoming(취소 제외·한도·has_more·shared parse 통과) |
| 보고서 | `_workspace/02_frontend-dev_s6_calendar.md`에 「23-8」 절(목업 없음 명시) |

##### qa (qa-verifier) — 추가 확인

- 마이그레이션 `20261101120000_s6_event_times`: migrate diff stdout 일치(머리 주석 4줄 제외), DROP·NOT NULL·데이터 변경 0건, s6 파일 무변경(`git diff` 0줄).
- 2단계 전환(D305) 완료: shared 세 필드에 `.optional()` 없음, 웹 `upcoming ??`·`upcomingRows(undefined)` 분기 없음(2026-11-01 (4) architect 완료 — QA 재확인 대상).
- 23-8-2 표의 검증·PATCH 예 전부, 23-8-3 정렬·커서(누락·중복 없음), 23-8-4 upcoming 경계, 감사 details 시각.
- 화면: `/admin` 4칸 배치 3폭, 「다가오는 일정」 빈 상태·has_more·내전 링크·일정 행 링크 없음, 전체 폭 캘린더 유지, 시각 표시 6가지 표기, `EventForm` 시각 입력, 홈 카드·`/news` 회귀 없음.
