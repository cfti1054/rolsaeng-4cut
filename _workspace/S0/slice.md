# 슬라이스 S0 — 골격

명세: `게임 커뮤니티 대시보드 개발 문서.md` (이하 "문서")
목업: `_workspace/00_input/mockup/*.dc.html` (원본 캔버스 https://claude.ai/artifact/BVZTXAcYMuPpwPEpwxxh7q)
테마 토큰: `_workspace/00_input/mockup/tokens.css` (라이트/다크 색 토큰의 기준값)

## 포함

| 영역 | 내용 | 근거 |
| --- | --- | --- |
| 모노레포 | pnpm workspace: `apps/web`(Next.js), `apps/api`(NestJS), `packages/shared`(zod 계약·타입), `packages/core`(순수 도메인 로직) | 문서 4장 |
| 인프라 | `docker-compose.yml`(PostgreSQL, Redis), `.env.example` | 문서 4장 |
| DB | **전체** Prisma 스키마(5장 모든 테이블, 봇용 `activity_logs`·`api_keys`·`discord_id` 포함) + 아래 「결정 사항」의 추가 컬럼·테이블, 마이그레이션, `games` 시드(lol, tft, steam) | 문서 5장, 10장 지침 |
| 인증 | **디스코드 OAuth2 로그인**, JWT 액세스·리프레시 토큰, `GET/PATCH /me`, 첫 로그인 닉네임 확인 | 문서 2장 계정(사용자 결정으로 변경), 6장 |
| 공통 레이아웃 | 데스크톱 사이드바 / 모바일 하단 탭, **라이트·다크·시스템 테마 전환**(사이드바 토글, 모바일 헤더 토글), 로그인 화면, 빈 홈 자리 | 문서 8장, 목업 Main·MobileHome·Login·Settings(화면 테마 섹션) |

## 제외 (다음 슬라이스)

게임 계정 연동(S1), 내전(S2·S3), 랭킹·홈 요약 데이터(S4), 봇 API(S5), 관리자 기능(S6). 단, 스키마는 S0에서 전부 만든다.

## 사용자 결정 사항

1. **로그인은 디스코드 로그인(OAuth2)으로 한다.** 문서 2장 "이메일 또는 소셜 로그인"과 설계 원칙 1 "디스코드와 분리"를 이 결정으로 대체한다.
   - 결과: `users.discord_id`가 로그인 식별자가 된다. 문서 6장의 연동 코드 → `/bot/link` 흐름은 계정 연결용으로는 불필요해진다(S5에서 재검토).
2. 목업의 라이트/다크/시스템 테마 전환을 구현한다.

## 메인이 정한 기본값 (사용자 확인 전, 보고서에 명시)

- OAuth 범위: `identify email guilds.members.read`. 이메일은 선택(nullable).
- 커뮤니티 디스코드 서버(`DISCORD_GUILD_ID`) 멤버만 가입·로그인 허용. 설정값이 비어 있으면 검사하지 않는다.
- 첫 로그인 시 닉네임 기본값 = 서버 닉네임 → 없으면 global_name → username. 확인 화면에서 `PATCH /me`로 확정.
- 로컬 개발용 로그인 우회: `AUTH_DEV_LOGIN=true`일 때만 열리는 개발 전용 엔드포인트(디스코드 앱 키 없이 테스트하기 위함). production에서는 비활성.
- `users.role`: member, admin(문서 5장 그대로).
- 테마 선택은 브라우저 localStorage에 저장(서버 저장 안 함), 기본값 다크.
- 명세 공백을 스키마에 미리 반영(S3·S6에서 사용):
  - `scrim_results.status` = pending | approved | rejected, `reject_reason`, `rejected_by`, `rejected_at`
  - 이의 제기 테이블 `scrim_result_disputes`(scrim_result_id, user_id, reason, status open|resolved, resolved_by, resolved_at)
  - 규칙: 결과를 제출한 사람은 같은 결과를 승인할 수 없다(자기 승인 금지) — S3에서 구현
  - 공지 테이블 `notices`(title, body, author_id, notify_discord) — 목업 관리자 화면

## 환경 제약

- pnpm은 전역 설치가 없어 `corepack pnpm ...`으로 실행한다. 루트 `package.json`에 `"packageManager": "pnpm@9.15.0"`을 둔다.
- Docker·PostgreSQL이 이 PC에 없다. DB가 필요한 테스트는 "미실행"으로 표시하고, 단위 테스트·타입 검사·빌드는 반드시 통과시킨다.
- 디스코드 OAuth 앱 키가 없다. 실제 OAuth 왕복은 "키 필요"로 보고하고, 콜백 처리는 디스코드 API를 목으로 대체한 테스트로 검증한다.
