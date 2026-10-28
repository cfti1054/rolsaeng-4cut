# backend-dev 보고서: S0 auth · me (apps/api)

작성: 2026-10-28, backend-dev. 계약: `_workspace/01_architect_contract.md`, `packages/shared/src/**`.
커밋하지 않음.

## 1. 모듈 진행

| 모듈 | 상태 | 비고 |
| --- | --- | --- |
| 부트스트랩·common·prisma | 완료 | |
| auth (5개 엔드포인트) | 완료 | 디스코드 HTTP는 목으로 검증. 실제 디스코드 키로는 시험하지 않음 |
| users (GET/PATCH /me) | 완료 | |

## 2. 구현 파일 (`apps/api/`)

| 파일 | 내용 |
| --- | --- |
| `src/main.ts` | `.env` 로드(`process.loadEnvFile`) → zod 환경 변수 검증(실패 시 exit 1) → Nest 기동, `API_PORT` |
| `src/bootstrap.ts` | `configureApp`: 전역 접두사 `API_PREFIX`, `cookie-parser(COOKIE_SECRET)`, `x-powered-by` 끔, CORS 안 엶. main과 테스트가 같이 씀 |
| `src/app.module.ts` | Config·Prisma·Auth·Users 모듈, `APP_FILTER` = ErrorFilter |
| `src/config/env.ts`, `config.module.ts` | 계약 10절 zod 스키마, `AppConfig`, `APP_CONFIG` 토큰, `isDiscordConfigured`, `devLoginEnabled` |
| `src/common/app-error.ts` | `AppError(code, status?, {message, details})`, 기본 상태 = `ERROR_HTTP_STATUS`, 코드별 한국어 기본 메시지 |
| `src/common/filters/error.filter.ts` | 모든 예외 → `ErrorBody`. Nest 내장 예외(라우트 404 등)·body-parser 오류 → 계약 코드, 내부 메시지 숨김 |
| `src/common/pipes/zod.pipe.ts` | `ZodValidationPipe(shared 스키마)` → VALIDATION_FAILED + `details[{path,message}]` |
| `src/common/serialize.ts` | camel→snake + Date→ISO + Response 스키마 parse. production이 아니면 위반 시 500 |
| `src/common/jwt.ts` | HS256 발급·검증(node:crypto, 의존성 추가 없음). `alg` 고정, 상수 시간 비교, `AccessTokenClaims`로 파싱 |
| `src/common/guards/jwt.guard.ts` | 5-2 규칙(헤더·서명·typ → UNAUTHENTICATED, exp → ACCESS_TOKEN_EXPIRED, 사용자 없음 → UNAUTHENTICATED) |
| `src/common/guards/roles.guard.ts`, `decorators/roles.ts` | `@Roles('admin')`, 토큰 role 클레임으로 판단 → FORBIDDEN |
| `src/common/guards/origin.guard.ts` | Origin 있고 `WEB_ORIGIN`과 다르면 FORBIDDEN |
| `src/common/decorators/current-user.ts` | `@CurrentUser()` → `{id, role}` |
| `src/prisma/prisma.service.ts`, `prisma.module.ts` | 전역 PrismaService(지연 연결), `isUniqueViolation` |
| `src/modules/auth/auth.controller.ts` | 5개 엔드포인트. 경로는 `ApiPath` 상수 |
| `src/modules/auth/auth.service.ts` | OAuth 시작·콜백, 사용자 upsert(관리자 승격, 이메일 규칙), dev-login, 토큰 응답 조립 |
| `src/modules/auth/refresh-token.service.ts` | 발급·회전·유예·재사용 감지·family 폐기. SHA-256 hex만 저장 |
| `src/modules/auth/discord-oauth.client.ts` | `DiscordOAuthClient` 인터페이스 + `DISCORD_OAUTH_CLIENT` 토큰 + `FetchDiscordOAuthClient`(타임아웃 5초) + authorize URL |
| `src/modules/auth/oauth-state.ts` | `gcd_oauth` 값 서명·검증(HMAC-SHA256, 600초), state 상수 시간 비교 |
| `src/modules/auth/default-nickname.ts` | `deriveDefaultNickname`(5-7) |
| `src/modules/auth/redirect.ts` | SafeRedirect 처리, `/login?error=` URL, `/welcome?redirect=` |
| `src/modules/auth/cookies.ts` | `gcd_rt`(Path=/), `gcd_oauth`(Path=/api/v1/auth) 설정·삭제 |
| `src/modules/auth/dev-login.guard.ts` | 닫혀 있으면 404. 본문 검증·Origin 검사보다 먼저 실행 |
| `src/modules/users/users.controller.ts`, `users.service.ts`, `users.module.ts` | GET/PATCH /me |
| `src/modules/users/me.mapper.ts` | users 행 → `Me`(avatar_url 조립, dev 사용자 null) |
| `vitest.config.ts` | `ssr.resolve.conditions` 추가(아래 4절), testTimeout 30초 |
| `test/support/fake-prisma.ts` | 인메모리 Prisma 대체(사용하는 호출만, 한계는 파일 주석에 적음) |
| `test/support/test-app.ts` | 테스트 앱 팩토리(Config·Prisma·Discord 목 주입) |

