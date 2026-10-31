# 프런트엔드 보고: S4 랭킹·홈·사이드바·뱃지

## 화면
| 라우트/위치 | 파일 | 호출 엔드포인트 | 목 |
| --- | --- | --- | --- |
| /rankings | components/rankings/rankings-view.tsx | GET /rankings/tier, /rankings/elo, /games, /seasons | 사용 가능(NEXT_PUBLIC_API_MOCK) |
| / | components/home/home-view.tsx | GET /dashboard/summary | 사용 가능 |
| 사이드바·모바일 머리 | components/shell/app-shell.tsx, season-card.tsx | GET /dashboard/summary(홈과 같은 키) | 사용 가능 |
| /members/[id] | components/profile/profile-badges.tsx, profile-view.tsx, profile-scrim.tsx | GET /users/:id/profile(badges, ratings[].rank) | 사용 가능 |

## 데이터 계층
- lib/api/rankings.ts, lib/hooks/rankings.ts(useTierRanking, useEloRanking, useDashboardSummary), 순수 로직 lib/rankings.ts, lib/dashboard.ts.
- 응답은 모두 shared 스키마로 parse. 결과 승인 시 랭킹·요약, 내전 상태 변경 시 요약을 무효화(lib/hooks/scrims.ts).

## 목 백엔드
- lib/api/mock/rankings.ts: 3개 엔드포인트, badges. 계산은 @gcd/core import. mock/ratings.ts rank는 mockEloStandings 값.
- 시드 버전 5: 지난 시즌 협곡 내전 6개 추가(시즌 1 최종 순위가 비지 않게). 전체를 시간순으로 반영해, 경기 수에 따른 K가 달라져 시즌 2 목 수치도 시드 4와 달라졌다.
- 끝난 시즌(ends_at + 유예)은 읽기 때 standings·뱃지를 계산한다. 종료 작업·소프트 리셋 흉내는 넣지 않음.
- 상태 확인: localStorage `gcd-mock-rankings` = stale | final | no_season | empty | error | loading | me_outside | me_error. 시나리오는 GET /seasons와 프로필 scrim에도 적용된다.

## 검증
- 아래 1차·2차는 QA 수정 전 기록이다. 최종 결과는 맨 아래 「QA minor 반영」 참고.
- typecheck 통과, 테스트 18파일 208개 통과, build 통과.
- Node 20.11이라 임시 vitest 설정(.mjs)으로 실행 후 삭제. 저장소 설정 변경 없음.
- 브라우저: Playwright Chromium, 목 모드 production 빌드. 데스크톱 1440·모바일 390 × 라이트·다크.
  - 1차 128페이지: 기본, stale, final, no_season, empty, error, loading, me_outside × 홈·ELO·티어·내 프로필. 문구 대조 누락 0, 가로 넘침 0, 콘솔 오류 0.
  - 1차에서 모바일 표 이름 잘림·히어로 글자 대비·빈 상태 꼬리표를 발견해 수정.
  - 수정 후 2차 64페이지: 기본, final, empty, me_outside × 홈·ELO·티어·다른 멤버 프로필(뱃지 포함). 넘침·오류 0.
  - stale, no_season, error, loading은 수정 전 빌드에서만 확인(수정은 해당 상태 분기와 무관).
- 재조회 실패 시 이전 데이터 유지, 없는 season의 NOT_FOUND 화면, 필터 조작은 브라우저에서 미실행.

## 계약과 다른 점·추가
1. 종료 시즌(is_final) 규칙 문구는 「시즌 종료 때 확정된 순위 · 동점이면 승률 순」. min_games는 현재 설정값이라 닫힌 시즌 기준과 다를 수 있다(계약 13절).
2. 빈 상태 추가: 종료 시즌 무순위, 시작 전 시즌, 없는 시즌(NOT_FOUND).
3. 모바일 표는 TIER/RECORD 열과 아바타를 숨기고 값을 PLAYER 줄에 합쳤다(목업은 가로 스크롤).
4. 다음 내전 히어로의 팀 평균 패널은 계약에 값이 없어 제외, 기존 배너 이미지 유지.
5. TOP 랭커의 티어 육각형은 응답에 없어 제외, 대신 게임·갱신 시각 줄 추가.
6. 랭킹 쿼리에 5분 refetchInterval 추가.
7. 주소의 tab 값은 티어만 쓰고 ELO는 기본값이라 생략.

