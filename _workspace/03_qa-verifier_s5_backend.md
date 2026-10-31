# QA: s5_backend (apps/api S5) — 판정: pass

대상: `apps/api/src/**` S5 변경분(bot, discord-link, rankings, dashboard, auth, profile, common guard·decorator·advisory-lock), `apps/api/test/**` S5 테스트, 마이그레이션 `20261031120000_s5`
기준: `_workspace/01_architect_contract.md` 2·4–8·11·12·14절, `_workspace/03_qa-verifier_s5_core.md` 「연결부 메모」, `_workspace/02_backend-dev_s5.md`, `_workspace/02_integration-dev_report.md`
사용 도구: Read, Bash, Write(이 보고서만), SubagentHandback. 코드 수정 없음.

blocker·major 없음. minor 6건(아래). 실제 PostgreSQL 실행은 못 했다(Docker 없음). DB e2e 6건과 원시 SQL 8종은 눈으로만 검토했다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `apps/api`: `corepack pnpm typecheck` | 종료 코드 0 |
| `apps/api`: 임시 `vitest.qa-tmp.config.mjs`(vitest.config.ts와 같은 내용) → `npx vitest run -c …` → 설정 파일 삭제 | 38 파일 통과 / 8 skip(DB e2e), **588 passed / 48 skipped / 0 failed**. 보고서 수치와 같음 |
| `apps/api`: `corepack pnpm build` | 종료 코드 0 |
| `corepack pnpm -r typecheck` | shared·core·web·api 4개 모두 Done |
| `git show HEAD:apps/api/prisma/schema.prisma` → `npx prisma migrate diff --from-schema-datamodel <S4> --to-schema-datamodel prisma/schema.prisma --script`(stdout만) → 주석·빈 줄 뺀 비교 | migration.sql과 **같음** |
| `grep -n DROP migrations/20261031120000_s5/migration.sql` | 3번째 줄 주석 하나뿐. DROP 문장 없음 |
| `prisma validate`(가짜 DATABASE_URL) | valid |
| `ls apps/api/vitest.qa*` | 임시 설정이 남지 않음 확인 |

## (1) 교차 대조: 계약 4절 ↔ 컨트롤러 ↔ 웹 훅

| 계약 | 컨트롤러(파일) | 가드 / scope | 웹 소비처 |
| --- | --- | --- | --- |
| GET /rankings/activity | rankings.controller.ts `@Get(ApiPath.rankingsActivity)` | 클래스 JwtGuard | `lib/api/rankings.ts` getActivityRanking → `useActivityRanking`(GetActivityRankingResponse parse) |
| GET /rankings/playtime | 〃 `rankingsPlaytime` | JwtGuard | getPlaytimeRanking → `usePlaytimeRanking` |
| GET /me/discord-link | discord-link.controller.ts `myDiscordLink` | JwtGuard, no-store | `lib/api/discord-link.ts` → `useMyDiscordLink` |
| POST /me/discord-link/code | 〃 `myDiscordLinkCode`, 201 | JwtGuard + 메서드 OriginGuard | `useIssueDiscordLinkCode` |
| POST /bot/link | bot.controller.ts, 200 | 클래스 ApiKeyGuard, `BOT_ENDPOINT_SCOPE.link` = bot:link | 봇 전용(웹 없음) |
| POST /bot/activity | 〃, 200 | bot:activity | 봇 전용 |
| GET /bot/users/lookup | 〃 | bot:users:read | 봇 전용 |
| GET /bot/scrims/upcoming | 〃 | bot:scrims:read | 봇 전용 |
| GET /bot/rankings/:type | 〃 | bot:rankings:read | 봇 전용 |
| POST /bot/member-events | 〃, 200 | bot:members | 봇 전용 |
| PUT /bot/presence | 〃, 200 | bot:presence | 봇 전용 |

- 11개 모두 일치. 경로는 `ApiPath`만 쓰고, 전역 prefix는 bootstrap.ts `setGlobalPrefix`에서 붙는다. 전역 APP_GUARD가 없어서 봇 경로에 JwtGuard·OriginGuard가 끼어들지 않는다.
- 웹 코드에 `ApiPath.bot*`·`X-API-Key` 사용이 없다.
- `ScrimsModule.forRoot()`를 BotModule이 다시 import하지만 forRootCache가 같은 객체를 돌려준다. 인스턴스와 cron이 늘지 않는다.
- 응답 직렬화: 신규 서비스의 반환은 모두 shared `*.parse`를 거친다(DiscordLink 3곳, BotActivity, BotMembers, BotPresence 2곳, BotQuery 3곳, RankingsReader activity·playtime). 거치지 않는 반환은 찾지 못했다.
- 오류 코드: shared `ErrorCode`에 6개가 추가됐고 HTTP는 401/403/404/410/409/409로 2절 표와 같다. `app-error.ts`·`web/lib/errors.ts`는 Record 타입이라 typecheck가 누락을 막는다(통과). RATE_LIMITED의 `Retry-After`는 error.filter.ts:86에서 붙는다.