## 3. 엔드포인트별 상태

| 메서드 경로 | 상태 | 검증 방법 |
| --- | --- | --- |
| GET /api/v1/auth/discord | 구현·테스트 통과 | HTTP 테스트 + 빌드 산출물 스모크(302, 쿠키 속성) |
| GET /api/v1/auth/discord/callback | 구현·테스트 통과 | 디스코드 목: 성공(신규·기존)·취소·기타 error·state 불일치/없음/위조/만료·길드 404·pending·provider 오류·예상 못한 예외·미설정 |
| POST /api/v1/auth/refresh | 구현·테스트 통과(인메모리) | 회전·유예 10초·재사용 감지 family 폐기·동시 3건·만료·Origin. 실제 DB는 미실행 |
| POST /api/v1/auth/logout | 구현·테스트 통과 | 204, family 폐기, 쿠키 삭제, 쿠키 없음·모르는 토큰도 204, Origin |
| POST /api/v1/auth/dev-login | 구현·테스트 통과 | 열림·role 적용·검증 실패·잘못된 JSON·Origin·닫힘 3종(false/빈 값/production) → 404 |
| GET /api/v1/me | 구현·테스트 통과 | 정상·avatar_url·인증 실패 4종·위조 서명·사용자 없음·만료 |
| PATCH /api/v1/me | 구현·테스트 통과(인메모리) | 정규화 저장·첫 확인·NICKNAME_TAKEN·검증 실패 6종·인증 우선. 실제 DB UNIQUE는 미실행 |

## 4. 테스트 실제 출력

`corepack pnpm --filter api test`:

```
 ✓ src/config/env.spec.ts (4 tests) 12ms
 ✓ src/common/jwt.spec.ts (4 tests) 11ms
 ✓ src/modules/auth/oauth-state.spec.ts (18 tests) 15ms
 ✓ src/modules/auth/discord-oauth.client.spec.ts (7 tests) 44ms
 ✓ src/modules/auth/default-nickname.spec.ts (18 tests) 70ms
 ✓ src/common/filters/error.filter.spec.ts (6 tests) 29ms
 ↓ test/db/auth.db.e2e.spec.ts (5 tests | 5 skipped)
 ✓ test/refresh-token.service.spec.ts (5 tests) 31ms
 ✓ test/me.e2e.spec.ts (19 tests) 5433ms
 ✓ test/auth.e2e.spec.ts (39 tests) 9383ms
 Test Files  9 passed | 1 skipped (10)
      Tests  120 passed | 5 skipped (125)
```

