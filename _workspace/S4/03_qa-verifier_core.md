# QA: S4 packages/core — 판정: pass

대상: `packages/core/src/{ranking,season,time,config,index}.ts`와 테스트.
기준: 계약 9절, 6-1, 9-2, 7-7, 문서 7-3, `qa-boundary-check` 스킬.
blocker 0, major 0, minor 3. 코드 수정·커밋 없음.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `packages/core`에서 `vitest run`(저장소 `vitest.config.ts`) | 실행 불가. Node 20.11에서 `ERR_REQUIRE_ESM`. 코드 결함이 아니라 환경 문제 |
| `vitest run --config <스크래치패드 임시 .mjs>`(같은 내용) | 9개 파일, 340개 전부 통과. 임시 설정은 저장소 밖에 두고 실행 후 삭제 |
| `tsc -p tsconfig.json --noEmit` | exit 0 |
| `tsc -p tsconfig.build.json --outDir <스크래치패드>` | exit 0. `dist`와 비교하면 `.js`·`.d.ts` 동일, `.js.map`은 `sources` 경로만 다름. `dist`는 현재 소스와 일치 |
| 계약 시그니처 타입 대조(스크래치 복사본, 타입 동등 검사 + 제네릭 호출 결과) | exit 0. 16개 함수 일치 |
| 값 재현 스크립트 `node qa-values.cjs`(`dist/index.js` 호출) | 단정 64건 통과, 전수 검사 위반 0 |
| 뮤테이션(스크래치 복사본, 단순화 후 코드 기준) | 53건 중 50건 검출, 3건 생존(아래) |

