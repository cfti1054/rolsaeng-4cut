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

## S4 후속 변경 2(사용자 결정) — 2026-10-31 — 판정: pass (DB e2e·실서버 미확인)

**사용자 결정:** ELO는 티어와 무관하게 전원 1000에서 시작하고 새 시즌마다 1000으로 완전 초기화(소프트 리셋 폐지). 팀 밸런스 실력값 = w × 내전 ELO + (1 − w) × 티어 환산값, w는 이번 시즌 경기 수에 따라 0에서 0.2까지 선형(10경기부터 20%, 티어 비중 최소 80%). 롤 1지망·2지망 기본값 = 라이엇 대표 계정 솔로 랭크 최근 20경기 주·보조 라인, 본인이 바꿀 수 있고 서버는 받은 값만 저장. Q11 운영 데이터 없음(재계산 안 함), Q12 「티어 환산값」, Q13 저장된 최근 20경기로 그대로 추천. 결정 D182–D195(계약 20절). Q1·Q5는 이 결정으로 닫힘.

**구현:** core `balanceEloWeight`·`computeSkill({ seasonGames })`, 소프트 리셋 함수 3개·상수 삭제. api 승인 9단계 새 행 = `RATING_START_ELO`, `rating-carry.ts` 삭제, `carried_from_season_id`는 컬럼만 유지(값 안 씀), env `SEASON_SOFT_RESET_RATIO` 삭제, `GET /me/position-suggestions`. web ⓘ·시즌 카드·랭킹·로그인 문구, 작성·참가 화면 추천 기본값, 목 `SEED_VERSION` 7. 스키마·마이그레이션 없음. 설명서 `_workspace/ELO_설명서.md` 갱신.

**리더 직접 실행:** `-r typecheck` 4개 Done / shared 99·core 355·web 254·api 498 passed / 42 skipped(DB e2e) / `-r build` exit 0. 임시 vitest 설정은 패키지 안에 두고 실행 후 삭제(Node 20.11, `/tmp` 설정은 패키지 vitest를 못 찾음). Node 22 실행 없음.

**QA:** core·api pass(결함 0, `_workspace/03_qa-verifier_s4_followup2_core_api.md`). web pass(minor 1, `_workspace/03_qa-verifier_s4_followup2_web.md`). 테스트에 남은 `SEASON_SOFT_RESET_RATIO` 문자열 2곳은 「env에 남아 있어도 기동」 테스트라 예외. web 브라우저(목, 다크·라이트 × 데스크톱·390px)에서 추천 채움·변경·참가 저장·시즌 카드·ⓘ 확인.

**남은 결함:** web minor 1 — 「건드린 뒤 늦게 온 추천이 선택을 덮지 않음」은 순수 함수 테스트만 있고 훅 순서 테스트는 없음(web에 React 테스트 환경 없음, 코드 경로상 안전, 수정 안 함). Q8은 이전과 같음.

**미실행·미확인:** DB e2e 42건, migrate deploy, 실제 docker build, 실제 API 연동, 추천 요청 실패·지연 응답의 브라우저 재현, 390px ⓘ.

**배포:** api와 web을 같은 커밋으로 함께(D195). 마이그레이션 없음. Railway의 `SEASON_SOFT_RESET_RATIO`는 지운다(남겨도 무시되지만 효과 없음).

**확인 필요:** 없음. Q9(패배 배율 0.5 유지, `SCRIM_ELO_LOSS_RATIO`로 조정)·Q10(ⓘ 문구 유지)은 2026-10-31 사용자 확정. 코드는 이미 추천안이라 변경 없음.

## S4 후속 변경 3(사용자 결정 Q2–Q8) — 2026-10-31 — 판정: pass (DB e2e·실서버 미확인, QA 서브에이전트는 사용량 한도로 미실행, 리더가 테스트·브라우저로 확인)

**결정:** Q2 시즌 공백 허용, Q3 경계 대기 결과는 다음 시즌, Q4 나간 멤버 제외는 S5의 `users.left_at`(지금은 구현 안 함), Q6 ELO는 시즌만, Q7 뱃지 1–3위. 모두 기존 코드 유지. Q8은 지금 구현(계약 21절, D196–D201).

**Q8 구현:** 요약 응답 `top_rankers_state`. 시즌 없음 `no_season` 「아직 시즌이 없어요」, games 없음·첫 계산 실패 `unavailable` 「순위를 불러오지 못했어요」(요약은 200, 모집·통계·시즌 카드 유지). 한 게임 계산 실패는 앞의 빈 블록으로 대체하지 않음. `GET /rankings/*` 500은 그대로. `me`는 캐시만 읽으므로 감싸지 않음. 목 시나리오 `top_unavailable`.

**리더 직접 실행:** `-r typecheck` 통과. shared 105·api 501 passed / 42 skipped·web 256 passed. 목 모드 브라우저: 기본 홈 TOP 5, `top_unavailable`에서 순위 문구만 바뀌고 모집·결과는 유지·ELO는 보이고 순위 번호는 없음, `no_season`에서 「아직 시즌이 없어요」와 사이드바 「다음 시즌 준비 중」.

**배포:** api·web 같은 커밋(D200). 마이그레이션 없음.

**다음:** Docker에서 DB e2e 후 S5 봇 API, 활동·플레이타임 랭킹, 스팀 플레이타임. S5에 Q4 `users.left_at` 포함.

## S5 봇 API, 활동·플레이타임 랭킹, 스팀 플레이타임, 디스코드 연동 — 2026-10-31 — 판정: pass (DB e2e·실서버·실제 디스코드/스팀 미확인)