- `corepack pnpm -r typecheck`: shared, core, web, api 모두 Done(통과).
- `corepack pnpm --filter "api..." build`: shared → core → api 통과, `apps/api/dist/**` 생성.
- `corepack pnpm -r build`: **web 실패**(api 문제 아님). `next/font`가 Google Fonts(Chakra Petch, IBM Plex Sans KR)를 받지 못함(ECONNRESET). frontend 쪽 사안.
- 빌드 산출물 스모크(`node dist/main.js`, DB 없음): 필수 환경 변수 없으면 exit 1 + 목록 출력. 기동 후 `GET /auth/discord` 302 + `gcd_oauth`, `GET /nope` 404 `{code:NOT_FOUND}`, dev-login(닫힘) 404, refresh(쿠키 없음) 401 REFRESH_TOKEN_INVALID, logout 204 + `gcd_rt` 삭제, `/me`(인증 없음) 401 UNAUTHENTICATED.

## 5. 미실행 항목 (실제 PostgreSQL 필요, 이 PC에 Docker 없음)

`test/db/auth.db.e2e.spec.ts`는 작성했지만 `TEST_DATABASE_URL`이 없어 **skip(미실행)** 상태다. 통과했다고 보지 말 것.

| 테스트 | 내용 |
| --- | --- |
| 리프레시 회전 | 같은 family·같은 expires_at, 원문 미저장 |
| 유예·재사용 | 10초 안 200(쿠키 없음), 10초 후 REUSED + family 전체 폐기 |
| 동시 refresh | `Promise.all` 5건 → 모두 200, 회전 1번, 살아 있는 토큰 1개(실제 행 잠금·조건부 update) |
| NICKNAME_TAKEN | DB UNIQUE, 정규화 값 기준, 같은 닉네임 동시 PATCH → [200, 409] |
| 시드 | `prisma/seed.ts` 2회 실행 → games 3행 |

실행 방법(파일 머리 주석과 같음): `docker compose up -d postgres` → `TEST_DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=test` 설정 → 같은 URL로 `prisma:deploy` → `corepack pnpm --filter api test`.

같은 흐름의 **로직**은 인메모리 Prisma(`FakePrisma`)로 검증해 통과했다. 인메모리 대체는 트랜잭션을 직렬화로 흉내 낼 뿐, PostgreSQL 격리 수준·행 잠금·실제 P2002 메타 형식은 검증하지 못한다.

## 6. 계약과 다르게 하거나 계약에 없던 결정

계약(shared 코드·스키마)은 바꾸지 않았다. 아래는 계약이 정하지 않은 부분을 채운 것과, 문서와 약간 다른 해석이다. 리더 확인을 바란다.