## (2) 보안 경계

| 항목 | 확인 위치 | 결과 |
| --- | --- | --- |
| 봇 경로에 JWT·쿠키 불가 | api-key.guard.ts:35-39는 `x-api-key` 헤더만 읽는다. 테스트 discord-link.e2e.spec.ts:58 | 통과 |
| 웹 경로에 API 키 불가 | JwtGuard는 바뀌지 않았다. 테스트 :85 | 통과 |
| 키 원문 로그 없음 | 가드 로그는 :46(클래스·핸들러 이름)과 :70(key_prefix)뿐. `req.apiKey`에 해시·원문 없음 | 통과 |
| code_hash·원문 응답 없음 | status()는 `expires_at`만 준다. issue()는 원문을 발급 응답에서 한 번만 준다. 로그 없음 | 통과 |
| 웹 응답에 discord_id 없음 | 활동·플레이타임 entries `user` = `userRefs`(ScrimUserRef), GetMyDiscordLinkResponse에는 discord_username만 있다. discord_id는 봇의 `botUserRef`에만 있다 | 통과 |
| 퇴장 → 리프레시 토큰 폐기 | bot-members.service.ts:58-60. 조건부 update가 반영되고 최종 상태가 leave일 때만 폐기한다 | 통과 |

## (3) 멱등

| 엔드포인트 | 메커니즘 | 테스트 |
| --- | --- | --- |
| /bot/activity | 미리 읽기 + `ON CONFLICT (idempotency_key) DO NOTHING RETURNING`. RETURNING에 없는 키는 duplicate | bot-activity.e2e.spec.ts:44(재전송 시 행 수 불변), :165(경합) |
| /bot/member-events | `guildMembershipAt lt 최종` 조건부 update, 재전송은 stale | bot-members.e2e.spec.ts:54 |
| /bot/presence | `ON CONFLICT (source) DO UPDATE … WHERE captured_at <` | bot-presence.e2e.spec.ts:43(1행 유지) |
| /bot/link | 성공하면 used, 두 번째는 INVALID | discord-link.e2e.spec.ts:259, :286 |

## (4) rankable 우회 검색

`grep rank_snapshots|activity_logs|steam_playtime|FROM ratings`와 `rating.findMany|rankSnapshot.find|activityLog.*|steamPlaytime.*` 결과:
- 순위 쿼리는 모두 조건을 적용한다: 티어 계정(calculator:206 `user: rankableUserWhere`, 스냅샷 SQL은 그 계정과 합칠 때 걸러진다), ELO(:247), 시즌 종료(season-closer:72), 활동 2종(:273, :281), 플레이타임 2종(:334, :369), 홈 활동 멤버(dashboard:167).
- 순위가 아닌 조회로 분류한 것: sync-store(동기화 대상 선정), steam-apps.service(내전 게임 선택용 보유 수), rating-inputs·scrim-results(레이팅 반영), profile·dashboard `me`·bot lookup(본인 rating), standings 읽기(종료 시점에 rankable로 저장된 표).
- 우회는 없다.

## (5) 원시 SQL 수동 검토 (실행 불가)

| 태그 | 검토 |
| --- | --- |
| activity-insert | `::uuid`·`::activity_type`(마이그레이션 S0 `CREATE TYPE "activity_type"` 확인) 캐스트, `NULL::uuid`, 여러 행 `VALUES ${Prisma.join}`. 숫자 파라미터 int8 → int4 컬럼은 할당 캐스트라 가능. `ON CONFLICT (idempotency_key)`는 `@unique`가 있어 성립 |
| presence-upsert | `${json}::jsonb`, `ON CONFLICT (source)`(`@unique`), `WHERE bot_presence.captured_at < EXCLUDED.captured_at`, `RETURNING id::text`. 문법 정상 |
| link FOR UPDATE | `SELECT id::text …, expires_at … FOR UPDATE`. 정상 |
| activity-totals | 모든 시각 컬럼이 `Timestamptz(3)`라 `(started_at AT TIME ZONE 'Asia/Seoul')::date`는 KST 날짜가 된다. `SUM(int)`는 bigint인데 `num()`이 `Number`로 바꾼다. `COUNT(DISTINCT …)::int`. `al.type = 'voice'`는 enum과 unknown 리터럴 비교라 정상. `SELECT al.user_id::text … GROUP BY al.user_id` 허용 |
| activity-games | `GROUP BY 1, 2`, `al.type::text IN ($n, $m)`. SUM은 `num()`으로 바꾼다 |
| playtime-rows / top-apps | `games.code`가 text(enum 아님)라 `g.code = $1` text 비교 가능. `COUNT(*)::int`, `ORDER BY holders DESC, sp.app_id ASC`(별칭 허용), `LIMIT $n` |
| active-members | `COUNT(DISTINCT al.user_id)::int AS count`(count는 비예약어) |

