# backend-dev S6 보고서 — 관리자 도구·되돌리기·이의 제기·시즌·공지/패치/이벤트·봇 전송·API 키·감사 로그

작성 2026-11-01. 계약 `_workspace/01_architect_contract.md`(S6) 전체. 커밋하지 않았다.
사용 가능 도구: Read, Bash, Write, Edit, SubagentHandback.

## 실행 결과 (Node 24.22.2, 저장소 설정 그대로)

- `corepack pnpm --filter api typecheck`: 통과(오류 0). `tsc -p tsconfig.build.json --noEmit`도 통과
- `corepack pnpm exec vitest run`(apps/api): **46 files passed / 9 skipped, 641 passed / 52 skipped**
  (기준선 583 passed / 47 skipped → 새 테스트 58개, 새 DB e2e 5개 skip)
- core는 `packages/core/src/{result-review,season,admin,no-show,news}.ts`와 dist가 완성된 뒤 실행했다. core 함수는 import만 하고 다시 구현하지 않았다
  (시즌 수정·생성·삭제 = `validateSeasonWrite`·`validateSeasonDelete`·`seasonPhase`·`seasonEditable`, 노쇼 후보 = `computeScrimRestriction`·`previewNoShowRestriction`)
- **미실행**: `test/db/admin.db.e2e.spec.ts` 5건(Docker·PostgreSQL 없음, `TEST_DATABASE_URL` 없으면 skip). 통과했다고 보지 말 것

## 구현한 엔드포인트 (35개)

| 구분 | 엔드포인트 | 위치 |
| --- | --- | --- |
| 멤버 6 | GET /notices, /patch-notes, /events | `modules/news/news.controller.ts`(NewsController) |
| | POST /scrims/:id/result/disputes (201) | `modules/scrims/scrims.controller.ts` → `scrim-results.service.ts#createDispute` |
| | GET·PATCH /me/notification-settings | `modules/users/users.controller.ts` |
| 운영진 25 | POST /scrims/:id/result/revert | `scrims.controller.ts`(@Roles admin) → `scrim-results.service.ts#revert` |
| | 공지·패치노트·이벤트 POST/PATCH/DELETE 9개 | `news.controller.ts`(AdminNewsController, 클래스 단위 @Roles) |
| | overview, results, disputes, disputes/:id/resolve, no-show/scrims, members, members/:id/role, api-keys GET/POST, api-keys/:id/revoke, seasons GET/POST/PATCH/DELETE, audit-logs (15개) | `modules/admin/admin.controller.ts`(클래스 단위 JwtGuard+RolesGuard+@Roles) |
| 봇 4 | GET /bot/notices/pending, POST /bot/notices/:id/delivered, GET /bot/patch-notes/pending, POST /bot/patch-notes/:id/delivered | `modules/bot/bot.controller.ts` → `bot-announcements.service.ts` |

기존 응답 변경: 대시보드 `news` 블록(`dashboard.service.ts#news`, architect 임시값 교체), ScrimDetail viewer 4필드·`open_dispute_count`(`scrim-views.service.ts`, 임시값 교체), 반려 시 open 이의 제기 자동 처리(`scrim-results.service.ts#reject`).

## 새·변경 파일

- 새: `src/common/audit.ts`(writeAudit·auditQuote·auditDiff), `src/common/list-cursor.ts`, `src/common/db-date.ts`, `src/modules/news/*`, `src/modules/admin/*`(controller, module, overview, review, members, api-keys, seasons, audit 서비스), `src/modules/bot/bot-announcements.service.ts`, `src/modules/scrims/revert-checks.ts`(later_games 판정 1쿼리)
- 변경: `common/guards/jwt.guard.ts`(DB role, D263), `decorators/current-user.ts`·`roles.ts`(주석), `ratings/rating-locks.ts`(`lockSeasonForRevert`), `scrims/scrim-results.service.ts`, `scrim-views.service.ts`(`latestFirst` export), `scrims.controller.ts`, `bot.controller.ts`·`bot.module.ts`, `users/*`, `dashboard/dashboard.service.ts`, `rankings/ranking-cache.store.ts`(`summary()` 추가)·`rankings.module.ts`(`RANKING_CACHE_STORE` export), `app.module.ts`
- 테스트 지원: `test/support/fake-prisma.ts`(S6 표 5개, scrims→players·results·disputes cascade, user.count·findFirst, 원시 SQL 2종), `fake-table.ts`(`delete`), `memory-ranking-cache.ts`(`summary`), 새 `s6-helpers.ts`
- 테스트: `scrim-revert`(15), `scrim-disputes`(9), `news`(10), `bot-announcements`(4), `admin-auth`(4), `admin-members`(4), `admin-keys-seasons`(7), `admin-overview`(5) `.e2e.spec.ts`, DB `test/db/admin.db.e2e.spec.ts`(5, 작성만)

