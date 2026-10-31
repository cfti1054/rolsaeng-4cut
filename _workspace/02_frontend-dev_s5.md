# 프런트엔드 보고: S5 활동·플레이타임 랭킹, 디스코드 연동, 홈 community

사용 가능 도구: Read, Write, Edit, Bash(corepack pnpm, Python Playwright Chromium), SubagentHandback.

## 화면
| 라우트/위치 | 파일 | 호출 엔드포인트 | 목 |
| --- | --- | --- | --- |
| /rankings 활동 탭 | components/rankings/rankings-view.tsx | GET /rankings/activity?period= | 사용 가능 |
| /rankings 플레이타임 탭 | 같음 | GET /steam-apps(q 없음), GET /rankings/playtime?app_id= | 사용 가능 |
| /settings 디스코드 | components/settings/discord-section.tsx | GET /me/discord-link, POST /me/discord-link/code | 사용 가능 |
| / 통계 줄·지금 플레이 중 | components/home/home-view.tsx | GET /dashboard/summary(community) | 사용 가능 |

- 탭 4개 모두 활성(「봇 연동 후 제공」 비활성 탭 삭제). 쿼리 `tab=activity&period=month`, `tab=playtime&app_id=`. 기본값(week, 목록 첫 게임)은 주소에 쓰지 않는다. app_id는 정수 문자열만 받는다.
- 설정 「봇 연동 후」 칩 없음. 상태 5종: linked / idle / issued(메모리 원문, 글자 칸) / active(새로고침, 「발급한 코드가 있어요 · mm:ss 남음」 + 「코드 다시 발급」) / expired. 코드가 유효한 동안 5초 간격 재조회, 미연동에서 연동으로 바뀌면 토스트 「디스코드와 연동됐어요」 + `me` 무효화(exact). 409 → 상태·me 재조회, 429 → 「오늘은 더 발급할 수 없어요 · MM.DD HH:mm부터 다시 발급할 수 있어요」(요청 시각 + Retry-After).
- 홈: 카드 순서 음성 · 모집 중 · 이번 주 내전 · 활동 멤버. not_connected 칸은 숨긴다. 열은 2/3/4장(`md:grid-cols-2|3`, 4장은 `xl:grid-cols-4`). 모바일 2장 규칙은 계약대로. stale은 「—」 + 「마지막 HH:mm」. now_playing이 있으면 칩 줄(이름 · N명, 「HH:mm 기준」)을 표시한다.

## 데이터 계층
- lib/api/rankings.ts(getActivityRanking, getPlaytimeRanking), lib/api/discord-link.ts(새 파일). 응답은 모두 shared 스키마로 parse한다. 경로는 ApiPath만 쓴다.
- 훅: useActivityRanking(period | null), usePlaytimeRanking(appId | null)(5분 refetchInterval, keepPreviousData), useMyDiscordLink(), useIssueDiscordLinkCode() — lib/hooks/rankings.ts, lib/hooks/discord-link.ts.
- 순수 로직: lib/rankings.ts S5 절, lib/discord-link.ts, lib/dashboard.ts S5 절.

## 목 백엔드 (NEXT_PUBLIC_API_MOCK)
- lib/api/mock/community.ts(새 파일): 활동 기록·스팀 플레이타임은 멤버 id와 날짜로 정해지는 값으로 만든다(시드 저장 없음). 계산은 core의 activityPeriodWindow, buildActivityRanking, pickMainGames, buildPlaytimeRanking, presenceState, nowPlayingItems, computeRankChange를 쓴다.
- architect가 넣은 임시 community(mock/rankings.ts)를 mockCommunity로 교체했다. SEED_VERSION 7 → 8.
- `gcd-mock-bot` = none | live(기본) | stale | no_playing | empty_period.
- `gcd-mock-discord` = linked | unlinked. 값이 없으면 Me.discord_id로 판정한다(개발 로그인 미연동, 디스코드 로그인 연동). 값을 바꾸면 목 연동 기록을 비운다. 발급 20초 뒤 자동 linked.
- `gcd-mock-rankings` 기존 값도 적용: stale, error, loading, me_outside. empty는 활동 기록 없음 + /steam-apps(q 없음) 빈 목록 → 「스팀 계정을 연동한 멤버가 아직 없어요」.
- app 550(Left 4 Dead 2)은 보유자는 있지만 0분이라 「이 게임 플레이 기록이 있는 멤버가 없어요」를 확인하는 데 쓴다.

