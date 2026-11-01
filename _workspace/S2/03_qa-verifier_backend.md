# QA: S2 apps/api 백엔드(내전 + 인증 보완 2건) — 판정: pass

대상: `apps/api/src/modules/{scrims,games}/**`, `src/common/scrim-lock.ts`, `src/config/env.ts`, `modules/auth/refresh-token.service.ts`, `modules/game-accounts/steam-link*.ts`·`game-accounts.controller.ts`, `test/**`
기준: 계약 `_workspace/01_architect_contract.md`(S2 2·4·5·6·9·11·12절, D73–D96), shared `scrims.ts`·`game-catalog.ts`·`paths.ts`·`transitions.ts`, core QA `_workspace/03_qa-verifier_core.md`「참고」
구현 보고서: `_workspace/02_backend-dev_scrims.md`

판정 근거: blocker 0, major 0, minor 4. **DB e2e(동시성·잠금 SQL 실동작·마이그레이션 적용)는 PostgreSQL이 없어 미실행 — 통과로 보지 않는다.** 동시성 보장은 코드 정적 확인까지만 했다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter api typecheck` | `tsc -p tsconfig.json --noEmit` 출력 없음, exit 0 |
| `corepack pnpm --filter api test` | **Test Files 21 passed \| 4 skipped (25), Tests 331 passed \| 27 skipped (358)**, exit 0. `test/scrims.e2e.spec.ts` 38 tests, `test/auth.e2e.spec.ts` 48 tests 통과. skipped 4 파일 = DB e2e(`test/db/**`) |
| `DATABASE_URL=… corepack pnpm --filter api exec prisma validate` | `The schema at prisma\schema.prisma is valid` |
| `corepack pnpm --filter @gcd/shared test` | Test Files 3 passed, Tests 53 passed |
| `corepack pnpm --filter @gcd/core test` | Tests 148 passed |
| DB e2e `test/db/scrims.db.e2e.spec.ts`, `test/db/auth.db.e2e.spec.ts` | **미실행**(PostgreSQL 없음) |

## 1. 엔드포인트 11개 대조 (계약 4절 ↔ 컨트롤러 ↔ shared)

| 메서드 경로 | 컨트롤러 | 상태 코드 | 요청 parse | 응답 parse | 권한 | 결과 |
| --- | --- | --- | --- | --- | --- | --- |
| GET /games | games.controller.ts:12 | 200 | - | `ListGamesResponse.parse`(games.service.ts:29) next_cursor null, id 비노출 | JWT | 일치 |
| GET /scrims | scrims.controller.ts:42 | 200 | `ListScrimsQuery` pipe | `ListScrimsResponse.parse`(scrims.service.ts:130) | JWT | 일치 |
| POST /scrims | :51 `@HttpCode(201)` | 201 | `CreateScrimRequest` | `ScrimDetail.parse`(scrim-views.service.ts:191) | JWT | 일치 |
| GET /scrims/:id | :61 | 200 | `IdParam` | ScrimDetail | JWT | 일치 |
| PATCH /scrims/:id | :67 | 200 | `IdParam`+`UpdateScrimRequest` | ScrimDetail | 방장(scrims.service.ts:212) | 일치 |
| POST /scrims/:id/join | :77 `@HttpCode(200)` | 200 | `JoinScrimRequest` | ScrimDetail | JWT | 일치 |
| DELETE /scrims/:id/join | :88 | 200 | `IdParam` | ScrimDetail | JWT | 일치 |
| POST /scrims/:id/start | :95 | 200 | `IdParam` | ScrimDetail | 방장·운영진(:353) | 일치 |
| POST /scrims/:id/cancel | :102 | 200 | `IdParam` | ScrimDetail | 방장·운영진(:373), reason host/admin | 일치 |
| PUT /scrims/:id/players/:userId/no-show | :109 `RolesGuard`+`@Roles('admin')` | 200 | `SetScrimNoShowParams`+`SetScrimNoShowRequest` | ScrimDetail | 운영진. 가드가 파이프보다 먼저라 FORBIDDEN이 NOT_FOUND·VALIDATION보다 먼저(계약 4절 주석과 일치) | 일치 |
| GET /me/scrim-restriction | :122 | 200 | - | `GetMyScrimRestrictionResponse.parse`(scrim-restriction.service.ts:58) | JWT | 일치 |

- 경로는 모두 `ApiPath` 상수, 웹 `apps/web/src/lib/api/scrims.ts:31–96`이 같은 상수 + `fillPath`로 호출하고 응답을 같은 shared 스키마로 parse한다(11개 일대일).
- 오류 코드 7개가 `DEFAULT_ERROR_MESSAGE`(app-error.ts:36–42)에 있고 전체 36개. `SCRIM_BANNED`는 `retryAfterSec` → error.filter.ts:86 `Retry-After` 헤더, 본문 `{code,message}`(e2e 확인).
- 사용자 직렬화는 `ScrimUserRef`(id·nickname·avatar_url)만. `usersById`가 discordId를 읽지만 avatar URL 조립에만 쓰고 출력하지 않는다(scrim-views.service.ts:74). e2e가 모든 응답에서 `email|discord` 문자열 부재 확인.
- 오류 판정 순서(계약 표 왼쪽부터): join = 잠금(NOT_FOUND) → NOT_RECRUITING → JOIN_CLOSED → 포지션 VALIDATION → 기존 행이면 포지션 변경 → BANNED(scrims.service.ts:283–298). PATCH = NOT_FOUND → FORBIDDEN → NOT_RECRUITING → VALIDATION → CAPACITY_BELOW_JOINED(:211–231). 계약 5-2·5-4와 일치.

## 2. 상태 전이 추적 (shared 맵 ↔ 갱신 코드)

`status` 갱신 전수(grep `status:`): 모두 `assertScrimTransition`/`assertPlayerTransition` 뒤에 있다.

| 전이 | 코드 위치 | 맵 |
| --- | --- | --- |
| scrims recruiting → full | join :315–318, applyRoster :269–271(정원 축소) | 있음 |
| scrims full → recruiting | applyRoster(취소 :338, 정원 확대 :245) | 있음 |
| scrims recruiting·full → playing | start :360–362, auto-close closeOne :79–80 | 있음 |
| scrims recruiting·full → cancelled | cancel :375–379, auto-close :82–85(not_started) | 있음 |
| scrims playing → finished | 없음(S3 결과 승인) | 맵에 있고 S2 미구현이 맞음 |
| players waitlist → joined | applyRoster :262–265(updateMany 조건 status=waitlist, 행 수 불일치 시 INTERNAL) | 있음 |
| players joined·waitlist → cancelled | leave :335–336 | 있음 |
| players cancelled → joined·waitlist | join :303–307(같은 행, joined_at = now, 대기열 맨 뒤) | 있음 |
| players joined ↔ no_show | setNoShow :402–412 | 있음 |
| (삭제됨) joined → waitlist | 코드 없음 | D79와 일치 |

- 작성은 새 행 insert라 전이 아님. `statusForJoinedCount(1, capacity)`(capacity ≥ 2라 항상 recruiting).
- 불변식 「대기 있으면 joined = capacity, joined ≤ capacity」: 새 참가는 `placeNewParticipant(n, capacity)`, 자리 변화(취소·정원 변경)는 모두 `planRosterAfterChange`로 승격 → 위반 경로 없음. 정원 축소는 CAPACITY_BELOW_JOINED로 막힘.
- 대기 → 승격 때 preferred_positions·joined_at 미변경(updateMany data = status만) — 메인 기본값 7과 일치.

## 3. 잠금·core 호출 (core QA「다음 QA에서 볼 것」)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 명단 변경 경로 7개가 트랜잭션 첫 문장에서 `FOR UPDATE` | 수정 :211, 참가 :283, 취소 :329, 시작 :352, 모집 취소 :371, 노쇼 :392, 자동 마감 closeOne :68 — 모두 `$transaction` 콜백의 첫 문장이 `lockOrNotFound`. SQL은 scrim-lock.ts:34–36 `… FROM scrims WHERE id = ${id}::uuid FOR UPDATE` | grep `lockOrNotFound` 7곳 |
| core 재구현 없음 | scrims.service.ts:2–12, scrim-views.service.ts:2–8, scrim-auto-close.ts:3, scrim-restriction.service.ts:2–7에서 13개 함수 중 13개 import. 대기열 정렬·승격·정원·시작·노쇼·마감·open_positions 계산식이 api에 따로 없다. 슬롯 순서(방장 먼저 → joined_at → user id, views :168–177)는 core 함수 대상이 아니다(계약 4-2 표시 규칙) | 정적 확인 |
| 노쇼 조회 하한 「초과」 | `noShowMarkedAt: { gt: noShowLookbackStart(now, policy) }` | scrim-restriction.service.ts:37 |
| 고정 정원 판단 | `isFixedCapacity = capacityMin === capacityMax` → `canStartScrim({fixedCapacity…})` (start, auto-close, viewer.can_start 3곳 같은 함수) | scrim-views.service.ts:39–41 |
| 1지망 입력 | `preferredPositions[0] ?? null`(joined 행만) → computeOpenPositions | scrim-views.service.ts:99–103 |

## 4. 노쇼 제한·표시 기간

- SCRIM_BANNED 403 + `Retry-After = ceil((until − now)/1000)`(scrim-restriction.service.ts:47–50). 작성(:175, 검증 details 뒤)·새 참가(:298, 기존 행 포지션 변경 뒤)에서만 호출 → 「새 신청·작성만 제한, 포지션 변경·취소 허용」(D83) 일치. e2e로 정확한 초 값·취소 후 재참가 403 확인.
- 표시 기한: `isNoShowMarkWindowOpen(scheduledAt, now, SCRIM_NO_SHOW_MARK_WINDOW_DAYS=7)`, 이미 no_show면 기한 검사 전 200(멱등), 정정은 기한 없음(:397–413). e2e가 정각 허용 / +1ms 409 확인.
- 정책 env 4개(threshold 3, window 30, restriction 7, mark window 7) 양의 정수 검증(env.ts).

## 5. 자동 마감 cron

- `@Cron('*/5 * * * *', { timeZone: 'Asia/Seoul' })`(scrim-auto-close.ts:107) + `onApplicationBootstrap`에서 1회(기다리지 않음).
- 중복 방지: 바깥 트랜잭션 `pg_try_advisory_xact_lock(hashtext('scrim-auto-close'))` 실패 시 무동작(:37–38), 건마다 별도 트랜잭션 + 행 잠금 + `decideOverdueScrim` 재판정(null → 건너뜀). 대상 쿼리 `status IN (recruiting, full) AND scheduled_at <= now − N분`, 오름차순 100건 — 5-5와 일치. 한 건 실패는 `failed++` 후 계속.
- `SCRIM_JOBS_ENABLED`: 엄격 true/false(env.ts strictBool), `ScrimsModule.forRoot`에서 false면 `ScrimAutoCloseScheduler`·`ScheduleModule` 미등록, `ScrimAutoCloser`는 항상 등록(scrims.module.ts:19–35). vitest는 false. e2e `ScrimsModule.forRoot SCRIM_JOBS_ENABLED (D96)` 통과.