## 되돌리기 구현 요약 (6-3 대조용)

내전 행 FOR UPDATE → approved 행·result_id 확인(NOT_APPROVED) → 이력 → (이력 있으면) 사용자 advisory 오름차순 → now → 시즌 FOR SHARE(`lockSeasonForRevert`, 이력 시즌 여럿이면 rating_mismatch) → later_games(잠금 아래, 모든 시즌, 같은 시각 포함) → core `revertBlockReason`(self_submitted → 403 SELF_REVIEW, 나머지 409 + 이유 문구) → core `inferRevertOutcomes`·`planRatingRevert` → ratings update(plan 값) → 이력 deleteMany(수 불일치면 롤백) → 결과 조건부 updateMany approved→reverted(`assertResultTransition`) → `assertScrimTransition(finished→playing)` → open 이의 제기 자동 처리 → 감사 `result.revert`(지운 이력 스냅샷 + outcome). READ COMMITTED, scrimWriteTx. 잠금 순서는 테스트가 rawCalls로 확인한다.

## 계약 모호·충돌·판단 (임의로 계약을 바꾸지 않았다)

1. **ADMIN_LAST_ADMIN은 API로는 나올 수 없다.** 12-2에서 요청자가 admin인지 잠금 안에서 다시 확인하고 자기 자신은 막으므로, 다른 admin을 강등할 때 admin 수는 항상 2 이상이다. 코드에는 core `planRoleChange` 분기 그대로 두었고 HTTP 테스트는 없다(core 테스트만). 동시 맞강등은 하나 200·하나 403 FORBIDDEN으로 확인했다.
2. `writeAudit` 시그니처: 계약은 `{ actorId, action, targetId, summary, details }`인데, 행위 시각(APP_CLOCK)과 감사 시각을 맞추려고 `at: Date` 필드를 하나 더 받는다.
3. 공지·패치노트·이벤트 PATCH의 감사 `before`는 잠금 없이 읽은 값이다(READ COMMITTED). 동시 PATCH 두 건이면 before가 한 단계 늦을 수 있다. `notify_discord` 변경만 `discord_notified_at IS NULL` 조건부 update로 봇 전송과의 경합을 막았다(0행 → DISCORD_ALREADY_NOTIFIED). 삭제는 `delete`(RETURNING) 반환값을 감사에 넣어 정확하다.
4. 공개 GET의 `game` 필터에 games 행이 없는 코드가 오면 VALIDATION_FAILED가 아니라 빈 목록을 돌려준다(코드 자체는 shared enum이 이미 검증, 계약은 쓰기에만 path `game` 400을 정했다).
5. 봇 delivered에서 조건부 update 0행인데 다시 읽은 값이 null인 경우(정상 흐름에서는 생기지 않음)는 INTERNAL_ERROR로 둔다.
6. 감사 로그 목록에서 지금 `AdminAuditAction`·`AdminAuditTargetType`에 없는 값(text 컬럼)은 빼고 경고 로그를 남긴다(응답 parse 실패 대신).
7. 이의 제기 판정 순서는 7-1 그대로: 최신 결과·result_id 불일치(409)가 참가자 검사(403)보다 먼저다. 그래서 비참가자가 옛 result_id로 보내면 403이 아니라 409를 받는다.
8. 멤버 표 `discord_username`은 저장값 그대로(개발 로그인 사용자도 값이 있을 수 있음). 화면은 `discord_linked`로 「미연동」을 판단해야 한다.
9. 멤버 목록·`disputed` 큐는 조건에 맞는 행을 메모리에서 정렬한다(D266 오프셋 커서, open 이의 제기 최근 시각 정렬). 회원 수백 명·open 이의 제기 소수 규모를 전제로 한다.
10. 시즌 lead 검사는 core `validateSeasonWrite`의 확정 규칙(생성 또는 upcoming의 starts_at 변경 때만 + current 끝 변경)을 그대로 따른다. 서버에 별도 lead 규칙은 없다.
11. `RankingCacheStore`에 `summary()`(통계용)를 추가했다. PostgreSQL 구현은 `aggregate _max computedAt` + `count lastFailedAt not null`(`rankings:` 키만). 실제 SQL은 DB에서 확인하지 않았다.
12. FakeTable에 `delete`가 없어서 S2 `DELETE /scrims/:id`가 fake에서 한 번도 테스트되지 않았었다. `delete`와 FK cascade(scrims→players·results→disputes, rating_history는 RESTRICT라 흉내 내지 않음)를 추가했고, 되돌리기 뒤 삭제 테스트로 확인했다.