## 검증
- `corepack pnpm --filter web typecheck` 통과, `build`(일반 모드) 통과.
- 테스트 27파일 303개 통과(기존 256 + 신규 47). Node 20.11이라 임시 vitest .mjs 설정으로 실행한 뒤 삭제했다.
- 브라우저(Playwright, 목 production 빌드, 1440·390 × 다크·라이트):
  - 랭킹·홈·설정 16케이스 × 4조합 = 64페이지. 활동(live, month, 봇 없음, 이번 주·이번 달 빈 상태, stale), 플레이타임(기본, 선택 게임 빔, 목록 빔, stale), 홈(live, stale, no_playing, none), 설정(linked, idle). 가로 넘침 0, 콘솔 오류 0, 문구 누락 0(모바일 활동 멤버 카드 미표시는 설계대로).
  - 설정 흐름 4조합: 발급 → 글자 칸·`/연동 RS-…`·「15:00 뒤 만료」, 새로고침 → active(원문 없음), 만료 도달 → 「코드가 만료됐어요」. 데스크톱 다크에서만: 자동 연동 → 토스트·「연동됨」, 429 문구.

## 계약과 다른 점·판단(리더 확인 요청)
1. 기간 select: 선택된 기간만 응답 날짜를 붙이고, 다른 옵션은 「이번 주」/「이번 달」만 표시한다(응답이 없으므로).
2. 플레이타임 app_id가 /steam-apps 목록에 없으면(예: 봇 web_url) 첫 게임으로 바꾸지 않고 그 게임을 조회한다. select에 응답 이름(없으면 「App {id}」) 옵션을 추가한다. S4 시즌 fallback과 같은 방식이다. 「잘못된 값은 없는 것으로」는 형식 오류에만 적용했다. 다른 판단이면 resolvePlaytimeApp 한 곳만 고치면 된다.
3. 주 게임 표시는 응답 `main_games[].name`(games.name, 「리그 오브 레전드」) 대신 다른 화면과 같은 짧은 이름(GAME_SCRIM_META label, 「롤 협곡 · 롤체」)을 쓴다. 모르는 코드면 name을 쓴다.
4. 활동 +/− 의미는 표 머리 title·sr-only와 규칙 줄 끝 「· +/−는 지난주(지난달) 대비」로 보인다. 플레이타임은 티어처럼 표시하지 않는다.
5. 디스코드 연동 쿼리 키는 `['discord-link','mine']`이다. 'me' 접두사로 두면 사용자 전환 때 applySessionUser가 비우지 않는다. 기존 `['me','game-accounts']`도 같은 문제가 있다(이번에는 손대지 않음).
6. 목은 연동 성공 시 Me.discord_id를 바꾸지 않는다(D227을 그대로 흉내 내면 개발 재로그인 때 새 회원이 생겨 목 상태를 잃는다). 실제 서버에서는 me 무효화 뒤 discord_id가 바뀐다.
7. 빈 상태 보조 문구(봇 미연결 안내, 비공개 프로필 안내, 스팀 연동 링크)를 추가했다.

## 알려진 한계
- 브라우저 미확인: 자동 연동 토스트와 429는 데스크톱 다크에서만 확인했다. 409(그 사이 연동)는 단위 테스트(목)만 했다. 활동 me_outside는 단위만 했다.
- 플레이타임 account_name은 목에서 닉네임과 같은 값이다.

## QA minor 반영 (_workspace/03_qa-verifier_s5_web.md)