**구현:** 계약 `_workspace/01_architect_contract.md`(D202–D231, 오류 코드 6개 추가로 49개, 봇 scope 2개 추가). 엔드포인트 11개: 웹 4(`GET /rankings/activity`, `GET /rankings/playtime`, `GET /me/discord-link`, `POST /me/discord-link/code`), 봇 7(문서 6장 5개 + `POST /bot/member-events`, `PUT /bot/presence`). `X-API-Key` 가드(해시만 보관, scope, `last_used_at` 60초 간격). 연동 코드 15분·사용자당 1개. 미연동 이벤트는 저장 안 함(`unlinked`). 활동 랭킹 = voice+play 합계(chat은 0초, 활동 일수에만). 활동·플레이타임은 기존 `ranking_caches` 5분 캐시 재사용. `users.left_at`(탈퇴 멤버를 순위·뱃지에서 제외, 로그인 시 복구, 퇴장 시 리프레시 토큰 폐기). 홈 요약에 필수 블록 `community`(음성·활동 멤버·지금 플레이 중). core 함수 13개(`activity.ts`, `time.ts`). API 키 CLI `apps/api/scripts/api-key.ts`(create·list·revoke). 스팀 05:00 KST 배치는 코드 변경 없이 fixture 테스트만 추가. 마이그레이션 `20261031120000_s5`. web: `/rankings` 활동·플레이타임 탭, 설정 디스코드 연동 5상태, 홈 community 카드, 목 시나리오 `gcd-mock-bot`·`gcd-mock-discord`.

**리더 직접 실행:** `-r typecheck` 4개 Done / shared 138·core 415·web 303·api 588 passed, 48 skipped(DB e2e) / `-r build` 4개 Done. 임시 vitest 설정(패키지 안, 실행 후 삭제), Node 20.11. `apps/web/.next`에 " 2" 중복 파일이 생겨 web typecheck가 깨져서 `.next`(gitignore 대상)를 지우고 다시 만듦.

**QA:** core pass(minor 2) / backend pass(minor 6) / web pass(minor 3 + 범위 밖 1). 보고서 `_workspace/03_qa-verifier_s5_{core,backend,web}.md`. 중간에 사용량 한도로 backend·web QA가 한 번 멈췄고 한도 해제 후 이어서 완료.

**결함 처리:** core `presenceState` TOO_OLD 상수 출처(`BOT_PRESENCE_STALE_AFTER_SEC`) 수정. API 키 `last_used_at` 60초 경계(`lt` → `lte`) 수정. web minor 3건(409 뒤 오류 문구, `/steam-apps` 실패·로딩 중 플레이타임 탭, 모바일 「—」 줄) frontend 수정. 수정 뒤 QA 재검증은 하지 않고 리더가 테스트·빌드로 확인.

**남은 결함 (수정 안 함):**
- backend minor: 로그인 복구가 조건 없이 update해 밀리초 창에서 늦은 퇴장을 덮을 수 있음. scope 메타 없는 핸들러 403 경로 테스트 없음. 「봇 연결」 판정이 `ranking-calculator.service.ts`와 `dashboard.service.ts`에 중복.
- core minor: `nowPlayingItems`에서 인원수·이름이 같은 행의 순서가 입력 순서에 의존(3단계 정렬 키는 architect 결정 필요).
- 계약 쪽: `/steam-apps` 기본 게임이 순위가 빈 게임일 수 있음(`steam_playtime` 전체를 세지만 랭킹은 대표·verified·0분·탈퇴를 뺌). 보유자 0인 app_id는 캐시가 없어 요청마다 SQL 1회(D217 「5분에 최대 1번」과 어긋남).
- 범위 밖 기존 결함: `['me', …]` 쿼리 키 3개가 사용자 전환 때 지워지지 않음(`game-accounts.ts:36`, `scrims.ts:59–60`).

**미실행·미확인:** DB e2e 48건(S5 신규 6건 포함), `migrate deploy`, 실제 SQL(`AT TIME ZONE`, `ON CONFLICT`, advisory lock, 집계 `SUM`), 잠금 순서 동시 실행, API 키 CLI의 DB 쓰기, 실제 디스코드 봇·스팀 키 연동(키 필요), 실제 docker build, 실서버 브라우저 연결. web 브라우저 확인은 목 모드뿐.

**명세 문서와 어긋난 부분(문서 갱신 필요):** 문서에 없는 `POST /bot/member-events`, `PUT /bot/presence`, `bot_presence` 표, `discord_link_codes` 표, `users.left_at`·`guild_membership_at`, `activity_logs.api_key_id`. 계약 5-4 잠금 순서와 2절 NOT_FOUND 행 문구는 구현(발급·연결 모두 advisory lock 먼저)에 맞춰 architect가 고쳐야 함.

**리더 결정·기본값:** 확인 필요 Q1–Q13 전부 architect 추천안으로 구현. 주 게임 이름은 목업의 짧은 이름(「롤 협곡 · 롤체」).

**배포:** api·web 같은 커밋(홈 요약 `community`가 필수 필드). 마이그레이션 있음(`migrate deploy`). 봇 키는 `pnpm --filter api api-key create`로 발급(시드 아님). 새 환경 변수 없음.

