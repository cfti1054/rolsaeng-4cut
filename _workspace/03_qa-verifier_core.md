# QA: core (S1 packages/core 함수 7개) — 판정: pass

작성: qa-verifier, 2026-10-28
대상: `packages/core/src/{config,time,profile,riot,index}.ts` + 테스트 3개. 구현자 보고서: `_workspace/02_domain-logic-dev_report.md`
기준: 계약 10절, 13절 logic, 체크리스트 `_workspace/03_qa-verifier_plan.md` B절.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter @gcd/core test` | 3 files, **79 passed** (time 20, profile 15, riot 44) — 보고서 수치와 같음 |
| `TZ=America/New_York corepack pnpm --filter @gcd/core test` | 79 passed |
| `TZ=Pacific/Kiritimati corepack pnpm --filter @gcd/core test` | 79 passed (UTC+14 — 서버 시간대와 무관) |
| `corepack pnpm --filter @gcd/core typecheck` | exit 0 |
| `corepack pnpm --filter @gcd/core build` | 성공(dist CJS) |
| `grep -rn "Date.now\|new Date()\|Math.random\|getTimezoneOffset\|setHours\|getHours\|getDate()\|toLocale" packages/core/src`(테스트 제외) | 코드 0건(riot.ts:14 주석 1건뿐) — 시계·난수·로컬 시간대 의존 없음 |
| QA 독립 검사 스크립트(scratchpad `core_check.cjs`, 빌드된 dist 대상) | 실패 0: ① ratio를 1≤k≤s≤20 전 조합에서 정확한 유리수 반올림(half-up)과 비교 + `MainPosition.parse` ② 2020–2029 무작위 20,000개 시각에서 `kstDayWindow`가 KST 달력 날짜 기준 start·24h end, `buildSyncQuota.resets_at` 시각 = end, `SyncQuota.parse` 통과 ③ 모든 RiotTier×RiotDivision의 `toRankValue` 결과 `RankValue.parse` 통과 ④ `pickVerificationIcon` 현재 아이콘 −1–30 × random 100단계에서 현재와 다르고 0–28 안 |

## 계약 10절 대조

| 함수 | 시그니처 | 규칙 | 근거 |
| --- | --- | --- | --- |
| kstDayWindow | 일치 | KST 23:59:59.999 / 00:00:00.000, UTC 14:59:59.999Z / 15:00Z 경계 테스트 있음(time.test.ts:14-31), 음수 epoch 내림 | time.ts:15-21 |
| buildSyncQuota | 일치 | remaining=max(0,…)(used>limit 테스트), resets_at `YYYY-MM-DDT00:00:00.000+09:00`, 계약 예시값 그대로(time.test.ts:84-87) | time.ts:51-61 |
| computeMainPosition | 일치 | 앞 20개(null 포함) 자른 뒤 null 제외 = sample_size, 0이면 null, 내림차순·동률 LolPosition 순서, 최대 2개, 둘째 자리 반올림, source 고정 | profile.ts:14-40 |
| pickVerificationIcon | 일치 | 후보 = `RIOT_VERIFICATION_ICON_IDS` − 현재, `floor(random()*n)` | riot.ts:18-30 |
| toRankValue | 일치 | undefined→UNRANKED 0/0/0, apex division null, 모르는 tier·(비 apex) rank → 예외 | riot.ts:54-80 |
| isSameRank | 일치 | 5개 필드, 필드별 1개만 다른 경우 테스트(riot.test.ts:129-137) | riot.ts:83-91 |
| isMatchesCacheStale | 일치 | null→true, 정확히 6h→true, 6h−1ms→false, 기본값 `RECENT_MATCHES_TTL_HOURS` | riot.ts:99-113 |

shared 상수 재사용(`RIOT_VERIFICATION_ICON_IDS`, `RECENT_MATCHES_MAX`, `RECENT_MATCHES_TTL_HOURS`, `RIOT_APEX_TIERS`, `LolPosition`, `RiotTier`, `RiotDivision`) — 값 복제 없음. `@gcd/shared` 외 의존 없음(package.json).

## 「해석」 1–6 판단 (계약 위반 여부)

| # | 해석 | 판단 | 이유 |
| --- | --- | --- | --- |
| 1 | apex 티어는 rank 문자열 검사 안 함 | **위반 아님**(문구 보완 권고) | 계약 10절 「모르는 tier·rank 문자열 → 예외」를 글자 그대로 읽으면 apex의 이상한 rank도 예외여야 하지만, 같은 행이 「apex면 division null」이고 shared `riot.ts:424`가 「라이엇은 apex에도 rank='I'를 주지만 저장·응답은 null」로 rank를 의미 없는 값으로 정의한다. 버려지는 값 때문에 동기화를 INTERNAL_ERROR로 실패시킬 이유가 없다. architect가 10절에 「apex는 rank 무시」 한 줄을 넣으면 해석 여지가 사라진다 |
| 2 | 입력 검증 실패는 전부 `RangeError` | **위반 아님** | 계약이 정한 예외는 toRankValue 모르는 값뿐이고 나머지는 정상 입력에서 발생할 수 없는 경우(음수 횟수, Invalid Date, 비정수 LP, 타입 밖 포지션)다. 정상 경로 동작은 계약과 같다. backend·integration은 `toRankValue` 예외를 잡아 INTERNAL_ERROR로 기록해야 함(integration 검증 때 확인) |
| 3 | random ≥1 → 마지막, 음수 → 처음, NaN → 예외 | **위반 아님** | random이 [0,1)이면 `floor(random()*n)`과 결과가 같다(riot.ts:28). 범위 밖 처리는 추가 방어일 뿐 |
| 4 | 20개 자른 뒤 null 제외, `round(count*100/sample)/100` | **계약 그대로** | 10절 「앞 20개만, null 제외한 수 = sample_size」. 반올림은 독립 검사로 전 조합 확인 |
| 5 | synced_at이 미래면 false, ttl 0이면 항상 true | **위반 아님** | 계약식 `now − synced ≥ ttl`과 같은 결과(미래면 음수라 false). 단 보고서 문구 「ttl 0이면 항상 true」는 부정확: 미래 시각 + ttl 0은 false(QA 실행 `isMatchesCacheStale(new Date(2000), new Date(1000), 0)` → false). 코드는 계약대로라 결함 아님, 보고서 문구만 틀림 |
| 6 | 추가 export(`formatKstMidnight`, `MAIN_POSITION_MAX`, `RiotLeagueEntryLike`, config 상수) | **위반 아님** | 계약 함수 7개를 바꾸지 않는 추가. `RiotLeagueEntryLike`는 계약 9절 `RiotLeagueEntry`와 구조 호환(같은 5필드 + 추가 필드 허용 테스트 riot.test.ts:116) |

## 결함

없음 (blocker 0, major 0, minor 0).

참고(결함 아님):
- 보고서 해석 5의 문구 부정확(위 표).
- 보고서는 리더가 옮겨 적은 것이라 수치를 직접 재실행으로 확인함(79 passed 일치).
- backend가 `SYNC_LIMIT_EXCEEDED`의 `Retry-After`를 `kstDayWindow(now).end − now` 올림으로 계산하는지, integration이 `RangeError`를 INTERNAL_ERROR로 기록하는지는 각 대상 검증(D7, C5)에서 본다.
