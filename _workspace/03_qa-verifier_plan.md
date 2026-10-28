# QA 계획: S0 골격

작성: qa-verifier, 2026-10-28
기준: `_workspace/01_architect_contract.md`(이하 "계약"), `packages/shared/src/**`(코드 우선), `_workspace/00_input/slice.md`, `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서"), 목업 `_workspace/00_input/mockup/`
규칙: `.claude/skills/qa-boundary-check/SKILL.md`. QA는 코드를 고치지 않는다. 근거는 직접 실행한 출력과 파일:줄만.

## 사용 가능한 도구 (실제 확인)

Read, Grep, Glob, Bash(Git Bash), Write. `corepack pnpm` 사용, `node_modules` 설치됨. Docker·PostgreSQL 없음 → DB 의존 항목은 「미실행」. 디스코드 앱 키 없음 → 실제 OAuth 왕복은 「키 필요」.

## 예상 검증 대상(리더가 보낼 이름)

| target | 구현자 보고서 | 범위 |
| --- | --- | --- |
| `auth` (또는 `api`) | `_workspace/02_backend-dev_auth.md` | `apps/api/**`, prisma |
| `shell` (또는 `web`) | `_workspace/02_frontend-dev_shell.md` | `apps/web/**` |
| `s0` | 둘 다 | 교차 대조 + 슬라이스 전체 |

판정: blocker 또는 major 1개 이상 → `fail`. 환경 때문에 검사 불가 → `blocked`.

---

## A. 기계 검사 (모든 대상에서 먼저 실행, 출력 그대로 기록)

| # | 명령 | 통과 조건 |
| --- | --- | --- |
| A1 | `corepack pnpm install --frozen-lockfile` | 오류 없음(lockfile 불일치 없음) |
| A2 | `corepack pnpm -r typecheck` | 4개 패키지 0 오류 |
| A3 | `corepack pnpm -r test` | 실패 0. DB 테스트는 skip 표시가 명확할 것(조용히 pass 처리 금지) |
| A4 | `corepack pnpm -r build` | shared → core → api → web 순서 성공 |
| A5 | `corepack pnpm --filter api prisma:validate` | valid |
| A6 | `corepack pnpm --filter api prisma:generate` | 성공 |
| A7 | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …` | **미실행**(shadow DB 필요). 대신 A8 |
| A8 | `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` 출력과 `migrations/20261028000000_s0/migration.sql` 비교 | 차이 없음(스키마 수정 후 마이그레이션 미갱신 탐지) |
| A9 | DB 필요 테스트(리프레시 회전, 동시 refresh, NICKNAME_TAKEN, 시드) | **미실행** — 테스트 코드 존재·내용만 정적 확인 |
| A10 | `grep -rn "RGAPI-\|client_secret=\|DISCORD_CLIENT_SECRET=[^\s]" --exclude-dir=node_modules .` | 실제 비밀값 없음 |

---

## B. 백엔드 (`auth` 대상)

### B1. 부트스트랩·공통 (계약 11절 backend 1–3)
- [ ] `main.ts`: `setGlobalPrefix(API_PREFIX)` — 상수 import(문자열 하드코딩 아님), `cookie-parser(COOKIE_SECRET)`, `API_PORT`.
- [ ] `config/env.ts`: zod 검증. 필수 3개(JWT_ACCESS_SECRET, COOKIE_SECRET, DATABASE_URL) 없으면 기동 실패. 디스코드 값·REDIS_URL 없어도 기동. `.env.example` 변수 목록과 env 스키마 키 1:1 대조.
- [ ] 오류 필터: 모든 예외 → `ErrorBody`(`code`가 shared `ErrorCode`, `details`는 VALIDATION_FAILED에서만). Nest 내장 `NotFoundException`(없는 라우트) → `{code:'NOT_FOUND'}` 404. 알 수 없는 예외 → INTERNAL_ERROR 500, 스택 미노출.
- [ ] 상태 코드 = `ERROR_HTTP_STATUS[code]`(필터가 임의 상태를 쓰지 않는지).
- [ ] zod 파이프: 실패 시 400 VALIDATION_FAILED + `details[{path,message}]`, path는 snake_case 그대로.
- [ ] `serialize(Schema, data)`: camel→snake 변환 후 parse. **grep**: 컨트롤러의 `return` 중 `serialize(`를 거치지 않는 것(204 제외) 전부 목록화.
- [ ] Date → ISO 문자열 변환이 `IsoDateTime`(오프셋 필수) 통과하는지(`toISOString()`은 `Z` → 통과).

### B2. 엔드포인트 대조 (계약 4절)

| 메서드 | 경로(`ApiPath`) | 확인 |
| --- | --- | --- |
| GET | /auth/discord | 302, `gcd_oauth` 쿠키(서명, HttpOnly, Lax, **Path=/api/v1/auth**, Max-Age=600), authorize URL의 scope=`identify email guilds.members.read`, redirect_uri, state, `prompt=none`. 설정 누락 → 302 `/login?error=OAUTH_NOT_CONFIGURED`. 잘못된 redirect → `/`로 대체(400 아님) |
| GET | /auth/discord/callback | 아래 B3 분기 전부 |
| POST | /auth/refresh | 200 `RefreshTokenResponse`, Set-Cookie 회전 |
| POST | /auth/logout | 204 본문 없음, 쿠키 없어도 204, `gcd_rt` Max-Age=0 같은 속성 |
| POST | /auth/dev-login | 닫힘 → 404 NOT_FOUND(없는 라우트와 동일 본문) |
| GET | /me | JWT 필수 |
| PATCH | /me | `UpdateMeRequest`(.strict → 모르는 필드 400) |

- [ ] 컨트롤러 경로가 `ApiPath.*` 상수를 쓰는지(하드코딩이면 minor).
- [ ] 계약 외 추가 엔드포인트가 없는지(있으면 보고).

### B3. OAuth 콜백 분기 (5-5, 5-6) — 목 `DiscordOAuthClient` 테스트로 확인
- [ ] 쿠키 `gcd_oauth` 성공·실패 모두 삭제.
- [ ] `error=access_denied` → OAUTH_DENIED / 기타 error → OAUTH_PROVIDER_ERROR.
- [ ] 쿠키 없음·서명 불일치·600초 초과·state 불일치 → OAUTH_STATE_INVALID. state 비교가 상수 시간(`timingSafeEqual`, 길이 다를 때 예외 안 남).
- [ ] 토큰 교환·사용자 조회 실패 → OAUTH_PROVIDER_ERROR. 타임아웃 5초(`AbortSignal.timeout` 등) 존재.
- [ ] 길드: GUILD_ID 비면 검사 생략 + `discord_guild_verified_at` 미갱신 / 200 non-pending 통과(+nick 후보) / `pending=true` → DISCORD_NOT_GUILD_MEMBER / 404 → DISCORD_NOT_GUILD_MEMBER(기존 사용자도) / 401·403·429·5xx·타임아웃 → OAUTH_PROVIDER_ERROR.
- [ ] upsert: 신규 nickname=기본 닉네임, role(ADMIN_DISCORD_IDS), `nickname_confirmed_at=null`. 기존: 닉네임 **덮어쓰지 않음**, email은 `verified=true`일 때만, admin 승격만(강등 없음). `last_login_at` 갱신.
- [ ] 디스코드 액세스 토큰을 저장하지 않음(스키마·코드 grep).
- [ ] 성공 리다이렉트: `{WEB_ORIGIN}/welcome?redirect={encodeURIComponent(redirect)}`(확인 필요 시) 또는 `{WEB_ORIGIN}{redirect}`. 실패: `{WEB_ORIGIN}/login?error={code}[&redirect=]`, code ∈ `OAuthLoginErrorCode`.
- [ ] 예상 못한 예외 → `error=INTERNAL_ERROR`(JSON 500이 아니라 302).

### B4. 토큰·리프레시 (5-2 ~ 5-4)
- [ ] JWT HS256, 클레임 = `AccessTokenClaims`(`typ:'access'`), TTL = `JWT_ACCESS_TTL_SEC`, 응답 `expires_in`과 일치.
- [ ] 가드: 헤더 없음/`Bearer ` 아님/서명 불일치/`typ≠access` → UNAUTHENTICATED, exp 경과 → ACCESS_TOKEN_EXPIRED(구분되는지가 웹 재시도의 전제 — **major**), 사용자 없음 → UNAUTHENTICATED.
- [ ] 리프레시 원문 32바이트 base64url, DB엔 SHA-256 hex만(`token_hash`). 원문을 DB·로그에 쓰는 곳 grep.
- [ ] 회전: 같은 family_id, **같은 expires_at**(연장 없음), 조건부 update `WHERE id AND revoked_at IS NULL` + 영향 0행 → 유예 판단. 한 트랜잭션.
- [ ] 유예 10초: `replaced_by_id` 있고 ≤10초 → 회전 없이 200, Set-Cookie 없음. 초과 → family 전체 폐기 + REFRESH_TOKEN_REUSED + 쿠키 삭제. 로그아웃 폐기(replaced_by 없음) → REFRESH_TOKEN_INVALID.
- [ ] 만료·모르는 토큰 → REFRESH_TOKEN_INVALID + 쿠키 삭제.
- [ ] 응답 `user.role`은 DB 최신값.
- [ ] 쿠키 `gcd_rt`: HttpOnly, SameSite=Lax, Path=/, production Secure, Max-Age=남은 수명(30일 고정값 아님).
- [ ] Origin 가드: refresh·logout·dev-login에 적용, `Origin` 있고 ≠ WEB_ORIGIN → 403 FORBIDDEN, Origin 없으면 통과. `/me`엔 불필요.

### B5. dev-login (5-8)
- [ ] 열림 = `AUTH_DEV_LOGIN==='true' && NODE_ENV!=='production'`. 테스트: production+true → 404, development+false → 404.
- [ ] `discord_id='dev-'+username`, 길드 검사 없음, role 지정 시 신규·기존 모두 적용, 새 family.

### B6. /me (4절 Me, 5-7)
- [ ] `Me` 10개 필드 전부·이름 정확(snake_case). `avatar_url` = `https://cdn.discordapp.com/avatars/{discord_id}/{hash}.png?size=128`, 해시 없거나 `dev-` 사용자면 null.
- [ ] `needs_nickname_confirmation = nickname_confirmed_at IS NULL`.
- [ ] PATCH: zod 파싱 결과(정규화 값)로 저장·중복 비교(원본 body 사용 시 **major**). 중복 → 409 NICKNAME_TAKEN(자기 자신 현재 닉네임 재전송은 409 아님). P2002 경합도 NICKNAME_TAKEN으로 변환. `nickname_confirmed_at` null일 때만 now.
- [ ] `deriveDefaultNickname` 단위 테스트: 후보 순서(nick→global_name→username), 허용 외 문자 제거, 12자 자르기 후 trim, 2자 미만 건너뜀, 폴백 `user{끝4자리}`, 충돌 시 `앞10자 trimEnd + 2..99` → `앞8자 + 난수4`, 결과가 `Nickname` 통과 + `normalizeNickname(x)===x`. 경계 사례 직접 확인: `"ab cdefghij k"`(자른 뒤 끝 공백), 이모지만 있는 이름, 한글 자모(ㄱ) 포함.

### B7. 스키마·마이그레이션·시드 (계약 6절, 문서 5장·10장)
- [ ] 모델 21개 = 계약 6절 표 21개, 이름·`@@map` snake_case 일치.
- [ ] 문서 5장 필수: `users.discord_id`(UNIQUE, nullable), `activity_logs.idempotency_key` **UNIQUE**, `api_keys.key_hash` UNIQUE + 원문 컬럼 없음.
- [ ] 문서 5장 인덱스 3개: `ratings(game_id, season_id, elo desc)`, `activity_logs(user_id, started_at)`, `scrim_players(scrim_id, status)` — migration.sql에서 확인.
- [ ] `rating_history (scrim_id, user_id)` UNIQUE(D12, 이중 반영 방지 — 없으면 blocker 성격이나 S0에선 major로 기록).
- [ ] Prisma enum 7종 값 = shared enum 값(순서 무관, 집합 동일). DB enum 이름 `user_role` 등.
- [ ] 계약 표의 각 컬럼 존재(특히 `refresh_tokens` 7컬럼, `scrim_results.status/reject_*`, `scrim_result_disputes`, `notices`, users 알림 4개).
- [ ] 시각 컬럼 `@db.Timestamptz(3)`, id `@db.Uuid @default(uuid())`, 모든 테이블 `created_at`.
- [ ] 삭제 정책: 본인 소유 Cascade, host/submitted_by/approved_by/notices.author Restrict.
- [ ] `seed.ts`가 `GAME_SEED`를 import(값 복제 금지), code 기준 upsert. 실행은 **미실행**.
- [ ] `docker-compose.yml` postgres:16-alpine gcd/gcd/gcd:5432, redis:7-alpine.

### B8. 범위 밖 금지
- [ ] `/auth/signup`, `/auth/login` 없음(D22). S1+ 엔드포인트 미구현이 정상.
- [ ] CORS 미개방(5-1).

---

## C. 프런트엔드 (`shell` 대상)

### C1. API 클라이언트·훅
- [ ] 모든 호출이 `API_PREFIX + ApiPath.*`(웹 오리진 상대 경로, `localhost:4000` 직접 호출 없음). `credentials:'include'`.
- [ ] 응답을 shared 스키마로 `.parse`(`as Me`/제네릭 단언만 있는 곳 grep). 오류는 `ErrorBody.safeParse`.
- [ ] 401 ACCESS_TOKEN_EXPIRED → refresh 1회 → 원 요청 재시도(무한 루프 없음). REFRESH_TOKEN_* → `/login`.
- [ ] refresh single-flight(동시 호출 시 요청 1개 — 공유 Promise 확인).
- [ ] 액세스 토큰 localStorage·sessionStorage·document.cookie 저장 없음(grep).
- [ ] 훅 `useMe`/`useUpdateMe`/`useRefreshToken`/`useLogout`/`useDevLogin` 존재, 경로·메서드가 B2와 일치. logout 후 메모리 토큰 폐기 + 쿼리 캐시 정리 + `/login`.
- [ ] snake_case 필드를 그대로 사용(중간 camelCase 변환 없음).

### C2. 라우트·링크 (9-5)
- [ ] `app/` 구조: `/login`, `/welcome`, `(main)/` 아래 `/`, `/settings`, `/scrims`, `/rankings`, `/members/[id]`.
- [ ] 모든 `href`/`router.push`/`redirect(` 값이 위 라우트에 존재. 링크는 `lib/routes.ts` 함수 경유. 「내 프로필」 = `/members/{me.id}`.
- [ ] 「Discord로 로그인」 = `location.href = /api/v1/auth/discord?redirect=…`(fetch 아님), redirect는 SafeRedirectPath 검증 후 인코딩.
- [ ] `next.config.ts` rewrites `/api/v1/:path*` → `API_ORIGIN`.

### C3. middleware (5-9)
- [ ] matcher가 `(main)` 경로 전부 + `/welcome` 포함, `/login`·`/_next`·`/api` 제외.
- [ ] `gcd_rt` 없으면 `/login?redirect={경로+쿼리}`, 있으면 통과. `/login`은 쿠키 있어도 리다이렉트 안 함.

### C4. 로그인·환영 화면 (목업 Login)
- [ ] `/login`: `LoginPageQuery`로 파싱(잘못된 error 값 무시), `lib/errors.ts`에 **ErrorCode 15개 전부** 문구 매핑(`Record<ErrorCode,string>`이면 컴파일러가 보장). 「롤생네컷이 받는 정보」 4항목 문구 목업과 일치. 개발 로그인 폼은 `NEXT_PUBLIC_AUTH_DEV_LOGIN==='true'`일 때만.
- [ ] `/welcome`: refresh로 user 획득, 아바타·`discord_username`, 「서버 멤버 확인됨」은 `discord_guild_verified_at` 있을 때만, 닉네임 기본값 `user.nickname`, 「2–12자」 안내, 「시작하기」→ PATCH /me, 409 NICKNAME_TAKEN·400 표시, 성공 시 redirect(SafeRedirectPath 실패 → `/`). 「뒤로」→ logout → `/login`.
- [ ] 클라이언트 측 검증이 shared `Nickname` 사용(정규식 복제 없음).
- [ ] `needs_nickname_confirmation=true` 사용자가 다른 화면 진입 시 `/welcome?redirect=` 이동, `/welcome`에서 무한 리다이렉트 없음.
- [ ] 오픈 리다이렉트: `/welcome?redirect=//evil.com`, `/\evil.com`, `https://evil.com` → `/`로.

### C5. 테마 (9-1 ~ 9-4)
- [ ] `src/styles/tokens.css` 변수 이름·값이 목업 `tokens.css`와 동일(스크립트로 변수→값 맵 diff). 선택자 `:root, [data-theme="dark"]` / `[data-theme="light"]`, color-scheme 포함.
- [ ] `globals.css` `@theme inline`에 tokens.css 색 토큰 **전부** `--color-{이름}` 노출 + `--shadow-lift`, `--shadow-seg`.
- [ ] 컴포넌트에 hex/rgb 직접 사용 없음: `grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgb\(" apps/web/src --include=*.tsx`. shadcn 변수(`--background`, `--primary`) 미정의, `bg-background`/`text-muted-foreground` 등 미치환 클래스 없음.
- [ ] `localStorage['gcd-theme']` ∈ light|dark|system, 기본 dark, system → matchMedia. `<head>` 인라인 스크립트로 첫 페인트 전 적용 + `<html suppressHydrationWarning>`. `storage`·matchMedia change 구독.
- [ ] 사이드바 2버튼 세그먼트 `aria-pressed`, 모바일 아이콘 토글 레이블 「라이트 모드로 전환」/「다크 모드로 전환」, 설정 3개 라디오 카드 문구(계약 9-4).

### C6. 레이아웃 (9-5, 목업 Main/MobileHome)
- [ ] 데스크톱 `md` 이상 사이드바: 로고 「롤생네컷 GAME CLUB」, MENU 홈·내전·랭킹·내 프로필·설정, 테마 토글, 사용자 카드(아바타·닉네임, 로그아웃 메뉴). STAFF 메뉴는 `role==='admin'`일 때만.
- [ ] 모바일 `md` 미만: 헤더(로고+테마 토글) + 하단 탭 **홈·내전·랭킹·프로필·설정**(D19, 목업 MobileHome 확인함).
- [ ] 데이터 없는 부분(ELO·순위·배지 숫자)은 숨김/자리 — 목업의 가짜 숫자 하드코딩 금지.
- [ ] 필수 상태(skill `nextjs-dashboard-ui` 4절): 로딩·오류·빈 상태. 자리 페이지는 「준비 중」.
- [ ] 가능하면 `next build` 후 정적 렌더 확인; 실제 브라우저 렌더 확인은 도구 한계로 **미실행** 표시.

### C7. 외부 호출
- [ ] `apps/web`에 `discord.com/api` 직접 호출 없음(authorize 이동은 API가 담당).

---

## D. 교차 대조 (`s0` 대상)

| 계약 엔드포인트 | 컨트롤러(파일:줄) | 웹 훅/호출부 | 비고 |
| --- | --- | --- | --- |
| GET /auth/discord | | 로그인 버튼 `location.href` | 브라우저 이동 |
| GET /auth/discord/callback | | (없음 — 디스코드가 호출) | 정상 |
| POST /auth/refresh | | useRefreshToken / 부트스트랩 | |
| POST /auth/logout | | useLogout | |
| POST /auth/dev-login | | useDevLogin | 플래그 |
| GET /me | | useMe | |
| PATCH /me | | useUpdateMe | |

- [ ] 오류 코드 3중 대조: 계약 3절 표(15개) ↔ `ErrorCode` ↔ `ERROR_HTTP_STATUS` ↔ `lib/errors.ts` ↔ API에서 실제 throw하는 코드(grep).
- [ ] 쿠키 이름: API set ↔ web middleware 모두 `AUTH_COOKIE.refresh` 상수 사용.
- [ ] SafeRedirectPath: API(start)·web(login, welcome) 모두 shared 스키마 사용.
- [ ] 콜백 리다이렉트 목적지(`/welcome?redirect=`, `/login?error=&redirect=`) ↔ 웹이 실제 읽는 쿼리 이름.
- [ ] 상태 전이: S0에 `status:` 갱신 코드 없음(grep `status:` in apps/api/src). shared 맵 ↔ 계약 7절 일치(현재 일치 확인함).
- [ ] 명세 대조: 문서 2장 「가입·로그인, 닉네임 설정」(P0) 구현 여부, 8장 S0 해당 화면 존재. 누락은 「누락」으로 기록.

---

## E. 보안 경계 (계약 11절 qa)

| # | 시나리오 | 기대 |
| --- | --- | --- |
| E1 | `GET /auth/discord?redirect=//evil.com` (및 `/\evil.com`, `%2F%2Fevil.com`, `/%09/evil.com`) | redirect 무시 → `/` |
| E2 | refresh/logout/dev-login에 `Origin: https://evil.com` | 403 FORBIDDEN |
| E3 | NODE_ENV=production + AUTH_DEV_LOGIN=true | 404 NOT_FOUND |
| E4 | DB·로그에 리프레시 원문 | 없음(해시만) |
| E5 | 쿠키 속성 | 계약 5-2·5-5와 일치 |
| E6 | 오류 응답에 스택·내부 메시지 | 없음 |
| E7 | 비밀값 커밋 | `.env` 미추적(`.gitignore`), 키 없음 |

---

## 계획 단계에서 이미 발견한 계약 내부 불일치 (구현 결함 아님, 리더 참고)

| # | 심각도 | 위치 | 내용 |
| --- | --- | --- | --- |
| P1 | minor | `packages/shared/src/auth.ts:10` vs 계약 5-5(`_workspace/01_architect_contract.md:191`) | `AUTH_COOKIE` 주석은 "둘 다 … Path=/"라고 하나 계약은 `gcd_oauth` Path=`/api/v1/auth`. 백엔드가 주석을 따르면 계약과 어긋남. 검증은 계약 본문(Path=/api/v1/auth) 기준으로 하되 둘 중 하나를 고쳐야 함 |
| P2 | minor | `packages/shared/src/common/errors.ts:20` 주석 | DISCORD_NOT_GUILD_MEMBER 주석에 `pending=true` 경우가 빠짐(계약 3절엔 포함). 동작 영향 없음 |

## 미실행·제약 고정 항목

- DB 필요: 마이그레이션 적용, 시드, 리프레시 회전·동시성·NICKNAME_TAKEN 통합 테스트 → 「미실행」(Docker 없음)
- 실제 디스코드 OAuth 왕복 → 「키 필요」
- 브라우저 시각 확인(라이트/다크 × 데스크톱/모바일) → 도구 한계로 「미실행」, 코드·빌드 산출물 정적 검사로 대체
