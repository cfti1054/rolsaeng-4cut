# domain-logic-dev 보고서: S4 packages/core

계약: `_workspace/01_architect_contract.md` 9절, 14절 logic, 6-1, 7-7, 9-2.

## 결과

- 9절 함수 16개 구현, `index.ts` export 완료. 시그니처는 계약 그대로다.
- 테스트 9개 파일 366개 통과(S4 기준선 241 + 신규 125: ranking 55, season 44, rating 19, time 7). QA 수정과 19절 후속 변경 반영 뒤 수치다.
- `tsc -p tsconfig.json --noEmit` 통과. `corepack pnpm --filter @gcd/core build` 통과.
- 빌드된 `dist/index.js`를 node로 불러 16개 함수가 모두 함수로 export되는 것과 값 3개(1421 → 1211, Diamond II 45 = 2645, 주 시작 경계)를 확인했다.
- 작업 시작 시 `packages/core/dist`는 없었다(gitignore 대상). 이번 빌드로 새로 생겼다.

## 함수 목록

| 파일 | 함수 |
| --- | --- |
| `src/time.ts` | kstWeekWindow |
| `src/ranking.ts`(새 파일) | tierScore, compareRanking, buildTierRanking, buildEloRanking, computeRankChange, rollRankBaseline, isRankingStale |
| `src/season.ts` | softResetElo, seasonStartElo, pickPreviousRating, selectSeasonsToClose, computeSeasonStandings, computeSeasonBadges, seasonDaysLeft, seasonProgress |

## 계약과 다른 점 (계약에 없던 추가)

시그니처 변경은 없다. 아래는 계약이 정하지 않은 입력에 대한 처리와 추가 export다.

| 위치 | 처리 | 이유 |
| --- | --- | --- |
| buildEloRanking | `minGames`가 1 미만이거나 정수가 아니면 RangeError | 반환 타입 `winRate: number`를 지키려면 0경기 행이 없어야 한다. `RANKING_ELO_MIN_GAMES`는 양의 정수(13절)라 정상 경로에 영향 없음 |
| tierScore | 마스터 이상은 입력에 디비전이 있어도 0으로 계산. 모르는 tier·division(Object 프로토타입 키 포함), 음수·비정수 LP는 RangeError | D152. 형식 불량 행은 backend가 먼저 거른다(7-2) |
| seasonStartElo | 시드 경로에서도 ratio 검사 | 잘못된 env가 시드 경로에서만 조용히 지나가지 않게 |
| selectSeasonsToClose | `graceMs`가 음수·NaN이면 RangeError | 호출 실수 방지 |
| computeSeasonBadges | rank 1·2·3이 아닌 행 제외(0 포함), 결과는 순위 오름차순 | 입력 순서와 무관한 결과 |
| seasonProgress | 길이 0 이하 구간은 나누지 않고 0 또는 1 | NaN 방지 |
| `config.ts` | 상수 `SEASON_SOFT_RESET_CENTER`(1000) 추가 | 문서 식의 1000을 상수로 분리 |
| `index.ts` | 타입 `RankingComparable`, `RankBaseline` 추가 export | 호출 측 타입 지정용 |
| `time.ts` | `assertValidDate`를 모듈 export로 변경(`index.ts`에는 없음) | ranking.ts 재사용 |

## 해석

**rollRankBaseline: 7-7 표에 없는 세 경우**

| 상태 | 결과 | 이유 |
| --- | --- | --- |
| 기준이 지난 주 것 + 이전 payload를 못 읽음(null) | `{이번 주, {}}` | 슬라이스 「기준 자료가 없으면 `—`」. 지난 기준을 이번 주에 다시 쓰지 않는다 |
| 저장 기준 없음 + 이전 payload 있음 | `{이번 주, {}}` | 표의 「행 없음」과 같게 처리. 시점을 모르는 값을 기준으로 삼지 않는다 |
| 저장 기준이 weekStart보다 새로움 | 그대로 | 늦게 끝난 오래된 계산이 기준을 되돌리지 않게. 어차피 `computed_at` 조건부 쓰기에서 버려진다 |

**compareRanking의 0경기 처리:** 계약의 교차 곱을 그대로 쓰면 0경기 행은 상대와 승률 동률로 나오지만, 다음 단계 경기 수에서 항상 뒤로 가므로 「0경기 = 승률 0」으로 취급한 순서와 같다. 그래서 별도 분기를 두지 않았다. 처음에는 분모를 1로 두는 분기를 넣었으나 뮤테이션 검사에서 결과가 같다는 것을 확인하고 제거했다. 0경기 동작은 테스트로 고정되어 있다.

**테스트 위치:** 에이전트 정의는 `packages/core/test/**`이지만 저장소와 `vitest.config.ts`가 `src/**/*.test.ts`를 쓰므로 그대로 따랐다.

## 검증 방법

