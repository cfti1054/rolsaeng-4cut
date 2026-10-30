# domain-logic-dev 보고서 — S2 core(노쇼 제한·내전 참가/대기열/시작/자동 마감)

계약: `_workspace/01_architect_contract.md` S2 7절(13개 함수), 5-2~5-7, 12절 logic 항목.
확인 필요 Q1~Q3은 사용자 답 전이라 계약 현재 기본값(D78·D76·D83)대로 구현했다.

## 변경 파일

| 파일 | 내용 |
| --- | --- |
| `packages/core/src/no-show.ts` (새) | `NoShowPolicy`, `ScrimRestrictionState`, `computeScrimRestriction`, `noShowLookbackStart`, `isNoShowMarkWindowOpen` |
| `packages/core/src/scrim.ts` (새) | `WaitlistRow`, `OpenScrimStatus`, `orderWaitlist`, `placeNewParticipant`, `statusForJoinedCount`, `planRosterAfterChange`, `validatePreferredPositions`, `validateScrimSchedule`, `isCapacityInRange`, `canStartScrim`, `decideOverdueScrim`, `computeOpenPositions`, `isJoinClosed` |
| `packages/core/src/no-show.test.ts` (새) | 24개 |
| `packages/core/src/scrim.test.ts` (새) | 45개 |
| `packages/core/src/index.ts` | 위 함수·타입 export 추가(S1 export 그대로) |
| `packages/core/src/config.ts` | `MINUTE_MS` 추가, S2 정책값은 인자로 받는다는 주석 |

시그니처는 계약 7절과 글자 그대로 같다. 정책값(3/30/7, 30일 상한, 60분, 표시 기한 7일)은 core 상수로 두지 않고 인자로 받는다(기본값은 shared `NO_SHOW_*_DEFAULT`, `SCRIM_*_DEFAULT`). 시작 최소 인원만 shared `SCRIM_MIN_PLAYERS_TO_START`를 import.

## 검증 (실제 출력)

- `corepack pnpm --filter @gcd/core typecheck` → 오류 0
- `corepack pnpm --filter @gcd/core test` → Test Files 5 passed (5), **Tests 148 passed (148)** (S1 기존 79 + S2 신규 69)
- `corepack pnpm --filter @gcd/core build` → dist 갱신(gitignore 대상, api 런타임이 `default: dist`를 읽으므로 갱신해 둠)

## 테스트가 다루는 경계

- 노쇼: 빈 입력, 2회, 정확히 3회째, 3회째 = now, 30일 창 시작 배제(정확히 30일 전 → 미발동, 30일 − 1ms → 발동), recentCount 구간 경계, until 경계(until − 1ms 제한, now = until 해제), 발동 후 4번째 노쇼로 연장, 오래된 발동 + 최근 1회(만료), now 기준 30일엔 2회뿐이지만 2일 전 발동으로 제한 중, 미래 시각 무시, 입력 순서 무관·불변, 같은 시각 3건, 정책 변경, 잘못된 입력 RangeError
- `noShowLookbackStart`: = now − 37일, 결정적 LCG로 만든 200개 이력에서 하한 초과만 넘긴 입력과 전체 입력의 restricted·until·recentCount 동일, 하한 근처 사례
- `isNoShowMarkWindowOpen`: 시작 시각 + 7일 포함, +1ms 닫힘, 일찍 시작한 내전
- 대기열: joinedAt 순, 동률이면 UUID id 순, 입력 불변·추가 필드 유지, 빈 입력
- 정원 마지막 자리 9/10 → joined, 10/10 → waitlist, full 판정
- `planRosterAfterChange`: 1자리 승격 → full, 대기 없음 → recruiting, 빈 자리 > 대기 수 → 전원 승격, 부분 승격, 꽉 찬 상태, 동률 id, joinedCount > capacity RangeError, 음수·소수 RangeError, 입력 불변
- 포지션: 1지망만·1+2지망 허용, 빈 배열·3개·중복·범위 밖(1·2지망) 거부, 포지션 없는 게임/use_positions 끔 → `[]`만
- 시작 시각: = now·과거 → not_future, +1ms ok, 정확히 30일 ok, 30일 + 1ms too_far
- 정원 범위: 경계 포함·소수·NaN, GAME_SEED 롤 10 고정
- `canStartScrim`: 고정 9/10 불가·10/10 가능, 가변 1명 불가·2명 가능
- `decideOverdueScrim`: 정확히 60분 처리·1ms 전 null, cancel 분기, full 대상, playing·finished·cancelled null, 시작 시각 미룬 뒤 null
- `computeOpenPositions`: 롤 10명 계산, 방장 1명, 1지망 쏠림, 빈 자리 0, 정원 초과 입력, 나누어떨어지지 않는 정원(8), 포지션 없는 게임, null·게임 밖 값

