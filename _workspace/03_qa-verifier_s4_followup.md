# QA: S4 후속 변경(패배 배율, 레드팀 호칭, ⓘ 안내) — 판정: fail

major 2건, minor 5건. 둘 다 ⓘ 화면 결함이다. blocker는 없다. 패배 배율 계산·저장·시즌 전환·호칭·레드 색은 모두 통과했다.

계약: `_workspace/01_architect_contract.md` 19절. 판정 기준은 스킬 그대로 major 1건 이상이면 fail이다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·web·api Done |
| `prisma validate` (`DATABASE_URL` 더미 지정) | valid. 지정 없이는 env 부재로 exit 1 |
| core 테스트(스크래치패드 `vitest.core.mjs`) | 366 passed |
| shared 테스트 | 92 passed |
| web 테스트 | 23파일 238 passed |
| api 테스트(스크래치패드 `fu/vitest.api.mjs`) | 488 passed / 42 skipped(DB e2e) |
| `next build` mock 모드 → 브라우저 검증 → 일반 모드 | 둘 다 exit 0. `.next`는 일반 빌드로 되돌림 |
| `pnpm --filter api build` | exit 0 |
| 임시 spec `fu/spec/fu.spec.ts` | 9 passed |
| 브라우저 스크립트 `pw/fu-a`~`fu-g.mjs` | 아래 항목별 기록 |