| # | 수정 | 확인 |
| --- | --- | --- |
| 1 | discord-section: 표시 상태(view.kind)가 바뀌면 발급 mutation을 reset한다. 409 뒤 「연동됨」 화면으로 바뀌면 오류 문구가 지워지고, 같은 상태에서 나는 429는 남는다 | 브라우저(목): 미연동 화면에서 override를 linked로 바꾸고 발급 → 「연동됨」, 오류 문구 없음 |
| 2 | 플레이타임: `/steam-apps` 실패 시 주소 app_id가 있으면 그 게임 랭킹을 보여 준다(select는 비활성 + 현재 게임 옵션). app_id가 없을 때만 오류 + 재시도. 목록을 받는 동안에도 현재 선택 옵션(응답 이름, 없으면 「App {id}」)을 표시한다 | 일반 모드 빌드 + Playwright 응답 가로채기(목은 페이지 안에서 돌아 가로챌 수 없음): 실패 + app_id → 표·「Counter-Strike 2」 옵션, 실패 + app_id 없음 → 「다시 시도」, 목록 응답 지연 → 옵션 「Counter-Strike 2」 + 표 |
| 3 | 활동 행: 주 게임이 없으면 extraText를 비워 모바일 보조 줄과 상위 3명 문구를 생략한다. 데스크톱 MAIN GAME 칸은 「—」를 유지한다 | 브라우저(목, 390): 보조 줄에 「—」 없음 |

- 리더 결정: 주 게임은 짧은 이름 유지(변경 없음).
- 재검증: typecheck 통과, 테스트 27파일 303개 통과(임시 vitest 설정 사용 후 삭제), build는 목 모드·일반 모드 모두 통과(마지막 .next는 일반 모드). 콘솔 오류 0.

## S5 수정 r1+r2 반영 (계약 D232–D239, 14-1·14-2절 web)

이 절이 위 「화면」「데이터 계층」「목 백엔드」의 디스코드 연동 코드 관련 내용(GET /me/discord-link, POST /me/discord-link/code, 상태 5종, `gcd-mock-discord`, 409·429 처리)과 활동 `play_sec`·「ACTIVITY TIME」을 대체한다.

### 바꾼 것
| 파일 | 내용 | 근거 |
| --- | --- | --- |
| `lib/api/discord-link.ts`, `lib/hooks/discord-link.ts`, `lib/discord-link.ts`, `lib/discord-link.test.ts` | 삭제 | D237, D238 |
| `lib/discord-status.ts`(새), `lib/discord-status.test.ts`(새) | `discordStatus(me)` = `isLinkedDiscordId(me.discord_id)` → linked/unlinked, 문구 상수 2개 | D238 |
| `components/settings/discord-section.tsx` | `useMe()`만. 연동됨 = 아바타·`@discord_username`·「서버 멤버 확인 · …」 + 칩 「연동됨」. 미연동 = 칩 「미연동」 + 점선 상자 「디스코드로 로그인하면 자동으로 연동돼요.」, 버튼 없음. 머리 설명은 두 상태 모두 「음성 접속 시간이 활동 랭킹에 쌓이고, …」 | 10절 |
| `lib/errors.ts` | 연동 코드 오류 문구 4개 삭제 | D237 |
| `lib/rankings.ts` | 탭 설명 「디스코드 음성 채널 접속 시간 합계예요.」, 규칙 「… 기간에 시작한 음성 접속만 집계」, 빈 상태 「이번 주(이번 달) 음성 접속 기록이 아직 없어요」. 새 함수 `scrimCountText`, `activityMobileSubText`, `mainGamesLine`, `defaultPlaytimeApp`(= `pickDefaultPlaytimeAppId`), `playtimeAppParam`, 상수 `ACTIVITY_SCRIMS_HINT`. `resolvePlaytimeApp` 기본값·목록 빔 판단을 `pickDefaultPlaytimeAppId`로 | D232, D234, D239 |
| `components/rankings/rankings-view.tsx` | 머리 `VOICE TIME`. SCRIMS 열(MAIN GAME 뒤, 「{n}회」, 0이면 「0회」, 머리 title + sr-only 「결과가 승인된 내전 참가 수」, sm 미만 숨김). 모바일 PLAYER 보조 줄 = 「{d}일 중 {a}일 활동 · 내전 {n}회」(0회 생략, `break-keep`으로 줄바꿈 허용) + 주 게임 줄(있을 때만). 상위 3명 카드는 주 게임만(scrim_count 없음). 게임 select: 비활성 = 목록 모름 또는 기본값 null, 주소 생략 비교 = `playtimeAppParam`, 빈 상태 판단 = 기본값 null. 빈 상태 보조 문구 「디스코드 음성 채널에 접속하면 순위가 쌓여요.」 | D232, D234, D239 |
| `lib/api/mock/community.ts` | 연동 코드 목·`gcd-mock-discord`·`MockS5State` 삭제. 활동 시간·주 게임 = `ACTIVITY_RANKED_TYPES`(voice)만, 활동 일수 = 모든 type, `play_sec` 제거(play 이벤트 생성은 유지). `mockScrimJoins`(승인 결과 + joined + 취소 아님, 시각 `started_at ?? scheduled_at`, 내전당 1회) → 기간 안 개수를 `scrim_count`로. `mockPlaytimeOwners`: /steam-apps owner_count 그대로 순위 인원을 만든다(같은 출처). 보유자 없음 응답 `synced_at`·`stale` = 캐시 값. 끝에서 두 번째 멤버(용용이)는 게임 없는 음성만 → 주 게임 없음 행 확인용 | D232, D233, D235, D239 |
| `lib/api/mock/scrims.ts` | Left 4 Dead 2(550) owner_count 1 → 0(0분 보유는 보유자 아님, q 없음 목록에서 빠짐). `SEED_VERSION` 8 → 9. 랭킹 목에 `scrimJoins: mockScrimJoins(state)` 전달 | D234, D239 |
| `lib/api/mock/rankings.ts` | `MockRankingContext.scrimJoins`, empty 시나리오면 [] | D239 |
| `lib/api/mock/backend.ts` | 연동 목 라우트, `s5` 저장, `discord` 옵션 삭제(옛 localStorage의 s5 키는 읽지 않고 무시) | D237 |
| `lib/api/mock/game-accounts.ts` | 프로필 `discord_linked` = `isLinkedDiscordId` | D203 |

