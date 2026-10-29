# S0 frontend (apps/web) 보고

> frontend 에이전트가 실행 환경 제약으로 이 파일을 쓰지 못해, 리더가 에이전트의 최종 보고를 옮겨 적었다(2026-10-28). 수치는 에이전트 보고 기준이며 리더 재확인은 4단계에서 한다.

## 구현 범위

테마 시스템, 앱 셸(데스크톱 사이드바 / 모바일 헤더 + 하단 탭), `/login`, `/welcome`, `/settings` 화면 테마 섹션, API 클라이언트·훅, middleware. 백엔드 없이 목으로 개발했고, 실제 API와 목 전환 지점은 `NEXT_PUBLIC_API_MOCK` 하나뿐(D29).

## 검증 (에이전트 실행 결과)

- `corepack pnpm --filter web typecheck` 통과
- `corepack pnpm --filter web test`: 5개 파일 44개 통과 (theme 15, client 13, nickname 6, routes 5, mock 5)
- `.next` 삭제 후 `next build` 통과. 라우트 /, /admin, /login, /members/[id], /rankings, /scrims, /settings, /welcome. Middleware 48.1 kB
- `next start` HTTP 확인: 비로그인 /settings → 307 `/login?redirect=%2Fsettings`, `/login?error=DISCORD_NOT_GUILD_MEMBER&redirect=//evil.com` → 안내 표시 + evil 경로 버림, 자체 호스팅 woff2 200
- 미실행: 실제 브라우저에서 하이드레이션·테마 전환·목 로그인 왕복, 데스크톱·모바일 스크린샷

## 주요 파일

- 테마: `src/styles/tokens.css`, `src/app/globals.css`(`@theme inline`, 기본 팔레트 제거), `src/lib/theme/{theme,store}.ts`, `src/components/theme/*`, 루트 `layout.tsx`의 `THEME_INIT_SCRIPT`
- 셸: `src/components/shell/{app-shell.tsx,nav-items.ts,placeholder-page.tsx}`, `src/components/ui/{primitives,icons}.tsx`, `src/app/(main)/**`
- 인증 화면: `src/app/(auth)/{layout,login/page,welcome/page}.tsx`, `src/components/auth/{login-panel,welcome-panel,steps}.tsx`
- 데이터: `src/lib/api/{client,index,auth}.ts`, `src/lib/hooks/auth.ts`, `src/components/providers.tsx`, `src/middleware.ts`, `src/lib/{routes,errors,nickname,cn}.ts`
- 목: `src/lib/api/mock/backend.ts`. 실제 연결 지점은 `[API 연결]` 주석

## 리더 공지 반영

- 폰트: next/font/google 제거, `@fontsource/ibm-plex-sans-kr@5.3.0`, `@fontsource/chakra-petch@5.3.0` 자체 호스팅(빌드·실행에 외부 네트워크 불필요)
- vitest: `ssr.resolve.conditions`·`externalConditions` 추가(D27)
- 주의: 폰트 다운로드에 실패했던 빌드 캐시가 남으면 다음 빌드가 성공으로 보여도 런타임 NextFontError가 난다. `apps/web/.next` 삭제 후 재빌드 권장

## 목업과 다른 점

1. 디스코드 버튼 색은 `globals.css`의 `--brand-discord`, `--brand-on-discord` (D28)
2. 설정 테마 카드 미리보기는 고정 hex 대신 `data-theme` 요소 안에서 토큰으로 그림
3. 목업 반투명 hex → 토큰 + 투명도(`bg-cyan/15` 등)
4. 데이터가 필요한 요소(시즌 카드, ELO·순위, 내전 배지, 알림, 검색, D-34) 제외. 이후 슬라이스에서 채움
5. 사이드바 사용자 카드 아래 줄: 「멤버/운영진 · @discord_username」
6. 로그인 소개 패널은 lg 미만에서 숨김
7. 설정 테마 카드는 `role=radio` + 화살표 키 선택
8. 홈은 빈 상태(NEXT MATCH 자리 + 빈 요약 카드)

## 결정 요청과 처리

| # | 요청 | 리더 결정 |
| --- | --- | --- |
| 1 | 디스코드 브랜드 색 위치 | 승인, 계약 D28 |
| 2 | `NEXT_PUBLIC_API_MOCK*` 환경 변수 | `.env.example`과 계약 10절에 추가, D29 |
| 3 | 웹 전용 오류 코드 `NETWORK_ERROR`, `INVALID_RESPONSE` | 승인, D30 (shared `ErrorCode`에는 넣지 않음) |
| 4 | `/login`·`/welcome`로의 redirect를 `/`로 바꾸는 규칙 | 백엔드에도 동일 적용, D31 |
