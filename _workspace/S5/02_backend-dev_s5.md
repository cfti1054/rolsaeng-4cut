# backend-dev 보고서: S5 apps/api

계약: `_workspace/01_architect_contract.md` 4–8, 11, 12, 14절 backend 1–7번.

## 결과

- 엔드포인트 11개 구현(웹 JWT 4개, 봇 X-API-Key 7개), 요약 `community` 블록(architect 임시값 교체), `rankableUserWhere`·`rankableUserSql` 변경, 로그인 `left_at` 복구, 퇴장 시 리프레시 토큰 폐기, 프로필 `discord_linked` = `isLinkedDiscordId`.
- `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api build` 통과.
- api 테스트 **588 passed / 48 skipped / 0 failed**(46파일 중 8 skip = DB e2e). 작업 전 기준선 518 passed / 42 skipped. 신규 70건 + DB e2e 6건(작성만).
- core(logic 산출물) 테스트 415 passed, shared 138 passed(같은 임시 설정으로 확인). `packages/core/src/activity.ts`와 `dist/activity.*` 있음. backend는 core 함수 13개를 호출만 한다(다시 구현하지 않음).
- **실제 PostgreSQL에서는 아무것도 실행하지 않았다(Docker 없음).** 「미실행」 절 참고.
- Node 20.11이 `vitest.config.ts`를 읽지 못해서, 같은 내용의 `.mjs` 설정을 저장소 밖(세션 scratchpad)에 두고 실행했다. 저장소 설정 파일은 바꾸지 않았다.

사용 가능한 도구: Read, Bash, Write, Edit, SubagentHandback.

## 엔드포인트

| 메서드 | 경로 | 가드 / scope | 응답 | 오류 |
| --- | --- | --- | --- | --- |
| GET | /rankings/activity?period= | JwtGuard | GetActivityRankingResponse | 401, 400, 500 |
| GET | /rankings/playtime?app_id= | JwtGuard | GetPlaytimeRankingResponse | 401, 400, 500 |
| GET | /me/discord-link | JwtGuard | GetMyDiscordLinkResponse | 401 |
| POST | /me/discord-link/code | JwtGuard + OriginGuard | 201 IssueDiscordLinkCodeResponse | 401, 403, 409 DISCORD_ACCOUNT_ALREADY_LINKED, 429 RATE_LIMITED + Retry-After |
| POST | /bot/link | ApiKeyGuard · bot:link | 200 PostBotLinkResponse | API_KEY_*, 400, 404 INVALID, 410 EXPIRED, 409 ×2 |
| POST | /bot/activity | bot:activity | 200 PostBotActivityResponse | API_KEY_*, 400 |
| GET | /bot/users/lookup | bot:users:read | 200 GetBotUserLookupResponse | API_KEY_*, 400, 404 |
| GET | /bot/scrims/upcoming | bot:scrims:read | 200 GetBotUpcomingScrimsResponse | API_KEY_*, 400 |
| GET | /bot/rankings/:type | bot:rankings:read | 200 GetBotRankingResponse | API_KEY_*, 400, 500 |
| POST | /bot/member-events | bot:members | 200 PostBotMemberEventsResponse | API_KEY_*, 400 |
| PUT | /bot/presence | bot:presence | 200 PutBotPresenceResponse | API_KEY_*, 400 |
| GET | /dashboard/summary | 그대로 | `community` 블록 실제 값 | 그대로(community 조회 실패는 500) |

봇 컨트롤러는 클래스에 `@UseGuards(ApiKeyGuard)`만 붙였다. JwtGuard·OriginGuard가 없고 쿠키를 읽지 않는다. scope 값은 `BOT_ENDPOINT_SCOPE`에서 가져온다.

## 변경 파일

새 파일(src):
- `common/guards/api-key.guard.ts`, `common/decorators/bot-scope.decorator.ts`(`BotScope`, `CurrentApiKey`, `BotRequest` 타입)
- `modules/discord-link/`: discord-link.service, discord-link.controller, discord-link.module
- `modules/bot/`: bot.controller, bot.module, bot-activity.service, bot-members.service, bot-presence.service, bot-query.service, bot-user-ref

수정(src): `app.module.ts`, `common/advisory-lock.ts`(`discordLinkLockKey`, `membershipLockKey`), `modules/rankings/{rankable-users, ranking-keys, ranking-calculator.service, ranking-refresher, rankings-reader.service, rankings.controller, rankings.module}.ts`, `modules/dashboard/dashboard.service.ts`, `modules/auth/auth.service.ts`, `modules/profile/profile.service.ts`