## 6. 인증 보완

**9-1 하루 1회 회전**(refresh-token.service.ts:65–80)
- 순서: 쿠키 없음/조회 실패/만료 → INVALID, 폐기 토큰 → `handleRevoked`(10초 유예, 재사용 감지, 로그아웃 폐기 → INVALID = D26)가 **회전 주기 판단보다 먼저** → 그대로 유지.
- `now − created_at < REFRESH_ROTATE_AFTER_HOURS`면 `{kind:'kept'}`, DB 쓰기 없음. AuthService.refresh는 `rotated`일 때만 `refresh`를 넘기고(auth.service.ts:92) 컨트롤러는 그때만 Set-Cookie(auth.controller.ts:73) → 미회전 시 Set-Cookie 없음. 액세스 토큰은 DB 최신 사용자로 생성(`buildTokenResponse(userId)`).
- 회전 시 같은 family·같은 expires_at(절대 30일 유지), 0이면 매번 회전. env는 0 이상 정수.
- e2e: 24시간 미만 미회전·DB 불변, 정확히 24시간 회전·Max-Age, 유예/REUSED, 로그아웃 후 INVALID, 미회전 토큰 절대 만료 — 모두 통과.

**9-2 스팀 popup**(steam-link.service.ts, steam-link-cookie.ts)
- 쿠키 payload `display`(기본 redirect, 옛 쿠키 호환), `return_to = …/steam/callback?state=…[&display=popup]`(state 먼저).
- 콜백 검증 기준 return_to는 **쿠키**의 display로 만든다 → 쿼리 display 변조는 return_to 불일치로 STEAM_OPENID_INVALID(e2e 확인).
- 도착지: 쿠키 유효 → 쿠키 display, 쿠키 없음·깨짐 → 쿼리 `display === 'popup'`일 때만 popup. 목적지는 `config.webOrigin + ('/steam-link/complete' | '/settings') + 고정 쿼리 키`라 **오픈 리다이렉트 없음**(쿼리 값은 경로·호스트에 들어가지 않고 오류 코드는 SteamLinkErrorCode enum + encodeURIComponent).