**확인 필요(사용자):** Q1 연동 코드는 `discord_id`가 없거나 개발용(`dev-`) 회원만 사용 가능, Q2 만료 15분(목업은 10분), Q3 활동 시간 voice+play(목업은 음성만), Q7 문서에 없는 엔드포인트·표 추가, Q10 스팀이 비공개로 바뀌어도 마지막 성공값으로 순위에 남음. 위 계약 쪽 결함 2건을 S5에서 고칠지 여부.

**다음:** S6 관리자 도구(API 키 관리 화면 포함), 패치노트·이벤트. 그 전에 Docker 환경에서 DB e2e와 `migrate deploy` 검증 권장.

## S5 수정(사용자 결정 + 계약 결함) — 2026-10-31 — 판정: pass (DB e2e·실서버·실제 디스코드/스팀 미확인)

**작업 위치 변경:** 저장소가 iCloud 동기화 폴더에서 파일을 비워(dataless) git·typecheck가 깨졌다. iCloud 밖 새 clone(`~/Documents/GitHub/rolsaeng-4cut`)으로 변경분 101건(수정 53, 새 파일 37, 삭제 11)을 옮기고 `pnpm install` 후 이어서 작업했다. 이전 iCloud 폴더는 그대로 두었다.

**사용자 결정:** (1) 활동 랭킹에서 play 제거(음성만). play 이벤트는 계속 받아 저장하되 랭킹에 쓰지 않는다. (2) 디스코드 연동 코드 기능 제거: 로그인이 디스코드라 가입 시점에 자동 연동. (3) 활동 랭킹 정렬은 음성 시간, 내전 참여 횟수는 참고 열(`scrim_count`). (4) 계약 결함은 S5에서 바로 수정.

**구현(D232–D239):** 
- 활동 랭킹 voice만(`ACTIVITY_RANKED_TYPES=['voice']`, `play_sec` 제거, `total_sec = voice_sec`), `active_days`는 모든 type. 
- 연동 코드 제거: `POST /me/discord-link/code`, `GET /me/discord-link`(→ 기존 `GET /me`), `POST /bot/link`, `discord_link_codes` 표, 오류 코드 4개, `modules/discord-link/`. 엔드포인트 11 → 8(웹 2 + 봇 6), 오류 코드 추가 6 → 2(전체 45), scope 7 → 6. 설정 화면은 「연동됨 / 미연동」 두 상태. 
- `scrim_count`: 같은 KST 기간에 시작한 내전 중 참가 확정(joined) + 결과 approved + 취소 아님, 기간 기준 `COALESCE(started_at, scheduled_at)`. 정렬·`total_sec`에 영향 없음, 5분 캐시 payload에 포함. 화면 SCRIMS 열, 모바일 보조 줄, 봇 detail 「· 내전 N회」. 
- 플레이타임 보유자 정의 하나(대표 verified 스팀 계정, `minutes_total>0`, 탈퇴 제외)를 랭킹 행·미리 갱신 상위 50·`/steam-apps`가 함께 쓴다(`playtime-holders.ts`). 웹 기본 게임 `pickDefaultPlaytimeAppId`. 
- 보유자 0명 app도 빈 결과를 캐시에 저장(`synced_at` non-null). 
- 마이그레이션 `20261031120000_s5`를 다시 만듦(`discord_link_codes` 없음, DROP 없음, migrate diff와 일치). 이전 버전을 로컬 DB에 적용한 개발자는 reset 필요.

**리더 직접 실행(새 clone):** `-r typecheck` 4개 Done / shared 134·core 416·web 300·api 582 passed / 47 skipped(DB e2e) / `-r build` 4개 Done. 임시 vitest 설정(패키지 안, 실행 후 삭제), Node 20.11.

**QA:** `_workspace/03_qa-verifier_s5_r2.md` pass(blocker·major 0, minor 4). 연동 코드 잔재, 엔드포인트 8개 일대일, 음성만 집계, `scrim_count`·보유자 SQL 눈 점검, 웹 표·모바일 보조 줄, 마이그레이션 diff 재확인.

**결함 처리:** minor 3건(낡은 주석 `voice + play`, 주석의 r1→r2 표기 2곳, 계약 6-1의 `lt`→`lte`) 리더 수정. 설정 미연동 상태의 머리 설명은 「음성 접속 시간이 활동 랭킹에 쌓이고…」 그대로 둠: 같은 안내(「디스코드로 로그인하면 자동으로 연동돼요.」)가 본문 안내 상자에 있어서 중복을 피한 것이며, 계약 10절 문구와 다르다.

**남은 결함(이번 범위 밖, 수정 안 함):**
- backend: 로그인 `guildMembershipAt` 갱신이 원자적이지 않음, scope 메타데이터 없는 핸들러 거부 테스트 없음, 「봇 연결」 판정이 두 곳에 중복
- web: 사용자 전환 때 `['me', …]` 쿼리 3개가 지워지지 않음(`game-accounts.ts`, `scrims.ts`)
- core: `nowPlayingItems`에서 인원수·이름이 같은 행의 순서가 입력 순서에 의존

**미실행·미확인:** DB e2e 47건(S5 신규 포함), `migrate deploy`, 새 원시 SQL(`ARRAY_AGG … FILTER`, `ILIKE`, `scrim_count` 집계, advisory lock), API 키 CLI의 DB 쓰기, 실제 디스코드 봇·스팀 키 연동(키 필요), 실제 docker build, 실서버 브라우저 연결. 브라우저 확인은 목 모드뿐.