- core QA 메모의 bigint 문제: `buildActivityRanking`·`buildPlaytimeRanking`에 들어가는 값은 모두 `num()`을 거친다. RangeError 경로는 없다.
- Date 파라미터를 timestamptz와 비교하는 방식은 S4 `ranking-cache.store.ts`와 같다(새 위험 없음).
- 한계: fake-prisma는 SQL을 `/* gcd:… */` 태그로만 고른다(fake-prisma.ts:458). 실제 문법·타입 오류는 DB e2e(미실행)에서만 드러난다.

## (6) backend가 계약과 다르게 한 10건 판단

| # | 판단 |
| --- | --- |
| 1 연결 잠금 순서 | **맞다, 계약보다 낫다.** 발급은 advisory → 코드 행 update(73→87), 연결은 잠금 없는 조회 → advisory → FOR UPDATE(137→139→144)라 두 경로가 「advisory 먼저」로 같다. 코드의 user_id는 바뀌지 않고, :146에서 다시 확인하므로 잠금 없는 조회 때문에 생기는 경합이 없다. 연결의 users 행 update와 로그인·입퇴장의 users 행 잠금 사이에도 순환이 없다(각자 users 행 하나만 잡는다). 같은 snowflake로 두 연결이 겹치면 unique 인덱스 대기가 한쪽으로만 생긴다. architect가 5-4 문구를 고치면 된다(결함 #5) |
| 2 createMany skipDuplicates | 맞다. 트랜잭션 안의 P2002는 트랜잭션을 중단시키므로 ON CONFLICT DO NOTHING + count 0 판정이 유일하게 맞는 방법이다. 충돌 가능한 unique는 code_hash(그리고 앱이 만들지 않는 id)뿐이다 |
| 3 last_used_at 60초 경계 | **결함이지만 minor**(#1). 정확히 60.000초일 때 사전 판정(:63, `< interval`이면 생략)은 통과하고 updateMany(`lt now−60s`)는 0행이 된다. 그 결과 UPDATE 한 번이 헛돌고 기록이 다음 요청으로 밀린다. 계약 「60초 안 재요청은 쓰지 않음」은 지켜지고 데이터 오염도 없다. 어느 한쪽으로 맞추면 된다(`lte` 또는 사전 판정 `<=`) |
| 4 잘못된 :type → 400 | 맞다. 2절 NOT_FOUND 행 본문이 「컨트롤러가 VALIDATION_FAILED로 답한다 — 6-5」라고 스스로 적고 있고, 4-2 표·6-5도 VALIDATION_FAILED다. 실제 충돌이 아니라 문구가 어색할 뿐이다(#5). 가드가 파이프보다 먼저 돌아서 키가 없으면 401이 먼저 나온다 |
| 5 scope 메타 없음 → 403 | 받아들일 만하다. 키 인증 뒤 403 API_KEY_SCOPE_MISSING + error 로그를 남긴다. 정상 키도 통과하지 못하므로 설정 실수를 막는 목적은 달성한다. 이 경로에 테스트가 없다(#3) |
| 6 GameAccountsModule import | 맞다. ProfileModule은 아무것도 export하지 않는다. 프로필과 같은 출처(`GameAccountViews`, `primaryRiotRows`)를 쓴다 |
| 7 verified 검사 | 계약 6-3 문구대로다. 대표가 미확인이면 tiers를 생략한다. 프로필과 다른 점은 architect 판단 사항이고 결함은 아니다 |
| 8 보유자 0 app | 계약 7-2대로다. 보유자 없는 app_id는 요청마다 SQL 1회가 돈다. 이것은 D217 「어떤 게임이든 5분에 최대 1번 계산」과 맞지 않는 계약 자체의 틈이다(#6, architect). 옛 캐시가 한 주기 남는 문제는 다음 주기 `deleteExcept`로 정리된다 |
| 9 ON CONFLICT RETURNING | 계약(건별 결과)이 스킬 문서보다 우선이다. 맞다 |
| 10 refreshed 수 | 집계 로그 수만 다르다. 영향 없음 |

## (7) core 함수 재구현 검사

core QA가 「아직 backend 미사용」으로 넘긴 함수의 사용처를 확인했다: planActivityBatch(bot-activity:48), planMemberEvents(bot-members:31), checkPresenceCapture(bot-presence:25), presenceState·nowPlayingItems(dashboard), discordLinkCodeState(discord-link:149), activityPeriodWindow(calculator, reader). kstMonthWindow는 activityPeriodWindow 안에서 쓰인다. kstDateKey는 계약이 SQL `AT TIME ZONE`으로 정했으므로 쓰지 않는 것이 맞다. 계산식을 따로 구현한 곳은 없다.
- 조건부 update 0행 → 그 사용자 eventIndexes를 stale로 바꾸는 처리: bot-members:54-56에 있다.
- 남은 중복: D228 「봇 연결」 판정이 calculator:180 `botConnected()`와 dashboard:159 두 곳에 따로 있다. core 함수 대상은 아니지만 정의가 하나여야 할 판정이다(#4).

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/api/src/common/guards/api-key.guard.ts:63, :66 | 사전 판정과 updateMany 조건의 경계가 같다 | 판정은 `≥ 60s`면 쓰기를 시도하고 조건은 `lt now−60s`(> 60s)다. 정확히 60.000초에 UPDATE가 0행으로 헛돈다. 기록 간격 보장과 데이터는 이상 없다 | lastUsedAt = now − 60000ms인 키로 요청 → updateMany 호출 1회, count 0 |
| 2 | minor | apps/api/src/modules/auth/auth.service.ts:252-255, :290-293 | 6-6 「guildMembershipAt > now면 그대로 둔다」가 원자적이어야 한다(조건부 where 또는 membership 잠금) | findUnique로 읽은 값으로 판단하고 무조건 update한다. 읽기와 쓰기 사이에 occurred_at > 로그인 now인 퇴장이 커밋되면 그 퇴장을 덮어 left_at이 null로 돌아간다. 창이 밀리초 단위이고 시계 차이가 있어야 해서 영향은 작다 | 코드 읽기(두 요청 교차). 테스트는 순차 시나리오만 있다 |
| 3 | minor | api-key.guard.ts:45-48, test/discord-link.e2e.spec.ts | 「scope 메타데이터 없는 핸들러 거부」 테스트 | 이 경로를 다루는 테스트가 없다(`grep 메타데이터 test/` 0건) | grep |
| 4 | minor | ranking-calculator.service.ts:180, dashboard.service.ts:159 | D228 판정이 한 곳에서 정의된다 | 같은 판정(activity_logs 또는 bot_presence 존재)이 두 곳에 따로 구현돼 있다. 지금은 값이 같다 | 코드 읽기 |
| 5 | minor(문서) | 01_architect_contract.md 5-4 2번 단계, 2절 NOT_FOUND 행 | 구현과 같은 문구 | 5-4는 「FOR UPDATE → advisory」로 적혀 교착 가능 순서다. 구현은 「advisory → FOR UPDATE」로 바르게 했다. 2절 NOT_FOUND 행에 :type이 섞여 있다 | architect가 계약 문구를 고칠 일 |
| 6 | minor(계약 관찰) | 계약 7-2·D217, rankings-reader.service.ts playtimeView | 어떤 app이든 5분에 최대 1번 계산 | 보유자 0인 app_id는 캐시가 없어 요청마다 SQL 1회가 돈다. 임의 app_id 반복 요청으로 늘릴 수 있다(로그인 멤버만 가능) | `GET /rankings/playtime?app_id=<보유자 없음>` 반복 → playtime-rows 쿼리가 매번 실행 |

참고(이 대상 밖): core QA #1(PRESENCE_PAST_TOLERANCE 상수 출처)은 그대로 남아 있다. 웹 목 `apps/web/src/lib/api/mock/game-accounts.ts:620`이 옛 판정식(`!startsWith('dev-')`)을 쓴다. frontend 확인 대상이다.

## 미검증 (DB 필요)

`test/db/bot.db.e2e.spec.ts` 6건(동시 같은 키, 동시 연결, 동시 발급, 발급·연결 교착 없음, presence 순서 역전, bigint·AT TIME ZONE). 원시 SQL 8종의 실제 문법·타입은 PostgreSQL에서 실행해야 확정된다. 위 (5)는 눈으로 읽은 검토라 문제를 찾지 못했다는 뜻이고, 실행해서 확인한 것은 아니다.
