# QA: s6_backend (apps/api S6) — 판정: pass

대상: `_workspace/S6/02_backend-dev_s6.md`의 구현 전체(엔드포인트 35개, JwtGuard D263, 되돌리기, 이의 제기, 시즌, 공지·패치·이벤트, 봇 전송, API 키, 감사, 마이그레이션). 기준: 계약 `_workspace/S6/01_architect_contract.md`(S6) 2·4·5·6·7·8·10·11·12·16절, D241–D280, core QA `_workspace/S6/03_qa-verifier_s6_core.md`.
사용한 도구: Read, Bash, Write(이 보고서), SubagentHandback. 코드는 수정하지 않았다. 프로브는 scratchpad에만 두었다.

blocker·major는 없다. minor 3건은 운영 영향이 작다. DB가 있어야 확인되는 항목(행 잠금 경합, 실제 SQL 실행)은 아래 「미확인」에 따로 적었다. 이 항목들은 fail이 아니라 미실행이다.

## 실행한 명령과 결과 (Node 24.22.2)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm typecheck` (apps/api) | exit 0 |
| `corepack pnpm exec vitest run` (apps/api) | **46 files passed / 9 skipped, 641 passed / 52 skipped**, exit 0 (보고서 수치와 같음) |
| `corepack pnpm build` (apps/api, `tsc -p tsconfig.build.json`) | exit 0 |
| `prisma validate` (가짜 DATABASE_URL) | valid |
| `prisma migrate diff --from-schema-datamodel <HEAD 775507c schema> --to-schema-datamodel prisma/schema.prisma --script` vs `migrations/20261031230000_s6/migration.sql`(머리 주석 4줄 제외) | `diff` 결과 **같음**. `DROP`(대소문자 무시) 0건 |
| shared·core dist 확인(`require`) | ErrorCode 57 = ERROR_HTTP_STATUS 57, ApiKeyScope 8, `finished → ['playing']`, core 새 함수 export됨. dist보다 새 shared src 없음 |
| Prisma `Prisma.sql` 템플릿 프로브 | `ESCAPE '\\'`(TS 소스) → 실제 SQL `ESCAPE '\'`(cooked 문자열, 글자 1개). PostgreSQL `standard_conforming_strings=on`(기본값)에서 올바르다 |
| 독립 HTTP 프로브 `vitest run --config <scratch>/s6be/probe/vitest.probe.config.mts` | 5 passed (아래 P1–P5) |

