# domain-logic-dev 보고서 — S3 (ELO·팀 밸런스·시즌)

계약: `_workspace/01_architect_contract.md`(S3, D103–D127) 7절 · 13절 logic 항목. 슬라이스: `_workspace/00_input/slice.md`.
이전 S2 보고서: `_workspace/S2/02_domain-logic-dev_report.md`.
사용 가능 도구: Read, Grep, Glob, Bash, Write, Edit (+ SubagentHandback).

## 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter core typecheck` | 통과 |
| `corepack pnpm --filter core test` | 8파일 238개 전부 통과(S3 신규 83개: rating 33, balance 33, season 17) |
| `corepack pnpm --filter core build` | 통과. `dist/rating.*`, `dist/balance.*`, `dist/season.*`, `dist/index.*` 갱신. node에서 dist require 동작 확인 |

수정 범위: `packages/core/src/**`만(config.ts·index.ts 수정, rating.ts·balance.ts·season.ts와 각 test 신규). core 밖은 건드리지 않았다.

## 파일·함수 (계약 시그니처 그대로, 23개)

| 파일 | 내용 |
| --- | --- |
| `src/config.ts` | `RATING_SEED_BY_TIER`, `RATING_SEED_DEFAULT`(1000), `ELO_SCALE`(400), `POSITION_PREFERENCE_COST`(0/1/3), `BALANCE_POSITION_COST_WEIGHT`(50) |
| `src/rating.ts` | 타입 `EloPolicy`·`RatedPlayer`·`EloUpdate` / `tierSeedRating`, `eloKFactor`, `expectedScore`, `roundHalfAwayFromZero`, `meanRating`, `computeTeamEloUpdates`, `computePlacementEloUpdates`, `isPlacementWin`, `computeWinRate`, `previewTeamElo`, `selectRatedParticipants` |
| `src/balance.ts` | 타입 `BalancePlayer`·`TeamMemberPlan`·`TeamPlan`·`TeamsEvaluation`·`BalanceResult`·`ValidationIssue` / `computeSkill`, `positionPreferenceOf`, `bestPositionAssignment`, `balanceTeams`, `evaluateTeams`, `validateTeamAssignment`, `validatePlacementUsers` |
| `src/season.ts` | 타입 `SeasonLike` / `resolveSeasonAt`, `latestStartedSeason`, `kstMonthStart`, `addKstMonths`, `planAutoSeason`(이름은 shared `autoSeasonName`) |
| `src/index.ts` | 위 전부 export. 추가로 `selectRatedParticipants` 반환 타입 별칭 `RatedParticipantsSelection`을 export(추가만, 시그니처 변경 없음) |

구현 메모
- `balanceTeams`: 사전순 조합 생성기로 크기 ⌊n/2⌋ 부분집합 전수. 짝수는 players[0] 포함 조합만(사전순이라 앞쪽에 몰려 있어 그 뒤는 끊는다). 같은 팀 구성(비트마스크)의 TeamPlan은 캐시. 포지션 배정은 사전순 DFS + 가지치기(비용 ≥ 현재 최소면 중단)라 처음 찾은 최소가 곧 「index 수열 사전순 최소」.
- 성능(테스트로 확인): 16명 포지션 미사용 6435가지, 10명 포지션 사용(126 × 팀당 최대 120) 모두 200ms 미만.
- K 값은 `EloPolicy` 인자, 시각은 `Date` 인자. `Date.now()`·난수 미사용(테스트 난수는 시드 고정 mulberry32).

## 테스트 범위

