# QA: S3 packages/core (rating.ts, balance.ts, season.ts, config.ts, index.ts) — 판정: pass

대상: `packages/core/src/rating.ts`, `balance.ts`, `season.ts`, `config.ts`, `index.ts` + 각 테스트
기준: 계약 `_workspace/01_architect_contract.md` 6절, 7-1~7-5, 13절 logic·qa 항목, D103–D108·D115·D116 / 문서 7-1·7-2
구현 보고서: `_workspace/02_domain-logic-dev_report.md`
사용한 도구: Read, Grep, Glob, Bash, Write(이 보고서와 스크래치 스크립트만). 코드 수정 없음.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter core typecheck` | `tsc -p tsconfig.json --noEmit` 출력 없음(오류 0) |
| `corepack pnpm --filter core test` | time 20, no-show 24, rating 33, profile 15, scrim 52, season 17, riot 44, balance 33 → **Test Files 8 passed (8), Tests 238 passed (238)** |
| dist 신선도 | `dist/{rating,balance,season,config,index}.js` 11:40:20 > `src/*.ts` 최신 11:35:47. api 런타임이 읽는 dist에 S3 export 존재 |
| 순수성 grep | 대상 4파일에 `Date.now`·`Math.random`·`new Date()`(인자 없음)·`process.` 없음. 의존은 `@gcd/shared`만(package.json) |
| 독립 재현 스크립트(dist 대상) | `C:\Users\cfti1\AppData\Local\Temp\claude\c--Users-cfti1-Documents-GitHub-rolsaeng-4cut\42dbd1e3-68d5-43b6-8e9d-c229b0cff450\scratchpad\s3core.cjs` → **checks 164,451, failures 0** |
| 성능 보조 측정 | `...\scratchpad\perf2.cjs`(아래 결함 1) |

다른 패키지 빌드·테스트는 지시대로 실행하지 않았다.

### 독립 재현 내용 (계약 식을 스크립트에 따로 구현해 대조)

- **검증 수치(7-3)**: 1000 대 1000 K32 → +16/−16. 팀 평균 1400 대 1300 → E = 0.6401, 블루 승 +12·오렌지 −12, 블루 패 −20·오렌지 +20. `previewTeamElo` 같은 값. K 경계 0·9 → 40, 10 → 32, 사용자 정책(5경기 경계) 동작. 4명 동일 1000 순위 → +16/+5/−5/−16, outcome win/win/loss/loss.
- **반올림**: ±2.5 → ±3, ±0.5 → ±1, ±1.49 → ±1, −0.4·−0 → +0(−0 아님), ±2.4999999999999996 → ±3, 1.4999999985 → 1, 1.4999999995 → 2(1e-9 가산 규칙 그대로). K33·E=0.5 → −17/+17 대칭.
- **팀 ELO 무작위 20,000건**: 팀 1–8명, 무작위 정책·경기 수·elo. 출력 전체(eloBefore/After·delta·kFactor·outcome·순서) 참조 구현과 일치. 같은 K·같은 인원이면 delta 합 = 0(위반 0). 같은 K면 블루 1인 delta = −오렌지 1인 delta(반올림 대칭).
- **개인 순위 무작위 20,000건**: M 2–16, 비연속·뒤섞인 placement. 쌍대 ELO 참조 구현과 전부 일치(재매김 rank, K/(M−1), D105 outcome). 같은 K면 |Σdelta| ≤ M/2. 2명 순위 = 1:1 팀 ELO(200건). M = 1·placement 중복·빈 팀 RangeError.
- **D105 상위 절반**: M 2–16 모두 승리 수 = ⌊M/2⌋, 8명 1–4위, 3명 1위만.
- **시드 표**: 10티어 + UNRANKED·null·undefined 일치. `RATING_SEED_BY_TIER` 키 = shared `RiotTier.options`. 상수 1000/400/50/{0,1,3} 일치.
- **승률**: 0경기 null, 2/3 → 0.667, x.xxx5 경계 6건(1333/2000 등) 반올림 일치.
- **selectRatedParticipants 5,000건**(팀·개인 각각): 상태 4종·팀 null 혼합·명단 밖 user 포함. 참조 구현과 일치(skip 조건, 입력 순서, 재매김).
- **balanceTeams 브루트포스 1,500건**: n 2–12(포지션 사용 2–10), 실력값을 거칠게 만들어 동점 다수 유발, 빈·1개·중복 선호. 기준 구현은 2^n 마스크(블루 = bit0 포함, 크기 ⌊n/2⌋·⌈n/2⌉) × 팀별 전체 순열 포지션 배정. 상위 3안의 나누기·members 순서(포지션 순 / skill DESC → userId ASC)·포지션·preference·positionCost·skillSum·powerDiff·totalCost·blueWinProbability·ratingAvg 모두 일치. `partitionsEvaluated`도 일치. `evaluateTeams`(1안 입력) 값 = balanceTeams 1안. 같은 입력 2회 결과 동일(결정성).
- **나누기 수 표**: n = 2…16 전부 짝수 C(n,n/2)/2, 홀수 C(n,⌊n/2⌋)와 일치(9명 126, 16명 6435).
- **블루·크기·서로 다른 안 300건**: 블루에 항상 players[0], 팀 크기 ⌊n/2⌋:⌈n/2⌉, 3안 나누기 서로 다름, totalCost 오름차순.
- **computeSkill 5,000건**: w = min(g/10, 1), seasonElo null → 시드. 일치.
- **시즌**: KST 자정 경계(UTC 15:00 → 11월, 1ms 전 → 10월), 1/31+1 = 2/28(윤년 2/29), KST·UTC 날짜가 다른 시각(KST 1/31 23:30, KST 3/31 08:00) 말일 자르기·KST 시각 유지. `addKstMonths`(±30개월)·`kstMonthStart` 무작위 20,000건 참조 구현과 일치. 계약 예 「시즌 1」 2026-11-01 ~ 2027-02-01 KST, 「시즌 2」 2027-02-01 ~ 2027-05-01 KST 일치. **planAutoSeason 무작위 약 20,000건**(기존 시즌 0–5개, 길이 1–6개월): 6절 1–4 참조 구현과 이름·시작·끝 전부 일치, at 포함·기존 시즌과 겹침 0. 이미 시즌 안이면 RangeError. `resolveSeasonAt` 반열림·동률 id ASC, `latestStartedSeason` 일치.

## 계약 대조

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 7-1 상수 | 일치(값·타입 `Readonly<Record<RiotTier, number>>`) | config.ts:30-49 |
| 7-2 타입 10개 | 일치 | rating.ts:9-21, balance.ts:16-40, season.ts:8 |
| 함수 23개 시그니처 | 23개 모두 7-3~7-5와 동일. `selectRatedParticipants` 반환은 별칭 `RatedParticipantsSelection`(같은 유니온) | rating.ts:36-228, balance.ts:67-365, season.ts:32-111 |
| index export | 23개 함수 + 7-2 타입 + 별칭 1개. S1·S2 export 유지 | index.ts:44-83 |
| D104 팀 ELO | 팀 평균(반올림 전), 참가자별 K, delta 반올림, 하한 없음, 출력 blue→orange | rating.ts:77-112 |
| D105 개인 순위 | 모든 쌍 1:1, K/(M−1), 상위 절반 승 | rating.ts:115-162 |
| D106 K 판정 | gamesPlayed 인자(반영 전), `< newPlayerGames` → kNew | rating.ts:42-45 |
| D107 실력값 | 정수 반올림 | balance.ts:67-75 |
| D108 밸런스 | 나누기·블루 고정·전력 차·λ 50·동점 순서·상위 3안·members 순서 | balance.ts:194-270 |
| D115 반영 대상 | joined && team / joined && 순위, skip 조건 | rating.ts:199-229 |
| D116 시즌 | 6절 1–4, 반열림, KST 달 1일, 말일 자르기 | season.ts:46-111 |
| 순수성 | 시각은 Date 인자, K는 EloPolicy 인자, 난수 없음 | 위 grep |
| 표시 반올림 위치 | core는 반올림 전 값(7-4 7번) | balance.ts:261-268 |

## 13절 logic 테스트 목록 대 테스트

| 항목 | 위치 |
| --- | --- |
| 7-3 검증 예(+16/−16, +12/−20, 0.640, K 9/10, 4명 순위) | rating.test.ts:78-81, :98, :145-151, :326 등 |
| 반올림 x.5 양쪽 부호·부동소수 | rating.test.ts:110-118 |
| 10명 126·3안·오름차순, 16명 6435 < 200ms, 10명 포지션 < 200ms, n별 나누기 수 | balance.test.ts:170, :191, :201, :211 |
| 브루트포스 대조 | balance.test.ts:158(200회 루프 포함) 및 무작위 60건 |
| 시즌 KST 경계·말일·계약 예·무작위 겹침 없음 | season.test.ts:32-47, :136 |

13절 목록은 모두 테스트에 있다.

## 결함

blocker 0, major 0, minor 3.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | packages/core/src/balance.ts:93-127 (`bestPositionAssignment` DFS), :219-232 | 밸런스는 2–16명 어떤 games 행에서도 요청 시간 안에 끝난다(D108 「16명 전수 가능」). games.positions는 DB 데이터라 이후 포지션 수가 늘 수 있다 | 포지션 배정이 순열 DFS(P(p,k))라 선호가 한쪽에 몰리면 가지치기가 거의 안 된다. 포지션 6개·12명 46ms, 7개·14명 1.0초, **8개·16명 71초**(이벤트 루프 차단). 현재 카탈로그에서 포지션이 있는 게임은 롤(5개, 최대 10명, 5ms)뿐이라 지금은 도달 불가 | `perf2.cjs`·`s3core.cjs` 성능 항목: 16명, positions 8개, 전원 preferred ['a','b'] → `balanceTeams` 71,125ms. 포지션 수가 5를 넘는 게임을 추가하기 전에 비트마스크 DP(k × 2^p)나 헝가리안으로 바꾸거나 계약에 「포지션 수 ≤ 5」 전제를 적을 것 |
| 2 | minor | packages/core/src/season.ts:102-107 (보고서 해석 6) | 자동 시즌이 「KST 달 1일」 경계에 맞춰 이어진다(D116 문구 「KST 달 1일 시작(또는 직전 시즌 끝)」) | 직전 시즌이 월말 임의 시각에 끝난 경우(수동 시즌) 공백 건너뛰기가 `addKstMonths` 연쇄라 날짜가 밀린다: 끝 2027-01-31 10:00 KST → 4/30 10:00 → 7/30 10:00 … 계약 6절 문구를 그대로 따른 결과라 위반은 아니다 | `planAutoSeason({seasons:[{…, endsAt: KST 2027-01-31 10:00}], at: KST 2027-08-15, lengthMonths: 3})` → startsAt 2027-07-30 10:00 KST. 수동 시즌 관리(S4·S6) 때 architect가 정할 것 |
| 3 | minor | packages/core/src/config.ts:5, :19 | 머리 주석이 현재 상수를 설명 | 「S1: KST 기간 계산 상수만. 레이팅·밸런스·노쇼 값은 S2–S4에서 추가」, 「노쇼 3회/30일/1일」 — S3 상수가 이미 같은 파일에 있어 주석이 낡았다(동작 영향 없음) | 파일 열람 |

## 계약 변경 요청 R1·R2 평가

| # | 평가 | 근거 |
| --- | --- | --- |
| R1 홀수 인원 블루 index 수열 비교 = 일반 사전순(접두가 같으면 짧은 쪽 먼저) | **수용 권장**. 구현(balance.ts:55-61)이 그 규칙이고, 독립 브루트포스(같은 규칙)와 동점 다수 입력에서 일치. 결과: 전원 동점이면 블루가 작은 팀이 된다. 결정성에는 문제 없음. 계약 7-4 5번에 한 줄 추가하면 frontend 목 백엔드(core import)·backend가 같은 순서를 보장받는다 |
| R2 evaluateTeams members = 입력 순서 | **수용 권장**. 계약 7-4 6번은 balanceTeams 규칙이고 evaluateTeams에는 순서 규칙·positions 인자가 없어 구현 해석이 유일하게 가능한 단순안. backend가 상세 슬롯 순서(5-3 저장 순서)로 넘기면 화면 순서가 저장 순서와 같다. 포지션 순 표시가 필요하면 화면에서 `game.positions`로 정렬. backend QA 때 넘기는 순서를 확인할 것 |

## 참고 (core 범위 밖, 다른 대상 검증 때 확인할 것)

- 보고서 해석 4: `balanceTeams`의 userId 중복 RangeError가 backend에서 SCRIM_BALANCE_UNAVAILABLE로 나간다. scrim_players (scrim_id, user_id) 유일이라 정상 경로에선 생기지 않음.
- backend QA: 승인 경로가 `selectRatedParticipants` → `computeTeamEloUpdates`/`computePlacementEloUpdates`를 호출하고 delta·k_factor를 재계산하지 않는지, gamesPlayed가 시즌 무관 (user, game) 이력 수인지(D106), `previewTeamElo`에 `ratingAvg`·`kBase`를 넘기는지(5-2 6번), `planAutoSeason`에 시즌 전체 목록을 넘기는지(이름 = 행 수 + 1).
- 표시 반올림(skill_avg 등 정수, blue_win_probability 소수 셋째)은 backend 직렬화 책임(7-4 7번).