## 결함

blocker 0, major 0, minor 4.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/api/src/modules/scrims/scrim-auto-close.ts:35–61, :66 | 자동 마감이 커넥션 풀 크기와 무관하게 동작 | 바깥 트랜잭션(advisory lock)이 커넥션 1개를 최대 5분 붙잡은 채 `closeOne`이 **다른 커넥션**으로 새 `$transaction`을 연다. `DATABASE_URL`에 `connection_limit=1`(pgbouncer·서버리스 설정에서 흔함)이면 closeOne이 매번 maxWait(기본 2초) 초과로 실패 → 전부 `failed`, 처리 0건. 기본 풀(cpu×2+1)에서는 문제 없고 S1 `sync-store.ts:217` withProducerLock과 같은 방식이다 | 정적 분석(DB 없음). 배포 env에 connection_limit를 1로 두지 않는다는 운영 메모 또는 `connection_limit ≥ 2` 주석/검증 권장 |
| 2 | minor | apps/api/src/modules/scrims/scrim-restriction.service.ts:37, :62 | 계약 7절 `lastNoShowAt = now 이하 최대값` | 조회 하한(37일) 밖의 노쇼만 있는 사용자는 `last_no_show_at = null`. 판정(restricted·until·recent_count)에는 영향 없음 — core QA 결함 2와 같은 건 | 노쇼가 40일 전 1건뿐인 사용자 → `GET /me/scrim-restriction`의 `last_no_show_at` null. 보고서 요청 2대로 계약 5-6 문구에 명시하면 닫힘 |
| 3 | minor | apps/api/src/modules/scrims/scrims.module.ts:22–25 | `ScheduleModule.forRoot()`를 JobsModule·ScrimsModule 둘 다 import할 때 cron이 한 번만 등록됨을 테스트가 지킨다 | 보고서 3절: 임시 테스트로 확인 후 **삭제**. 현재 D96 테스트는 providers 배열만 본다 | Nest 버전 변경 시 중복 등록이 회귀해도 테스트가 못 잡는다. 두 플래그 모두 true인 상태로 앱을 띄워 `SchedulerRegistry.getCronJobs()` 개수를 보는 테스트 보존 권장 |
| 4 | minor | _workspace/01_architect_contract.md:480 (12절 qa) vs :139·:502 (5-0, D85) | 잠금 경로 수가 한 가지 | 12절은 「9개 변경 경로」, 5-0·D85·구현은 7개(참가·취소·수정·시작·모집 취소·노쇼·자동 마감). 작성은 새 행이라 잠금 대상 아님. 구현 문제 아님, 계약 문구 불일치 | 계약 본문 대조. architect가 12절을 7개로 고치면 닫힘 |