## 해석 (문서·계약에서 판단이 필요했던 부분)

1. **`until`은 제한 중일 때만 값**: 계약 「until = 최대 발동 m + restriction(제한 아니면 null)」을 「발동이 있었어도 이미 해제됐으면 null」로 읽었다. `restricted === (until !== null)`.
2. **같은 시각 노쇼 여러 건**: m과 같은 시각의 노쇼는 모두 구간 (m − window, m]에 들어간다고 보고 함께 센다(정렬 순서와 무관).
3. **`noShowLookbackStart`로 자른 입력의 `lastNoShowAt`**: restricted·until·recentCount는 항상 같지만, 노쇼가 전부 37일보다 오래됐으면 잘린 입력에선 `lastNoShowAt`이 null이 된다(전체 입력이면 그 옛 시각). `last_no_show_at`은 안내용이라 그대로 두었다. backend가 정확한 값을 원하면 `MAX(no_show_marked_at)`를 따로 조회해야 한다 — 필요 여부는 리더 판단.
4. **`computeOpenPositions`의 합계**: 계약대로 포지션별 남은 수 = 정원/포지션 수 − 1지망 수이고, 합계를 빈 자리 수로 자르지 않는다(1지망이 한 포지션에 몰리면 「구함」 합계가 실제 빈 자리보다 클 수 있음, 예: 10명 중 9명 미드 → 빈 자리 1인데 4개 포지션 각 2). 표시용이라 계약 그대로 두었다. `positions`가 비면(0으로 나눔) `[]`. 1지망 null·게임에 없는 값은 자리 수에만 반영.
5. **입력 검증 범위**: 계약에 명시된 RangeError(joinedCount > capacity)에 더해, `planRosterAfterChange`는 capacity·joinedCount가 음수·소수일 때, 시각을 받는 함수는 Invalid Date일 때, 노쇼 정책은 1 이상 정수가 아닐 때 RangeError를 던진다(호출 실수 방지, 정상 흐름엔 영향 없음). `placeNewParticipant`·`statusForJoinedCount`·`canStartScrim`·`isCapacityInRange`는 단순 비교만 한다(`isCapacityInRange`는 소수·NaN에 false).
6. **id 비교**: 대기열 동률의 id 비교는 로캘 무관 코드 유닛 비교(`<`). PostgreSQL `ORDER BY id`(uuid 타입)는 바이트 순서이고 소문자 hex 문자열 순서와 같다.
7. **보고서 경로**: 계약 12절은 `_workspace/02_logic-dev_s2.md`라고 적었지만 리더 지시대로 이 파일(`02_domain-logic-dev_report.md`)에 썼다.

## 계약 변경 요청

없음. 시그니처 13개 모두 계약 7절 그대로 구현했다.

## 사용 가능한 도구

Read, Grep, Glob, Bash, Write, Edit.

## 변경: computeOpenPositions D100 반영 (2026-10-30, QA s2-2·core 1)

- 파일: `packages/core/src/scrim.ts`(규칙 4번 Σ raw_p > open → `[]` + 주석), `packages/core/src/scrim.test.ts`, `packages/core/dist/**` 재빌드(apps/api가 dist 사용). 시그니처 변경 없음.
- 위 해석 4번은 D100으로 대체: 이제 결과 count 합계 ≤ 빈 자리(open)가 불변식이다. min(raw, open) 자르기는 하지 않는다.
- 테스트(computeOpenPositions 13개): 미드 9명 → `[]`, 미드 3명(8 > 7) → `[]`, 합계 = open(탑2·정글2·미드2·원딜1·서폿1 → 원딜1·서폿1, 미드 2명 → 4포지션 2), 2포지션 경계(합계 = open 그대로 / open + 1 → `[]`), null·positions 밖 값으로 합계 초과 → `[]`, 결정적 시드 PRNG 2000회 무작위 대조(합계 ≤ open, 각 count ∈ [1, open], positions 순서, 빈 결과·비지 않은 결과 둘 다 발생 확인). 기존 「미드 3명 → 4포지션 2자리」「capacity 5 null·밖 값 → 4포지션 1」 기대값은 D100에 따라 `[]`로 바꿨다.
- 결과: `corepack pnpm --filter core typecheck` 통과, `test` 5파일 155개 전부 통과.
- 해석(관찰): Σ raw_p = open + (null·positions 밖 1지망 수) + (포지션 정원 초과분)이므로, 1지망에 null·밖 값이 하나라도 있으면 결과는 항상 `[]`(카드 「N자리 남음」)다. 정상 흐름에서는 use_positions 내전의 1지망이 검증(D82)으로 항상 positions 안이라 영향 없다.
