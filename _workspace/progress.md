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

**추가 변경(사용자 요청, 2026-10-30):** 노쇼 제한 기간 기본값 7일 → 1일(`NO_SHOW_RESTRICTION_DAYS_DEFAULT`, `SCRIM_NO_SHOW_RESTRICTION_DAYS`). 최근 30일 3회와 표시 기한(시작 후 7일)은 그대로. 노쇼 확인 대화상자는 `GET /me/scrim-restriction`의 policy 숫자를 쓴다. 리더 직접 수정·실행: core 150, web scrims 40, api env+scrims e2e 49 passed. 목 모드 브라우저에서 제한 배너·상세 「내 참가」 안내가 「1일」로 보이는 것 확인. QA 재검증 없음

**다음:** 남은 결함 s2-1~3 계약 결정 후 S3 팀 자동 밸런스, 결과 입력·승인, ELO 반영, 레이팅 그래프

## S2 남은 결함 s2-1~3 처리 — 2026-10-30 — 판정: pass (DB e2e·브라우저 미확인)

**계약:** D99~D102(`01_architect_contract.md` 13절, 15-1절). s2-1 제한 문구에서 「노쇼 N회」 제거(「노쇼가 누적되어 {until}까지 …」). s2-2 `computeOpenPositions` 합계가 빈 자리를 넘으면 `[]`(카드는 「N자리 남음」, min 절단은 합계가 여전히 넘을 수 있어 불채택). s2-3 `GET /me/scrim-restriction`에 `policy.mark_window_days`, `scrim_policy.{schedule_max_days_ahead, auto_close_after_min}` 추가, 웹 하드코딩 제거(응답 전엔 숫자 없는 문구, 상한 사전 검사 생략). D102 오류 문구에서 「7일」 제거.

**구현:** core `scrim.ts`(+테스트 13개), api `scrim-restriction.service.ts`, web `lib/scrims.ts`·`scrim-detail.tsx`·`scrim-new-form.tsx`·`scrim-edit-dialog.tsx`(상한 검사 신규)·`lib/errors.ts`·목 백엔드.

**리더 직접 실행:** typecheck 4개 Done / test shared 57·core 155·web 136·api 345 passed / 27 skipped(DB e2e) / `pnpm -r build` 4개 Done

**QA:** `03_qa-verifier_s2_r2.md` pass(minor 4). 무작위 대조(core ↔ web 목 10만 회, 노쇼 조회 하한 5만 회) 불일치 0. 이전 QA 재검증 없던 리더 수정분(useJoinClosed, web minor 3·4·5, 노쇼 제한 1일)도 확인.

**결함 처리:** minor 1(수정 대화상자 날짜 `max` 누락) → 리더 수정(상한과 기존 시작 시각 중 큰 쪽), QA 재검증 없음. minor 2(보조 문구 「마지막 노쇼부터 N일」 → 「N일 동안 … 제한 중 기준을 채우는 노쇼가 또 생기면 그만큼 늦게 풀려요」), minor 3(카운트다운이 0 이하면 「00:00:00」 대신 「곧 시작」), minor 4(목 테스트 난수를 시드 고정 mulberry32로) → 모두 리더 수정, QA 재검증 없음. web typecheck·test 136 passed·build 성공. 남은 결함 없음

**미실행·미확인:** DB e2e 27건, 브라우저 렌더 — 이전과 동일

**다음:** S3 팀 자동 밸런스, 결과 입력·승인, ELO 반영, 레이팅 그래프

## S3 팀 자동 밸런스, 결과 입력·승인, ELO 반영, 레이팅 그래프 — 2026-10-30 — 판정: pass (DB e2e·브라우저 미확인)

**구현:** core `rating.ts`(팀 평균 ELO, K 32/신규 40, 티어 시드, 개인 순위 쌍대 ELO, 반올림)·`balance.ts`(실력값 w, 2–16명 팀 나누기 전수, 포지션 배정 비용 0/1/3, λ 50, 상위 3안)·`season.ts`(KST 시즌 판정·자동 시즌). api 새 엔드포인트 8개(`POST /scrims/:id/balance`, `PUT /scrims/:id/teams`, `POST·DELETE /scrims/:id/result`, `POST .../result/approve`, `POST .../result/reject`, `GET /seasons`, `GET /users/:id/rating-history`), 목록·상세·프로필 응답 확장, 오류 코드 7개, 승인 한 트랜잭션(잠금 내전 → 시즌 생성 → 사용자, now = 잠금 직후), `rating_history.k_factor`, 마이그레이션 `20261030120000_s3`(부분 고유 인덱스 `scrim_results_one_active_per_scrim`), env 4개. web `/scrims/[id]` 밸런스 3안·팀 확정·직접 수정·결과 입력(승리 팀/순위)·승인 대기·제출 취소·승인·반려·ELO 변동 표, `/scrims` 종료 카드 결과, `/members/[id]` 레이팅 카드·Recharts 그래프·최근 내전, 훅 8개, 목 백엔드(계산은 `@gcd/core` import).

