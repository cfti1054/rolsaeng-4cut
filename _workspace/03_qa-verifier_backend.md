# QA: backend (apps/api game-accounts·profile) — 판정: pass

작성: qa-verifier, 2026-10-29
대상: `apps/api/src/modules/game-accounts/**`, `modules/profile/**`, `common/{app-error,filters/error.filter,advisory-lock,unique-violation,signed-cookie,clock}.ts`, `config/env.ts`, `app.module.ts`, `main.ts`, `load-env.ts`, e2e·DB 테스트
구현자 보고서: `_workspace/02_backend-dev_s1.md`
기준: 계약 2·4·5·7·8절, D38·D41·D45·D51·D56·D59–D61, 리더 결정 D67–D72(결함으로 보지 않음). 체크리스트 `_workspace/03_qa-verifier_plan.md` D절.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `rm -rf apps/web/.next` 후 `corepack pnpm -r typecheck` | shared·core·web·api Done |
| `corepack pnpm -r test` | shared 34, core 79, web 80 passed. api **20 files passed / 3 skipped, 271 passed / 20 skipped** — 보고서 수치와 같음 |
| `corepack pnpm -r build` | shared·core·api Done, web Compiled successfully |
| `corepack pnpm install --frozen-lockfile` | Done |
| `npx prisma validate` | valid |
| 450b091 스키마 → 현재 스키마 `migrate diff` 출력과 migration.sql 1–62줄 비교 | **같음** |
| `grep one_primary\|DROP INDEX migrations/*/migration.sql` | `CREATE UNIQUE INDEX "game_accounts_one_primary_per_user_game" … WHERE "is_primary"`(s1 67줄) 유지. DROP은 S0의 `game_accounts_user_id_idx` 1건뿐 |
| `git diff 450b091 -- prisma/migrations/20261028000000_s0` | 변경 없음 |
| 컨트롤러 라우트 전수(`@Get/@Post/@Delete`) | S1 9개 = 계약 4절, 전부 `ApiPath.*` 상수 사용. `/admin/riot-verifications` 없음(S6 예약) |
| `res.json`·`@Res()` 직접 응답 | 스팀 콜백 1곳뿐(302 redirect). 나머지는 모두 `Schema.parse`를 거친 값을 반환 |
| DB e2e(`test/db/game-accounts.db.e2e.spec.ts` 7건, `sync-store.db.e2e.spec.ts` 8건) | **미실행**(PostgreSQL 없음, skip이 표시됨) |
| 빌드 산출물 실행(`node dist/main.js`) | **미실행**(DB 없이는 Prisma 연결 단계에서 멈춤). 라우트·DI 연결은 Nest 테스트 앱 e2e로 확인 |
| 실제 라이엇·스팀 왕복 | **키 필요** |

## 체크리스트 대조

### D1 공통
- **`AppError.retryAfterSec`**: 값은 올림하고 최소 1이다. 필터가 이 값을 `Retry-After` 헤더로 붙이고, 본문은 `{code,message}` 그대로다(error.filter.ts).
  - 헤더가 붙는 오류: SYNC_LIMIT_EXCEEDED, RATE_LIMITED(하루 10회·5초 간격), GAME_PROVIDER_RATE_LIMITED.
- **오류 코드 29개**: `ErrorCode`·`ERROR_HTTP_STATUS`가 모두 29개이고, `DEFAULT_ERROR_MESSAGE`가 `Record<ErrorCode>`라 컴파일러가 누락을 막는다.
- **`:id` 검증**: `IdParam` 파이프로 UUID가 아니면 400(e2e 있음).
- **직렬화**: 모든 응답이 shared 스키마 parse를 거친다.
  - 대상: `GetMyGameAccountsResponse`, `LinkGameAccountResponse`, `ConfirmRiotVerificationResponse`, `SetPrimaryGameAccountResponse`, `SyncGameAccountResponse`, `GetUserProfileResponse`, `GameAccountView`, `RiotLinkVerificationView`.
  - `last_sync_error`가 enum 밖의 값이면 INTERNAL_ERROR로 내보낸다(game-account-views.service.ts:103-121, e2e 있음).
- **env**: 계약 11절 13행을 모두 받는다. `SYNC_JOBS_ENABLED`는 엄격 파싱(D72).