- Node 20.11에서 `vitest.config.ts`를 읽지 못할 수 있어(패키지 engines는 ≥22), 같은 내용의 임시 `packages/core/vitest.tmp.config.mjs`로 실행하고 실행마다 지웠다. 저장소 설정은 바꾸지 않았다.
- 뮤테이션 검사: 경계·정렬 조건을 한 번에 하나씩 바꾼 15건 중 13건을 테스트가 잡았다. 남은 2건은 위 0경기 분기로, 동작이 같은 변형이었고 코드를 단순화했다. 뮤테이션은 단순화 전에 실행했고 단순화 뒤에는 전체 테스트·타입 검사·빌드만 다시 돌렸다.

## QA 수정 (`_workspace/03_qa-verifier_core.md` minor 3건)

export 시그니처는 바꾸지 않았다.

| # | 위치 | 수정 | 테스트 |
| --- | --- | --- | --- |
| 1 | `ranking.ts` tierScore | `constructor` 같은 프로토타입 키가 검사를 통과해 NaN을 반환하던 것을 `Object.hasOwn` 검사로 바꿔 RangeError로 만들었다 | tier·division 각각 `constructor`, `toString`, `__proto__`, `hasOwnProperty` |
| 2 | `ranking.ts` assignRanks, buildTierRanking, buildEloRanking | 정렬 키를 행에 넣지 않고 행 밖에 분리했다. 호출자 행의 `value`가 보존되고 정렬에 쓰이지 않는다. 내부 형변환 2곳도 없어졌다 | 두 함수 각각 1개 |
| 3 | `season.test.ts` computeSeasonBadges | 코드 변경 없음. rank 0, −1, 1.5, 2.999, 4 제외를 테스트로 고정했다 | 1개 |

수정 뒤 전체 테스트, typecheck, build를 다시 돌렸다. 수정 전 동작으로 되돌린 변형과 QA가 지적한 `s.rank <= 3` 변형, 총 4건을 새 테스트가 모두 잡았다. dist를 node로 불러 프로토타입 키 RangeError와 `value` 보존도 확인했다.

## S4 후속 변경: 패배 배율 (계약 19-1, D169–D173)

| 위치 | 변경 |
| --- | --- |
| `rating.ts` EloPolicy | `lossRatio: number` 필수 추가 |
| `rating.ts` applyLossRatio(새 함수, `index.ts` export) | `(rawDelta, lossRatio) => number`. 음수에만 곱하고 반올림하지 않는다 |
| computeTeamEloUpdates | `round(applyLossRatio(k × (S − E), policy.lossRatio))` |
| computePlacementEloUpdates | `round(applyLossRatio(k / (M − 1) × raw, policy.lossRatio))`. 합산 변동의 부호로 정한다(D170) |
| previewTeamElo | 입력에 `lossRatio` 필수 추가. `lose`에만 적용 |

기존 호출자 처리는 계약대로 필수 필드다. 기본값이나 선택 필드로 두지 않았다.

**계약에 없는 처리:**

- applyLossRatio는 양수 변동에서도 lossRatio를 검사한다. 잘못된 값이 패자가 나올 때만 드러나지 않게 하기 위해서다. 그래서 `undefined`도 RangeError다.
- rawDelta가 유한하지 않으면 RangeError다.
- ratio 0의 결과를 −0이 아닌 0으로 돌려준다.

**검증:**

- 19-1 검증 값 표 6줄을 ratio 1·0.5 모두 테스트했다.
- ratio 1 불변: 기존 수치 테스트의 기대 변동값은 바꾸지 않았고 policy와 호출 입력에 `lossRatio: 1`만 넣었다(정책 값 자체를 비교하는 기대값 1줄 포함). 무작위 3000회로 배율 도입 전 식과의 일치도 확인했다.
- 그 밖의 테스트: 개인 순위 win인데 음수인 행, ratio 0(변동 0, outcome은 loss), 범위 밖 RangeError, 미리보기와 실제 반영 일치.
- 뮤테이션 6건(반올림 뒤 곱하기 2건, outcome 기준 배율, 미리보기 배율 누락, 양수에도 곱하기, −0)을 모두 테스트가 잡았고, 복원 뒤 원본과 diff가 없는 것을 확인했다.
- typecheck, build 통과. dist를 node로 불러 `applyLossRatio`와 ratio 0.5 미리보기 값을 확인했다.

**backend·frontend 연결 전 주의:** `lossRatio`가 없으면 타입 오류와 함께 실행 시 RangeError가 난다. 승인, 팀 미리보기, 목 백엔드가 모두 영향을 받는다. 작업 시작 시점에 아래 호출부가 아직 값을 넘기지 않았다. api·web 테스트는 이 연결 전까지 실패할 수 있다.