`common/api-key.ts`는 integration이 먼저 만들었다. 시그니처가 계약 6-1과 같아 그대로 쓰고 수정하지 않았다.

테스트:
- 새 파일: `test/discord-link.e2e.spec.ts`(20, 가드 5건 포함), `test/bot-activity.e2e.spec.ts`(8), `test/bot-members.e2e.spec.ts`(10), `test/bot-presence.e2e.spec.ts`(8), `test/activity-rankings.e2e.spec.ts`(18), `test/bot-query.e2e.spec.ts`(6), `test/support/s5-helpers.ts`, `test/db/bot.db.e2e.spec.ts`(6, 작성만)
- 수정: `test/support/fake-prisma.ts`(S5 표 4개, `user.updateMany`, update 때 discord_id 고유 검사, 관계 필터, 원시 SQL 8종, `rawHooks`), `test/support/fake-table.ts`(관계 필터 `hooks.relations`), `test/rankings.e2e.spec.ts`(refresher 대상 수 +2, 활동 키 2개. 계약 7절에 따른 기대값 변경), `test/db/ranking-cache.db.e2e.spec.ts`(`computeAndStore` 반환이 nullable이 되어 `out?.payload`로 바꿈, 타입만 수정)

## 구현 요점

- **rankable**: `rankableUserWhere = { leftAt: null }`, `rankableUserSql = Prisma.sql\`u.left_at IS NULL\``(별칭 `u` 고정, 주석 있음). 원시 SQL 5종(활동 합계, 활동 게임별, 플레이타임 행, 플레이타임 상위 app, 활동 멤버 수)이 모두 `JOIN users u ON … AND ${rankableUserSql}`을 쓴다. 티어(계정 조회 `user: rankableUserWhere`), ELO, 시즌 종료는 기존 코드에 그대로 적용된다. fake는 SQL에 그 조각이 있을 때만 조건을 적용한다. 조건을 `{}`/`TRUE`로 바꾸면 테스트 2건이 실패하는 것을 확인했다.
- **활동 랭킹**: 키별 고정 키, `rollRankBaseline`의 기준 시작값 = 기간 시작(D216). `RankingsReader.readOrCompute`에 `accept` 술어를 더해, `period_start`가 지금 기간과 다른 payload는 캐시 없음으로 보고 동기 계산한다(실패하면 500). 이 술어를 빼면 테스트 2건이 실패하는 것을 확인했다. SUM은 bigint로 받아 `Number()`로 바꾼다.
- **플레이타임**: 보유자가 0명이면 `computeAndStore`가 저장하지 않고 null을 돌려준다. reader는 이 경우 빈 응답(`synced_at null`)을 준다. refresher는 `topPlaytimeApps(RANKING_PLAYTIME_APPS_MAX)`로 대상을 만들고, 대상 밖 키는 기존 `deleteExcept`가 지운다.
- **봇 랭킹**: `RankingsReader.tierView / eloDefaultView / activityView / playtimeView`(웹 응답과 같은 캐시 행)를 읽어 앞 `limit`명만 준다. 계산 경로는 새로 만들지 않았다. 웹 `tier()`·`elo()`는 같은 view를 쓰도록 바꿨고 동작은 같다(S4 테스트 통과).
- **활동 수신**: `planActivityBatch` → `INSERT … VALUES ${Prisma.join} ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`(enum 캐스트 `::activity_type`). RETURNING에 없는 insert 키는 duplicate로 처리한다.
- **입퇴장**: `planMemberEvents` → 트랜잭션 안에서 사용자 advisory lock(id 오름차순) → `updateMany`(`guildMembershipAt` null 또는 lt) → 0행이면 그 사용자의 applied를 stale로 바꾼다. 최종 상태가 leave이고 반영됐으면 `refreshToken.updateMany(revokedAt: null → now)`.
- **접속 현황**: `checkPresenceCapture` → `INSERT … ON CONFLICT (source) DO UPDATE … WHERE bot_presence.captured_at < EXCLUDED.captured_at RETURNING id`. id는 `randomUUID()`.
- **community**: presence 1행 → `presenceState`, 봇 연결 = presence 행 또는 activity_logs 행, 활동 멤버 = `COUNT(DISTINCT)` + rankableUserSql(chat 포함, `kstWeekWindow`), now_playing = live이고 parse 성공한 playing이 1행 이상일 때 `nowPlayingItems`. 쿼리는 최대 3개다.
- **로그인 복구**: `upsertUser`의 `update`가 함수도 받게 했다. 길드 검사를 실제로 한 로그인만 `leftAt: null, guildMembershipAt: now`를 넣고, 저장값이 now보다 뒤면 그대로 둔다(신규 생성 포함). 로그인은 기존대로 `new Date()`를 쓴다(clock 주입 안 함).

