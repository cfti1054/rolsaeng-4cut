# QA: shell (apps/web 전체) — 판정: pass

검증: qa-verifier, 2026-10-28. 대상 보고서: `_workspace/02_frontend-dev_shell.md`(리더 전사본)
기준: 계약 `_workspace/01_architect_contract.md`(D28~D31 포함), `packages/shared/src/**`, 체크리스트 `_workspace/03_qa-verifier_plan.md` A(web)·C·E(웹), 목업 `_workspace/00_input/mockup/`
리더 결정 반영: D28 디스코드 브랜드 hex 예외, D29 `NEXT_PUBLIC_API_MOCK*`, D30 `NETWORK_ERROR`·`INVALID_RESPONSE`는 웹 전용(결함 아님), D31은 웹 쪽만 판정(백엔드 D31 제외).

blocker 0, major 0, minor 1. 실제 브라우저 렌더와 `next start` HTTP 확인은 미실행.

## 실행한 명령과 결과 (직접 실행)

| # | 명령 | 결과 |
| --- | --- | --- |
| A0 | `rm -rf apps/web/.next` | 빌드 캐시 삭제(리더 권장) |
| A2 | `corepack pnpm --filter web typecheck` | 통과(출력 오류 없음) |
| A3 | `corepack pnpm --filter web test` | `Test Files 5 passed (5)`, `Tests 44 passed (44)` — theme 15, routes 5, nickname 6, mock 5, client 13 |
| A4 | `corepack pnpm --filter web build` (Next.js 15.5.28) | `✓ Compiled successfully`, 정적 페이지 10/10. 라우트: `/`, `/_not-found`, `/admin`, `/login`(ƒ), `/members/[id]`(ƒ), `/rankings`, `/scrims`, `/settings`, `/welcome`(ƒ), Middleware 48.1 kB. Google Fonts 다운로드 없음(@fontsource 자체 호스팅) |
| A-tok | 토큰 대조 스크립트(목업 `tokens.css` ↔ `apps/web/src/styles/tokens.css` ↔ `globals.css @theme inline`) | dark 61/61, light 61/61 변수, 누락·추가·값 차이 0. 61개 모두 `@theme inline`에 노출 |
| A-grep | hex/rgb, shadcn 변수, 토큰 저장, `discord.com`, 응답 단언 grep | 아래 C5·C1·C7 |
| — | `next start` HTTP 확인 | **미실행**(서버 기동·종료가 이 환경에서 권한 거부됨). 구현자 보고의 HTTP 확인은 인용하지 않음 |
| — | 브라우저 렌더(데스크톱·모바일 × 라이트·다크), 하이드레이션 | **미실행**(도구 없음) |

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| m1 | minor | `apps/web/src/lib/api/index.ts:23-29`(onAuthFailure) vs `apps/web/src/middleware.ts:12-16` | `/welcome?redirect=X`에서 세션을 잃으면 로그인 후 X로 돌아가야 함. middleware는 이 경우 X를 꺼내 `/login?redirect=X`로 보냄 | 클라이언트 onAuthFailure는 `/login?redirect=/welcome?redirect=X`로 보냄. 로그인 페이지 `safeRedirect`가 D31 규칙으로 `/welcome…`을 `/`로 바꿔서 X를 잃음. 쿠키는 있지만 만료·폐기된 상태로 첫 로그인 `/welcome`에 오면 생김(예: 콜백 직후 다른 탭에서 로그아웃). 홈으로 가는 것뿐이라 기능 손상은 없음 | `safeRedirect('/welcome?redirect=%2Fscrims')` → `/`(routes.test.ts:14의 D31 사례와 같은 규칙). onAuthFailure가 `/welcome`일 때 middleware처럼 내부 redirect를 꺼내면 해결 |

## 체크리스트 결과