## 남은 문제·미확인

- DB e2e 5건 미실행: 되돌리기 vs 같은 사용자 다른 내전 승인 동시 경합, 시즌 FOR NO KEY UPDATE vs 승인 FOR SHARE, `@db.Date` 왕복, ILIKE `ESCAPE '\'`, `ALTER TYPE … ADD VALUE` 뒤 reverted 저장. Prisma `aggregate`, `groupBy`(rated_games), 원시 SQL 2개(`gcd:admin-member-search`, `gcd:member-scrim-counts`)의 실제 DB 동작도 미확인
- fake는 행 잠금·격리 수준을 흉내 내지 않는다(트랜잭션 직렬화). 잠금은 호출 순서만 확인했다
- 실서버 기동(`node dist/main.js`) 미확인

## 수정 이력

### QA 수정 (2026-11-01, `_workspace/03_qa-verifier_s6_backend.md` minor 3건)

1. **시즌 쓰기 트랜잭션 timeout·maxWait 명시** — `src/modules/admin/admin-seasons.service.ts`에 `SEASON_WRITE_TX_OPTIONS`(timeout = `SCRIM_TX_TIMEOUT_MS` × 2 = 30초, maxWait = `SCRIM_TX_MAX_WAIT_MS` 5초, READ COMMITTED)를 한 곳에 정의하고 생성·수정·삭제 3곳에서 쓴다. 대상 행 FOR NO KEY UPDATE가 승인·되돌리기의 시즌 FOR SHARE(상한 15초)를 기다려도 먼저 끝나지 않는다. 테스트: `admin-keys-seasons.e2e.spec.ts` 「쓰기 트랜잭션 3종 모두 timeout·maxWait 명시」($transaction 옵션 기록)
2. **이의 제기 open → resolved 전이 검사** — `scrim-results.service.ts`에 `assertDisputeTransition`(shared `DISPUTE_STATUS_TRANSITIONS` + `canTransition`, 실패 시 로그 + INTERNAL_ERROR, 내전·결과 전이와 같은 방식)을 추가했다. 반려·되돌리기 자동 처리(`autoResolveDisputes`)와 운영진 처리(`admin-review.service.ts#resolve`)가 update 전에 부른다. 테스트: `scrim-disputes.e2e.spec.ts` 「이의 제기 상태 전이 검사」(허용 1, 거부 3)
3. **공지·패치노트·이벤트 PATCH의 updated_at = APP_CLOCK** — `news.service.ts`의 update·조건부 updateMany data에 `updatedAt: now`를 넣었다. fake도 Prisma처럼 data에 updatedAt이 있으면 그 값을 쓰게 고쳤다(`test/support/fake-table.ts`). 테스트: `news.e2e.spec.ts` 「PATCH updated_at = APP_CLOCK」(일반 update·notify 조건부 경로·변경 없음 유지, 세 리소스)

shared 변경 없음(dist 재빌드 불필요). 재실행: `corepack pnpm --filter api typecheck` 통과, `corepack pnpm exec vitest run`(api) 46 files passed / 9 skipped, **644 passed / 52 skipped**, `corepack pnpm --filter api build` 통과. DB e2e 5건은 여전히 미실행.

### 이의 제기 제거(D281, 2026-11-01, 계약 18-1절 backend 목록)

