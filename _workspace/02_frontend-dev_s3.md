# frontend-dev S3 보고서 — 팀 밸런스·결과·승인·ELO·레이팅 그래프

계약: `_workspace/01_architect_contract.md`(S3, D103–D127) 9절, 리더가 수용한 backend 변경 요청 1–6.

## 검증 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter web typecheck` | 통과 |
| `corepack pnpm --filter web test` | 155개 통과 / 실패 0 (기준선이던 `lib/api/mock/scrims.test.ts` 17개 실패 해소, S3 테스트 18개 추가) |
| `corepack pnpm --filter web build` | 통과 (`/members/[id]` 첫 로드 291 kB — Recharts 때문) |

브라우저 수동 확인(데스크톱·모바일 × 라이트·다크)은 이 환경에서 하지 못했다. 목 모드에서 아래 시나리오로 직접 확인해야 한다.

## 화면

| 라우트 | 내용 | 호출 엔드포인트 |
| --- | --- | --- |
| `/scrims/[id]` | 진행 단계(8절 표, 개인 순위 게임은 「참가 확정」, 단계별 보조 문구), 헤더 배지(팀 구성 완료·결과 승인 대기), ROSTER 실력값·NEW·팀 색 점·배정 포지션, AUTO BALANCE(3안 탭, 기대 승률 막대, 전력 차·포지션 비용, BLUE/ORANGE 카드, 1지망/2지망/그 외 칩, 승리 +X · 패배 −Y, `rating_policy`로만 만드는 실력값 설명), 「{rank}안으로 팀 확정」, 「직접 수정」 편집기(블루/오렌지/미배정 + 포지션), 저장된 팀 표시 + 「팀 미배정 n명」, RESULT(팀 승리 선택 / 롤체 순위 선택, 반려 배너, 승인 대기 + 제출 취소·승인 확인·반려 사유 2–200자, 본인 제출 운영진 안내, 승인 후 결과 + ELO 변동 표 / skipped / not_rated 문구), 노쇼 확인 대화상자에 「이미 반영된 레이팅은 바뀌지 않아요」, 진행 중에도 20초 재조회 | GET /scrims/:id, POST /balance, PUT /teams, POST·DELETE /result, POST /result/approve, POST /result/reject |
| `/scrims` | 진행 중 + pending이면 「승인 대기」 배지, 종료 카드 「블루팀 승리」/「오렌지팀 승리」(팀 색) / 「1위 {닉네임}」 | GET /scrims |
| `/members/[id]` | 내전 레이팅 카드(대표 게임 = 경기 수 최다, 「17승 11패 · 승률 61%」, 기록 없음), RATING HISTORY(Recharts 선 그래프, 게임·시즌 선택, 상승 accent/하락 orange 점, 머리 「elo · delta · 시즌」, 「n경기 전 … 최근」, 빈 상태, 「최근 100경기만 보여요」), 최근 내전(WIN/LOSS/노쇼/미배정 칩, MM.DD · 포지션 또는 n위, delta 또는 「미반영」) | GET /users/:id/profile, GET /users/:id/rating-history, GET /seasons, GET /games |

409 `SCRIM_RESULT_NOT_PENDING`·`SCRIM_TEAMS_NOT_EDITABLE`·`SCRIM_RESULT_EXISTS`는 토스트로 알리고 훅이 상세를 다시 조회한다. `VALIDATION_FAILED` details는 입력 아래에 표시한다. 승인·노쇼 응답은 목록과 함께 프로필·그래프 캐시(`['users', …]`)도 무효화한다.

## 코드