## 알려진 한계
- 목에서 프로필이 열리는 멤버는 나와 정글차이뿐이라 다른 순위 행 링크는 「멤버를 찾을 수 없어요」로 간다(S1 목의 기존 범위). 실제 API와 무관.
- 목 ELO 탭의 ▲▼는 티어 탭과 단위 테스트로 확인(시드상 이번 주 변화가 없으면 전부 `—`).
- 라이트 테마 로딩 스켈레톤이 공용 토큰상 대비가 낮다(기존 Skeleton).

## QA minor 반영 (_workspace/03_qa-verifier_web.md 결함 1–10)

| # | 수정 | 확인 |
| --- | --- | --- |
| 1 | useDashboardSummary에 랭킹과 같은 refetchInterval | 브라우저: 홈 열린 채 stale 전환 후 5분 → 「갱신 지연」으로 바뀜 |
| 2 | 뱃지 월 = earned_at − 1ms의 KST 월(표시만) | 단위(경계 ±1ms), 브라우저 「2026.08」 |
| 3 | eloEmptyNote: 종료 시즌 보조 문구 없음. 홈도 eloEmptyState 사용. EmptyState description 선택값으로 변경 | 단위, 브라우저 시즌 1 + 스팀. 홈의 is_final 빈 상태는 목으로 재현 불가, 단위만 |
| 4 | 시즌이 목록에 없으면 빈 옵션 「—」 | 브라우저 4조합, 다른 시즌 선택으로 복귀 |
| 5 | podiumOrder·홈 TOP 색을 entry.rank 기준으로. 3위 밖 제외, 시상대가 비면 숨김 | 단위(rank 공백). 목에 공백 없어 브라우저 미확인 |
| 6 | 지난 경기 전체를 시간순 반영, 시드 버전 5 | 단위(이력 시간순, 마지막 값 = 최종 값) |
| 7 | GET /seasons에 시나리오 적용. 시즌 0개면 select 「시즌 없음」 비활성 | 단위, 브라우저 4조합 |
| 8 | 시즌 카드는 요약 fetching 또는 /me 대기 중에만 스켈레톤. 홈 스켈레톤도 /me 실패 시 숨김 | me_error 시나리오 브라우저 4조합 |
| 9 | applySessionUser: 사용자 id가 바뀌면 me 외 쿼리 reset | 단위(마운트된 observer 포함). 다른 탭 전환 브라우저는 미실행 |
| 10 | 403·404·409 처리에 summary 무효화 | 단위 |

- 지시와 다른 점(9번): qc.clear() 대신 resetQueries를 썼다. 실측 결과 clear()는 구독 중인 observer에 알리지 않아 떠 있는 화면이 이전 사용자 값을 유지한다. reset은 값을 지우고 화면에 알린 뒤 다시 받는다.
- /me 부팅 실패 시 사용자 카드·인사말 스켈레톤은 그대로 남는다(기존 동작, 앱 셸 오류 + 재시도가 함께 표시). 시즌 카드와 홈 본문만 수정했다.
- ELO 안내 줄 0개: 결함 아님. 같은 절차로 ELO 2회·티어 1회를 시계 run_for·fast_forward 각각 측정했다. 둘 다 표는 유지되고 안내는 재조회 후 약 3–4초 뒤 1개로 나타난다(재시도 2회 + 목 지연). 탭별 차이 없음. QA 측정은 재시도 대기 중이었다.

최종 검증: typecheck 통과, 테스트 20파일 220개 통과(임시 vitest 설정 사용 후 삭제), build 통과. 브라우저(수정 후 목 빌드): 위 항목별 확인 + 기본·stale·no_season·error·loading × 홈·ELO·다른 멤버 프로필 × 데스크톱·모바일 × 라이트·다크 60페이지, 문구 누락·가로 넘침·콘솔 오류 0. final·empty·me_outside 전체 화면은 이번 빌드에서 다시 보지 않았고(랭킹 final만 확인) 2차 기록이다.

