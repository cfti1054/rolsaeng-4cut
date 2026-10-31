# QA: s5_core (packages/core time.ts·activity.ts·index.ts) — 판정: pass

대상: `packages/core/src/time.ts`(S5 추가분), `packages/core/src/activity.ts`(신규), `packages/core/src/index.ts`, `time.test.ts`(S5 절), `activity.test.ts`
기준: `_workspace/01_architect_contract.md` 9절(9-1, 9-2, 「테스트 필수」), 6-2·6-6·6-7·5-5·8절, shared `bot.ts`·`dashboard.ts`·`discord-link.ts`·`rankings.ts`
구현 보고서: `_workspace/02_domain-logic-dev_report.md`

사용 도구: Read, Bash, Write(이 보고서만), SubagentHandback

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `packages/core`에서 임시 `vitest.qa-tmp.config.mjs`(기존 vitest.config.ts와 같은 resolve/ssr 조건) → `npx vitest run -c …` → 설정 파일 삭제 | 10 파일 415개 통과(time.test.ts 39, activity.test.ts 48) |
| `corepack pnpm typecheck` (packages/core) | 종료 코드 0 |
| 독립 경계 프로브(scratchpad `probe.test.ts`, 패키지 밖, 임시 설정은 실행 후 삭제) 9개 | 9개 통과(아래 「직접 확인한 경계」) |
| `node -e "require('./dist')"`로 신규 13개 함수 존재 확인, `find src -newer dist/index.js` | 누락 0, dist보다 새 소스 없음(dist 최신) |
| `git status --short packages/core` | 임시 설정 파일이 남지 않음 확인 |

`corepack pnpm --filter @gcd/core test`는 Node 20.11에서 vitest.config.ts 로딩이 실패(ERR_REQUIRE_ESM)하는 환경 문제로 그대로 실행하지 않았다(코드 결함 아님, 구현 보고서와 같은 관찰).

## 시그니처·규칙 대조 (계약 9절 ↔ 구현)

| 함수 | 시그니처 | 규칙 | 비고 |
| --- | --- | --- | --- |
| kstMonthWindow | 일치 | 일치 | 12월 → 다음 해 1월 Date.UTC 넘김 확인 |
| activityPeriodWindow | 일치 | 일치 | week = kstWeekWindow 결과 그대로 + 7, month days = (end−start)/DAY 반올림 |
| kstDateKey | 일치 | 일치 | Intl Asia/Seoul과 2000개 시각 대조 일치 |
| checkActivityEventTime | 일치 | 일치 | TOO_OLD 먼저, 경계 같으면 허용(`<`, `>`) |
| planActivityBatch | 일치 | 일치 | 판정 순서 6-2·shared bot.ts 주석과 같음, insert된 키만 「요청 안 중복」 집합에 넣음 |
| buildActivityRanking | 일치 | 일치 | 0초 제외, 3단계 동점, 코드 단위 비교 |
| pickMainGames | 일치 | 일치 | 기본 max = ACTIVITY_MAIN_GAMES_MAX(2) |
| buildPlaytimeRanking | 일치 | 일치 | |
| planMemberEvents | 일치(반환 원소 타입을 `MemberEventStatus` 별칭으로 표기, 구조 동일) | 일치 | 미래 한도 `>` now+300초, 같은 시각 stale, finals userId ASC, eventIndexes 오름차순 |
| presenceState | 일치 | 일치 | `≤ 300초` live, 미래 live |
| checkPresenceCapture | 일치 | 일치(값) | 상수 출처는 결함 #1 |
| nowPlayingItems | 일치 | 일치 | 출력은 4필드 새 객체(추가 필드 제거 확인) |
| discordLinkCodeState | 일치 | 일치 | used → revoked → expired(≤) → active |

index.ts: 신규 13개 함수 + `ActivityPlan` export 확인(추가로 `MemberEventStatus`·`MemberEventFinal` 타입). 계약 「13개」와 일치.

## 상수 ↔ @gcd/shared