### D2 엔드포인트 9개
- 경로, 메서드, 상태 코드(200, 204, 302, 202)가 계약 4절과 같다(game-accounts.controller.ts:49-120, profile.controller.ts:14).
- 스팀 콜백만 `JwtGuard`가 없다. 가드를 메서드마다 붙여서 콜백에는 걸리지 않는다. e2e 「Authorization만으로는 연동되지 않는다」로 확인.
- 고정 세그먼트(`riot-verifications`, `steam`)와 `:id` 라우트는 세그먼트 수가 달라 충돌하지 않는다.

### D3 라이엇 소유 확인 (5-1)
- **시작** (riot-link.service.ts:68-123): 단계 순서가 계약과 같다.
  - 키 → 라이엇 ID 수 → 오늘(KST) 10회 → Account-V1 → PUUID 확인(본인이면 TO_ME, 타인이면 ALREADY_LINKED) → Summoner → `pickVerificationIcon` → 트랜잭션(기존 pending → cancelled + insert).
- **확인** (126-210):
  - verified 재호출은 멱등. cancelled·expired면 410. pending이 만료됐으면 expired로 바꾸고 410.
  - 5초 간격은 조건부 update로 원자적으로 판정한다(B4).
  - 아이콘이 다르면 409를 주고 pending을 유지한다.
  - 연동은 advisory lock 트랜잭션 안에서 처리한다: 한도·중복을 다시 검사하고, lol·tft insert(첫 연동이면 대표, queued), pending → verified 조건부 update(0행이면 되돌림, B5).
  - P2002가 나면 소유자를 다시 조회해 분류한다. 커밋한 뒤 `riot-full`(link)을 등록하고 횟수는 차감하지 않는다.
- 모든 상태 변경은 `canTransition` 검사와 `WHERE status='pending'` 조건부 update를 함께 쓴다.

### D4 대표 계정 (D56)
- **갱신 순서 확인**: `setPrimary`는 한 트랜잭션에서 advisory lock을 잡고, **기존 대표 → false**(99-102) **다음에** 대상 lol·tft → true(103-106)를 실행한다. 이미 대표인 행·스팀 행은 변경 없이 200, 남의 계정은 404.
- **해제**: 두 행을 삭제한 **뒤에** 가장 오래된 라이엇 ID(verified_at, 같으면 id)를 승격한다(game-accounts.service.ts:67-88). 같은 트랜잭션이다.
- **스팀**: insert에 `is_primary=true`. P2002가 `one_primary`면 LIMIT_REACHED, `external_id`면 소유자로 구분한다(steam-link.service.ts:173-183). 분류 함수 단위 테스트 있음.
- **부분 고유 인덱스**: 가짜 DB에서 흉내 낸 e2e 1건과 실제 DB 테스트 1건(미실행)이 있다.

### D5 스팀 (5-2) — 보안 경계
- **시작**: authorize_url 파라미터 6개, return_to = 웹 오리진 콜백 `?state`, realm = 웹 오리진.
  - `gcd_steam` 쿠키: HttpOnly, Lax, Path=`/api/v1/me/game-accounts/steam`, Max-Age=600, production에서 Secure(steam-link-cookie.ts). 서명 유틸은 S0와 공유한다(`signed-cookie.ts`).
- **콜백** 처리 순서:
  1. 쿠키를 즉시 삭제한다(같은 Path, 컨트롤러 92줄).
  2. cancel이면 CANCELLED, mode가 id_res가 아니면 OPENID_INVALID.
  3. 쿠키·state 검사(상수 시간 비교) → 쿼리 배열 값은 변조로 본다 → 키 확인(B3).
  4. integration의 `verifyOpenIdAssertion`(return_to, claimed_id, op_endpoint, ns 검사) → 사용자 존재 → personaname(실패하면 「스팀 사용자」).
  5. lock 트랜잭션에서 insert.
- 실패는 모두 `302 /settings?steam_error={SteamLinkErrorCode}`(D71), 예상 못한 예외는 INTERNAL_ERROR.
- 변조·분기 e2e: 취소, mode 이상, return_to·claimed_id 변조, is_valid false, 5xx, 429, 쿠키 없음, state 불일치, 위조, 600초 초과, 타인 스팀 ID, 사용자 삭제, 다른 탭 선연동.

### D6 해제 (5-3)
- 라이엇은 어느 행 id로 와도 같은 external_id의 두 행을 삭제한다.
- 스냅샷·플레이타임은 Cascade로 지워지고, 새로고침 횟수 기록은 SetNull로 남는다(e2e 있음).

