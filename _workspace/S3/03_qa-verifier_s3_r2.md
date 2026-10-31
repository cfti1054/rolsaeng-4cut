# QA: s3 재검증(r2) — 판정: pass

작성: qa-verifier, 2026-10-30
대상: `_workspace/03_qa-verifier_s3.md`(fail, major 1·minor 4)의 결함 5개 반영분 + 수정으로 생긴 새 결함 여부
기준: 계약 `_workspace/01_architect_contract.md`(D103–D137), qa-boundary-check 2절
사용 가능 도구: Read, Grep, Glob, Bash(Git Bash), Write. 브라우저 도구 사용 안 함. 코드 수정 없음. 지시에 따라 build 실행 안 함.

판정 근거: 이전 결함 5개 모두 해소. 새로 찾은 결함은 minor 2건(표시 불일치 1, 계약 문구 누락 1)이고 blocker·major는 없다. 기계 검사(typecheck 1회, test 2회)는 모두 EXIT 0.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·api·web 4개 Done, EXIT 0 |
| `corepack pnpm -r test` 1회차 | shared 71, core **238/238**(balance.test.ts 33건 760ms), web 162, api 379 passed / 33 skipped(DB e2e 5파일). EXIT 0 |
| `corepack pnpm -r test` 2회차 | shared 71, core 238/238(balance.test.ts 964ms), web 162, api 379 / 33 skipped. EXIT 0 |
| `tsx --conditions=source scratchpad\d136-compare.mts {7,99,12345} 4000` — api `ProfileScrimService.forUser`(prisma 스텁)와 web 목 `profileScrim`에 같은 무작위 입력(TFT 2–8명, 상태 joined/no_show/cancelled/waitlist 무작위, 제출 순위 2명 이상 무작위 부분집합, rated 무작위) | 3929 / 3938 / 3937건, **불일치 0**. outcome 분포 win 837–850, loss 952–969, no_show 1053–1067, unassigned 1057–1081(skip 경계 포함) |
| `tsx --conditions=source scratchpad\post-noshow.mts` — 8명 전원 joined로 반영 후 1·2위 노쇼 표시, 5위 사용자 프로필 | 반영 시 5위 `loss, delta −2`, 노쇼 표시 뒤 프로필 `outcome win, elo_delta −2` (새 결함 N1) |
| DB e2e(`test/db/*.db.e2e.spec.ts`) | 미실행(PostgreSQL·Docker 없음) — r1과 같음 |

스크립트: `C:\Users\cfti1\AppData\Local\Temp\claude\c--Users-cfti1-Documents-GitHub-rolsaeng-4cut\42dbd1e3-68d5-43b6-8e9d-c229b0cff450\scratchpad\d136-compare.mts`, `...\scratchpad\post-noshow.mts`. 처음 생성기는 1명짜리 placements(shared 스키마 위반, `readPlacements` → null)를 만들어 130건이 엇갈렸다. 유효한 입력(2명 이상)으로 고친 뒤 0건 — 구현 차이가 아니라 생성기 문제였다.

## 이전 결함 재확인

| # | 심각도 | 결함 | 상태 | 근거 |
| --- | --- | --- | --- | --- |
| 1 | major | core 성능 테스트 벽시계 단언 실패로 `-r test` 중단 | **해소** | balance.test.ts:191-214 같은 입력 1회 워밍업 → 측정, `PERF_CEILING_MS = 1000`, `partitionsEvaluated = 6435` 함께 단언. 10명 포지션 사용 테스트도 같은 방식. 계약 7-4 320행 D137 문단과 같다. `-r test` 2회 모두 core 통과, api·web까지 실행됨 |
| 2 | minor | 모양 불일치 VALIDATION path 목 ↔ API 다름 | **해소** | 목 mock/scrims.ts:1239-1243 `g.has_teams ? 'placements' : 'winner_team'` = API scrim-results.service.ts:75-84. 목 테스트 mock/scrim-results.test.ts:270-279 양방향. 계약 5-4 2번(180행) 명시 |
| 3 | minor | 프로필 최근 내전 개인 순위 승패가 반영 기준과 다름 | **해소(제출 뒤·승인 전 노쇼 경로)** | api profile-scrim.service.ts:67-110, 목 mock/ratings.ts:469-480 둘 다 `selectRatedParticipants` 재순위 + `isPlacementWin(재순위, M)`, skip·대상 외 → unassigned, rated 무관. 참가자 행은 개인 순위 내전 id로 1회 조회(N+1 없음, :74-76). 무작위 대조 불일치 0. 승인 **뒤** 노쇼 표시 경로는 새 결함 N1 |
| 4 | minor | D131 새 참가 팀 초기화 API e2e 없음 | **해소** | scrim-results.e2e.spec.ts:927-949(full → 팀 저장 → 정원 6 확대 recruiting·팀 유지 → 새 참가 → 응답·저장 행 전원 team·position null, balance null). D136 e2e :903-925(rated true/false, 5위 WIN·6위 LOSS·노쇼 no_show, placement는 제출 순위). 둘 다 통과 |
| 5 | minor | 계약 본문이 D128–D135를 반영 안 함 | **대부분 해소** | 아래 표. 8절 표·11절 표 각 1행에 D131 누락이 남음(새 결함 N2) |

### 계약 본문 ↔ 구현 대조(결함 5)