- API 함수: `apps/web/src/lib/api/scrims.ts`(S3 6개), `apps/web/src/lib/api/ratings.ts`(시즌·그래프). 응답은 모두 shared zod로 parse.
- 훅 8개: `apps/web/src/lib/hooks/scrims.ts`(`useBalanceScrim`(캐시 저장 안 함), `useSaveScrimTeams`, `useSubmitScrimResult`, `useWithdrawScrimResult`, `useApproveScrimResult`, `useRejectScrimResult`), `apps/web/src/lib/hooks/ratings.ts`(`useSeasons`, `useUserRatingHistory`).
- 화면 로직(순수 함수, 테스트 있음): `apps/web/src/lib/scrim-results.ts`, `apps/web/src/lib/scrims.ts`(`scrimSteps` 시그니처 변경, `scrimOutcomeLine` 추가).
- 컴포넌트: `components/scrims/scrim-teams.tsx`, `components/scrims/scrim-result.tsx`, `components/profile/profile-scrim.tsx`. `ConfirmDialog`에 `confirmDisabled` 추가.
- `lib/errors.ts` S3 오류 문구 7개 다듬음. `lib/games.ts` 포지션 약칭(TOP·JGL·MID·ADC·SUP) 추가.
- 화면 코드는 `SCRIM_ELO_*_DEFAULT`·`SEASON_AUTO_LENGTH_MONTHS_DEFAULT`를 import하지 않는다(grep으로 확인함).
- 의존성: `@gcd/core: workspace:*`, `recharts 3.10.1`, `react-is 19.2.9`(recharts peer). `next.config.ts` `transpilePackages`에 `@gcd/core` 추가. lockfile 갱신.

## 목 백엔드 (NEXT_PUBLIC_API_MOCK)

- `lib/api/mock/ratings.ts`(새 파일): 결과·시즌·ratings·rating_history 저장소, 밸런스 응답, 상세 balance, 승인 시 ELO 반영, 결과 뷰, 프로필 scrim 블록, 그래프, 시즌 목록. 계산은 모두 `@gcd/core`를 import한다(`balanceTeams`, `evaluateTeams`, `computeSkill`, `computeTeamEloUpdates`, `computePlacementEloUpdates`, `selectRatedParticipants`, `previewTeamElo`, `resolveSeasonAt`, `latestStartedSeason`, `planAutoSeason`, `isPlacementWin`, `computeWinRate`, `tierSeedRating`, `roundHalfAwayFromZero`). 목에 공식 복사본은 없다.
- `lib/api/mock/scrims.ts`: 새 엔드포인트 8개, 목록 `result_status`·`outcome`, 상세 players(`skill`·`is_new`·`position_preference`·team·position)·viewer can_* 5개·balance·result. S2의 `computeOpenPositions` 복사본도 core import로 바꿨다. 5-1 팀 초기화: 참가 취소·정원 수정에 더해 **새 참가**도 포함(backend 요청 1, 리더 수용). 최근 결과 동점 규칙은 「활성 행 먼저」(요청 2)를 따랐다.
- `lib/api/mock/backend.ts`: `/seasons`·`/users/:id/rating-history` 라우팅, 프로필 응답의 `scrim`을 내전 목 저장소로 채움.
- 시드(`SEED_VERSION` 3 — 버전이 다르면 저장된 목 DB를 다시 만든다): 시즌 1·2, 지난 협곡 내전 14개를 core 승인 흐름으로 차례로 반영(1개는 rated=false, 1개는 노쇼 포함), 지난주 롤체 로비 순위 승인, 진행 중 「내가 연 협곡 내전」(내가 방장·팀 구성 완료 → 결과 입력), 「승인 대기 협곡 내전」(미드고정 제출 → 운영진 승인·반려), 「롤체 순위전 로비」(내가 방장·반려됨 → 순위 다시 입력), 기존 「주말 협곡 2판 연속」(밸런스 3안·팀 확정). 운영진 화면은 dev-login role admin으로 본다.
- 목 전용 가정: 티어 시드는 목 멤버별 고정 티어(나 = 에메랄드). S1 연동 계정 스냅샷과는 연결하지 않았다.
- 테스트: `lib/api/mock/scrim-results.test.ts`(8개), `lib/scrim-results.test.ts`(10개). 기존 기대값은 시드 증가에 맞춰 갱신함(`scrims.test.ts` 종료 탭, `game-accounts.test.ts` 프로필 scrim이 이제 객체).

