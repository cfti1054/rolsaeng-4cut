# QA: s1 (교차 대조·명세 대조) — 판정: pass

작성: qa-verifier, 2026-10-29
대상: S1 전체(shared 계약 코드, packages/core, apps/api integrations·jobs·game-accounts·profile, apps/web S1)
기준: 계약 `_workspace/01_architect_contract.md`(D32–D72), 슬라이스 `_workspace/00_input/slice.md`, 명세 2·5·6·8·9장, 목업 Profile·Settings. 체크리스트 `_workspace/03_qa-verifier_plan.md` F절과 A절.
대상별 보고서: core·integration·web·backend(`_workspace/03_qa-verifier_{core,integration,web,backend}.md`).

## 실행한 명령과 결과 (2026-10-29, `apps/web/.next` 삭제 후)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Done |
| `corepack pnpm -r typecheck` | shared·core·web·api Done |
| `corepack pnpm -r test` | shared 34 / core 79 / web 80 / api 271 passed(20 skipped = DB e2e 3개 파일) |
| `corepack pnpm -r build` | 4개 패키지 성공 |
| `npx prisma validate` | valid |
| migrate diff(450b091 스키마 → 현재 스키마) vs migration.sql 1–62줄 | 같음 |
| 부분 고유 인덱스 | `migrations/20261028120000_s1/migration.sql:67` 「수동 추가」 블록에 그대로 있다. 이를 DROP하는 SQL은 없다. S0 마이그레이션은 바뀌지 않았다 |
| `ErrorCode.options.length`, `ERROR_HTTP_STATUS` 키 수(shared dist) | 29 / 29 |
| 비밀값·실제 식별자 grep(`RGAPI-`, `key=`), `.env` 추적 여부 | 0건, 추적 안 됨 |
| 웹 외부 API 직접 호출 grep | 0건 |
| DB·Redis·실제 키가 필요한 항목 | **미실행 / 키 필요**(아래 표) |

## F1. 엔드포인트 일대일

| 계약 4절 | ApiPath | 컨트롤러(파일:줄) | 웹 API 함수·훅 | 목 백엔드 | 비고 |
| --- | --- | --- | --- | --- | --- |
| GET /me/game-accounts | myGameAccounts | game-accounts.controller.ts:49 | `getMyGameAccounts`·useMyGameAccounts | 200 | |
| POST /me/game-accounts | myGameAccounts | :56 | `linkGameAccount`·useLinkGameAccount | 200(스팀은 authorize_url=/settings?steam=linked) | 스팀 Set-Cookie |
| POST …/riot-verifications/:id/confirm | riotVerificationConfirm | :72 | `confirmRiotVerification`·useConfirmRiotVerification | 200 | |
| DELETE …/riot-verifications/:id | riotVerification | :80 | `cancelRiotVerification`·useCancelRiotVerification | 204 | |
| GET …/steam/callback | steamLinkCallback | :88 | (없음 — 스팀이 브라우저를 보냄) | (없음) | 정상. 웹은 `SettingsPageQuery`로 결과를 읽음 |
| DELETE /me/game-accounts/:id | myGameAccount | :99 | `unlinkGameAccount`·useUnlinkGameAccount | 204 | |
| POST …/:id/primary | myGameAccountPrimary | :107 | `setPrimaryGameAccount`·useSetPrimaryGameAccount | 200 | |
| POST …/:id/sync | myGameAccountSync | :115 | `syncGameAccount`·useSyncGameAccount | 202 | 웹 클라이언트는 `res.ok`로 판정해 202를 받음(client.ts:219) |
| GET /users/:id/profile | userProfile | profile.controller.ts:14 | `getUserProfile`·useUserProfile | 200 | |

- 서버와 웹이 같은 `ApiPath` 상수를 쓴다(웹은 `fillPath`).
- 계약 밖의 엔드포인트는 없다. S6 예약 경로도 구현하지 않았다.

## F2. 응답 형태: 실제 API ↔ 웹 목