### C1 API 클라이언트·훅
- [x] 모든 호출 = `API_PREFIX + ApiPath.*`(`client.ts:75-77`), 같은 오리진 상대 경로, `credentials:'include'`, `cache:'no-store'`. `localhost:4000` 직접 호출 없음(rewrites `next.config.ts:15-17`).
- [x] 성공 응답 `schema.safeParse`, 실패 시 INVALID_RESPONSE(`client.ts:114-128`). 오류 본문 `ErrorBody.safeParse`. 응답에 `as Me`류 단언 없음(`setQueryData<Me>`는 이미 parse된 값에 타입 인자만 붙임).
- [x] 401 ACCESS_TOKEN_EXPIRED → refresh 1회 → 재시도 1회, 다시 401이면 포기(`client.ts:186-201`). 다른 401(UNAUTHENTICATED) → 세션 비우고 /login. refresh 401 → /login.
- [x] single-flight: `refreshInFlight` 공유 Promise(`client.ts:148-166`), 테스트 `client.test.ts:99,116`.
- [x] 액세스 토큰은 클로저 변수에만 있음. 실제 경로에 localStorage·sessionStorage·document.cookie 사용 없음. 목 백엔드(`mock/backend.ts:196-222`)만 쓰고, `NEXT_PUBLIC_API_MOCK=true`일 때만 동작(D29).
- [x] 훅 `useMe`/`useUpdateMe`/`useRefreshToken`/`useLogout`/`useDevLogin`(`lib/hooks/auth.ts`). logout은 `auth:false`, 실패해도 토큰을 버리고 `qc.clear()` 후 `/login`.
- [x] snake_case 그대로 사용(`needs_nickname_confirmation`, `discord_guild_verified_at`, `avatar_url` 등). camelCase 변환 없음.

### C2 라우트·링크
- [x] `app/` 라우트: `/login`, `/welcome`(`(auth)`), `/`, `/settings`, `/scrims`, `/rankings`, `/members/[id]`, `/admin`(`(main)`). `/admin`은 계약 9-5의 「STAFF 메뉴, S6까지 자리」 대상.
- [x] 링크·이동은 모두 `routes.*` 함수 경유(grep 결과 하드코딩 href 없음). 「내 프로필」 = `routes.member(me.id)`, me가 없으면 비활성.
- [x] 「Discord로 로그인」 = `window.location.assign(apiRoutes.discordStart(redirect))` → `/api/v1/auth/discord?redirect=…`(fetch 아님). redirect는 페이지에서 `safeRedirect` 처리된 값.

### C3 middleware
- [x] matcher가 `/login`·`/api/`·`/_next/`·확장자 있는 파일을 제외하고 나머지((main)·`/welcome`)를 모두 포함.
- [x] `gcd_rt`(`AUTH_COOKIE.refresh` 상수) 없으면 `/login?redirect={경로+쿼리}`, `/welcome`은 내부 redirect를 넘김. `/login`은 검사 대상이 아님.

### C4 로그인·환영
- [x] `/login`: `LoginPageQuery.shape.error`로 error 파싱(모르는 값은 무시), `safeRedirect`로 redirect 처리. 「롤생네컷이 받는 정보」 4항목 문구가 목업 Login과 같음. 개발 로그인 폼은 `NEXT_PUBLIC_AUTH_DEV_LOGIN==='true'`일 때만 보이고, 입력은 shared `DevLoginRequest`로 검증.
- [x] 오류 문구: `ERROR_MESSAGES: Record<ErrorCode | ClientErrorCode, string>`(`lib/errors.ts`). shared `ErrorCode` 15개 전부 + D30 2개. 컴파일러가 빠짐을 막음. OAuth 오류 제목 6개 = `OAuthLoginErrorCode` 6개.
- [x] `/welcome`: useMe(토큰 없으면 refresh로 부팅), 아바타·`discord_username`, 「서버 멤버 확인됨」은 `discord_guild_verified_at`이 있을 때만, 기본값 `me.nickname`, 2–12자 안내, 「시작하기」 → `PATCH /me`, NICKNAME_TAKEN·VALIDATION_FAILED 문구 표시, 성공 시 `router.replace(redirect)`. 「뒤로」 → logout → `/login`. 이미 확인된 사용자는 redirect로 보냄.
- [x] 클라이언트 닉네임 검증은 shared `Nickname`·`normalizeNickname` 사용(`lib/nickname.ts`). 정규식 복제 없음.
- [x] `needs_nickname_confirmation=true`면 (main)에서 `/welcome?redirect={현재 경로}`로 보냄(`app-shell.tsx:29-35`). `/welcome`은 (main) 밖이라 무한 리다이렉트 없음.
- [x] 오픈 리다이렉트·루프(D31): `safeRedirect`는 shared `SafeRedirectPath`를 거친 뒤 `/login`·`/welcome`(하위 경로 포함)이면 `/`로 바꿈. `routes.test.ts:9,14`.

