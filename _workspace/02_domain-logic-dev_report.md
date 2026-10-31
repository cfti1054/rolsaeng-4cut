# domain-logic-dev 보고서 — S5 (계약 9절, 14절 logic)

## 사용 도구
Read, Write, Edit, Bash, SubagentHandback

## 변경 파일
- `packages/core/src/time.ts` — `kstMonthWindow`, `activityPeriodWindow`, `kstDateKey` 추가
- `packages/core/src/activity.ts` (새 파일) — 10개 함수 + `ActivityPlan` 타입
- `packages/core/src/index.ts` — 13개 함수 + `ActivityPlan`, 보조 타입 `MemberEventStatus`·`MemberEventFinal` export
- `packages/core/src/time.test.ts` — S5 테스트 추가
- `packages/core/src/activity.test.ts` (새 파일)
- `packages/core/dist/**` — `tsc -p tsconfig.build.json`로 다시 빌드함(`require('./dist')` 스모크 확인)

## 함수 목록 (시그니처는 계약 9절 그대로)
| 파일 | 함수 |
| --- | --- |
| time.ts | kstMonthWindow, activityPeriodWindow, kstDateKey |
| activity.ts | checkActivityEventTime, planActivityBatch, buildActivityRanking, pickMainGames, buildPlaytimeRanking, planMemberEvents, presenceState, checkPresenceCapture, nowPlayingItems, discordLinkCodeState |

상수는 모두 `@gcd/shared` 값을 씀(BOT_ACTIVITY_MAX_AGE_DAYS, BOT_ACTIVITY_FUTURE_TOLERANCE_SEC, BOT_PRESENCE_STALE_AFTER_SEC, ACTIVITY_MAIN_GAMES_MAX, DASHBOARD_NOW_PLAYING_MAX). core에 새 상수 없음.

## 테스트
- core 전체 10 파일, 415개 통과. S5 대상(time.test.ts + activity.test.ts) 87개 통과.
- `typecheck`, `build` 통과.
- 실행 방법: Node 20.11에서 `vitest.config.ts`를 못 읽음(ERR_REQUIRE_ESM, vite 7 ESM 전용). 같은 내용의 임시 `vitest.tmp.config.mjs`로 돌린 뒤 지움. `corepack pnpm --filter @gcd/core test`는 Node 20에서 설정 로딩 단계에서 실패함(Node ≥22 필요, 코드 문제 아님).

9절 「테스트 필수」 대응:
| 항목 | 테스트 |
| --- | --- |
| 월 경계 1/31 23:59 KST ↔ 2/1 00:00(UTC 1/31 15:00) | kstMonthWindow 첫 케이스 |
| 윤년 2/29 days | activityPeriodWindow month days(2028-02 = 29, 2027-02 = 28) |
| 주 경계 일↔월 | activityPeriodWindow 주 경계 |
| 시각 한도 ±1ms(7일, 300초) | checkActivityEventTime 과거·미래 한도 |
| 같은 키 3번 | planActivityBatch |
| rejected 뒤 같은 키 정상 → insert | planActivityBatch(unlinked 뒤도 추가) |
| stored 키 + 시각 초과 → duplicate | planActivityBatch 판정 순서 |
| 동점 3단계, 입력 순서 섞기, 0 제외 | buildActivityRanking·pickMainGames·buildPlaytimeRanking |
| 입퇴장 뒤바뀜 3경우(6-6 표) | planMemberEvents 뒤바뀜 1–3 |
| leave→join 최종 join·revokeTokens false | planMemberEvents 첫 케이스 |
| 미래 이벤트 rejected | planMemberEvents(정확히 +300초는 허용) |
| presence 300초 live, +1ms stale | presenceState |
| used이면서 만료 → used | discordLinkCodeState 우선순위 |

## 해석 (계약에 명시가 없어 가장 단순한 쪽으로 정한 것)
1. **입력 검증 추가.** 기존 core와 같은 방식으로 잘못된 Date, 음수·정수 아닌 durationSec·초·분·일 수·max에 RangeError를 던진다. shared 스키마가 먼저 막으므로 정상 경로에서는 일어나지 않는다.
2. **planActivityBatch 「이 요청 안 중복」 집합**에는 insert된 키만 넣는다. stored로 duplicate된 키는 이미 storedKeys에 있어 결과가 같다.
3. **planMemberEvents**: 판단 시각이 null(guild_membership_at 없음)이면 첫 이벤트는 무조건 applied. 같은 occurredAt 두 번째는 stale(「늦으면」 = 엄격히 큼). rejected 이벤트는 판단 시각을 움직이지 않는다. `eventIndexes`는 입력 위치 오름차순. `finals[].leftAt`·`guildMembershipAt`은 입력 Date의 복사본.
4. **nowPlayingItems**: count·name이 모두 같은 행(game만 다름 등)은 안정 정렬로 입력 순서를 유지한다. 계약은 2단계 정렬만 정해 이 경우 결과가 입력 순서에 따라 달라질 수 있다(봇이 같은 name을 보내지 않는 전제, 계약 「합치지 않는다(봇 책임)」). 출력은 `{name, game, steam_app_id, count}`만 담은 새 객체.
5. **checkPresenceCapture TOO_OLD 한도 300초**는 계약 9-2 그대로 썼다. shared에 전용 상수가 없어 `BOT_ACTIVITY_FUTURE_TOLERANCE_SEC`(300)를 재사용하고 activity.ts 안에서 이름을 따로 붙였다(`PRESENCE_PAST_TOLERANCE_MS`). 별도 상수가 필요하면 shared에 추가해 달라.
6. **discordLinkCodeState**는 usedAt·revokedAt의 값(시각)은 보지 않고 null 여부만 본다(5-5 우선순위 그대로).
7. **checkActivityEventTime의 chat(0초)**은 시작 시각이 곧 끝 시각이라 `startedAt > now + 300초`면 ENDS_IN_FUTURE.