두 쪽 모두 같은 shared zod 스키마로 응답을 만든다. 실제 API는 `Schema.parse` 후 반환하고, 목은 `GameAccountView.parse` 등을 거쳐 실제 클라이언트의 zod 파싱 경로로 테스트된다. 그래서 형태가 어긋날 수 없다. 의미(값 규칙)는 따로 대조했다.

| 항목 | 실제 API | 웹 목 | 일치 |
| --- | --- | --- | --- |
| `limits` | `{riot_accounts_max: RIOT_ACCOUNTS_MAX, steam_accounts_max: 1}`(game-accounts.service.ts:49) | `{riot_accounts_max: riotMax, steam_accounts_max: STEAM_ACCOUNTS_MAX}`(mock:348) | ✓ |
| `is_primary` | 첫 라이엇 연동이면 true, 스팀은 항상 true, 대표 지정 시 false를 먼저 바꾼 뒤 true, 해제 시 가장 오래된 것 승격 | 같은 규칙(mock:467,377,502-504,549-554) | ✓ |
| `rank` | 행별 최신 스냅샷, 스팀·스냅샷 없음은 null | 스팀 null, 부계정 tft null 사례 포함 | ✓ |
| `sync.matches_synced_at` | lol 행만, tft·스팀은 null(views:287) | 대표 lol만 설정(mock:221), tft는 null | ✓ |
| `steam_owned_game_count` | 동기화 전 null, 이후 행 수(B8) | 시작 시 null, 성공 후 84 | ✓ |
| 정렬 | 대표 → 부계정(verified_at, id) → 스팀 | 같은 그룹 규칙(mock:146) | ✓ |
| 프로필 null 필드 | `scrim: null`, `badges: null`, 타인은 `sync_quota: null`, 라이엇 없으면 `recent_matches: null`·`tiers: []` | 같음(mock:289-293) | ✓ |
| `riot_verification` | 가장 최근 확인이 pending일 때만, 만료 시각이 지났으면 status=expired | 같음(mock:340-345) | ✓ |
| 오류 판정 순서(라이엇 시작) | 키 → 한도 → 10회 → ID 없음 → TO_ME / 타인 → 소환사 없음 | 한도 → 10회 → notfound → TO_ME → taken → nosummoner | ✓ |
| `Retry-After` | 헤더(정수 초) | 헤더(정수 초), 웹 `parseRetryAfter`가 읽음 | ✓ |

## F3. 오류 코드 29개 ↔ API 문구 ↔ 웹 문구

- shared `ErrorCode` 29개(S0 15 + S1 14) = `ERROR_HTTP_STATUS` 29 = API `DEFAULT_ERROR_MESSAGE`(`Record<ErrorCode>`) = 웹 `ERROR_MESSAGES`(`Record<AppErrorCode>`, 웹 전용 2개 추가). Record 타입이라 누락되면 typecheck가 실패하는데, 통과했다.
- S1 코드 14개와 RATE_LIMITED를 실제로 throw하는 곳이 API에 1곳 이상씩 있고, 웹 문구도 모두 있다. grep으로 확인했다.
- `SteamLinkErrorCode` 10개는 스팀 콜백이 `safeParse`로 걸러서만 리다이렉트한다(steam-link.service.ts:85-86). 웹은 같은 스키마로 읽어 토스트를 띄운다.
- `GameAccountSyncError` 7개는 integration 작업자 `toSyncError`가 기록하고, API 뷰는 enum 밖 값을 INTERNAL_ERROR로 바꾼다. 웹 `SYNC_ERROR_MESSAGES`는 `Record<GameAccountSyncError>`다.
- Q1 이전 문구(P3)는 세 곳 모두 고쳐졌다. LIMIT_REACHED는 「라이엇 ID 최대 개수 또는 스팀 1개」, ALREADY_LINKED는 타인 전용 문구, TO_ME는 별도 문구다.

### GAME_ACCOUNT_ALREADY_LINKED_TO_ME 실제 발생 경로 (D60)

