# QA: s6_core (packages/core S6) — 판정: pass

대상: `packages/core/src/{result-review,season,admin,no-show,news,index}.ts`와 테스트(`result-review.test.ts`, `season-admin.test.ts`, `admin-news.test.ts`). 기준: 계약 `_workspace/01_architect_contract.md` 14절(시그니처·규칙·14-6 테스트 필수) + 6·7·8·11·12절 규칙.

사용한 도구: Read, Bash, Write(이 보고서), SubagentHandback. 코드는 수정하지 않았다. 프로브 테스트는 scratchpad에만 두었다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm exec vitest run` (packages/core) | 13 files, **509 passed**, 실패 0 (보고서 수치와 같음) |
| `corepack pnpm exec tsc --noEmit -p tsconfig.json` (packages/core) | exit 0 |
| `tsc -p tsconfig.build.json --outDir <scratch>/distcheck` 후 `diff -rq` 로 `dist`와 비교 | `.js`·`.d.ts` 모두 같음. `.js.map`만 다름(outDir 상대 경로 차이) → dist가 최신 src와 일치 |
| `node -e "require('./dist/index.js')"`로 14개 함수 확인 | 빠진 것 없음 `[]` |
| 독립 프로브 `vitest run --config <scratch>/probe/vitest.probe.config.mjs` | **32 passed**. 처음 실행 때 2건 실패는 프로브 쪽 실수였다(Map 삽입 순서 비교, vitest 안에서 dist를 require). 고친 뒤 통과 |

프로브 파일: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/ecf7f0de-031c-49ed-9801-f3ea7a17127a/scratchpad/probe/s6.probe.test.ts`

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | blocker·major·minor 없음 | — |

## 확인 내용

### (1) 되돌리기 왕복(독립 프로브)

S3 승인 시뮬레이터(`selectRatedParticipants` → `computeTeamEloUpdates`/`computePlacementEloUpdates` → elo = eloAfter, win/loss +1, 이력 행 생성, 경기 수 +1)를 따로 만들고, 그 결과에 `inferRevertOutcomes`(ratedUserIds = 이력 user, teamByUser = 전체 scrim_players.team, 원본 placements) → `planRatingRevert`를 적용했다. api `scrim-results.service.ts` revert(약 360–450행)의 입력 구성과 같다.

- 팀 6명(노쇼 1명, 팀 null 1명), blue 승·orange 승 각각: outcome이 승인 때 값과 모두 같고, 승인 전 ratings(elo·wins·losses)로 정확히 돌아간다. 이번 시즌 행이 없던 user(승인 때 1000으로 생성)는 1000/0/0으로 돌아가고 행은 남는다(6-3, 0경기 성공).
- K 판정: 이전 시즌까지 합친 이력 9회인 user는 kNew(9 < 10), 10회인 user는 kBase. 되돌린 뒤 경기 수를 원래대로 놓고 다시 승인하면 updates가 첫 승인과 **완전히 같다**(K·delta 포함).
- 시즌 경계: 이력 수는 모든 시즌, ratings는 이력 시즌 행을 쓴다. 다른 시즌 행이 섞이지 않는다.
- 개인 롤체 8명, 1위 노쇼: M=7로 다시 순위를 매긴다. 2·3·4위가 win이고 모두 승인과 같다. 정확히 복원된다.
- 동순위·입력 순서가 섞이고 같은 user 항목이 중복된 경우(첫 항목 사용, 노쇼 1명): 순서 z,y,w,x가 승인과 같고 복원된다.
- 최소 2명 개인: 복원된다.
- 승인 뒤 rated user가 no_show로 바뀌어도 팀이 그대로면 되돌릴 수 있다(ratedUserIds가 이력 기준이라). rated user의 팀이 null로 바뀌면 null이 나와 rating_mismatch로 처리된다.
- 이후 경기로 elo가 바뀐 user 1명은 `{ ok:false, userIds:['b'] }`. history 중복은 userIds에 한 번만 들어간다. 실패 순서는 history 입력 순서다.

### (2) 보고서의 「해석」·「계약 모호점」 판단