## 계약 모호·충돌 (변경하지 않음)
- 없음(시그니처 변경 없음). 위 4·5는 확인을 권함.
- 참고: `packages/core/package.json`의 test 스크립트는 Node ≥22 전제다(엔진 경고와 같은 원인). 완료 조건 `pnpm --filter core test`를 Node 20.11에서 그대로 돌리면 설정 로딩에서 실패한다.

---

## S5 수정 r1+r2 (계약 D232, D237, D239, 14-1·14-2절 logic) — 2026-10-31

### 사용 도구
Read, Write, Edit, Bash, SubagentHandback

### 변경 파일
- `packages/core/src/activity.ts`
  - `buildActivityRanking`: 제네릭 제약에서 `playSec` 제거, `totalSec = voiceSec`, `assertNonNegativeInt(row.playSec)` 제거. 머리 주석을 「음성만(D232), 다른 필드(playSec·scrimCount 등)는 통과만」으로 수정(r1, D232).
  - `discordLinkCodeState` 삭제, `DiscordLinkCodeState` import 삭제, 파일 머리 주석에서 「디스코드 연동 코드」 삭제(r2, D237).
  - `presenceState`·`checkPresenceCapture` 주석의 「300초」를 상수 이름으로 바꿈. 코드는 이미 TOO_OLD 한도에 `BOT_PRESENCE_STALE_AFTER_SEC`를 쓰고 있었다(`PRESENCE_PAST_TOLERANCE_MS`). 확인만 하고 주석만 고침(core QA minor).
- `packages/core/src/index.ts`: export `discordLinkCodeState` 삭제, 머리 주석 S5 줄에서 「연동 코드」 삭제. S5 신규 export 함수는 12개(time 3 + activity 9).
- `packages/core/src/activity.test.ts`
  - `discordLinkCodeState` describe(2건)와 import 삭제.
  - `buildActivityRanking` 픽스처에서 `playSec` 제거, 기대값 다시 계산(동점 3단계 순서는 그대로).
  - 추가 3건: voiceSec 0이면 activeDays가 커도 제외(play·chat만 있는 회원), 추가 필드 `playSec`가 있어도 totalSec·정렬에 안 들어가고 그대로 통과(r1), 추가 필드 `scrimCount`가 순위·totalSec에 영향 없고 그대로 통과, 음성 0이면 내전이 많아도 제외(r2, D239). 음수 검사에 비정수(1.5) 1건 추가.
  - `checkPresenceCapture` TOO_OLD 경계 테스트가 `FUTURE_MS`(BOT_ACTIVITY_FUTURE_TOLERANCE_SEC)를 쓰던 것을 `PRESENCE_PAST_MS`(BOT_PRESENCE_STALE_AFTER_SEC)로 바꿈.
- `packages/core/dist/**`: `tsc -p tsconfig.build.json`로 다시 빌드함(`discordLinkCodeState` 없음).

### 만들지 않은 것 (계약대로)
- `scrim_count`·플레이타임 보유자(D234)용 core 함수 없음. 14-2절 「`scrim_count`는 core 함수가 필요 없다(SQL 집계 + 순위 뒤에 붙임). 새 core 함수를 만들지 않는다」, 보유자는 api `playtime-holders.ts` SQL 조각 담당. `pickDefaultPlaytimeAppId`는 shared 함수(architect 담당).

### 테스트
- 임시 `vitest.tmp.config.mjs`(Node 20.11, 실행 뒤 삭제)로 core 전체 10 파일 **416개 통과**(이전 415개 − 연동 코드 2 + 새 3). activity.test.ts 49개.
- `corepack pnpm --filter @gcd/core typecheck`, `build` 통과.

### 해석
1. 앞 S5 「해석 5」(TOO_OLD 300초가 `BOT_ACTIVITY_FUTURE_TOLERANCE_SEC` 재사용)는 지금 코드와 맞지 않는 옛 기록이다. 현재 코드는 `BOT_PRESENCE_STALE_AFTER_SEC`를 쓴다. 앞 「해석 6」(discordLinkCodeState)은 함수 삭제로 해당 없음.
2. `buildActivityRanking`은 `playSec`를 금지하지 않는다(제네릭이라 추가 필드는 통과). 옛 호출이 `playSec`를 계속 넘겨도 타입 오류가 나지 않고 합에만 안 들어간다.

### 사용처 참고 (다른 담당, 고치지 않음)
- `apps/api/src/modules/rankings/ranking-calculator.service.ts` 286줄: 아직 `playSec: num(r.play_sec)`를 넘긴다. 타입은 통과하고 total에는 안 들어가지만 SQL `play_sec` 열 제거는 backend 14-1 작업.
- `apps/web/src/lib/api/mock/community.ts` 148–158줄: `playSec` 누적과 play 행 주 게임 합산이 남아 있다. 이제 totalSec는 음성만이지만 주 게임은 아직 play를 포함하므로 frontend 14-1 작업(주 게임 voice 기준) 필요.