**명세 문서 갱신 필요:** `POST /bot/member-events`, `PUT /bot/presence`, `bot_presence` 표, `users.left_at`·`guild_membership_at`, `activity_logs.api_key_id`가 문서에 없다. 문서 127·151줄의 `/bot/link`와 일회용 연동 코드 흐름은 제거됨(디스코드 로그인 시 자동 연동).

**배포:** api·web 같은 커밋(홈 요약 `community` 필수). 마이그레이션 있음. 봇 키는 `pnpm --filter api api-key create`로 발급. 새 환경 변수 없음.

**확인 필요(사용자):** Q10 스팀이 비공개로 바뀌어도 마지막 성공값으로 순위에 남음, Q14 홈 `active_members`가 play까지 셈, Q15 `active_days`에 play·chat만 한 날도 포함, Q16 내전 작성 화면의 스팀 게임 목록이 보유자 기준으로 좁아짐, Q17 봇 detail 내전 수에 친선 내전도 포함.

**다음:** Docker 환경에서 DB e2e와 `migrate deploy` 검증 후 S6 관리자 도구(API 키 관리 화면 포함), 패치노트·이벤트.

## S5 후속: play를 모든 활동 집계에서 제외(D240) — 2026-10-31 — 판정: pass (QA 서브에이전트 재검증은 하지 않음, 리더가 테스트·빌드로 확인. DB e2e 미확인)

**사용자 결정:** `play`는 「같은 채팅방 사람들과 한 게임」이라는 보장이 없어 활동 집계에서 완전히 제외한다. play 이벤트는 계속 받아 저장만 한다(수신 거부 변경 없음).

**구현:** shared `ACTIVITY_COUNTED_TYPES = ['voice','chat']`(`ACTIVITY_RANKED_TYPES`는 voice). 활동 랭킹 `active_days`와 홈 `community.active_members` SQL이 이 상수를 바인딩해 voice·chat만 센다(SQL에 type 리터럴 없음). 「봇 연결」 판정은 type과 무관하게 모든 기록으로 유지(play만 와도 봇은 연결된 것). `now_playing`(봇 접속 현황의 「지금 플레이 중」)은 별개라 변경 없음. 웹 목 백엔드도 같은 규칙. 계약 D233 일수 부분 철회, D240 추가, Q14·Q15 닫음. 마이그레이션 없음.

**리더 직접 실행:** `-r typecheck` 4개 Done / shared 134·core 416·web 304·api 583 passed / 47 skipped(DB e2e) / `-r build` 4개 Done. 임시 vitest 설정은 실행 후 삭제.

**영향:** play만 한 날은 활동 일수에서 빠지고(예: 봇 detail 「7일 중 2일 활동」 → 1일), play만 한 회원은 홈 활동 멤버 수에 안 들어간다. 채팅만 한 회원은 활동으로 세지만 음성이 0이면 랭킹 순위에는 없다. play 기록만 있는 서버는 홈 「활동 멤버 0명」, 랭킹 「봇 연결됨·순위 없음」.

**미실행·미확인:** `test/db/bot.db.e2e.spec.ts`(play만 한 날·회원 검사 포함, 작성만), active_members SQL은 FakePrisma로만 확인.

## S2·S3 후속: 내전 삭제, 롤체 모드, 스팀 밸런스 — 2026-10-31 — 판정: 구현 완료 (QA 서브에이전트 미실행, DB e2e 미확인)

**사용자 요청:** 생성한 내전 카드 삭제(운영진만, 일반 회원 화면에는 버튼 없음). 롤체는 더블업 / 일반 / 랭크(최대 3인). 더블업만 2명씩 팀 밸런스. 일반·랭크와 스팀은 팀 밸런스 없이 인원 모집.

**구현:** `DELETE /scrims/:id`는 `@Roles('admin')`이라 비운영진 403(없는 내전도 403). 승인된 결과가 있으면 409 `SCRIM_DELETE_NOT_ALLOWED`. 그 외는 행 삭제(목록에서 카드 사라짐). `can_delete`가 true일 때만 목록·상세에 삭제 버튼. 롤체 `tft_mode` 필수(작성 후 변경 없음). 정원: 더블업 2–8 짝수(기본 8), 일반 2–8(기본 8), 랭크 2–3(기본 3). `POST /scrims/:id/duos`가 강한 사람과 약한 사람을 2인 페어로 저장(`duo_index`). 스팀·롤체 일반·랭크는 요청과 관계없이 `auto_balance` false. 스팀 `has_teams`는 그대로라 수동 팀 지정·팀 승패 결과 입력은 남는다. 마이그레이션 `20261031200000_scrim_delete_tft_mode`(로컬 DB 미적용).

**리더 직접 실행:** `-r typecheck` 통과(shared·core·web·api). shared 134·core 417·web 304·api 583 passed / 47 skipped(DB e2e). 임시 vitest 설정은 실행 후 삭제. 이 숫자는 아래 「스팀 모집·메뉴명」 반영 전이다.

## S2·S3 후속: 더블업 ELO 비중, 스팀 모집, 메뉴명 — 2026-10-31 — 판정: 구현 완료 (QA 서브에이전트 미실행, DB e2e 미확인)

**사용자 요청:** 더블업 팀 나누기는 롤 내전과 같이 티어 중심이고, 10판부터 ELO를 최대 20% 반영. 스팀 인원 모집에서 수동 팀 지정과 팀 승패 입력을 뺀다. 메뉴 「내전」을 「내전/모집」으로.