- **시즌 lead(해석 4-2, 「starts_at을 바꿀 때만」)**: 위반이 아니다. 위험도 낮다. 근거는 다음과 같다.
  (a) shared `SEASON_EDIT_MIN_LEAD_SEC` 주석(`packages/shared/src/admin.ts:345`)이 「시작 전 시즌의 **시작 시각**은 지금 + 이 초 이후」라고 적혀 있어 구현과 같다.
  (b) 11-1의 lead 근거는 rating_history의 시즌 귀속(D116)이다. starts_at이 그대로면 귀속은 바뀌지 않는다.
  (c) upcoming의 끝만 바꾸면 길이 ≥ 7일 검사가 계속 적용되므로 끝이 now + lead보다 앞설 수 없다. 프로브로 「30분 뒤 시작, 끝만 변경 → []」를 확인했다.
  남는 일은 계약 11-2의 「생성·upcoming 수정」 문구를 shared 주석에 맞춰 바꾸는 것뿐이다(architect 몫, 코드 결함 아님). 아직 api에 `validateSeasonWrite`를 호출하는 곳이 없다(시즌 서비스 미구현). 소비자 쪽 기대가 다를 가능성은 backend QA에서 다시 본다.
- **revertBlockReason에 승인자 id가 없음**: 위반이 아니다. 6-1·6-2의 막는 이유는 「제출자 = 요청자」뿐이다. 승인자는 판정에 쓰이지 않으므로 입력이 없어도 맞다. 14-6 「승인자 본인이어도 제출자가 아니면 null」은 actorId에 승인자 id를 넣는 테스트(`result-review.test.ts:340`)로 충족된다. 시그니처를 바꿀 필요도 없다.
- 나머지 해석 1–9: 모두 계약 범위 안이고 S3 동작과 일관된다. 특히 해석 1(placements 중복 시 첫 항목)은 S3 `selectRatedParticipants`와 같아야 왕복이 맞는데, 프로브로 확인했다. 해석 7(newsSubtitle가 앞쪽 빈 줄을 건너뜀)은 「첫 줄(앞뒤 공백 제거)」의 한 가지 읽기다. 홈 부제로서는 더 나은 쪽이라 결함으로 보지 않는다.

### (3) KST 경계

- `resolveEventsRange`: `2026-10-31T14:59:59.999Z` → 10월, `T15:00Z` → 11월. `2027-12-31T15:00Z` → 2028-01. 윤년 2028-02-29, 2100-02-28(100년 규칙), 2026-02-30 → RangeError. from만·to만 채우기도 계약대로다.
- `dashboardNewsWindow`: `2026-12-31T15:00Z` → today 2027-01-01, patchSince 2026-12-02, eventUntil 2027-01-31. 그 1ms 전 → 2026-12-31. 윤년 3-1 − 30일 = 2028-01-31. 날짜 문자열을 UTC 자정 기준으로 더하므로 DST·오프셋 오차가 없다.
- 되돌리기·이의 제기 기한은 KST 달력이 아니라 24시간 단위 ms다(계약 「approved_at + 7일」과 같음). 7일 − 1ms 허용·7일 막음, 3일 경계 모두 프로브로 확인했다.

### (4) 상수

- core 새 파일·추가분에 새 숫자 상수가 없다(`news.ts`에 `ISO_DATE_RE` 정규식과 형식 함수만 있음). 기간은 모두 인자로 받는다.
- 테스트·프로브가 쓰는 값은 shared 정의와 같다: `SCRIM_RESULT_REVERT_WINDOW_DAYS = 7`, `SCRIM_DISPUTE_WINDOW_DAYS = 3`(`scrim-results.ts:259,261`), `SEASON_EDIT_MIN_LEAD_SEC = 3600`, `SEASON_LENGTH_MIN/MAX_DAYS = 7/366`(`admin.ts:346–348`), `DASHBOARD_NEWS_PATCH_RECENT_DAYS/EVENT_AHEAD_DAYS = 30`, `DASHBOARD_NEWS_SUBTITLE_MAX = 60`(`news.ts:307–311`).
- `SeasonPhase = AdminSeasonPhase`, `AdminMemberStatus`, `ScrimResultRevertBlock`는 shared 타입을 그대로 쓴다.

### 14-6 테스트 필수 대조

13개 함수 행의 필수 경우가 모두 저장소 테스트에 있다(이름으로 하나씩 대조). 왕복 테스트는 팀 1개(`result-review.test.ts:197`)와 개인 2개(`:229`, `:272`)가 있다. index export는 14개(result-review 4, season 4, admin 2, no-show 1, news 3)로 src·dist 모두 확인했다.

### 기타 관찰 (결함 아님)

- 계약 11-2 문구(「생성·upcoming 수정」)와 shared 주석·구현이 lead 적용 범위에서 표현만 다르다. architect가 계약 문구를 맞추길 권한다.
- 시즌 관리·노쇼 후보 쪽 api 소비자는 아직 core 신규 함수를 다 쓰지 않는다. 연결부(서버가 첫 종류만 응답, invalid는 details 전부 등)는 backend 모듈 QA에서 검증한다.