프로브: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/ecf7f0de-031c-49ed-9801-f3ea7a17127a/scratchpad/s6be/probe/s6.probe.spec.ts`
- P1: 비참가자가 최신이 아닌(없는) result_id로 이의 제기하면 409 SCRIM_DISPUTE_NOT_ALLOWED, 최신 id(반려됨)로 보내면 403 FORBIDDEN(not_participant가 closed보다 먼저)
- P2: 되돌리기를 두 번 하면 두 번째는 409 SCRIM_RESULT_NOT_APPROVED, 감사 1행, 이력 4행에서 0행. 되돌린 결과에 이의 제기하면 409
- P3: 자기 역할을 같은 값으로 바꾸면 200 noop, 다른 값이면 403 ADMIN_SELF_ROLE_CHANGE. 강등된 B가 A를 강등하면 403 FORBIDDEN(잠금 안에서 role을 다시 확인한다)
- P4: DB에서 사용자 행이 사라진 토큰은 401 UNAUTHENTICATED
- P5: closed 시즌 이름만 바꾸면 200, ends_at 변경은 409 SEASON_NOT_EDITABLE, 같은 값을 보내면 200(changed=false). current 시즌에 같은 starts_at을 보내도 200

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | `apps/api/src/modules/admin/admin-seasons.service.ts:112,138,191` (`$transaction` 옵션) | 시즌 쓰기는 대상 행 `FOR NO KEY UPDATE`에서 진행 중 승인·되돌리기의 `FOR SHARE`(scrimWriteTx, 상한 15초)를 기다린다(11-3). 대기 시간이 tx 상한 안에 들어가야 한다(`season-closer.ts`처럼 timeout·maxWait 명시) | Prisma 기본값(timeout 5초, maxWait 2초)을 쓴다. 승인이 몰리면 P2028 → 500 INTERNAL_ERROR가 날 수 있다(재시도하면 된다. 데이터는 깨지지 않는다). `scrim-tx.ts` 주석이 같은 문제를 이미 적어 두었다 | 정적 확인. DB 경합 테스트(`admin.db.e2e` 「시즌 수정 vs 승인」)로만 재현할 수 있다 |
| 2 | minor | `apps/api/src/modules/scrims/scrim-results.service.ts:349-353`(autoResolveDisputes), `apps/api/src/modules/admin/admin-review.service.ts:275-278`(resolve) | shared `transitions.ts` 머리 주석: 「서버는 상태를 바꿀 때 반드시 canTransition(맵, from, to)을 검사한다」. `DISPUTE_STATUS_TRANSITIONS` open→resolved도 같다 | open→resolved 쓰기 3곳에 `canTransition` 검사가 없다(`where status:'open'` 조건부 update라 동작은 맞다). 결과·내전 전이는 `assertResultTransition`·`assertScrimTransition`으로 검사한다 | `grep -n "status: 'resolved'" apps/api/src -r` |
| 3 | minor | `apps/api/src/modules/news/news.service.ts:285,432,554`(update), Prisma `@updatedAt` | 계약 15절: 운영진 쓰기의 now는 APP_CLOCK. create는 `createdAt/updatedAt: now`로 맞췄다 | PATCH의 `updated_at`은 Prisma `@updatedAt`(프로세스 시계)이 넣는다. 감사 `created_at`(APP_CLOCK)과 ms 단위로 다를 수 있다. 운영에서는 APP_CLOCK = systemClock이라 영향이 거의 없다. 고정 시계 테스트에서만 어긋난다 | 정적 확인 |

## 교차 대조 표

### 엔드포인트 35개 ↔ 컨트롤러 ↔ ApiPath ↔ 웹 호출부

| 구분 | 계약 | 컨트롤러(가드) | ApiPath | 웹 `lib/api` |
| --- | --- | --- | --- | --- |
| 멤버 6 | GET /notices·/patch-notes·/events | NewsController(`@UseGuards(JwtGuard)`) | notices·patchNotes·events | news.ts:24,29,37 |
| | POST /scrims/:id/result/disputes 201 | ScrimsController(클래스 JwtGuard) `@HttpCode(201)` | scrimResultDisputes | scrims.ts:182 |
| | GET·PATCH /me/notification-settings | UsersController(JwtGuard) | myNotificationSettings | notification-settings.ts:13,18 |
| 운영진 25 | POST /scrims/:id/result/revert 200 | ScrimsController 메서드 `@UseGuards(RolesGuard) @Roles('admin')`(approve·reject와 같은 방식) | scrimResultRevert | scrims.ts:177 |
| | /admin/* 공지·패치·이벤트 9 | AdminNewsController(클래스 JwtGuard+RolesGuard+@Roles) 201/200/204 | adminNotices·adminNotice·adminPatchNotes·adminPatchNote·adminEvents·adminEvent | admin.ts:109–143 |
| | /admin/* 나머지 15 | AdminController(클래스 JwtGuard+RolesGuard+@Roles) | adminOverview…adminAuditLogs | admin.ts:64–184 |
| 봇 4 | GET pending·POST delivered ×2 | BotController(`ApiKeyGuard`), `@BotScope(notices|patchNotes)`, delivered 200 | botPendingNotices·botNoticeDelivered·botPendingPatchNotes·botPatchNoteDelivered | 웹 호출 없음(봇 전용, 정상) |

합계 35 = 6 + 25 + 4. 웹 호출부 31개(봇 4개 제외), 메서드·경로·응답 스키마 parse가 계약과 모두 같다. 경로 `:id`는 `AdminIdParams`(uuid) parse. HTTP 코드(201 생성, 204 삭제, 200 나머지 POST)가 계약표와 같다.

### 오류 코드 ↔ ErrorCode ↔ HTTP

새 11개가 shared `ErrorCode`, `ERROR_HTTP_STATUS`(403: ADMIN_SELF_ROLE_CHANGE, 나머지 409), api `DEFAULT_ERROR_MESSAGE`에 모두 있고 계약 2절 표와 같다(전체 57). 사용 위치: NOT_APPROVED(revert 2곳), REVERT_NOT_ALLOWED(`revertNotAllowed` 공통), DISPUTE_NOT_ALLOWED·EXISTS(createDispute), DISPUTE_ALREADY_RESOLVED(resolve), ADMIN_*(planRoleChange.code 그대로), SEASON_*(throwIssues), DISCORD_ALREADY_NOTIFIED(3곳). 응답은 모두 shared `*.parse`를 거친다(서비스 반환문 전수 확인).

### 권한 경계 (5절)

- 운영진 25개: 멤버 403(없는 id도), 비로그인 401, 봇 키로 401(UNAUTHENTICATED) — `admin-auth.e2e.spec.ts:52`이 25개를 모두 돌고, `toHaveLength(25)` 단언과 쓰기 0행을 확인한다.
- 봇 4개: JWT만 보내면 401 API_KEY_INVALID, scope 없으면 403, 폐기 키 401 — `bot-announcements.e2e.spec.ts:92`.
- **D263 JwtGuard**(`jwt.guard.ts:37-43`): 원래 하던 `user.findUnique`에 `role` 열만 더했다. 쿼리 수 변화 없음, 성능 비용 없음. 리프레시는 JwtGuard를 거치지 않는다(`auth.service.ts:64-73`이 이미 DB role로 발급). 쿠키 경로·OriginGuard는 바뀌지 않았다. 탈퇴(left_at) 회원은 S0부터 토큰이 유효했다(이번 변경과 무관). 행이 삭제된 회원은 401(P4). 강등 직후 같은 토큰으로 403, 다시 승격하면 200, 토큰 claim admin + DB member는 403(`admin-auth.e2e.spec.ts:77,92`). 그 밖의 `user.role` 사용처(submit 운영진 허용, viewer.isAdmin)도 이제 DB 값을 쓴다. 바라던 효과다.
- 역할 변경(`admin-members.service.ts:177-214`): `admin-roles` advisory → 요청자 role 재확인(FORBIDDEN) → 대상(NOT_FOUND) → `user.count({role:'admin'})` → core `planRoleChange`. ENV 회원 강등 409, 승격은 허용. 동시 맞강등은 하나만 성공(`admin-members.e2e.spec.ts:145`).

## 되돌리기 (6절) 단계별 추적

`scrim-results.service.ts:362-489`, 승인 `:187-326`과 대조.

| 단계 | 계약 | 코드 | 판정 |
| --- | --- | --- | --- |
| 1 | `lockOrNotFound` 내전 FOR UPDATE | :367 | 같음 |
| 2 | approved 행 없음·id 불일치 → NOT_APPROVED | :368-369 | 같음 |
| 3 | 이력 `scrimResultId` | :370(잠금 전에 읽지만 이 결과의 이력은 내전 잠금을 가진 되돌리기만 바꾼다 → 안전) | 같음 |
| 4 | 사용자 advisory 오름차순 → now → 시즌 FOR SHARE, 시즌 여럿이면 rating_mismatch | :376-388, `lockUserRatings`(정렬·중복 제거), `lockSeasonForRevert`(`SELECT closed_at … FOR SHARE`, 닫힌 시즌 `{closed:true}`) | 같음. 승인 순서(내전 → [season-auto-create] → 사용자 → 시즌 FOR SHARE)의 부분열이라 교착이 없다 |
| 5 | later_games(잠금 아래, 모든 시즌, 같은 시각 포함) | `revert-checks.ts:13-38`: 같은 (user, game), `scrimResultId ≠`, `createdAt ≥`. 시즌 조건 없음 | 같음 |
| 6 | core `revertBlockReason`. self → 403 SELF_REVIEW, 나머지 409 + 이유 문구 | :396-406 | 같음 |
| 7 | core `inferRevertOutcomes`(ratedUserIds = 이력, teamByUser = 전체 scrim_players.team, placements) → `planRatingRevert` | :411-440 | 같음. core QA 왕복 프로브의 입력 구성과 같다 |
| 8a | ratings `update({elo,wins,losses})` = plan 값(increment 아님) | :441-445 | 같음 |
| 8b | 이력 deleteMany, 삭제 수 다르면 롤백 | :446-450 | 같음 |
| 8c | `assertResultTransition('approved','reverted')` + 조건부 updateMany 1행 | :463-468 | 같음 |
| 8d | `assertScrimTransition(finished→playing)`, startedAt 유지 | :471-472 | 같음 |
| 8e | open 이의 제기 자동 처리(`DISPUTE_AUTO_RESOLUTION.reverted`, resolvedBy = 운영진) | :475 | 같음(결함 2 참고) |
| 8f | 감사 `result.revert` `{scrim_id, reason, season_id, history:[{user_id, elo_before, elo_after, k_factor, outcome}]}` | :476-483 | 같음 |
| 9 | 커밋 후 `views.detail` | :488 | 같음 |

허용 조건 5개(D242): (a) approved 행 = 단계 2·8c, (b) 7일 = `revertBlockReason` windowDays 7(잠금 뒤 now), (c) 제출자 아님 = self_submitted, (d) closed_at 없음 = FOR SHARE로 읽은 `closed_at`(READ COMMITTED에서 잠금 절은 최신 커밋 행을 다시 읽는다 → 종료 작업이 먼저 닫았으면 season_closed), (e) 전원 마지막 이력 = later_games, (f) ratings 일치 = `planRatingRevert`(elo = eloAfter, 승패 음수 없음, 중복 없음). 모두 잠금 아래에서 판정한다.
경합: 같은 사용자의 다른 내전 승인은 사용자 advisory를 기다린다. 승인이 먼저 커밋하면 later_games 409, 되돌리기가 먼저 커밋하면 승인이 되돌린 ratings를 읽는다(승인은 잠금 뒤에 ratings를 읽는다, :234). 양쪽 모두 일관된다.
상세·큐: `scrim-views.service.ts`와 `admin-review.service.ts`도 같은 core `revertBlockReason`·`disputeBlock`과 같은 `laterGameUsersByResult`를 잠금 없이 쓴다(표시용, 12-7). rating_mismatch는 시도할 때만 나온다. reverted 결과는 `rating_status` waiting/not_rated, changes [], season null(6-4).

## 시즌 (11절)

- create·update·remove 모두 `lockSeasonAutoCreate`(승인 자동 생성과 같은 키 `season-auto-create`) → (수정·삭제) `SELECT … FOR NO KEY UPDATE` → 잠금 뒤 now → `season.findMany` → core `validateSeasonWrite`·`validateSeasonDelete` → 쓰기 + 감사. `seasonPhase`·`seasonEditable`은 목록 응답에, `resolveSeasonAt`은 is_current에 쓴다.
- 서버의 별도 규칙: `changed`(요청에 있고 값이 다른 필드) 계산만 있다. 계약 14-2 정의 그대로다. lead·길이·겹침은 모두 core에서 판정한다(구현자 모호점 10 확인). 판정 순서 not_editable → invalid(details 전부) → overlap, 첫 종류만 응답(`throwIssues`).
- 교착: 승인 = 내전 → [auto-create] → 사용자 → 시즌 FOR SHARE. 되돌리기 = 내전 → 사용자 → 시즌 FOR SHARE. 시즌 쓰기 = auto-create → 시즌 FOR NO KEY UPDATE. 시즌 쓰기는 행 잠금을 쥔 채 auto-create를 기다리지 않으므로 순환이 없다. FOR SHARE와 FOR NO KEY UPDATE는 서로 충돌하므로 직렬화된다. 타임아웃만 결함 1이다.

## 멱등 (8-4, 12-4)

- 봇 delivered: `updateMany({id, discordNotifiedAt:null})` 1행이면 delivered, 0행이면 다시 읽어 already_delivered(저장값) 또는 NOT_FOUND. 행을 만들지 않으므로 행 수가 바뀌지 않는다. 테스트 `bot-announcements.e2e.spec.ts:74`.
- 공지·패치 PATCH에서 notify가 바뀔 때만 `discordNotifiedAt: null` 조건부 updateMany(0행이면 409). 봇 전송과 경합해도 READ COMMITTED 재평가로 0행이 된다.
- API 키 폐기: 조건부 updateMany. 감사는 1행일 때만 쓰고, 이미 폐기된 키는 200. 역할 같은 값이면 noop(감사 없음). 되돌리기를 두 번 하면 409(P2).

## 원시 SQL·Prisma 문법 (눈으로 읽음, DB 실행은 미확인)

- `gcd:admin-member-search`(`admin-members.service.ts:131-134`): `u.nickname ILIKE $1 ESCAPE '\' OR u.discord_username ILIKE $2 ESCAPE '\'`. 패턴은 `\ % _`를 이스케이프하고 앞뒤에 `%`를 붙인다. 문법이 맞고, NULL username은 OR에서 빠진다.
- `gcd:member-scrim-counts`(`:78-86`): enum과 문자열 리터럴 비교, `COUNT(DISTINCT s.id)::int`, `Prisma.join(${id}::uuid)`, GROUP BY. 기존 `gcd:activity-scrims`(D239)와 같은 정의이고 기간·rankable 조건만 없다(계약 12-1: 탈퇴 포함 전체 회원, 기간 없음).
- `ratingHistory.groupBy({ by:['seasonId','scrimId'], where })`: take·skip이 없어 orderBy가 필요 없다. distinct scrim 수를 계산한다(11-4).
- `rankingCache.aggregate({ _max:{computedAt} })` + `count(lastFailedAt not null)`, `startsWith 'rankings:'`(와일드카드 문자 없음): 문법이 맞다.
- `@db.Date`: 쓸 때 `new Date('YYYY-MM-DDT00:00:00.000Z')`, 읽을 때 `toISOString().slice(0,10)`(`db-date.ts`). 필터에도 같은 변환만 쓴다(news·dashboard·bot). 시간대 변환이 없다.
- `ALTER TYPE "scrim_result_status" ADD VALUE 'reverted'`: 마이그레이션 안에서 새 값을 쓰는 문장(DEFAULT, 인덱스 조건, UPDATE)이 없다. `scrim_results_one_active_per_scrim`은 손대지 않았다. docker-compose `postgres:16-alpine`(PG 12 이상은 트랜잭션 안에서 ADD VALUE 허용). 새 값은 런타임 트랜잭션에서만 쓴다.
- FK: patch_notes.game_id RESTRICT, events.game_id SET NULL, created_by·actor_id·reverted_by SET NULL. 계약 3절과 같다.

