# QA: S3 apps/web (팀 밸런스·팀 구성·결과 입력/승인/반려·ELO 표·카드 결과·프로필 내전 블록 + 목 백엔드) — 판정: pass

대상: `apps/web/src/{components/scrims/{scrim-teams,scrim-result,scrim-detail,scrim-card}.tsx, components/profile/{profile-scrim,profile-view}.tsx, lib/{scrim-results,scrims,errors}.ts, lib/api/{ratings,scrims}.ts, lib/hooks/{ratings,scrims}.ts, lib/api/mock/**}`, `apps/web/{package.json,next.config.ts}`
기준: 계약 `_workspace/01_architect_contract.md`(S3) 4·4-1·5·8·9·12·13절, D103–D127, shared `packages/shared/src/**`, 구현 보고서 `_workspace/02_frontend-dev_s3.md`, 리더 결정(backend 요청 1–6 수용 — 새 참가 시 팀 초기화, 최근 결과 동점 「활성 먼저」 등 / frontend 요청 1 = 결과 표 NEW 제거·`K {k_factor}`만, 2 = 최근 내전에 게임 이름, 3 수용)
사용 가능 도구: Read, Grep, Glob, Bash(Git Bash), Write. 브라우저·스크린샷 도구 없음. 지시에 따라 api 테스트는 실행하지 않음(backend가 apps/api를 수정 중이라 컨트롤러·직렬화 코드는 읽기만 함).

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter web typecheck` | `tsc -p tsconfig.json --noEmit` 출력 없음, exit 0 |
| `corepack pnpm --filter web test` | **Test Files 15 passed (15), Tests 155 passed (155)**, exit 0 (scrim-results 10, scrims 24, mock/scrim-results 8, mock/scrims 22, mock/game-accounts 10 등) |
| `corepack pnpm --filter web build` | `✓ Compiled successfully`, 타입·린트 통과, 12/12 페이지. `ƒ /members/[id] 122 kB (First Load 291 kB — recharts)`, `ƒ /scrims/[id] 16.5 kB / 201 kB`, `○ /scrims 3.24 kB`. exit 0 |
| 하드코딩 검사(grep) | 화면 코드(mock 제외)에서 `@gcd/core` import 0건, `SCRIM_ELO_*`·`SEASON_AUTO_LENGTH*`·`K_BASE/K_NEW` 0건, scrim-result/scrim-teams/profile-scrim/scrim-results.ts에 32·40 리터럴 0건. K·w 기준 숫자는 `rating_policy`(밸런스 응답)와 `k_factor`(결과 응답)로만 나옴 |
| 색 토큰 검사 | 대상 6개 컴포넌트에 hex·rgb·hsl 0건. 쓰인 색 유틸리티(bg-/text-/border-/from-…) 전부 globals.css `--color-*` 목록 안. Recharts 색은 `var(--accent|--orange|--faint|--surface|--line|--line-3|--shadow)` — `styles/tokens.css` 라이트·다크 두 블록에 모두 정의 |
| 의존성 확인 | `node_modules/recharts` 3.10.1, peer `react-is ^16.8–^19` → `react-is 19.2.9`(react 19.2.9와 같은 버전) 타당. lockfile에 recharts·react-is·redux 반영. `@gcd/core` exports에 `source` 조건 있음 → next.config `transpilePackages`+`conditionNames: ['source', …]`로 src 사용, build 통과 |

미실행: 브라우저 목 모드 데스크톱·모바일 × 라이트·다크 육안 확인(도구 없음). 결함이 아니라 미검증 항목이다.

## 결함

blocker 0, major 0, minor 8.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/web/src/lib/api/mock/scrims.ts:863, :917 | 목 `can_balance` = shared `ScrimViewer` 주석·backend `scrim-views.service.ts:378-379`과 같은 식(can_edit_teams && auto_balance && joined 2–16) | 목에만 `positionsFit`(⌈n/2⌉ ≤ 포지션 수) 조건이 더 있다 | 지금 게임 시드로는 차이가 나지 않는다(포지션 쓰는 게임은 롤뿐, 정원 최대 10 → ⌈10/2⌉ = 5 = 포지션 수). 포지션 수보다 정원이 큰 게임이 생기면 목은 버튼을 숨기고 실제 API는 보여 준 뒤 409를 준다. 조건을 빼거나 shared 규칙에 넣어 두 쪽을 맞추기를 권고 |
| 2 | minor | apps/web/src/components/scrims/scrim-bits.tsx:108-110, scrim-teams.tsx:355, scrim-result.tsx:130·187 | 계약 9절 「VALIDATION_FAILED details는 해당 입력 아래」 | details를 `(메시지, 메시지)`로 이어 붙여 패널 맨 아래 한 줄로 보여 준다. path(`blue.2.position`, `placements.0.user_id`)를 해당 행에 연결하지 않는다 | 화면 사전 검사(buildTeamsRequest·buildPlacements)가 대부분 막아서 실제로 보이는 경우는 드물다(재현 예는 5번). 표시 위치만 다르다 |
| 3 | minor | apps/web/src/components/profile/profile-scrim.tsx:75-78, :130-131 | 로딩·오류 상태 분리(nextjs-dashboard-ui 4절) | 레이팅 행이 없는 사용자는 기본 게임을 `useGames()`에서 고른다. `GET /games`가 실패하면 `game === null`이라 Skeleton이 계속 돌고 오류·재시도가 나오지 않는다 | 목에서 내전 기록이 없는 사용자 프로필 + `/games` 실패(네트워크 차단) → 그래프 자리에 Skeleton만 계속 보임. `games.isError`면 ErrorState를 보여 주기를 권고 |
| 4 | minor | apps/web/src/lib/hooks/scrims.ts:135-138, lib/hooks/ratings.ts:37-44 | 승인으로 새 시즌이 자동 생성되면(D116) 그래프 시즌 선택에 바로 나온다 | 승인 성공 때 `['users']`만 무효화하고 `['seasons']`(staleTime 10분)는 그대로 → 최대 10분 동안 새 시즌이 목록에 없다. 기본 선택(「현재 시즌」 = season 생략)은 서버 기본값이라 그래프 자체는 맞게 나온다 | 시즌이 없는 상태에서 프로필 열기 → 다른 탭에서 승인 → 프로필 시즌 선택 목록에 「시즌 N」 없음. 승인 onSuccess에서 `ratingKeys.seasons` 무효화를 권고 |
| 5 | minor | apps/web/src/components/scrims/scrim-result.tsx:137-140 | 순위 입력 대상 = 현재 joined 참가자 | `draft`가 처음 렌더 때 joined로만 초기화된다. 입력 중에 20초 재조회로 누군가 노쇼로 바뀌면 그 행은 목록에서 사라지지만 draft에 순위가 남아 제출된다 → 서버 `VALIDATION_FAILED(placements.i.user_id)` | 롤체 진행 중 내전에서 순위를 매기는 동안 운영진이 한 명을 노쇼 표시 → 재조회 후 「결과 제출」 → 400 + 2번 방식의 문구. 다시 고르면 복구된다. 제출 때 `joined`에 있는 id만 남기기를 권고 |
| 6 | minor | apps/web/src/lib/scrim-results.ts:165-168 | 방장에게는 「방장이 결과를 입력하면 …」(제출 권한이 없는 사람용 문구)를 보여 주지 않는다 | 개인 순위 게임에서 joined가 2명 미만이면 `can_submit_result = false`이고 has_teams가 아니라 `need_teams`로도 가지 않아, 방장에게도 `waiting` 문구가 나온다 | 롤체 진행 중 내전에서 1명만 남기고 노쇼 표시 → 방장 화면 RESULT에 「방장이 결과를 입력하면 운영진 승인 후 확정돼요」. 드문 경우이고 문구만 어색하다 |
| 7 | minor | apps/web/src/lib/api/mock/scrim-results.test.ts:111-128 | 리더가 수용한 backend 요청 1(새 참가 확정 시 팀 초기화)을 목 테스트로 확인 | 테스트는 참가 취소만 다룬다. 새 참가 경로 코드(mock/scrims.ts:1341, :1361 `joinedSet` 비교 후 `resetTeams`)는 있고 backend `scrims.service.ts:370-372`와 같은 조건이다(코드를 읽어 확인함) | 「full → 팀 저장 → 정원 확대(승격 없음, recruiting) → 새 참가 → 팀 null」 케이스 추가를 권고 |
| 8 | minor | apps/web/src/lib/hooks/ratings.ts:29-30, lib/hooks/game-accounts.ts:197-199 | 캐시 키 범위가 겹치지 않거나, 겹쳐도 다른 응답 모양을 건드리지 않는다 | 그래프 키 `['users', id, 'rating-history', …]`가 `setQueriesData({queryKey: ['users']}, updater)`(동기화 성공 시 프로필 갱신) 범위 안에 들어간다. 지금은 updater가 `old?.is_self`가 없으면 `old`를 그대로 돌려줘서 영향이 없다 | 지금 동작에는 영향이 없다. 나중에 이 updater를 바꾸면 그래프 캐시를 프로필 모양으로 덮어쓸 수 있다. `setQueriesData` 대상을 `['users', id, 'profile']` 형태로 좁히기를 권고 |

참고(S2에서 넘어온 항목, 이번 판정에 넣지 않음): S2 QA minor 1(목이 core 규칙을 다시 적음)은 일부만 고쳐졌다. `computeOpenPositions`는 core import로 바뀌었지만 `orderWaitlist`·`validatePositions`·`computeRestriction`·`canStart`·자동 마감은 아직 목 안에 따로 적혀 있다(mock/scrims.ts:260-298, :745-767). 이제 `@gcd/core` 의존성이 있으니 같은 방식으로 바꿀 수 있다.

## 교차 대조 표 — S3 엔드포인트 8개 + 확장 3개

| # | 계약 4절 | shared `ApiPath` | api 컨트롤러 | 웹 API → parse 스키마 | 웹 훅 | 목 핸들러(mock/scrims.ts) | 일치 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POST /scrims/:id/balance | scrimBalance | scrims.controller.ts:143 `@Post` 200, body pipe | balanceScrim :62(본문 `{}`) → `BalanceScrimResponse` | useBalanceScrim(캐시 저장 안 함) | :1175 id → body → 404 → 403 → TEAMS_NOT_EDITABLE → BALANCE_UNAVAILABLE(RangeError 포함) | O |
| 2 | PUT /scrims/:id/teams | scrimTeams | :154 `@Put` 200 | saveScrimTeams → `SaveScrimTeamsResponse` | useSaveScrimTeams → applyScrimDetail | :1196 core `validateTeamAssignment`, 초기화 후 슬롯 저장 | O |
| 3 | POST /scrims/:id/result | scrimResult | :165 `@Post` 200 | submitScrimResult → `SubmitScrimResultResponse` | useSubmitScrimResult | :1224 404 → 403 → NOT_ALLOWED → EXISTS → 모양 400 → TEAMS_REQUIRED / core `validatePlacementUsers` | O |
| 4 | DELETE /scrims/:id/result | scrimResult | :176 `@Delete` 200 | withdrawScrimResult → `WithdrawScrimResultResponse` | useWithdrawScrimResult | :1268 404 → NOT_PENDING → 403(제출자·방장 아님) → 행 삭제 | O |
| 5 | POST /scrims/:id/result/approve | scrimResultApprove | :184 `@Roles('admin')` | approveScrimResult `{result_id}` → `ApproveScrimResultResponse` | useApproveScrimResult → applyScrimResultDetail(목록·`['users']` 무효화) | :1117 403 먼저 → id → body → 404 → NOT_PENDING(id 불일치 포함) → SELF_REVIEW → core 승인 → finished | O |
| 6 | POST /scrims/:id/result/reject | scrimResultReject | :197 `@Roles('admin')` | rejectScrimResult `{result_id, reason}` → `RejectScrimResultResponse` | useRejectScrimResult | 위와 같은 순서 → rejected, 내전 playing 유지 | O |
| 7 | GET /seasons | seasons | ratings.controller.ts:24 | listSeasons → `ListSeasonsResponse` | useSeasons | :1095 seasonsResponse(starts_at DESC, is_current = resolveSeasonAt) | O |
| 8 | GET /users/:id/rating-history | userRatingHistory | ratings.controller.ts:30 Param+Query pipe | getUserRatingHistory(game, season?) → `GetUserRatingHistoryResponse` | useUserRatingHistory(keepPreviousData) | :1098 id → query → 404 사용자 → 404 시즌, 기본 시즌 resolveSeasonAt → latestStartedSeason, 100개 + truncated | O |
| 9 | GET /scrims (확장) | scrims | 기존 | `ListScrimsResponse` | useScrims | summary :847-848 result_status(동점 규칙 「활성 먼저」 = backend 요청 2)·outcome | O |
| 10 | GET /scrims/:id (확장) | scrim | 기존 | `GetScrimResponse` | useScrim(playing도 20초 재조회) | detail :852 players skill·is_new·position_preference, viewer can_* 5개, balance(teamsView, 두 팀 다 있을 때만), result(resultView) | O(1번 can_balance 차이) |
| 11 | GET /users/:id/profile (확장) | userProfile | 기존 | `GetUserProfileResponse`(`scrim: ProfileScrim.nullable()`) | useUserProfile | backend.ts:199-214에서 S1 응답의 `scrim`을 목 내전 저장소로 채움(항상 객체 — 목 프로필이 있는 사용자 2명 모두 MOCK_SCRIM_USERS에 있음) | O |

훅 8개(계약 9절 목록) = 위 1–8과 일대일. 응답은 모두 `apiClient.request(path, Schema)`로 shared zod parse(제네릭 단언 없음). snake_case가 화면까지 그대로 온다.

## 목 백엔드 ↔ 실제 API 규칙 대조

| 항목 | 실제(backend·shared) | 목 | 결과 |
| --- | --- | --- | --- |
| viewer can_edit_teams / can_submit_result / can_withdraw_result / can_review_result | scrim-views.service.ts:376-386, shared scrims.ts:384-390 | mock/scrims.ts:862, :918-921 — 같은 식 | O |
| viewer can_balance | joined 2–16 | + positionsFit | 결함 1 |
| 팀 초기화 5-1 | 참가 확정(새 참가) / 확정자 취소 / 정원 확대 승격 시 `resetTeams`(scrims.service.ts:300, :372, :398), 노쇼 표시는 유지 | joined 집합 문자열을 앞뒤로 비교해 바뀌면 초기화(:1361 참가, :1377 취소, :1444 정원), 재참가 행 team·position null(:1344), 노쇼 경로에는 없음 | O(동치) |
| 최근 결과 동점 규칙(요청 2) | created_at DESC → 활성 먼저 → id DESC | ratings.ts:355-361 같은 순서 | O |
| 오류 판정 순서 | 4절 표 + Roles 가드 먼저 | 위 교차 표 | O |
| 상태 전이 | playing → finished(승인만), 결과 pending → approved/rejected, pending delete | :1152 finished, :1135 rejected, :1273 삭제. 반려·취소는 내전 상태를 바꾸지 않음 | O |
| 계산에 @gcd/core 사용 | - | ratings.ts:1-21 `balanceTeams`·`evaluateTeams`·`computeSkill`·`computeTeamEloUpdates`·`computePlacementEloUpdates`·`selectRatedParticipants`·`previewTeamElo`·`resolveSeasonAt`·`latestStartedSeason`·`planAutoSeason`·`isPlacementWin`·`computeWinRate`·`tierSeedRating`·`roundHalfAwayFromZero`, scrims.ts:1-8 `validateTeamAssignment`·`validatePlacementUsers`·`positionPreferenceOf`·`computeOpenPositions`. 목 안에 ELO·밸런스·시즌 공식 복사본 없음. 직렬화 반올림(정수, 확률 소수 셋째 자리)만 목에서 함(계약 7-4 7번과 같음) | O |
| rating_status / rating_changes / 순위 다시 매기기 | 4-1 | ratings.ts:376-429 not_rated → applied/skipped → waiting, delta DESC·user id ASC, 이력 있는 사용자만 1..M로 다시 매김 | O |
| 프로필 recent outcome | no_show → unassigned → 팀 승패 / 순위 `isPlacementWin(placement, placements.length)` | ratings.ts:457-481 같음, approved_at DESC 최대 5 | O |

## 화면별 버튼 노출 ↔ viewer can_*

| 버튼·영역 | 조건(코드) | 계약 | 결과 |
| --- | --- | --- | --- |
| 「팀 자동 밸런스 실행」 | `v.can_balance`(scrim-teams.tsx:347) | can_balance | O |
| 「팀 직접 구성」/「팀 다시 구성」 | `v.can_edit_teams`(:340-346). auto_balance=false면 밸런스 버튼 없이 이것만 | can_edit_teams | O |
| 밸런스 결과·편집기 표시 | `plan.key === rosterKey && v.can_edit_teams`(:216-218) — 명단이 바뀌거나 결과가 제출되면 버림 | 9절 「명단이 바뀌면 지운다」 | O |
| 결과 입력 폼 | `resultPanelState` → `viewer.can_submit_result`(scrim-results.ts:165) | can_submit_result | O |
| 「제출 취소」 | `v.can_withdraw_result`(scrim-result.tsx:221) | O | O |
| 「승인」「반려」 | `v.can_review_result`(:226). 본인 제출 운영진은 안내 문구(:205, :239) | O | O |
| 노쇼 대화상자 추가 줄 | `s.result?.status === 'approved'`(scrim-detail.tsx:529) | 승인 후일 때 | O |

## 계약 9절·8절 문구 대조

| 위치 | 계약 문구 | 구현 | 결과 |
| --- | --- | --- | --- |
| 밸런스 부제 | 「{n}가지 팀 구성 × 포지션 배정 중 비용이 가장 낮은 {k}개 안」(포지션 미사용이면 「× 포지션 배정」 없음) | scrim-results.ts:52-54 | O |
| 탭 | 「{rank}안 · 차 {power_diff}」 | scrim-teams.tsx:276-277(두 줄 배치) | O |
| 요약 | 블루 % · 전력 차 · 포지션 비용 · 오렌지 %(소수 첫째 자리) | OddsBar :153-180, percent1 | O |
| 팀 카드 | 「BLUE 평균 {skill_avg}」, 포지션 약칭·닉네임·1지망/2지망/그 외·실력값, 「합계 · 승리 +X · 패배 −Y」(preview null이면 생략) | :87-150, eloPreviewText(U+2212) | O |
| 실력값 설명 | rating_policy 값으로만, 응답 전에는 숫자 없는 문구 | skillFormulaText :57-60, 응답 전 :342 `skillFormulaText(null)` | O |
| 확정 버튼 | 「{rank}안으로 팀 확정」, 「직접 수정」 | :325-330 | O |
| 미배정 | 「팀 미배정 {n}명 — 레이팅에 반영되지 않아요」 | :407 | O |
| RESULT 부제 | rated / rated=false 두 문구 | resultFlowText | O |
| 모집 중 | 「경기가 시작되면 결과를 입력할 수 있어요」 | scrim-result.tsx:60 | O |
| 입력 | 「승리 팀을 고르세요」 + BLUE/ORANGE 승리 → 「결과 제출」, 순위 「순위 없음」·2명 이상 | :96-127, :152-186 | O |
| 반려 배너 | 「운영진이 결과를 반려했어요: {reject_reason}」 | :56 | O |
| 권한 없음 / 팀 없음 | 「방장이 결과를 입력하면 운영진 승인 후 확정돼요」 / 「결과를 입력하기 전에 팀을 구성해 주세요」 | :63-64 | O(결함 6 경계) |
| pending | 「{블루팀|오렌지팀} 승리로 제출했어요. 운영진이 승인하면 레이팅이 반영됩니다.」, 순위·rated=false 변형, 제출자·KST 시각 | pendingResultText, :215-218 | O |
| 승인 확인 | 「승인하면 참가자 레이팅이 바로 반영되고 되돌릴 수 없어요」 | :260 | O |
| 반려 사유 | 2–200자 필수 | shared `RejectReason` safeParse + confirmDisabled | O |
| 본인 제출 | 「내가 제출한 결과는 다른 운영진이 승인해야 해요」 | :239 | O |
| approved | 「{approved_by} 승인 · {KST}」, 표 `elo_before → elo_after`·`+16`/`−15`, skipped/not_rated 문구 | :349-405, ratingStatusText | O |
| 결과 표 NEW(리더 결정 1) | NEW 제거, `K {k_factor}`만 | :380 `K {c.k_factor}`, NEW 없음 | O |
| `/scrims` 카드 | playing+pending 「승인 대기」, 종료 「블루팀 승리」/「오렌지팀 승리」(팀 색)/「1위 {닉네임}」 | lib/scrims.ts scrimCardBadge·scrimOutcomeLine, scrim-card.tsx:116-130 | O |
| 프로필 카드 | 대표 게임 = games 최다, 「{w}승 {l}패 · 승률 {n}%」, 「아직 경기 없음」, 「내전 기록 없음」 | primaryRating·ratingRecordText, profile-scrim.tsx:31-44 | O |
| 그래프 | 첫 점 elo_before, 상승 accent·하락 orange, 머리 「elo delta · 시즌」, 「{n}경기 전 … 최근」, 빈 상태, 「최근 100경기만 보여요」 | ratingChartData, :87-95, :213-217, :137 | O |
| 최근 내전(리더 결정 2) | 칩 WIN/LOSS/노쇼/미배정, 제목 링크, 「MM.DD · 게임 · 포지션/순위」, delta 또는 「미반영」, 빈 상태 | :241-264(`GAME_META[r.game].short` 추가) | O |
| 진행 단계(8절 표) | recruiting(시작 대기) / full(팀 구성 완료 · 시작 대기 / 정원 마감 · 팀 구성 중, 개인 순위는 「참가 확정」 완료) / playing(결과 반려됨) / pending 4단계 「승인 대기」 / finished 전부 완료 / cancelled null | lib/scrims.ts scrimSteps, scrims.test.ts에서 분기 확인 | O |

로딩·빈 상태·오류: 상태 변경 409(NOT_PENDING·TEAMS_NOT_EDITABLE·RESULT_EXISTS)는 토스트(staleToast) + 훅이 상세·목록 재조회(handleScrimMutationError 403/404/409). 그 밖의 오류는 인라인 InlineError. 그래프는 Skeleton/ErrorState(재시도)/EmptyState(결함 3 예외). 진행 중 버튼은 isPending 동안 비활성.
라우트·링크: `routes.member(id)` → `app/(main)/members/[id]`, `routes.scrim(id)` → `app/(main)/scrims/[id]` 존재. S3 새 컴포넌트에 문자열 경로 하드코딩 없음.
