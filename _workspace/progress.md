# 진행 기록

## S0 골격 — 2026-10-28 — 판정: pass (DB·OAuth 실연동 미확인)

**구현:** pnpm 모노레포(apps/web, apps/api, packages/shared, packages/core), docker-compose(PostgreSQL·Redis), 전체 Prisma 스키마 21개 테이블 + 마이그레이션 SQL + games 시드, 디스코드 OAuth 로그인(길드 멤버 검사, 첫 로그인 닉네임 확인), JWT 액세스 + 리프레시 쿠키 회전(재사용 감지), dev-login, GET/PATCH /me, 앱 셸(사이드바·모바일 하단 탭), 라이트/다크/시스템 테마, /login, /welcome, /settings 화면 테마 섹션.

**리더 직접 실행 (apps/web/.next 삭제 후):**
- `corepack pnpm -r typecheck`: shared·core·web·api Done
- `corepack pnpm -r test`: shared 9 passed, web 44 passed, api 135 passed / 5 skipped, core 테스트 없음
- `corepack pnpm -r build`: shared·core·api Done, web Compiled successfully

**QA:** auth pass(`03_qa-verifier_auth.md`), shell pass(`03_qa-verifier_shell.md`). 교차 대조(엔드포인트 7 ↔ 컨트롤러 ↔ 웹 호출부, 오류 코드 15개, 쿠키 상수, 테마 토큰 61개 dark·light 일치)는 shell 보고서에 포함.

**QA minor 처리:**
- auth m1 이메일 형식 → backend 수정(형식 불량 인증 이메일은 null 저장, 회귀 테스트)
- auth m2 `prisma:validate`의 `.env` 의존 → 계약 2절 명령 표에 사전 조건 기록
- auth m3 shared 쿠키 Path 주석 → 리더 수정
- shell m1 `/welcome`에서 세션 상실 시 redirect 유실 → 리더 수정(`apps/web/src/lib/api/index.ts` onAuthFailure가 middleware와 같은 규칙 사용). QA 재검증 없음, 위 통합 실행으로 typecheck·test·build만 확인

**미실행·미확인:**
- DB 통합 테스트 5건(`apps/api/test/db/auth.db.e2e.spec.ts`), 마이그레이션 적용, 시드 실행 — Docker·PostgreSQL 없음
- 실제 디스코드 OAuth 왕복 — 디스코드 앱 키 필요
- 실제 브라우저 렌더(하이드레이션, 테마 전환, 화면 스크린샷)

**사용자 결정:** 디스코드 OAuth 로그인(문서 2장·설계 원칙 1 대체), 탈퇴 멤버는 S5에서 즉시 차단(D24), 닉네임 공백 허용(D6), 라이엇 ID 하나로 lol·tft 연동(D25, S1)

**리더 결정·기본값:** OAuth 범위 `identify email guilds.members.read`, `DISCORD_GUILD_ID` 멤버만 허용, 테마 localStorage·기본 dark, 스키마에 scrim_results.status·reject·disputes·notices 선반영, D26(유예 중 계열 폐기 시 거절), D27(vitest ssr 조건), D28(디스코드 브랜드 색 예외), D29(목 환경 변수), D30(웹 전용 오류 코드), D31(인증 화면 redirect 루프 방지)

**명세 문서와 어긋난 부분(문서 갱신 필요):** 2장 가입·로그인, 설계 원칙 1, 6장 `/auth/signup`·`/auth/login`, 6장 연동 코드 → `/bot/link` 흐름(D23, S5 재검토)

**다음:** S1 게임 계정 연동·소유 확인·티어 동기화, 프로필·설정 화면