사용자 결정으로 결과 이의 제기 기능을 **삭제**했다(표시만 숨긴 것이 아님). 엔드포인트는 35 → **32개**(멤버 5 + 운영진 23 + 봇 4). 반려·되돌리기·노쇼의 나머지 동작은 그대로다.

- `src/common/app-error.ts`: `SCRIM_DISPUTE_NOT_ALLOWED`·`SCRIM_DISPUTE_EXISTS`·`DISPUTE_ALREADY_RESOLVED` 문구 삭제
- `scrims.controller.ts`: `POST /scrims/:id/result/disputes` 핸들러와 import 삭제
- `scrim-results.service.ts`: `createDispute`, `assertDisputeTransition`(QA minor 2에서 넣은 것, 대상이 없어져 함께 삭제), `autoResolveDisputes`, 반려·되돌리기의 자동 처리 호출, 관련 import 삭제. 되돌리기 감사 `result.revert`는 유지
- `scrim-views.service.ts`: 상세의 open 이의 제기 조회·`can_dispute_result`·`has_open_dispute`·`result.open_dispute_count` 삭제. `revertBlockReason` 판정은 유지. `latestFirst`는 다시 모듈 내부 함수로
- `admin.controller.ts`·`admin-review.service.ts`: `GET /admin/disputes`·`POST /admin/disputes/:id/resolve`, `disputes`·`disputeItems`·`resolve`, 큐의 `disputed` 보기와 `open_dispute_count` 집계 삭제(큐는 `pending`·`approved`)
- `admin-overview.service.ts`: `open_disputes` 블록과 쿼리 2개 삭제(통계 4번째 칸은 기존 `scrims_this_week`, D281·Q20)
- `grep -rn "scrimResultDispute" apps/api/src` 0건. 「이의 제기」는 되돌리기 주석의 「D281: 이의 제기 기능 없음」 한 곳만
- DB `dispute_status` enum·`scrim_result_disputes` 표는 유지. 마이그레이션 변경 없음. fake-prisma의 표·cascade 흉내와 `test/db/admin.db.e2e.spec.ts`의 TRUNCATE 목록도 유지(fake 주석만 고침)
- 테스트: `test/scrim-disputes.e2e.spec.ts` 삭제. `scrim-revert.e2e.spec.ts`에서 이의 제기 단언을 빼고 회귀 2건 추가 — ① 삭제된 경로 3개 404(운영진·멤버), 상세에 필드 없음 ② 시드한 open 행이 반려·되돌리기 뒤에도 open. `admin-overview`(open_disputes·disputed 보기 삭제, `view=disputed` 400, `scrims_this_week` 정확 값 + 취소 제외), `admin-auth`(권한 표 23개), `s6-helpers`(`dispute()` 삭제, `seedDispute`는 회귀 테스트용으로 유지)

재실행: `corepack pnpm --filter api typecheck` 오류 0, `corepack pnpm exec vitest run`(api) 45 files passed / 9 skipped, **636 passed / 52 skipped**, `corepack pnpm --filter api build` 통과. DB e2e 5건은 여전히 미실행.

## 캘린더 (S6 후속, 계약 23절 D282–D297, 2026-11-01)

### 구현

- 새 `apps/api/src/modules/calendar/calendar.module.ts`(`imports: [ScrimsModule.forRoot(), NewsModule]`, `providers: [CalendarService, JwtGuard]`), `calendar.controller.ts`(`@Controller() @UseGuards(JwtGuard)`, `@Get(ApiPath.calendar)` + `ZodValidationPipe(GetCalendarQuery)`), `calendar.service.ts`(23-3의 1–5단계)
- `src/app.module.ts`: `CalendarModule`을 `NewsModule` 다음에 등록
- 서비스: `APP_CLOCK` → core `resolveCalendarMonth`·`calendarMonthRange` → (game 있으면 `game.findUnique({ code })`, 없으면 빈 응답) → `calendarEvent.findMany`(겹침 조건, `toDbDate`, starts_on·ends_on·id ASC, take 101) → `NewsService.eventViews` + `kind` → `scrim.findMany`(status 4종, `[fromAt, toBefore)`, scheduled_at·id ASC, take 301) → `ScrimViews.summaries`(목록과 같은 조립) → 13개 필드 투영 + `date = kstDateKey(scheduled_at)` → `GetCalendarResponse.parse`. 트랜잭션·캐시 없음
- 일정 쓰기는 기존 `/admin/events…` 그대로(코드 변경 없음). fake-prisma 변경 없음(필요한 where·take를 이미 지원)
- 스키마·마이그레이션 변경 없음