## 교차 대조 minor 반영 (_workspace/03_qa-verifier_s4.md 결함 2·3·4·6, 계약 D168·10절)

| 항목 | 수정 | 확인 |
| --- | --- | --- |
| 결함 2 | ratingEmptyText: scrim.season null이면 「다음 시즌 준비 중」 + 「현재 진행 중인 시즌이 없어요」(D168). 시즌이 있으면 기존대로 | 단위. 브라우저 final 시나리오: 공백 문구 표시, 「내전 기록 없음」 없음, 최근 내전은 그대로. 이를 위해 목 프로필 scrim에 시나리오 적용 |
| 결함 3 | eloEmptyNote(r, now): ends_at <= now면 보조 문구 없음, now를 모르면 생략 | 단위(경계). 브라우저: 목 저장소의 시즌 ends_at을 바꿔 끝나기 전·후 대조 |
| 결함 4 | seasonFallbackLabel: 값이 목록에 없으면 응답 시즌 이름, 아니면 「—」 | 단위. 브라우저: /seasons를 시즌 1만 캐시한 뒤 응답을 시즌 2로 바꿔 필터 「시즌 2」 확인 |
| 결함 6 | dashboardSummaryOptions로 옵션 분리, 가짜 타이머 + QueryObserver로 5분 재조회 테스트 | 변형: refetchInterval을 지우면 이 테스트 1건 실패(223 통과), 복원 후 전부 통과 |
| 소프트 리셋 문구 | 0.5 절반, 1 「종료 시 레이팅 유지」, 0 「종료 시 레이팅 1000으로 초기화」, 그 외 「종료 시 1000 기준 차이의 N%만 유지」 | 단위(경계 0.001·0.49·0.51·0.999, 반올림). 목은 0.5 고정이라 다른 값은 브라우저 미확인 |

- 테스트 참고: TanStack Query는 window가 없으면 재조회 타이머를 만들지 않아 hooks/rankings.test.ts에서 window를 먼저 정의한다.
- 최종 검증: typecheck·build(일반 모드) exit 0, 테스트 21파일 225개 통과(임시 vitest 설정 사용 후 삭제). apps/web/Dockerfile은 건드리지 않았다.

## S4 후속 변경 화면 (계약 19-2·19-3, D174–D178)

### 팀 호칭
- TEAM_LABEL.orange = RED·레드팀. 결과 문구, 최근 결과, 오류 문구, 팀 화면 aria·라디오·태그를 모두 교체. API 값 orange와 코드 식별자는 그대로.
- 토큰 --team-red, --team-red-ink를 라이트·다크와 globals.css에 추가(두 테마 토큰 수 63으로 일치). 팀 표시 사용처만 바꾸고 경고·패배·순위 하락·스팀 등 orange는 유지.

### ⓘ
- 새 파일: components/ui/info-tip.tsx, components/rankings/elo-info.tsx, lib/elo-info.ts, lib/info-tip.ts. icons에 InfoIcon.
- 위치: /rankings ELO 탭 설명 끝, 프로필 내전 레이팅 카드 라벨 옆. 이를 위해 탭 설명 p와 카드 라벨 span을 div로 변경(패널 div 포함).
- lib/elo-info.ts는 화면 쪽에서 @gcd/core를 쓴다(D176). next.config.ts 주석을 맞춤.

### 패배 배율
- skillFormulaText에 ratio ≠ 1이면 「패배 점수는 N%만 반영해요.」 추가. 팀 카드 예상 변동은 응답 값 그대로.
- 목: mockEloPolicy.lossRatio(shared 기본값), ratingPolicyView.loss_ratio, 요약 rating_policy 4필드, previewTeamElo에 lossRatio 전달. 계산은 core.
- 홈 최근 결과 알약: 「반영 ±N」 → 「최대 N점 변동」(API 값 그대로). ±를 쓰는 다른 화면 없음. 글자가 길어 알약 폭을 104px로 넓힘.

