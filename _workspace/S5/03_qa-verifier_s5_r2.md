# QA: s5_r2 (S5 수정 r1+r2, D232–D239 교차 검증) — 판정: pass

대상: 계약 `_workspace/01_architect_contract.md` 4·5·7·10·12·14-1·14-2절, 구현 보고서 `02_domain-logic-dev_report.md`·`02_backend-dev_s5.md`·`02_frontend-dev_s5.md`의 「S5 수정 r1+r2」 절, 이전 QA `03_qa-verifier_s5_{core,backend,web}.md`.
blocker·major는 없다. minor 4건(문구·주석 3건, 계약 문구 1건)과 이전 QA에서 아직 열려 있는 minor를 아래에 적었다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·web·api 모두 Done, exit 0 (engines 경고만: Node 20.11 < 22) |
| 패키지마다 임시 `qa-tmp.vitest.config.mjs`(기존 vitest.config.ts와 같은 resolve/ssr/env) → `npx vitest run -c …` → 삭제 | shared 6파일 **134 passed** / core 10파일 **416 passed** / web 27파일 **300 passed** / api 38파일 통과·8 skip(DB e2e), **582 passed / 47 skipped / 0 failed**. 구현 보고서 수치와 같음 |
| `corepack pnpm --filter web build` | exit 0, 12 routes(/rankings 8.38 kB, /settings 10.1 kB) |
| `DATABASE_URL=<가짜> npx prisma validate` | valid |
| `git show HEAD:apps/api/prisma/schema.prisma` → `prisma migrate diff --from-schema-datamodel <S4> --to-schema-datamodel prisma/schema.prisma --script`(stdout) → 주석·빈 줄 빼고 `migrations/20261031120000_s5/migration.sql`과 diff | **같음**. (`--from-migrations`는 shadow DB가 없어 불가) |
| `grep -inE "drop\|discord_link\|code_hash" migration.sql` | 1·3줄 주석뿐. DROP 문장·discord_link_codes 없음 |
| `grep -rlE "discordLinkCodeState\|DISCORD_LINK_CODE\|normalizeDiscordLinkCode\|botLink" packages/{core,shared}/dist` | 0건(dist 재빌드 확인) |
| 실행 뒤 `git status`, `ls */qa-tmp*` | 임시 설정 남지 않음, 빌드로 바뀐 추적 파일 없음 |

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/web/src/components/settings/discord-section.tsx:29 | 계약 10절 표: 미연동이면 설명이 「디스코드로 로그인하면 자동으로 연동돼요.」 | 머리 설명 `DISCORD_LINKED_DESCRIPTION`(「음성 접속 시간이 활동 랭킹에 쌓이고, 내전 시작 알림을 디스코드로 받아요.」)이 상태와 상관없이 늘 보인다. 미연동이면 본문 상자에 미연동 문구가 하나 더 나온다. 미연동 회원에게는 맞지 않는 문장이 함께 보인다. frontend 보고서 「판단 1」에 리더 확인을 요청해 두었다 | 목 DB에서 user.discord_id를 `dev-…`로 바꾸고 /settings |
| 2 | minor(주석) | apps/api/prisma/schema.prisma:641 | D232: 랭킹 시간 = voice만 | `/// … 랭킹 시간은 voice + play.` r1에서 고치지 않고 남았다. SQL에는 영향 없다(migrate diff 같음) | `sed -n 641p apps/api/prisma/schema.prisma` |
| 3 | minor(주석) | apps/api/prisma/migrations/20261031120000_s5/migration.sql:1, packages/shared/src/discord-link.ts:2 | 연동 코드 표·기능 제거는 r2(D237) | 「r1: 연동 코드 표 discord_link_codes 제거」, 「5절(r1에서 축소)」라고 r1로 적혀 있다 | 해당 줄 |
| 4 | minor(계약 문구) | _workspace/01_architect_contract.md:157 (6-1 4번) | 구현과 같은 경계 | 계약은 `lastUsedAt: {lt: now − 60s}`, 구현 api-key.guard.ts:66은 `lte`(이전 QA backend #1을 고친 값, 경계 테스트 api-key-guard.e2e.spec.ts:84 있음). 구현이 맞고 계약 문구만 낡았다. architect가 고칠 일 | `sed -n 157p` |

참고(결함 아님): 명세 `게임 커뮤니티 대시보드 개발 문서.md:127, :151`에 `/bot/link`·연동 코드 흐름이 남아 있다. 계약 「명세 문서 갱신 필요(사용자 확인 후)」 항목이라 사용자 판단 대상이다.

## (1) 연동 코드 기능 제거

저장소 전체 grep `bot:link|/bot/link|discord-link|discord_link|DISCORD_LINK|DiscordLink|DISCORD_ID_ALREADY_LINKED|DISCORD_ACCOUNT_ALREADY_LINKED|code_hash|codeHash|botLink|discordLinkCode|useMyDiscordLink|gcd-mock-discord|discordLinkLockKey|discordLinkCodeState` (node_modules·.next·dist·_workspace 제외)에서 남은 것은 아래뿐이다.

| 남은 곳 | 성격 |
| --- | --- |
| packages/shared/src/contract.s5.test.ts:89–108 | 없어진 export·경로·scope·오류 코드가 **없음**을 확인하는 테스트 |
| apps/api/test/api-key-guard.e2e.spec.ts:104–110 | `/bot/link`·`/me/discord-link`·`/me/discord-link/code` 404 테스트(계약 14절 5번) |
| apps/web/src/lib/api/mock/community.test.ts:259 | 목 두 경로 404 테스트 |
| apps/api/test/integrations/api-key-cli.spec.ts:44–45 | 「모르는 scope: bot:link」 거부 테스트 |
| shared paths.ts:58, enums.ts:44, discord-link.ts:5, bot.controller.ts:29, fake-prisma.ts:51, migration.sql:1, discord-section.tsx:15 | 「만들지 않는다/없앴다」 주석 |
| `discord_linked`(profile.ts:22, profile.service.ts:86, 목 game-accounts.ts:621 등) | S1 프로필 필드(연동 판정 `isLinkedDiscordId`), 제거 대상 아님 |
| `DISCORD_LINKED_DESCRIPTION`(web discord-status.ts) | 설정 2상태 문구 상수 |

- 코드: `apps/api/src/modules/discord-link/` 없음, `app.module.ts`·`bot.module.ts`에 DiscordLinkModule 없음, web `lib/api/discord-link.ts`·`lib/hooks/discord-link.ts`·`lib/discord-link*.ts` 없음. shared `discord-link.ts`의 export는 `isLinkedDiscordId` 하나(계약 5-1).
- scope: `ApiKeyScope` 6개 = `BOT_ENDPOINT_SCOPE` 6개(1:1). `.env.example`·`scripts/api-key.ts`에 `bot:link` 없음.
- 마이그레이션: 위 「실행한 명령」대로 stdout과 같고 `discord_link_codes`·DROP 없음. schema.prisma에 DiscordLinkCode 모델 없음.

### 엔드포인트 8개 일대일

| 계약 4절 | ApiPath | 컨트롤러 | 가드/scope | 소비처 | 응답 parse |
| --- | --- | --- | --- | --- | --- |
| GET /rankings/activity | rankingsActivity | rankings.controller.ts:43 | 클래스 JwtGuard | web `getActivityRanking` → `useActivityRanking` | GetActivityRankingResponse(reader:268, web api/rankings.ts:37) |
| GET /rankings/playtime | rankingsPlaytime | rankings.controller.ts:52 | JwtGuard | `getPlaytimeRanking` → `usePlaytimeRanking` | GetPlaytimeRankingResponse(reader:303, web:43) |
| POST /bot/activity | botActivity | bot.controller.ts:45 | 클래스 ApiKeyGuard, bot:activity | 봇 전용 | service |
| GET /bot/users/lookup | botUserLookup | :56 | bot:users:read | 봇 전용 | service |
| GET /bot/scrims/upcoming | botUpcomingScrims | :63 | bot:scrims:read | 봇 전용 | service |
| GET /bot/rankings/:type | botRanking | :72 | bot:rankings:read | 봇 전용 | GetBotRankingResponse.parse(bot-query) |
| POST /bot/member-events | botMemberEvents | :87 | bot:members | 봇 전용 | service |
| PUT /bot/presence | botPresence | :97 | bot:presence | 봇 전용 | service |

설정 화면은 `useMe()`(GET /me)만 쓴다(D238). ApiPath에 S5 경로는 이 8개뿐이다.

## (2) 활동 랭킹 = 음성만

- ranking-calculator.service.ts:261–270: `SUM(CASE WHEN al.type::text IN (${Prisma.join(ACTIVITY_RANKED_TYPES)}) …) AS voice_sec`. SQL에 `'voice'`·`'play'` 문자열 없음, play 열 없음. `active_days`는 type 조건 없이 모든 type(:266). 주 게임 SQL(:278)도 같은 바인딩.
- entry(:308–316)에 `play_sec` 없음, `total_sec = voice_sec`(core buildActivityRanking). shared refine `total_sec === voice_sec`(rankings.ts:191).
- 봇 activity value = `e.total_sec`(bot-query.service.ts:243).
- 목 community.ts:136–151: `RANKED = new Set(ACTIVITY_RANKED_TYPES)`로 시간·주 게임만 거르고 일수는 모든 type. play 이벤트 생성(:116)은 남김(계약대로).
- `play_sec`·`playSec` 잔재 grep: 「없음」을 확인하는 테스트(community.test.ts:66, activity-rankings.e2e.spec.ts:118, bot.db.e2e.spec.ts:129, contract.s5.test.ts:255–265), core 테스트의 「추가 필드라도 합에 안 들어감」(activity.test.ts:207), 주석(shared rankings.ts:172, core activity.ts:90)뿐. 낡은 주석 1건은 결함 #2.

## (3) `scrim_count` SQL 점검 (눈으로 읽음, DB 미실행)

calculator.service.ts:325–339 `/* gcd:activity-scrims */`:

| 점검 | 결과 |
| --- | --- |
| 셈 규칙(D239) | `sp.status = 'joined'` + `EXISTS (… r.status = 'approved')` + `s.status <> 'cancelled'`. waitlist·cancelled·no_show 참가와 pending·rejected만 있는 내전은 빠진다. rated·게임 조건 없음. 계약 7-1 SQL과 글자 단위로 같다 |
| 기간 | `COALESCE(s.started_at, s.scheduled_at) >= $start AND < $end`. 두 컬럼 모두 `Timestamptz(3)`이고 w.start/end는 core `activityPeriodWindow`의 KST 경계 instant라 비교가 바르다 |
| PostgreSQL 문법·타입 | enum 컬럼(`scrim_status`·`scrim_player_status`·`scrim_result_status`)과 따옴표 리터럴 비교는 정상이고, 리터럴 값 `cancelled`·`joined`·`approved`가 각 enum에 있다(schema.prisma:36–76). `${id}::uuid` 목록 `IN (…)`, `COUNT(DISTINCT s.id)::int`, `SELECT sp.user_id::text … GROUP BY sp.user_id` 모두 허용 문법. 컬럼 `scrim_players.scrim_id/user_id/status`, `scrims.started_at/scheduled_at/status`, `scrim_results.scrim_id/status` 실재. `scrim_players`는 `@@unique([scrimId, userId])`라 DISTINCT가 없어도 같다 |
| 정렬 영향 없음 | `buildActivityRanking`(:280) 뒤, 순위에 든 user id(:286)로만 조회하고 `scrimCounts.get(id) ?? 0`을 붙인다(:315). 정렬·포함 여부에 쓰지 않는다 |
| 음성 0이면 순위 없음 | 순위 0명이면 내전 쿼리도 돌지 않는다(:283, :326) |
| rankable | `JOIN users u … AND ${rankableUserSql}` |
| 봇 detail | `activityDetail`(bot-query.service.ts:300) 0회면 뒷부분 생략. 계약 6-5와 같다 |
| 목 | community.ts:172–191 `mockScrimJoins`가 같은 규칙(승인 결과·joined·취소 아님·`started_at ?? scheduled_at`·내전당 1회), 기간 [start, end) 필터 후 순위 행에만 붙인다(:222) |
| 테스트 | activity-rankings.e2e.spec.ts:235–315 4건 + 봇 :522. fake(fake-prisma.ts:533)는 SQL 조건 문구가 있을 때만 거르므로 SQL에서 조건을 빼면 테스트가 깨진다(backend 보고서의 변이 검사와 같음) |

## (4) 플레이타임 보유자 조각

- 정의 하나: `rankings/playtime-holders.ts` `playtimeHoldersFromSql`(대표·verified·steam 코드·rankableUserSql) + `playtimeHolderWhereSql`(`minutes_total > 0`). 쓰는 곳 셋 모두 이 두 조각만 쓴다: 랭킹 행 calculator.service.ts:351–352, 미리 갱신 상위 50 :382–383(refresher.ts:61, `RANKING_PLAYTIME_APPS_MAX`), `/steam-apps` steam-apps.service.ts:108–109(owned), :124(ownerCounts). 복제 없음.
- 개수가 같은지: `steam_playtime @@unique([gameAccountId, appId])` + `game_accounts_one_primary_per_user_game`(대표는 사용자·게임별 1개)라 보유자 행 COUNT(*) = 회원 수 = 랭킹 entries 수.
- 이름 규칙: 랭킹(:353–354)과 `/steam-apps`(`ARRAY_AGG(app_name ORDER BY synced_at DESC) FILTER (WHERE … IS NOT NULL AND <> '')[1]`)가 같다. 이 식은 PostgreSQL 문법상 맞다(집계식을 괄호로 감싼 뒤 첨자).
- 보유자 0명: `playtimeEntries`가 null 없이 빈 entries를 돌려주고 `computeAndStore`(:131–141)가 늘 저장한다. reader `playtimeView`(:284–297)는 캐시가 늘 있고, `playtime()`의 `synced_at`은 `cached.syncedAt.toISOString()`이라 null이 아니다. bot-query(:257–267)도 같다. 테스트 activity-rankings.e2e.spec.ts:326(두 번째 요청 SQL 0회), :539(봇).
- 웹: `defaultPlaytimeApp` = shared `pickDefaultPlaytimeAppId`(rankings.ts:281), `resolvePlaytimeApp`·`playtimeAppParam`(주소 생략 비교)이 이 값을 쓴다. rankings-view.tsx:293 select 비활성 = 목록 모름 또는 기본값 null.

## (5) 웹

- SCRIMS 열: 머리 순서 RANK · PLAYER · MAIN GAME · SCRIMS(title = `ACTIVITY_SCRIMS_HINT`) · VOICE TIME · +/−(rankings-view.tsx:487–489, :660–678). 값 `scrimCountText` = 「{n}회」, 0도 「0회」. sm 미만 숨김(:670, :728).
- 모바일 보조 줄: `activityMobileSubText`(rankings.ts:247) 「{d}일 중 {a}일 활동 · 내전 {n}회」, 0회 생략. 주 게임은 `mainGamesLine`으로 있을 때만 줄을 만든다(:723). 상위 3명 카드는 `extraText`(주 게임)만 쓰고 scrim_count는 넣지 않는다(:615).
- 설정 두 상태: `discordStatus(me)` = `isLinkedDiscordId(me.discord_id)`. 연동됨 = 아바타·`@discord_username` + 칩 「연동됨」, 미연동 = 칩 「미연동」 + 「디스코드로 로그인하면 자동으로 연동돼요.」, 버튼·코드 칸·폴링 없음. 머리 설명 문제는 결함 #1.
- 목 응답 구조: 활동·플레이타임 목 모두 shared 응답 스키마로 parse하고(community.ts:228, :302·:318), 보유자 없음 응답 모양(`app {app_id, name: null}`, `total 0`, `me null`, `synced_at`·`stale` = 캐시 값, `playtime_synced_at null`)이 reader와 같다. `/steam-apps` 목과 플레이타임 목은 같은 `MOCK_STEAM_APPS.owner_count`를 출처로 쓴다(scrims.ts:152, community.ts:264–268). 550은 owner_count 0이라 q 없음 목록에서 빠진다. `SEED_VERSION` 9.
- 상수 리터럴: 랭킹·홈·설정 화면 코드에서 300·200·50·5분 같은 정책값 리터럴을 찾지 못했다(갱신 주기는 `RANKING_CACHE_INTERVAL_MIN`, 기본 게임은 `pickDefaultPlaytimeAppId`). `useNow(60_000)`은 화면 다시 그리기 주기라 정책값이 아니다.

## 이전 결함 재확인 (이 폴더 기준)

| 출처 | # | 상태 |
| --- | --- | --- |
| core | 1 TOO_OLD 한도 상수 | **고침.** activity.ts:23 `PRESENCE_PAST_TOLERANCE_MS = BOT_PRESENCE_STALE_AFTER_SEC * 1000`, 테스트도 `PRESENCE_PAST_MS` |
| core | 2 nowPlayingItems 같은 name 순서(관찰) | 그대로(activity.ts:267 2단계 정렬). 계약상 봇 책임이라 결함 아님 |
| backend | 1 last_used_at 60초 경계 | **고침.** api-key.guard.ts:66 `lte`, 경계 테스트 api-key-guard.e2e.spec.ts:84. 계약 문구는 결함 #4 |
| backend | 2 로그인 guildMembershipAt 비원자 | **열림.** auth.service.ts는 findUnique 값으로 판단한 뒤 무조건 update한다(보고서 「이번 범위 아님」) |
| backend | 3 scope 메타데이터 없는 핸들러 거부 테스트 | **열림.** api-key-guard.e2e.spec.ts에 해당 테스트 없음 |
| backend | 4 D228 봇 연결 판정 두 곳 | **열림.** calculator.service.ts:175, dashboard.service.ts:159 |
| backend | 5 계약 5-4 잠금 순서·2절 NOT_FOUND | r2로 5-4가 삭제돼 대상 없음 |
| backend | 6 보유자 0 app 매 요청 SQL | **고침**(D235, 위 (4)) |
| backend 참고 | 목 game-accounts.ts 옛 discord_linked 판정 | **고침.** :621 `isLinkedDiscordId(me.discord_id)` |
| web | 1 409 뒤 오류 문구 남음 | 연동 코드 UI 삭제로 대상 없음 |
| web | 2 /steam-apps 실패·로딩 시 app_id 랭킹 유지 | **고침.** `resolvePlaytimeApp(picked, undefined)` = picked, 오류 화면은 app_id 없을 때만(frontend 보고서, rankings.s5.test) |
| web | 3 모바일 「—」 단독 줄 | **고침.** `mainGamesLine` 빈 문자열 → 줄 없음 |
| web | 4 사용자 바뀔 때 `['me', …]` 쿼리 남음(S5 전부터, 범위 밖) | **열림.** hooks/auth.ts:19 조건 그대로 |
| web 리더 참고 | /steam-apps가 모든 행 groupBy | **해소**(D234, 위 (4)) |

## 미검증 (DB 필요)

`test/db/bot.db.e2e.spec.ts` 5건(같은 키 동시 2요청, presence 순서 역전, bigint·AT TIME ZONE, 내전 수 SQL, 보유자 SQL)은 PostgreSQL이 없어 skip이다. 새 원시 SQL(`gcd:activity-scrims`, `gcd:steam-apps-owned`, `gcd:steam-apps-owner-counts`, 조각을 쓰는 `gcd:playtime-*`)은 위 (3)·(4)처럼 눈으로만 검토했다. 문제를 찾지 못했다는 뜻이고, 실행해서 확정한 것은 아니다.

사용 가능 도구: Read, Bash, Write, SubagentHandback.