**리더 직접 실행:** typecheck 4개 Done / `-r test` 2회 연속 통과: shared 71·core 238·web 162·api 379 passed / 33 skipped(DB e2e) / `-r build` 4개 Done

**QA:** core pass(minor 3), backend pass(minor 4), web pass(minor 8), S3 교차 r1 fail(major 1: core 성능 테스트 병렬 부하 실패) → r2 pass(minor 2). 보고서 `_workspace/03_qa-verifier_{core,backend,web,s3,s3_r2}.md`. D136 api ↔ 목 무작위 대조 11,800건 불일치 0.

**결함 처리:** backend 1–3(now 시점 D128, 트랜잭션 timeout D129, 깨진 placements D130) → backend 수정. web 1–8 → frontend 수정(목 S2 복사본 4개도 core import로). core 1 → D134(포지션 ≤ 5 전제), core 3 → 리더 수정. 교차 major 1 → 리더 수정(워밍업 + 상한 1000ms, D137). 교차 minor 2–5 → 목·api·계약 수정(D136 등). r2 N2(계약 문구) → 리더 수정.

**남은 결함:**
- ~~core 2: 수동 시즌이 월말 임의 시각에 끝나면 자동 시즌 날짜가 밀림~~ → 2026-10-30 처리(아래 「core 2 처리」)

**사후 수정(사용자 요청, 2026-10-30, D138):** r2 N1 → 프로필 개인 순위 승패의 기준 참가자를 승인 때 반영된 사용자(rating_history)로 고정(승인 뒤 노쇼 표시 무시, 이력 없으면 현재 status). backend 4 → 프로필 최근 내전 조회를 최신 승인 결과 10개(`PROFILE_RECENT_SCRIMS_SCAN_LIMIT`)로 묶고 그중 5개 표시(내 참가 행 목록은 전체 조회). 테스트 api +2·web +1. 리더 직접 수정·실행: typecheck 4개 Done, `-r test` 2회 shared 71·core 238·web 163·api 381 passed / 33 skipped, `-r build` 4개 Done. QA 재검증 없음

**core 2 처리(사용자 결정, 2026-10-30, D139):** `planAutoSeason` 공백 건너뛰기를 직전 끝 이후 첫 KST 달 1일 00:00으로 맞춘 뒤 달력 월로 건너뛰게 변경. 바로 이은 구간이 승인 시각을 포함하면 직전 끝에서 시작(이전과 같음). 계약 6절·7-5·D139 갱신. core 테스트 +3(QA 재현 1/31 10:00 → 8/15 승인 = 8/1 시작 등)과 무작위 테스트 불변식(시작 = 직전 끝 또는 KST 달 1일) 추가. 리더 직접 실행(Node 22): core 241 passed, api 381 passed / 33 skipped, core typecheck Done. QA 재검증 없음

**미실행·미확인:** DB e2e 33건(S3 6건: 동시 승인, 사용자 잠금 직렬화, 시즌 동시 생성, 부분 고유 인덱스, advisory SQL), 마이그레이션 실제 적용, 브라우저 렌더(목 모드 화면 확인 포함)

**사용자 결정:** 없음(지침에 따라 기본값 진행). 확인 필요였던 Q1 시즌 없음 → 승인 시 3개월 시즌 자동 생성(D116), Q2 개인 순위 승패 = 상위 절반 승리(D105)는 architect 추천안 채택

**리더 결정·기본값:** slice.md 기본값 1–10, D103–D137(계약). web에 `@gcd/core` workspace 의존성 추가, `recharts 3.10.1`·`react-is 19.2.9` 추가(lockfile 변경)

**명세 문서와 어긋난 부분(문서 갱신 필요):** `_workspace/03_qa-verifier_s3.md` 「명세 문서 갱신 필요 목록」 10항목(결과 제출 취소·반려 경로, 시즌 자동 생성, 개인 순위 ELO 식, 팀 구성 저장 API 등)

**다음:** S4 티어·ELO 랭킹, 랭킹 캐시 작업, 홈 대시보드 요약

## S4 티어·ELO 랭킹, 랭킹 캐시, 홈 대시보드, 시즌 종료 처리 — 2026-10-31 — 판정: pass (DB e2e·실제 docker build·실서버 미확인)