**구현:** 더블업 실력값은 기존 `computeSkill`(0경기 0%, 10경기 20%까지 선형). 짝 짓기는 강한 사람+약한 사람. 화면 문구에 그 규칙을 적음. 스팀은 `has_teams`·`has_results` false. 작성 시 `rated`도 false. 팀 패널·승패 입력·ELO 토글을 숨기고, 결과 자리는 「승패를 입력하지 않아요」. 이미 저장된 팀 승패는 그대로 표시. 사이드바·하단 탭·목록 제목은 「내전/모집」. 마이그레이션 `20261031210000_steam_recruit_no_results`(로컬 DB 미적용).

**리더 직접 실행:** typecheck 통과(shared·core·web·api). shared 135·core 418·web 305·api 583 passed / 47 skipped(DB e2e). 임시 vitest 설정은 실행 후 삭제. 브라우저에서 메뉴명, 스팀 작성(밸런스·ELO 없음), 스팀 상세(팀 패널·승패 입력 없음), 더블업 문구를 확인.

**다음:** Docker 환경에서 DB e2e와 `migrate deploy` 검증 후 S6 관리자 도구(API 키 관리 화면 포함), 패치노트·이벤트. 확인 필요 Q10·Q16·Q17은 그대로.

## S2·S3 후속: 카드·레이팅 문구, 링크 복사 — 2026-10-31 — 판정: 구현 완료 (QA 서브에이전트 미실행)

**사용자 요청:** 카드와 레이팅 문구도 「내전/모집」. 링크 복사는 게임 아이콘과 날짜·시간·인원·상태·참여 링크가 줄로 나뉜 형식.

**구현:** 홈·목록·프로필·랭킹·ELO 설명의 기능 이름을 「내전/모집」으로 바꿈. 시드 제목, 활동 「내전 N회」, 「내전 시작」 버튼은 그대로. 공유 문구는 롤 ⚔️, 롤체 ♟️, 스팀 🕹️ 제목, 모집글 제목, 날짜, 시작 시각, 인원, 상태, 「내전 참여하기」, 주소.

**리더 직접 실행:** web typecheck 통과. web 305 passed. 브라우저에서 홈 통계, 프로필 레이팅, 랭킹 탭, 롤·롤체 더블업·스팀 링크 복사를 확인.

## S6 관리자 도구, 패치노트·이벤트 — 2026-11-01 — 판정: pass (DB e2e·실서버·실제 디스코드 미확인)

**구현(계약 D241–D280, `_workspace/S6/01_architect_contract.md`):** 
- 엔드포인트 35개(멤버 6·운영진 25·봇 4), 오류 코드 11개 추가(전체 57), 봇 scope `bot:notices`·`bot:patch-notes`. 마이그레이션 `20261031230000_s6`: `scrim_results.reverted_by·reverted_at·revert_reason`, 결과 상태 `reverted`, 새 표 `patch_notes`·`events`(모델 `CalendarEvent`)·`admin_audit_logs`. 
- 승인 되돌리기(D242–D248): 승인 후 7일 안, 제출자 아님(승인자 본인은 가능), 시즌 `closed_at` 비어 있음, 참가자 전원에게 이 결과가 같은 게임의 마지막 이력, 현재 ratings가 이력과 일치할 때만. 잠금 순서는 승인과 같다(내전→사용자→시즌 FOR SHARE). 이후 경기 재계산(replay)과 종료 처리된 시즌은 제외 확정. 결과 `approved→reverted`, 내전 `finished→playing`, 열린 이의 제기 자동 처리, 감사 로그에 삭제 이력 스냅샷. 
- 이의 제기: 참가자(방장·확정·노쇼), 승인 대기 중 언제든·승인 뒤 3일. 
- 시즌 관리: 시작 전 시즌은 기간 변경·삭제, 진행 중은 끝 시각만 now+1시간 이후, 끝난 시즌 불가, 겹침 금지. lead 검사는 생성·upcoming의 `starts_at` 변경 때만. 
- 운영진: JwtGuard가 role을 DB에서 읽음(D263, 강등 즉시 반영), `ADMIN_DISCORD_IDS` 회원 강등 불가, 자기 역할 변경 불가. 
- 공지·패치노트·이벤트 CRUD와 공개 조회, 봇 알림 전송 4개(멱등), API 키 웹 발급·폐기, 멤버 관리, 감사 로그, 통계, 홈 `news` 블록. 
- core 함수 14개(`result-review.ts`, `season.ts`, `admin.ts`, `no-show.ts`, `news.ts`). 
- web: `/admin` 탭 6개(결과·노쇼/멤버/공지·소식/시즌/API 키/감사 로그), `/news`(공지·패치노트·이벤트 캘린더), 홈 「패치·이벤트」 카드·상단 공지 줄, 설정 알림 토글 2개, 내전 상세의 되돌림·이의 제기, 사이드바 「정보」, 모바일 머리 아이콘(정보·운영진 관리자), 공용 Button에 `size="sm"|"custom"`·`variant="plain"` 추가, 목 시나리오 `gcd-mock-admin`.

**리더 직접 실행(Node 24, 저장소 vitest 설정 그대로):** `-r typecheck` 4개 Done / shared 160·core 509·web 344·api 644 passed / 52 skipped(DB e2e) / `-r build` 4개 Done / `pnpm audit` 취약점 0.

**QA:** core pass(0) → backend pass(minor 3) → web pass(minor 8). 보고서 `_workspace/S6/03_qa-verifier_s6_{core,backend,web}.md`. core 검증은 독립 프로브 32개(되돌리기 왕복: 팀·개인·노쇼·동순위·K 판정 경계, KST 경계).

