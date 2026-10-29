# 계약: S0 골격

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서"), 슬라이스: `_workspace/00_input/slice.md`
실제 계약은 코드가 우선한다: `packages/shared/src/**`, `apps/api/prisma/schema.prisma`. 이 문서는 그 코드의 의도와 규칙을 설명한다.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-28 | S0 최초 작성: 모노레포 골격, 전체 스키마, 인증·내 정보 계약, 테마 토큰 규칙 | architect |
| 2026-10-28 | 「확인 필요」 3건 사용자 답변 반영: 닉네임 공백 허용(연속 공백은 1개로 정규화), 탈퇴 멤버 정책 D24, 라이엇 계정 저장 방식 D25. 영향 파일: `packages/shared/src/me.ts`(`Nickname`, `normalizeNickname`, `NICKNAME_PATTERN`), `packages/shared/src/contract.test.ts`, 이 문서 5-7·12·13절 | architect |

---

## 1. 범위

### 포함 (문서 2장 행 기준)

| 문서 2장 행 | S0 범위 |
| --- | --- |
| 계정 · 가입·로그인 (P0) | 디스코드 OAuth2 로그인(첫 로그인 = 자동 가입), JWT 액세스 + 회전 리프레시, 로그아웃, 개발 전용 로그인 |
| 계정 · 닉네임 설정 | 첫 로그인 닉네임 확인(`/welcome`), `GET/PATCH /me` |
| (8장) 공통 화면 | 데스크톱 사이드바 / 모바일 하단 탭, 라이트·다크·시스템 테마, 로그인 화면, 빈 홈, 설정 화면의 「화면 테마」 섹션 |
| (4·5장) 기반 | pnpm 모노레포, docker compose, **전체** Prisma 스키마 + 마이그레이션 SQL, `games` 시드 |

### 제외

게임 계정 연동(S1), 내전(S2·S3), 랭킹·홈 요약 데이터(S4), 봇 API(S5), 관리자 기능·공지(S6). 사이드바의 ELO·순위 표시, 내전 배지 숫자 등 데이터가 필요한 부분은 S0에서 표시하지 않거나 자리만 둔다. 스키마는 S0에서 전부 만든다.

---

## 2. 모노레포 골격

```
package.json            packageManager pnpm@9.15.0, scripts: build/typecheck/test/db:*/infra:*
pnpm-workspace.yaml     apps/*, packages/*
tsconfig.base.json      strict, noUncheckedIndexedAccess
docker-compose.yml      postgres:16-alpine(gcd/gcd/gcd :5432), redis:7-alpine(:6379, 선택)
.env.example            API·웹 환경 변수 전체
apps/
  api/   name "api"   NestJS 11 + Prisma 6.19   prisma/schema.prisma, prisma/seed.ts, prisma/migrations/20261028000000_s0/
  web/   name "web"   Next.js 15.5 (App Router) + React 19.2 + Tailwind 4.3 + TanStack Query 5
packages/
  shared/ name "@gcd/shared"  zod 3.25만 의존
  core/   name "@gcd/core"    @gcd/shared만 의존 (S0은 빈 진입점)
```

명령은 `corepack pnpm ...`으로 실행한다(전역 pnpm 없음).

| 명령 | 용도 |
| --- | --- |
| `corepack pnpm install` | 의존성 설치 |
| `corepack pnpm -r typecheck` / `test` / `build` | 전체 검사 |
| `corepack pnpm --filter api prisma:validate` / `prisma:generate` | 스키마 검사·클라이언트 생성. **사전 조건**: `apps/api/.env`(또는 환경 변수 `DATABASE_URL`)가 있어야 한다. 없으면 P1012로 실패 — `.env.example`을 복사해서 쓴다(DB가 떠 있을 필요는 없음) |
| `corepack pnpm --filter api prisma:deploy` | 마이그레이션 적용(DB 필요) |
| `corepack pnpm --filter api prisma:seed` | games 시드(DB 필요) |

### 워크스페이스 패키지 해석 규칙

`@gcd/shared`·`@gcd/core`의 `package.json`:

```json
"main": "./dist/index.js",
"types": "./src/index.ts",
"exports": { ".": { "source": "./src/index.ts", "types": "./src/index.ts", "default": "./dist/index.js" } }
```

| 소비자 | 읽는 파일 | 설정 |
| --- | --- | --- |
| tsc 타입 검사(api, web) | `src/index.ts` | api: `types` 필드(node10 해석), web: `customConditions: ["source"]` |
| vitest(api, core) | `src/index.ts` | `resolve.conditions: ['source']` (이미 설정됨) |
| Next.js(web) | `src/index.ts` | `transpilePackages` + webpack `conditionNames`에 `source` 추가(이미 설정됨) |
| prisma seed(tsx) | `src/index.ts` | `tsx --conditions=source` (이미 설정됨) |
| Nest 런타임(`node dist/main.js`) | `dist/index.js` | **먼저 `pnpm -r build`**(위상 순서로 shared → core → api) |

---

## 3. 와이어 형식 (api-contract 2절, 전 슬라이스 공통)

| 항목 | 규칙 | shared 정의 |
| --- | --- | --- |
| 기본 경로 | `/api/v1` | `API_PREFIX`, 경로는 `ApiPath` |
| JSON 필드 | snake_case | 각 스키마 |
| 시각 | ISO 8601 + 오프셋(`Z` 허용) | `IsoDateTime` |
| ID | UUID | `Uuid` |
| 목록 요청 | `cursor`(불투명 문자열, ≤512자), `limit` 1–100 기본 20, 100 초과는 VALIDATION_FAILED(잘라내지 않음) | `PaginationQuery` (목록 Query는 `PaginationQuery.extend({...})`) |
| 목록 응답 | `{ items: [...], next_cursor: string \| null }`, 마지막 페이지면 null | `paginated(item)`, `Paginated<T>` |
| 커서 내용 | 서버만 해석. 권장: base64url(JSON `{정렬키, id}`), 정렬은 항상 `id`를 2차 키로 | (API 내부) |
| 오류 | `{ code, message }` + 상태 코드. `details[{path, message}]`는 VALIDATION_FAILED에서만 | `ErrorBody`, `ErrorCode`, `ERROR_HTTP_STATUS` |
| 오류 메시지 | `message`는 한국어 기본 문구(개발자·대체 표시용). 화면 문구는 웹이 `code`로 분기 | - |
| 204 응답 | 본문 없음 | - |

### 오류 코드 (S0 기준, `packages/shared/src/common/errors.ts`)