### C5 테마
- [x] tokens.css: 변수 이름·값이 목업과 완전히 같음(A-tok). 선택자는 `:root, [data-theme="dark"]` / `[data-theme="light"]`, `color-scheme` 포함. `html, body { background: var(--bg) … }`(`globals.css:95-97`).
- [x] `@theme inline`이 61개 토큰을 모두 노출하고, `--color-*: initial`로 기본 팔레트를 지움. 컴포넌트가 쓰는 색 유틸리티는 모두 정의된 토큰에 대응(`border-t-accent`는 accent 토큰을 쓰는 방향 유틸리티로 정상).
- [x] tsx/ts에 hex·rgb 없음. hex는 `globals.css:89-90`의 `--brand-discord`·`--brand-on-discord`(D28 예외)뿐. shadcn 변수·클래스 없음.
- [x] `localStorage['gcd-theme']`, 기본 dark, system은 matchMedia로 해석. `<head>` 인라인 스크립트 + `<html suppressHydrationWarning>`(`app/layout.tsx`). `storage` 이벤트와 matchMedia change 구독(`store.ts`).
- [x] 사이드바 2버튼 세그먼트 `aria-pressed`, 모바일 토글 레이블 「라이트 모드로 전환」/「다크 모드로 전환」, 설정 3카드 문구가 계약 9-4와 글자 단위로 같음(`role=radio`, `aria-checked`).

### C6 레이아웃
- [x] 사이드바(`md:flex`): 로고 「롤생네컷 / GAME CLUB」, MENU 홈·내전·랭킹·내 프로필·설정, STAFF는 `role==='admin'`일 때만, 테마 세그먼트, 사용자 카드(아바타·닉네임, 메뉴: 내 프로필·로그아웃).
- [x] 모바일: 헤더(로고 + 토글) + 하단 탭 홈·내전·랭킹·프로필·설정(`grid-cols-5 md:hidden`), 목업 MobileHome·D19와 같음.
- [x] 데이터가 필요한 요소(ELO·순위·배지 숫자·D-34·알림)는 넣지 않음. 홈은 빈 상태, 자리 페이지는 「준비 중이에요」.
- [x] 필수 상태: 로딩(Skeleton·FullScreenLoading), 오류(ErrorState + 다시 시도), 빈 상태(EmptyState).

### C7 / E(웹) 보안
- [x] `apps/web`에서 `discord.com` 직접 호출 없음.
- [x] 오픈 리다이렉트: 웹이 받는 모든 redirect 입력(login·welcome 쿼리, middleware 경유)이 `safeRedirect` → shared `SafeRedirectPath`를 거침.
- [x] 액세스 토큰 비저장(C1).

## 교차 대조 표 (auth 검증과 합침)

| 계약 엔드포인트 | 컨트롤러 | 웹 호출부 | 응답 parse |
| --- | --- | --- | --- |
| GET /auth/discord | `auth.controller.ts:45` | `lib/api/auth.ts` `startDiscordLogin` → `location.assign` | (302, 해당 없음) |
| GET /auth/discord/callback | `auth.controller.ts:54` | 없음(디스코드가 호출) — 결과 쿼리 `/login?error&redirect`, `/welcome?redirect`는 각 페이지가 읽음 | LoginPageQuery / safeRedirect |
| POST /auth/refresh | `auth.controller.ts:66` | `client.refresh`(부팅·재시도), `useRefreshToken` | `RefreshTokenResponse` |
| POST /auth/logout | `auth.controller.ts:87` | `logout` / `useLogout` | 204 |
| POST /auth/dev-login | `auth.controller.ts:96` | `devLogin` / `useDevLogin` | `DevLoginResponse` |
| GET /me | `users.controller.ts:56` | `getMe` / `useMe` | `GetMeResponse` |
| PATCH /me | `users.controller.ts:62` | `updateMe` / `useUpdateMe` | `UpdateMeResponse` |

- 일대일 대응, 빠진 것·남는 것 없음.
- 오류 코드: 계약 15 = shared `ErrorCode` 15 = API `DEFAULT_ERROR_MESSAGE` 15 = 웹 `ERROR_MESSAGES` 15 + 웹 전용 2(D30).
- 쿠키 이름: API `cookies.ts`와 웹 `middleware.ts` 모두 `AUTH_COOKIE.refresh` 상수.
- 백엔드가 `/login?error=`에서 redirect가 `/`이면 생략(auth 보고서 B3) ↔ 웹은 redirect가 없으면 `/`로 처리. 동작 같음.