**결함 처리:** backend minor 3건(시즌 쓰기 트랜잭션 timeout 명시, 이의 제기 전이 검사, PATCH `updated_at` APP_CLOCK), web minor 8건(되돌리기 오류 문구 B안, 상세 되돌리기 403 시 `['me']` 재조회와 네트워크 오류 문구, 관리 탭 이벤트 구간 이동, 조사 오류, 홈 이벤트 링크 month, API 키 원문 reset, 안 쓰는 훅 정리와 이벤트 페이지 이어 받기)을 구현자가 수정. 수정 뒤 QA 재검증은 하지 않고 리더가 테스트·빌드로 확인. 계약 11-2(시즌 lead)와 13절(`/news?tab=`) 문구를 구현에 맞춤.

**남은 결함(수정 안 함):** 멤버 표 NO-SHOW 열의 기간은 `/me/scrim-restriction` 정책을 빌려 쓴다(목록 응답에 `policy`를 넣는 안은 낮은 우선순위로 보류). 목업의 큐 행 「블루 +15 ~ +19」 ELO 범위는 필드가 없어 그리지 않음. 되돌리기 막힘 이유는 오류 `details`가 아니라 다시 읽은 `revert_blocked_reason`으로 표시(B안). 이벤트 이어 받기(다음 페이지) 경로는 목 데이터가 100건 안이라 코드로만 확인. 「멤버로 변경」 방향 문구는 브라우저 미확인.

**미실행·미확인:** DB e2e 52건(S6 신규 `test/db/admin.db.e2e.spec.ts` 5건 포함), `migrate deploy`(특히 `ALTER TYPE ADD VALUE`), 새 원시 SQL 2개·`groupBy`·`aggregate`의 실제 PostgreSQL 실행, 되돌리기와 다른 내전 승인의 동시 경합, 시즌 FOR NO KEY UPDATE 대 승인 FOR SHARE, 실제 디스코드 봇의 공지 전송, 실서버 브라우저 연결. web 클릭 흐름은 목 모드 데스크톱 다크 위주.

**명세 문서 갱신 필요:** `POST /scrims/:id/result/revert`·이의 제기, `/notices`·`/patch-notes`·`/events` 관리 API, `/bot/notices`·`/bot/patch-notes`, `/admin/*` API, 새 표 3개, `reverted` 상태가 문서에 없다. 계약 21절 끝 목록 참고.

**배포:** api·web 같은 커밋(홈 요약 `news`와 내전 상세 새 필드가 필수). 마이그레이션 있음(`migrate deploy`, enum 값 추가 포함). 새 환경 변수 없음. 운영진은 `ADMIN_DISCORD_IDS` 또는 웹의 역할 변경.

**확인 필요(사용자):** Q1 되돌리기 범위(이후 경기 반영되면 불가), Q2·Q3 기한(되돌리기 7일, 이의 제기 3일), Q7 진행 중 시즌 끝 시각 변경 허용, Q10 봇이 72시간 넘게 꺼져 있으면 그사이 공지·패치 알림은 보내지 않음, Q17 목업 「7일간 참가 제한」과 서버 기본 1일 불일치(화면은 서버 정책값). 나머지 Q4–Q6·Q8–Q9·Q11–Q16·Q18은 추천안.

**다음:** Docker 환경에서 DB e2e와 `migrate deploy` 검증. 이후 스팀 할인·공통 보유 게임(데이터 출처 결정 필요), 업적·토너먼트(P2), 회원 차단·삭제(필요 시).

## S6 후속: 이의 제기 제거, 커뮤니티 캘린더, 일정 시각, 다가오는 일정 — 2026-11-01 — 판정: pass (DB e2e·실서버 미확인)

**사용자 결정:** (1) 결과 「이의 제기」 기능 제거(D281). (2) 관리자 통계 4번째 칸 자리에 「다가오는 일정」 목록, 아래에 편집용 전체 폭 캘린더(운영진만 일정 추가), 홈은 읽기 전용 캘린더(D282–D297, D306–D310). (3) 운영진 일정에 시작·종료 시각(종일은 비움)(D298–D305). (4) Q17 노쇼 참가 제한은 서버 기본 1일이라 변경 없음. Q23·Q24·Q25 확인(변경 없음).

**구현:** 
- 이의 제기 제거: 제출·운영진 처리 API, 오류 코드 3개, 승인 큐 「이의 제기」 보기, viewer 필드, 되돌리기·반려의 자동 처리, core `disputeBlock`, web UI·훅·목을 코드에서 삭제. DB의 `scrim_result_disputes` 표와 `dispute_status` enum은 S0부터 있던 것이라 남김(DROP 없음, 사용 안 함). 엔드포인트 35 → 32 → 33(`GET /calendar` 추가).
- 캘린더: `GET /calendar?month=&game=`(로그인 회원, 내전+운영진 일정을 KST 월요일 시작 격자로 합쳐 줌, 취소 내전 제외, 내전 300·일정 100건 한도와 `truncated`, 방장·참가자 명단 비노출). 일정 쓰기는 기존 `/admin/events` 재사용. core `calendarMonthRange`·`resolveCalendarMonth`(`/news` 격자와 2000–2099 1200개 달에서 일치). web `CommunityCalendar`(read/admin 모드, 모바일 목록형), 홈 전체 폭 읽기 전용, `/admin`은 통계 카드 아래 편집용.
- 일정 시각: 마이그레이션 `20261101120000_s6_event_times`(`events.start_time`·`end_time` time(0) nullable, DROP 없음). KST 벽시계 값을 변환 없이 저장. 검증: 기간 → 종료 시각만 불가 → 같은 날 종료<시작 불가(같은 시각 허용), PATCH는 저장값과 합쳐 같은 함수로 재검사, `start_time:null`이면 `end_time:null`도 함께. 정렬 `starts_on, start_time NULLS FIRST, ends_on, id`가 `/events`·`/calendar`·홈 news·upcoming에 같은 `EVENT_ORDER_BY`. `/events` 커서는 `events2` 접두사(4값, null 포함), 구 커서는 400. 
- 다가오는 일정: `AdminOverview.upcoming`(오늘 KST부터 30일, 최대 5건, `has_more`, 취소·이미 시작한 내전 제외, 진행 중 여러 날 일정 포함, 같은 순간이면 일정 먼저). core `compareEventSchedule`·`eventStartsAt`·`upcomingWindow`·`mergeUpcomingItems`.
- 응답 시각 필드를 1단계 optional에서 필수(nullable)로 전환(D305 2단계 완료).