| code | HTTP | 발생 |
| --- | --- | --- |
| VALIDATION_FAILED | 400 | zod 검증 실패(body·query·params). details 포함 |
| UNAUTHENTICATED | 401 | Authorization 없음·형식 오류·서명 불일치·사용자 없음 |
| ACCESS_TOKEN_EXPIRED | 401 | JWT `exp` 경과 → 웹은 `/auth/refresh` 후 원 요청 1회 재시도 |
| FORBIDDEN | 403 | 역할 부족, `/auth/refresh`·`/auth/logout`·`/auth/dev-login`의 Origin 불일치 |
| NOT_FOUND | 404 | 리소스·라우트 없음, 닫힌 개발 전용 로그인 |
| RATE_LIMITED | 429 | 일반 횟수 제한(S0에서는 사용처 없음, 예약) |
| INTERNAL_ERROR | 500 | 예상 못한 오류, 응답 스키마 위반(개발 모드) |
| REFRESH_TOKEN_INVALID | 401 | 리프레시 쿠키 없음·모르는 토큰·만료·로그아웃으로 폐기됨 |
| REFRESH_TOKEN_REUSED | 401 | 회전된 토큰 재사용(유예 10초 경과 후) → 계열 전체 폐기 |
| OAUTH_NOT_CONFIGURED | 503 | DISCORD_CLIENT_ID/SECRET/REDIRECT_URI 중 하나라도 비어 있음 |
| OAUTH_STATE_INVALID | 400 | state 쿠키 없음·서명 불일치·만료·쿼리 state 불일치 |
| OAUTH_DENIED | 400 | 디스코드 동의 화면에서 취소(`error=access_denied`) |
| OAUTH_PROVIDER_ERROR | 502 | 디스코드 토큰 교환·사용자 조회·멤버 조회 실패(4xx/5xx/타임아웃, 멤버 조회 404 제외) |
| DISCORD_NOT_GUILD_MEMBER | 403 | DISCORD_GUILD_ID 서버 멤버가 아님(멤버 조회 404) 또는 멤버 `pending=true`(가입 심사 미통과) |
| NICKNAME_TAKEN | 409 | 다른 사용자가 같은 닉네임 사용 중 |

OAuth 두 엔드포인트는 브라우저 이동이라 JSON 오류를 내지 않고 `302 {WEB_ORIGIN}/login?error={OAuthLoginErrorCode}`로 보낸다. `OAuthLoginErrorCode` = OAUTH_NOT_CONFIGURED | OAUTH_STATE_INVALID | OAUTH_DENIED | OAUTH_PROVIDER_ERROR | DISCORD_NOT_GUILD_MEMBER | INTERNAL_ERROR.

---

## 4. 엔드포인트 (S0)

모두 `/api/v1` 접두사. Request/Response 이름은 `packages/shared`의 export 이름이다.

| 메서드 | 경로 | 인증 | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- | --- |
| GET | /auth/discord | 없음 | `StartDiscordAuthQuery` | 302 → 디스코드 authorize, Set-Cookie `gcd_oauth` | 302 /login?error=OAUTH_NOT_CONFIGURED · 쿼리 오류 시 redirect 무시하고 `/` 사용 |
| GET | /auth/discord/callback | `gcd_oauth` 쿠키 | `DiscordCallbackQuery` | 302 → 웹(아래 6절), Set-Cookie `gcd_rt` | 302 /login?error=`OAuthLoginErrorCode` |
| POST | /auth/refresh | `gcd_rt` 쿠키 | 본문 없음 | 200 `RefreshTokenResponse` + Set-Cookie `gcd_rt`(회전) | REFRESH_TOKEN_INVALID, REFRESH_TOKEN_REUSED, FORBIDDEN(Origin) |
| POST | /auth/logout | `gcd_rt` 쿠키(없어도 성공) | 본문 없음 | 204, 쿠키 삭제 | FORBIDDEN(Origin) |
| POST | /auth/dev-login | 없음, 개발 전용 | `DevLoginRequest` | 200 `DevLoginResponse` + Set-Cookie `gcd_rt` | NOT_FOUND(닫힘), VALIDATION_FAILED, FORBIDDEN(Origin) |
| GET | /me | JWT | - | 200 `GetMeResponse` | UNAUTHENTICATED, ACCESS_TOKEN_EXPIRED |
| PATCH | /me | JWT | `UpdateMeRequest` | 200 `UpdateMeResponse` | VALIDATION_FAILED, NICKNAME_TAKEN, UNAUTHENTICATED, ACCESS_TOKEN_EXPIRED |

`Me`(= `GetMeResponse` = `UpdateMeResponse` = 인증 응답의 `user`) 필드:

| 필드 | 타입 | 출처 |
| --- | --- | --- |
| id | uuid | users.id |
| nickname | string | users.nickname |
| role | `member` \| `admin` | users.role |
| email | string \| null | users.email(디스코드 `verified=true`일 때만 저장) |
| discord_id | string \| null | users.discord_id(개발 사용자는 `dev-{username}`) |
| discord_username | string \| null | users.discord_username |
| avatar_url | url \| null | `https://cdn.discordapp.com/avatars/{discord_id}/{discord_avatar}.png?size=128` (해시 없거나 개발 사용자면 null) |
| discord_guild_verified_at | datetime \| null | users.discord_guild_verified_at |
| needs_nickname_confirmation | boolean | `users.nickname_confirmed_at IS NULL` |
| created_at | datetime | users.created_at |

---

## 5. 인증 흐름

### 5-1. 배치: 웹 오리진 프록시

- 브라우저는 **웹 오리진의 `/api/v1/*`만** 호출한다. `apps/web/next.config.ts`의 rewrites가 `API_ORIGIN`(기본 `http://localhost:4000`)으로 넘긴다(이미 설정됨).
- 결과: 쿠키가 1st-party, CORS 불필요. 디스코드 `DISCORD_REDIRECT_URI` = `http://localhost:3000/api/v1/auth/discord/callback`(웹 오리진).
- API가 내는 리다이렉트 `Location`은 항상 `WEB_ORIGIN` 기준 절대 URL.
- 봇(S5)은 API 서버를 직접 호출한다(`X-API-Key`). API의 CORS는 S0에서 열지 않는다.

### 5-2. 토큰

| 항목 | 액세스 토큰 | 리프레시 토큰 |
| --- | --- | --- |
| 형식 | JWT HS256, 키 `JWT_ACCESS_SECRET`, 클레임 `AccessTokenClaims {sub, role, typ:'access', iat, exp}` | 불투명 32바이트 난수 base64url |
| 수명 | `JWT_ACCESS_TTL_SEC`(기본 900초) | `REFRESH_TOKEN_TTL_DAYS`(기본 30일), **로그인 시점부터 절대 만료**(회전해도 연장하지 않음) |
| 전달 | 응답 본문 `access_token` → 웹은 **메모리에만** 보관, 요청 헤더 `Authorization: Bearer {token}` | 쿠키 `gcd_rt`: HttpOnly, SameSite=Lax, Path=/, production에서 Secure, Max-Age=남은 수명 |
| 저장 | 저장 안 함 | `refresh_tokens.token_hash` = SHA-256(hex). 원문 저장 금지 |