재현 스크립트: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/qa-values.cjs`

## 결함

| # | 심각도 | 위치 | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | `packages/core/src/ranking.ts:24-25`, `:28-29` | 보고서 표: 모르는 tier·division은 RangeError | Object 프로토타입 키는 `undefined` 검사를 통과해 NaN 반환. 타입 위반 입력이고 현재 호출 경로에서는 `RankValue` parse가 먼저 걸러 도달하지 않음 | `tierScore({tier:'constructor',division:null,lp:0})` → NaN. `tierScore({tier:'GOLD',division:'constructor',lp:0})` → NaN |
| 2 | minor | `packages/core/src/ranking.ts:71`, `:94-96` | 반환 타입 `T & {...}`대로 입력 필드 유지 | 호출자 행에 `value` 필드가 있으면 내부 정렬 키와 충돌해 조용히 사라짐. 현재 호출자 행에는 `value`가 없음 | `buildEloRanking({rows:[{userId:'a',elo:1,wins:5,losses:0,value:'caller'}],minGames:5})` → 결과에 `value` 없음 |
| 3 | minor(테스트) | `packages/core/src/season.ts:205`, `season.test.ts`의 `computeSeasonBadges` | 보고서의 「rank 0 포함, 1·2·3이 아닌 행 제외」가 테스트로 고정됨 | 코드 동작은 맞지만 테스트에 rank 0·음수·소수 입력이 없음 | `places.includes(s.rank)` → `s.rank <= 3` 변형이 전체 테스트를 통과. 동작 자체는 직접 확인: rank 0, −1, 1.5, 4 모두 제외 |

## 직접 재현

### 소프트 리셋 (6-1, ratio 0.5)

| 입력 | 결과 | 입력(음수 방향) | 변동분 | 결과 |
| --- | --- | --- | --- | --- |
| 1421 | 1211 | 999 | −0.5 → −1 | 999 |
| 1512 | 1256 | 997 | −1.5 → −2 | 998 |
| 1000 | 1000 | 995 | −2.5 → −3 | 997 |
| 1001 | 1001 | 579 | −210.5 → −211 | 789 |
| 800 | 900 | 1 | −499.5 → −500 | 500 |
| 1500 | 1250 | −1 | −500.5 → −501 | 499 |

- ratio 0 → 1000(−0 아님), ratio 1 → 그대로.
- 전수 대조: ratio 0.000–1.000(0.001 간격) × elo −2000–5000, 총 7,008,001건. BigInt 정확 계산과 불일치 0, 1000 기준 대칭 위반 0.
- ratio가 −0.01, 1.01, NaN, Infinity, 문자열, null, undefined면 RangeError.

### 동점 결정성

- 2/3 vs 4/6: 승률 동률이라 경기 수에서 4/6이 앞선다(양방향 부호 확인).
- value → 승률 → 경기 수 → userId 각 단계 값 확인.
- 표본 전수: 반대칭 위반 0, 추이성 위반 0/573,800.
- 0경기를 승률 0으로 둔 기준 비교기와 차이 0. 보고서의 「별도 분기 없이 같은 순서」 주장이 맞다.
- 300행을 섞어 buildEloRanking·computeSeasonStandings·buildTierRanking 각 200회 실행, 결과 차이 0. 순위는 1부터 연속.
- win_rate·games·rank·score는 shared 스키마 해당 필드를 통과.

### 그 밖의 계약 값

- 9-2 tierScore 검증 값 10개 일치. 디비전 순서 단조 증가.
- 7-7 표 3행 일치. `rank_change`는 기준 1·현재 3 → −2, 기준 없음 → null, 변동 없음 → 0.
- `isRankingStale`: 660초 false, 660.001초 true. 실패가 성공보다 늦으면 true, 같으면 false.
- `kstWeekWindow`: 60,000개 시각에서 월요일 00:00 KST·7일·구간 포함 위반 0. 일요일 23:59:59.999 KST ↔ 월요일 00:00(UTC 일요일 15:00) 경계 일치.
- `selectSeasonsToClose`: 유예 −1ms 제외, 경계 포함.
- `seasonDaysLeft`: 마지막 날 0, 끝난 뒤 0, 전날 1.
- `seasonProgress`: 1/3 → 0.333, 구간 역전도 NaN 없음.
- `index.ts`: 16개 함수 모두 export. `assertValidDate`는 공개되지 않음.

## 보고서의 추가 동작 대조

backend는 작업 중이므로 아래 호출부 내용은 지금 시점의 입력 형태 확인이며 backend 판정이 아니다.

| 추가 동작 | 판단 | 근거 |
| --- | --- | --- |
| buildEloRanking `minGames` RangeError | 계약 유지 | `RANKING_ELO_MIN_GAMES`는 `posInt`(`apps/api/src/config/env.ts:135`)라 정상 설정에서 발생하지 않음. 잘못된 값은 기동 시 env 검증에서 막힘 |
| tierScore 음수·비정수 LP, 모르는 값 RangeError | 호출 조건 유지. 단 결함 1 | 불량 행 1개가 있으면 buildTierRanking 전체가 RangeError(재현함). 7-2의 「형식 불량 제외」가 전제. 현재 호출부는 `RankValue` parse로 거른 뒤 호출 |
| 마스터 이상 디비전 무시 | D152와 일치 | MASTER I 10 → 2810. `MASTER V`도 RangeError 없이 2800(디비전을 보지 않으므로 계약과 충돌 없음). 다만 현재 호출부의 `RankValue`는 마스터+디비전 행을 제외하므로 이 경로에서는 쓰이지 않는 방어 코드다. `toRankValue`가 null로 저장하므로 정상 데이터에는 해당 없음 |
| GOLD + division null | 계약식 그대로 | 1200 + LP로 계산, RangeError 없음. `RankValue`에서는 불량 행 |
| seasonStartElo 시드 경로 ratio 검사 | 계약 유지 | `SEASON_SOFT_RESET_RATIO`는 0–1 검증(`env.ts:131-133`). `previousElo: undefined`도 RangeError로 막힘 |
| selectSeasonsToClose `graceMs` RangeError | 계약 유지 | 호출값은 `SEASON_CLOSE_GRACE_SEC × 1000` 상수 |
| computeSeasonBadges rank 1·2·3만 | 6-4와 일치 | 9-3의 「rank ≤ 3」보다 좁지만 `SeasonBadgePlace` 타입과 맞음. standings는 1부터 시작해 정상 경로에서 차이 없음 |
| rollRankBaseline 해석 1: 지난 기준 + payload null → `{이번 주, {}}` | 계약과 충돌 없음 | 7-7 표에 없는 경우. 7-2가 parse 실패를 null로 정했고 「기준 자료가 없으면 `—`」와 일치. 지난 기준을 이번 주에 재사용하지 않음 |
| 해석 2: 저장 기준 없음 + payload 있음 → `{이번 주, {}}` | 계약과 충돌 없음 | `baseline_period_start`는 NOT NULL이라 실제 경로는 `baseline_ranks` parse 실패뿐. 그 주는 전부 `—`가 되고 다음 계산부터 고정 |
| 해석 3: 저장 기준이 weekStart보다 새로움 → 그대로 | 계약과 충돌 없음 | 새 기준이 있으면 그 행의 `computed_at`이 현재 계산의 `now`보다 늦으므로 7-1 조건부 쓰기에서 버려진다. 결과는 저장되지 않음 |

## 뮤테이션 생존 3건

| 변형 | 분류 |
| --- | --- |
| `places.includes(s.rank)` → `s.rank <= 3` | 테스트 공백, 결함 3 |
| `if (t >= end)` → `if (t > end)` (`seasonProgress`) | 동등 변형. t = end면 다음 식도 1 |
| `{ ...(previousRanks ?? {}) }` → `previousRanks ?? {}` | 입력 객체 별칭 여부만 달라짐. 계약 위반 아님, 현재 호출부는 결과를 변경하지 않음. `결과는 입력과 별개 객체` 테스트는 stored 경로만 다룸 |

보고서의 「단순화 뒤 뮤테이션 미실행」 공백은 이번 재실행으로 메워졌다.

## 명세·계약 테스트 대조

9절 필수 테스트 전부 존재: 6-1 검증 값·표 5경우, 반올림 대칭, 연속 빈 시즌 리셋 1회, 겹친 시즌 결정성, 유예 경계 ±1ms, 동점 4단계, 입력 순서 섞기, 승률 교차 곱, 7-7 표, KST 주 경계, D-day.

`formulas.md` 3·5·7절과 일치. 문서 7-3의 소프트 리셋 식, 5경기 조건, 티어 점수 식과 일치.

## 미실행

- 저장소 `vitest.config.ts`와 `pnpm --filter core test`: Node 22 이상이 이 PC에 없어 실행 못 함. 임시 설정 결과이며 Node 22 결과가 아니다.
- `pnpm -r typecheck`, `pnpm -r test`, web build, `prisma validate`: 범위 밖. backend·frontend 동시 작업 중.
- backend·frontend가 core를 올바르게 쓰는지의 판정. 호출 입력 형태만 읽었다.
- 실제 DB 경로: 해당 없음(core는 I/O 없음).

## 이전 결함 재확인

S4 core 첫 검증이라 해당 없음.