## 계약과 다른 점 · 모호한 점(임의 변경 없이 기록)

| # | 내용 | 처리 |
| --- | --- | --- |
| 1 | 5-4 순서는 「코드 행 FOR UPDATE → advisory lock」이고 5-3 발급은 「advisory lock → 코드 행 update(revoke)」다. 이 두 순서가 동시에 돌면 PostgreSQL 교착이 생긴다(5-5 표 「발급과 연결이 동시: 같은 advisory lock 순서」와도 어긋남) | 연결 쪽을 **잠금 없는 조회로 주인 user_id 확인 → advisory lock → `SELECT … FOR UPDATE` → user_id 재확인** 순서로 했다. 판정·결과는 계약과 같다. DB e2e「발급과 연결이 동시여도 교착 없이 끝난다」를 작성했다(미실행). architect 확인 필요 |
| 2 | 5-3 4번 「code_hash P2002면 새로 뽑아 최대 3회」: 트랜잭션 안에서 P2002가 나면 PostgreSQL 트랜잭션이 중단되어 재시도를 할 수 없다 | `createMany({ skipDuplicates: true })`(ON CONFLICT DO NOTHING)로 넣고 count 0을 충돌로 본다. 최대 3회, 그 뒤 INTERNAL_ERROR. 의미는 같다 |
| 3 | 6-1 4번: 사전 판정은 「`now − lastUsedAt ≥ 60초`」이고 updateMany 조건은 `lt: now − 60s`이다. 정확히 60초일 때 판정은 쓰라고 하고 조건은 0행이 된다(1ms 경계) | 계약 문구 그대로 두었다(≥ 사전 판정 + `lt` 조건). 테스트는 59.999초에 쓰지 않고 60.001초에 쓰는 것만 확인한다. `lte`로 맞출지 확인 필요 |
| 4 | 2절 표 NOT_FOUND 행은 「경로 type이 BotRankingType 밖」이라 하고, 같은 행과 6-5는 VALIDATION_FAILED라 한다 | 6-5대로 **400 VALIDATION_FAILED, details path `type`** |
| 5 | 6-1 「scope 메타데이터가 없는 핸들러에 가드가 붙어 있으면 거부」의 오류 코드가 정해져 있지 않다 | 키 인증을 통과한 뒤 **403 API_KEY_SCOPE_MISSING** + error 로그 |
| 6 | 11절 「BotModule이 ProfileModule(티어 조회) import」: ProfileModule은 아무것도 export하지 않는다 | 프로필과 같은 출처인 `GameAccountsModule`(`GameAccountViews.loadRows/latestRank`, `primaryRiotRows`)을 import했다. ProfileModule은 바꾸지 않았다 |
| 7 | 6-3 tiers 「대표 라이엇 계정(`is_primary && verified`)」: 프로필 S1 규칙(`primaryRiotRows`)은 verified를 보지 않는다 | 봇 lookup은 계약대로 verified도 검사한다. 프로필은 바꾸지 않았다 |
| 8 | 7-2 「행이 0개면 저장하지 않는다」: 보유자 없는 app은 요청마다 1쿼리를 다시 계산한다(캐시가 없음). 그리고 refresher 대상 목록을 만든 뒤 계산 전에 보유자가 0이 되면, 그 키의 옛 캐시가 지워지지 않고 다음 주기까지 남는다 | 계약대로 구현. 후자는 다음 주기 대상에서 빠지면 `deleteExcept`가 지운다 |
| 9 | 계약은 `/bot/activity` 경합을 「RETURNING에 없는 키 → duplicate」로 정했다. nestjs-backend 스킬 4절은 `createMany skipDuplicates` + 개수 응답이다 | 계약(건별 결과, 원시 ON CONFLICT RETURNING)을 따랐다 |
| 10 | `RankingRefresher.runOnce`의 `refreshed` 수는 플레이타임 보유자 0(저장 안 함)도 1로 센다 | 영향은 집계 수뿐이라 그대로 두었다 |

## 테스트가 다루는 것(14절 5번 대조)