- JWT 가드: 헤더 없음·`Bearer ` 아님·서명 불일치·`typ≠access` → UNAUTHENTICATED, `exp` 경과 → ACCESS_TOKEN_EXPIRED, `sub` 사용자가 DB에 없음 → UNAUTHENTICATED.
- 역할(`@Roles('admin')`)은 토큰의 `role` 클레임으로 판단한다(최대 15분 지연 허용). 역할이 바뀌면 다음 갱신 때 반영된다.

### 5-3. 리프레시 회전 (`POST /auth/refresh`)

1. Origin 검사: `Origin` 헤더가 있고 `WEB_ORIGIN`과 다르면 403 FORBIDDEN. (logout, dev-login도 동일)
2. 쿠키 없음 → 401 REFRESH_TOKEN_INVALID.
3. 해시로 조회. 없음 또는 `expires_at ≤ now` → 401 REFRESH_TOKEN_INVALID + 쿠키 삭제.
4. `revoked_at`이 있음:
   - `replaced_by_id`가 있고 `now - revoked_at ≤ 10초`(동시 탭 유예) → **회전 없이** 새 액세스 토큰만 200으로 반환(Set-Cookie 없음; 브라우저에는 이미 새 쿠키가 있다).
   - 그 외 → 같은 `family_id`의 미폐기 토큰 전부 `revoked_at=now` → 401 REFRESH_TOKEN_REUSED + 쿠키 삭제.
   - 로그아웃으로 폐기된 토큰(`replaced_by_id` 없음) → 401 REFRESH_TOKEN_INVALID.
5. 정상: 한 트랜잭션에서 새 토큰 생성(같은 family_id, **같은 expires_at**) → 기존 토큰 `revoked_at=now, replaced_by_id=새 id` → Set-Cookie 새 토큰 → 200 `RefreshTokenResponse`(role은 DB 최신값).
6. 동시성: 기존 토큰 갱신은 `WHERE id=? AND revoked_at IS NULL` 조건부 update로 하고, 영향 행 0이면 4번(유예 판단)으로 처리한다.

### 5-4. 로그아웃 (`POST /auth/logout`)

쿠키의 토큰이 유효하면 그 family 전체 폐기. 쿠키가 없거나 모르는 토큰이어도 204. 항상 `gcd_rt` 삭제(Max-Age=0, 같은 속성). 웹은 메모리의 액세스 토큰을 버리고 `/login`으로 이동.

### 5-5. 디스코드 OAuth

**시작 `GET /auth/discord?redirect=/scrims`**

1. DISCORD_CLIENT_ID/SECRET/REDIRECT_URI 중 하나라도 비면 `302 /login?error=OAUTH_NOT_CONFIGURED`.
2. `redirect`가 `SafeRedirectPath`에 맞지 않으면 버리고 `/`로 간주.
3. `state` = 32바이트 난수 base64url. 서명 쿠키 `gcd_oauth` = JSON `{ state, redirect, iat }`(COOKIE_SECRET 서명, HttpOnly, SameSite=Lax, Path=/api/v1/auth, Max-Age=600).
4. `302 https://discord.com/oauth2/authorize?response_type=code&client_id=…&scope=identify%20email%20guilds.members.read&redirect_uri=…&state=…&prompt=none`

**콜백 `GET /auth/discord/callback?code&state`**

1. `gcd_oauth` 쿠키를 즉시 삭제(성공·실패 무관).
2. `error=access_denied` → OAUTH_DENIED. 그 밖의 `error` → OAUTH_PROVIDER_ERROR.
3. 쿠키 없음·서명 불일치·`iat`로부터 600초 초과·쿼리 `state` 불일치(상수 시간 비교) → OAUTH_STATE_INVALID.
4. 토큰 교환 `POST https://discord.com/api/v10/oauth2/token`(form: grant_type=authorization_code, code, redirect_uri, client_id, client_secret) → 실패 시 OAUTH_PROVIDER_ERROR.
5. `GET https://discord.com/api/v10/users/@me` → `id, username, global_name, avatar, email, verified`.
6. **길드 멤버 검사**(아래 5-6).
7. 사용자 upsert(`discord_id` 기준):
   - 신규: `nickname = 기본 닉네임(5-7)`, `role = ADMIN_DISCORD_IDS에 있으면 admin, 아니면 member`, `nickname_confirmed_at = null`.
   - 기존: `discord_username, discord_global_name, discord_avatar` 갱신, `email`은 `verified=true`면 갱신(아니면 유지), `ADMIN_DISCORD_IDS`에 있으면 admin으로 승격(강등은 하지 않음). **닉네임은 덮어쓰지 않는다.**
   - 공통: `last_login_at = now`, 길드 검사를 했으면 `discord_guild_verified_at = now`.
8. 디스코드 액세스 토큰은 저장하지 않고 버린다.
9. 새 family로 리프레시 토큰 발급 → Set-Cookie `gcd_rt` → `302 {WEB_ORIGIN}{target}`:
   - `needs_nickname_confirmation` → target = `/welcome?redirect={encodeURIComponent(redirect)}`
   - 아니면 target = `redirect`(기본 `/`)
10. 2~8의 실패는 모두 `302 {WEB_ORIGIN}/login?error={code}`(redirect 값이 있으면 `&redirect=`도 붙임). 예상 못한 예외는 INTERNAL_ERROR.

디스코드 API 호출은 `DiscordOAuthClient` 인터페이스(토큰 교환, 사용자 조회, 멤버 조회) 뒤에 둔다. 테스트는 이 인터페이스를 목으로 바꿔 콜백 전체를 검증한다(실제 키 없음).

### 5-6. 디스코드 길드 멤버 검사 규칙

| 조건 | 처리 |
| --- | --- |
| `DISCORD_GUILD_ID` 비어 있음 | 검사 생략, `discord_guild_verified_at` 갱신 안 함 |
| `GET /users/@me/guilds/{DISCORD_GUILD_ID}/member` 200, `pending` 아님 | 통과. 응답의 `nick`을 기본 닉네임 후보 1순위로 사용 |
| 200이지만 `pending=true`(멤버십 심사 미통과) | DISCORD_NOT_GUILD_MEMBER |
| 404(Unknown Guild/Member) | DISCORD_NOT_GUILD_MEMBER — 가입·로그인 모두 거절(기존 사용자도) |
| 401/403/429/5xx/타임아웃(5초) | OAUTH_PROVIDER_ERROR |

- 검사 시점은 **로그인(콜백) 때만**이다. 리프레시는 디스코드를 호출하지 않는다. 리프레시 토큰이 로그인 시점부터 30일 절대 만료라, 서버를 나간 사용자는 최대 30일 안에 다시 로그인해야 하고 그때 걸러진다.
- 개발 전용 로그인은 길드 검사를 하지 않는다.

### 5-7. 기본 닉네임과 첫 로그인 확인

**기본 닉네임(신규 사용자만, 서버 내부 함수 `deriveDefaultNickname`)**