### 검증
- typecheck·build(일반 모드) exit 0, 테스트 23파일 238개 통과(임시 vitest 설정 사용 후 삭제).
- 브라우저(목 production):
  - 호버, 패널로 이동, 벗어나면 닫힘, 클릭 고정, Esc(포커스 유지), Tab 포커스로 열림, 벗어났다 돌아오면 다시 열림, Enter·Space 토글, Tab으로 나가면 닫힘, 패널 밖 스크롤로 닫힘: 데스크톱 라이트·다크. 티어 탭에는 버튼 없음.
  - 터치 탭 열기·닫기, 패널 밖 탭 닫기, 패널 안 스크롤 유지, 390px에서 화면 안쪽·하단 탭 위, 터치 영역 44×44, 프로필 카드 위치(아래 공간 부족 → 위): 모바일 라이트·다크.
  - 요약 실패 때 숫자 없는 문구: 모바일 라이트·다크.
  - 레드팀: 홈 최근 결과 4조합, 내전 상세(팀 카드·승률 막대·결과 입력) 라이트에서 눈으로 확인.
- 단위만: ratio 0·1 문구, 위치 경계. 색 대비는 계약 계산값을 쓰고 직접 측정하지 않았다. 내전 상세 다크는 브라우저 미확인.
- 알려진 제한: 패널을 연 채 요약 값이 늦게 도착하면 높이가 달라져도 위치를 다시 계산하지 않는다(계약: 열릴 때와 창 크기 변경 때만).

## 후속 QA 반영 (_workspace/03_qa-verifier_s4_followup.md 결함 1·2·3·5·6, D180·D181)

| # | 수정 | 확인 |
| --- | --- | --- |
| 1 | ⓘ 버튼에 relative | elementFromPoint: 프로필·랭킹, 1440(프로필)·1366(랭킹)·390 모두 세로·가로 44 |
| 2 | 패널 tabIndex 0. 포커스가 버튼·패널 사이에 있으면 유지, 둘 다 벗어나면 닫음. Esc는 패널 포커스를 버튼으로 돌리고 다시 열리지 않음. 패널 안 스크롤로 닫히지 않음. overscroll-contain 추가 | Chrome 프로필 1440×900(581/488), 랭킹 1366×650(581/496): Tab → 패널 → ↓ 4회로 끝까지 읽음, 끝에서 ↓ 더 눌러도 페이지 그대로·패널 유지, Shift+Tab, Esc, Tab으로 나가면 닫힘 |
| 3 | ratio 0: 「약한 상대에게 질수록」 절 삭제, 「강한 상대를 이길수록 많이 올라요.」는 남김. ratio 1: 제목 「승패 점수」 | 단위 |
| 5 | MockHistory.outcome 추가(승인 때 core outcome 저장), 기준 순위가 이것으로 승패를 셈. 시드 버전 6 | 단위(승리로 세는 음수 변동) |
| 6 | 레이팅 변동 표 스크롤러에 relative | 390px 승인된 내전 상세 scrollWidth 390, innerWidth 390 |

- 결함 2에 따른 추가: 키보드 포커스가 안에 있는 동안 페이지가 스크롤되면 닫지 않고 위치를 다시 계산한다(마우스 고정은 기존대로 닫힘). 이때 버튼이 화면 밖이어도 패널은 화면 안에 둔다(tipPosition).
- 결함 4는 지시대로 수정하지 않았다.
- 최종 검증: typecheck·build(일반 모드) exit 0, 테스트 23파일 242개 통과(임시 vitest 설정 사용 후 삭제). 브라우저는 목 production, 위 표 범위. 터치: 패널 안 탭 유지, 버튼 탭 닫기(라이트).

## 20절(S4 후속 변경 2) — 시작 점수 1000, 소프트 리셋 폐지, 실력값 비중, 라인 추천 (D182–D195)

### 화면 문구 (20-7)

