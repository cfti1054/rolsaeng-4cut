# QA: auth (apps/api auth·me 모듈) — 판정: pass

검증: qa-verifier, 2026-10-28. 대상 보고서: `_workspace/02_backend-dev_auth.md`
기준: 계약 `_workspace/01_architect_contract.md`(D26 포함), `packages/shared/src/**`, 체크리스트 `_workspace/03_qa-verifier_plan.md` A(api)·B·E(백엔드)
리더 결정 반영: B1 유예 추가 조건 = 계약 D26(결함 아님). web 빌드 실패(Google Fonts)는 이번 판정 제외.

blocker 0, major 0, minor 3. DB 의존 항목은 미실행.

## 실행한 명령과 결과 (직접 실행한 출력 기준)

| # | 명령 | 결과 |
| --- | --- | --- |
| A1 | `corepack pnpm install --frozen-lockfile` | Done in 1.7s, lockfile 불일치 없음 |
| A2 | `corepack pnpm -r typecheck` | shared·core·web·api 모두 `Done` |
| A3 | `corepack pnpm --filter api test` | `Test Files 9 passed \| 1 skipped (10)`, `Tests 120 passed \| 5 skipped (125)`. skip 5건 = `test/db/auth.db.e2e.spec.ts`(DB 필요, 미실행 — 통과로 보지 않음) |
| A3' | `corepack pnpm --filter @gcd/shared --filter @gcd/core test` | shared 9 passed / core 테스트 없음(exit 0) |
| A4 | `corepack pnpm --filter "api..." build` | shared → core → api `Done` |
| A5 | `corepack pnpm --filter api prisma:validate` | **환경 변수 없이 실패**: `P1012 Environment variable not found: DATABASE_URL` (apps/api/.env 없음). `DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=public` 지정 후 `The schema at prisma\schema.prisma is valid` → 결함 m2 |
| A6 | `corepack pnpm --filter api prisma:generate` | 성공 |
| A8 | `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` ↔ `migrations/20261028000000_s0/migration.sql` | 차이 = 파일 끝 빈 줄 1개뿐(CRLF 제거 후 diff). 스키마·마이그레이션 일치 |
| A9 | DB 통합 테스트(회전 실DB, 동시 refresh 행 잠금, NICKNAME_TAKEN UNIQUE, 시드) | **미실행**(Docker 없음). 테스트 코드 존재 확인 |
| A10 | 비밀값 grep(`RGAPI-`, `client_secret=…`, `DISCORD_CLIENT_SECRET=값`) | 문서 외 매치 없음. `.env`, `apps/api/.env`는 `.gitignore:14`로 무시됨 |
| P1 | 빌드 산출물 직접 호출 프로브(node, `dist/modules/auth/redirect.js`, `default-nickname.js`, `common/jwt.js`) | 아래 E·B6 표 |
| P2 | 빌드 서버 기동 후 curl 스모크 | **미실행** — 권한 거부(프로세스 종료 명령 포함). 대신 e2e 테스트가 실제 HTTP(fetch)로 같은 경로를 검증함 |

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| m1 | minor | `apps/api/src/modules/auth/auth.service.ts:234` → `apps/api/src/modules/users/me.mapper.ts:34` → `packages/shared/src/me.ts:43` | 저장하는 이메일은 응답 스키마 `Me.email`(`z.string().email()`)을 통과해야 함. 통과 못 하면 null로 저장하거나 버림 | 디스코드 `verified=true` 이메일을 검증 없이 저장. zod email이 거부하는 주소(예: `user@xn--hxajbheg2az3al.xn--jxalpdlp`, `user@localhost`, `"q"@example.com` — 프로브 결과 `false`)면 이후 `toMe()`의 `serialize`가 개발 모드에서 500(`serialize.ts:40`) → 해당 사용자는 콜백이 `/login?error=INTERNAL_ERROR`, refresh·/me 모두 500이 **계속** 됨. production에선 검증 없이 내보내 웹의 `Me.parse`가 실패. 발생 확률은 낮지만 걸리면 그 사용자는 로그인 불가 | `node -e "require('./packages/shared/dist').Me.shape.email.safeParse('user@xn--hxajbheg2az3al.xn--jxalpdlp')"` → success false. 콜백 목에서 `email`을 위 값, `verified:true`로 주면 재현 |
| m2 | minor | `apps/api/prisma/schema.prisma:20`, 계약 2절 명령 표(`01_architect_contract.md:54`) | 계약의 `corepack pnpm --filter api prisma:validate`가 그대로 통과 | `apps/api/.env`가 없으면 P1012로 실패. DB가 필요 없는 검사인데 DATABASE_URL을 요구함 | A5. 수정 방향(택1): 계약/README에 "`.env.example`을 `apps/api/.env`로 복사 후 실행" 명시, 또는 스크립트에서 기본 URL 주입 |
| m3 | minor | `packages/shared/src/auth.ts:10` 주석 | 계약 5-5: `gcd_oauth` Path=`/api/v1/auth` | 주석은 "둘 다 … Path=/". **구현은 계약대로**(`cookies.ts` `OAUTH_COOKIE_PATH`, e2e 테스트로 Path=/api/v1/auth 확인). 계획서 P1 그대로 남아 있음 — architect 담당 | 파일 열람 |

