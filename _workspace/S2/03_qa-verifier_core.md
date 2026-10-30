# QA: S2 packages/core (no-show.ts, scrim.ts) — 판정: pass

대상: `packages/core/src/no-show.ts`, `packages/core/src/scrim.ts`, 두 테스트 파일, `src/index.ts` export
기준: 계약 `_workspace/01_architect_contract.md` 5-2~5-7, 7절(13개 함수), 12절 logic 경계 목록, D78·D79·D83·D85·D92, 문서 7-4
구현 보고서: `_workspace/02_domain-logic-dev_report.md`

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter @gcd/core typecheck` | `tsc -p tsconfig.json --noEmit` 출력 없음(오류 0) |
| `corepack pnpm --filter @gcd/core test` | time 20, scrim 45, profile 15, no-show 24, riot 44 → **Test Files 5 passed (5), Tests 148 passed (148)** |
| `corepack pnpm --filter @gcd/shared typecheck` / `test` | 오류 0 / Test Files 3 passed, Tests 53 passed |
| dist 신선도 | `dist/no-show.js`·`dist/scrim.js`(13:44:45)가 `src/*.ts`(13:41~13:44)보다 새것. api 런타임이 읽는 dist에 S2 export 존재 |
| 무작위 대조(스크래치 스크립트, dist 대상) | 아래 참조. **불일치 0건** |

무작위 대조 내용(코드 미수정, 스크래치 디렉터리에서 실행):
- `computeScrimRestriction` 20,000건: 정책(threshold 1–4, window 1–30일, restriction 1–10일) 무작위, 노쇼 시각을 반나절 단위로 양자화해 동률·정확한 경계·미래 시각을 일부러 많이 만듦. 계약 규칙을 그대로 옮긴 O(n²) 참조 구현과 restricted·until·recentCount·lastNoShowAt 전부 일치.
- 같은 20,000건에서 `noShowLookbackStart` 하한 **초과**만 남긴 입력의 restricted·until·recentCount가 전체 입력과 일치(기본 정책뿐 아니라 임의 정책에서도).
- `planRosterAfterChange` 20,000건: 불변식 「승격 후 joined ≤ capacity」, 「남은 대기 > 0 이면 joined = capacity」, 「nextStatus = joined ≥ capacity ? full : recruiting」 위반 0. `orderWaitlist` 결과가 (joinedAt, id) 오름차순 위반 0.
- 단건: `validateScrimSchedule(now+30일)` = ok, `decideOverdueScrim(full, 정확히 60분, canStart false)` = cancel.

## 계약 대조

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 타입 4개(NoShowPolicy, ScrimRestrictionState, WaitlistRow, OpenScrimStatus) | 일치 | no-show.ts:12-22, scrim.ts:8-9 |
| 함수 13개 시그니처 | 13개 모두 7절과 동일(인자 이름·순서·반환 유니온) | no-show.ts:46,99,108 / scrim.ts:27,36,41,50,76,97,112,120,129,151,172 |
| index export | 13개 함수 + 4개 타입 export, S1 export 유지 | index.ts:22-42 |
| 30일 3회 → 7일 | 발동 m마다 (m − 30일, m] 개수 ≥ 3, until = 최대 발동 m + 7일, now = until 해제 | no-show.ts:66-80 |
| 「일」 = 24시간 이동 구간 | `DAY_MS` 곱, KST 경계 미사용 | no-show.ts:56-57 |
| 미래 시각 무시 | `t <= nowMs` 필터 후 판정·recentCount·last 모두 계산 | no-show.ts:61 |
| 대기열 순서 (joined_at, id) | joinedAt ASC, 같으면 id 코드 유닛 비교. 입력 불변(복사 후 정렬) | scrim.ts:27-33 |
| 승격 | 빈 자리 = max(0, cap − joined), orderWaitlist 앞에서, joined > cap RangeError(D79) | scrim.ts:58-68 |
| 정원 검증 | 정수 && min ≤ c ≤ max | scrim.ts:112-114 |
| 포지션 검증 | use_positions: 1–2개, gamePositions 안, 중복 없음 / 아니면 [] 만 | scrim.ts:76-94 |
| 시작 시각 | ≤ now → not_future, > now+30일 → too_far, 정확히 30일 ok | scrim.ts:97-109 |
| 시작 조건(D78) | 고정 정원 → joined = capacity, 그 외 ≥ `SCRIM_MIN_PLAYERS_TO_START`(shared, 2) | scrim.ts:120-123, shared scrims.ts:30 |
| 자동 마감 60분 | recruiting·full이고 now ≥ scheduledAt + 60분일 때만, canStart → start / cancel, 그 외 null | scrim.ts:129-142 |
| 참가 마감(D92) | now ≥ scheduledAt | scrim.ts:172-176 |
| 노쇼 표시 기한(D83) | now ≤ scheduledAt + 7일 | no-show.ts:108-112 |
| core 순수성 | 시계·env·I/O 없음, 의존은 @gcd/shared만 | scrim.ts:5, package.json dependencies |
| 정책값 상수 위치 | core 상수 없음, shared `NO_SHOW_*_DEFAULT`(3/30/7/7), `SCRIM_*_DEFAULT`(30/60) | config.ts 주석, shared scrims.ts:26-37 |

## 12절 경계 목록 대 테스트

| 계약 12절 경계 | 테스트 위치 |
| --- | --- |
| 정확히 3회 | no-show.test.ts:47 |
| 30일 경계(시작 배제·끝 포함) | :55, :61, :67, :74 |
| until 경계(now = until 해제) | :79 |
| 발동 후 4번째로 연장 | :92 |
| 오래된 발동 + 최근 1회 | :99 (+ 반대 사례 :108) |
| 미래 시각 무시 | :118 |
| lookback 자른 입력 = 전체 입력 | :173(200건), :191, :202 |
| 대기열 동률 → id | scrim.test.ts:37, :111 |
| 승격 수 > 대기 수 | :90 |
| joinedCount > capacity 예외 | :116 |
| 포지션 중복·범위 밖·포지션 없는 게임에 값 | :146, :151, :161 |
| 시작 시각 = now·정확히 30일 | :172, :177 |
| 고정 정원 9/10 | :205 |
| open_positions 쏠림·나누어떨어지지 않는 정원 | :266, :281 |
| 자동 마감 정확히 60분 | :224 |

12절 목록의 경계는 모두 테스트에 있다.

## 결함

blocker 0, major 0, minor 4.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | packages/core/src/scrim.ts:156-167 | 목록 카드 「서폿 1 · 정글 1 구함」은 실제로 남은 자리 수를 넘지 않아야 사용자에게 맞는 안내가 된다 | 1지망이 한 포지션에 몰리면 「구함」 합계가 빈 자리보다 커진다. 계약 7절 식을 그대로 따른 결과라 계약 위반은 아니다(구현 보고서 해석 4에서도 밝힘) | `computeOpenPositions(['top','jungle','mid','bot','support'], 10, Array(9).fill('mid'))` → top·jungle·bot·support 각 2(합계 8), 실제 빈 자리 1. 계약에서 합계를 빈 자리로 자를지 architect가 정해야 한다 |
| 2 | minor | packages/core/src/no-show.ts:83, :97 / no-show.test.ts:185 | 계약 7절: lastNoShowAt = now 이하 최대값 | backend가 5-6대로 `noShowLookbackStart` 초과만 조회하면 노쇼가 모두 37일보다 오래된 사용자는 `lastNoShowAt = null`. 전체 입력이면 그 옛 시각. 테스트는 이 경우를 `if`로 건너뛴다(:185) | `computeScrimRestriction([ago(40)], NOW, policy).lastNoShowAt` = ago(40), 하한으로 자르면 null. 응답 `last_no_show_at`이 안내용이라 영향은 표시뿐. backend가 MAX를 따로 조회할지 리더가 결정할 것 |
| 3 | minor | packages/core/src/no-show.ts:108-112, scrim.ts:97-109, scrim.ts:129-142 | 다른 함수처럼 잘못된 숫자 인자는 RangeError(보고서 해석 5의 방침) | `windowDays`·`maxDaysAhead`·`autoCloseAfterMin`은 검사하지 않는다. NaN이면 조용히 false/결과 반환 | `isNoShowMarkWindowOpen(t, t+1일, NaN)` → false(예외 없음). env.ts가 양의 정수를 보장하면 정상 흐름엔 영향 없음 |
| 4 | minor | packages/core/src/no-show.test.ts:173 | lookback 동등성 테스트가 정책 값이 바뀌어도 성립함을 보인다 | 200건 대조가 기본 정책(3/30/7)만 쓴다. 정책은 env로 바뀌는 값이다 | QA 무작위 대조(임의 정책 20,000건)에서 불일치 0이므로 구현은 맞다. 테스트 보강만 권장 |

## 참고 (core 범위 밖, 다른 대상 검증 때 확인할 것)

- `apps/web/src/lib/api/mock/scrims.ts:159, :171`이 `orderWaitlist`·`computeOpenPositions`를 core에서 가져오지 않고 다시 구현했다(snake_case `joined_at` 행 대상). 목 백엔드라 계약 위반은 아니지만 core와 달라질 수 있다. 1지망은 `preferred_positions[0]`로 core 입력과 같다. frontend QA 때 함께 본다.
- 아직 `apps/api`에서 S2 core 함수를 import하는 곳이 없다(backend 미완료). backend QA에서 「계산식 재구현 없이 core 호출」, 5-6 조회 조건이 `>`(초과)인지, `canStartScrim`의 `fixedCapacity = capacity_min === capacity_max`인지 확인할 것.
- 구현 보고서 경로가 계약 12절(`02_logic-dev_s2.md`)과 다르다. 리더 지시라고 보고서에 적혀 있다.