### D7 수동 새로고침 (7절)
- 처리 순서 (game-accounts.service.ts:113-171):
  1. 본인 행이 아니면 NOT_FOUND, 키가 없으면 NOT_CONFIGURED.
  2. `sync-quota` lock을 잡고, 10분 안에 진행 중이면 차감 없이 처리.
  3. `kstDayWindow(now).start` 이후 사용 수가 한도 이상이면 429 + `Retry-After` = 다음 KST 자정까지 초(올림).
  4. insert와 queued 갱신(D59 멈춘 행 조건) → 커밋 후 lol 행 id로 `riot-full`(manual) 등록.
- KST 자정 초기화, 라이엇·스팀 합산, 해제·재연동으로 횟수 회복 불가, 동시 요청 1회 차감(인메모리)을 e2e로 확인. DB 경계 테스트는 작성만 됐다.
- 연동·프로필 조회·cron 경로에는 `gameAccountSyncRequest.create`가 없다.

### D8 프로필 (8절)
- **기본 필드**: 로그인 멤버 누구나 조회할 수 있고, `is_self`, `sync_quota`는 본인만(타인은 null). `scrim`·`badges`는 null. `ProfileUser`에 email·discord_id가 없다.
- **대표 계정 기준 데이터**
  - tiers: 대표 lol·tft 순서.
  - main_position: core `computeMainPosition`(최신 20경기).
  - recent_matches: 최신 10경기, summary가 깨진 행은 건너뛴다. 챔피언 이름은 Data Dragon 한글명, 없으면 key.
- **riot-matches 등록 조건**: idle이고 `isMatchesCacheStale`이며 30분 안에 실패 기록이 없을 때만 등록한다(profile-view, 우선순위 2, 차감 없음). idle이 아니면 refresh_queued=true(profile.service.ts:145-152).

### D9 외부 식별자 비노출 (D38)
- 응답은 전부 shared 스키마 parse를 거친다. e2e가 응답 원문에 가짜 PUUID·스팀 ID·매치 ID와 `puuid`/`external_id` 키가 없음을 검사한다(목록, 시작, confirm, sync, 프로필).
- 302 Location에는 코드만 들어간다.
- 로그에는 user·account id만 남긴다. 스팀 콜백 INTERNAL_ERROR 로그는 stack을 남기는데, Prisma 고유 제약 오류 메시지에는 필드 이름만 들어가므로 문제가 없다.

### D10 보안·권한 매트릭스

| 시나리오 | 결과 |
| --- | --- |
| 비로그인으로 S1 JWT 엔드포인트 호출 | 401 (e2e: 목록, 프로필) |
| 남의 계정 id로 해제·sync·대표 지정 | 404 (e2e) |
| 남의 확인 id로 confirm·취소 | 404 (e2e) |
| 타인이 연동한 PUUID·스팀 ID | 409 ALREADY_LINKED (e2e) |
| 본인 라이엇 ID 재추가 | 409 ALREADY_LINKED_TO_ME (시작 단계, 확인 단계, P2002 경로) |
| 라이엇 4번째 / 스팀 2번째 | 409 LIMIT_REACHED (e2e) |
| 해제 후 재연동하고 sync | 횟수 회복 없음 (e2e) |
| 스팀 콜백 변조 | `302 steam_error`, 행 생성 없음 (e2e) |

## 결함

없음 (blocker 0, major 0, minor 0).

## 참고 (결함 아님)

1. B1–B11은 계약 빈칸을 채운 해석이다. 이 중 D70(B1), D71(B2), D72(B11)은 리더 결정이 났다. 나머지(B3–B10)도 계약 순서·의미와 충돌하지 않는다.
2. `advisoryXactLock`은 `$executeRaw`로 `SELECT pg_advisory_xact_lock(...)`을 실행한다. 반환형이 void라서 이렇게 우회했고, 실제 DB에서 동작하는지는 미실행 DB 테스트 「advisory lock SQL이 실행되고」로만 확인할 수 있다.
3. 실제 P2002의 `meta.target` 형식은 추정값이다. 분류 함수는 배열·이름·camelCase를 모두 받도록 만들었고, 실제 형식 확인은 DB 테스트 몫이다.
4. integration m3(DB 테스트 미작성)은 `test/db/sync-store.db.e2e.spec.ts`(8건, 작성만)로 해소됐다. D69(소비자 항상 실행)도 `jobs.module.ts:48-50`에 반영된 것을 확인했다.