| 위치 | 전 | 후 |
| --- | --- | --- |
| ⓘ 무슨 점수인가요 | …라이엇 티어와는 따로 계산하고, 게임과 시즌마다 따로 쌓여요. | 우리 서버 내전 결과로만 정해지는 점수예요. 라이엇 티어와 상관없이 모두 같은 점수에서 시작하고, 게임과 시즌마다 따로 쌓여요. |
| ⓘ 시작 점수는 어떻게 정하나요(값 유무 같음) | 소프트 리셋·티어 시드 문장 | 모든 멤버가 티어와 상관없이 {RATING_START_ELO}점에서 시작해요. 새 시즌이 시작되면 모두 다시 {RATING_START_ELO}점이 돼요. 지난 시즌 순위는 시즌 최종 순위와 뱃지로 남아요. |
| ⓘ 팀을 나눌 때는요(새, 5번째) | 없음 | 값 있음: 계약 문구(N = round(elo_weight_max × 100)), N = 0이면 「팀 자동 밸런스는 티어만으로 나눠요.」, 값 없음: 「…내전 ELO는 조금만 섞어요.」 |
| ⓘ 승패 예시 기준 | RATING_SEED_DEFAULT | RATING_START_ELO |
| 사이드바 시즌 카드 | softResetText(ratio) | seasonResetText() = 「종료 시 모두 {RATING_START_ELO}점으로 초기화」(HALF_RATIO 삭제, policy 미사용) |
| 밸런스 실력값 설명 | 실력값 = w × 내전 레이팅 + (1 − w) × 티어 시드, w = 내전 경기 수 ÷ F (최대 1). … | 실력값 = w × 내전 ELO + (1 − w) × 티어 환산값. w는 이번 시즌 내전 경기 수에 따라 0에서 N%까지 늘어요(F경기부터 N%). K = …(+ 패배 배율 문장). 값 없음: 「실력값은 티어를 중심으로 이번 시즌 내전 ELO를 조금 섞어 계산해요.」 |
| /rankings ELO 탭 설명 | 서버 자체 내전 레이팅입니다. … | 티어와 상관없이 모두 {RATING_START_ELO}점에서 시작하는 서버 자체 내전 점수입니다. 운영진이 승인한 결과만 반영되고, 시즌마다 새로 시작합니다. |
| 로그인 기능 소개 | 운영진 승인 결과만 반영 · 시즌 소프트 리셋 | 운영진 승인 결과만 반영 · 시즌마다 {RATING_START_ELO}점에서 새로 시작 |

- 숫자는 shared `RATING_START_ELO`와 응답 `rating_policy`(`full_weight_games`, `elo_weight_max`)만. 화면 코드(목 제외)에 1000·0.2·10 리터럴, `*_DEFAULT` import, 「소프트 리셋」·「티어 시드」 없음(rg 확인, 남은 1000은 ms 변환뿐).

### 라인 추천 (20-5, D190–D192)

- 클라이언트 `getMyPositionSuggestions(game)`(lib/api/scrims.ts, `GetMyPositionSuggestionsResponse` parse), 훅 `usePositionSuggestions(game, enabled)`(lib/hooks/scrims.ts, 키 `['me','position-suggestions',game]`, staleTime 5분, retry false, 오류 표시 없음).
- 순수 함수 `positionSuggestionFill`·`positionSuggestionHint`(lib/scrims.ts) + 화면 공용 훅 `usePositionDefaults`(lib/hooks/position-defaults.ts, 새 파일): 「건드림」·「채움」 상태를 들고, 채움 조건 = eligible && 건드리기 전 && 1·2지망 둘 다 빈 값 && 응답 game 일치 && 그 게임 positions 안 값 1개 이상.
- 작성 폼: enabled = game.has_positions, eligible = effPositions. PositionPicker 변경 → touch(), pickGame → reset()(빈 선택 + 다시 채움).
- 상세 JoinControls: enabled = eligible = use_positions && can_join && !inRoster. 참가·대기 중이면 저장값(useState 초기값)만 쓰고 요청도 하지 않는다.
- 안내 「솔로 랭크 최근 {sample_size}경기 기준으로 골라 뒀어요. 바꿔도 돼요.」: 채운 뒤 건드리기 전에만, 고르는 칸 바로 아래(text-xs text-faint).

### 목 (NEXT_PUBLIC_API_MOCK)