계약과 다르지만 결함으로 보지 않은 것(보고서 6절):
- B2(쿠키 없음 실패에도 `gcd_rt` 삭제), B11(`Cache-Control: no-store`): 무해, 보안상 이득.
- B3(`/login?error=`에서 redirect가 `/`면 생략, `redirect.ts:21`): 웹이 redirect 없음을 `/`로 처리하면 동작 동일. 웹 검증 때 확인.
- B4·B5·B6·B7·B8·B9·B10: 계약 공백을 채운 것, 계약 위반 없음. B9(자체 JWT)은 아래 프로브로 `alg:none`·`typ` 위조·만료 판정 확인.

## 체크리스트 결과 (B·E)

### B1 부트스트랩·공통
- [x] 전역 접두사 `API_PREFIX` 상수 사용(`bootstrap.ts`), cookie-parser(COOKIE_SECRET), CORS 미개방, x-powered-by 끔.
- [x] env zod: 필수 3개 없으면 `EnvValidationError` → exit 1(`main.ts`), 디스코드·REDIS 선택. `.env.example`의 API 변수 14개 = EnvSchema 키(RIOT/STEAM은 S1, 웹 변수 제외).
- [x] 오류 필터: AppError → `{code,message[,details]}`, details는 VALIDATION_FAILED만. Nest 내장 예외·body-parser 오류 → enum 내 코드, 내부 메시지 숨김. 상태 = `ERROR_HTTP_STATUS`.
- [x] zod 파이프 → 400 VALIDATION_FAILED + details(path는 스키마 키 그대로 snake_case).
- [x] 컨트롤러 반환 4곳(`auth.controller.ts:74,107`, `users.controller.ts:16,25`) 모두 `serialize` 경유(`tokenResponseFor`, `toMe`). 우회 반환 없음.

### B2 엔드포인트 대조 (계약 4절 ↔ 컨트롤러)

| 계약 | 컨트롤러 | 인증/가드 | 일치 |
| --- | --- | --- | --- |
| GET /auth/discord | `auth.controller.ts:45` `ApiPath.authDiscordStart` | 없음 | O |
| GET /auth/discord/callback | `auth.controller.ts:54` | gcd_oauth 쿠키 | O |
| POST /auth/refresh | `auth.controller.ts:66` 200 | OriginGuard | O |
| POST /auth/logout | `auth.controller.ts:87` 204 | OriginGuard | O |
| POST /auth/dev-login | `auth.controller.ts:96` 200 | DevLoginEnabledGuard → OriginGuard → 파이프 | O |
| GET /me | `users.controller.ts:56` | JwtGuard | O |
| PATCH /me | `users.controller.ts:62` | JwtGuard → `UpdateMeRequest` 파이프 | O |

계약 외 엔드포인트 없음. `/auth/signup`·`/auth/login` 없음(D22).

### B3 OAuth 콜백
- [x] state 쿠키 성공·실패 무관 삭제(`auth.controller.ts:58`, 서비스 호출 전).
- [x] 순서: 설정 → 쿼리 파싱 → `error`(access_denied → OAUTH_DENIED, 기타 → PROVIDER_ERROR) → state(서명·600초·상수 시간 비교, 길이 다르면 false로 예외 없음) → 코드 교환 → 사용자 → 길드(404/pending → NOT_GUILD_MEMBER, 그 외 실패 → PROVIDER_ERROR, 타임아웃 5초 `AbortSignal.timeout`) → upsert → 새 family.
- [x] 기존 사용자 닉네임 미덮어쓰기, email은 verified일 때만, admin 승격만. GUILD_ID 비면 `discord_guild_verified_at` 미갱신.
- [x] 디스코드 액세스 토큰 저장 없음(지역 변수만).
- [x] 예상 못한 예외 → 302 `error=INTERNAL_ERROR`(JSON 500 아님), 스택은 서버 로그만.
- [x] scope `identify email guilds.members.read`, `prompt=none` 포함(`discord-oauth.client.ts:41-52`).

