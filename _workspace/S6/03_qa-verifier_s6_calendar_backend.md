# QA: S6 후속 backend·core·shared — (A) 이의 제기 제거 D281 · (B) GET /calendar 23절 · (C) 일정 시각·다가오는 일정 23-8 — 판정: **pass**

blocker 0 · major 0 · minor 2. 확인하지 못한 항목(DB 없음)은 아래 「미확인」에 따로 적었고 통과로 세지 않았다.

## 실행한 명령과 결과 (Node 24.22.2, PATH 앞에 scratchpad nodes)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·api·web 4개 모두 Done, 오류 0 (frontend 완료 뒤 다시 실행) |
| `corepack pnpm exec vitest run` (packages/shared) | 9 files, **195 passed** |
| `corepack pnpm exec vitest run` (packages/core) | 14 files, **542 passed** |
| `corepack pnpm exec vitest run` (apps/api) | 46 passed / 9 skipped, **661 passed / 52 skipped** (skip은 DB e2e) |
| `corepack pnpm --filter api build` | 통과 |
| `prisma validate` | `DATABASE_URL`이 없으면 P1012(환경 문제). `DATABASE_URL=postgresql://x:x@localhost:5432/x`를 주면 valid |
| `prisma migrate diff --from-schema-datamodel <현재 schema에서 startTime·endTime 4줄을 뺀 것> --to-schema-datamodel prisma/schema.prisma --script` | stdout이 `20261101120000_s6_event_times/migration.sql`의 머리 주석 4줄을 뺀 본문과 **같음**(`diff` 0줄). `drop` 0건(대소문자 무시). NOT NULL·DEFAULT·데이터 변경 없음 |
| 같은 방법으로 HEAD schema → 위 「직전」 schema | `20261031230000_s6`와 주석·빈 줄을 빼고 같음. 파일 mtime 10-31 23:00, 손대지 않음 |
| 독립 프로브 `scratchpad/probe/qa.probe.ts`(별도 vitest config, 저장소 파일 변경 없음) | 7/7 통과(아래) |

프로브(FakePrisma):
- P1: 무작위 일정 60행(시각 null·00:00·08:00·21:00·23:59, 기간 1–3일, id 역순). `/events` 순서 = core `compareEventSchedule` 정렬. limit 1–7로 끝까지 넘겨도 누락·중복 없음. `/calendar`의 일정 순서도 같고, 모든 항목에 `start_time`·`end_time` 키가 있음
- P2: 다른 목록 커서(notices 2종, patch-notes 2종, audit-logs, results-pending, no-show-scrims)에 null을 넣으면 모두 400 path cursor. `list-cursor.ts`에서 null을 허용해도 기존 디코더의 null 거부는 깨지지 않았다(`cursorDate`·`cursorId`·`typeof` 검사)
- P3: `events2` 커서 날짜가 `2026-13-45`이면 fake에서는 200(아래 minor 2)
- P4: PATCH에서 합친 값에 기간 오류와 `end_time`만 있는 오류가 같이 있으면 details는 `ends_on` 하나. 여러 날 일정의 시각 역순(21:00 → 10:00)은 허용, 하루로 줄이면 400 path end_time, 같은 시각 21:00–21:00은 허용. 없는 id는 404, 멤버는 403(403이 404보다 먼저)
- P5: upcoming `my_status`는 요청한 운영진의 값(A는 waitlist, B는 null). 비로그인은 401
- P6: `/calendar` 비로그인 401, 봇 키 401. month 형식 오류(2026-13, 1999-12, 2100-01, 2026-1)와 game=valorant는 400. 2027-03 격자는 03-01(월)부터 04-04(일)
- P7: 홈 news 이벤트 행에 `start_time:null`·`end_time:null` 키가 있음

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | `apps/api/src/modules/news/news.service.ts:564-578` `updateEvent` | 합친 값 검사(D300)가 동시에 들어온 PATCH 사이에서도 지켜져야 한다 | `findUnique`로 잠금 없이 읽은 값으로 `eventScheduleIssues`를 검사한 뒤 보낸 필드만 update한다. DB CHECK도 없다(마이그레이션은 ADD COLUMN만). 그래서 두 운영진이 동시에 PATCH하면 규칙을 어긴 행이 저장될 수 있다. 예: 저장값이 11-08~11-10, 09:00/10:00일 때 A가 `{ends_on:'2026-11-08'}`(합친 값은 같은 날 09:00–10:00이라 통과), B가 `{start_time:'21:00'}`(합친 값은 여러 날이라 통과)을 같은 때 보내면, 결과는 하루짜리 21:00–10:00 역순이 된다. EventView parse는 순서를 보지 않으므로 500은 나지 않고 표시만 이상해진다. 기간 검사(S6 8-1)에도 이미 같은 방식이 있었고, 운영진 전용·드문 경합이다 | 코드 읽기. FakePrisma로는 재현할 수 없다. 해결안: 트랜잭션 안에서 `SELECT … FOR UPDATE`로 읽거나, `updateMany` where에 읽은 4개 값을 조건으로 넣는다 |
| 2 | minor | `news.service.ts:231` (events2 커서). 기존 patch-notes 커서 `:193`도 같음 | 날짜 자리가 달력에 없는 날이면 400 path cursor | `ISO_DATE_RE`(`^\d{4}-\d{2}-\d{2}$`)만 보므로 `2026-13-45`가 통과한다. `toDbDate`가 Invalid Date를 만들고, 실제 Prisma는 Invalid Date 인자를 PrismaClientValidationError로 거부하므로 500일 가능성이 높다(미확인). fake는 200 | P3. 조작한 커서로만 생긴다. shared `IsoDate.safeParse`로 바꾸면 된다 |