- 7-3 검증 수치: 1000 대 1000 K32 → +16/−16, 팀 평균 1400 대 1300 → 블루 승 +12 / 블루 패 −20(E ≈ 0.640, 오렌지는 −12/+20), `previewTeamElo` 같은 값, 신규 K 경계(경기 9 → 40, 10 → 32), 4명 동일 1000 순위 → +16/+5/−5/−16 합 0, 2명 순위 = 1:1 팀 ELO, placement 비연속 → 재매김, 참가자별 신규 K/(M−1), 무작위 300회 순위 합계 |Σ| ≤ M/2, 반올림 x.5 양쪽 부호와 부동소수 경계·−0 방지, 시드 표 전 티어 + UNRANKED/null/undefined, `isPlacementWin` 8명·5명·3명·2명, 승률 반올림·0경기 null, 하한 없음, 빈 팀 RangeError.
- `selectRatedParticipants`: 노쇼·미배정·대기 제외, 한 팀 전원 노쇼 → skip, 개인 순위 노쇼·명단 외 제외 후 재매김, M < 2·placements null → skip.
- 7-4: 10명 126 · 3안 서로 다른 나누기 · 비용 오름차순, 16명 6435 · < 200ms, n = 2–11·16 나누기 수 표(9명 126 포함), 2명 1:1 안 1개, 4명 포지션 사용 2:2 최적 비용 0·members 포지션 순, λ 효과(차 40 + 비용 0 → 40 < 차 0 + 비용 1 → 50), 9명 홀수 4:5 · 블루 = players[0] 쪽 · 전력 차 = 평균 차 × n/2, 모든 실력값 동일 → index 사전순, 결정성, maxOptions, 입력 오류 RangeError(2명 미만·17명·큰 팀 > 포지션 수·포지션 없는 게임에서 usePositions·userId 중복), **무작위 60건을 2^n 브루트포스 기준 구현(전체 순열 포지션 배정 포함)과 상위 3안 대조**, `bestPositionAssignment` 무작위 200건 전체 순열 대조, `evaluateTeams`가 balanceTeams 1안과 같은 값, 포지션 미사용 내전(롤체·스팀) 경로, validate 두 함수 path.
- 7-5: 빈 목록, 반열림 경계, 겹치는 시즌 해석(startsAt 최신 → id ASC), `latestStartedSeason`, 계약 예시 「시즌 1」 2026-11-01 ~ 2027-02-01 · 「시즌 2」 2027-02-01 ~ 2027-05-01, 공백 건너뛰기, 미래 시즌 앞에서 자르기, 1월 31일 + 1개월 = 2월 28일(윤년 29일), KST 자정 경계(UTC 15:00 / 1ms 전), 이미 시즌 안이면 RangeError, 무작위 2000회 「at 포함 · 기존 시즌과 겹침 없음」.

## 해석 (계약 범위 안에서 가장 단순하게 정한 것)

1. **홀수 인원 동점의 index 수열 비교**: 블루가 작은 팀일 수도 큰 팀일 수도 있어 수열 길이가 다르다. 일반 사전순(앞부분이 같으면 짧은 쪽이 앞)으로 비교했다. 예: 5명 전원 동일 실력 → `[0,1]` < `[0,1,2]` < `[0,1,3]`.
2. **`evaluateTeams` members 순서**: 입력에 `positions`가 없어 7-4 6번(포지션 순 / skill DESC)을 적용할 수 없다. 입력 순서 그대로 둔다. `usePositions=false`면 position을 null로 바꾼다. `usePositions=true`인데 position null인 사람은 position null·비용 0·preference null. 전력 차의 n = 두 팀 인원 합.
3. **`selectRatedParticipants` 경계**: 개인 순위인데 `placements` null → skip. placements에 같은 user가 두 번 있으면 첫 행만(zod가 이미 막음). 같은 placement가 여럿이면 입력 순서로 안정 정렬(zod가 이미 막음). 팀 게임은 `placements` 인자를 보지 않는다.
4. **입력 방어 RangeError 추가**(정상 경로에서는 발생 안 함): 음수·소수 gamesPlayed(`eloKFactor`·`computeSkill`), `balanceTeams`의 userId 중복·maxOptions < 1, `isPlacementWin` rank 범위 밖, `planAutoSeason` lengthMonths < 1·비정수, `addKstMonths` 비정수 months, 잘못된 Date. backend는 balanceTeams의 RangeError를 모두 SCRIM_BALANCE_UNAVAILABLE로 매핑하므로 userId 중복이 그 코드로 나갈 수 있다는 점만 참고.
5. **`roundHalfAwayFromZero`**: 계약대로 `floor(|x| + 1e-9 + 0.5)`. 따라서 2.4999999999999996도 3이 된다(부동소수 오차 흡수 의도). 결과 0은 항상 +0.
6. **`addKstMonths` 연쇄**: 말일 자르기 후 다시 더하면 날짜가 밀린다(1/31 → 4/30 → 7/30). `planAutoSeason`의 공백 건너뛰기가 직전 시즌 끝(임의 시각)에서 시작하면 이 효과가 생길 수 있다. 자동 생성 시즌은 항상 KST 1일 00:00에서 시작하므로 수동 시즌이 월말에 끝나는 경우에만 해당. 계약 문구 그대로 구현.

## 계약 변경 요청

없음(필수 변경은 없다). 다음 두 가지는 계약 문구를 보강하면 좋다 — 현재 구현은 위 「해석」 1·2번대로다.

| # | 대상 | 내용 | 제안 |
| --- | --- | --- | --- |
| R1 | 7-4 balanceTeams 5번(동점) | 홀수 인원에서 블루 index 수열 길이가 다를 때의 비교 규칙이 없다 | 「접두가 같으면 짧은 수열이 앞(일반 사전순)」을 한 줄 추가 |
| R2 | 7-4 evaluateTeams | members 순서 규칙이 없고, 포지션 순 정렬에 필요한 `positions` 인자가 없다 | 「members = 입력 순서」로 명시(backend가 상세 슬롯 순서로 넘김). 포지션 순 표시가 필요하면 화면에서 `game.positions`로 정렬하거나, 이후 `positions?: readonly string[]` 선택 인자 추가 |
