# QA: S4 후속 변경 2 — apps/web (계약 20절)  — 판정: pass

대상: 계약 `_workspace/01_architect_contract.md` 20절 중 apps/web(20-5 화면 규칙 D192, 20-7 문구 표, 20-12 frontend 표, 20-13 화면·추천 기본값). 구현 보고서 `_workspace/02_frontend-dev_s4.md` 20절.
shared·core·api는 `_workspace/03_qa-verifier_s4_followup2_core_api.md`에서 pass, 재검증하지 않았다(아래 stash 확인 3건만).

사용 도구: Read, Grep, Glob, Shell, Write, cursor-ide-browser(목 dev 서버 :3100).

## 0. stash 후 api 덮어씀 확인 (요청된 3건) — 이상 없음

| 항목 | 결과 |
| --- | --- |
| `apps/api/src/modules/ratings/rating-carry.ts` 없음 | 없음(`ls modules/ratings/` = rating-history·rating-inputs·rating-locks·rating-seed(.spec)·ratings.controller·ratings.module·seasons.service) |
| 승인 9단계 `RATING_START_ELO` | `scrim-results.service.ts:12` import, `:201` 주석, `:206` `elo: RATING_START_ELO` |
| `GET /me/position-suggestions` 라우트 | `profile.controller.ts:32–39` `@Get(ApiPath.myPositionSuggestions)` → `PositionSuggestions.forUser(user.id, query.game)` |

## 1. 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter web typecheck` / `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `npx vitest run`(저장소 설정) | `ERR_REQUIRE_ESM`(Node 20.11, engines ≥ 22) → 환경 문제 |
| `npx vitest run --config /tmp/qa-web-vitest.config.mjs`(같은 내용: `conditions: ['source']`, `@` 별칭, ssr 조건, `include: src/**/*.test.ts`, node 환경, root 명시) | **23파일 254개 통과**. 임시 설정 삭제함 |
| `corepack pnpm --filter web build` | exit 0(12 라우트, `/scrims/new` 181 B, `/scrims/[id]` 15.2 kB) |
| `rg "소프트 리셋\|티어 시드\|softReset\|SOFT_RESET\|soft_reset\|seasonStartElo\|pickPreviousRating\|loadPreviousRatings" apps/web/src` | 1건뿐: `elo-info.test.ts:26` 테스트 제목(「…문구가 없다」를 확인하는 테스트). 화면·목 소스 0건 |
| `rg "_DEFAULT"`(목·테스트 제외) | `scrim-results.ts:19` 주석(「쓰지 않는다」)뿐. import 0건 |
| `rg "\b1000\b\|\b0\.2\b"`(목·테스트 제외) | 6건 모두 ms↔초 변환·퍼센트 반올림(`steam-link-popup.ts:23`, `dashboard.ts:69`, `game-accounts.ts:92`, `scrim-results.ts:33`, `scrims.ts:464`, `scrim-detail.tsx:213`). 정책 숫자 아님 |
| `10` 리터럴(목·테스트 제외) | 정책 숫자로 쓰인 곳 없음(주석 「계약 10절」, staleTime `10 * 60_000`, 재조회 `10_000`, Tailwind `/10`, 제목 maxLength `+ 10`, 차트 축 반올림뿐 — 모두 이번 변경 이전 코드) |

## 2. 20-7 문구 표 대조 — 전 행 일치

| 계약 행 | 코드 위치 | 판정 |
| --- | --- | --- |
| `elo-info.ts` 옛 import·`softResetSentence` 삭제 | `elo-info.ts:1–2` import는 `previewTeamElo`, `RATING_START_ELO`, `DashboardRatingPolicy`만. `softResetSentence` 없음 | 일치 |
| 승패 예시 기준 `RATING_START_ELO` | `elo-info.ts:18` `previewTeamElo({ blueAvg: RATING_START_ELO, orangeAvg: RATING_START_ELO, … })` | 일치 |
| 「무슨 점수인가요」 | `elo-info.ts:41` 계약 문구와 글자 단위 일치 | 일치 |
| 「시작 점수는 어떻게 정하나요」(값 유무 같음) | `elo-info.ts:44–47` `start` 한 객체를 두 분기(`:53`, `:61`)가 공유. 문구 일치 | 일치 |
| 새 섹션 「팀을 나눌 때는요」 | `elo-info.ts:22–26` 값 있음 문구·N = 0 문구, `:55` 값 없음 문구, `:67` 5번째 위치. N = `Math.round(elo_weight_max × 100)`(`:12`, `:23`) | 일치 |
| `dashboard.ts` `seasonResetText()` | `dashboard.ts:25–28` 「종료 시 모두 {RATING_START_ELO}점으로 초기화」. `softResetText`·`HALF_RATIO` 없음 | 일치 |
| `season-card.tsx:5, 42` | `:5` import `seasonResetText`, `:42` `{seasonResetText()}` | 일치 |
| `skillFormulaText` | `scrim-results.ts:57–62` 값 있음 문구 + 패배 배율 문장(`loss_ratio ≠ 1`), 값 없음 문구. 계약과 일치 | 일치 |
| `/rankings` ELO 탭 설명 | `rankings.ts:32` 계약 문구 일치 | 일치 |
| 로그인 기능 소개 | `app/(auth)/layout.tsx:1` import, `:18` 「운영진 승인 결과만 반영 · 시즌마다 {RATING_START_ELO}점에서 새로 시작」 | 일치 |
| 작성 폼 안내 한 줄 | `scrim-new-form.tsx:362` `positionDefaults.hint` | 일치 |
| 상세 `JoinControls` 안내 한 줄 | `scrim-detail.tsx:688` | 일치 |
| 그대로 두는 문구 | `layout.tsx:11` 「티어와 내전 레이팅으로 126가지 조합 중 최적 3안」 유지 | 일치 |