**구현:** core 16개 함수(`ranking.ts`, `season.ts`·`time.ts` 추가: 티어 점수, 랭킹 정렬, 소프트 리셋, 이월 판정, 종료 시즌 선택, 최종 순위, 뱃지, D-day). api `GET /rankings/tier`, `GET /rankings/elo`, `GET /dashboard/summary`, 프로필 `badges`·`scrim.ratings[].rank`, 오류 코드 추가 없음. `ranking_caches` 표 + 5분 작업(Redis 무관 한 경로, 빈 캐시 첫 요청 동기 계산, 실패 시 마지막 값 + stale, 공용 payload, 내 순위는 요청마다), 순위 변동 기준 = 이번 KST 주 시작 순위. 시즌 종료 작업(standings·뱃지·`closed_at` 한 트랜잭션, `ends_at` + 60초 이후, try lock + 유일 키로 멱등), 소프트 리셋은 새 시즌 첫 레이팅 행을 만들 때 승인 경로에서만 계산(종료 작업은 ratings를 쓰지 않음), 승인 7c단계 시즌 행 FOR SHARE. 마이그레이션 `20261030180000_s4`(`seasons.closed_at`, `ratings.carried_from_season_id`, `ranking_caches`), badges 시드, env 3개. web `/rankings`(티어·ELO, 게임·시즌 필터, 상위 3명, YOU 행, stale·최종 순위), 홈(다음 내전, 통계, 모집 중, TOP 5, 최근 결과), 사이드바·모바일 시즌 카드, 프로필 뱃지, 훅 3개, 목 백엔드.

**리더 직접 실행:** `-r typecheck` 4개 Done / 전체 테스트 2회 동일: shared 91·core 347·web 225·api 470 passed / 42 skipped(DB e2e) / `-r build` 4개 Done(exit 0). 이 PC는 Node 20.11이라 테스트는 저장소 `vitest.config.ts`가 아니라 같은 내용의 임시 `.mjs` 설정(저장소 밖)으로 실행. Node 22 실행 없음. 마이그레이션 = prisma migrate diff 출력(주석 제외) 일치 확인

**QA:** core pass(minor 3), backend fail(blocker 1, minor 3), web pass(minor 10), 교차 fail(blocker 1, minor 5) → r2 pass(minor 3, 계약 문서). 보고서 `_workspace/03_qa-verifier_{core,backend,web,s4,s4_r2}.md`

**결함 처리:**
- backend blocker: 마이그레이션 SQL에 prisma CLI 경고 두 줄이 섞임(`migrate deploy` 실패 → API 컨테이너 기동 불가) → 리더 수정, diff 일치 확인
- 교차 blocker: `apps/web/Dockerfile`이 `packages/core` 소스를 복사하지 않아 웹 이미지 빌드 실패(S3부터로 추정, S3 HEAD 직접 빌드는 안 함) → 리더 수정, COPY 재현 빌드 exit 0·대조군 exit 1(실제 docker build 아님)
- 기존 결함 발견: `ScheduleModule.forRoot()` 다중 호출로 cron 중복 등록(HEAD AppModule 8개, 기대 4). 공유 모듈 `common/shared-schedule.ts`로 수정, env 8조합 회귀 테스트. 등록 수 기준이며 S2·S3 배포의 실제 실행 횟수는 미측정. 그동안 동기화·자동 마감이 2번 돌았을 수 있음
- core minor 3, backend 테스트 2, web minor 10 + 교차 minor 4, softResetText → 수정. 계약 C1–C15·N1–N3 반영

**남은 결함:**
- 교차 5 / backend 4: 빈 캐시 첫 계산 실패 시 `/dashboard/summary` 전체 500(시즌 카드 포함), `games`가 비면 `top_rankers` null(Q8 결정 대기, 시드된 DB에서는 후자 없음)

**미실행·미확인:**
- DB e2e 42건(S4 신규 9건), `migrate deploy`, 실제 SQL 전부(`ON CONFLICT … WHERE`, `DISTINCT ON`, `FOR SHARE`, `FOR NO KEY UPDATE`), 잠금 대기·교착, 6-5 시나리오 3·5·6 동시 실행. QA의 embedded-postgres 설치는 권한 거부로 미실행(우회 안 함)
- 실제 `docker build`, Railway 로그, 실제 API + DB + 브라우저 연결(브라우저 확인은 목 모드만), 실제 cron 발화, 다른 탭 계정 전환 브라우저 실행

**사용자 결정:** 시즌 종료 처리(최종 순위, 뱃지, 소프트 리셋)를 S4에 포함