1. 시작 6단계 `assertPuuidFree`: PUUID의 lol 행이 본인 것이면 TO_ME(riot-link.service.ts:60-65, 90). e2e 「본인이 이미 연동한 라이엇 ID → 409 TO_ME」로 확인.
2. 확인 5단계 트랜잭션 안에서 다시 검사(181). e2e 「확인 시점에 … 본인이 같은 ID를 이미 연동 → TO_ME」로 확인.
3. insert에서 P2002(external_id)가 나면 소유자를 다시 조회해 본인이면 TO_ME(213-227). 실제 DB로는 미실행.

스팀은 1개 제한이라 TO_ME가 나지 않고 LIMIT_REACHED가 된다(계약 2절 표와 같음).
웹은 이 코드를 문구로 보여 준다. 다만 confirm의 onError 무효화 목록(`hooks/game-accounts.ts:179`)에 TO_ME가 빠져 있다. 목록을 새로 받지 않을 뿐 문구는 정상으로 나오므로 결함으로 보지 않았다.

## F4. enum·전이·core 사용

- Prisma enum 2개(`game_account_sync_state`, `riot_link_verification_status`)의 값이 shared enum과 같다.
- **동기화 상태 전이**(D59 맵): 갱신 코드를 전수 확인했다.
  - backend: idle → queued, 멈춘 행 → queued(조건부 WHERE).
  - integration: claim / release / requeue / requeueStuck.
  - 맵 밖 전이는 없다.
- **소유 확인 상태 전이**: 모든 갱신이 `assertVerificationTransition` 검사와 `status='pending'` 조건부 update를 함께 쓴다.
- **core 재구현 없음**: backend와 integration이 KST 하루 경계, quota, 주 포지션, 아이콘, 랭크 변환·비교, 캐시 만료를 모두 `@gcd/core`에서 import한다.
- **`recent_matches.summary`**: 생산자(sync-worker)와 소비자(profile.service) 모두 `LolMatchSummary`를 쓴다.

## F5. 보안 경계 (계약 13절 qa)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 외부 식별자 비노출(D38) | ✓ | 응답이 모두 스키마 parse를 거침. e2e가 원문에 가짜 PUUID·스팀 ID·매치 ID·`external_id` 키가 없음을 검사. 웹은 스팀 ID 숫자를 표시하지 않음 |
| 남의 계정을 대표 지정 | 404 ✓ | e2e |
| 스팀 콜백 변조(return_to·claimed_id·op_endpoint·state) | `302 steam_error`, 행 생성 없음 ✓ | integration 단위 테스트 + backend e2e |
| 남의 계정·확인 id | 404 ✓ | e2e |
| 해제·재연동으로 횟수 회복 | 불가 ✓ | FK SetNull + e2e |
| 동시 sync 한도 | 인메모리 ✓, 실제 DB **미실행** | advisory lock `sync-quota:` + DB 테스트 작성됨 |
| 대표 갱신 순서 | false 먼저, 그다음 true ✓ | game-accounts.service.ts:99-106 |
| 429 처리 | 호스트별 정지, 즉시 재시도 없음, 3번째 기록 ✓ / 401·403 재시도 없음 ✓ | integration 테스트 |
| KST 경계 | ✓ | core 경계 테스트(TZ 3종), backend e2e 「자정 지나면 초기화」, 웹 표기 Asia/Seoul 고정 |
| fixture에 실제 키·PUUID 없음 | ✓ | `FAKE-PUUID-…`, `76561190000000001`, `test-*-key` |

## F6. 슬라이스 대조 (`slice.md`)

