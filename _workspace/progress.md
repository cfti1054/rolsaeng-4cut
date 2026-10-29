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

## S1 게임 계정 연동·동기화, 프로필·설정 — 2026-10-29 — 판정: pass (DB·Redis·외부 키 실연동 미확인)

**구현:** 라이엇 ID 연동(프로필 아이콘 소유 확인, lol·tft 두 행, 최대 3개 + 대표 계정), Steam OpenID 연동(1개), 연동 해제(대표 자동 승격), 대표 지정, 수동 새로고침(KST 하루 5회 합산, 429 + Retry-After), GET /users/:id/profile(대표 계정 기준 티어·주 포지션·솔로 랭크 최근 전적, 외부 식별자 비노출), 라이엇·스팀·Data Dragon 클라이언트(호출 한도·429 정지·재시도), 동기화 큐(BullMQ / in-process)와 cron(티어 매시, 스팀 05:00 KST, 멈춘 작업 정리 5분), core 함수 7개, /settings 게임 계정·디스코드 섹션, /members/[id] 프로필.

**리더 직접 실행 (apps/web/.next 삭제 후):**
- `corepack pnpm -r typecheck`: shared·core·web·api Done
- `corepack pnpm -r test`: shared 34, core 79, web 80, api 271 passed / 20 skipped(DB e2e 3개 파일)
- `corepack pnpm -r build`: 4개 패키지 Done
- 부분 고유 인덱스 `game_accounts_one_primary_per_user_game`가 S1 migration.sql 수동 블록에 존재

**QA:** core·integration·web·backend·s1 교차 모두 pass. 보고서 `_workspace/03_qa-verifier_{plan,core,integration,web,backend,s1}.md`

**결함 처리:** 계약 불일치 P1–P7 → architect 수정(D59–D61). integration m1 → D67(계약 정정), m2 → D69 수정, m3 → DB e2e 작성. web m1(부계정 폼 재오픈) → 리더 수정(`game-accounts-section.tsx`), 코드 확인만(브라우저 미확인). 남은 결함 없음.

**미실행·미확인:**
- DB e2e 20건(S0 5 + sync-store 8 + game-accounts 7): 부분 인덱스 실제 거부, P2002 `meta.target` 형식, advisory lock, 동시 대표 지정·동시 sync 경계
- BullMQ(Redis 없음), `node dist/main.js` 기동, 브라우저 렌더
- 실제 라이엇·스팀 호출(키 필요), 소유 확인 아이콘 0–28 선택 가능 여부(I2, D65)
- 라이엇 API 경로는 공식 swagger 기반 스키마로 부분 확인(I1)

**사용자 결정:** 라이엇 부계정 허용 + 대표 계정(D56), 다른 멤버가 연동한 계정은 막고 운영진 문의(D45), 최근 전적·주 포지션은 솔로 랭크만(D40), 라이엇 ID 하나로 lol·tft(D25)

**리더 결정·기본값:** 라이엇 소유 확인 = 아이콘 변경, 스팀 = OpenID, 라이엇 최대 3개·스팀 1개, 첫 연동이 대표, Redis 유무에 따른 큐 전환, 다른 멤버 프로필 조회 허용·외부 식별자 비노출, D62–D72(xact lock, BullMQ 큐 하나, 시작 시 회수 규칙, 아이콘 대체 경로, 롤체 「1위 N회」 표기, 회수 경로 riot-full, 중복 키 형식, SYNC_JOBS_ENABLED 범위, load-env 선행, steam_error 쿼리, env 엄격 파싱)

**명세 문서와 어긋난 부분(문서 갱신 필요):** 2장 스팀 연동 방식(OpenID)·라이엇 부계정, 6장 game-accounts 경로(DELETE `/:id`, 추가 경로 5개), 8장 /settings 디스코드 섹션·알림 설정 이연, 목업 롤체 「순방 %」

**의존성 추가:** `@nestjs/schedule` 12.0.2, `bullmq` 6.5.0

**다음:** S2 내전 모집·참가·대기열·노쇼 제한, 목록·작성·상세 화면

## S2 내전 모집·참가·대기열·노쇼 제한, 목록·작성·상세 — 2026-10-29 — 판정: pass (DB e2e·실서버 미확인)

**구현:** 내전 모집글 작성·수정·시작·취소(방장·운영진), 참가·대기열(1·2지망 포지션, 대기 승격 시 포지션·참가 시각 유지, 시작 시각 마감, 방장 취소 불가), 60분 자동 마감, 운영진 노쇼 표시·정정(시작 후 7일, 정정은 기한 없음), 노쇼 누적 제한(최근 30일 3회 → 7일, env), GET /games, GET /me/scrim-restriction 포함 엔드포인트 11개, core `scrim.ts`·`no-show.ts`, S2 마이그레이션, /scrims(모집 중·진행 중·종료 탭, 커서 「더 보기」), /scrims/new, /scrims/[id], 스팀 연동 팝업(/steam-link/complete).

