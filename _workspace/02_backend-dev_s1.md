# backend-dev 보고서: S1 게임 계정 연동·프로필 (apps/api)

작성: 2026-10-29, backend-dev. 계약: `_workspace/01_architect_contract.md`(S1), `packages/shared/src/**`, `apps/api/prisma/schema.prisma`.
커밋하지 않음. 계약(shared·스키마·마이그레이션)은 바꾸지 않았다. 마이그레이션의 부분 고유 인덱스 블록은 손대지 않았다.

## 1. 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared, core, web, api 모두 통과 |
| `corepack pnpm --filter api test` | 20 파일 통과 / 3 skip, **271 통과 / 20 skip**(skip = DB e2e 3파일: S0 auth 5, integration sync-store 8, S1 game-accounts 7) |
| `corepack pnpm --filter "api..." build` | shared → core → api 통과 |
| 빌드 산출물 스모크(`node dist/main.js`) | **미실행**(실행 환경 권한 거부. 라우트 등록은 e2e로 확인) |

## 2. 엔드포인트 (계약 4절 9개 중 S6 예약 제외 8개 + GET)

| 메서드 경로 | 상태 | 테스트 |
| --- | --- | --- |
| GET /me/game-accounts | 구현 | 빈 상태, limits(RIOT_ACCOUNTS_MAX), sync_quota, riot_verification(pending/expired 표시), 401 |
| POST /me/game-accounts (riot) | 구현 | 성공, 이전 pending 취소, 검증 4종, 키 없음 503, RIOT_ID/SUMMONER_NOT_FOUND, 외부 429(Retry-After)/401/5xx, 하루 10회(Retry-After=KST 자정), ALREADY_LINKED_TO_ME/ALREADY_LINKED, 4번째 LIMIT_REACHED |
| POST /me/game-accounts (steam) | 구현 | authorize_url 파라미터, `gcd_steam` 속성(HttpOnly·Lax·Path·Max-Age=600), 이미 스팀 409, 키 없음 503 |
| POST …/riot-verifications/:id/confirm | 구현 | 성공(lol·tft, 첫 연동 대표, queued, riot-full link 등록, advisory lock 호출), 멱등, 부계정, 불일치 409, 5초 간격 429+Retry-After, 만료 410, 확인 시점 타인 연동·본인 중복·한도 도달, 남의 id 404, UUID 아님 400 |
| DELETE …/riot-verifications/:id | 구현 | 204, 이후 confirm 410, 재취소 204, 남의 id 404 |
| GET /me/game-accounts/steam/callback | 구현 | 성공 302 `steam=linked`, cancel, mode 이상, return_to·claimed_id 변조, is_valid false, 5xx→GAME_PROVIDER_ERROR, 429, 쿠키 없음·state 불일치·위조·600초 초과, 타인 스팀 ID, 쿠키 사용자 없음→UNAUTHENTICATED, 다른 탭 선연동→LIMIT_REACHED, JWT만으로는 불가, 쿠키 항상 삭제 |
| DELETE /me/game-accounts/:id | 구현 | 대표 해제(tft id) → 두 행 삭제 + 가장 오래된 부계정 승격, 스냅샷·플레이타임 Cascade, 횟수 기록 SetNull 유지, 부계정 해제, 남의 계정 404 |
| POST /me/game-accounts/:id/primary | 구현 | 부계정 tft id로 지정, 멱등, 스팀 200, 남의 계정 404, 부분 고유 인덱스 흉내(P2002) |
| POST /me/game-accounts/:id/sync | 구현(202) | 차감·queued·riot-full manual(lol id), 진행 중 미차감, 멈춘 행(10분) 재차감, running 미차감, 합산 5회 → 429+Retry-After, KST 자정 초기화, 해제·재연동으로 회복 불가, 동시 3건 차감 1번(인메모리), 404/400/503 |
| GET /users/:id/profile | 구현 | 빈 상태, 타인(sync_quota null·discord_linked), 대표 기준 티어·주 포지션·최근 전적(부계정 전적 미사용, 깨진 summary 건너뜀, 챔피언 한글명), 대표 변경 반영, 6시간 지남 → riot-matches(profile-view, 우선순위 2), 30분 내 실패·진행 중 처리, 스팀만, 404/400/401 |

