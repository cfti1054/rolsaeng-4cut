# QA: S4 apps/web — 판정: pass (blocker 0, major 0, minor 10)

검증 범위: 작업 트리 스냅샷(2026-10-30). API QA가 동시에 진행 중이라 apps/api 대조는 이 시점 코드 기준이다.
화면 동작은 목 모드 production 빌드로 확인했다. 실제 apps/api와 연결한 브라우저 실행은 하지 않았다(DB 없음). 목과 실제의 차이는 코드 대조 결과다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter web typecheck` | 통과 |
| web vitest(스크래치패드 임시 설정) | 18파일 208개 통과 |
| shared vitest(임시 설정) | 5파일 91개 통과 |
| core vitest(임시 설정) | 347개 통과 |
| `next build` 목 모드 / 일반 모드 | 둘 다 통과. 마지막에 일반 모드로 빌드해 `.next`를 남겼다 |
| Playwright(Chromium 캐시, playwright-core 1.64.1, 목 production) | 아래 표 |

### 브라우저 실행 결과

| 항목 | 조건 | 결과 |
| --- | --- | --- |
| stale | 1440·390 다크, 라이트 | 홈 「갱신 지연 · 마지막 22:41」, 랭킹 칩 동일. 넘침 0 |
| no_season | 1440·390 다크, 라이트 | 사이드바·모바일 머리 「다음 시즌 준비 중」, 홈 「아직 시즌이 없어요」, 랭킹 빈 상태 |
| error | 1440·390 다크, 라이트 | 홈·랭킹 오류 + 재시도, 시즌 카드 숨김, 사용자 카드 유지 |
| loading | 1440 다크, 1440·390 라이트 | `aria-busy` 스켈레톤 표시 |
| final | 1440·390 다크 | 「시즌 1 최종 ELO TOP 5」, 칩 「시즌 최종 순위」, 규칙 「시즌 종료 때 확정된 순위 · 동점이면 승률 순」, rank_change 전부 `—` |
| empty, me_outside | 1440·390 다크 | 빈 상태 문구 일치. 내 행이 표 끝에 YOU로 추가 |
| 재조회 실패 유지 | 시계 설치 후 5분 경과 | 표 유지 + 안내 줄. 복구 뒤 안내 제거(아래 주의 참고) |
| 다른 키 첫 조회 실패 | 게임 전환 + error, 실제 시계 | 약 3.5초 뒤 오류 상태로 전환. 그동안 이전 게임 표가 흐리게 유지 |
| 5분 재조회 | 시계 5분 | 칩이 「5분마다 갱신」→「갱신 지연」으로 바뀜 |
| NOT_FOUND | 없는 uuid | 「시즌을 찾을 수 없어요」, 「기본 시즌 보기」로 복귀(결함 4) |
| 잘못된 쿼리 | `season=abc`, `game=nope`, `tab=weird`, `tab=activity`, `tab=tier&game=steam` | 모두 기본값으로 처리, 오류 없음 |
| 필터 클릭 | 탭·게임·시즌 | URL·칩·규칙·표 일치. 현재 시즌을 다시 고르면 season 파라미터 제거 |
| 비활성 탭 | 활동 클릭 | 상태·URL 변화 없음 |
| 승인 → 갱신 | 운영진, SPA 이동 | 사이드바 ELO 1502 #5 → 1486 #6, 최근 결과 「승인 대기」→「반영 ±16」, 내 행 ▼1 |
| 참가 취소 → 갱신 | SPA 이동 | 다음 내전 카드 교체 |
| 계정 전환 | A 승인으로 값 변경 → 로그아웃 → B 로그인, SPA 유지 | B 사이드바 1502 #5(A의 1486 #6 아님), 화면에 A 이름 없음 |
| 시드 4 전환 | 저장소 seed_version=3 후 새로고침 | 재시드, finished 21, 내전 목록 정상 |
| 콘솔 | 전 구간 | 리소스 404 한 건 외 오류 없음. `/favicon.ico`가 404라 이것으로 추정하며 S4 변경과 무관 |

주의: ELO 탭에서 시계를 돌린 첫 자동 재조회 실패 직후에는 안내 줄이 0개로 측정됐다. 표는 유지됐고, 같은 화면의 재시도 뒤에는 1개, 티어 탭은 같은 절차에서 1개다. 재시도 대기와 가짜 시계의 시간 차이로 보지만 ELO 탭의 자동 재조회 경로만 따로 다시 재지는 않았다.

## 결함

| # | 심각도 | 위치 | 기대 | 실제 | 재현 | 처리 제안 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | minor | `lib/hooks/rankings.ts:55-64`, `components/providers.tsx:12`, `home-view.tsx:325,376` | 「5분마다 갱신」을 보여 주면 열린 화면도 갱신되고 stale이 반영된다 | 요약에는 refetchInterval이 없고 refetchOnWindowFocus도 꺼져 있다. 홈을 열어 두면 값이 그대로다. 같은 시각 랭킹 칩은 「갱신 지연 · 마지막 23:21」 | 홈 열고 stale 설정 후 31분 경과 → 「롤 · 5분마다 갱신 · 23:10」 유지 | 계약 10절(staleTime 60초)을 어기지는 않아 minor다. 모집 인원도 같이 묶여 있어 `useDashboardSummary`에 같은 주기를 넣길 권한다 |
| 2 | minor | `lib/dashboard.ts:128`, 계약 3절 `earned_at = ends_at`, 10절 `YYYY.MM` | 시즌 1 뱃지는 시즌이 끝난 달(shared 주석·목업 「2026.06」 맥락) | `ends_at`은 다음 달 1일 00:00 KST(배타적)라 한 달 뒤로 찍힌다 | 8월 말 종료 시즌 1 뱃지가 「2026.09」 | architect 판단: 표시만 `earned_at − 1ms`로 할지 결정 |
| 3 | minor | `rankings-view.tsx:319`, `home-view.tsx:346` | 종료 시즌 빈 상태에 앞으로 쌓인다는 안내가 없다 | 「이 시즌에 순위에 든 멤버가 없어요」 아래 「운영진이 내전 결과를 승인하면 순위가 쌓여요.」. 홈은 is_final이어도 「{min_games}경기 이상…아직 없어요」(코드 확인) | 시즌 1 + 스팀 | is_final이면 보조 문구를 빼고, 홈도 `eloEmptyState`와 같은 규칙으로 |
| 4 | minor | `rankings-view.tsx:123,181-194` | NOT_FOUND일 때 필터가 없는 시즌임을 드러낸다 | select 값이 옵션에 없어 「시즌 2 (진행 중)」으로 보인다. 그 옵션을 다시 골라도 변경이 일어나지 않아 버튼으로만 복귀 | `?season=11111111-1111-4111-8111-111111111111` | 값이 목록에 없으면 빈 옵션 추가 |
| 5 | minor | `lib/rankings.ts:126-133`, `rankings-view.tsx:391`, `home-view.tsx:358,365` | 시상대 라벨이 응답 `rank`와 같다 | 라벨·색이 배열 위치 기준이다. 계약 4-2는 탈퇴 행 뒤 rank를 다시 매기지 않으므로 종료 시즌에서 rank 2가 「1ST」가 될 수 있다. 목에는 삭제 사용자가 없어 드러나지 않는다 | 코드 확인(실행 안 함) | `entry.rank`로 라벨 결정, 3위 밖은 시상대 제외 |
| 6 | minor(목) | `lib/api/mock/scrims.ts:537-545` | 「기존 값에 영향 없도록 뒤에 붙임」 | 시즌 2 값은 그대로지만 시즌 1 이력 순서가 깨진다. 7월 경기가 8월 경기 뒤에 반영돼 그래프 마지막 점(1573)과 최종 순위 값(1547)이 다르다 | 내 시즌 1 이력: 07-22 1573→…→08-11 1547, 08-21 1600→08-27 1573 | 지난 시즌 경기를 시간순으로 넣기. 실제 API와 무관 |
| 7 | minor(목) | `lib/api/mock/rankings.ts:139-147`, `scrims.ts:1140` | 상태 확인 시나리오가 필터까지 맞다 | `GET /seasons`에 시나리오가 적용되지 않아 no_season에도 시즌 2개가 나오고, final에도 「시즌 2 (진행 중)」이 남는다 | no_season으로 랭킹 열기 | 시나리오를 seasons 응답에도 적용. 이 때문에 시즌 0개일 때의 필터 표시는 브라우저로 확인하지 못했다 |
| 8 | minor | `season-card.tsx:11`, `hooks/rankings.ts:60` | 요약을 못 받으면 시즌 카드를 숨긴다 | `/me`가 5xx로 실패하면 쿼리가 disabled라 isPending이 유지되어 스켈레톤이 계속 남는다 | 코드 확인 | `fetchStatus`까지 함께 판단 |
| 9 | minor | `components/providers.tsx:15`, `lib/api/client.ts:157` | 계정이 바뀌면 이전 사용자 값이 남지 않는다 | 로그아웃(`qc.clear`)과 세션 상실(전체 새로고침)은 안전하다. 다른 탭이 B로 다시 로그인한 뒤 이 탭이 refresh로 B를 받으면 `me`만 바뀌고 A의 요약·랭킹 `me`가 남는다 | 코드 확인 | onSession에서 id가 달라지면 `qc.clear()`. 기존 S1 경로라 다른 사용자별 쿼리에도 해당한다 |
| 10 | minor | `lib/hooks/scrims.ts:152-157` | 충돌로 화면이 어긋나면 요약도 다시 받는다 | 403·404·409 처리는 상세·목록만 무효화한다. 홈으로 돌아와도 60초 안이면 이전 값 | 코드 확인 | `dashboardKeys.summary` 무효화 추가 |

## 교차 대조

| 계약 4절 | ApiPath | 컨트롤러 | 웹 호출 | 훅·소비 | 파싱 |
| --- | --- | --- | --- | --- | --- |
| GET /rankings/tier | rankingsTier | RankingsController.tier | getTierRanking | useTierRanking → TierPanel | GetTierRankingResponse |
| GET /rankings/elo | rankingsElo | RankingsController.elo | getEloRanking | useEloRanking → EloPanel | GetEloRankingResponse |
| GET /dashboard/summary | dashboardSummary | DashboardController.summary | getDashboardSummary | useDashboardSummary → 홈·사이드바·모바일 머리 | GetDashboardSummaryResponse |
| GET /users/:id/profile | 기존 | 기존 | 기존 | useUserProfile → ProfileBadges, 머리 칩, 요약 카드 | GetUserProfileResponse |

- 모든 요청이 `apiClient.request(…, 스키마)`를 거친다. 제네릭 단언만 있는 곳 없음. snake_case 유지.
- 링크: `routes.rankings`, `routes.member`, `routes.scrim`, `routes.scrimNew`, `routes.settings`만 쓴다. 전부 `app/` 라우트와 일치.

### 목과 실제 서비스 차이

| 항목 | 목 | 실제 | 화면 영향 |
| --- | --- | --- | --- |
| 승인 뒤 ELO·순위 | 즉시 반영 | 5분 캐시. 프로필 `elo`는 즉시, `rank`·사이드바는 지연 가능 | 계약상 정상. 목으로는 지연 화면을 볼 수 없다 |
| 끝났지만 종료 처리 전 시즌 | 없음(ends_at + 60초면 is_final) | is_final false, 캐시 출처 | 분기가 일반적이라 문제 없음. 브라우저 미확인 |
| 종료 시즌 프로필 rank | 값이 나온다 | 닫힌 시즌 캐시 키가 지워져 null | 화면은 null 처리됨 |
| 삭제 사용자로 rank 공백 | 없음 | 있음 | 결함 5 |
| `stats.week_start` | UTC 표기 | +09:00 표기 | 화면 미사용. 둘 다 스키마 통과 |
| `GET /seasons` 시나리오 | 미적용 | 해당 없음 | 결함 7 |
| `outcome.winner` 사용자 없음 | 「알 수 없음」 | null → 「기록 없음」 | 영향 작음 |

필드·정렬·null 규칙(top_rankers 게임 선택, me 선택, 다음 내전 3경로, recruiting 제외, recent_results 병합, elo_swing)은 `dashboard.service.ts`, `rankings-reader.service.ts`와 일치한다. 양쪽 다 shared parse를 거쳐 모양 불일치는 생기지 않는다.

## 금지 항목

- 활동·플레이타임: 비활성 탭과 「봇 연동 후 제공」뿐, 숫자 없음. 음성·활동 카드, 스파크라인, 증감, 패치·이벤트 없음. 목에도 값 없음.
- 화면 코드의 숫자 5·0.5 리터럴 없음. `*_DEFAULT` import는 목 밖에 없음(`lib/scrim-results.ts:19` 주석 언급뿐).
- 하드코딩 색 없음, 사용한 토큰은 CSS에 존재.
- 「1 / 2」 판단(`lib/dashboard.ts:16,28-31`): 규칙 우회가 아니다. 숫자가 계산에 들어가지 않고, 계약 10절이 「`soft_reset_ratio` 0.5면 절반」으로 정한 문구 분기를 서버 값에 적용할 뿐이다. env 0.5는 정확히 0.5로 파싱되어 문구가 실제 ratio와 어긋나지 않고, 다른 값이면 응답 값으로 %를 만든다. 다만 grep을 피하는 표기로 보이니 이유 주석을 남기면 좋다.
- 문구 참고(계약 문구라 결함 아님): 「레이팅 30%만 유지」는 실제 식(1000 기준 차이의 30%)과 뉘앙스가 다르다. 1600은 480이 아니라 1180이 된다. ratio 1이면 「100%만 유지」가 된다. 기본값 0.5에서는 드러나지 않는다.

## 구현 보고의 계약 차이

구현 보고에는 6건이 아니라 7건이 있다.

| # | 내용 | 판단 |
| --- | --- | --- |
| 1 | is_final 규칙 문구 | 적합. 10절이 데이터에 is_final을 두고, 13절의 「닫힌 시즌은 그대로」와 맞다 |
| 2 | 빈 상태 3종 추가 | 적합. 4-2의 상태를 표현한다. 보조 문구는 결함 3 |
| 3 | 모바일 표 열 합침 | 적합. 넘침 0, 값 누락 없음 |
| 4 | 팀 평균 패널 제외 | 적합. 응답에 값이 없고 가짜 숫자 금지 |
| 5 | 티어 육각형 제외 | 적합. `EloRankingEntry`에 티어 없음 |
| 6 | refetchInterval 5분 | 적합. 숨은 탭은 멈추고 서버는 캐시 읽기뿐이다. 칩이 실제로 stale로 바뀌는 것을 확인했다. 범위가 랭킹뿐인 점은 결함 1 |
| 7 | tab 기본값 생략 | 적합. `tab=elo`도 읽힌다 |

## 기존 테스트 변경·시드

- `scrims.test` finished 15→21: 정당. 지난 협곡 20 + 롤체 1이고 주석도 맞다.
- `game-accounts.test` badges null→[]: 정당. 계약 1-3·18절의 항상 배열 규칙이고, 목이 null이면 오히려 실제와 달라진다.
- `scrim-results.test` 픽스처 rank: 계약 18절 그대로.
- 시드 버전 4: 시즌 2 값 불변. 여섯 경기가 항상 시즌 1에 들어가는지 날짜 경계로 계산했고 맞다. 내전 목록·프로필·재시드 정상. 시즌 1 이력 순서만 결함 6.

## 무효화·캐시

- 승인: 내전 상세·목록·요약·프로필·랭킹·시즌. 노쇼: 시즌을 뺀 같은 범위. 결과 제출·철회·반려, 생성·수정·참가·취소·시작·모집 취소·팀 저장: 상세·목록·요약.
- 요약·랭킹 키에 사용자 id가 없지만, 로그아웃은 `qc.clear()`, 세션 상실은 전체 새로고침이다. 값이 다른 두 계정으로 확인했다. 남은 경로는 결함 9.

## 미실행

- 실제 apps/api + DB와 연결한 브라우저 실행.
- 라이트 테마의 final·empty·me_outside(구현자 2차에서 확인, 이번에는 다크만).
- 로그아웃 중 응답이 늦게 도착하는 경합, 다른 탭 계정 전환.
- 모바일·라이트 색 대비 측정.
- 결함 5·8·9·10은 코드 확인이며 실행 재현은 아니다.

## 이전 결함 재확인

S4 web 첫 검증이라 해당 없음.