## 미검증(환경) — 통과 아님

- 마지막 자리 동시 참가 `Promise.all(10)`, 동시 취소+참가·정원 확대+참가 불변식, 시작+모집 취소 경쟁, 자동 마감 동시 실행 1회, 잠금 SQL(`::uuid`, `status::text`) 실제 실행: `test/db/scrims.db.e2e.spec.ts`(작성됨, 미실행). FakePrisma는 행 잠금 대신 트랜잭션 직렬화라 인메모리 e2e는 잠금 **호출 여부**만 증명한다.
- 동시 refresh 24시간 경계: `test/db/auth.db.e2e.spec.ts`(미실행).
- 마이그레이션 `20261029120000_s2` DB 적용(미실행). 파일 내 `DROP INDEX` 줄 없음(주석 4행만), 수동 UPDATE 2줄(lol 10/10/10, tft 2/8/8)이 `GAME_SEED`와 같음. Prisma enum `scrim_cancel_reason`(host·admin·not_started) = shared `ScrimCancelReason`.

PostgreSQL이 준비되면 `corepack pnpm --filter api test:db`(또는 DB e2e 설정)로 위 항목을 다시 확인해야 S2 백엔드 동시성 보장이 닫힌다.

## 백엔드 보고서 「계약 변경 요청」 의견

