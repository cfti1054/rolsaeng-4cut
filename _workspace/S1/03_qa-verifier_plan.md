# QA 계획: S1 게임 계정 연동·티어 동기화, 프로필·설정 화면

작성: qa-verifier, 2026-10-28
기준: `_workspace/01_architect_contract.md`(이하 "계약", 절 번호는 이 문서), 코드 우선 `packages/shared/src/**`·`apps/api/prisma/schema.prisma`·`apps/api/prisma/migrations/20261028120000_s1/migration.sql`, `_workspace/00_input/slice.md`, 명세 `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서") 2·5·6·8·9장, 목업 `_workspace/00_input/mockup/Profile.dc.html`·`Settings.dc.html`, S0 계획 `_workspace/S0/03_qa-verifier_plan.md`(S0 항목은 회귀로만 재확인).
규칙: `.claude/skills/qa-boundary-check/SKILL.md`. QA는 코드를 고치지 않는다. 근거는 직접 실행한 출력과 파일:줄만.

## 사용 가능한 도구 (실제 확인)

Read, Grep, Glob, Bash(Git Bash), Write. `corepack pnpm` 동작, `node_modules` 설치됨, `npx prisma`(6.19.3) 동작.
없음: Docker·PostgreSQL·Redis → DB 통합 테스트·마이그레이션 적용·BullMQ 실행은 「미실행」. `RIOT_API_KEY`·`STEAM_API_KEY` 없음 → 실제 외부 호출은 「키 필요」. 브라우저 렌더는 도구 한계로 「미실행」(코드·빌드 산출물 정적 검사로 대체).

### 계획 시점 기준선 (2026-10-28 13:44, 구현 전 계약 코드만)
- `corepack pnpm --filter @*/shared test`: 2 files, 34 passed(contract.s1.test.ts 25개)
- `corepack pnpm -r typecheck`: shared·core·web·api Done
- `npx prisma validate`: valid
- `prisma migrate diff --from-schema-datamodel <450b091 schema> --to-schema-datamodel prisma/schema.prisma --script` 출력 = migration.sql 1–62줄(주석·빈 줄 제외) **동일**. 63줄 이후 수동 블록에 부분 고유 인덱스 1개 존재.
- `--from-migrations`는 shadow DB 필요 → 미실행.

## 검증 대상(리더가 보낼 이름)

| target | 구현자 보고서 | 범위 |
| --- | --- | --- |
| `core` | `_workspace/02_logic-dev_s1.md` | `packages/core/src/**` |
| `integration` | `_workspace/02_integration-dev_s1.md` | `apps/api/src/integrations/**`, `apps/api/src/jobs/**`, `apps/api/test/fixtures/{riot,steam}/**` |
| `backend` | `_workspace/02_backend-dev_s1.md` | `apps/api/src/modules/game-accounts/**`, `modules/profile/**`(또는 users), `config/env.ts`, `common/**`, prisma |
| `web` | `_workspace/02_frontend-dev_s1.md` | `apps/web/**` |
| `s1` | 전부 | 교차 대조 + 명세·목업 대조 + 보안 경계 + 계약 13절 qa 항목 전체 |

판정: blocker 또는 major 1개 이상 → `fail`. 환경 때문에 핵심 검사 불가 → `blocked`. 보고서 `_workspace/03_qa-verifier_{target}.md`, 재검증 `_r2`, `_r3`.

---

## A. 기계 검사 (모든 대상에서 먼저, 출력 그대로 기록)

| # | 명령 | 통과 조건 |
| --- | --- | --- |
| A1 | `corepack pnpm install --frozen-lockfile` | lockfile 불일치 없음(`@nestjs/schedule`, `bullmq` 추가분 포함, 고정 버전 표기) |
| A2 | `corepack pnpm -r typecheck` | 4개 패키지 0 오류 |
| A3 | `corepack pnpm -r test` | 실패 0. DB·Redis 필요 테스트는 **skip이 명시적**(조용히 pass 금지). S0 테스트 수(shared 9, web 44, api 135/5 skip)보다 줄지 않음 |
| A4 | `corepack pnpm -r build` | shared → core → api → web 성공 |
| A5 | `corepack pnpm --filter api prisma:validate` (`.env` 또는 DATABASE_URL 필요) | valid |
| A6 | `corepack pnpm --filter api prisma:generate` | 성공 |
| A7 | `prisma migrate diff --from-schema-datamodel <git show 450b091:apps/api/prisma/schema.prisma> --to-schema-datamodel prisma/schema.prisma --script` vs `migration.sql` 수동 블록 앞부분 | 차이 없음(스키마 수정 후 마이그레이션 미갱신 탐지) |
| A8 | **부분 고유 인덱스**: `grep -n 'game_accounts_one_primary_per_user_game' migration.sql` | `CREATE UNIQUE INDEX … ("user_id","game_id") WHERE "is_primary"` 1줄 존재, 「수동 추가」 블록 안. `grep -rn 'DROP INDEX "game_accounts_one_primary_per_user_game"' apps/api/prisma/migrations` 결과 0 |
| A9 | 마이그레이션 디렉터리 | `20261028000000_s0`, `20261028120000_s1` 외 새 디렉터리가 생겼다면 그 SQL에 위 DROP INDEX가 없는지, S0 마이그레이션 SQL이 바뀌지 않았는지(`git diff 450b091 -- apps/api/prisma/migrations/20261028000000_s0`) |
| A10 | 비밀값·실제 식별자: `grep -rnE "RGAPI-[0-9a-f-]{8,}" --exclude-dir=node_modules --exclude-dir=.next .`, `grep -rnE "key=[A-F0-9]{32}" …`, `.env` 미추적(`git ls-files .env`) | 0건 |
| A11 | DB 필요 테스트(동시 sync 5회 경계, P2002, 부분 고유 인덱스가 대표 2개 거부, 작업자 DB 기록) | **미실행** — 존재·내용만 정적 확인 |
| A12 | 실제 라이엇·스팀·Steam OpenID 왕복 | **키 필요** |

---

## B. core (`core` 대상, 계약 10절)

- [ ] 7개 함수 export·시그니처 = 계약 10절(`kstDayWindow`, `buildSyncQuota`, `computeMainPosition`, `pickVerificationIcon`, `toRankValue`, `isSameRank`, `isMatchesCacheStale`). I/O·`Date.now()`·`Math.random` 직접 호출 없음(`grep -n "Date.now\|new Date()\|Math.random" packages/core/src`).
- [ ] **KST 경계**(`kstDayWindow`): UTC 14:59:59.999Z(=KST 23:59:59.999) → start 전날 15:00Z, UTC 15:00:00.000Z(=KST 00:00) → start 그 시각, end = start+24h. 테스트에 두 경계값 모두 존재. 서버 TZ에 의존하지 않음(`getTimezoneOffset`·로컬 `setHours` 사용 금지 — grep). `TZ=America/New_York`·`TZ=UTC`로 core 테스트 각각 실행해 결과 동일.
- [ ] `buildSyncQuota`: remaining=max(0,limit−used)(used>limit 케이스 포함), `resets_at` 정확히 `YYYY-MM-DDT00:00:00.000+09:00`, shared `SyncQuota.parse` 통과. KST 23:59:59.999 입력 시 다음 날 날짜.
- [ ] `computeMainPosition`: 최신순 앞 20개만(21번째 무시 테스트), null 제외 sample_size, 0이면 null, 동률은 `LolPosition` 순서(top<jungle<mid<bot<support), 최대 2개, ratio 소수 둘째 자리 반올림(예: 1/3→0.33, 2/3→0.67), `source:'riot_ranked_solo'`, 결과가 shared `MainPosition.parse` 통과.
- [ ] `pickVerificationIcon`: 결과 ≠ 현재 아이콘, 범위 0–28, random 0 / 0.999… 경계, 현재 아이콘이 후보 밖(예: 4000)이면 29개 중 선택.
- [ ] `toRankValue`: undefined→UNRANKED 0/0/0 division null, MASTER/GRANDMASTER/CHALLENGER의 rank 'I' → division null, 모르는 tier·rank → 예외. 결과가 shared `RankValue.parse` 통과.
- [ ] `isSameRank`: 5개 필드 각각 하나만 달라도 false.
- [ ] `isMatchesCacheStale`: null→true, 정확히 6h → true(≥), 6h−1ms → false.
- [ ] shared 상수 재사용(`RIOT_VERIFICATION_ICON_IDS`, `RECENT_MATCHES_MAX`, `RECENT_MATCHES_TTL_HOURS`, `RIOT_APEX_TIERS`) — 값 복제 없음.

---

## C. integration (`integration` 대상, 계약 6·9절, 13절 integration)

### C1. 계약 인터페이스
- [ ] `apps/api/src/integrations/contracts.ts` 타입이 계약 9절과 일치(메서드 이름·인자·반환, `CallMode`, `ExternalErrorKind` 6종, `SyncJobKind` 4종, `SyncJobReason` 5종, DI 심벌 4개).
- [ ] 외부 응답은 zod로 필요한 필드만 파싱, 형식 불일치 → `bad_response`.

### C2. 클라이언트·라우팅
- [ ] 호스트: Account-V1·Match-V5 = `{RIOT_REGIONAL_ROUTING}.api.riotgames.com`, Summoner-V4·League-V4·TFT-League = `{RIOT_PLATFORM_ROUTING}.api.riotgames.com`(하드코딩 `asia`/`kr` 없음 — env에서).
- [ ] 키는 헤더 `X-Riot-Token`(쿼리 문자열 금지 — 로그 유출 방지). 스팀 키는 쿼리지만 로그에 URL 원문 미기록.
- [ ] Match ids 쿼리 `queue=420&type=ranked&count=20`, League는 `RANKED_SOLO_5x5`·`RANKED_TFT`만 사용.
- [ ] GetOwnedGames `include_appinfo=1&include_played_free_games=1`. `{"response":{}}`(game_count 없음) → `visibility:'private'`, `game_count:0` → public + 빈 배열. `playtime_2weeks` 없으면 0.
- [ ] 타임아웃 `EXTERNAL_API_TIMEOUT_MS`(AbortSignal 등) 모든 외부 호출(Data Dragon, OpenID 포함).
- [ ] 보고서에 I1–I5 확인 결과·URL·날짜, 실제 호출은 「키 필요」 표기.

### C3. 429·재시도·분류 (계약 6-4) — 가짜 타이머 테스트로 확인
- [ ] **429**: `Retry-After`(없으면 60초)만큼 **그 호스트만** 일시정지, 즉시 재시도 없음(호출 횟수 단언). 같은 작업 3번째 429 → `PROVIDER_RATE_LIMITED` 기록. interactive 모드는 `ExternalApiError{kind:'rate_limited', retryAfterSec}` → backend가 GAME_PROVIDER_RATE_LIMITED + Retry-After.
- [ ] 토큰 버킷: 호스트별 2개(초당·2분당), interactive는 3초 넘게 기다려야 하면 즉시 rate_limited(예상 대기 초).
- [ ] **401/403 재시도 없음**(호출 1회 단언) → background `PROVIDER_AUTH_FAILED`, interactive `auth`.
- [ ] 5xx·타임아웃: background 지수 백오프 1·2·4초 3회 후 `PROVIDER_UNAVAILABLE`, interactive 1회 재시도 후 `unavailable`.
- [ ] 404: 계정 조회 → `not_found`(ACCOUNT_NOT_FOUND), 리그 빈 배열은 오류 아님 → UNRANKED.
- [ ] 스팀은 버킷 없이 429·5xx 규칙만.

### C4. Steam OpenID 검증 (`verifyOpenIdAssertion`, 계약 5-2 4·5단계)
- [ ] ns·op_endpoint(`STEAM_OPENID_ENDPOINT`)·return_to(정확히 일치)·claimed_id(`STEAM_CLAIMED_ID_PATTERN`)·identity=claimed_id 검사, 하나라도 다르면 `{ok:false}`(외부 호출 전).
- [ ] check_authentication: 받은 openid.* 그대로 + mode만 교체, form POST, 본문에 `is_valid:true` **줄**이 있을 때만 ok(`is_valid:false`, 부분 일치 `xis_valid:true` 거절). 네트워크·5xx → ExternalApiError.

### C5. 큐·작업자 (계약 6-1~6-3)
- [ ] `InProcessSyncQueue`: 우선순위 순서, 제공자별 동시 1, 같은 키 중복 제거(테스트). BullMQ: 큐 `external-sync`, jobId `{kind}:{행 id}`, manual/link `manual:{행 id}` — 작성만, 실행 미확인 표기.
- [ ] `REDIS_URL` 빈 값 → in-process 선택, 연결 시도 없음.
- [ ] 작업자 잠금 SQL: `WHERE id IN (…) AND (sync_state<>'running' OR sync_state_at < now()-10분)`, 영향 0행이면 건너뜀. lol·tft 두 행 함께 변경, `sync_state_at=now`.
- [ ] **상태 전이 전수 검색**: `grep -rn "syncState\|sync_state" apps/api/src` → 모든 갱신이 `GAME_ACCOUNT_SYNC_STATE_TRANSITIONS`에 있는 전이인지 표로 정리(아래 계약 불일치 P1 참고 — 멈춘 작업 정리의 running→queued).
- [ ] 결과 저장: 티어 `toRankValue`+`isSameRank`일 때만 새 snapshot(D55), 언랭도 저장, `last_synced_at` 성공마다 갱신. 실패 시 `last_sync_error/_at` 두 행 기록, **기존 데이터 삭제 없음**(스팀 비공개 시 steam_playtime 유지). 전부 성공 시 error null.
- [ ] `riot-full`: display_name 갱신 → lol 티어 → tft 티어 → **대표일 때만** 전적. `riot-tier`: 부계정 포함, 계약 6-2 SQL 순서(활동 → is_primary DESC → last_synced_at NULLS FIRST), 55분 조건.
- [ ] `riot-matches`: 없는 매치만 상세 조회, played_at=gameEndTimestamp(없으면 Start), placement null, 계정당 최신 20개만 유지, `summary`가 shared `LolMatchSummary.parse` 통과하는 형태로 저장, `matches_synced_at=now`.
- [ ] 계정이 사라진 경우 작업은 아무 것도 하지 않고 종료(해제 경합).
- [ ] cron: `0 * * * *`·`0 5 * * *`·5분 정리, `timeZone: 'Asia/Seoul'`, `pg_try_advisory_lock` 획득 시에만 실행·해제, `SYNC_JOBS_ENABLED=false`면 등록 안 함(테스트).
- [ ] 로그에 PUUID·스팀 ID 원문 대신 game_account id(`grep -rn "puuid" apps/api/src | grep -i "log"`).

### C6. fixture (계약 13절 integration 5)
- [ ] 정상, 언랭, MASTER(rank 'I' 무시), 429(+Retry-After), 401, 5xx, 스팀 비공개 `{"response":{}}`, 스팀 0개 공개, OpenID `is_valid:false` 전부 존재.
- [ ] **실제 키·PUUID·스팀 ID 없음**: PUUID는 78자 base64url 형태 실값 대신 명백한 가짜(`fake-puuid-…` 등)인지, 스팀 ID는 `7656119…` 형식이라도 공개 실계정이 아닌 가짜로 표기됐는지(주석/파일명), `RGAPI-` 접두 실키 없음. 보고서에 fixture 파일별 확인 표.

---

## D. backend (`backend` 대상, 계약 2·4·5·7·8절, 13절 backend)

### D1. 공통
- [ ] `config/env.ts`: 계약 11절 변수 전부 zod(양의 정수, 라우팅 소문자, `RIOT_ACCOUNTS_MAX` ≥1), 키 없이 기동. `.env.example` 키 집합 ↔ env 스키마 키 집합 1:1.
- [ ] `AppError.retryAfterSec` → error filter가 `Retry-After` **헤더**(본문은 `{code,message}`만). 적용 코드: SYNC_LIMIT_EXCEEDED, GAME_PROVIDER_RATE_LIMITED, RATE_LIMITED(소유 확인 시작 10회·확인 5초).
- [ ] 오류 코드 28개 = `ErrorCode` = `ERROR_HTTP_STATUS` = `DEFAULT_ERROR_MESSAGE` 키(Record 타입이라 컴파일러 보장 확인).
- [ ] 컨트롤러 경로 = `ApiPath.*` 상수, `:id`는 `IdParam` zod 파이프(UUID 아님 → 400 VALIDATION_FAILED).
- [ ] **직렬화**: 모든 200/202 반환이 `serialize(Shared스키마, …)` 경유(grep으로 미경유 return 목록화). `GameAccountView` 매퍼에서 `last_sync_error`가 `GameAccountSyncError` 밖이면 INTERNAL_ERROR.

### D2. 엔드포인트 9개 (계약 4절)

| 메서드 | 경로 | 상태 | 확인 |
| --- | --- | --- | --- |
| GET | /me/game-accounts | 200 | 정렬(대표 lol,tft → 부계정 verified_at·id 순 각 lol,tft → 스팀), riot_verification(만료 pending은 status=expired로), sync_quota |
| POST | /me/game-accounts | 200 | riot/steam 분기, 오류 판정 순서 = 4절 표 왼쪽부터(5-1 단계 순서) |
| POST | /me/game-accounts/riot-verifications/:id/confirm | 200 | 5-1 확인 1–6단계 |
| DELETE | /me/game-accounts/riot-verifications/:id | 204 | 남의 것 NOT_FOUND, 끝난 상태 204 |
| GET | /me/game-accounts/steam/callback | 302 | **JwtGuard 없음**(클래스 수준 가드가 걸리지 않는지 별도 확인) |
| DELETE | /me/game-accounts/:id | 204 | 5-3 |
| POST | /me/game-accounts/:id/primary | 200 | D56 |
| POST | /me/game-accounts/:id/sync | **202** | 7절 |
| GET | /users/:id/profile | 200 | 8절 |

- [ ] 라우트 충돌 없음: `riot-verifications`, `steam` 고정 세그먼트가 `:id` 라우트보다 먼저 매칭(예: `DELETE /me/game-accounts/riot-verifications/{uuid}`가 해제 핸들러로 가지 않음 — e2e로 확인).
- [ ] 계약 외 엔드포인트 없음, S6 `/admin/riot-verifications/:id/approve` 미구현.

### D3. 라이엇 소유 확인 (5-1)
- [ ] 시작 단계 순서: 파싱 → 키 → 라이엇 ID 수(lol 행 수) ≥ `RIOT_ACCOUNTS_MAX` → 오늘 KST 시작 10회(RATE_LIMITED + Retry-After=다음 KST 자정) → Account-V1(404 RIOT_ID_NOT_FOUND) → PUUID lol 행 존재(본인·타인 모두 ALREADY_LINKED) → Summoner(404 RIOT_SUMMONER_NOT_FOUND) → `pickVerificationIcon` → 트랜잭션(기존 pending→cancelled + insert, expires_at=now+TTL).
- [ ] 확인: verified 재호출 멱등 200, cancelled/expired → 410, pending+만료 → expired로 바꾸고 410, 5초 이내 → RATE_LIMITED(남은 초), 불일치 → 409 OWNERSHIP_CHECK_FAILED + **pending 유지**, 성공 → advisory lock 트랜잭션에서 한도·중복 재검사 후 lol·tft insert(`is_primary` = 기존 라이엇 행 없음), verification → verified, 커밋 **후** `riot-full`(reason link) enqueue, 차감 없음.
- [ ] 상태 갱신은 `canTransition(RIOT_LINK_VERIFICATION_TRANSITIONS, …)` + 조건부 update `WHERE id AND status='pending'`(grep 전수).

### D4. 대표 계정 (D56) — 계약 13절 qa
- [ ] **갱신 순서**: `POST …/:id/primary`가 한 트랜잭션(사용자 advisory lock `hashtext('game-accounts:'||user_id)`)에서 **기존 대표 lol·tft → false를 먼저**, 그 다음 대상 lol·tft → true. 코드 줄 순서 확인 + 단일 `updateMany`로 true/false 동시 처리하지 않는지. 순서 뒤바뀜 = **blocker**(부분 고유 인덱스 위반으로 기능 불가).
- [ ] 이미 대표·스팀 행 → 변경 없이 200. 남의 계정 id → NOT_FOUND.
- [ ] 첫 라이엇 연동 대표, 두 번째 부계정. 대표 해제 시 같은 트랜잭션에서 가장 오래된(verified_at, 같으면 lol 행 id) 라이엇 ID 승격 — 삭제가 승격보다 먼저(순서 반대면 인덱스 위반).
- [ ] 스팀 insert `is_primary=true`. 스팀 동시 insert의 P2002는 인덱스 이름(`game_accounts_one_primary_per_user_game`)이면 LIMIT_REACHED, `(game_id, external_id)`면 ALREADY_LINKED로 구분(P2 참고).
- [ ] DB 테스트 「부분 고유 인덱스가 대표 2개 거부」 작성 여부(미실행).

### D5. 스팀 연동 (5-2) — 보안 경계
- [ ] 시작: 키 → 스팀 행 존재(LIMIT_REACHED) → state 32바이트 → `gcd_steam` 서명 쿠키 `{state,user_id,iat}`, HttpOnly, SameSite=Lax, **Path=/api/v1/me/game-accounts/steam**, Max-Age=600, prod Secure. S0 `gcd_oauth` 서명 유틸 재사용.
- [ ] authorize_url 파라미터 6개·URL 인코딩, return_to=`{WEB_ORIGIN}/api/v1/me/game-accounts/steam/callback?state=…`, realm=`{WEB_ORIGIN}`.
- [ ] 콜백 분기 테스트 존재·결과: 쿠키 즉시 삭제(같은 Path, 성공·실패 모두) / cancel → STEAM_LINK_CANCELLED / mode≠id_res → STEAM_OPENID_INVALID / 쿠키 없음·서명 변조·600초 초과·state 불일치(상수 시간, 길이 달라도 예외 없음) → STEAM_LINK_STATE_INVALID / **return_to 변조, claimed_id 변조(다른 도메인·identity 불일치), op_endpoint 변조**, is_valid false → STEAM_OPENID_INVALID / 사용자 없음 → UNAUTHENTICATED / 성공 → `302 /settings?steam=linked` + steam-playtime(link) enqueue.
- [ ] 모든 실패 302 `{WEB_ORIGIN}/settings?steam_error=X`이고 X ∈ `SteamLinkErrorCode`(10개 밖 값 금지), 예상 못한 예외 → INTERNAL_ERROR(500 JSON 아님).
- [ ] personaname 실패 시 「스팀 사용자」.

### D6. 해제 (5-3)
- [ ] 라이엇 행(lol·tft 어느 id든) → 같은 external_id 두 행 삭제, 스팀 → 1행. `game_account_sync_requests`는 SetNull로 남아 **해제·재연동 후에도 오늘 횟수 그대로**(테스트).

### D7. 수동 새로고침 (7절)
- [ ] 순서: NOT_FOUND → NOT_CONFIGURED → `pg_advisory_xact_lock(hashtext('sync-quota:'||user_id))` 트랜잭션 → 진행 중(10분 이내)이면 미차감 202 `quota_consumed=false` → used ≥ `SYNC_DAILY_LIMIT` → 429 SYNC_LIMIT_EXCEEDED + `Retry-After`=`ceil((kstDayWindow(now).end-now)/1000)` → insert + queued → 커밋 후 enqueue → 202.
- [ ] used 집계 기준 `created_at ≥ kstDayWindow(now).start`(core 사용, `new Date().setHours(0)` 같은 로컬 TZ 계산 금지), 라이엇·스팀 합산, 라이엇 1회 = lol·tft.
- [ ] **KST 경계 테스트**: KST 23:59(UTC 14:59) 5회 사용 → 429, KST 00:00(UTC 15:00) → 다시 가능. `resets_at` `+09:00` 표기.
- [ ] 동시 요청 5회 경계(`Promise.all` 6건 → 5 성공 1 429) DB 테스트 작성 여부(미실행).
- [ ] 연동 직후·프로필 조회·cron은 sync_requests insert 없음(grep).

### D8. 프로필 (8절)
- [ ] 로그인 멤버 누구나, 없는 사용자 NOT_FOUND. `is_self`, `sync_quota`는 본인만(타인 null).
- [ ] tiers = **대표** lol·tft 순서 2개(부계정 티어 미사용), rank null/UNRANKED 구분, synced_at = last_synced_at.
- [ ] main_position = core `computeMainPosition`(대표 lol 최신 20), recent_matches = 대표 lol 최신 10, summary 파싱 실패 행은 건너뜀, 라이엇 없음 → null.
- [ ] riot-matches enqueue 조건(6-2 표: 대표 lol, matches_synced_at null/6h 초과(core `isMatchesCacheStale`), idle, 30분 내 실패 없음), 차감 없음, refresh_queued 규칙.
- [ ] `scrim: null`, `badges: null` 고정. `ProfileUser`에 email·discord_id·discord_username 없음, `discord_linked` = discord_id 있고 `dev-` 아님.

### D9. 외부 식별자 비노출 (D38) — 계약 8절·13절 qa
- [ ] 응답 경로 전수: 9개 핸들러의 반환값이 shared 스키마 parse(=모르는 키 제거)를 거치는지. `res.json(`, `@Res()` 직접 응답, `serialize` 없는 `return` grep.
- [ ] e2e 테스트가 응답 JSON 문자열에 fixture PUUID·스팀 ID·매치 ID·email·discord_id가 **포함되지 않음**을 단언(본인·타인 프로필, GET /me/game-accounts, confirm, sync, primary).
- [ ] 302 Location(steam 콜백)·오류 message·로그에도 미포함.

### D10. 보안·권한 매트릭스

| 시나리오 | 기대 |
| --- | --- |
| 비로그인으로 S1 JWT 엔드포인트 8개 | 401 UNAUTHENTICATED |
| 남의 game_account id로 DELETE·sync·primary | 404 NOT_FOUND(존재 숨김) |
| 남의 verification id로 confirm·DELETE | 404 NOT_FOUND |
| 다른 멤버가 연동한 PUUID·스팀 ID | 409 GAME_ACCOUNT_ALREADY_LINKED(D45, 이전 없음) |
| 라이엇 4번째 / 스팀 2번째 | 409 GAME_ACCOUNT_LIMIT_REACHED |
| 해제 → 재연동 → sync | 횟수 회복 없음 |
| 스팀 콜백 변조(return_to·claimed_id·op_endpoint·state) | 302 steam_error, 행 생성 없음 |

---

## E. web (`web` 대상, 계약 12절)

### E1. 훅·호출
- [ ] 훅 8개 존재(`useMyGameAccounts`, `useSetPrimaryGameAccount`, `useLinkGameAccount`, `useConfirmRiotVerification`, `useCancelRiotVerification`, `useUnlinkGameAccount`, `useSyncGameAccount`, `useUserProfile`), 경로는 `API_PREFIX + fillPath(ApiPath.x, {id})`, 메서드 = D2 표.
- [ ] 응답 shared 스키마 `.parse`(제네릭 단언만 있는 곳 grep), 202·204 처리(204는 본문 파싱 안 함).
- [ ] `Retry-After` 헤더 읽어 SYNC_LIMIT_EXCEEDED·RATE_LIMITED 안내에 사용(쓰면 확인, 안 쓰면 minor).
- [ ] 외부 API 직접 호출 없음: `grep -rnE "riotgames\.com|api\.steampowered|steamcommunity\.com/openid|ddragon" apps/web/src`(Data Dragon 이미지 URL은 서버가 준 값만 사용, `<img src>`로 직접 조합 금지). 스팀 이동은 서버가 준 `authorize_url`로 `location.href`.
- [ ] snake_case 그대로 사용(camelCase 변환 없음).
- [ ] mutation 성공 시 `myGameAccounts`·`userProfile` 쿼리 무효화.

### E2. 설정 화면 (목업 Settings)
- [ ] 섹션 순서: 화면 테마 → 게임 계정 연동 → 디스코드 계정. **알림 섹션 없음**, 디스코드 「연동 코드 발급」 UI 없음(D23).
- [ ] 라이엇 카드: provider+display_name으로 묶어 ID당 1장, 대표 먼저 + 「대표」 배지, 「라이엇 ID · 롤, 롤체 공통 · HH:mm 동기화」, 롤·롤체 티어 요약(rank), 「지금 갱신 · 오늘 N회 남음」(lol 행 id, remaining 0 비활성), 부계정 「대표로 지정」, 「연동 해제」 확인 대화상자(대표면 「다음 계정이 대표가 돼요」).
- [ ] 「+ 부계정 추가」: 라이엇 ID 수 < 한도이고 진행 중 확인 없을 때만, 라이엇 0개면 「라이엇 ID 연동」.
- [ ] 소유 확인 단계: 입력(`RiotIdInput` 재사용, 정규식 복제 금지) → 아이콘 이미지(null이면 `#번호`), 「게임 클라이언트에서 프로필 아이콘을 #N으로 바꿔 주세요」, `expires_at` 카운트다운 mm:ss(서버 시각 기준, 0이면 「다시 시작」), 「바꿨어요, 확인」, 「취소」, OWNERSHIP_CHECK_FAILED 인라인.
- [ ] 스팀 미연동: 「Steam으로 로그인」 버튼 1개(스팀 ID 입력란 없음). 연동됨: display_name(**스팀 ID 숫자 미표시** — 목업의 `76561198000000000` 자리), 「보유 게임 N개」, STEAM_PROFILE_PRIVATE면 「게임 정보 비공개」 배지 + 목업 문구 + 「다시 시도 · 오늘 N회 남음」 + 「마지막 성공 값(MM.DD)」.
- [ ] `SettingsPageQuery` 파싱(모르는 steam_error 무시) → 토스트 → `router.replace('/settings')`.
- [ ] 디스코드 섹션: avatar_url, discord_username, guild verified 표시만.
- [ ] 오류 코드별 문구: `ERROR_MESSAGES`(Record<AppErrorCode>) S1 13개, `GameAccountSyncError` 7개 문구 매핑(계약 2절 화면 열) — Record 타입 여부.

### E3. 프로필 화면 (목업 Profile)
- [ ] 헤더: main_position 1순위(「TOP LANER」 등), 「YYYY.MM 가입」, role. ELO 순위 미표시.
- [ ] 연동 칩: 라이엇 display_name(부계정 포함), 「스팀 연동됨」, 디스코드 연동/미연동. 외부 ID 표시 없음.
- [ ] 갱신 버튼: is_self일 때만, 대표 lol 행 → 없으면 스팀 행 id.
- [ ] 카드 4개: 롤 솔로·롤체(tiers; rank null 「동기화 대기 중」, UNRANKED 구분, tiers [] 빈 상태), 주 포지션(「솔로 랭크 최근 N경기 기준 탑 71%」), 내전 레이팅 빈 상태.
- [ ] RATING HISTORY·최근 내전·BADGES 빈 상태(목업 가짜 숫자 1421·+21 하드코딩 없음 — grep).
- [ ] 최근 솔로 랭크: 「라이엇 API · HH:mm」= synced_at, refresh_queued면 10초 뒤 1회 재조회, items [] 빈 상태, recent_matches null 처리.
- [ ] 없는 사용자 404 화면, 로딩·오류 상태.

### E4. 폴링·시각
- [ ] `sync.state ≠ idle` 계정이 있으면 2초 간격 최대 60초(React Query `refetchInterval` 조건·종료 조건 확인, 무한 폴링 없음).
- [ ] 시각 표시 HH:mm·MM.DD·YYYY.MM이 KST 기준(`timeZone:'Asia/Seoul'` 또는 동등) — 브라우저 TZ 의존 여부 기록.
- [ ] 티어 색: 새 hex 없음(`grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgb\(" apps/web/src --include=*.tsx`), 매핑표 `apps/web/src/lib/` 한 곳(D53).
- [ ] `lib/routes.ts`에 `/members/{id}`, `/settings` 쿼리 헬퍼, 모든 href/router.push가 app/ 라우트와 일치.
- [ ] 목 백엔드 S1 엔드포인트 9개(스팀 authorize_url → `/settings?steam=linked`), 목 응답이 shared 스키마 parse 통과(테스트).
- [ ] `corepack pnpm --filter web build` 성공, 브라우저 렌더(데스크톱·모바일 × 라이트·다크)는 「미실행」.

---

## F. 교차 대조 (`s1` 대상)

### F1. 엔드포인트 일대일

| 계약 4절 | ApiPath | 컨트롤러(파일:줄) | 웹 훅 | 목 백엔드 | 비고 |
| --- | --- | --- | --- | --- | --- |
| GET /me/game-accounts | myGameAccounts | | useMyGameAccounts | | |
| POST /me/game-accounts | myGameAccounts | | useLinkGameAccount | | |
| POST …/riot-verifications/:id/confirm | riotVerificationConfirm | | useConfirmRiotVerification | | |
| DELETE …/riot-verifications/:id | riotVerification | | useCancelRiotVerification | | |
| GET …/steam/callback | steamLinkCallback | | (없음 — 스팀이 브라우저로 호출) | | 정상 |
| DELETE /me/game-accounts/:id | myGameAccount | | useUnlinkGameAccount | | |
| POST …/:id/primary | myGameAccountPrimary | | useSetPrimaryGameAccount | | |
| POST …/:id/sync | myGameAccountSync | | useSyncGameAccount | | 202 |
| GET /users/:id/profile | userProfile | | useUserProfile | | |

### F2. 코드·enum·전이 대조
- [ ] 오류 코드 28개: 계약 2절 표 + S0 15 ↔ `ErrorCode` ↔ `ERROR_HTTP_STATUS` ↔ `DEFAULT_ERROR_MESSAGE` ↔ 웹 `ERROR_MESSAGES` ↔ API에서 실제 throw하는 코드(grep). 계약에 없는 throw 코드 없음.
- [ ] `SteamLinkErrorCode` 10개 ↔ 콜백이 실제 리다이렉트하는 코드 ↔ 웹 문구.
- [ ] `GameAccountSyncError` 7개 ↔ 작업자가 기록하는 값(grep) ↔ 웹 문구.
- [ ] Prisma enum 2개(`game_account_sync_state`, `riot_link_verification_status`) 값 = shared enum 값.
- [ ] 전이 맵 2개 ↔ 상태 갱신 코드 전수(`status:`·`syncState:`·raw SQL `SET sync_state`) — 맵 밖 전이 없음, 맵 전이 중 미구현 없음(queued→idle 「작업 버림」 경로 포함).
- [ ] `recent_matches.summary` 생산자(integration) ↔ 소비자(backend) 모두 `LolMatchSummary` 사용.
- [ ] 쿠키 상수 `STEAM_LINK_COOKIE`·`STEAM_LINK_STATE_TTL_SEC`, `SYNC_DAILY_LIMIT_DEFAULT`, `RIOT_ACCOUNTS_MAX_DEFAULT`가 env 기본값과 일치.
- [ ] core 함수 사용처: backend·integration이 KST 계산·주 포지션·랭크 변환·아이콘 선택을 재구현하지 않고 `packages/core` 호출(grep).

### F3. 명세 대조
- [ ] 문서 2장 「게임 계정 연동」(P0): 라이엇 ID·스팀 등록 + 소유 확인 — 구현 여부. 「내 프로필」(P0): 게임별 티어·주 포지션·최근 전적 구현, 내전 승률·뱃지는 S3/P2 빈 자리(누락 아님, 계약 1절 제외).
- [ ] 문서 5장 game_accounts 컬럼(user_id, game_id, external_id, display_name, verified, last_synced_at), rank_snapshots, steam_playtime 컬럼 존재. S0 필수(`users.discord_id`, `activity_logs.idempotency_key` UNIQUE, `api_keys.key_hash`)·인덱스 3개 회귀 없음.
- [ ] 문서 6장 `POST, DELETE /me/game-accounts`, `POST /me/game-accounts/{id}/sync`, `GET /users/{id}/profile` 구현. 차이(DELETE `:id`, 추가 경로 4개)는 계약 D32·D35·D56으로 기록 → 「명세 갱신 필요」 목록.
- [ ] 문서 8장 `/members/[id]`(연동 계정, 게임별 티어, 최근 전적; 레이팅 그래프·뱃지 빈 상태), `/settings`(게임 계정 연동; 디스코드 연동 코드·알림은 D23·D48로 제외 → 「명세 갱신 필요」).
- [ ] 문서 9장: 서버만 외부 호출, 티어 1시간·활동 우선, 전적 6시간 조회 시 큐, 스팀 하루 1회 새벽, 수동 하루 5회 API 검사, 실패 시 마지막 성공값 + 갱신 시각, 429 대기 후 재시도, 라이엇 소유 확인(아이콘), 스팀 비공개 안내.

---

## 계획 단계에서 발견한 계약 내부 불일치 (구현 결함 아님, 리더 참고)

| # | 심각도 | 위치 | 내용 |
| --- | --- | --- | --- |
| P1 | major | 계약 6-1·6-2 「멈춘 작업 정리」(`_workspace/01_architect_contract.md:226`), 6-1 작업자 잠금(214) vs `packages/shared/src/constants/transitions.ts:84-88` | 멈춘 작업 정리는 `sync_state IN (queued, running)` 행을 `queued`로 되돌리는데 맵에 `running → queued`가 없다(`queued → queued` 재설정도 자기 전이). 작업자 잠금 SQL은 10분 지난 `running`을 다시 `running`으로 가져가는데 `running → running`도 없다. 구현자는 맵을 어기거나 계약 흐름을 바꿔야 한다. 맵에 `running → queued`(및 정리용 자기 전이 허용 규칙)를 추가할지, 정리를 `running → idle → queued` 두 단계로 할지 결정 필요 |
| P2 | minor | 계약 5-2 8단계(190) 「스팀 1개 제한은 DB 제약이 아니라 잠금+검사」 vs 3절 부분 고유 인덱스(87)·D56 「스팀 행은 항상 is_primary=true」 | 스팀 행이 항상 대표라 부분 고유 인덱스 `(user_id, game_id) WHERE is_primary`가 실제로 스팀 1개를 DB에서도 강제한다. 동작상 해는 없으나 P2002가 이 인덱스에서 나면 LIMIT_REACHED, `(game_id, external_id)`에서 나면 ALREADY_LINKED로 구분해야 한다는 점이 계약에 없다 |
| P3 | minor | `packages/shared/src/common/errors.ts:32-33`, `apps/api/src/common/app-error.ts`(GAME_ACCOUNT_LIMIT_REACHED·ALREADY_LINKED 문구), `apps/web/src/lib/errors.ts`(같은 2개) vs 계약 2절(42-43)·D37 | Q1 반영 전 문구가 남아 있다: LIMIT_REACHED 「이미 같은 제공자 계정을 연동함 — 해제 후 다시 연동」(실제는 라이엇 3개 한도·스팀 1개), ALREADY_LINKED 「다른 멤버에게 연동됨」(실제는 본인이 같은 라이엇 ID를 다시 추가한 경우 포함 — 본인에게 「다른 멤버」 문구가 나감). web은 frontend가 다듬기로 돼 있으나 shared 주석·API 기본 문구는 담당이 정해져 있지 않다 |
| P4 | minor | 계약 12절 표(410) 「라이엇 ID 수 < 3」 vs 11절 `RIOT_ACCOUNTS_MAX`(env, 서버 전용) | 웹이 한도를 알 방법이 없다(`GetMyGameAccountsResponse`에 한도 필드 없음). env를 바꾸면 웹의 「부계정 추가」 노출 조건이 서버와 어긋난다. 응답에 `riot_accounts_max`를 넣거나 웹은 `RIOT_ACCOUNTS_MAX_DEFAULT` 상수 사용으로 명시 필요 |
| P5 | minor | 계약 12절(412) 「2단계(소유 확인 2/2 단계)」 vs 목업 Settings 「소유 확인 1 / 2 단계」(아이콘 변경 화면에 표시)·D58 「소유 확인 1/2 단계를 그대로 살린다」 | 아이콘 변경 단계의 표기가 1/2인지 2/2인지 계약 안에서 엇갈린다. QA는 어느 쪽을 기준으로 볼지 리더 결정 필요(결정 전엔 표기 차이를 minor로만 기록) |
| P6 | minor | 계약 4절(127) 「lol·tft 2행이 같은 … sync로 나온다」 vs `game-accounts.ts:66` `matches_synced_at` 「라이엇 lol 행만, 그 외 null」 | tft 행의 `sync.matches_synced_at`은 null이라 두 행의 sync가 완전히 같지 않다. 웹이 카드 묶을 때 tft 행 값을 쓰면 전적 시각이 비게 됨 → lol 행 기준이라고 명시 필요 |
| P7 | minor | 계약 변경 이력(11) 「환경 변수 11개」, 11절 제목(381) 「12개」, 11절 표 실제 13행(신규 10 + 기존 RIOT_API_KEY·STEAM_API_KEY·REDIS_URL), 13절 backend 「11절 변수」 | 개수 표기만 엇갈림. QA는 표 13행 = `.env.example`(현재 13개 모두 존재 확인) = env 스키마로 대조 |

참고(불일치 아님, 검증 시 주의):
- 마이그레이션은 현재 스키마 diff와 일치하고 부분 고유 인덱스가 수동 블록에 있다(기준선 확인). 이후 대상 검증 때마다 A7·A8 재실행.
- `contract.s1.test.ts:127`과 목업이 `76561198000000000`을 쓴다(음성 테스트 입력). 실존 계정일 수 있는 형식이므로 integration fixture는 명백한 가짜 표기 여부를 C6에서 따로 본다.
- 5-2 콜백은 `openid.mode` 검사(2단계)가 쿠키 검사(3단계)보다 앞서 쿠키 없는 cancel도 STEAM_LINK_CANCELLED가 된다 — 계약대로면 정상, 테스트 기대값도 이 순서로 본다.

## 미실행·제약 고정 항목

- DB 필요: 마이그레이션 적용, 부분 고유 인덱스 실제 거부, 동시 sync 5회 경계, P2002 경합, 작업자 DB 기록, advisory lock 동작 → 「미실행」(테스트 코드 존재·내용 정적 확인)
- Redis 필요: BullMQ 큐·일시정지 → 「미실행」
- 키 필요: 라이엇·스팀 실제 호출, Steam OpenID 왕복, Data Dragon 실제 버전 조회(네트워크)
- 브라우저: 화면 시각 확인 → 「미실행」