**리더 직접 실행(Node 24, 저장소 vitest 설정 그대로):** `-r typecheck` 4개 Done / shared 195·core 542·web 383·api 664 passed / 52 skipped(DB e2e) / `-r build` 4개 Done / `pnpm audit` 취약점 0.

**QA:** backend pass(minor 2), web pass(minor 4). 보고서 `_workspace/S6/03_qa-verifier_s6_calendar_{backend,web}.md`. 독립 프로브: events2 커서 무작위 60행 누락·중복 없음, 다른 목록 커서 null 거부, 목 응답의 shared 스키마 parse 8개.

**결함 처리:** backend minor 2건(이벤트 PATCH 동시 수정: 조건부 `updateMany`+재검사, 3회 실패 시 500; 커서 날짜를 `IsoDate`로 검증), web minor 4건(내전 링크 이름 반복, 시각 오류 문구 해요체 매핑, 이의 제기 주석, 노쇼 저장 뒤 캘린더 무효화)을 구현자가 수정. 2단계 필수 전환과 계약 정리(D311–D315)는 architect. 수정 뒤 QA 재검증은 하지 않고 리더가 테스트·빌드로 확인.

**남은 결함(수정 안 함):** 홈 캘린더가 홈 요약 응답이 실패하면 같이 안 그려짐(Q30, 변경 없음으로 남김). 이벤트 PATCH가 같은 일정을 세 번 연속 동시에 고치면 409가 아니라 500(계약에 코드 없음). 구현자 브라우저 확인은 있으나 web QA는 브라우저 확인을 하지 않음.

**미실행·미확인:** DB e2e 52건, `migrate deploy`(특히 새 마이그레이션 2개: `ALTER TYPE ADD VALUE`와 time 컬럼 추가), 실제 PostgreSQL에서 `NULLS FIRST`·`time(0)` 비교·왕복·조건부 UPDATE의 잠금 대기 후 0행 동작, 실제 디스코드 봇, 실서버 브라우저 연결.

**명세 문서 갱신 필요:** `GET /calendar`, `AdminOverview.upcoming`, `events` 시각 컬럼, `/admin` 4칸·캘린더 화면 등(계약 21절 끝 목록).

**배포:** api·web 같은 커밋. 마이그레이션 2개(`20261031230000_s6`, `20261101120000_s6_event_times`). 새 환경 변수 없음. Railway는 `RAILWAY_DOCKERFILE_PATH`(서비스별)로 Dockerfile 빌드를 쓰는지 확인(Node 22.23.4 고정은 Dockerfile 빌드에서만 적용).

**확인 필요(사용자):** Q26 「4번째 칸=목록, 아래 전체 폭=편집 캘린더」 두 개를 두는 해석, Q27 30일·5건 기준, Q28 날짜 상세는 「일정 → 내전」 순서, Q29 오늘 끝난 시각 일정도 오늘 자정까지 표시. 이전 Q1·Q2·Q3·Q7·Q10 추천안은 그대로.

## S6 후속: 패치노트 자동 등록 — 2026-11-01 — 판정: 구현 (테스트·마이그레이션 미실행)

**사용자 결정:** 롤·롤체만. 제목은 `패치노트`, 버전은 `26.22`처럼 앞 두 자리만. 요약은 `공식 패치노트가 올라왔습니다.` 공식 글 주소는 그 번호로 만든다. 같은 번호의 핫픽스는 새 글이 아니다. 스팀은 넣지 않는다. 운영진은 그 글을 수정·삭제할 수 있다.

**구현(계약 24절, `_workspace/S6/01_architect_contract.md`):** Data Dragon 버전(`16.21.1`)은 공개 패치 번호(`26.21`)와 달라 쓰지 않는다. 한국어 패치노트 목록 페이지에서 슬러그만 읽는다. 글 본문은 복사하지 않는다. 그 게임에 해석되는 버전이 없으면 현재 패치 1건을 알림 없이 저장한다. 더 새 번호면 `notify_discord` true라 기존 봇 전송이 이어진다. `auto_registered` 컬럼(마이그레이션 `20261101180000_patch_note_auto`). 관리자 목록 부제에 `자동 등록`. 매일 KST 06:10과 서버 시작 시 1회(`SYNC_JOBS_ENABLED`).

**미실행:** 이 환경은 Node 16이라 `pnpm`·vitest·`prisma generate`를 돌리지 못했다. 의존성 설치 후 core `patch-note-sync` 테스트와 api `patch-note-sync.spec.ts`, `migrate deploy`가 필요하다.