| # | 요청 | 의견 |
| --- | --- | --- |
| 1 | 목록 집계: groupBy 대신 페이지 내전 id IN으로 `scrim_players`(joined·waitlist·no_show) 한 번 조회 | **타당.** 쿼리 수가 더 적고(내전·게임·참가자·방장 4회) N+1 없음. 행 수가 대기열 길이에 비례해 이론상 상한이 없지만 limit와 실사용 규모(정원 ≤ 16)에서 문제 없음. 계약 4-1 문구를 이 방식으로 바꾸는 데 찬성 |
| 2 | `last_no_show_at`은 37일 범위 밖이면 null | **타당**(결함 2). 판정 영향 없음, 안내 표시만. 계약 5-6·shared 주석에 「조회 범위 안의 마지막 노쇼」라고 적을 것. 정확한 값이 필요하면 MAX 쿼리 1개 추가가 대안 |
| 3 | ScrimsModule이 `ScheduleModule.forRoot()`를 직접 import | **타당**(SYNC_JOBS_ENABLED=false일 때도 cron이 필요). 다만 중복 등록 없음 확인 테스트를 남길 것(결함 3) |
| 4 | `viewer.preferred_positions`는 joined·waitlist일 때만, no_show면 `[]` | **타당.** shared 주석 「참가·대기 중일 때」와 일치. no_show 사용자의 포지션은 `players[].preferred_positions`에 그대로 나온다 |
| 5 | `joined_count` = joined + no_show 항상 | **타당.** no_show는 playing·finished에서만 생기고 내전은 모집 중으로 돌아가지 않으므로 모집 중엔 계약 값과 같다 |
| 6 | `POST /join` 본문 없으면 VALIDATION_FAILED | **타당.** shared 주석 「본문은 항상 객체」와 일치하고, 웹 `useJoinScrim`(apps/web/src/lib/hooks/scrims.ts:144)이 항상 `{ preferred_positions }`를 보낸다. 계약 4절 표에 「본문 필수(포지션 없는 게임은 `{}`)」를 적어 두면 봇·외부 클라이언트 혼동이 없다 |