## 3. 라인 추천 기본값(D192) 대조

교차 대조(일대일):

| 계약 | api | web 클라이언트 | 훅 | 목 |
| --- | --- | --- | --- | --- |
| GET `/me/position-suggestions?game=` | `profile.controller.ts:33` `ApiPath.myPositionSuggestions` | `lib/api/scrims.ts:118–121` 같은 `ApiPath`, `GetMyPositionSuggestionsResponse`로 parse | `lib/hooks/scrims.ts:136–144` 키 `['me','position-suggestions',game]`(`:60`), `enabled && game !== null`, staleTime 5분, `retry: false` | `mock/backend.ts:188` 라우팅 → `mock/game-accounts.ts:569–` 쿼리 `GetMyPositionSuggestionsQuery` 검증, 실패 시 `VALIDATION_FAILED` |

규칙별:

| 규칙 | 근거 | 판정 |
| --- | --- | --- |
| 건드리기 전 + 빈 선택일 때만 채움 | `lib/scrims.ts:381` `!eligible \|\| touched \|\| first !== null \|\| second !== null` → null | 충족 |
| 늦게 온 응답이 사용자 선택을 덮지 않음 | 채움 값은 렌더 시점에 `touched`·현재 선택으로 계산(`position-defaults.ts:29–37`), 사용자가 고르면 같은 핸들러에서 `touch()`(`scrim-new-form.tsx:355–358`, `scrim-detail.tsx:681–684`). 늦게 온 응답 렌더에서 `touched = true` 또는 `first ≠ null`이라 `next = null` → effect 미실행 | 충족(코드 경로. 실제 지연 응답 재현은 미확인) |
| 다른 게임 응답 무시 | `lib/scrims.ts:382` `s.game !== input.game` | 충족 |
| 참가·대기 중이면 저장값 우선 | `scrim-detail.tsx:609–615` 초기값 = `viewer.preferred_positions`, `canSuggest = usePositions && can_join && !inRoster` → `enabled`·`eligible` 모두 false(요청도 안 함) | 충족 |
| 게임 변경 시 다시 채움 | `scrim-new-form.tsx:111–117` `pickGame` → `setFirst(null)`, `setSecond(null)`, `reset()`(touched·filled 해제) | 충족 |
| 실패·빈 추천 → 빈 선택, 오류 없음 | 실패면 `q.data` undefined → `next = null`, 훅·화면에 오류 렌더 없음, `retry: false`. `[]`·목록 밖 값만이면 `picked.length === 0` → null(`lib/scrims.ts:383–384`) | 충족 |
| 추천 1개면 1지망만 | `lib/scrims.ts:385` `second: picked[1] ?? null` | 충족 |
| 안내 문구 | `lib/scrims.ts:389–391` 「솔로 랭크 최근 {sample_size}경기 기준으로 골라 뒀어요. 바꿔도 돼요.」, 채운 뒤·건드리기 전·같은 게임일 때만(`position-defaults.ts:49`) | 충족 |
| 단위 테스트 | `scrims.test.ts` 추천 8개(채움, 1개, 건드린 뒤, 저장값·eligible false, 응답 없음·빈 배열·다른 게임, 게임 변경, 목록 밖 값, 안내 문구), `mock/game-accounts.test.ts:225–245` 엔드포인트(연동 없음 [], 프로필 `main_position`과 같은 값·sample_size·synced_at, 동기화 횟수 불변, tft·steam [], 400) | 있음 |

## 4. 약화됐다고 한 목 테스트 2개 판단 — 정당함(결함 아님)