| 담당 | 위치 |
| --- | --- |
| backend | `apps/api/src/config/env.ts`(`rating`), `scrim-teams.service.ts:104`, `scrim-views.service.ts:408` |
| frontend | `apps/web/src/lib/api/mock/ratings.ts`(`mockEloPolicy`, `previews`의 previewTeamElo 호출) |

## 20절(S4 후속 변경 2): 시작 1000·소프트 리셋 폐지·실력값 w (D182–D189)

**변경 파일:** `packages/core/src/balance.ts`, `balance.test.ts`, `season.ts`, `season.test.ts`, `config.ts`, `rating.ts`(주석), `index.ts`, `dist/**`(재빌드).

| 구분 | 내용 |
| --- | --- |
| 새 함수 | `balanceEloWeight(seasonGames: number): number` = `BALANCE_ELO_WEIGHT_MAX × min(seasonGames, F) ÷ F`(곱한 뒤 나눔). 0 이상 정수가 아니면 RangeError |
| 시그니처 변경 | `computeSkill(input: { seasonElo: number \| null; seasonGames: number; tierSeed: number })`. 입력 `gamesPlayed` → `seasonGames`. `w = balanceEloWeight(seasonGames)`, `elo = seasonElo ?? RATING_START_ELO`. 범위 오류는 `balanceEloWeight`의 RangeError |
| 삭제 | `softResetElo`, `seasonStartElo`, `pickPreviousRating`(season.ts, 내부 `assertRatio`도), 상수 `SEASON_SOFT_RESET_CENTER`(config.ts) |
| 주석 | `RATING_SEED_BY_TIER`·`RATING_SEED_DEFAULT`·`tierSeedRating` → 「밸런스 티어 환산값(D189), ELO 시작값 아님」. `BalancePlayer.rating` → 「현재 시즌 ELO(행이 없으면 RATING_START_ELO)」. balance·season 머리 주석 |

shared 상수 `RATING_START_ELO`, `BALANCE_ELO_WEIGHT_MAX`, `BALANCE_FULL_WEIGHT_GAMES`를 import만 했다. shared는 고치지 않았다(고칠 필요도 없었다).

**테스트:** `computeSkill` 기존 describe를 20-3 표 9행(`it.each`) + null ≡ `RATING_START_ELO` + 범위 오류(−1, 1.5, NaN)로 교체. `balanceEloWeight` 0·1·5·10·11 값과 −1·1.5·NaN RangeError. 0.5 반올림 경계 테스트는 계약대로 두지 않았다. season.test.ts에서 세 describe(softResetElo, seasonStartElo, pickPreviousRating)와 import를 삭제(`shuffled`·`mulberry32`는 다른 테스트가 써서 유지).

**검증:**

- `corepack pnpm --filter @gcd/core typecheck` 통과, `corepack pnpm --filter @gcd/core build`로 dist 재빌드(`dist/balance.js`에 `balanceEloWeight` 있음).
- 테스트: 저장소 `vitest.config.ts`가 Node 20.11에서 `ERR_REQUIRE_ESM`으로 로드되지 않아, 같은 내용의 임시 설정 `/tmp/gcd-core-vitest.mjs`(`resolve.conditions`·`ssr.resolve` `source`, `include: ['src/**/*.test.ts']`)로 `npx vitest run --config /tmp/gcd-core-vitest.mjs` 실행 후 삭제. **9파일 355개 전부 통과**.
- `rg 'softResetElo|seasonStartElo|pickPreviousRating|SEASON_SOFT_RESET' packages/core`(dist 포함) 결과 없음.

**core 바깥 사용처(backend·frontend가 고칠 것, 작업 시점 rg):**

| 담당 | 위치 |
| --- | --- |
| backend | `scrim-results.service.ts:7, 218`(`seasonStartElo`), `rating-inputs.service.ts:2, 81, 87`(`seasonStartElo`, `computeSkill({ gamesPlayed })`), `rating-carry.ts`(`pickPreviousRating`, 파일 삭제 대상), `config/env.ts:17, 137–139, 269`, `env.spec.ts:162–176`, `test/dashboard.e2e.spec.ts:66`, `test/season-transition.e2e.spec.ts:136–137` |
| frontend | `lib/elo-info.ts:1, 19–20, 53`(`softResetElo`, `SEASON_SOFT_RESET_CENTER`), `lib/api/mock/ratings.ts:198`(`computeSkill({ gamesPlayed })`), `lib/api/mock/rankings.ts:30, 388` |

**해석:** 없음. 계약 20-3 그대로 구현했다.

## 미실행

- 저장소 `vitest.config.ts`와 `pnpm --filter core test`를 그대로 실행하지 않았다(위 임시 설정 사용). Node 22 이상에서 돌린 결과가 아니다.
- `pnpm -r typecheck`, api·web 테스트는 돌리지 않았다. backend·frontend가 이 함수들을 호출하는 코드는 검증하지 않았다.
- 커밋하지 않았다.