1. 후보 순서: 길드 `nick` → `global_name` → `username`(개발 로그인은 `username`만).
2. 각 후보를 다듬는다: `[0-9A-Za-z가-힣_\s]` 외 문자 제거 → `normalizeNickname`(앞뒤 공백 제거, 연속 공백 1개로) → 앞 12자 → 다시 앞뒤 공백 제거.
3. 2자 이상이 되는 첫 후보를 쓴다. 모두 실패하면 `user{discord_id 끝 4자리}`(개발 사용자는 `user{난수 4자리}`).
4. 다른 사용자가 이미 쓰면 `(앞 10자를 trimEnd) + 2..99`를 차례로 시도, 그래도 겹치면 `(앞 8자를 trimEnd) + 난수 4자리`. 결과는 항상 `Nickname` 스키마를 통과하고 정규화된 값(= `normalizeNickname(결과) === 결과`)이어야 한다.

**닉네임 규칙(shared `Nickname`, 사용자 결정)**: 입력을 `normalizeNickname`으로 정규화(앞뒤 공백 제거, 탭·줄바꿈 포함 연속 공백 → 공백 1개; 거부하지 않음)한 뒤 2–12자, 한글 완성형·영문·숫자·밑줄·공백만 허용. DB에는 정규화한 값만 저장하므로 중복 검사(`nickname` UNIQUE, 대소문자 구분)는 정규화 후 값으로 이뤄진다. PATCH /me 서비스는 반드시 zod 파싱 결과(정규화된 값)를 저장·비교한다.

**확인 흐름(목업 Login 2단계 「처음 오셨네요」)**

1. 콜백이 `/welcome?redirect=…`로 보낸다. 웹은 `POST /auth/refresh`로 토큰과 `user`를 받는다.
2. 화면: 아바타·`discord_username`·「서버 멤버 확인됨」(`discord_guild_verified_at`이 있을 때만) + 닉네임 입력(기본값 = `user.nickname`, 2–12자 안내).
3. 「시작하기」 → `PATCH /me { nickname }`. 서버: `Nickname` 검증 → 다른 사용자와 중복이면 409 NICKNAME_TAKEN → 저장, `nickname_confirmed_at`이 null이면 now. 응답 `needs_nickname_confirmation=false`.
4. 웹은 `redirect`(SafeRedirectPath 검증, 실패 시 `/`)로 이동.
5. 「뒤로」 → `POST /auth/logout` 후 `/login`.
6. `needs_nickname_confirmation=true`인 사용자가 `/welcome` 밖의 화면에 오면 웹이 `/welcome?redirect={현재 경로}`로 보낸다. API는 이 상태로 다른 API를 막지 않는다(S0 범위에선 `/me`뿐).

### 5-8. 개발 전용 로그인 (`POST /auth/dev-login`)

- 열림 조건: `AUTH_DEV_LOGIN === 'true'` **그리고** `NODE_ENV !== 'production'`. 아니면 404 NOT_FOUND(라우트가 없는 것과 같은 응답).
- `DevLoginRequest { username, role? }` → `discord_id = 'dev-' + username`로 upsert. 신규는 닉네임 = 5-7 규칙(후보 `username`), `nickname_confirmed_at = null`. `role`을 주면 신규·기존 모두에 적용.
- 응답·쿠키는 리프레시와 같다(`DevLoginResponse`, 새 family).
- 웹은 `NEXT_PUBLIC_AUTH_DEV_LOGIN=true`일 때만 로그인 화면에 개발 로그인 폼을 보인다(표시만 제어).

### 5-9. 웹 쪽 인증 규칙

- `middleware.ts`: `(main)` 경로와 `/welcome`에서 `gcd_rt` 쿠키가 **없으면** `/login?redirect={경로}`로. 쿠키가 있으면 통과(유효성은 클라이언트 부팅 때 확인). `/login`은 쿠키가 있으면 `/`로 보내지 않는다(만료 쿠키로 갇히는 것을 방지).
- 부팅: `POST /auth/refresh`(single-flight: 동시에 여러 번 불러도 요청 1개) → 성공 시 메모리에 토큰·`user` 저장, 401이면 `/login`.
- API 호출 401 ACCESS_TOKEN_EXPIRED → refresh 1회 → 원 요청 재시도. REFRESH_TOKEN_* → `/login`.
- 액세스 토큰을 localStorage·쿠키에 저장하지 않는다.

---

## 6. 스키마 변경 (전체, `apps/api/prisma/schema.prisma`)

모든 테이블: `id uuid default uuid()`, `created_at timestamptz`. TS camelCase ↔ DB snake_case(`@map`), 테이블 `@@map`. 시각은 전부 `timestamptz(3)`.
마이그레이션 SQL: `apps/api/prisma/migrations/20261028000000_s0/migration.sql`(`prisma migrate diff --from-empty`로 생성, 테이블 21개). **DB 적용은 미실행**(Docker 없음).

### enum (shared `constants/enums.ts`와 값 동일)

`user_role`(member, admin) · `scrim_status`(recruiting, full, playing, finished, cancelled) · `scrim_player_status`(joined, waitlist, cancelled, no_show) · `scrim_team`(blue, orange) · `scrim_result_status`(pending, approved, rejected) · `dispute_status`(open, resolved) · `activity_type`(voice, chat, play)

### 테이블

표기: **굵게** = 문서 5장 외 추가(근거 열 참고).