## core 재구현·rankable 우회

- 되돌리기·이의 제기·시즌·역할·노쇼 미리보기·홈 소식은 모두 core를 호출한다. 계산식을 다시 구현한 곳은 없다.
- 노쇼 후보의 `scheduled_at ≥ now − days` 필터와 `mark_deadline`은 `isNoShowMarkWindowOpen`(`now ≤ scheduledAt + days`)과 같은 식이다. SQL 조건이라 인라인으로 쓴 것이고 경계도 같다.
- rankableUserWhere 우회: 멤버 표는 계약상 탈퇴 포함이다. 봇 패치 수신자 `leftAt: null`은 계약 「left_at IS NULL」을 그대로 쓴 것이다(`rankableUserWhere`와 같은 값). 순위 계산 쿼리는 이번에 바뀌지 않았다.

## 구현자 모호점 판단 (보고서 번호. 리더 질문의 「5」는 보고서 7번)

| # | 내용 | 판단 |
| --- | --- | --- |
| 1 | ADMIN_LAST_ADMIN은 API로 나올 수 없다 | **맞다.** 요청자가 잠금 안에서 admin으로 확인되고 자기 자신은 막히므로, 강등 대상이 admin이면 count ≥ 2다. core 분기는 방어용으로 남겨도 된다. 결함이 아니다 |
| 2 | writeAudit에 `at` 필드 추가 | 계약을 넓힌 것이고 해가 없다. 행위 시각과 감사 시각이 맞으므로 오히려 낫다 |
| 3 | PATCH 감사 before를 잠금 없이 읽음 | 수용한다. 동시 PATCH 두 건일 때 before가 한 단계 늦을 수 있지만 데이터 무결성과는 무관하다. 계약 10-1에 잠금 요구가 없다. 정확히 하려면 `findUnique` 대신 `SELECT … FOR UPDATE`를 쓰면 된다(선택) |
| 4 | 모르는 game 코드는 빈 목록 | 수용한다. 코드는 shared enum이 이미 검증했다. games 행이 없는 것은 시드 문제다. 계약의 400(path game)은 쓰기에만 있다 |
| 5 | delivered 0행인데 null이면 INTERNAL_ERROR | 정상 흐름에서는 일어나지 않는다(null로 되돌리는 경로가 없다). 수용한다 |
| 6 | 감사 목록에서 모르는 action은 빼고 로그 | 수용한다. 그 페이지는 limit보다 짧을 수 있지만 커서는 계속된다 |
| 7 | 비참가자 + 옛 result_id → 403이 아니라 409 | **계약 7-1 순서 그대로다.** 이 정보는 멤버 누구나 볼 수 있는 상세 화면에도 있으므로 새어 나가는 것이 없다. 프로브 P1로 확인했다(최신 id면 403) |
| 8 | 멤버 표 discord_username 저장값 그대로 | D38 위반이 아니다(discord_id 없음). 화면은 `discord_linked`로 판단한다 → frontend QA에서 확인 |
| 9 | 멤버·disputed 큐 메모리 정렬 | D266의 규모 전제(수백 명) 안이다. 수용한다 |
| 10 | 시즌 lead = core 규칙만 | 맞다(core QA, 시즌 절 참고) |
| 11 | RankingCacheStore.summary | 문법이 맞다. DB 실행은 미확인 |
| 12 | FakeTable delete·cascade 추가 | 테스트 지원만 바꿨다. 되돌린 뒤 삭제를 테스트한다 |

## 미확인 (DB·실서버 필요 — 판정에서 빼지 않고 따로 표시)

- `test/db/admin.db.e2e.spec.ts` 5건은 실행하지 않았다(Docker·psql 없음). 해당 항목: 되돌리기 vs 같은 사용자 승인 실제 경합, 시즌 FOR NO KEY UPDATE vs 승인 FOR SHARE, `@db.Date` 왕복, ILIKE ESCAPE, ADD VALUE 뒤 reverted 저장.
- 원시 SQL 2개, `groupBy`, `aggregate`를 실제 PostgreSQL에서 실행하지 않았다(위 「원시 SQL」 절은 눈으로 읽어 문법과 의미만 확인했다).
- `node dist/main.js` 기동은 확인하지 않았다. DI 구성은 AppModule e2e 테스트가 덮는다.
- 웹은 frontend가 병행 작업 중이다. 이번에는 `lib/api` 호출부 경로·메서드·스키마만 계약과 대조했다.