| core 사용 | shared 값 | 위치 |
| --- | --- | --- |
| BOT_ACTIVITY_MAX_AGE_DAYS | 7 | shared/src/bot.ts:96 |
| BOT_ACTIVITY_FUTURE_TOLERANCE_SEC | 300 | bot.ts:98 |
| BOT_PRESENCE_STALE_AFTER_SEC | 300 | bot.ts:379 |
| ACTIVITY_MAIN_GAMES_MAX | 2 | rankings.ts:160 |
| DASHBOARD_NOW_PLAYING_MAX | 5 | dashboard.ts:148 |

core에 정책 값 하드코딩 없음(DAY_MS·KST_OFFSET_MS는 기존 core config). 24시간(BOT_ACTIVITY_MAX_DURATION_SEC)은 shared 스키마(`bot.ts:123`)가 막는 값이라 core 함수에는 없다. 계약 9-2도 core에 요구하지 않으므로 정상.

## 직접 확인한 경계 (프로브)

- KST 달: 2024–2032년 108개월 모두 days = 달력 날짜 수, start = 그 달 1일 00:00 KST, `start−1ms` → 이전 달, `end−1ms` → 이번 달, `end` → 다음 달.
- KST 주: 2026-10-25부터 21일 동안 1시간 간격 504개 시각 모두 start가 월요일 00:00 KST, start ≤ t < end.
- 7일: 정확히 now−7일 + 86400초 이벤트 허용. 24시간 이벤트의 끝이 정확히 now+300초면 허용, +1ms면 ENDS_IN_FUTURE.
- 배치: [rejected, rejected, ok, ok, rejected] 같은 키 → rejected, rejected, insert, duplicate, duplicate(insert 뒤에는 시각 초과도 duplicate, 판정 순서대로).
- 입퇴장: guild_membership_at이 now보다 미래(시계 차이)면 join stale. 판단 시각 사이에 낀 이른 이벤트는 stale, eventIndexes는 applied 위치만.
- presence: 정확히 300000ms live, 300001ms stale. checkPresenceCapture now−300초 허용.
- 코드: expiresAt == now → expired.

## 「테스트 필수」 대조

| 항목 | 테스트 위치 | 판정 |
| --- | --- | --- |
| 월 경계 1/31 23:59 KST ↔ 2/1 00:00(UTC 1/31 15:00) | time.test.ts `kstMonthWindow (S5)` 첫 케이스 | 있음 |
| 윤년 2월 29일 days | `activityPeriodWindow` month days(2028-02 = 29) | 있음 |
| 주 경계 일↔월 | `activityPeriodWindow` 주 경계 | 있음 |
| 시각 한도 ±1ms(7일, 300초) | `checkActivityEventTime` 과거·미래 | 있음 |
| 배치 안 같은 키 3번 | `planActivityBatch` | 있음 |
| rejected 뒤 같은 키 정상 → insert | 〃 | 있음(unlinked 경우 추가) |
| stored 키 + 시각 초과 → duplicate | 〃 판정 순서 | 있음 |
| 동점 3단계 | 활동·주 게임·플레이타임 | 있음 |
| 입력 순서 섞어도 동일 | 〃 permutations | 있음 |
| 0초 제외 | 〃 | 있음 |
| 입퇴장 뒤바뀜 3경우(6-6 표) | `planMemberEvents` 뒤바뀜 1–3 | 있음 |
| leave→join 최종 join·revokeTokens false | 〃 첫 케이스 | 있음 |
| 미래 이벤트 rejected | 〃 | 있음(정확히 +300초 허용 포함) |
| presence 300초 live, +1ms stale | `presenceState` | 있음 |
| used이면서 만료 → used | `discordLinkCodeState` | 있음 |

누락 없음.

## 구현 보고서 「해석」 절 판단