## (A) 이의 제기 제거 D281

- `grep -rni dispute`(node_modules·dist·.next·migrations 제외)로 남은 것은 다음뿐이다. 서비스·컨트롤러·ApiPath·오류 코드·감사 action에는 0건
  - 제거됐다는 주석: core `result-review.ts:7`·`index.ts:12`, shared `admin.ts:102`·`scrims.ts:469`·`errors.ts:68`·`paths.ts:67`·`transitions.ts:64`, api `scrim-results.service.ts:460`
  - 계약상 남기는 것: shared `DisputeStatus` enum(계약 7절 298행 「남는 것」), Prisma 모델·enum·관계
  - 회귀 테스트: shared `contract.s6.test.ts` 90·91·122·186·188·339·340행, api `scrim-revert.e2e.spec.ts:337-375`, `admin-overview.e2e.spec.ts:77,213,253`, web `mock/admin.test.ts:143-153`
  - fake·도우미: `fake-prisma.ts`의 표·cascade, `s6-helpers.ts`의 `seedDispute`, `admin.db.e2e.spec.ts:84`의 TRUNCATE
- `grep scrimResultDispute apps/api/src` 0건
- 삭제된 3경로가 404인지, 상세에 관련 필드가 없는지, 반려·되돌리기 뒤에도 open 행이 그대로인지: 회귀 테스트가 통과한다. 되돌리기(`result.revert` 감사)·반려(S3)·노쇼(`PUT …/no-show`, `@Roles('admin')`)의 핸들러와 가드는 그대로다
- 엔드포인트 33개 대조. 모든 경로가 `ApiPath` 상수를 쓰고 문자열 리터럴은 없다. ApiPath의 S6 키는 26개다

| 구분 | 엔드포인트 | 컨트롤러(가드) | 수 |
| --- | --- | --- | --- |
| 멤버 | GET notices·patchNotes·events | `news.controller.ts:34-52` JwtGuard | 3 |
| 멤버 | GET calendar | `calendar.controller.ts:9-15` JwtGuard | 1 |
| 멤버 | GET·PATCH myNotificationSettings | `users.controller.ts:37,43` JwtGuard | 2 |
| 운영진 | POST scrimResultRevert | `scrims.controller.ts:230-233` JwtGuard + RolesGuard + `@Roles('admin')` | 1 |
| 운영진 | overview·results·noShowScrims·members·memberRole·apiKeys(GET·POST 201)·apiKeyRevoke(200)·seasons(GET·POST 201·PATCH·DELETE 204)·auditLogs | `admin.controller.ts:44-140`, 클래스 단위 JwtGuard + RolesGuard + `@Roles('admin')` | 13 |
| 운영진 | notices·patch-notes·events 각각 POST 201·PATCH·DELETE 204 | `news.controller.ts:59-132`, 클래스 단위 `@Roles('admin')` | 9 |
| 봇 | pending notices·patch-notes, 각 delivered(200) | `bot.controller.ts:119-146`, ApiKeyGuard + `@BotScope` notices·patchNotes | 4 |
| 합계 | | | **33** (멤버 6 + 운영진 23 + 봇 4) |

## (B) GET /calendar (23절)

- 권한: 비로그인 401, 봇 키 401 UNAUTHENTICATED, 멤버·운영진 200(테스트 + P6)
- 격자: core `resolveCalendarMonth`·`calendarMonthRange`를 쓴다. 월요일 시작, KST. 테스트와 P6(2027-03)로 확인
- 취소 제외: `status in [recruiting, full, playing, finished]`(`calendar.service.ts:25,90`)
- 한도: 일정·내전을 각각 `take MAX + 1`로 읽고, 앞 MAX개만 직렬화하며, `truncated = length > MAX`(`:82-98`). 300·100 경계는 테스트가 있다
- 명단·방장 비노출: `toCalendarScrimItem`이 13개 필드만 담고, 테스트가 키 집합을 고정한다
- 게임 필터: `findUnique({code})`를 쓰고, 행이 없으면 빈 응답이다. `gameId` 조건이 null 일정을 빼고, enum 밖 코드는 400
- 재사용: 일정은 `NewsService.eventViews`(`:66`), 내전은 `ScrimViews.summaries`(`:93`). 날짜는 core `kstDateKey`
- 응답은 `GetCalendarResponse.parse`를 거친다(빈 응답 경로 포함)