| 절 | 내용 | 구현 | 일치 |
| --- | --- | --- | --- |
| 변경 이력 13행 | 본문 동기화 + D136·D137 | - | O |
| 2절 49-54행 | INTERNAL_ERROR 목록(5-5 3단계, D130 placements, winner_team 없음, 7b 잠금 없음, D135, games 행 없음) | scrim-results.service.ts:161-176, :225-228, seasons.service.ts:72-75 | O |
| 4-1 115·127행 | 최근 결과 정렬 created_at DESC → 활성 먼저 → id DESC, findMany 1회 | r1에서 확인(views `latestFirst`, 목 ratings.ts:355-361) | O |
| 4-1 138행 | ProfileScrim recent D136, approved_at DESC·id ASC, placement = 제출 순위 | profile-scrim.service.ts:55, :96, :102-109 | O |
| 5-0 151행 | `scrimWriteTx` 15s/5s, 승인 READ COMMITTED | scrim-results.service.ts:156, :293 | O |
| 5-1 157행 | 새 참가 확정·재참가 포함 | scrims.service.ts(r1 확인) + e2e :927 | O |
| 5-5 189-214행 실행 순서 | rated 반영: 1 → 2 → 3 → 5 → 6 → 7a → 8 → 4 → 7b → 9 → 10 → 11 → 12 → 13 / 없음: 1 → 2 → 3 → 5 → 6 → 4 → 12 → 13 | approve: lockOrNotFound(:159) → pendingForReview(:160) → playing 검사(:161) → selectRatedParticipants(:177) → ratedRun(:184) → `lockIfMayCreate(tx, clock.now(), SCRIM_TX_TIMEOUT_MS)`(:188) → `lockUserRatings`(:191) → now(:193) → `resolveForApproval(tx, now, holds)`(:195) → ratings 시드·경기 수(:198-214) → core 계산(:224-240) → 쓰기(:243-274) → 조건부 update(:282-286) → finished(:289-290). 반영 없음 분기 now(:277) | O |
| 5-5 7a | 시즌 없음 또는 `ends_at − 지금 ≤ 15000ms`면 잠금 | seasons.service.ts:57-61 `> marginMs`면 false = 같은 조건 | O |
| 5-5 7b | 재조회 → 있으면 사용, 없고 잠금 있으면 planAutoSeason insert, 잠금 없으면 INTERNAL_ERROR | seasons.service.ts:68-80 | O |
| 7-4 314-316·320행 | 홀수 사전순(짧은 쪽 먼저), evaluateTeams 입력 순서, D137 | balance.test.ts:291-300, :191-214 | O |
| 9절 386·413행 | 노쇼 응답 프로필 무효화, 최근 내전 게임 이름 | r1 확인 | O |
| 10절 428-434행 | scrim-result-json·rating-inputs·seasons·scrim-tx·profile-scrim 위치 | 파일 존재·역할 일치 | O |
| 11절 446행 | 승인 잠금 순서·7a 조건·7b | 위 5-5와 같음 | O |
| 14절 553-554행 | D136·D137 | 구현과 같음 | O |
| 8절 354행, 11절 448행 | 팀 초기화 경로 | 「참가 취소·정원 수정」만 — 새 참가(D131) 빠짐 | **X(N2)** |

## 새 결함

blocker 0, major 0, minor 2.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| N1 | minor | apps/api/src/modules/profile/profile-scrim.service.ts:74-109, apps/web/src/lib/api/mock/ratings.ts:470-479, 계약 4-1 138행·D136(553행) 「그 내전 참가자 전원의 **현재** status」 ↔ 5-5 215행 「승인 뒤 노쇼 표시·정정 허용, 레이팅·이력 불변」 | D136 목적대로 프로필 칩 = 상세 ELO 표 outcome = ratings wins/losses = delta 부호 | 승인 **뒤** 노쇼 표시·정정(시작 후 7일 안 허용)으로 현재 status가 바뀌면 프로필만 재순위가 달라진다. 상세 `rating_changes`(이력 행 기준 재순위, 4-1 130행·목 ratings.ts:383-389)·ratings는 그대로라 r1 결함 3과 같은 엇갈림이 이 경로로 다시 생긴다. 반대로 승인 전 노쇼를 승인 뒤 정정하면 이력 없는 사용자가 재순위에 들어와 다른 사람 칩이 바뀐다. 데이터 오염 없음, 표시만. api·목은 같은 동작(대조 0건) | `post-noshow.mts`: 8명 전원 joined로 승인(5위 loss, −2) → 1·2위 노쇼 표시 → 5위 프로필 `WIN` + `−2`. 처리 예: rated이고 이력 행이 있는 내전은 이력 행 사용자 집합으로 재순위(상세 `rating_changes`와 같은 규칙), 이력이 없을 때(rated=false·skip)만 현재 status 사용. 계약 D136 문구 조정은 architect |
| N2 | minor | _workspace/01_architect_contract.md:354(8절 표 「scrim_players.team·position 전원 null」), :448(11절 「S2 참가 취소·정원 수정(팀 초기화)」), :492(13절 backend 4번) | 5-1(157행)·10절(432행)·D131처럼 새 참가 확정 포함 | 세 곳 모두 「참가 취소·정원 수정」만. 구현(scrims.service.ts 새 참가 `resetTeams`)·e2e는 맞다. 구현 영향 없음 | 계약 파일 열람 |

### 참고(결함 아님)

- 성능 상한 1000ms는 이번 두 회차에서 balance.test.ts 파일 전체가 760·964ms였다(33건 합계, 16명 단건은 그보다 훨씬 작다). 단건 시간은 vitest 기본 출력에 나오지 않아 직접 확인하지 못했다. r1 단독 측정은 23–49ms.
- profile-scrim.service.ts:108 `const mine`이 :48 바깥 `mine`(내 참가 행 배열)을 블록 안에서 가린다. 동작에는 문제 없다.

## 미실행 (통과로 보지 말 것)

r1과 같음: DB e2e 6건(동시 승인·시즌 동시 생성·부분 고유 인덱스 등), 마이그레이션 실제 적용, 브라우저 렌더, `corepack pnpm -r build`(지시).