| 테이블 | 컬럼 | 제약·인덱스 | 근거 |
| --- | --- | --- | --- |
| users | email?, nickname, role, discord_id?, **discord_username?, discord_global_name?, discord_avatar?, discord_guild_verified_at?, nickname_confirmed_at?, last_login_at?, notify_scrim_start, notify_result, notify_waitlist, notify_patch, updated_at** | nickname UNIQUE, discord_id UNIQUE | 5장 + 디스코드 로그인, 목업 Settings 알림 |
| **refresh_tokens** | user_id, token_hash, family_id, expires_at, revoked_at?, replaced_by_id?, user_agent? | token_hash UNIQUE, (user_id), (family_id) | 4장 JWT 리프레시, 회전 |
| games | code, name, has_positions, **has_teams, positions text[], sort_order** | code UNIQUE | 5장 + 7-2(팀 없는 게임), 설계 원칙 3 |
| game_accounts | user_id, game_id, external_id, display_name, verified, last_synced_at?, **verified_at?, verification_challenge?, verification_expires_at?, last_sync_error?, last_sync_error_at?, updated_at** | (game_id, external_id) UNIQUE, (user_id) | 5장 + 9장 소유 확인·실패 사유 |
| **game_account_sync_requests** | user_id, game_account_id | (user_id, created_at) | 9장 수동 새로고침 하루 5회(Redis 없이) |
| rank_snapshots | game_account_id, **queue?**, tier, division?, lp, wins, losses, captured_at | (game_account_id, captured_at desc) | 5장 + 큐 구분 |
| **recent_matches** | game_account_id, external_match_id, played_at, win?, placement?, summary jsonb | (game_account_id, external_match_id) UNIQUE, (game_account_id, played_at desc) | 2장 프로필 「최근 전적」, 9장 6시간 캐시 |
| steam_playtime | game_account_id, app_id, **app_name?**, minutes_total, minutes_recent, synced_at | (game_account_id, app_id) UNIQUE, (app_id, minutes_total desc) | 5장 |
| seasons | name, starts_at, ends_at | (starts_at, ends_at) | 5장 |
| ratings | user_id, game_id, season_id, elo int, wins, losses, **updated_at** | (user_id, game_id, season_id) UNIQUE, **(game_id, season_id, elo desc)** | 5장 |
| rating_history | user_id, scrim_id, elo_before, elo_after, **scrim_result_id, game_id, season_id** | **(scrim_id, user_id) UNIQUE**(이중 반영 방지), (user_id, created_at) | 5장 + 7-1 그래프 |
| **season_standings** | season_id, game_id, user_id, rank, elo, wins, losses | (season_id, game_id, user_id) UNIQUE, (season_id, game_id, rank) | 7-3 시즌 최종 순위 스냅샷 |
| scrims | game_id, host_id, title, scheduled_at, capacity, status, rules?, **updated_at** | (status, scheduled_at), (game_id, status, scheduled_at), (host_id) | 5장 |
| scrim_players | scrim_id, user_id, status, position?, team?, **preferred_positions text[], joined_at, no_show_marked_at?, no_show_marked_by?, updated_at** | (scrim_id, user_id) UNIQUE, **(scrim_id, status)**, (user_id, status, no_show_marked_at) | 5장 + 7-2 희망 포지션, 7-4 30일 집계 |
| scrim_results | scrim_id, winner_team?, submitted_by, approved_by?, approved_at?, **status, placements jsonb?, reject_reason?, rejected_by?, rejected_at?, updated_at** | (scrim_id, status), (status, created_at) | 5장 + slice 결정 |
| **scrim_result_disputes** | scrim_result_id, user_id, reason, status, resolved_by?, resolved_at?, resolution? | (scrim_result_id, status), (status, created_at) | slice 결정 |
| activity_logs | user_id, type, game_id?, started_at, duration_sec, idempotency_key | idempotency_key UNIQUE, **(user_id, started_at)**, (started_at) | 5장, 10장 |
| badges | code, name, condition, **description?** | code UNIQUE | 5장 |
| user_badges | user_id, badge_id, earned_at, **season_id?** | (user_id, badge_id, season_id) UNIQUE, (user_id) | 5장 + 시즌 보상 |
| api_keys | name, key_hash, scopes text[], last_used_at?, **key_prefix, revoked_at?, created_by?** | key_hash UNIQUE. 원문 컬럼 없음 | 5장 |
| **notices** | title, body, author_id, notify_discord, discord_notified_at?, updated_at | (created_at desc) | slice 결정, 목업 Admin |

삭제 정책: 사용자 삭제 시 본인 소유 데이터(토큰, 연동 계정, 참가, 레이팅, 활동, 뱃지)는 Cascade. 다른 사람 기록에 남는 참조(방장, 결과 제출·승인자, 공지 작성자)는 Restrict — 회원 탈퇴 기능이 생기면 그때 익명화 방식으로 정한다.

### games 시드 (`@gcd/shared` `GAME_SEED`, `apps/api/prisma/seed.ts`가 code 기준 upsert)

| code | name | has_positions | has_teams | positions | sort_order |
| --- | --- | --- | --- | --- | --- |
| lol | 리그 오브 레전드 | true | true | top, jungle, mid, bot, support | 1 |
| tft | 전략적 팀 전투 | false | false | (없음) | 2 |
| steam | 스팀 게임 | false | true | (없음) | 3 |

---

## 7. 상태 전이 (`packages/shared/src/constants/transitions.ts`)

S0은 상태 갱신이 없지만 S2·S3 구현자가 그대로 쓰도록 미리 정의했다. 상태 변경은 `canTransition(맵, from, to)` 검사 후에만 한다.

```
scrims:        recruiting → full | cancelled
               full → recruiting | playing | cancelled
               playing → finished
scrim_players: joined → waitlist | cancelled | no_show
               waitlist → joined | cancelled
               cancelled → joined | waitlist     (모집 중 재참가: 같은 행 재사용, joined_at 갱신)
               no_show → joined                  (운영진 정정)
scrim_results: pending → approved | rejected     (재입력은 새 행)
disputes:      open → resolved
```

---

## 8. core 함수

S0에는 없다(`packages/core/src/index.ts` 빈 진입점). `deriveDefaultNickname`은 인증 전용 규칙이라 `apps/api` 안에 둔다(5-7).

---

## 9. 테마 토큰 규칙 (프런트엔드)

기준 파일: `_workspace/00_input/mockup/tokens.css`. 이 파일이 색의 유일한 출처다.

### 9-1. CSS 변수

1. `apps/web/src/styles/tokens.css`로 옮기며 **변수 이름과 값을 그대로** 둔다(`--bg`, `--surface`, `--line-2`, `--accent-ink`, `--cyan-text` …). 이름 바꾸기·접두사 붙이기·새 hex 추가 금지.
2. 선택자만 바꾼다: `.gcd` → `:root, [data-theme="dark"]`, `.gcd[data-theme="light"]` → `[data-theme="light"]`. 속성은 `<html>`에 단다. `color-scheme`도 함께 옮긴다.
3. `body` 배경 규칙 두 줄은 `html, body { background: var(--bg); color: var(--text); }` 하나로 바꾼다.
4. 전환·hover·focus-visible·placeholder·`prefers-reduced-motion` 규칙은 `.gcd` 접두사를 떼고 같은 값으로 옮긴다(`article:hover` lift는 카드 컴포넌트 클래스에만 건다).
5. 목업이 쓰는 반투명 hex(`#3BD6C624` 같은 타일 배경)는 토큰 + 투명도로 바꾼다: Tailwind `bg-cyan/15` 또는 `color-mix(in oklab, var(--cyan) 14%, transparent)`.

### 9-2. Tailwind v4 매핑

`globals.css`의 `@theme inline`에서 **모든 색 토큰을 같은 이름으로** 노출한다:

```css
@theme inline {
  --color-bg: var(--bg);           /* bg-bg */
  --color-nav: var(--nav);
  --color-surface: var(--surface); /* bg-surface */
  --color-surface-2: var(--surface-2);
  --color-line: var(--line);       /* border-line */
  --color-text: var(--text);       /* text-text */
  --color-text-2: var(--text-2);
  --color-muted: var(--muted);     /* text-muted (글자색이다) */
  --color-faint: var(--faint);
  --color-accent: var(--accent);   /* bg-accent (형광 라임) */
  --color-accent-ink: var(--accent-ink);
  --color-on-accent: var(--on-accent);
  /* … tokens.css의 나머지 색 토큰 전부, 이름 = 변수명 */
  --shadow-lift: var(--lift);
  --shadow-seg: var(--seg-shadow);
}
```