## (C) 일정 시각 · 다가오는 일정 (23-8)

- 마이그레이션: 위 「실행한 명령」 참고. 일치하고 DROP 없음
- `toDbTime`·`fromDbTime`(`common/db-date.ts`): `1970-01-01T{HH:mm}:00.000Z` ↔ `toISOString().slice(11,16)`. UTC 고정이라 서버 TZ와 무관하게 벽시계 값이 그대로 왕복한다. null은 null로
- 검사 순서: shared `eventScheduleIssues`는 기간을 먼저 보고 거기서 끝나며, 다음이 end_time만 있는 경우, 마지막이 같은 날 역순이다. 같은 시각은 허용한다(news.ts:283-287). POST는 zod superRefine, PATCH는 합친 값으로 같은 함수를 부른다(`news.service.ts:570-578`). 시각은 `undefined`면 저장값, `null`이면 비움. `{start_time:null}`만 보내면 400 path end_time. 테스트와 P4로 확인
- 정렬: `EVENT_ORDER_BY` 하나를 `/events`(`news.service.ts:263`), `/calendar`(`calendar.service.ts:84`), upcoming(`:116`), 홈 news(`dashboard.service.ts:214`) 4곳이 모두 쓴다. `calendarEvent.findMany`는 이 4곳뿐이다
- 커서: 접두사 `events2`, 값 4개, null 분기·값 분기가 23-8-3 조건과 같다. 옛 `events` 커서와 형식 오류 8종은 400(테스트). 왕복 시 누락·중복 없음(테스트 + P1)
- `list-cursor.ts`에 null을 허용한 영향: 다른 목록은 계속 400(P2). admin-members는 별도 디코더를 써서 영향이 없다
- upcoming(`calendar.service.ts:108-131`)
  - core `upcomingWindow(now, ADMIN_UPCOMING_DAYS)`
  - 일정은 기간이 겹치는 것(진행 중 포함), 게임 무관
  - 내전은 취소 제외, `[now, scrimBefore)`
  - 종류별 `take 6`, core `mergeUpcomingItems(…, 5)`
  - 경계·같은 순간 일정 먼저·has_more·`my_status`·host 비노출은 테스트 + P5로 확인
  - `admin.controller.ts:58`이 `@CurrentUser`를 넘기고, `admin-overview.service.ts:49,61-71`이 `Promise.all`에 넣은 뒤 `GetAdminOverviewResponse.parse`를 거친다. 비운영진 403
- 서버 쪽에 따로 만든 계산식은 없다. calendar·news·admin-overview에서 `KST_OFFSET`·`+09:00`·`DAY_MS`를 grep하면 0건이다. core dist에 4개 함수가 export돼 있다
- 응답 시각 필드(1단계 optional): `eventViews`, 홈 news 이벤트 행, `upcoming`을 api가 항상 채운다(P1·P7 + 기존 `toBeDefined` 테스트). 2단계로 넘어가도 api 쪽에서 깨질 곳은 없다
- 원시 SQL: events·calendar 경로에는 `$queryRaw`가 없다. 모두 Prisma 쿼리다

## 미확인 (DB 없음, 통과로 세지 않음)

- 실제 PostgreSQL에서 다음을 확인하지 않았다
  - `ORDER BY start_time ASC NULLS FIRST`가 생성되는지(Prisma 6.19 `{sort, nulls}`)
  - `start_time > TIME '21:00:00'` 비교와 `IS NOT NULL`
  - `@db.Time(0)` 쓰기·읽기 왕복(Prisma가 Date의 UTC 시각 부분을 쓰는지)
  - `@db.Date` lte/gte
  - 마이그레이션 적용
- 코드를 읽어 본 판단으로는 모두 의도대로일 것으로 본다. DB e2e는 추가되지 않았다
- 결함 2의 실제 응답 코드(500 예상)
- 계약 23-8-7 QA 항목 「2단계 전환 완료」: shared `news.ts:229-230`, `dashboard.ts`(event 시각), `admin.ts:89`가 아직 `.optional()`이다. 2단계는 architect 담당이라 backend 결함으로 세지 않았다. 2단계가 끝난 뒤 다시 확인해야 한다