## 계약 변경 요청

1. **승인 결과 표의 「NEW」(K 40일 때)**: 계약은 `k_factor`가 40이면 NEW라고 하지만 화면 코드에 40을 쓸 수 없다(D124, QA 규칙). 지금은 각 행에 `K {k_factor}`를 그대로 보여 주고, NEW 배지는 그 참가자의 **현재** `players[].is_new`로 대신한다(경계 경기에서는 다를 수 있음). 정확하게 하려면 `ScrimRatingChange`에 `is_new_k: boolean`을 추가하거나 `ScrimResultView`에 `rating_policy`를 넣어 달라.
2. **최근 내전 보조 줄**: 계약 「MM.DD · 포지션 또는 n위」를 따랐다. 게임 종류는 화면에 보이지 않는다(스크린리더 문구에만). 롤·롤체가 섞이면 게임 표시가 필요할 수 있다.
3. **노쇼 표시도 프로필 캐시를 무효화**: 노쇼가 프로필 최근 내전 칩에 반영되므로 노쇼 응답에서도 프로필 캐시를 무효화했다(계약 범위보다 넓음, 동작 차이만).

## 수정 이력

### 리더 결정 반영 (계약 변경 요청 1–3)

1. 승인 결과 ELO 변동 표에서 NEW 배지 제거, `K {k_factor}`만 표시(`components/scrims/scrim-result.tsx`). ROSTER·팀 카드의 NEW 배지는 그대로. 계약 필드 추가 없음.
2. 프로필 최근 내전 보조 줄에 게임 이름 추가: 「MM.DD · 롤 · 탑」/「MM.DD · 롤체 · 3위」. 응답 `ProfileRecentScrim.game`(이미 있는 필드)을 `GAME_META[game].short`로 표시(`components/profile/profile-scrim.tsx`). 계약 변경 없음.
3. 노쇼 응답의 프로필 캐시 무효화: 수용됨(코드 변경 없음).

검증: `corepack pnpm --filter web typecheck` 통과, `test` 155개 통과, `build` 통과.

### S3 web QA minor 8건 반영 (`_workspace/03_qa-verifier_web.md`)

| # | 수정 | 위치 |
| --- | --- | --- |
| 1 | 목 `can_balance`에서 `positionsFit` 조건 제거 → backend `scrim-views.service.ts`·shared 주석과 같은 식(can_edit_teams && auto_balance && joined 2–16). 포지션 수를 넘는 경우는 POST /balance가 409 | `lib/api/mock/scrims.ts` |
| 2 | VALIDATION_FAILED details를 path로 해당 입력 행 아래에 표시(`blue.{i}.*`·`orange.{i}.*` → 편집기 참가자 행, `placements.{i}.*` → 순위 행). 행을 찾지 못한 path(`blue`, `winner_team` 등)만 패널 하단. `splitValidationDetails`·`teamPathUser`·`placementPathUser`(lib/scrim-results.ts), `RowErrors`·`scrimErrorTextRest`(scrim-bits.tsx) | `scrim-teams.tsx`, `scrim-result.tsx` |
| 3 | 레이팅 기록이 없어 기본 게임을 GET /games로 고르는데 그 조회가 실패하면 Skeleton 대신 ErrorState + 다시 시도 | `components/profile/profile-scrim.tsx` |
| 4 | 승인 성공 때 `['seasons']`도 무효화(자동 생성 시즌이 바로 보이게) | `lib/hooks/scrims.ts` |
| 5 | 순위 입력 draft를 렌더마다 현재 joined 명단으로 정리(`pruneDraft`) — 재조회로 노쇼·이탈한 사람의 순위는 제출되지 않는다 | `scrim-result.tsx` |
| 6 | 개인 순위 게임에서 joined 2명 미만이면 방장·운영진에게 「참가자가 2명 이상이어야 결과를 입력할 수 있어요」(`too_few` 상태). 계약 9절에 문구가 없어 지시 문구를 씀. 운영진 판정은 `useMe` role | `lib/scrim-results.ts`, `scrim-result.tsx` |
| 7 | 목 테스트 「full → 팀 저장 → 정원 확대(승격 없음) → 새 참가 → 팀 null」 추가 | `lib/api/mock/scrim-results.test.ts` |
| 8 | 동기화 성공 시 `setQueriesData` 범위를 프로필 키(`['users', id, 'profile']`, predicate `queryKey[2] === 'profile'`)로 좁힘 — 레이팅 그래프 캐시를 건드리지 않음 | `lib/hooks/game-accounts.ts` |