| 슬라이스 포함 항목 | 결과 |
| --- | --- |
| 라이엇 ID 연동 → PUUID → 소유 확인 → lol·tft 두 행(D25), 해제 | 구현됨(부계정 3개·대표 지정 D56 추가) |
| 스팀 연동·해제, 플레이타임 동기화, 비공개 안내 | 구현됨(Steam OpenID, `STEAM_PROFILE_PRIVATE`는 동기화 오류로 처리 D44) |
| 티어 → rank_snapshots, 최근 전적, 스팀 플레이타임 저장 | 작업자 구현됨. DB 기록은 **미실행** |
| 수동 새로고침 하루 5회(KST), 실패 시 마지막 성공값과 갱신 시각, 429 Retry-After | 구현됨 |
| 주기 작업(티어 1시간·활동 우선, 스팀 새벽, 전적 프로필 조회 시 큐) | 구현됨(cron KST, advisory xact lock D62). 실제 실행 **미실행** |
| API: 문서 6장 경로 + 소유 확인 | 구현됨(9개) |
| 화면 `/members/[id]`(연동 칩, 티어 카드, 주 포지션, 최근 전적, 내전·뱃지 빈 상태) | 구현됨 |
| 화면 `/settings`(게임 계정 연동, 디스코드 읽기 전용, 테마 유지) | 구현됨 |

| 슬라이스 제외 항목 | 결과 |
| --- | --- |
| 내전 레이팅·그래프·승률(S3) | 빈 상태만(`scrim: null`) ✓ |
| 뱃지(P2) | 빈 상태만(`badges: null`) ✓ |
| 알림 설정 | 설정 화면에 알림 섹션 없음 ✓ |
| 활동·플레이타임 랭킹(S5) | 미구현, 데이터 수집까지만 ✓ |
| 운영진 수동 소유 승인(S6) | 라우트 없음 ✓ |

## F7. 명세 대조 (문서 2·5·6·8·9장)

| 장 | 항목 | 결과 |
| --- | --- | --- |
| 2장 | 게임 계정 연동(P0): 라이엇 ID·스팀 ID 등록 + 소유 확인 | 구현됨. 단 스팀은 「ID 입력」 대신 Steam OpenID 로그인(메인 기본값 2, D34) → **명세 갱신 필요** |
| 2장 | 내 프로필(P0): 게임별 티어, 주 포지션, 최근 전적, 내전 승률, 뱃지 | 티어·주 포지션·최근 전적 구현. 내전 승률·뱃지는 S3·P2 빈 자리(계약 1절 제외, 누락 아님) |
| 5장 | game_accounts(user_id, game_id, external_id, display_name, verified, last_synced_at), rank_snapshots, steam_playtime 컬럼 | 있음. 추가 컬럼·테이블(is_primary, sync_state 등, riot_link_verifications)은 계약 3절 |
| 5장 | S0 필수(`users.discord_id`, `activity_logs.idempotency_key` UNIQUE, `api_keys.key_hash`, 인덱스 3개) | 회귀 없음(S1 마이그레이션은 game_accounts·sync_requests·새 테이블만 변경) |
| 6장 | `POST, DELETE /me/game-accounts`, `POST /me/game-accounts/{id}/sync`, `GET /users/{id}/profile` | 구현됨. 차이: DELETE는 `/:id`, 추가 경로 5개(GET 목록, confirm, 확인 취소, steam callback, primary) → **명세 갱신 필요**(D32·D35·D56) |
| 8장 | `/members/[id]`: 연동 계정, 게임별 티어, 레이팅 그래프, 최근 전적, 뱃지 | 구현됨(그래프·뱃지는 빈 상태) |
| 8장 | `/settings`: 게임 계정 연동, 디스코드 연동 코드, 알림 설정 | 게임 계정 연동 구현. 디스코드는 로그인 계정 표시만(D23), 알림 없음(D48) → **명세 갱신 필요**(S0부터 이어진 항목) |
| 9장 | 외부 호출은 서버에서만, 결과 DB 저장 | ✓ |
| 9장 | 라우팅 asia/kr, 개발 키 한도 전제 버킷·큐 | ✓(env 설정값, 호스트별 버킷 2개) |
| 9장 | 소유 확인(지정 아이콘 변경) | ✓. 아이콘 0–28 선택 가능 여부는 I2 미확인 → D65 「다른 아이콘 받기」로 위험을 줄임. **실제 키로 확인 필요** |
| 9장 | 스팀 비공개 시 안내 + 실패 사유 | ✓(목업 문구, 「다시 시도 · 오늘 N회 남음」) |
| 9장 | 캐싱 표: 티어 1시간·활동 우선 / 전적 6시간·조회 시 큐 / 스팀 하루 1회 새벽 / 수동 5회 / 랭킹 5분(S4) | 랭킹 5분을 뺀 S1 몫 전부 ✓ |
| 9장 | 실패하면 마지막 성공값 + 갱신 시각 표시, 429면 대기 후 재시도 | ✓(데이터를 지우지 않음, synced_at 표시, Retry-After 정지 후 재등록) |
| 목업 | 롤체 「순방 %」 | D66에 따라 「1위 N회 (비율)」로 대체(TFT wins = 1위 횟수) → 목업과 다른 점으로 기록 |