규칙: 유틸리티 이름 = `{속성}-{토큰명}`. 컴포넌트에 hex·rgb 직접 쓰기 금지, 색은 토큰 유틸리티나 `var(--토큰)`만.

### 9-3. shadcn/ui와 이름 충돌

목업의 `--accent`(브랜드 라임)·`--muted`(보조 글자색)는 shadcn의 같은 이름(hover 배경·흐린 배경)과 **뜻이 다르다**. shadcn 변수(`--background`, `--primary` 등)는 정의하지 않고, 컴포넌트를 추가할 때 클래스를 아래처럼 바꾼다.

| shadcn 기본 | 이 프로젝트 |
| --- | --- |
| `bg-background` / `text-foreground` | `bg-bg` / `text-text` |
| `bg-card`, `bg-popover` | `bg-surface` |
| `bg-primary` / `text-primary-foreground` | `bg-accent` / `text-on-accent` |
| `bg-secondary`, `bg-muted` | `bg-surface-2` |
| `text-muted-foreground` | `text-muted` |
| `bg-accent`(hover) / `text-accent-foreground` | `bg-hover` / `text-text` |
| `border-border`, `border-input` | `border-line` (강조 `border-line-2`) |
| `ring-ring` | `ring-accent-ink` |
| `bg-destructive` | `bg-orange` + `text-on-accent` (목업은 경고·반려를 orange 계열로 표시) |

### 9-4. 테마 모드

| 항목 | 규칙(목업 `themeVals()`와 동일) |
| --- | --- |
| 저장 | `localStorage['gcd-theme']` = `light` \| `dark` \| `system`. 서버 저장 안 함 |
| 기본값 | 저장값 없으면 `dark` |
| 해석 | `system` → `matchMedia('(prefers-color-scheme: dark)')`로 dark/light |
| 적용 | `<html data-theme="{dark|light}">`. 깜빡임 방지를 위해 `<head>`의 인라인 스크립트가 첫 페인트 전에 적용, `<html suppressHydrationWarning>` |
| 동기화 | `storage` 이벤트(다른 탭), `matchMedia` change(system일 때) 구독 |
| 사이드바 토글 | 라이트·다크 2버튼 세그먼트(`aria-pressed`). 누르면 명시값 저장 |
| 모바일 헤더 토글 | 아이콘 버튼 1개, 현재 해석값의 반대로 저장. 레이블 「라이트 모드로 전환」/「다크 모드로 전환」 |
| 설정 「화면 테마」 | 라이트(밝은 배경 · 낮 시간용) / 다크(기본값 · 눈부심이 적어요) / 시스템 설정(기기 설정을 따라 자동 전환) 3개 라디오 카드 |

### 9-5. 레이아웃·라우트 (S0)

| 경로 | 화면 | S0 내용 |
| --- | --- | --- |
| `/login` | 목업 Login 1단계 | 「Discord로 로그인」 → `location.href = /api/v1/auth/discord?redirect=…`, `?error=` 코드별 문구, 받는 정보 목록, 개발 로그인 폼(플래그) |
| `/welcome` | 목업 Login 2단계 | 5-7 확인 흐름 |
| `/` | 홈 | (main) 레이아웃 + 빈 상태 |
| `/settings` | 설정 | 「화면 테마」 섹션만 |
| `/scrims`, `/rankings`, `/members/[id]` | 자리 | 사이드바·탭 링크 대상. 「준비 중」 빈 상태 |

- 데스크톱(`md` 이상): 좌측 사이드바(로고 「롤생네컷 GAME CLUB」, MENU: 홈·내전·랭킹·내 프로필·설정, 테마 토글, 하단 사용자 카드(아바타·닉네임, 클릭 시 로그아웃 메뉴)). 관리자 메뉴(STAFF)는 `role=admin`일 때만, 대상은 S6까지 자리.
- 모바일(`md` 미만): 상단 헤더(로고 + 테마 토글) + 하단 탭 5개 **홈·내전·랭킹·프로필·설정**(목업 MobileHome).
- 「내 프로필」 링크는 `/members/{me.id}`. 링크는 `lib/routes.ts` 함수로만 만든다.

---

## 10. 환경 변수 (`.env.example`)

| 변수 | 사용처 | 기본/예 | 비고 |
| --- | --- | --- | --- |
| NODE_ENV | api, web | development | production이면 dev-login 강제 비활성, 쿠키 Secure |
| NEXT_PUBLIC_API_MOCK | web | false | true면 `apps/web/src/lib/api/mock/backend.ts` 사용(빌드 시점 고정, D29) |
| NEXT_PUBLIC_API_MOCK_ACCESS_TTL_SEC | web | 900 | 목 모드 액세스 토큰 수명(D29) |
| API_PORT | api | 4000 | |
| WEB_ORIGIN | api | http://localhost:3000 | 리다이렉트 기준, Origin 검사 |
| DATABASE_URL | api | postgresql://gcd:gcd@localhost:5432/gcd?schema=public | 테스트는 `?schema=test` |
| REDIS_URL | api | redis://localhost:6379 | S0 미사용, 없어도 기동 |
| JWT_ACCESS_SECRET | api | (필수) | 32바이트 이상 |
| JWT_ACCESS_TTL_SEC | api | 900 | |
| REFRESH_TOKEN_TTL_DAYS | api | 30 | 로그인 시점부터 절대 만료 |
| COOKIE_SECRET | api | (필수) | `gcd_oauth` 서명 |
| DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET | api | (키 필요) | 비면 OAUTH_NOT_CONFIGURED |
| DISCORD_REDIRECT_URI | api | http://localhost:3000/api/v1/auth/discord/callback | 디스코드 앱에 등록 |
| DISCORD_GUILD_ID | api | (빈 값 = 검사 안 함) | |
| ADMIN_DISCORD_IDS | api | (쉼표 구분) | 로그인 시 admin 승격만 |
| AUTH_DEV_LOGIN | api | false | |
| RIOT_API_KEY / STEAM_API_KEY | api | | S1 |
| API_ORIGIN | web(서버) | http://localhost:4000 | rewrites 대상 |
| NEXT_PUBLIC_AUTH_DEV_LOGIN | web | false | 개발 로그인 폼 표시 |

API는 기동 시 zod로 환경 변수를 검증하고, 필수값(JWT_ACCESS_SECRET, COOKIE_SECRET, DATABASE_URL)이 없으면 시작하지 않는다. 디스코드 값은 선택(없으면 OAuth만 막힘).

---

## 11. 담당 배정

S0 실행 구현자: **backend**, **frontend** (+ qa). logic·integration은 S0에 할 일이 없다(core 함수 없음, 디스코드 OAuth 클라이언트는 인증 모듈 일부로 backend가 맡는다).

### backend (backend-dev) — `apps/api/src/**`

