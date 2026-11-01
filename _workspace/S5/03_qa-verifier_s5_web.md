# QA: s5_web — 판정: pass

대상: `_workspace/02_frontend-dev_s5.md`. 대조 기준은 계약 `_workspace/01_architect_contract.md` 4·7·8·10절과 목업 `_workspace/00_input/mockup/`(Main, MobileHome, Rankings, Settings).
사용한 도구: Read, Write, Bash(corepack pnpm, npx vitest), SubagentHandback. 브라우저는 직접 확인하지 않았다(구현자 Playwright 결과만 있음).

## 실행한 명령과 결과
| 명령 | 결과 |
| --- | --- |
| `corepack pnpm typecheck` (apps/web) | exit 0 |
| `npx vitest run --config qa-tmp-vitest.config.mjs` (apps/web, vitest.config.ts를 복사해 임시 .mjs로 실행한 뒤 삭제, 남은 파일 없음) | 27 files / 303 tests passed |
| `corepack pnpm build` (apps/web, 일반 모드) | exit 0. 12 routes, /rankings 8.2 kB, /settings 11.7 kB |

## 결함
blocker 0, major 0, minor 3. 아래 #4는 이번 슬라이스 전부터 있던 문제다.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/web/src/components/settings/discord-section.tsx:96 (+ :41) | 409 DISCORD_ACCOUNT_ALREADY_LINKED가 오면 상태를 다시 받아 「연동됨」만 보인다(계약 10절) | 상태 재조회 뒤 「연동됨」 화면과 토스트 「디스코드와 연동됐어요」가 뜨는데, 그 아래에 InlineError 「이미 디스코드와 연동된 계정이에요.」가 계속 남는다(`issue.isError`가 초기화되지 않음). 성공 상태와 오류 문구가 함께 보인다 | 목: 코드 발급 후 다른 탭에서 연동되게 하거나 `gcd-mock-discord=linked`로 바꾼 뒤 새로고침 없이 「다시 발급」 클릭 |
| 2 | minor | apps/web/src/components/rankings/rankings-view.tsx:296, :280–281 | 주소에 형식이 맞는 app_id가 있으면 `/steam-apps`와 상관없이 그 게임 랭킹을 보여 준다(결정 2의 취지) | `/steam-apps`가 실패하면(`!appItems && apps.isError`) app_id를 알아도 패널 전체가 오류로 바뀐다. 목록을 받는 중에는 select에 option이 하나도 없다(appId는 있는데 fallback 옵션이 `appItems`가 있어야만 생긴다) | `/rankings?tab=playtime&app_id=730`에서 /steam-apps 500 또는 지연 |
| 3 | minor | apps/web/src/components/rankings/rankings-view.tsx:127, :681 | 모바일 PLAYER 보조 줄에 주 게임을 합친다. 값이 없으면 줄을 비운다 | `main_games`가 []인 행은 모바일 보조 줄에 「—」만 한 줄 나온다(표 칸에 쓰는 「—」를 그대로 씀). 표시 문제일 뿐이다 | 390px, 활동 탭에서 게임 없는 음성 기록만 있는 멤버 |
| 4 | minor (S5 전부터 있음, 범위 밖) | apps/web/src/lib/hooks/game-accounts.ts:36, apps/web/src/lib/hooks/scrims.ts:59–60 | 사용자가 바뀌면 이전 사용자 쿼리를 지운다 | `applySessionUser`(lib/hooks/auth.ts:19)는 `queryKey[0] !== 'me'`인 쿼리만 reset한다. 그래서 `['me','game-accounts']`, `['me','scrim-restriction']`, `['me','position-suggestions',…]`가 남는다. 구현자 결정 5의 지적이 맞다. S5의 `['discord-link','mine']`에는 이 문제가 없다 | 다른 탭에서 다른 계정으로 재로그인한 뒤 refresh |

## 교차 대조 표 (엔드포인트 ↔ 컨트롤러 ↔ 웹)
| 계약 4절 | ApiPath | 컨트롤러 | 웹 API 함수 / 훅 | 응답 parse | 목 |
| --- | --- | --- | --- | --- | --- |
| GET /rankings/activity?period= | rankingsActivity | rankings.controller.ts `@Get(ApiPath.rankingsActivity)` JwtGuard | getActivityRanking / useActivityRanking(period\|null) | GetActivityRankingResponse | mock/community.ts activityResponse(parse) |
| GET /rankings/playtime?app_id= | rankingsPlaytime | 같음 | getPlaytimeRanking / usePlaytimeRanking(appId\|null) | GetPlaytimeRankingResponse | playtimeResponse(parse). 빈 응답 모양(name null, synced_at null, stale false)이 reader:304–312와 같다 |
| GET /me/discord-link | myDiscordLink | discord-link.controller.ts JwtGuard | getMyDiscordLink / useMyDiscordLink | GetMyDiscordLinkResponse | handleDiscordLink(parse) |
| POST /me/discord-link/code | myDiscordLinkCode | 같음 + OriginGuard, 201 | issueDiscordLinkCode / useIssueDiscordLinkCode | IssueDiscordLinkCodeResponse | 201, 409, 429 + retryAfterSec. 실제 서버는 error.filter.ts:86에서 Retry-After 헤더를 붙이고 client.ts:122가 읽는다 |
| GET /dashboard/summary (community) | dashboardSummary | dashboard.service.ts:101 community → GetDashboardSummaryResponse.parse | getDashboardSummary / useDashboardSummary | 같음 | mockCommunity가 core presenceState·nowPlayingItems 사용 |
| GET /steam-apps (q 없음) | steamApps | games.controller.ts | searchSteamApps('') / useSteamApps('', tab===playtime) | SearchSteamAppsResponse | `gcd-mock-rankings=empty`면 [] |
| 봇 7개 | bot* | bot.controller.ts 7개 `@BotScope` | 웹에서 쓰지 않음(봇 전용) | - | - |