`steam-app-picker.tsx` 변경 없음(목록이 보유자 기준으로 좁아질 뿐, Q16).

### 테스트
- `community.test.ts`: 연동 코드 테스트 삭제. 추가 — total = voice·`play_sec` 없음, play가 시간·주 게임에 안 들어가고 활동 일수에는 들어감, scrim_count = 목 내전 자료 계산값·정렬 무관·empty면 0, `mockScrimJoins` 규칙(waitlist·cancelled·no_show·rejected·pending·취소 내전 제외, started_at null → scheduled_at), /steam-apps 모든 항목 owner_count ≥ 1 = 플레이타임 total·550 목록 밖, 보유자 없음 synced_at non-null(stale 시나리오 포함), /me/discord-link 두 경로 404, 프로필 discord_linked(dev false, 디스코드 true).
- `rankings.s5.test.ts`: 음성 문구 3종, SCRIMS 「3회」「0회」·툴팁, 모바일 보조 줄(0회 생략)·주 게임 줄 빈 문자열, 기본 게임 owner_count 0 건너뜀, 주소 생략 판단.
- `discord-status.test.ts`: 2상태 판정.

### 앞선 QA minor 3건 확인(이 폴더)
| # | 상태 |
| --- | --- |
| 1 409 오류 초기화 | 연동 코드 UI 삭제로 대상 없음(그 전에 resetIssue 반영돼 있었음을 확인) |
| 2 steam-apps 실패/로딩 시 app_id 랭킹 유지 | 반영돼 있음: 오류 화면은 `!appItems && apps.isError && appId === null`일 때만, 옵션은 `playtimeAppFallbackLabel(appItems ?? [], …)`. r1 변경 뒤에도 `resolvePlaytimeApp(730, undefined) = 730` 테스트로 고정 |
| 3 모바일 「—」 줄 생략 | 반영돼 있음 → `mainGamesLine`으로 옮기고 테스트 추가. 브라우저 390px에서 PLAYER 칸 「—」 단독 줄 0개(용용이 행) |