- ratings.ts: 새 행 elo = RATING_START_ELO(applyApproval의 tierSeed 입력 삭제, 호출 2곳·미사용 seedOf 정리), skillInfo = computeSkill({ seasonElo, seasonGames: 현재 시즌 행 wins + losses, tierSeed }), rating 폴백 RATING_START_ELO, ratingPolicyView.elo_weight_max. isNew는 기존(모든 시즌 이력 수).
- rankings.ts: SEASON_SOFT_RESET_RATIO_DEFAULT·soft_reset_ratio 삭제, full_weight_games·elo_weight_max 추가, 머리 주석.
- game-accounts.ts + backend.ts: `GET /me/position-suggestions` — 대표 계정 저장 전적 → 프로필과 같은 mainPosition → games.positions 안 값 최대 2개, sample_size, synced_at = matches_synced_at. 동기화 등록 없음. 연동 없음·롤체·스팀 → []. game 누락·모르는 값 → VALIDATION_FAILED.
- scrims.ts: SEED_VERSION 6 → 7.

### 테스트 변경

- elo-info.test.ts: 제목 5개, 시작 점수 상수 문구(값 유무 같음), 리셋·시드·아이언 문구 없음, elo_weight_max 0.2·0.35·0, 값 없음 숫자는 1000점만.
- dashboard.test.ts: softResetText 2개 → seasonResetText 1개. scrim-results.test.ts: 픽스처 elo_weight_max, 문구 전체·N·F 변화·값 없음.
- scrims.test.ts: 추천 기본값 8개(채움, 1개면 1지망만, 건드린 뒤 미적용, 저장값 있으면 미적용·eligible false, 응답 없음·빈 배열·다른 게임, 게임 변경 후 다시 채움, 목록 밖 값 버림, 안내 문구).
- mock: rankings.test.ts·scrim-results.test.ts rating_policy 기대값. 새: 첫 이력 elo_before 전부 1000(시즌 2개 이상), skillInfo w(5경기 1720, 지난 시즌만 뛴 경우 1800·rating 1000, 15경기 760), 추천 엔드포인트(연동 없음 [], 동기화 후 프로필 main_position·sample_size·synced_at과 일치, 갱신 횟수 불변, tft·steam [], 400).
- 시드가 전원 1000 시작으로 바뀌어 값에 기대던 기존 테스트 2개 수정: rankings.test.ts 「ELO 순위 변동」(시드에 이번 주 경기가 있어 처음부터 변동이 생김 → baselineEloRanks로 대조), game-accounts.test.ts 프로필 badges(로그인 사용자가 시즌 1 1위가 되어 뱃지가 생김 → 배열인지만).

### 검증

- `corepack pnpm --filter web typecheck` exit 0, `corepack pnpm --filter web build` exit 0.
- 테스트 23파일 254개 통과. Node 20.11에서 저장소 vitest 설정이 ERR_REQUIRE_ESM이라 /tmp 임시 .mjs(같은 내용)로 실행 후 삭제.
- 브라우저(목 dev, :3100): 로그인 화면 문구, 사이드바 시즌 카드(다크·라이트 데스크톱), ⓘ 새 섹션·시작 점수·ELO 탭 설명(다크·라이트 데스크톱), 작성 폼: 연동 후 탑/정글 + 안내(10경기) → 1지망 미드로 바꾸면 안내 사라짐 → 롤체 → 롤로 돌아오면 다시 탑/정글 + 안내. 상세(화요일 저녁 5:5 내전): 탑/정글 + 안내 → 미드로 바꿔 참가 → 참가 중 미드/정글·안내 없음 → 참가 취소하면 다시 추천. 390px 라이트(작성 폼)·다크(상세): 안내 1줄, 가로 넘침 없음. 모바일 머리는 시즌 이름·D-day만이라 초기화 문구가 없다(기존 그대로).
- 미확인: 실제 api 연동(backend 작업 중), 추천 요청 실패 화면(단위·코드 경로로만 확인).

### 계약과 다르게 한 것

- 없음. 해석: 상세 참가 영역의 요청 enabled는 「포지션 받는 게임」보다 좁게 eligible과 같게 했다(참가 중에는 추천을 쓰지 않으므로 요청할 필요가 없다).