### 테스트 `apps/api/test/calendar.e2e.spec.ts` (14건, FakePrisma)

권한(비로그인 401, 봇 키 401 UNAUTHENTICATED, 멤버·운영진 200이고 모양이 같음), month 생략 + 10-31T15:00Z → 2026-11 / 10-26~12-06(1ms 전은 10월), 2027-02·2026-12 격자, 내전 KST 경계 4점, 일정 겹침 5경우, 형식 오류 400(month 4종, 모르는 게임), cancelled 제외 + 4상태 포함 + 같은 요청자의 `GET /scrims` 카드 값과 같음(my_status waitlist·joined·null, no_show 포함 joined_count, result_status), 응답에 방장·명단·남의 상태 없음(키 13개 고정), game 필터(null 일정 제외), games 행 없는 코드 → 빈 응답, 정렬 순서(id 동률), 한도(정확히 300·100 → false, 301·101 → 앞에서부터 자르고 true), 쓰기 왕복(POST → 나옴, PATCH → 바뀐 값·game null이면 lol 필터에서 빠짐, 멤버 DELETE 403, 운영진 DELETE → 사라짐).
변이 확인: status 필터를 빼거나 take +1을 빼면 해당 테스트가 실패한다(확인 뒤 되돌림).

### 실행 결과 (Node 24.22.2)

- core `packages/core/src/calendar.ts`와 `dist/calendar.{js,d.ts}`, index export를 확인한 뒤 실행했다
- `corepack pnpm --filter api typecheck` 오류 0, `corepack pnpm --filter api build` 통과(dist/modules/calendar 생성)
- `corepack pnpm exec vitest run`(apps/api): 46 files passed / 9 skipped, **650 passed / 52 skipped**(이전 636 + 캘린더 14)
- DB e2e는 추가하지 않았다. 실제 PostgreSQL에서 `@db.Date` lte/gte 비교와 인덱스 사용은 확인하지 않았다(Docker 없음)

### 계약 모호·판단 (계약은 바꾸지 않았다)

1. **보고서 위치**: 23-7은 `_workspace/02_backend-dev_s6_calendar.md`로 정했지만 리더 지시에 따라 이 파일 끝 절로 적었다
2. **게임 조회 메서드**: 23-3은 `game.findUnique({ code })`, 기존 news 필터는 `findFirst`. 계약대로 `findUnique`를 썼다(`GET /scrims`와 같음, code는 고유)
3. **「모르는 게임 400」**: shared `GameCode` enum 밖 코드(`valorant`)를 400으로 테스트했다. enum 안에 있지만 games 행이 없는 코드는 23-2 문구대로 빈 응답(200)이다
4. **status 투영**: `ScrimSummary.status`(5종)를 `CalendarScrimStatus`(4종)로 타입 단언한 뒤 최종 `GetCalendarResponse.parse`가 검증한다. 쿼리가 cancelled를 빼므로 실패할 일은 없다
5. **봇 키 401 코드**: 봇 키만 보내면 JwtGuard가 `UNAUTHENTICATED`를 낸다(기존 웹 경로와 같음, `api-key-guard.e2e.spec.ts`). 23-2는 「401」만 정했다
6. 두 목록을 한 트랜잭션으로 묶지 않으므로 같은 요청 안에서 일정·내전 사이 순간 불일치가 생길 수 있다(23-3 5단계, 허용)

## 일정 시각 · 「다가오는 일정」 (S6 후속, 계약 23-8 D298–D310, 2026-11-01 (3))

### 구현 (23-8-7 backend 표)