### 검증
- `corepack pnpm --filter web typecheck` 통과.
- 테스트 27파일 300개 통과(연동 코드 테스트 삭제분이 빠져 이전 303보다 적다). Node 20.11이라 임시 `vt.tmp.mjs`로 실행 후 삭제.
- build: 목 모드·일반 모드 둘 다 통과(마지막 `.next`는 일반 모드).
- 브라우저(Playwright Chromium, 목 production 빌드, 1440·390 × 다크·라이트, 10케이스 × 4 = 40페이지): 설정 연동됨·미연동, 활동 week·month·봇 없음·이번 주 빈 상태, 플레이타임 기본·보유자 없는 게임(550)·목록 빔·stale. 가로 넘침 0, 콘솔 오류 0, 모바일 「—」 단독 줄 0. 데스크톱 머리 「RANK PLAYER MAIN GAME SCRIMS VOICE TIME +/−」, 모바일 「RANK PLAYER VOICE TIME +/−」 + 보조 줄 「7일 중 4일 활동 · 내전 1회」. 미연동 상태는 목 DB의 user.discord_id를 `dev-…`로 바꿔 만들었다(개발 로그인 버튼은 `NEXT_PUBLIC_AUTH_DEV_LOGIN` 빌드에서만 보임).
- 플레이타임 550 응답은 이제 synced_at이 있어 「5분마다 갱신」 칩이 보인다(D235대로).

### 판단(리더 확인)
1. 미연동 화면의 머리 설명은 연동됨과 같은 「음성 접속 시간이 …」을 두고, 「디스코드로 로그인하면 자동으로 연동돼요.」는 본문 상자에 둔다(계약 표의 「설명」 칸을 본문 안내로 읽음).
2. SCRIMS 값은 오른쪽 정렬·tabular-nums. 모바일 보조 줄은 잘리지 않게 줄바꿈을 허용했다(390px에서 두 줄이 될 수 있음).

## play 제외(D240)

사용자 결정(2026-10-31): `play` 활동은 수신·저장만 하고 모든 활동 집계에서 뺀다. web은 목 백엔드만 바뀌고 화면 코드·문구 변경은 없다.

### 변경
| 파일 | 내용 |
| --- | --- |
| `apps/web/src/lib/api/mock/community.ts` | `ACTIVITY_COUNTED_TYPES`(@gcd/shared, voice·chat)를 import. `rankActivity`는 COUNTED에 없는 type(play)을 아예 건너뛴다 → 활동 일수에서 빠지고, play만 한 멤버는 집계 행 자체가 생기지 않는다. `mockCommunity`의 `active_members`도 COUNTED type만 센다. 시간·주 게임은 기존대로 `ACTIVITY_RANKED_TYPES`(voice). play 이벤트 생성(`mockActivityLogs`)은 그대로. `bot_connected`·`active_members.state`(봇 연결 판정)는 play를 포함한 모든 기록으로 본다(수신은 됐으므로). 머리 주석 D233 → D240 |
| `apps/web/src/lib/api/mock/community.test.ts` | 기존 「play 이벤트는 시간·주 게임에 …」 테스트: 기대 활동 일수를 voice·chat 날짜만으로 계산. 「활동 멤버 수」 테스트: 기대값에서 play 제외. 새 describe 「S5 목: play 제외(D240)」 4케이스 — play만 한 날은 활동 일수 미포함(음성 1일 + play 다른 날 → 1일), play만 한 멤버는 순위·total에 없음, 홈 활동 멤버에서 빠짐(play만 있으면 ready·0명, bot_connected true), 생성기는 play를 계속 만든다 |

목 생성기는 음성 직후에 play를 붙이므로 자정(KST)을 넘겨 다음 날에 play만 남는 경우가 실제로 생긴다. 이전 규칙이면 그날이 활동 일수에 들었고, 이제는 빠진다.

`rankings.s5.test.ts`·`dashboard.s5.test.ts`는 play 규칙에 기대는 단언이 없어 수정하지 않았다. 화면 문구(`rankings.ts`·`home-view.tsx`·설정)에 play를 활동으로 설명하는 곳은 없다.

### 검증
- `corepack pnpm --filter web typecheck` 통과
- 테스트 27파일 304개 통과(+4). Node 20.11이라 임시 `vitest.tmp.config.mjs`로 실행 후 삭제
- `corepack pnpm --filter web build` 통과(일반 모드)