## 이전 결함 재확인

| 출처 | 결함 | 상태 |
| --- | --- | --- |
| plan P1–P7 | 계약 내부 불일치 | 계약 변경 이력 13줄에 모두 반영(D59–D61 등)했다. 코드에서도 확인함(전이 맵, limits, TO_ME, 문구) |
| integration m1 | 회수 시 항상 riot-full | D67로 계약을 고쳐 정합 |
| integration m2 | SYNC_JOBS_ENABLED=false가 소비자까지 끔 | D69로 결정. `jobs.module.ts:48-50`에서 소비자가 항상 시작되는 것을 확인 |
| integration m3 | PrismaSyncStore DB 테스트 미작성 | `test/db/sync-store.db.e2e.spec.ts` 8건 작성(미실행) — 해소 |
| web m1 | 부계정 확인 후 폼 재오픈 | `game-accounts-section.tsx:351-352`에 `useEffect(() => { if (state === 'verifying') setOpen(false) })`가 추가됨. verifying에 들어가면 열림 상태가 초기화되므로, 확인을 마치고 'more'로 돌아오면 버튼 상태로 표시된다. 코드로 확인함(브라우저 확인은 미실행). typecheck·test·build 통과 — 해소 |

## 결함

없음 (blocker 0, major 0, minor 0).

## 미실행·키 필요 (통과로 보지 말 것)

| 항목 | 이유 | 준비된 테스트 |
| --- | --- | --- |
| 마이그레이션 적용, 부분 고유 인덱스의 실제 거부, 실제 P2002 `meta.target` 형식 | PostgreSQL 없음 | `test/db/game-accounts.db.e2e.spec.ts` |
| advisory lock 실제 실행, 동시 대표 지정·동시 확인·동시 sync 경계 | 같음 | 같음 |
| 작업자 DB 기록, 생산자 SQL(55분·활동 우선), `pg_try_advisory_xact_lock` | 같음 | `test/db/sync-store.db.e2e.spec.ts` |
| BullMQ 큐·일시정지 | Redis 없음 | 없음(작성만) |
| 라이엇·스팀·Steam OpenID 실제 왕복, 아이콘 0–28 선택 가능(I2) | 키 필요 | fixture 기반 테스트로 대체 |
| 빌드 산출물 기동(`node dist/main.js`) | DB 없음 | e2e 테스트 앱으로 DI·라우트 확인 |
| 브라우저 렌더(데스크톱·모바일 × 라이트·다크) | 도구 없음 | 빌드·코드 정적 검사로 대체 |

## 명세 문서 갱신 필요 목록 (S1분)

1. 2장 게임 계정 연동: 스팀은 「ID 등록」 대신 Steam OpenID 로그인으로 소유 확인. 라이엇 부계정(최대 3)과 대표 계정.
2. 6장: `DELETE /me/game-accounts/{id}`, 추가 경로(GET `/me/game-accounts`, 소유 확인 confirm·취소, steam callback, primary).
3. 8장 `/settings`: 디스코드 연동 코드 → 로그인 계정 표시(D23), 알림 설정은 이후 슬라이스(D48).
4. 목업 Profile 「순방 %」 → 「1위 N회 (비율)」(D66).