**리더 직접 실행:**
- `corepack pnpm -r typecheck`: shared·core·web·api Done
- `corepack pnpm -r test`: shared 53, core 148, web 125, api 332 passed / 27 skipped(DB e2e)
- `corepack pnpm --filter web build`: 성공(/scrims ○, /scrims/new ○, /scrims/[id] ƒ, /steam-link/complete ○)
- 브라우저(목 모드, 운영진 계정, 라이트·다크, 데스크톱·모바일 폭): 목록·「더 보기」 12→14건, 작성 화면, 상세 참가·취소(9/10 ↔ 8/10), 시작 시각 도달 시 참가 영역 즉시 마감, 노쇼 기한 경과 시 표시 버튼 숨김·정정 유지. 「더 보기」 실패 문구는 목에서 실패를 만들 수 없어 코드로만 확인

**QA:** core·backend·web·s2 교차 모두 pass. 보고서 `_workspace/03_qa-verifier_{core,backend,web,s2}.md`

**결함 처리:** web minor 3(더 보기 오류 문구)·4(시작 시각 즉시 마감)·5(기한 지난 노쇼 버튼 숨김) → 리더 수정, s2 QA가 재검증 해소. s2 minor 4(클라이언트 시계가 빠를 때 먼저 막힘) → 리더 수정(재조회 응답이 열림이면 서버값 우선), QA 재검증 없음. web minor 1·2(목 전용 차이) 남김.

**남은 결함(architect 결정 필요):**
- s2-1 제한 배너 「노쇼 N회」의 N이 최근 30일 개수라 제한 중에도 기준보다 작게 보일 수 있음(계약 8절 문구)
- s2-2 카드 「… 구함」 합계가 빈 자리보다 클 수 있음(계약 7절 식, core QA 결함 1)
- s2-3 env로 바뀌는 값(노쇼 기준·표시 기한·자동 마감·작성 상한)을 웹이 고정 문구·상수로 씀

**미실행·미확인:**
- DB e2e 27건(S2 scrims 6건: 마지막 자리 동시 참가 등 동시성), S2 마이그레이션 실제 적용 — Docker·PostgreSQL 없음
- 실제 API 서버 + 웹 연결 상태의 브라우저 확인

**리더 결정·기본값:** D73–D95(계약 문서). 리프레시 토큰 하루 1회 회전, 스팀 연동 팝업, 상태 탭 open·playing·ended, 카드 버튼은 모두 상세로 이동, 마감 판단은 서버 시각 기준(화면은 시작 시각에 먼저 막고 재조회)

**명세 문서와 어긋난 부분(문서 갱신 필요):** 2장 모집글·참가 관리(제목, 진행 방식, 포지션 1·2지망, 자동 마감, 정원 범위, 방장 취소 불가), 5장 games·scrims·scrim_players 열 추가, 6장 scrims 경로·본문(탭 status, cursor, join 본문 필수, 추가 경로 6개), 7-4 노쇼(표시 기한·이동 구간·작성 제한·env), 8장 /scrims 탭·/scrims/new 입력·/scrims/[id] 메뉴. 상세 목록은 `03_qa-verifier_s2.md` 「명세 문서 갱신 필요 목록」

**추가 변경(사용자 요청, D97):** 롤 정원 10 고정 → 2–10명 2명 단위, 꽉 차야 시작. games `capacity_step`·`start_requires_full` 열(마이그레이션 `20261029160000_s2_capacity_step`, prisma migrate diff와 일치 확인). 리더 직접 수정·실행: typecheck 4개 Done, test shared 53·core 150·web 126·api 333 passed / 27 skipped, web build 성공. QA 재검증 없음

**추가 변경(사용자 요청):** 내전 상세 「링크 복사」(제목·시각·인원 + URL을 메신저용 텍스트로, clipboard 실패 시 textarea 대체). 배너 태그 롤 `LEAGUE · {정원/2}V{정원/2}`. **D98** 스팀 내전 게임 선택 필수: `GET /steam-apps`(멤버 보유 게임 + 스팀 상점 검색), games `requires_steam_app`, scrims `steam_app_id`·`steam_app_name`(마이그레이션 `20261029170000_s2_steam_app`, prisma migrate diff와 일치 확인), 작성·수정 화면 「스팀 게임」 선택, 카드 배너·상세에 게임 이미지·이름. 리더 직접 수정·실행: typecheck 4개 Done, test shared 57·core 150·web 131·api 343 passed / 27 skipped(DB e2e, Docker 없음), web build 성공, 목 모드 브라우저 확인(검색·선택·작성·상세·수정 창). QA 재검증 없음

**다음:** 남은 결함 s2-1~3 계약 결정 후 S3 팀 자동 밸런스, 결과 입력·승인, ELO 반영, 레이팅 그래프