- 가드: 헤더 없음·형식 틀림·모르는 키·폐기 키 401, scope 403, JWT Bearer·쿠키만 있는 요청 401, 웹 경로에 API 키로 접근 401, 다른 Origin으로 봇 PUT 200, last_used_at 60초 간격(59.999초에는 쓰지 않고 60.001초에 씀), 기록 실패해도 요청 통과, 응답에 키 원문 없음.
- 연동: 5-5 표 7줄 전부, 하루 10회 → 429 + `Retry-After: 43200` + 자정 뒤 다시 발급, 이미 연동 409, 재발급 시 이전 코드 무효(만료된 미사용 코드도 revoked), 형식 틀린 코드 404, 소문자·하이픈 없는 입력 성공, 실패 시 코드 미소비, P2002 경합 409 + 롤백, 응답·저장에 원문·code_hash 없음, active_code(만료 후 null), 해시 충돌 재시도·3회 실패 500, OriginGuard 403, 프로필 discord_linked.
- 활동: 문서 예시 그대로 created, 재전송 duplicate(행 수 불변), 배치 안 같은 키 3번, 미연동 unlinked, 탈퇴 회원 저장, 7일·300초 경계 ±1ms, rejected 뒤 같은 키 created, stored + 시각 초과 → duplicate, chat 0초, 형식 오류 8종(101건, 모르는 필드, 모르는 게임, 오프셋 없음 등) + details path `events.1.type`, 경합 duplicate(`rawHooks`), api_key_id, games 행 없는 코드 → game_id null.
- 입퇴장: 6-6 표 5줄, leave 후 미폐기 토큰 전부 revoked(이미 폐기된 것은 유지), 조건부 update 0행 → stale·폐기 안 함, membership 잠금 키, 로그인 복구, 시계 차이 유지, DISCORD_GUILD_ID 비면 미변경, 신규 로그인, 탈퇴 회원의 티어·ELO·활동(주·월)·플레이타임·활동 멤버·시즌 종료 standings 제외(프로필은 200).
- 접속 현황: 3 reason, 경계 ±1ms, 조건부 덮어쓰기, 1행 유지, 형식 오류 5종. 요약: not_connected, 정확히 300초 live, 300초 + 1ms stale, now_playing 정렬·최대 5, playing []·JSON 깨짐 → null, 활동 멤버 수(chat 포함·탈퇴 제외·주 경계 ±1ms), 조회 실패 500.
- 랭킹: 활동 주·월 경계, KST 날짜 수, 동점 3단계, main_games 2개·sort_order, bot_connected false/true 빈 목록, 캐시 재사용, 기간 바뀐 읽기 = 재계산 + 지난주 대비 rank_change(같은 주 안에서 기준 유지), 첫 계산 실패 500(기간 바뀐 경우 포함), 플레이타임 대표·verified만·0 제외·비공개 후 값 유지·이름·playtime_synced_at·보유자 없음 응답(캐시 없음)·대상 밖 app 삭제 후 재계산·주간 rank_change, 봇 4종이 같은 캐시·limit·discord_id·detail·web_url·unit, 웹 응답에 discord_id 없음, 검증 400·scope 403.
- lookup 404·탈퇴 회원 left_at·tiers(언랭·부계정 제외)·ratings rank(캐시 없으면 null, 조회가 계산을 일으키지 않음), upcoming 범위 경계·status·정렬·notify_discord_ids 필터(미연동 dev·알림 끔·탈퇴·waitlist·cancelled 제외)·인원 수·url.

## 미실행(DB 필요)

`test/db/bot.db.e2e.spec.ts`(TEST_DATABASE_URL 없으면 skip). 아래 6건은 **실행하지 않았다(통과 여부 모름)**:
같은 키 동시 2요청 → 1행 / 같은 코드 동시 연결 → 1건 성공 / 동시 발급 → active 1개 / 발급·연결 동시 교착 없음 / presence 순서 역전 / 집계 SQL bigint(25,000행 × 86,400초 > 2^31) + `AT TIME ZONE` 날짜 수.
원시 SQL 8종(`::activity_type`, `::jsonb`, `Prisma.join` VALUES, `al.type::text IN (…)`, `COUNT(*)::int`, `LIMIT` 바인딩 포함)은 fake가 흉내만 낸다. 실제 문법·타입 오류는 DB e2e로만 드러난다.

## S5 수정 r1+r2 (계약 D232–D239, 14-1·14-2절 backend) — 2026-10-31

### 결과