모든 응답은 shared 스키마 `parse`를 거친다(`GameAccountView`, `RiotLinkVerificationView`, 각 Response). e2e는 응답 원문에 가짜 PUUID·스팀 ID·매치 ID·`puuid`/`external_id` 키가 없는지 검사한다(D38).

## 3. 구현 파일

| 파일 | 내용 |
| --- | --- |
| `src/config/env.ts` | 11절 13행 전부(키·라우팅·한도·TTL·RIOT_ACCOUNTS_MAX·DDRAGON·SYNC_DAILY_LIMIT·SYNC_JOBS_ENABLED, REDIS_URL은 S0부터) |
| `src/common/app-error.ts`, `filters/error.filter.ts` | `retryAfterSec`(올림, 최소 1) → `Retry-After` 헤더. 본문은 `{code,message}` 그대로 |
| `src/common/signed-cookie.ts` | HMAC 서명 쿠키 일반화. S0 `oauth-state.ts`가 이것을 쓰도록 바꿈(공개 API·동작 동일, 기존 테스트 통과) |
| `src/common/advisory-lock.ts` | `pg_advisory_xact_lock(hashtext('game-accounts:'‖user))`, `sync-quota:` 키, `$executeRaw` |
| `src/common/unique-violation.ts` (+spec) | 5-2a P2002 구분: external_id / one_primary / unknown (배열·이름 두 형식) |
| `src/common/clock.ts` | `APP_CLOCK` 전역(테스트에서 시각 이동) |
| `src/load-env.ts`, `src/main.ts` | `.env`를 AppModule import 전에 읽음 — `JobsModule.forRoot()`가 import 시점 env를 쓰기 때문(아래 B1) |
| `src/app.module.ts` | `ClockModule`, `IntegrationsModule`, `JobsModule.forRoot()`, `GameAccountsModule`, `ProfileModule` 연결 |
| `src/modules/game-accounts/*` | controller, `GameAccountsService`(목록·해제·대표·sync), `RiotLinkService`(5-1), `SteamLinkService`(5-2), `GameAccountViews`(뷰·정렬·쿼터), `GameCatalog`(games id 캐시), `SyncEnqueuer`(`jobPriority`, 실패 시 로그만), `steam-link-cookie.ts`, `external-errors.ts` |
| `src/modules/profile/*` | `GET /users/:id/profile` |
| `vitest.config.ts` | `test.env.SYNC_JOBS_ENABLED=false`(테스트에서 cron·소비자 미등록) |
| `test/support/fake-table.ts`, `fake-prisma.ts` | S1 테이블 7개 인메모리(where in/gte/lt/OR/not, orderBy, increment), 고유 제약 2개(부분 인덱스 포함, 문 단위 검사), Cascade/SetNull, `$executeRaw` 기록, 트랜잭션 스냅샷 확장 |
| `test/support/s1-mocks.ts`, `s1-helpers.ts`, `test-app.ts` | contracts.ts 인터페이스 목(RiotApi·SteamApi·DataDragon·SyncQueue), 이동 시계, RANDOM 고정 |
| `test/game-accounts.e2e.spec.ts`(30), `test/sync-and-steam.e2e.spec.ts`(20), `test/profile.e2e.spec.ts`(7) | HTTP e2e |
| `test/db/game-accounts.db.e2e.spec.ts`(7) | **작성만, 미실행**(아래 5절) |

## 4. core 사용

`kstDayWindow`(횟수·하루 10회 경계, Retry-After), `buildSyncQuota`, `computeMainPosition`, `pickVerificationIcon`(RANDOM 토큰, 기본 `Math.random`), `isMatchesCacheStale`. 재구현 없음.

## 5. 미실행 (실제 PostgreSQL 필요 — 통과로 보지 말 것)

`test/db/game-accounts.db.e2e.spec.ts` — `TEST_DATABASE_URL` 없음으로 skip. 실행 방법은 파일 머리 주석(S0와 같음).

| 테스트 | 확인 대상 |
| --- | --- |
| 부분 고유 인덱스 존재 | `pg_indexes`에 `game_accounts_one_primary_per_user_game … WHERE is_primary` |
| 실제 P2002 meta.target | (game_id, external_id), 대표 2개, 스팀 2행 거부 → 분류 함수 결과 |
| advisory lock SQL | `$executeRaw SELECT pg_advisory_xact_lock(...)`이 실제로 실행되는지(void 반환 처리) |
| 동시 대표 지정 | Promise.all 2건 → 대표 라이엇 ID 1개 |
| 동시 확인(한도 1) | 200 1건 + 409 1건 |
| 동시 sync 경계 | 사용 4회 + 다른 계정 2건 동시 → 202 1, 429 1 |
| 해제 SetNull | sync_requests 유지 |