- `src/common/db-date.ts`: `toDbTime(hhmm)` = `new Date('1970-01-01T${hhmm}:00.000Z')`, `fromDbTime(d | null)` = `toISOString().slice(11, 16)` | null
- `src/modules/news/news.service.ts`
  - `EVENT_CURSOR = 'events2'`, `export const EVENT_ORDER_BY = [startsOn asc, startTime {sort asc, nulls first}, endsOn asc, id asc] satisfies Prisma.CalendarEventOrderByWithRelationInput[]`
  - `eventViews`: `start_time`·`end_time` 항상 채움(종일 = null)
  - `listEvents`: orderBy `EVENT_ORDER_BY`, 커서 4개 값 `[starts_on, start_time | null, ends_on, id]`, 23-8-3의 두 OR 조건(커서 시각 null / 값). 개수 ≠ 4, 날짜·시각 형식, 옛 `events` 접두사 → `invalidCursor()`(path cursor)
  - `createEvent`: `startTime`·`endTime` 저장, 감사 details에 `start_time`·`end_time`
  - `updateEvent`: 기존 기간 검사를 합친 값 `{starts_on, ends_on, start_time, end_time}`의 `eventScheduleIssues` 검사로 교체 → `VALIDATION_FAILED` details `{path, message}`. auditDiff 양쪽과 update data에 두 시각(undefined = 그대로, null = 비우기). `isoDateDiffDays`·`EVENT_SPAN_MAX_DAYS` import 삭제(shared 함수가 대신함)
  - `deleteEvent`: 감사 스냅샷에 `start_time`·`end_time`
- `src/common/list-cursor.ts`(표에 없는 파일, 아래 판단 1): 커서 값 union에 `null` 추가, `CursorValue = string | number | null`. 기존 커서 디코더는 `cursorDate`·`cursorId`·`typeof` 검사로 null을 그대로 거부한다
- `src/modules/dashboard/dashboard.service.ts`: 이벤트 orderBy `EVENT_ORDER_BY`, 행에 `start_time`·`end_time`
- `src/modules/calendar/calendar.service.ts`: orderBy `EVENT_ORDER_BY`, `export function toCalendarScrimItem(s: ScrimSummary): CalendarScrimItem` 추출(동작 동일), `upcoming(viewer, now): Promise<AdminUpcoming>` — core `upcomingWindow(now, 30)` → 일정(ends_on ≥ from && starts_on ≤ to, 게임 필터 없음, take 6)·내전(취소 제외, `[now, scrimBefore)`, take 6)을 `Promise.all` → `eventViews`·`summaries` → core `mergeUpcomingItems(…, 5)`
- `calendar.module.ts`: `exports: [CalendarService]`. `admin.module.ts`: `imports`에 `CalendarModule`(순환 없음). `admin.controller.ts`: `overview(@CurrentUser() user)`. `admin-overview.service.ts`: 생성자에 `CalendarService`, `overview(viewer)`의 `Promise.all`에 `upcoming`, 응답에 `upcoming`(항상 채움)
- `test/support/fake-table.ts` `sortRows`: `{ sort, nulls? }` 지원(생략이면 기존 규칙 asc NULL 마지막·desc NULL 처음). `test/support/fake-prisma.ts`: calendarEvent 기본값 `startTime: null`, `endTime: null`
- 마이그레이션·schema 변경 없음(`prisma generate`만 실행). 응답 세 필드(EventView·DashboardNewsItem 시각, AdminOverview.upcoming)는 api가 항상 싣는다 → 2단계(`.optional()` 삭제)에서 api 쪽 깨질 곳 없음(테스트가 `toHaveProperty`·`toBeDefined`로 확인)

### 테스트 (FakePrisma, DB 없음)