S2에서 넘어온 목 복사본: `orderWaitlist`·`validatePositions`·`computeRestriction`·`canStart`를 core(`orderWaitlist`, `validatePreferredPositions`, `computeScrimRestriction`, `canStartScrim`) import로 바꿨다(목 행 모양에 맞추는 얇은 래퍼만 남김). 오류 문구는 core 문구를 그대로 쓴다. 자동 마감 루프는 지시 범위 밖이라 그대로 두었다(core `decideOverdueScrim`이 있으니 다음에 같은 방식으로 바꿀 수 있다).

검증: `corepack pnpm --filter web typecheck` 통과, `test` 159개 통과(4개 추가), `build` 통과.

### S3 교차 QA 목 몫 2건 반영 (`_workspace/03_qa-verifier_s3.md`)

| # | 수정 | 위치 |
| --- | --- | --- |
| 2 | 결과 모양이 게임과 맞지 않을 때 오류 path를 API(`scrim-results.service.ts` 75–84)와 같게 **잘못 보낸 필드**로: 팀 게임에 placements → `placements`, 개인 순위 게임에 winner_team → `winner_team`(이전에는 반대였음) | `lib/api/mock/scrims.ts` |
| 3 | D136: 프로필 최근 내전의 개인 순위 승패를 레이팅 반영과 같은 기준으로 — core `selectRatedParticipants`로 노쇼·이탈자를 뺀 joined 참가자끼리 다시 매긴 순위에 core `isPlacementWin`(상위 절반, D105). rated=false도 같은 기준. `placement` 표시는 제출 순위 그대로. 프로필 계산에 그 내전의 참가 행 전부를 넘기도록 입력 확장 | `lib/api/mock/ratings.ts`(`profileScrim`), `lib/api/mock/scrims.ts`(`mockProfileScrim`) |

테스트 추가(`lib/api/mock/scrim-results.test.ts`): 모양 불일치 path 2가지, 「8명 중 5위, 1·2위 노쇼 → WIN(반영 6명 중 3위), 표시 순위 5위」(수정 전 코드는 5 × 2 > 8이라 LOSS).

검증: `corepack pnpm --filter web typecheck` 통과, `test` 161개 통과(2개 추가). build는 리더가 실행.

### D136 경계 규칙 반영

- 개인 순위 게임에서 core `selectRatedParticipants`가 `skip`(반영 대상 2명 미만)이면 프로필 최근 내전 outcome = `unassigned`. placement는 제출 순위 그대로, 본인이 노쇼면 `no_show`(기존 분기, 먼저 판정). backend와 같은 규칙(`lib/api/mock/ratings.ts` `profileScrim`).
- 테스트(`lib/api/mock/scrim-results.test.ts`): 3명 중 나만 joined(나머지 노쇼) → `unassigned`·placement 2, 내가 노쇼 → `no_show`·placement 3.

검증: `corepack pnpm --filter web typecheck` 통과, `test` 162개 통과(1개 추가). build는 리더가 실행.