- 스크래치패드: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad`
- 소스 변경 없음. 검증 전후 `git status --short` 127줄로 같다.
- Node 20.11이라 저장소 `vitest.config.ts` 대신 같은 내용의 임시 설정을 썼다.

## 결함

| # | 심각도 | 위치 | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | major | `apps/web/src/components/ui/info-tip.tsx:120`, `profile-view.tsx:276-277` | 터치 영역 44×44px(19-3) | 프로필 카드에서 실제 탭 높이 32.5px. 아래 11.5px를 값 줄 `span.truncate`가 가린다. 랭킹 ⓘ는 44px로 정상 | `/members/{id}`, 버튼 세로 중심선에서 0.5px 간격 `elementFromPoint`. 390·1440 동일 |
| 2 | major | `info-tip.tsx:133`(패널 `overflow-y-auto`), `:59`(키 처리 없음) | 호버·키보드·터치 모두 동작(슬라이스 기본값 4). 패널 안에 포커스 가능한 요소 없음, 넘치면 패널 안 스크롤(19-3) | 패널이 넘치면 키보드 사용자는 잘린 내용을 읽을 수 없다. ↓는 페이지가 스크롤되어 패널이 닫힌다. Tab은 Chrome이 스크롤 패널로 포커스를 옮겨 패널이 닫히고 포커스가 BODY로 빠진다 | 프로필 1440×900(scrollHeight 581 / clientHeight 488), 랭킹 1366×650(581 / 496). Tab으로 ⓘ 도달 → ↓ 또는 Tab. 패널이 넘치지 않는 랭킹 1440×900에서는 Tab이 다음 버튼 「티어」로 정상 이동 |
| 3 | minor | `apps/web/src/lib/elo-info.ts:62`, 계약 19-3 문구 표 | 문구가 규칙과 일치 | ratio 0에서 「져도 점수가 내려가지 않아요. … 약한 상대에게 질수록 많이 내려가요.」로 앞뒤가 모순. ratio 1에서는 제목 「승패 점수는 왜 다른가요」와 본문 「같은 크기로 계산해요」가 어긋난다. 계약 표대로 구현한 결과라 계약 문구도 함께 고쳐야 한다 | `eloInfoSections({loss_ratio: 0})` 출력 |
| 4 | minor | `elo-info.ts:15,28`, `apps/web/src/lib/scrim-results.ts:60` | 비정상 표시 없음 | 극단값에서 ratio 0.001은 「0%만 잃어요」, 0.02는 「질 때 −0점」, 0.999는 「100%만 잃어요」. skillFormulaText도 같다. 기본값 0.5에서는 나오지 않는다 | `fu/spec/text.test.ts` |
| 5 | minor | `apps/web/src/lib/api/mock/rankings.ts:173` | 승패는 outcome 기준(D105, D170) | 목의 주간 기준 순위가 `h.delta > 0`으로 승패를 센다. 개인 순위 2위 win·음수, 패배 0점 행이 어긋난다. 목 전용이고 동점 정렬에만 영향 | 코드 대조 |
| 6 | minor(기존 결함, S3) | `apps/web/src/components/scrims/scrim-result.tsx:376,411` | 390px 가로 넘침 없음 | 레이팅 변동 표의 `sr-only`(absolute)가 `relative` 없는 스크롤러 밖으로 새어 승인된 내전 상세의 문서 폭이 459px가 된다. 터치 뷰포트에서는 `innerWidth`도 459가 되어 하단 탭까지 넓어진다. 표 안 변동 열은 가로 스와이프로 닿는다 | 결함 없는 페이지 523은 390, 496·080은 scrollWidth 459. 스크롤러에 `position:relative` 주입 시 390. HEAD(e905f88)에 같은 코드가 있어 이번 회귀가 아니다 |
| 7 | minor(문서) | `_workspace/ELO_설명서.md` 1·4·8절, 계약 10절(436행), `packages/shared/src/dashboard.ts:102` 주석 | 현재 규칙과 호칭 | 설명서에 「±10~25」, 예시 −16·−24, 오렌지가 남았고 `SCRIM_ELO_LOSS_RATIO`가 8절 표에 없다. 계약 10절은 `ORANGE`, 「반영 ±{elo_swing}」 그대로이고 19절에 알약 문구 변경이 없다. 설명서 4절은 계약 19-6이 후속 수정 대상으로 적어 둔 항목이다 | grep |

### 처리 제안

| # | 제안 | 담당 |
| --- | --- | --- |
| 1 | 버튼에 `relative`를 추가한다. 브라우저에서 style 주입으로 44px 복귀를 확인했다 | frontend |
| 2 | 패널에 `tabIndex={-1}`로 Chrome의 스크롤러 포커스를 막고, 버튼 포커스 중 ↑↓를 패널 스크롤로 연결한다(`preventDefault`). 이 방식은 제안이며 미검증이다. 포커스 규칙이 걸린 일이라 architect가 19-3 문구를 먼저 정하는 편이 낫다 | architect → frontend |
| 3 | ratio 0이면 「약한 상대에게…」 문장을 뺀다. 제목은 ratio별로 나누거나 「승패 점수는 어떻게 정해지나요」로 바꾼다. 문구는 사용자 확인 대상이다 | architect → frontend |
| 4 | env 범위는 0–1이라 운영값이 아니면 안 나온다. 고치지 않아도 된다는 판단도 가능하다 | 리더 판단 |
| 5 | 변동 부호 대신 실제 승패(`winner_team`, 상위 절반) 기준으로 센다 | frontend, 여유 있을 때 |
| 6 | `scrim-result.tsx:376` 스크롤러에 `relative` 추가. 범위 밖 기존 결함이라 이번에 묶을지는 리더 판단 | frontend |
| 7 | 호칭·배율 반영 | 리더 또는 architect |

## 항목별 결과

### 1. 패배 배율 — 통과

- 19-1 표 전체를 dist core로 직접 계산해 일치했다. 개인 1000·1400·1000·1000은 ratio 0.5에서 +20, −4, 0, −6이고 2위는 `win`인데 배율을 받는다.
- ratio 0: 팀 16/0, 개인 16, 5, 0, 0이고 `losses`는 증가한다. ratio 1: 기존 값.
- 반올림 전 곱하기: 난수 18,920쌍에서 전후 순서가 결과를 바꾸는 4,447쌍 전부 반올림 전 값과 일치. 예: 800 vs 822, raw −14.988 → −7(뒤에 곱하면 −8).
- `previewTeamElo` ↔ `computeTeamEloUpdates`: 20만 회, ratio 8종, K 4종 불일치 0. ratio 1 ↔ 기존 식 20만 회 불일치 0.
- 미리보기 ↔ 승인 저장값(API): 5:5 난수 elo, ratio 0·0.25·0.5·0.75·1, 각 12판 일치(임시 spec).
- 미리보기 ↔ 승인(목 브라우저): 승인 대기 내전에서 예측 RED +18, BLUE −9 = 승인 뒤 표 +18, −9.
- 쓰기 경로: `rating.update`는 `scrim-results.service.ts:263` 하나, `ratingHistory.create`는 `:271` 하나다. 계산은 core `applyLossRatio` 한 곳이고 호출 경로는 팀·개인·미리보기 3개다. 서비스 쪽 재곱셈과 누락 없음. 승인 이중 호출은 409, 이력은 그대로.
- env: `.env.example`(0.5) ↔ `config/env.ts`(`SCRIM_ELO_LOSS_RATIO_DEFAULT`) ↔ `config.rating.lossRatio`. 키 없음·빈 값·공백은 0.5.
- `-0.0001`, `1.0001`, `NaN`, `Infinity`, `half`, `50%`, `0,5`는 기동 실패.
- 런타임 기본값: BASE_ENV의 키를 제거해 앱을 띄우면 summary `loss_ratio: 0.5`, 승인 +16/−8. BASE_ENV의 1은 `test/support/test-app.ts`에만 있다.
- 과거 행: 재계산 코드와 마이그레이션 없음. `schema.prisma`에 배율 없음. 재배포 후 이력 불변 테스트 통과.
- ratio 1 불변: 기존 테스트 diff의 삭제 줄은 정책 모양 변경이고 기대 변동값은 그대로다.

참고(이번 결함 아님): 미리보기는 단일 `k_base`라 K 신규 구간 멤버의 실제 변동과 다르다. 기존 동작(D104)이고 배율과 무관하다.

### 2. 시즌 전환 — 통과

임시 spec으로 같은 지난 시즌 행을 ratio 1·0.5·0에서 각각 처리했다.

| 항목 | 결과 |
| --- | --- |
| 종료 standings | 세 ratio 모두 `[[1,1401,8,2],[2,777,2,8]]` |
| 지난 시즌 행 | 1401, 777 그대로 |
| 새 시즌 시작값 | 세 ratio 모두 1201, 888(`softResetElo`), carried 기록 |
| 첫 경기 패배(1201 시작) | 1174 / 1187 / 1201. 다른 값은 이 변동뿐이다 |

`modules/rankings`와 `rating-carry.ts`에 `lossRatio` 참조 없음.

### 3. rating_policy — 통과

| 생산 | shared | 소비 |
| --- | --- | --- |
| `scrim-teams.service.ts:119-125` | `RatingPolicyView`(`scrim-results.ts:37`) | `lib/api/scrims.ts:122` → `skillFormulaText` |
| `dashboard.service.ts:78-85` | `DashboardRatingPolicy`(`dashboard.ts:47-54`) | `lib/api/rankings.ts:28` → 시즌 카드, `EloInfo` |

- 웹은 두 곳 모두 shared 스키마로 parse한다. snake_case 유지.
- 요약은 응답 전체를 캐시하지 않고 값은 env에서 나와 사용자별 차이가 없다. 두 사용자 응답 동일 확인.
- 랭킹 캐시 payload와 `/rankings/elo` 응답에 `loss_ratio` 없음.
- 배포 순서 주의: `loss_ratio`가 필수라 새 웹 + 옛 API면 요약 parse가 실패해 홈·사이드바가 오류가 된다. API를 먼저 배포해야 한다.

### 4. 호칭 — 통과

- 목 프로덕션 빌드 36페이지(승인·진행·종료 내전 포함)를 크롤했다. script를 뺀 HTML과 aria-label·title·alt·placeholder에 `오렌지|ORANGE|Orange` 0건, 소문자 `orange` 노출 0건.
- 소스 grep: 남은 것은 `packages/shared/src/scrims.ts:199,200,433` 주석, core 테스트명, `rOrange` 식별자로 화면 노출 없음.
- API 오류 메시지에 호칭 없음. API·shared에 `'red'` 없음. DB enum `orange` 유지.
- `team-red` 사용처는 `scrim-teams`, `scrim-result`, `scrim-card`, `home-view`의 팀 표시뿐이다. 패배 값, 정원 마감, 스팀, Challenger, 경고 orange는 그대로다.
- 토큰 수 다크·라이트 63 일치.

### 5. 레드 팀 색 — 통과

직접 계산(WCAG 대비):

| 조합 | 다크 | 라이트 | 계약 |
| --- | --- | --- | --- |
| `on-accent` / `team-red` | 6.13 | 5.00 | 6.1 / 5.0 |
| `team-red-ink` / `surface` | 10.31 | 6.59 | 10.3 / 6.6 |
| ink / surface-2 | 9.59 | 6.24 | — |
| ink / red 12% (surface 위) | 8.77 | 5.73 | — |
| ink / red 12% (surface-2 위) | 8.09 | 5.45 | — |
| 패배 값 orange-ink-2 / red 6% | 9.18 | 5.41 | — |
| 막대 red / surface-2 | 6.03 | 3.18 | — |

- 브라우저: 다크·라이트 × 데스크톱·모바일의 내전 상세에서 팀 카드, 승률 막대, 결과 입력(RED 선택 `aria-pressed`, 테두리 `team-red`), 변동 표의 계산 색이 토큰과 일치했다. 구현자 미확인 범위인 다크도 스크린샷으로 확인했다.
- 패배·경고색과 구분: `team-red` 색상각 353° vs `orange` 15°, ΔE76 27(다크)·28(라이트). 카드 안의 패배 값과 노쇼 버튼이 레드 카드와 구분되어 보인다. 다만 ink끼리는 ΔE 19(다크)로 가장 가깝다. 눈으로는 구분되나 수치상 여유가 작다.
- 막대의 red ↔ blue 휘도 대비는 1.44·1.34로 낮지만 색상 차가 크고 양쪽에 숫자가 있어 색만으로 전달하지 않는다.

### 6. ⓘ — 결함 1·2·3 외 통과

여백 클래스 변경 뒤 새 빌드로 다시 확인했다.

- 호버: 열림, 패널로 이동해도 유지, 벗어나고 60ms 뒤 유지, 310ms 뒤 닫힘.
- 클릭 고정·해제, 고정 + Esc, 호버 + Esc 정상.
- 키보드: Tab 포커스로 열림, Esc로 닫히고 포커스 유지, 그대로 닫혀 있음, 나갔다 돌아오면 열림, Enter·Space 토글, Tab으로 나가면 닫힘. 다크·라이트.
- 터치: 390×844, 320×568, 844×390 × 다크·라이트. 탭 후 60ms·500ms 열림 유지(바로 닫히지 않음), 버튼 재탭으로 닫힘, 밖 탭으로 닫힘, 패널 안 스와이프 때 유지.
- 넘침: 좌우 16px 이상, 하단 탭 위, 프로필은 공간 부족 시 위로 배치. 가로 넘침 없음. 조상 `transform`·`filter`·`backdrop-filter` 없음.
- aria: `aria-expanded`, `aria-controls` = 패널 id, 버튼 바로 뒤 DOM, `role=region`, 패널 내 포커스 가능 요소 0, `role=tooltip` 0.
- 값 없음: 요약 error·loading에서 1000 외 숫자 없음, 「일정 경기 수」 표시. 데스크톱·모바일.
- 하드코딩: 웹 비목 코드에 `*_DEFAULT` import와 32·40·0.5·600·2000 리터럴 없음. `RATING_SEED_DEFAULT`는 19-3이 허용한 core 상수다. `RESET_EXAMPLE_ELO = 1400`도 계약 문구다.
- ELO_설명서 3절 대조: 첫 반영 시점, 소프트 리셋(1400 → 1200), 티어 시드 600–2000, 티어 없음 1000 일치. 패배 배율 문장은 core 계산 +16/−8과 일치.
- 19-3의 인플레이션 수치(한 판 +40, 30경기 +120, 고정점 1000 + D)는 산술로 맞다.

### 7. 「최대 {elo_swing}점 변동」 — 통과

`elo_swing`은 그 내전 `|elo_after − elo_before|` 최댓값이다(`dashboard.service.ts:228`, 목 `rankings.ts:325` 동일).

| ratio | 값의 의미 | 문구 |
| --- | --- | --- |
| 1 | 승패 같은 크기의 최댓값 | 참 |
| 0.5 | 같은 K면 승리 쪽 값. 패배 쪽은 그 절반 | 참. ±가 아니라서 오히려 정확 |
| 0 | 승리 쪽 값 | 참 |

K가 섞이면 패배 쪽이 더 클 수 있으나 「최대」라 여전히 맞다. 점수 차가 매우 크고 모두 반올림 0이면 「최대 0점 변동」으로 나오지만 사실과 맞다. 390px에서 알약 잘림 없음. 개인 순위는 null → 「반영 완료」.

### 8. 회귀 — 통과(결함 6은 기존 결함)

전체 테스트 통과, 빌드 통과. 36페이지 크롤에서 콘솔 오류와 4xx 없음. 첫 컨텍스트에서 1회 나오는 404는 `/favicon.ico`다.

## 미실행

- 실제 PostgreSQL·Redis 승인·시즌 전환, DB e2e 42건: 이 PC에 없음.
- 실제 API와 웹을 연결한 브라우저 검증: 화면은 목 모드만 확인했다.
- ratio 0·1 문구의 브라우저 표시: 목이 0.5 고정이라 함수 출력만 확인했다.
- Node 22로 저장소 vitest 설정 실행, Docker 이미지 빌드. `apps/web/Dockerfile`의 `COPY packages/core`는 코드 대조만 했다.
- Safari·Firefox, 실제 터치 기기, 스크린 리더. 결함 2의 Tab 이동은 Chrome 동작이고, ↓ 문제는 브라우저와 무관할 것으로 보나 다른 브라우저에서 재지는 않았다.
- 결함 2의 처리 제안 자체는 검증하지 않았다.