- 경로는 모두 ApiPath를 쓴다. 웹 응답에 discord_id 필드는 없다. snake_case 필드가 웹까지 그대로 온다.
- 라우트·링크: `routes.rankings`의 tab/period/app_id 규칙(week는 주소에 쓰지 않음)이 parseRankingsQuery와 맞는다. 봇 web_url(`bot-query.service.ts:250,269` `/rankings?tab=activity&period=…`, `tab=playtime&app_id=…`)을 웹 파서가 받는다. `routes.settings()`·`routes.member()`도 app 라우트에 있다.
- 상수 리터럴: S5 화면 파일(rankings-view, discord-section, home-view, lib/discord-link, lib/dashboard, lib/rankings S5 절)에 15·10·300·900 리터럴이 없다. 유효 시간은 응답 `expires_at`·`ttl_sec`을, 갱신 주기는 `RANKING_CACHE_INTERVAL_MIN`을 쓴다. `DISCORD_LINK_POLL_MS = 5_000`은 계약 「5초마다」를 그대로 옮긴 화면 상수이고 shared에 같은 값이 없다(허용).
- 상태 처리
  - 활동: 로딩·오류·재조회 실패(RefetchNotice)·stale 칩·빈 상태 2종(bot_connected 기준)
  - 플레이타임: 목록 빔·선택 게임 빔·stale·스팀 동기화 시각
  - 설정: linked / idle / issued / active / expired 5상태, 409, 429
  - 홈: voice live/stale/not_connected, active_members ready/not_connected, now_playing null/값, 열 수 2·3·4, 모바일 2칸 규칙
  - 위 항목이 모두 계약 10절과 맞다.

## 「리더 확인 요청」 1–7 판단
| # | 판단 | 근거 |
| --- | --- | --- |
| 1 기간 select 다른 옵션은 이름만 | 허용 | 날짜는 응답 기준이라는 계약을 지킨다. 선택한 기간에는 계약 형식(「이번 주 (MM.DD – MM.DD)」/「이번 달 (M월)」)으로 나온다 |
| 2 목록 밖 app_id도 조회, 「App {id}」 옵션 | 허용 | 서버가 대상 밖 게임도 첫 요청 때 계산한다(D217). 봇 web_url과 맞고 S4 시즌 fallback과 같은 방식이다. 형식이 틀린 값은 없는 것으로 친다. 결함 #2는 이 판단에서 생긴 빈틈이다 |
| 3 주 게임은 GAME_SCRIM_META label | 허용(계약 문구와 다름) | 목업 「롤 협곡 · 롤체」와 맞는다. 계약 표의 「main_games 이름」을 글자 그대로 따르면 「리그 오브 레전드」가 된다. 리더가 계약 문구를 고칠지 정하면 된다 |
| 4 +/− 의미를 title·sr-only·규칙 줄로 표시 | 계약과 맞음 | 「표 머리 툴팁/보조 문구」 |
| 5 쿼리 키 `['discord-link','mine']` | 맞음 | auth.ts:19 reset 조건을 확인했다(#4 참고) |
| 6 목이 Me.discord_id를 바꾸지 않음 | 허용 | 목만의 차이다. 실제 흐름(me 무효화)은 hooks/discord-link.ts와 discord-section.tsx:42에 있다 |
| 7 빈 상태 보조 문구 추가 | 허용 | 계약 문구를 바꾸지 않고 덧붙이기만 했다 |

## 리더 참고 (계약 수준, 웹 결함 아님)
- 실제 `GET /steam-apps`(q 없음)는 `steam_playtime` 전체 행을 groupBy한다(steam-apps.service.ts:84–94). 대표·verified 여부, minutes_total 0, 탈퇴 회원을 거르지 않는다. 그런데 플레이타임 랭킹(계약 7-2)은 대표·verified·minutes>0·탈퇴 제외만 센다. 그래서 select 기본값(첫 항목)이 랭킹이 빈 게임일 수 있다(「이 게임 플레이 기록이 있는 멤버가 없어요」). 계약 10절이 「/steam-apps items 순서」로 정해 둔 대로 웹이 구현한 것이므로, 바꾸려면 계약부터 고쳐야 한다.
- 목 플레이타임은 목록 밖 app_id에 항상 빈 응답을 준다. 실제 서버는 계산한다. 화면 분기는 같다.