- `test/news.e2e.spec.ts` +4: POST 시각 저장(DB 1970-01-01 UTC 값)·응답 HH:mm·00:00/23:59, 생략 = null, `end_time`만 400 path end_time, 같은 날 역순 400·같은 시각 허용, 여러 날 역순 통과, 기간 오류와 시각 오류가 같이 있으면 path `ends_on` 하나만(검사 순서), 형식 24:00·초·한 자리 400, create 감사 details 시각. PATCH: `{start_time:'23:30'}` 400, `{start_time:null}` 단독 400, `{end_time:'20:00'}` 400, 같은 값 감사 없음, `{ends_on:'11-09', start_time:'23:30'}` 통과 + diff, 다시 하루로 줄이면 400, 시각 생략 PATCH는 시각 유지, `{start_time:null,end_time:null}` 종일 + diff, 삭제 스냅샷 시각. `GET /events` 정렬 9행(종일 → 08:00 → 21:00, ends_on·id 동률, 앞 날짜 23:59가 먼저) + limit 1·2·3으로 끝까지 넘겨 누락·중복 없음. 커서 형식 8종 400 path cursor(옛 `events`, 값 3·5개, 24:00, 초, 숫자, 날짜 형식, uuid 아님) + 올바른 null·값 커서 200
- `test/calendar.e2e.spec.ts` +2: 일정 항목 시각 필드·같은 날 정렬·내전은 일정 뒤, POST(시각) → 캘린더 항목 = EventView + kind, PATCH 후 순서
- `test/dashboard.e2e.spec.ts` +1: news 이벤트 행 시각, DB 정렬로 2개 한도(종일·08:00이 남고 21:00이 잘림), 21:00–23:00 두 시각
- `test/admin-overview.e2e.spec.ts` +4: 비면 `{from:'2026-10-31', to:'2026-11-30', items:[], has_more:false}` + 멤버 403. 경계: 진행 중 여러 날 일정(게임 무관) 맨 앞, 끝난 일정·12-01 시작 제외, 내전 now − 1ms(playing) 제외·now 포함, 취소 제외, scrimBefore − 1ms 포함·정각 제외, `my_status` = 요청 운영진, upcoming JSON에 host·players·남의 id 없음. 병합: 종일 < 20:00 내전 < 21:00 일정 < 같은 순간 21:00 내전, 정확히 5개 false → 6개 5개 + true. 일정만 6개·내전만 6개 각각 5개 + has_more
- 변이 확인: `nulls: 'first'` → `'last'`면 news·calendar·dashboard·admin 5건 실패, 커서 null 분기 조건을 바꾸면 커서 왕복 테스트 실패(확인 뒤 되돌림, 소스는 원래대로)

### 실행 결과 (Node 24.22.2)

- core `packages/core/src/calendar.ts`·dist index export(4함수)를 확인한 뒤 실행
- `corepack pnpm --filter api typecheck` 오류 0, `build` 통과
- `corepack pnpm exec vitest run`(apps/api): 46 files passed / 9 skipped, **661 passed / 52 skipped**(이전 650 + 11)
- **실행하지 않음**: DB e2e(9 files skipped, Docker 없음). 실제 PostgreSQL에서 `time(0)` 왕복, `ORDER BY start_time ASC NULLS FIRST`, `startTime > time` 커서 비교, 마이그레이션 적용은 확인하지 않았다. 새 DB e2e도 추가하지 않았다

## 일정 시각

계약 모호·충돌과 판단(계약은 바꾸지 않았다):

1. **커서 null 값**: 23-8-3은 커서 값에 `start_time | null`을 담으라고 하지만 공통 `list-cursor.ts`의 Payload는 문자열·정수만 받아 null 커서가 항상 400이 된다. 23-8-7 표에 없는 파일이지만 `null`을 union에 추가했다(엔드포인트·응답 모양 변화 없음, 기존 커서는 null을 계속 거부). architect 확인 필요
2. **「시각 검증 순서」**: `eventScheduleIssues` ①(기간)에서 끝나는 규칙으로 보고, 기간·시각 오류가 함께 있으면 details가 `ends_on` 하나뿐임을 POST에서 확인했다. PATCH는 zod(요청 안) → 404(행 없음) → 합친 값 검사 순이다 — 없는 id에 합친 값만 틀린 PATCH는 404
3. **`upcoming()`의 parse**: `CalendarService.upcoming`은 parse하지 않고 `AdminOverviewService`의 `GetAdminOverviewResponse.parse`가 한 번에 검증한다(23-8-4 5단계와 같음)
4. **`EVENT_ORDER_BY` 위치**: news.service.ts에서 export하고 dashboard·calendar가 파일 import로 쓴다(DI 변경 없음, 23-8-3대로)
5. **보고서 위치**: 23-8-7은 `_workspace/02_backend-dev_s6_calendar.md`의 「23-8」 절로 정했지만 리더 지시대로 이 파일 끝에 적었다
6. **fake-table**: `{sort, nulls}` 지원만 더했고 기존 문자열 orderBy에서 undefined 값 처리(null로 보지 않음)는 바꾸지 않았다