인메모리 대체는 트랜잭션을 직렬화로 흉내 낼 뿐이고, 고유 제약 위반 meta 형식은 추정(배열 `['game_id','external_id']`, 인덱스 이름 문자열)이다. 분류 함수는 두 형식과 camelCase까지 받도록 했다.

## 6. 계약이 정하지 않은 부분을 채운 것 (리더 확인 요청)

| # | 내용 | 이유 |
| --- | --- | --- |
| B1 | `main.ts`가 `.env`를 별도 모듈(`load-env.ts`)로 **AppModule import 전에** 읽게 바꿈 | `JobsModule.forRoot()`가 모듈 import 시점 `process.env`로 REDIS_URL·SYNC_JOBS_ENABLED를 정한다. 기존 위치(bootstrap 안)면 `.env`의 두 값이 무시된다 |
| B2 | 리더 지시문의 「실패 시 /settings?steam=코드」 대신 계약·shared `SettingsPageQuery`대로 **`/settings?steam_error={코드}`** | 계약 4·5-2절과 shared 스키마가 `steam_error` |
| B3 | 스팀 콜백 판정 순서: mode=cancel → mode≠id_res → 쿠키·state → 쿼리 값 중복(배열) → 키 없음(GAME_PROVIDER_NOT_CONFIGURED) → 검증 | 계약 2–4단계 순서 유지, 키 검사 위치는 계약에 없음 |
| B4 | 확인 5초 간격은 조건부 update(`last_checked_at IS NULL OR ≤ now-5s`)로 원자적 판정. 아이콘 대조 전에 `last_checked_at`·`check_count`를 올림(외부 실패도 1회로 셈) | 계약 3단계 순서 그대로, 동시 확인 경합 방지 |
| B5 | 확인 트랜잭션에서 verification을 `pending→verified` 조건부 update, 0행이면(그 사이 취소·새 시작) OWNERSHIP_CHECK_EXPIRED로 행 생성 되돌림 | 취소된 확인으로 연동되는 것 방지 |
| B6 | 수동 sync의 `queued` 갱신 WHERE: `sync_state='idle' OR sync_state_at IS NULL OR sync_state_at < now-10분` | 멈춘 행 전이(D59)를 조건부 update로만. `sync_state_at` null은 멈춘 것으로 봄 |
| B7 | 작업 등록 실패는 요청을 실패시키지 않고 로그만(account id) | DB `queued`가 원본, 멈춘 작업 정리가 회수(6-3) |
| B8 | `steam_owned_game_count`: 스팀 행이고 (playtime 행 > 0 또는 last_synced_at 있음)이면 행 수, 아니면 null | 「동기화 전 null」 해석 |
| B9 | `sync.error.at`은 `last_sync_error_at`(없으면 updated_at) | 스키마상 필수 |
| B10 | 소유 확인 시작의 `riot_link_verifications.created_at`을 주입 시계 값으로 저장 | 하루 10회 판정과 같은 시계 사용 |
| B11 | env `SYNC_JOBS_ENABLED`는 `true`/`false`만 허용(그 외 값은 기동 실패). integration `options.ts`는 'false' 외 전부 true로 봄 | zod 검증 원칙. 두 해석은 `true`/`false`/빈 값에서 일치 |

## 7. 남은 문제·전달 사항

1. DB e2e 미실행(5절). Docker 없음.
2. 빌드 산출물 스모크 미실행(권한 거부). 라우트·DI 연결은 Nest 테스트 앱 e2e로만 확인.
3. 실제 라이엇·스팀 키로 연동 흐름 미확인(외부 호출은 전부 목). 아이콘 0–28 선택 가능 여부는 D65 위험 그대로.
4. QA 참고: 응답 직렬화는 모두 shared 스키마 parse 경로(`serialize` 대신 직접 `Schema.parse`)를 거친다. 로그에는 PUUID·스팀 ID를 쓰지 않는다.

## 수정 이력

(없음)