- `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api build` 통과.
- api 테스트 **582 passed / 47 skipped / 0 failed**(46파일 중 8 skip = DB e2e). 임시 `.mjs` 설정(세션 scratchpad)으로 실행했고 실행 후 지웠다. 저장소 `vitest.config.ts`는 바꾸지 않았다.
- core(logic r1+r2)가 끝난 뒤 돌렸다(`discordLinkCodeState` 없음, `buildActivityRanking`에서 `playSec` 빠짐 확인).
- 엔드포인트 8개(웹 2: `/rankings/activity`, `/rankings/playtime` + 봇 6). 요약 `community`는 그대로.
- **실제 PostgreSQL에서는 실행하지 않았다(Docker 없음).** `test/db/bot.db.e2e.spec.ts` 5건은 작성만 했다(아래).

### r2 연동 코드 제거 (D237, D238)

- `src/modules/discord-link/` 디렉터리 삭제. `app.module.ts`·`bot.module.ts`에서 `DiscordLinkModule` import 삭제.
- `bot.controller.ts`: `POST /bot/link` 핸들러, `DiscordLinkService` 주입, `PostBotLink*` import 삭제. 봇 엔드포인트 6개.
- `common/advisory-lock.ts`: `discordLinkLockKey`와 주석 삭제. `common/app-error.ts`: 오류 문구 4개 삭제.
- `GET /me/discord-link` 대체는 기존 `GET /me`(코드 변경 없음, D238).
- 테스트: `test/discord-link.e2e.spec.ts` 삭제. 가드 테스트 5건은 새 파일 `test/api-key-guard.e2e.spec.ts`로 옮겼다(웹 경로 목록의 `/me/discord-link`는 `/me`·`/rankings/playtime`으로 바꿈). 같은 파일에 「`POST /bot/link`·`GET /me/discord-link`·`POST /me/discord-link/code` → 404, `GET /me`는 200」 한 건을 더했다.
- `'bot:link'` 픽스처 교체: `activity-rankings.e2e.spec.ts`(scope 없는 키 → `bot:activity, bot:members`), `bot-query.e2e.spec.ts`(→ `bot:activity`), `test/integrations/api-key-cli.spec.ts`(→ `bot:members`·`bot:activity`. 「7개」 테스트 이름을 「6개」로, 「모르는 scope: bot:link」 거부 1건 추가. integration 담당 파일이지만 리더 지시로 고쳤다).
- `fake-prisma.ts`: `DiscordLinkCode` import·표·`$transaction` 목록·`FOR UPDATE` 분기 삭제, 머리 주석 수정.
- `test/db/bot.db.e2e.spec.ts`: 연동 코드 동시성 3건 삭제, TRUNCATE 목록에서 `discord_link_codes` 삭제.

### r1 활동 = 음성만 (D232, D233)

- `ranking-calculator.service.ts` `activityEntries`: 합계 SQL에서 `play_sec` 열 삭제. 음성 합은 `SUM(CASE WHEN al.type::text IN (${Prisma.join(ACTIVITY_RANKED_TYPES)}) …)`(문자열 `'voice'`를 SQL에 박지 않는다). 주 게임 SQL은 원래 `ACTIVITY_RANKED_TYPES`를 쓰고 있었다(확인함). `active_days`는 그대로 모든 type. entry에서 `play_sec` 삭제. 머리 주석 수정.
- fake `gcd:activity-totals`는 이제 SQL에 바인딩된 type 목록만 더한다(SQL이 type을 빠뜨리거나 늘리면 테스트가 잡는다).
- 바꾸지 않은 것: `bot-activity.service.ts`(play 계속 저장), `dashboard.service.ts` `active_members`·`now_playing`.

### r2 `scrim_count` (D239)

- `activityEntries`: `buildActivityRanking`이 순위를 정한 **뒤**, 순위에 든 user id로만 `/* gcd:activity-scrims */` 쿼리를 1번 돌려 `scrim_count`(없으면 0)를 붙인다. 정렬·포함 여부에는 쓰지 않는다. SQL은 계약 7-1 그대로(`s.status <> 'cancelled'`, `sp.status = 'joined'`, `EXISTS … r.status = 'approved'`, `COALESCE(s.started_at, s.scheduled_at)` ∈ [start, end), `rankableUserSql`, `sp.user_id IN (… ::uuid)`).
- fake `gcd:activity-scrims`: 조건 문구(취소 제외·joined·approved)가 SQL에 있을 때만 그 조건을 적용한다. 변이 검사: `EXISTS … approved`를 빼면 테스트 1건이 실패하는 것을 확인했다.
- `bot-query.service.ts`: activity detail = `activityDetail(periodDays, activeDays, scrimCount)` → `{n}일 중 {m}일 활동 · 내전 {k}회`, 0회면 뒷부분 생략(export 함수).