**확인 필요(계약 17절, 현재 추천안으로 구현):** Q1 신규 고티어 시드 > 기존 멤버 리셋 값, Q2 시즌 공백 허용, Q3 경계 대기 결과는 다음 시즌 반영, Q4 나간 멤버 랭킹·뱃지(`users.left_at`을 S5에), Q5 5경기 미만도 리셋, Q6 ELO 주간·월간 없음(시즌만), Q7 뱃지 1–3위(목업은 TOP 10), Q8 요약 부분 실패

**리더 결정·기본값:** slice.md 기본값 1–5, D140–D168(계약). 뱃지 월은 `earned_at − 1ms`의 KST 월(표시만). 대시보드 요약 500은 null 의미 결정이 필요해 이번에 수정 안 함

**명세 문서와 어긋난 부분(문서 갱신 필요):** `_workspace/03_qa-verifier_s4.md` 「명세 문서 갱신 필요 목록」 22건

**다음:** Docker 환경에서 DB e2e·마이그레이션 검증 후 S5 봇 API, 활동·플레이타임 랭킹, 스팀 플레이타임

## S4 후속 변경(사용자 요청) — 2026-10-31 — 판정: pass (DB e2e·실서버 미확인, 마지막 수정은 QA 재검증 대신 리더가 QA 스크립트로 확인)

**구현:** (1) 패배 배율: core `EloPolicy.lossRatio`·`applyLossRatio`, 음수 변동에만 반올림 전 적용, 개인 순위는 합산 변동의 부호 기준, env `SCRIM_ELO_LOSS_RATIO`(기본 0.5, 0–1), `rating_policy` 응답 2곳 확장, 이미 승인된 경기는 재계산 안 함. (2) 호칭: 화면의 오렌지팀 → 레드팀, ORANGE → RED, `--team-red`·`--team-red-ink` 토큰. DB enum·API 값 `orange`와 코드 식별자는 유지. (3) ⓘ: `InfoTip`·`EloInfo`·`lib/elo-info.ts`, 위치 `/rankings` ELO 탭·프로필 내전 레이팅 카드, 호버·포커스·탭·Esc, 숫자는 `/dashboard/summary`의 `rating_policy`, 값이 없으면 숫자 없는 문구. 홈 「반영 ±N」 → 「최대 N점 변동」(D179). 결정 D169–D181(계약 19절)

**리더 직접 실행:** `-r typecheck` 4개 Done(exit 0) / 전체 테스트 2회 동일: shared 92·core 366·web 242·api 488 passed / 42 skipped(DB e2e) / `-r build` exit 0. N1·N2 수정 뒤 web typecheck·test·build 재실행. 임시 vitest 설정(저장소 밖), Node 20.11. 첫 전체 실행에서 web은 임시 설정 로드 실패로 돌지 않았고, 설정을 고쳐 별도로 2회 실행

**브라우저(리더, 목 production, Chrome):** 마우스 호버·고정, 창 이탈·복귀, 키보드 6개 조건, 터치(390, 라이트) 정상, 콘솔 오류 0

**QA:** followup fail(major 2, minor 5) → r2 fail(major 1, minor 2) → 리더 수정, 재현 스크립트로 확인. 보고서 `_workspace/03_qa-verifier_s4_followup{,_r2}.md`

**결함 처리:** ⓘ 터치 영역 44px, 키보드로 넘치는 패널 읽기(D180), 패배 배율 0·1 문구(D181), 목 승패 집계, 내전 상세 390px 넘침(S3 기존 결함), 패널 안 마우스 클릭이 키보드 포커스로 처리되던 회귀, 창 이탈 시 패널 닫힘·포커스 유실, 문서 정정(설명서 전력 차 식 포함)

**남은 결함:** 극단 배율 표시(0.001 → 「0%만」 등, 기본 0.5에서는 안 나옴, 수정 안 함). Q8은 이전과 같음

**미실행·미확인:** S4 항목과 같음(DB e2e 42건, migrate deploy, 실제 SQL, docker build, 실제 API 연결). ratio 0·1 문구의 브라우저 표시, Safari·Firefox, 실제 터치 기기, 스크린 리더

**배포 순서:** 웹이 `loss_ratio`를 필수로 읽으므로 API를 먼저 배포한다. 새 웹 + 옛 API면 요약 parse 실패

**확인 필요:** Q9 패배 배율로 랭킹이 경기 수도 반영, Q10 ⓘ 이유 문구 「지는 부담을 줄여 내전에 편하게 참여하도록」. 시작 점수 전원 1000 안은 결정 대기(`_workspace/ELO_설명서.md` 9-1)