## QA 수정(일정 시각)

QA `_workspace/03_qa-verifier_s6_calendar_backend.md` minor 2건만 고쳤다.

1. **minor 1 — `updateEvent` 동시 PATCH 경합** (`apps/api/src/modules/news/news.service.ts` `updateEvent`)
   - 무조건 `update`하던 것을 조건부 `updateMany`로 바꿨다. where에 읽은 일정 값 4개(`startsOn`·`endsOn`·`startTime`·`endTime`)를 건다. 공지·패치노트의 조건부 `updateMany` 관례와 같은 방식이다.
   - 0행이면 같은 트랜잭션에서 다시 읽고, 합친 값 `eventScheduleIssues` 검사(기간 + 시각)부터 다시 한다. READ COMMITTED이므로 다음 문은 상대가 커밋한 값을 본다. 그래서 상대 변경 때문에 규칙이 깨지면 400(path ends_on·end_time), 행이 지워졌으면 404, 여전히 맞으면 새 값 기준으로 저장한다(감사 before도 새 값).
   - 재시도는 `EVENT_UPDATE_ATTEMPTS = 3`번까지다. 넘으면 `INTERNAL_ERROR`(500)를 낸다.
   - 검사 순서는 그대로다: zod → 404 → 합친 값 검사 → game.
   - 테스트 `test/news.e2e.spec.ts` 「이벤트 PATCH 동시 수정」 3건. 서비스가 읽은 직후 행을 바꿔 다른 운영진의 커밋을 흉내 냈다(fake는 트랜잭션을 직렬화하므로 진짜 동시 실행은 재현할 수 없다).
     - QA 예(11-08~11-10 09:00/10:00, A `{ends_on:'11-08'}` 사이에 B `start_time 21:00`)는 400 path end_time이고, A의 값은 쓰이지 않으며 감사도 남지 않는다.
     - 상대가 맞는 값으로 바꾼 경우는 재검사 후 저장되고, 감사 before는 새 값이다.
     - 읽은 뒤 삭제되면 404, 읽을 때마다 바뀌면 500이고 아무것도 쓰지 않는다.
   - 변이 확인: where를 `{ id }`로 되돌리면 3건 모두 실패한다(확인 뒤 되돌림).
2. **minor 2 — 커서 날짜 검증** (`news.service.ts` `isCursorDate` = shared `IsoDate.safeParse`)
   - `events2` 커서의 starts_on·ends_on 자리와 patch-notes 커서의 published_on 자리에 적용했다. `2026-13-45`·`2026-02-30`이면 400 path cursor다. 쓰지 않게 된 `ISO_DATE_RE`는 삭제했다.
   - 테스트: events2 커서 2종(앞 날짜, 끝 날짜), patch-notes 커서 2종.
   - 변이 확인: events2 검사를 typeof만 남기면 커서 테스트가 실패한다(확인 뒤 되돌림).

### 실행 결과 (Node 24.22.2)

- `corepack pnpm --filter api typecheck` 오류 0, `build` 통과
- `corepack pnpm exec vitest run`(apps/api): 46 files passed / 9 skipped, **664 passed / 52 skipped**(이전 661 + 3. 커서 단언은 기존 테스트에 더했다)
- 실행하지 않음: DB e2e(Docker 없음). 실제 PostgreSQL에서 조건부 UPDATE의 재평가(행 잠금 대기 뒤 0행)와 `time`·`date` 등치 조건은 확인하지 않았다

### 판단 (계약 변경 없음)

- 재시도를 다 써도 실패하면 낼 409 코드가 계약에 없어 `INTERNAL_ERROR`(500)로 했다. 실제로는 같은 일정을 세 번 연속 동시에 고쳐야 생긴다. 409 코드가 필요하면 architect가 정해야 한다
- 조건은 일정 4개 값에만 건다. 제목·설명 등 다른 필드의 경합은 공지·패치노트처럼 마지막 쓰기가 이긴다(불변식 없음)
- fake 한계: 흉내 낸 상대 쓰기가 실패한 A 트랜잭션의 롤백에 함께 되돌려져서, 400 경우에는 상대 값이 남아 있는지 단언하지 않았다