### r1 플레이타임 보유자 조각 (D234)

- 새 파일 `src/modules/rankings/playtime-holders.ts`: `STEAM_GAME_CODE`(calculator에서 옮김, calculator는 re-export), `playtimeHoldersFromSql`(`steam_playtime sp JOIN game_accounts ga … AND ga.is_primary AND ga.verified JOIN games g … g.code = <steam> JOIN users u … AND rankableUserSql`), `playtimeHolderWhereSql`(`sp.minutes_total > 0`). 별칭 `sp`·`ga`·`g`·`u` 고정, 주석에 사용법·바인딩 순서를 적었다.
- 이 조각을 쓰는 세 곳: calculator `playtimeEntries`(`gcd:playtime-rows`), `topPlaytimeApps`(`gcd:playtime-top-apps`), `steam-apps.service.ts`.
- `steam-apps.service.ts`: `owned()`를 `/* gcd:steam-apps-owned */` 원시 SQL로 바꿨다. 보유자 groupBy → `COUNT(*)::int AS owner_count`, name = `(ARRAY_AGG(sp.app_name ORDER BY sp.synced_at DESC) FILTER (WHERE sp.app_name IS NOT NULL AND sp.app_name <> ''))[1]`, `WHERE h.name IS NOT NULL [AND h.name ILIKE $q]`, `ORDER BY owner_count DESC, app_id ASC LIMIT`. q 이스케이프는 `likeContains`(`\`·`%`·`_` 앞에 `\`, PostgreSQL LIKE 기본 이스케이프). `ownerCounts()`는 `/* gcd:steam-apps-owner-counts */`(같은 조각 + `sp.app_id IN (…)`). `resolve()`는 계약대로 바꾸지 않았다. `games.module.ts` 변경 없음(조각은 순수 파일).
- fake: 보유자 조건 3개(`ga.is_primary AND ga.verified`, `g.code = `, `sp.minutes_total > 0`)를 SQL에 그 문구가 있을 때만 적용하는 `holderRows()`로 바꿨다. 새 태그 2개 지원(ILIKE는 패턴 → 정규식 변환). 변이 검사: 조각에서 `AND ga.is_primary AND ga.verified`를 빼면 테스트 2건이 실패하는 것을 확인했다.
- `fake-table.ts` `groupBy`는 `rating-inputs.service.ts`가 계속 쓰므로 남겼다.

### r1 보유자 0명 = 빈 결과 캐시 (D235)

- calculator: `playtimeEntries`는 0행이어도 `{ entries: [], meta: { app: {app_id, name: null}, playtime_synced_at: null } }`. `build`·`computeAndStore`의 null 경로를 없애 반환 타입이 `Promise<RankingCacheRow>`(non-null)이다.
- reader: `readOrCompute`가 non-null을 돌려주고 `readOrComputeRow`는 없앴다(호출부 통합). `PlaytimeRankingView.cached`는 non-null. `playtimeView`는 parse 실패면 INTERNAL_ERROR. `playtime()`의 `synced_at: null` 분기 삭제.
- bot-query playtime: `cached` null 분기 삭제, `synced_at`은 항상 값, `context.app = payload.app`.
- `test/db/ranking-cache.db.e2e.spec.ts`: `out?.payload` → `out.payload`(타입만).

### 테스트 변경(14-1·14-2 backend 표 대조)

| 파일 | 내용 |
| --- | --- |
| `test/activity-rankings.e2e.spec.ts` | 주 경계 테스트: play는 시간에 안 들어가고(a 3000) 활동 일수에는 들어감(2일), play만 있는 회원 순위 없음, 응답에 `play_sec` 키 없음. main_games: play lol 9999초가 있어도 음성 기준이라 들어가지 않음 + 동점 sort_order. 집계 SQL 3종 태그 순서 + 합계·게임별 SQL 본문에 `'voice'`/`'play'` 글자가 없고 `ACTIVITY_RANKED_TYPES` 값이 바인딩됨. **scrim_count 4건**: joined + 승인만(waitlist·cancelled·no_show 참가, pending만·rejected만 결과, 취소 내전 제외, 반려 후 승인은 셈, 친선·스팀도 셈) / 기간 귀속(지난주 일요일 23:59 KST 시작 = 지난주, 월요일 00:00 = 이번 주, started_at null이면 scheduled_at, 다음 주 시작 제외, 월 4회) / 내전만 있고 음성 0이면 순위 없음, 내전 많아도 음성 적으면 아래, 내전 쿼리는 순위에 든 id만 물음 / 탈퇴 회원 제외. 플레이타임 보유자 없음: 빈 결과 캐시 저장, `synced_at` = NOW, 4분 뒤 두 번째 요청은 `gcd:playtime-rows` SQL 0회 추가·쓰기 없음. 대상 밖 app 시나리오에 보유자 0 app 추가(저장 → 다음 주기 삭제 → 다음 요청 재계산, 쓰기 2회). 봇: activity value = 웹 total_sec, activity value = 음성 초(play 50,000초 제외)·detail 「· 내전 2회」/0회 생략, playtime 보유자 없음 `synced_at` = NOW |
| `test/steam-apps.e2e.spec.ts` | `own()`가 실제 대표·확인 스팀 계정을 가진 회원을 만든다(이전에는 계정 없는 steam_playtime 행이라 새 조건에 걸림). 추가 2건: 부계정·미확인·0분·탈퇴 행은 안 셈, q 없음 각 항목 owner_count ≥ 1 그리고 그 app의 `/rankings/playtime` total = owner_count, 상점 결과 owner_count도 같은 조건(0) / 이름 규칙(최신 synced_at의 null·빈 문자열 아닌 이름, 옛 이름으로는 q 검색 안 됨), q의 `%`·`_`는 글자 그대로 |
| `test/api-key-guard.e2e.spec.ts`(새) | 위 가드 5건 이전 + 정확히 60.000초 경계 1건 + 연동 라우트 404 1건 |
| `test/bot-query.e2e.spec.ts` | scope 픽스처만 |
| `test/db/bot.db.e2e.spec.ts` | bigint 검사 `'play'` 대량 행 → `'voice'`, 기대값에서 `play_sec` 삭제·`scrim_count: 0`, play 1행이 시간에 안 들어감. 추가(작성만): 내전 수 SQL 1건, 보유자 SQL(`/steam-apps` ARRAY_AGG FILTER·보유자 0 app 빈 결과 저장) 1건 |
| `test/scrims*.e2e.spec.ts`, `test/db/scrims.db.e2e.spec.ts` | `/steam-apps` 보유자 픽스처 없음(확인만, 변경 없음) |
| `test/profile.e2e.spec.ts` | 변경 없음(`discord_linked` 테스트 통과) |

### QA 지적 확인

- s5_backend #1(`api-key.guard.ts` last_used_at 경계): **이미 고쳐져 있었다.** 66줄 updateMany 조건이 `{ lastUsedAt: { lte: now − 60s } }`라 사전 판정(`< 60s`면 생략, 즉 `≥ 60s`면 쓰기)과 경계가 같다. 정확히 60.000초에 updateMany 1회·count 1·last_used_at = now인 테스트를 추가해 확인했다. 단 계약 6-1 4번 문구는 아직 `lt`라고 적혀 있다(architect 문구 정리 대상).

### 미실행(DB 필요)

`test/db/bot.db.e2e.spec.ts` 5건은 **실행하지 않았다(통과 여부 모름)**: 같은 키 동시 2요청 / presence 순서 역전 / bigint·AT TIME ZONE(voice) / 내전 수 SQL / 보유자 SQL. 새 원시 SQL 4종(`gcd:activity-scrims`의 enum 문자열 비교·`IN (… ::uuid)`, `gcd:steam-apps-owned`의 `ARRAY_AGG … FILTER … [1]`·`ILIKE`, `gcd:steam-apps-owner-counts`, 조각을 쓰는 `gcd:playtime-*`)은 fake가 태그와 조건 문구로만 흉내 낸다. 실제 문법·타입 오류는 DB e2e로만 드러난다.

### 남은 것 · 메모

- QA s5_backend #2(로그인 guildMembershipAt 비원자), #3(scope 메타데이터 없는 핸들러 테스트), #4(봇 연결 판정 두 곳)는 이번 지시 범위가 아니라 손대지 않았다.
- r2로 시작 보고서 위쪽(엔드포인트 11개 표, 연동 관련 줄)은 옛 내용이다. 지금 기준은 이 절이다.

사용 가능한 도구: Read, Bash, Write, Edit, SubagentHandback.

## 수정 이력

- 2026-10-31 S5 r1+r2: 위 「S5 수정 r1+r2」 절 전체. QA s5_backend #1은 이미 `lte`로 고쳐져 있음을 확인(코드 변경 없음, 경계 테스트 1건 추가). #6(보유자 0 app 매 요청 SQL)은 D235 구현으로 해소.

## play 제외(D240)

사용자 결정(2026-10-31): play는 「우리 채팅방 사람들과 같이 한 게임」이라는 보장이 없어 모든 활동 집계에서 제외한다(수신·저장만). 마이그레이션·응답 모양·`/bot/activity` 수신 검증·`now_playing`·봇 detail 형식 변경 없음.

### 변경

| 파일 | 내용 |
| --- | --- |
| `packages/shared/src/rankings.ts` | `ACTIVITY_COUNTED_TYPES = ['voice', 'chat'] as const satisfies readonly ActivityType[]` 추가(`ACTIVITY_RANKED_TYPES` 바로 아래). `ACTIVITY_RANKED_TYPES`·`active_days` 주석을 D240으로 |
| `packages/shared/src/dashboard.ts` | `active_members` 주석 voice·chat만(D240) |
| `packages/shared/src/bot.ts` | play 이벤트 주석: 어떤 활동 집계에도 쓰지 않음(저장만) |
| `packages/shared/src/contract.s5.test.ts` | COUNTED = voice·chat, play 미포함, RANKED ⊂ COUNTED |
| `apps/api/src/modules/rankings/ranking-calculator.service.ts` | `gcd:activity-totals`에 `AND al.type::text IN (${counted})`(`Prisma.join(ACTIVITY_COUNTED_TYPES)`). 행 자체를 거르므로 RANKED ⊂ COUNTED라 voice_sec은 그대로, play만 한 날·회원이 일수·집계에서 빠진다 |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | `gcd:active-members`에 같은 조건. `botConnected`(any activity_logs 행)는 type 무관 그대로. `Prisma` 값 import |
| `apps/api/test/support/fake-prisma.ts` | totals: 값 순서 RANKED → start → end → COUNTED로 파싱, COUNTED 밖 행 무시. active-members: start, end, COUNTED. 목록이 바인딩되지 않으면 아무것도 세지 않게 했다(실제 SQL이 조건을 빠뜨리면 테스트가 실패) |
| `apps/api/test/activity-rankings.e2e.spec.ts` | 주 경계 테스트: a의 play 날 → active_days 2 → 1, play만 g·chat만 c 순위 없음. 새 테스트「play만 한 날 일수 제외·chat만 한 날 포함·play 행 저장됨」. SQL 바인딩 테스트에 COUNTED(`chat`) 바인딩·`play` 미바인딩·리터럴 없음. 봇 activity detail `7일 중 2일` → `1일`(play만 한 날) |
| `apps/api/test/bot-presence.e2e.spec.ts` | 이번 주 활동 멤버: chat만(a)·voice(d) 셈, play만(b) 안 셈(행은 저장됨), SQL 리터럴 없음 |
| `apps/api/test/bot-members.e2e.spec.ts` | 퇴장 테스트에 play만 한 남은 회원 추가 → 활동 랭킹·활동 멤버 1 그대로 |
| `apps/api/test/db/bot.db.e2e.spec.ts` | bigint 테스트에 다른 KST 날짜(10-05)의 play 행·play만 회원 추가, active_days 2·entries 1 유지(**작성만, DB 미실행**) |
| `_workspace/01_architect_contract.md` | 변경 이력 1줄, 6-x play 행, 7절 머리·7-1 SQL·D240 설명 줄, 8절 머리·active_members 행, 14-1 「바꾸지 않는 것」 주석, D233 일수 부분 철회 표시, D240 추가, Q14·Q15 닫음, 명세 갱신 목록 1줄 |

봇 activity detail 생성 코드는 바꾸지 않았다(숫자만 캐시 active_days를 따라 바뀐다).

### 확인 결과(Node 20.11, corepack pnpm, DB 없음)

- `corepack pnpm --filter @gcd/shared build` 통과
- typecheck: @gcd/shared · @gcd/core · api · web 통과
- vitest(패키지 안 임시 .mjs 설정, 실행 후 삭제): shared 134 passed, core 416 passed, api 583 passed / 47 skipped(DB 테스트 8파일)
- `corepack pnpm --filter api build` 통과

### 미실행

- `test/db/bot.db.e2e.spec.ts` 전체(DB 필요). 이번에 바꾼 bigint·play 제외 검사도 실행하지 않았다(통과 여부 모름). `active_members` SQL은 DB 테스트가 없다(FakePrisma로만 확인).

### 수정 이력

- 2026-10-31 D240: 위 절 전체.