1. 부트스트랩: `main.ts`(전역 접두사 `API_PREFIX`, `cookie-parser(COOKIE_SECRET)`, 포트), `app.module.ts`, `config/env.ts`(zod 환경 변수 검증, 10절).
2. `common/`: `AppError(code, status?)`(기본 상태 = `ERROR_HTTP_STATUS`), `filters/error.filter.ts`(모든 예외 → `ErrorBody`, Nest 내장 예외·404 라우트 포함), `pipes/zod.pipe.ts`(VALIDATION_FAILED + details), `serialize.ts`(camel→snake + Response 스키마 parse, 개발 모드 위반 시 500), `guards/jwt.guard.ts`, `guards/roles.guard.ts` + `@Roles`, `@CurrentUser`, Origin 검사 가드.
3. `prisma/` 모듈(PrismaService).
4. `modules/auth`: 4절 5개 엔드포인트, 5-2~5-8 전부. `DiscordOAuthClient` 인터페이스 + fetch 구현(타임아웃 5초) + 테스트용 목. `deriveDefaultNickname` + 단위 테스트.
5. `modules/users`: `GET/PATCH /me`, `Me` 직렬화(avatar_url 조립 포함).
6. 테스트(vitest):
   - DB 없이 실행 가능: `deriveDefaultNickname`, SafeRedirect 처리, OAuth state 서명·검증, 디스코드 목 기반 콜백 분기(성공·취소·state 불일치·길드 404·pending·provider 5xx), 오류 필터 형식, dev-login 닫힘(production / 플래그 false → 404).
   - DB 필요(미실행 표시 허용): 리프레시 회전·유예 10초·재사용 감지 family 폐기, 동시 refresh `Promise.all`, PATCH /me NICKNAME_TAKEN, 시드 적용.
7. 보고서: `_workspace/02_backend-dev_auth.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 스타일: `src/styles/tokens.css`(9-1), `globals.css`(Tailwind v4 `@theme inline` 9-2), shadcn 도입 시 9-3 치환표 적용.
2. 테마: `ThemeProvider` + `<head>` 인라인 스크립트(9-4), 사이드바 세그먼트 토글, 모바일 헤더 토글, 설정 「화면 테마」 섹션.
3. 레이아웃: `(main)/layout.tsx`(사이드바 / 하단 탭 5개, 9-5), 자리 페이지(`/scrims`, `/rankings`, `/members/[id]`), 빈 홈.
4. 인증: `lib/api/client.ts`(`credentials: 'include'`, `Authorization` 헤더, `ErrorBody` 파싱, ACCESS_TOKEN_EXPIRED 재시도), 메모리 토큰 저장 + single-flight refresh, `middleware.ts`(5-9), 훅 `useMe`/`useUpdateMe`/`useRefreshToken`/`useLogout`/`useDevLogin`(이름은 shared 스키마와 맞춤).
5. 화면: `/login`(목업 Login 1단계, `LoginPageQuery`로 쿼리 파싱, 오류 코드 문구), `/welcome`(5-7), 개발 로그인 폼(`NEXT_PUBLIC_AUTH_DEV_LOGIN`).
6. `lib/routes.ts`, `lib/errors.ts`(S0 오류 코드 전부 문구 매핑).
7. 검증: `corepack pnpm --filter web typecheck && corepack pnpm --filter web build`, 가능하면 데스크톱·모바일 폭 × 라이트·다크 렌더 확인. API 없이 확인할 때는 목 응답 사용.
8. 보고서: `_workspace/02_frontend-dev_shell.md`.

### qa (qa-verifier)

- 교차 대조: 4절 엔드포인트 7개 ↔ 컨트롤러 ↔ 웹 훅, 오류 코드 표 ↔ `ErrorCode` ↔ `lib/errors.ts`, 스키마 enum ↔ shared enum, 문서 5장 인덱스 3개 존재, `api_keys` 원문 컬럼 없음, `activity_logs.idempotency_key` UNIQUE.
- 보안 경계: 오픈 리다이렉트(`//evil.com`), Origin 불일치, production에서 dev-login 404, 리프레시 원문 미저장, 쿠키 속성.

---

## 12. 결정 사항 (문서에 없어 새로 정한 것)