1. **`mock/rankings.test.ts:78–94` 「ELO 순위 변동」**
   - 전: 시드 직후 `rank_change` 전부 0, 내 순위를 1위로 올리면 `rank_change = myRank − 1`, 2위 −1.
   - 후: 시드 직후 값은 `baselineEloRanks`(구현이 쓰는 같은 함수, `mock/rankings.ts:182`)로 대조. 내 elo를 1위 + 1로 올린 뒤 `me = {rank 1, rank_change: myBase − 1}`, 이전 1위가 2위로 내려가고 `rank_change`가 정확히 1 줄었는지 단언.
   - 판단: 시작 점수가 전원 1000이 되어 시드에 이번 주 경기 효과가 순위에 드러나 「전부 0」 전제가 깨졌다. 기대값을 바꾼 이유는 정당하다. 첫 반복문은 구현 함수와 대조라 자기 참조적이지만, ① `baselineEloRanks` 자체는 `:185`에서 고정 픽스처(`{A: 1, B: 2}`)로 독립 검증되고 ② 핵심인 「현재 순위가 바뀌면 변동 = 주 시작 순위 − 현재 순위」는 구체적 산술 단언(`myBase − 1`, `top.rank_change − 1`)으로 남았다. 단언을 빼 버린 것이 아니다.
2. **`mock/game-accounts.test.ts:197` 프로필 badges**
   - 전: `badges: []` 정확 일치. 후: `Array.isArray(empty.badges)`.
   - 판단: 이 테스트는 S1 프로필(연동 전 빈 상태)이 대상이다. 시작 점수 변경으로 로그인 사용자가 목 시즌 1 1위가 되어 뱃지가 생겼다(실제 원인). 뱃지 내용 검증은 S4 테스트 `mock/rankings.test.ts:248–268`(`mockProfileBadges`로 상위 3명 뱃지 정확 일치, 4위는 [])가 맡고 있어 커버리지 손실이 없다. 정당하다.

## 5. 브라우저 확인(목 모드 `NEXT_PUBLIC_API_MOCK=true next dev -p 3100`, 직접 조작)

| 화면 | 다크 데스크톱 | 라이트 데스크톱 | 390px 라이트 | 390px 다크 |
| --- | --- | --- | --- | --- |
| 로그인 기능 소개 「시즌마다 1000점에서 새로 시작」 | 확인 | - | - | - |
| 사이드바 시즌 카드 「종료 시 모두 1000점으로 초기화」 | 확인 | 확인 | 모바일 머리는 시즌·D-day만(기존 설계) | 같음 |
| `/rankings` ELO 탭 설명 + ⓘ 5개 섹션(시작 점수, 「팀을 나눌 때는요」 10경기·20%·80%) | 확인 | 확인 | 미확인 | 미확인 |
| 작성 폼 추천 | 탑/정글 + 안내(10경기) → 1지망 미드 클릭 → 안내 사라짐·미드/정글 유지 → 롤체 → 롤: 빈 선택 뒤 탑/정글 + 안내 다시 | - | 안내 1줄(높이 16px), `scrollWidth 390` 넘침 없음 | 안내 1줄, 넘침 없음 |
| 상세(「화요일 저녁 5:5 내전」) 참가 영역 | 탑/정글 + 안내 → 미드로 바꿔 참가 → 「참가가 확정됐어요」, 미드/정글, 안내 없음 → 새로고침 후에도 미드/정글(추천이 덮지 않음) → 참가 취소 → 탑/정글 + 안내 다시 | 탑/정글 + 안내 확인 | 안내 1줄, 넘침 없음 | 안내 1줄, 넘침 없음 |

- Next dev 「1 Issue」(hydration 속성 불일치)는 브라우저 자동화가 넣는 `data-cursor-ref` 속성 때문이었다(오류 diff가 그 속성뿐). 앱 결함 아님.
- 미확인: 추천 요청 실패·지연 응답을 브라우저에서 재현하지는 않았다(코드 경로·단위 테스트로만). ⓘ의 390px 표시. 실제 api 연동.
- 참고: 검증용 목 상태에서 참가 → 취소를 한 번 했다(원래 상태로 되돌림). 테스트 브라우저 테마는 라이트로 남았다.

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 | 담당 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | minor | `apps/web/src/lib/hooks/position-defaults.ts:12–56` | 계약 20-13 「사용자 변경 후 늦게 온 응답이 덮지 않음」을 테스트로 보인다 | 순수 함수 `positionSuggestionFill`(touched=true면 null)만 테스트된다. 「touch → 그 뒤 응답 도착 → effect 미실행」 순서를 훅·컴포넌트 수준에서 확인하는 테스트는 없다(web에 React 테스트 환경 없음). 코드상 결함은 아님 | `scrims.test.ts`에 훅 순서 테스트 없음 | frontend(선택: 지금 구조로도 안전하다. 테스트 환경을 들일 때 추가) |

blocker·major 없음 → **pass**.

## 이전 결함 재확인

해당 없음(이 대상 첫 검증).