| # | 내용 | 이유 |
| --- | --- | --- |
| B1 | **유예 응답에 추가 조건**: 회전된 토큰이 10초 안에 다시 와도, 그 family에 살아 있는(미폐기·미만료) 토큰이 없으면 REFRESH_TOKEN_INVALID | 계약 5-3 4번을 그대로 하면 "회전 → 로그아웃 → 10초 안에 이전 쿠키로 refresh"가 새 액세스 토큰을 받는다. 로그아웃 우회 방지 |
| B2 | refresh가 **쿠키 없음**으로 실패해도 `gcd_rt` 삭제 헤더를 보낸다(계약은 3번 "없음·만료"에만 명시) | 무해하고 분기가 단순해진다. REUSED·로그아웃 폐기 토큰도 삭제 |
| B3 | `/login?error=` URL에 `redirect`가 `/`면 붙이지 않는다 | 기본값과 같아 정보가 없다. `/` 외 값은 붙인다. OAUTH_NOT_CONFIGURED(시작 엔드포인트)에도 붙인다 |
| B4 | 콜백 쿼리가 스키마에 안 맞으면(같은 키 중복 등) OAUTH_STATE_INVALID, `error`·state 정상인데 `code`가 없으면 OAUTH_PROVIDER_ERROR | 계약에 없는 경우 |
| B5 | 콜백의 redirect는 state 쿠키 서명이 맞고 만료 전일 때만 쓴다(실패 시 `/`) | 위조 쿠키의 값을 믿지 않기 위함 |
| B6 | Nest 내장 예외 매핑: 400·413·415·422 → VALIDATION_FAILED(400), 405 → NOT_FOUND, 그 밖 → INTERNAL_ERROR. 잘못된 JSON 본문 → 400 VALIDATION_FAILED(details 없음) | ErrorCode enum 밖의 값을 내지 않기 위함 |
| B7 | 신규 사용자 생성 중 P2002(nickname 또는 discord_id)면 최대 3회 다시 조회·생성 | 같은 사용자 동시 첫 로그인, 기본 닉네임 경쟁 |
| B8 | dev 사용자 `discord_username` = username 저장(계약 5-8은 discord_id만 명시) | `/welcome` 화면이 `discord_username`을 표시 |
| B9 | JWT를 라이브러리 없이 node:crypto로 구현 | api 의존성에 JWT 라이브러리가 없고, 설치 없이 계약(HS256, 클레임) 충족 가능 |
| B10 | PrismaService는 기동 때 `$connect`하지 않음(첫 쿼리 때 연결) | DB 없이도 기동·OAuth 시작·오류 응답이 동작. DB 오류는 해당 요청의 500으로 나타남 |
| B11 | 응답에 `Cache-Control: no-store`(OAuth 2개, refresh, dev-login) | 토큰이 든 응답 캐시 방지 |

## 7. 남은 문제·리더 전달 사항

1. **vitest가 오래된 `dist`를 읽던 문제**: Vite 7에서 최상위 `resolve.conditions`는 client 환경에만 적용되고, vitest(node)는 ssr 환경이라 `@gcd/shared`를 `dist/index.js`로 읽었다(`normalizeNickname is not a function`). `apps/api/vitest.config.ts`에 `ssr.resolve.conditions`·`externalConditions: ['source']`를 추가해 고쳤다. **`packages/core/vitest.config.ts`도 같은 설정이라 같은 문제가 생길 수 있다**(내 담당 밖, 수정하지 않음). 계약 2절 표의 "vitest: resolve.conditions (이미 설정됨)"도 보완이 필요하다.
2. `node dist/main.js`는 shared·core `dist`를 읽으므로 먼저 `corepack pnpm --filter "api..." build`가 필요하다(계약 2절대로).
3. `corepack pnpm -r build`는 web의 Google Fonts 다운로드 실패로 멈춘다(네트워크). frontend 확인 필요.
4. 실제 디스코드 앱 키로 OAuth를 끝까지 해 보지 않았다(키 없음). fetch 클라이언트는 fetch 목으로 상태 코드·타임아웃·형식 오류 분기만 검증했다.
5. 5절의 DB e2e 미실행.

## 수정 이력

- 2026-10-28 D31(리더 지시): `redirect.ts` `toSafeRedirect`가 `/login`·`/welcome`(하위 경로·쿼리·해시 포함)을 `/`로 바꿈(웹 `safeRedirect`와 같은 규칙). OAuth 시작과 콜백 모두 적용하며, 콜백은 state 쿠키의 redirect에 다시 적용한다(`auth.service.ts`). 첫 로그인 `/welcome?redirect=…` 이동은 유지. 테스트: 단위 11건, e2e 3건 추가.
- 2026-10-28 QA m1: 디스코드 인증 이메일이 shared `Me.email` 규칙을 통과하지 못하면 null로 저장(신규·기존 모두, 기존 저장값도 비움). 미인증 이메일은 이전처럼 기존 값 유지. 회귀 e2e 1건 추가(`user@xn--hxajbheg2az3al.xn--jxalpdlp`, `user@localhost`).
- 수정 후 `corepack pnpm --filter api typecheck` 통과, `corepack pnpm --filter api test` 9개 파일 통과 / 1개 skip, 135개 통과 / 5개 skip(DB e2e는 여전히 미실행).