| # | 결정 | 이유 |
| --- | --- | --- |
| D1 | 웹이 `/api/v1/*`를 API로 프록시(Next rewrites), OAuth 리다이렉트 URI도 웹 오리진 | 리프레시 쿠키를 1st-party·SameSite=Lax로 둘 수 있고 CORS가 필요 없다 |
| D2 | 액세스 토큰은 본문+메모리, 리프레시는 HttpOnly 쿠키 `gcd_rt`(Path=/) | XSS로 리프레시 탈취 방지. Path=/는 웹 middleware가 로그인 여부를 판단하기 위해 |
| D3 | 리프레시 30일 **절대 만료**(회전해도 연장 없음), 재사용 감지 시 family 폐기, 동시 탭 유예 10초 | 길드 탈퇴자를 30일 안에 재검사(디스코드 재로그인)로 거르기 위함. 유예는 여러 탭 동시 갱신 오탐 방지 |
| D4 | 길드 멤버 검사는 로그인 때만, `pending=true`는 비멤버 취급 | 리프레시마다 디스코드를 부르지 않기 위함(디스코드 토큰을 저장하지 않음) |
| D5 | 첫 운영진은 `ADMIN_DISCORD_IDS` 환경 변수로 로그인 시 승격(강등 없음) | 관리자 화면(S6) 전에 admin을 만들 방법이 필요 |
| D6 | 닉네임: 정규화(앞뒤 공백 제거, 연속 공백 → 1개) 후 2–12자, 한글 완성형·영문·숫자·밑줄·**공백**, 전역 유일(정규화 값 기준, 대소문자 구분) | 목업 「2–12자」. 공백 허용은 사용자 결정(2026-10-28). 연속 공백은 거부 대신 정규화 — 디스코드 서버 닉네임을 기본값으로 가져올 때 실패를 줄이기 위함. 랭킹·내전 목록에서 사람을 구분해야 해서 중복 금지 |
| D7 | 이메일은 디스코드 `verified=true`일 때만 저장 | 미인증 이메일로 알림을 보내지 않기 위함 |
| D8 | `games`에 `has_teams`, `positions[]`, `sort_order` 추가. steam은 has_teams=true(포지션 없음 2팀) | 7-2 「롤체처럼 팀이 없는 게임」 분기를 코드 하드코딩 없이 하기 위함(설계 원칙 3) |
| D9 | `GameCode`는 zod enum(lol, tft, steam). 새 게임 = 시드 1행 + enum 1개 | api-contract 스킬 3절. 화면 분기는 속성으로 |
| D10 | 팀 값은 `blue`/`orange` | 목업 「블루팀/오렌지팀」 |
| D11 | ELO는 정수 저장(계산 후 반올림) | 문서 예시가 정수, 화면 표시와 일치 |
| D12 | `rating_history (scrim_id, user_id)` UNIQUE | 레이팅 이중 반영을 DB에서도 막는다(스킬 3절 「되돌리기 어려운 오염」) |
| D13 | 롤체 결과는 `scrim_results.placements` JSON, 팀 게임은 `winner_team` | 반려 후 재입력이 새 행이라 순위를 결과 행에 묶어야 이력이 남는다 |
| D14 | 반려 후 재입력은 새 `scrim_results` 행. pending·approved는 내전당 1개(서비스 보장) | 반려 이력 보존 |
| D15 | 재참가는 같은 `scrim_players` 행 재사용(cancelled → joined/waitlist), 대기 순서는 `joined_at` | (scrim_id, user_id) 유일 유지 |
| D16 | 명세 공백 테이블 추가: `refresh_tokens`, `game_account_sync_requests`, `recent_matches`, `season_standings` | 각각 4장 리프레시, 9장 하루 5회 제한(Redis 없이), 2장 최근 전적, 7-3 시즌 스냅샷 |
| D17 | 알림 설정 4개를 `users` 불리언 컬럼으로 | 목업 Settings 알림 항목 4개. API 노출은 S1 |
| D18 | 패치노트·이벤트 테이블은 만들지 않음 | P1(S6), 데이터 출처 미정(문서 9장) |
| D19 | 모바일 하단 탭 5번째 = 「설정」 | 목업 MobileHome. 스킬 문서의 「더보기」보다 목업 우선 |
| D20 | 버전 고정: Next 15.5, Nest 11, Prisma 6.19, TypeScript 5.9, zod 3.25, vitest 3.2, Tailwind 4.3, React 19.2 | 레지스트리 최신(Next 16, Nest 12, Prisma 7/8, TS 7, zod 4, vitest 5)은 설정 방식이 크게 바뀐 메이저라 구현자 간 혼선 위험. 필요하면 별도 슬라이스로 올린다 |
| D21 | Prisma seed 설정은 `package.json#prisma`에 둠(6.19에서 deprecated 경고) | `prisma.config.ts`를 쓰면 Prisma 6에서 `.env` 자동 로드가 꺼진다. Prisma 7 이전 시 함께 옮긴다 |
| D22 | 문서 6장 `/auth/signup`, `/auth/login`은 만들지 않고 디스코드 OAuth 엔드포인트로 대체 | 사용자 결정 1. 첫 로그인 = 가입 |
| D23 | 봇 `/bot/link` 연동 코드 테이블은 만들지 않음 | 디스코드 로그인으로 `discord_id`가 이미 채워짐. S5에서 재검토(slice.md) |
| D24 | 서버를 나간 멤버: S0은 현재 방식 유지(로그인 때만 길드 검사, 리프레시 로그인 시점부터 30일 절대 만료 → 최대 30일 접속 유지). **S5에서** 봇이 길드 탈퇴 이벤트를 API로 보내면 해당 사용자의 미폐기 `refresh_tokens`를 즉시 전부 폐기한다(액세스 토큰은 최대 15분 뒤 만료) | 사용자 결정(2026-10-28). S0 스키마 변경 없음 — `refresh_tokens.revoked_at`으로 충분 |
| D25 | **(S1)** 라이엇 ID 하나를 연동하면 `game_accounts`에 lol·tft 두 행(같은 `external_id`=PUUID, 같은 `display_name`)으로 저장한다. 소유 확인은 1회만 받고 성공 시 두 행 모두 `verified=true`, `verified_at` 동일 값. 연동 해제도 두 행을 함께 처리 | 사용자 결정(2026-10-28). 문서 5장 게임별 행 구조를 유지하면서 목업 「롤, 롤체 공통」 흐름을 만족. 현재 스키마(`(game_id, external_id)` UNIQUE)로 가능, 변경 없음 |
| D26 | 리프레시 유예(10초)는 같은 계열에 아직 폐기되지 않은 토큰이 있을 때만 적용한다. 계열이 모두 폐기됐으면(로그아웃·재사용 감지 후) 유예 중이라도 `REFRESH_TOKEN_INVALID` | backend 구현 중 발견(B1). 5-3 문구대로면 회전 → 로그아웃 → 10초 안에 이전 쿠키로 refresh가 성공해 로그아웃이 무력화된다. 리더 승인(2026-10-28) |
| D27 | vitest의 `source` 조건은 `ssr.resolve.conditions`·`externalConditions`에도 지정한다(api·core 적용) | Vite 7은 최상위 `resolve.conditions`를 node(ssr) 실행에 적용하지 않아 오래된 `dist`를 읽는다. backend 발견, 리더 반영 |
| D28 | 디스코드 로그인 버튼 색(#5865F2 / #FFFFFF)은 테마 토큰이 아닌 브랜드 고정색으로 `apps/web/src/app/globals.css`의 `--brand-discord`, `--brand-on-discord`에 둔다. 컴포넌트 hex 금지 규칙의 유일한 예외 | 라이트·다크와 무관하게 같아야 하는 외부 브랜드 색. frontend 요청, 리더 승인(2026-10-28) |
| D29 | 웹 전용 환경 변수 `NEXT_PUBLIC_API_MOCK`(기본 false), `NEXT_PUBLIC_API_MOCK_ACCESS_TTL_SEC`(기본 900) | 백엔드 없이 화면 개발·시연. 10절과 `.env.example`에 반영 |
| D30 | 웹 내부 오류 코드 `NETWORK_ERROR`, `INVALID_RESPONSE`는 `apps/web/src/lib/errors.ts`의 `ClientErrorCode`로만 두고 shared `ErrorCode`에는 넣지 않는다 | 서버가 보내지 않는 클라이언트 측 실패. QA 대조 시 웹 전용으로 취급 |
| D31 | 로그인 후 이동 경로가 `/login`·`/welcome`(하위 경로·쿼리 포함)이면 `/`로 바꾼다. 웹 `safeRedirect`와 API OAuth 시작·콜백 모두 같은 규칙 | 인증 화면으로 되돌아가는 루프 방지. 단, 첫 로그인의 `/welcome?redirect=…` 이동 자체는 콜백 규칙(5-7)대로 유지 |

---

## 13. 확인 필요

현재 남은 항목 없음. 2026-10-28 질문 3건은 사용자 답변으로 해결됐다.

| # | 질문 | 해결 |
| --- | --- | --- |
| 1 | 서버를 나간 멤버의 접속 유지 기간 | 현재 방식(30일) 유지, S5 봇 탈퇴 이벤트로 즉시 폐기 → D24 |
| 2 | 닉네임 규칙(공백·중복) | 공백 허용, 연속 공백은 1개로 정규화, 중복 금지 유지(정규화 값 기준) → D6, 5-7 |
| 3 | (S1) 라이엇 계정의 게임 구분 | 라이엇 ID 1개 → lol·tft 2행, 소유 확인 1회로 둘 다 verified → D25 |