### B4 토큰·리프레시
- [x] JWT HS256, `alg` 고정 검사, 상수 시간 서명 비교, 클레임 `AccessTokenClaims` 파싱. 프로브: 정상 ok, `alg:none` → invalid, `typ:'refresh'`(정상 서명) → invalid, 만료 → expired.
- [x] 가드: 헤더 없음/형식 오류/위조 → UNAUTHENTICATED, 만료 → ACCESS_TOKEN_EXPIRED, 사용자 없음 → UNAUTHENTICATED.
- [x] 리프레시 원문 32바이트 base64url, DB는 SHA-256 hex만(`refresh-token.service.ts:11-13`, e2e가 `/^[0-9a-f]{64}$/` 확인).
- [x] 회전: 같은 family·같은 expires_at, 조건부 `updateMany(revokedAt:null)` + 0행이면 유예 판단, 트랜잭션.
- [x] 유예 10초 + D26(계열에 살아 있는 토큰 있을 때만), 초과 → family 폐기 + REUSED, 로그아웃 폐기 → INVALID, 만료 → INVALID. INVALID/REUSED 시 쿠키 삭제.
- [x] 응답 role = DB 최신값(`buildTokenResponse`가 user 재조회).
- [x] `gcd_rt` HttpOnly·Lax·Path=/·production Secure·Max-Age=남은 수명(`cookies.ts`).
- [x] Origin 가드 refresh·logout·dev-login, /me 미적용.

### B5 dev-login
- [x] 열림 = `AUTH_DEV_LOGIN==='true' && !production`(`env.ts`). 닫힘 3종(false/빈 값/production) → 404, 검증·Origin보다 먼저(e2e).

### B6 /me
- [x] `Me` 10개 필드 snake_case, avatar_url 형식, dev 사용자 null.
- [x] PATCH: 파이프 결과(정규화 값)로 비교·저장, 자기 닉네임 재전송은 409 아님, P2002 → NICKNAME_TAKEN, `nickname_confirmed_at`은 null일 때만.
- [x] `deriveDefaultNickname` 프로브(dist): `"ab cdefghij k"` → `"ab cdefghij"`(자른 뒤 끝 공백 제거), 이모지만 → null(다음 후보), `"ㄱㄴ홍길동"` → `"홍길동"`, 탭·특수문자 → `"Saebyeok Pot"`, `head10+2..99` 모두 충돌 → `"abcdefgh1234"`. 모두 `Nickname` 통과 + 정규화 불변.

### B7 스키마·마이그레이션·시드
- [x] 테이블 21개 = 모델 21개 = 계약 6절.
- [x] `users.discord_id` UNIQUE(`migration.sql:346`), `activity_logs.idempotency_key` UNIQUE(:436), `api_keys.key_hash` UNIQUE(:454), api_keys에 원문 컬럼 없음.
- [x] 문서 5장 인덱스 3개: `ratings(game_id, season_id, elo DESC)`(:388), `activity_logs(user_id, started_at)`(:439), `scrim_players(scrim_id, status)`(:415).
- [x] `rating_history(scrim_id, user_id)` UNIQUE(:397, D12).
- [x] enum 7종 값 = shared enum.
- [x] 삭제 정책: 본인 소유 CASCADE, `scrims.host_id`·`scrim_results.submitted_by`·`notices.author_id` RESTRICT. 승인·반려·해결자 등은 SET NULL(계약에 명시 없음, 위반 아님).
- [x] `seed.ts`가 `GAME_SEED` import, code 기준 upsert. 실행은 미실행.

### B8 범위
- [x] 상태 갱신 코드(`status:`) 없음 — S0 정상.

### E 보안 경계 (백엔드)

| # | 시나리오 | 결과 | 근거 |
| --- | --- | --- | --- |
| E1 | 오픈 리다이렉트 | 통과 | 프로브 `toSafeRedirect`: `//evil.com`, `/\evil.com`, `\/evil.com`, `/\\evil.com`, `https://evil.com`, `/\t/evil.com`, `/ //evil`, 배열, 513자 이상 → 모두 `/`. `/%2F%2Fevil.com`은 통과하지만 Location이 `WEB_ORIGIN` 접두라 같은 오리진 경로. e2e `auth.e2e.spec.ts:109` |
| E2 | Origin 불일치 | 통과 | e2e `:359`(refresh, 회전 안 함), `:444`(logout), `:510`(dev-login) |
| E3 | production dev-login | 통과 | e2e `:519-520` |
| E4 | 리프레시 원문 미저장 | 통과 | e2e `:161-162`, 로그에 원문 출력 없음(grep) |
| E5 | 쿠키 속성 | 통과 | e2e `:84`(gcd_oauth), `:116`(production Secure) |
| E6 | 오류 응답에 내부 정보 | 통과 | 필터가 내장 예외 메시지 대신 기본 문구 사용, 500은 고정 문구 |
| E7 | 비밀값 | 통과 | A10 |

## 교차 대조 표

웹 훅 쪽은 `shell` 검증 때 채운다. 오류 코드: 계약 3절 15개 = `ErrorCode` 15개 = `ERROR_HTTP_STATUS` 15개 = `DEFAULT_ERROR_MESSAGE` 15개(`Record<ErrorCode,…>`로 컴파일러가 보장). API가 던지는 코드는 모두 enum 안에 있음(AppError 생성자 타입이 `ErrorCode`).

## 리더 참고
- 구현자 보고 7-1: `packages/core/vitest.config.ts`도 `ssr.resolve.conditions`가 없어 core 테스트가 생기면 오래된 `dist`를 읽을 수 있음. 지금은 core 테스트가 없어 영향 없음. 계약 2절 표 보완 필요(architect).