## 후속: 본인 닉네임 수정, 내전/모집 「기타」 — 2026-11-02 — 판정: 구현 (QA 서브에이전트·DB e2e 미실행)

**사용자 요청:** 본인 프로필에서 이름을 수정. 내전/모집 작성에 「기타」를 넣어 마인크래프트·오버워치처럼 스팀에 없는 게임을 모집. 기타는 팀 밸런스 없음.

**결정:** `_workspace/00_input/slice-nickname-other.md`, 계약 `_workspace/nickname-other/01_architect_contract.md`. architect는 사용량 한도로 실패해 리더가 계약을 적음(`_workspace/blocked.md`).

**구현:** `PATCH /me`는 그대로 두고 본인 프로필에만 「이름 수정」. `GameCode` `other`, `scrims.custom_game_name`(1–40). 정원 2–16 기본 8. 포지션·팀·승패·자동 밸런스·ELO 없음. 계정 연동·티어·ELO·플레이타임 랭킹은 `other`를 받지 않음. 마이그레이션 `20261102120000_scrim_other_game`.

**리더 직접 실행:** shared 계약 테스트 107 passed. web 목 내전 테스트 24 passed(게임 목록에 other 포함). `prisma generate` 성공. 브라우저(목, 개발 로그인): 본인 프로필에서 `nick_edit` → `닉수정` 저장 후 사이드바 반영, 다른 멤버(정글차이) 프로필에는 수정 버튼 없음. 작성 화면에서 기타 선택 시 게임 이름·「인원만 모아요」·ELO 미반영, 팀 밸런스 스위치 없음. 제출 후 상세에 OTHER·마인크래프트, 목록 카드 1/8·ELO 미반영, 필터에 기타. 모집 중 수정에서 게임 이름을 오버워치로 바꾸면 상세 칩이 바로 바뀜.

**미실행:** QA 서브에이전트, DB e2e, `migrate deploy`. 전체 typecheck는 이 변경 이전부터 실패하는 파일이 있어 이번 판정에 넣지 않음.

## 후속: 작성 문구, 롤 맵(협곡·칼바람) — 2026-11-02 — 판정: 구현 (QA·DB e2e 미실행)

**사용자 요청:** 기타 게임 이름 자리표시를 「마인크래프트, 오버워치 등」, 제목 자리표시를 「예: 인원 모집」. 롤 작성에서 협곡·칼바람 선택.

**기본값:** 맵을 안 보내면 협곡. 칼바람은 포지션을 받지 않고 팀 밸런스·ELO는 유지. 작성 후 맵은 바꾸지 않음(수정 창은 표시만). 예전 롤 글의 `lol_map`은 null이고 화면은 협곡. 게임 타일 이름은 「롤」(맵 이름은 따로). 마이그레이션 `20261102140000_scrim_lol_map`.

**확인:** shared 계약 25, web 목·공유·랭킹 표시 89 passed. 브라우저에서 칼바람 선택 시 포지션 스위치가 꺼지고, 기타 자리표시 두 칸을 확인.

## 후속: 롤 정원 2–10, 내전·인원 모집 — 2026-11-02 — 판정: 구현 (QA·DB e2e 미실행)

**사용자 요청:** 협곡·칼바람 정원을 2–10명, 홀수·짝수 모두. 맵 아래에서 내전 또는 인원 모집(파티)을 고른다. 내전은 팀 자동 밸런스와 ELO 반영을 켤 수 있고, 인원 모집은 둘 다 끈다.

**구현:** `games.capacity_step` 롤 1. `scrims.lol_format` `scrim|party`. 안 보내면 내전. 인원 모집은 작성·수정에서 `rated`·`auto_balance`를 false로 저장. 칼바람은 포지션 없음, 협곡 포지션은 유지. 작성 후 맵·진행은 바꾸지 않음. 마이그레이션 `20261102150000_lol_format_capacity_step`.

**확인:** shared 계약 25, core 내전 52, web 목 내전 26 passed. 브라우저(목): 정원 10에서 한 칸 줄이면 9, 5명 칼바람 인원 모집 작성 후 상세에 칼바람·인원 모집·ELO 미반영·1/5. 인원 모집 중에는 밸런스·ELO 스위치가 없고, 칼바람은 포지션 스위치가 꺼진다.

## 후속: 롤체 랭크·일반·더블업 진행 — 2026-11-02 — 판정: 구현 (QA·DB e2e 미실행)

**사용자 요청:** 롤체 랭크는 인원 모집이라 ELO를 끈다. 일반·더블업은 내전 또는 인원 모집을 고른다. 인원 모집은 팀 밸런스와 ELO를 끄고, 내전은 둘 다 고를 수 있다.

**구현:** `lol_format`을 롤체에도 저장. 랭크는 항상 `party`(내전으로 보내면 거부). 일반·더블업은 생략하면 내전. 인원 모집·랭크는 작성·수정에서 `rated`·`auto_balance`를 false로 고정. 일반 내전은 개인전이라 팀 밸런스 스위치는 없고 ELO만 켠다. 더블업 내전은 둘 다 켠다. 같은 마이그레이션에 기존 랭크 글의 밸런스·ELO를 끈다.

**확인:** shared 계약 25, web 목 내전 27 passed. 브라우저(목): 랭크는 ELO·밸런스 스위치 없음, 일반 내전은 ELO만, 더블업 내전은 밸런스와 ELO, 더블업 인원 모집은 둘 다 없음.