| # | 해석 | 계약과 어긋남? |
| --- | --- | --- |
| 1 | 잘못된 Date·음수·비정수에 RangeError | 아니다. 기존 core와 같은 방식이고 shared 스키마가 먼저 막는다. 단 backend가 SQL `SUM` 결과를 bigint 그대로 넘기면 `Number.isInteger(10n)`이 false라 RangeError → 500이 된다. 계약 7-1이 `::int`/`Number()` 변환을 요구하므로 backend 검증 때 확인할 항목(core 결함 아님) |
| 2 | 「요청 안 중복」 집합에 insert 키만 | 아니다. 계약 「rejected·unlinked 키는 쓰지 않는다」와 같고 stored 키는 이미 storedKeys로 duplicate다 |
| 3 | guild_membership_at null이면 첫 이벤트 applied, 같은 시각 stale, rejected는 판단 시각 불변 | 아니다. 6-6 「늦으면 applied, 아니면 stale」, shared bot.ts 「같거나 더 늦은 … stale」, backend 조건부 update(`lt`)와 같다 |
| 4 | nowPlayingItems count·name 동률은 안정 정렬(입력 순서) | 아니다. 계약은 2단계 정렬과 「같은 name 합치지 않음(봇 책임)」만 정한다. 결함 #2(minor, 관찰) 참고 |
| 5 | TOO_OLD 한도에 `BOT_ACTIVITY_FUTURE_TOLERANCE_SEC` 재사용, 「shared에 전용 상수가 없다」 | 값(300)은 계약 9-2와 맞다. 그러나 근거가 틀렸다. shared `bot.ts:410`이 TOO_OLD를 `now − BOT_PRESENCE_STALE_AFTER_SEC`로 정해 두었다. 결함 #1 |
| 6 | usedAt·revokedAt은 null 여부만 | 아니다. 5-5 우선순위 그대로 |
| 7 | chat(0초)은 startedAt > now+300초면 ENDS_IN_FUTURE | 아니다. 계약 식 `startedAt + durationSec > now + 300초`에 0을 넣은 결과 |

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | packages/core/src/activity.ts:24, packages/core/src/activity.test.ts:439-442 | shared `bot.ts:410` 주석대로 checkPresenceCapture의 TOO_OLD 한도는 `BOT_PRESENCE_STALE_AFTER_SEC`이어야 한다. 그래야 「받아들인 접속 현황은 받을 때 live」라는 관계가 상수가 바뀌어도 유지된다 | `PRESENCE_PAST_TOLERANCE_MS = BOT_ACTIVITY_FUTURE_TOLERANCE_SEC * 1000`. 테스트도 `FUTURE_MS`로 경계를 잡아 두 상수가 달라져도 잡지 못한다. 지금은 두 값이 모두 300이라 동작 차이 없음 | `grep -n PRESENCE_PAST_TOLERANCE_MS packages/core/src/activity.ts`, `sed -n 408,412p packages/shared/src/bot.ts` |
| 2 | minor(관찰) | packages/core/src/activity.ts:268 | (계약 미정) count·name이 같고 game/steam_app_id만 다른 행은 결과 순서가 정해지지 않는다 | 안정 정렬이라 입력 순서를 따른다. 봇이 같은 name을 보내지 않는다는 전제(계약 「봇 책임」)라 계약 위반은 아니다. 결정적 순서가 필요하면 architect가 3단계 키(예: game, steam_app_id)를 정할 일 | `nowPlayingItems([{name:'x',game:'lol',steam_app_id:null,count:1},{name:'x',game:null,steam_app_id:null,count:1}])`와 순서를 바꾼 입력의 결과가 다르다 |

blocker·major 없음 → **pass**.

## 연결부 메모 (다음 검증 대상에 넘김)

- 현재 신규 core 함수 소비처는 `apps/api/src/modules/rankings/ranking-calculator.service.ts`(activityPeriodWindow, buildActivityRanking, pickMainGames, buildPlaytimeRanking)뿐이다. planActivityBatch·planMemberEvents·presenceState·checkPresenceCapture·nowPlayingItems·discordLinkCodeState·kstMonthWindow·kstDateKey는 아직 backend에서 쓰지 않는다. backend 검증 때 계산식 재구현 여부와 함께 확인할 것.
- backend가 `buildActivityRanking`에 bigint를 넘기지 않는지(해석 1).
- 6-6 backend 조건부 update 영향 0행 → 그 사용자 `eventIndexes`를 stale로 바꾸는 처리가 있는지.
