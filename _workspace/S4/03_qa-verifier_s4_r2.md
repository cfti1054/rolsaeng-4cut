# QA: S4 교차 대조 재검증(r2) — 판정: pass

범위는 `_workspace/03_qa-verifier_s4.md`의 결함 처리분이다. 이전 결함 1·2·3·4·6과 softResetText는 모두 고쳐졌고, 결함 5의 보류 상태는 계약 기록과 맞다. 회귀는 없다.

새 결함은 minor 3건이고 전부 계약 문서 쪽이다(코드 변경 불필요). 테스트 공백 2건은 참고로 남긴다.

**한계:** 실제 `docker build`는 하지 않았다. Docker가 없어 재현으로 대신했다. 이전 재검증 조건 2(PostgreSQL에서 `migrate deploy` + DB e2e 42건)도 여전히 미실행이다.

코드 수정·커밋·패키지 설치는 없다. 저장소에 쓴 파일은 이 보고서뿐이다. `git status` 항목 수는 시작 때 99였고 끝날 때 101이다. 늘어난 2건은 이 보고서와 `apps/web/vitest.tmp.config.mjs`다. 뒤의 파일은 내가 만들지 않았다. 처음 상태 목록에는 없었고 검증 중에 나타났으며, 수정 시각은 07:26:55라 구현 쪽 임시 설정으로 보인다. 지우지 않았으니 커밋 전에 정리가 필요하다. 빌드는 스크래치에서만 해 `apps/web/.next`를 건드리지 않았다.

사용 가능한 도구: Read, Bash, Write, SubagentHandback.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| 현재 Dockerfile 재현 `next build`, `NEXT_PUBLIC_API_MOCK=false`(Dockerfile 기본값) | **exit 0**, 타입 검사 통과, 12개 페이지, `/rankings` 포함 |
| 같은 재현, `NEXT_PUBLIC_API_MOCK=true` | exit 0 |
| 대조군: Dockerfile에서 `COPY packages/core` 줄만 제거 | exit 1, `src/lib/api/mock/rankings.ts:13:8 Cannot find module '@gcd/core'`(이전과 동일) |
| 재현 결과물 `next start`(Dockerfile CMD와 같은 바이너리) | 기동 407ms. `/login` 200, `/rankings`·`/`·`/members/:id` 307(로그인 이동) |
| vitest web(임시 설정, 스크래치 복사본) | 21파일 225 통과 |
| 뮤테이션 13종(스크래치 복사본) | 11종 검출, 2종 생존(「테스트 공백」) |
| 경계 spec(이전 spec 갱신, 실제 Nest 앱 + FakePrisma → shared parse → 웹 순수 함수) | 12건 통과 |
| 목 시나리오 임시 test | 통과. 시나리오를 거쳐도 목 DB 불변, 프로필 응답 복귀 |

리더가 이미 돌린 전체 typecheck·test·`pnpm -r build`는 다시 실행하지 않았다. 재현 `next build`가 web의 타입 검사(테스트 파일 포함)를 다시 거쳤다.

증거 파일(스크래치):
- 재현 스크립트: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4r2/mkctx.py`
- 빌드 로그: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4r2/logs/build-false.log`, 같은 폴더 `build-true.log`, `build-nocore.log`, `start.log`
- 경계 spec·로그: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4r2/b/boundary.spec.ts`, `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4r2/logs/boundary.log`
- 뮤테이션: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4r2/logs/mut.log`

## 새 결함

| # | 심각도 | 위치 | 기대 | 실제 | 재현 | 처리 제안 |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | minor(문서) | `_workspace/01_architect_contract.md:657-662`, `:12` 끝 문구 | 코드와 다른 항목만 「계약 대비 코드 차이」에 남는다 | 표의 2건(`softResetText`, D168 프로필 카드)은 이제 코드가 계약과 같다. 표에는 아직 「내전 기록 없음 + 아직 반영된 내전이 없어요」 등 옛 동작이 현재 코드라고 적혀 있고, 변경 이력은 「코드 미반영 2건」이라고 한다 | `dashboard.ts:28-34,43-47`, `profile-scrim.tsx:34-36`을 표와 대조 | 표를 지우거나 「해소」로 표시, 변경 이력 정정 |
| N2 | minor(문서) | 계약 `:421` 필터 행 | 결함 4의 수정 동작이 계약에 있다 | 「주소의 시즌이 목록에 없으면 옵션 「—」」뿐이다. 코드는 응답 시즌이면 그 이름, 아니면 「—」(`rankings.ts:151-154`) | 경계 spec T2: `/seasons` 캐시 [시즌 1], 응답 시즌 2 → 「시즌 2」 | 10절 필터 행 1문장 추가 |
| N3 | minor(문서) | 계약 10절 `/rankings` 상태 행 | 결함 3의 보조 문구 규칙이 계약에 있다 | 보조 문구 자체가 계약에 없다(`순위가 쌓여` grep 0건). 코드는 `eloEmptyNote(r, now)`로 `ends_at <= now`, `is_final`, now 미확정이면 생략 | 코드 대조 | 10절 상태 행에 규칙 추가 |

## 결함 1(blocker): 고침

| 항목 | 결과 |
| --- | --- |
| Dockerfile | `apps/web/Dockerfile:27` `COPY packages/core ./packages/core` 추가, `:25` 주석 수정. HEAD 대비 변경은 이 두 줄뿐이다 |
| 재현 방식 | 스크립트가 Dockerfile의 COPY 줄을 순서대로 읽어 스크래치에 옮기고 `.dockerignore`를 적용했다. 그래서 `dist`, `.next`, `node_modules`, `tsbuildinfo`는 복사되지 않는다. Dockerfile의 ENV 값 그대로 실행 |
| `dist` 없는 상태 | 이미지에는 `packages/*/dist`가 없다. `@gcd/core`의 `default`는 `dist`지만 빌드·타입 검사·`next start` 모두 통과했다(`source` 조건 + `transpilePackages`) |
| frozen lockfile | `pnpm-lock.yaml:93`에 web의 `@gcd/core` 링크가 있고 lockfile·매니페스트 모두 HEAD와 차이 없음 |

**재현이 실제 빌드와 다른 점:**
- Node 20.11이다. 이미지는 Node 22다.
- `pnpm install --filter "web..."`는 실행하지 않고 저장소 `node_modules` 링크를 재사용했다. api 의존성까지 든 스토어라, 필터 설치에서 빠지는 의존성이 있어도 여기서는 드러나지 않는다.
- `apt`·`corepack`·레이어 동작, Railway 빌드 변수는 확인하지 않았다.

**API Dockerfile 영향: 없음.** `apps/api/Dockerfile`, `.dockerignore`, 루트·패키지 `package.json`, lockfile, `pnpm-workspace.yaml` 모두 HEAD와 차이가 없다. API는 원래 `COPY packages ./packages`다. API 이미지 재현 빌드는 하지 않았다.

## 결함 2·3·4·6, softResetText

| 항목 | 판정 | 계약 | 경계 재현 | 뮤테이션 |
| --- | --- | --- | --- | --- |
| 결함 2 프로필 빈 문구(`dashboard.ts:43`, `profile-scrim.tsx:35`) | **고침** | D168, 10절 일치 | 실제 API T1 `{season:null, ratings:[]}` → 「다음 시즌 준비 중」+「현재 진행 중인 시즌이 없어요」. T2 시즌 2 행 없는 멤버 → 「내전 기록 없음」+「시즌 2」. `scrim` null → 기존 문구 | 분기 제거 → 1건 실패 |
| 결함 3 보조 문구(`rankings.ts:108`, 호출 `rankings-view.tsx:326`) | **고침** | 12절 상태 전이 `now ≥ ends_at`과 일치. 문구 규칙 자체는 계약 없음(N3) | ends_at −1ms 문구 있음, ends_at·+1ms·now null 없음, `is_final` 없음, season null은 시작 안내 | `<`로 변경·now 검사 제거 → 각 1건 실패 |
| 결함 4 시즌 필터(`rankings.ts:151`, `rankings-view.tsx:128,193`) | **고침** | N2 | 실제 순서 재현: 승인 전 `/seasons` [시즌 1] → 승인 → 응답 시즌 2 → 「시즌 2」, 새 목록이면 null. 없는 시즌·다른 시즌 응답은 「—」 | id 비교 제거 → 1건 실패 |
| 결함 6 요약 재조회 테스트(`hooks/rankings.ts:55`, `rankings.test.ts`) | **고침** | 10절 일치 | 가짜 타이머로 5분 경계 전후 호출 수 고정 | 옵션 제거·주기 2배 → 각 1건 실패 |
| softResetText(`dashboard.ts:28`) | **고침** | 10절 일치 | 아래 | ratio 1·0 분기 제거 → 각 1건 실패. 0.5 근사 변형은 생존 |
| D166 뱃지 월 | 변경 없음, 일치 | 일치 | `2026-01-31T15:00:00.000Z` → 2026.01, `.001Z` → 2026.02 | `-1` 제거 → 3건 실패 |
| D167 세션 전환 | 변경 없음, 일치 | 일치 | 단위 테스트 | `removeQueries` → 1건 실패 |

**softResetText 실제 경로:** `SEASON_SOFT_RESET_RATIO` env → `loadConfig` → `/dashboard/summary` → shared parse → 문구.

| env | 응답 ratio | 문구 | `softResetElo(1600)` |
| --- | --- | --- | --- |
| `0.5`, `0.50`, `.5` | 0.5 | 종료 시 레이팅 절반 소프트 리셋 | 1300 |
| `0.3` | 0.3 | 종료 시 1000 기준 차이의 30%만 유지 | 1180(계약 예시와 같음) |
| `1` | 1 | 종료 시 레이팅 유지 | 1600 |
| `0` | 0 | 종료 시 레이팅 1000으로 초기화 | 1000 |

결함으로 보지 않은 표시 경계(운영값이 소수 셋째 자리일 때만 생기고, 계약 「N = ratio × 100 반올림」 범위다):
- 0.995–0.999는 「100%만 유지」, 0.001·0.004는 「0%만 유지」다. 앞쪽은 테스트가 고정해 두었다.
- 0.4999·0.5001은 「50%만 유지」이고 값은 0.5와 같게 1300이다.
- 부동소수 때문에 0.145는 14, 0.285는 28, 0.575는 57로 내려간다.

## 계약 정정 C1–C15, Q8

| 항목 | 반영 | 확인 위치 |
| --- | --- | --- |
| C1 | 예 | 3절 이력, `prisma validate` 값 필요 |
| C2·C3 | 예 | 11절 `RankingRefresher`·`SeasonCloser` export, `sharedScheduleModule`, `common/shared-schedule.ts`·`jobs` 행. 코드 일치 |
| C4 | 예 | 11절, D164. `scrims.module.ts:46` export `ScrimViews` 일치 |
| C5 | 예 | 10절, D166. 저장 규칙은 유지 |
| C6 | 예 | 10절 사이드바 |
| C7 | 예 | 10절 사이드바 아래 문단 |
| C8 | 예 | 10절. 다만 이후 수정분은 N2·N3 |
| C9 | 예 | 10절 훅·목. 시드 버전 5 일치 |
| C10 | 예 | 4-4. `rankings-reader.service.ts:103,185,192` 일치 |
| C11 | 예 | 7-2. `ranking-calculator.service.ts:130` 일치 |
| C12 | 예 | 9절 `tierScore` RangeError, `computeSeasonBadges`, 추가 export. `config.ts:57`, `index.ts:100-101` 일치 |
| C13 | 예 | 10절, D167. `auth.ts:19` 일치 |
| C14 | 예 | 2절, 8-2. `shared/dashboard.ts:81` 주석은 안 고쳤지만 8-2가 Q8 결정 때 고친다고 명시했다 |
| C15 | 예 | 변경 이력, 10절 D168, 18절 배포 영향. 이력의 「코드 미반영」은 N1 |
| Q8 | **추가됨** | 17절 `:629` |

정정 목록 15건 중 누락은 없다. N1–N3은 정정 뒤 코드가 바뀌며 생긴 차이다.

## 결함 5(보류, Q8): 현재 동작이 기록과 일치

| 기록 | 재현 결과 | 판단 |
| --- | --- | --- |
| 2절: 빈 캐시 첫 계산 실패 시 `/rankings/*` 500 | 쓰기 실패 주입, `/rankings/elo` 500 | 일치. 티어는 코드 경로만 확인 |
| 2절: 요약 전체 500 | 같은 조건 `/dashboard/summary` 500 | 일치 |
| 2절: 값이 있는 캐시의 실패는 200 + stale | 갱신 failed 5, `stale: true`, 값 유지 | 일치 |
| 8-2: `games`가 비면 시즌이 있어도 null | `{season:'시즌 1', top:null}` | 일치 |
| 8-2: 화면 「아직 시즌이 없어요」 | `home-view.tsx:345` | 일치(코드 확인) |
| Q8: 사이드바 시즌 카드 사라짐 | `season-card.tsx:15` `!q.data`면 null | 일치(코드 확인) |

수정 대상이 아니므로 판정에 넣지 않았다.

## 회귀 확인

| 대상 | 결과 |
| --- | --- |
| `scrimRatingSummary` 호출부 | `profile-view.tsx:126`(배너 칩), `:337`(카드). 반환 모양 그대로, `rank` 유지 |
| `eloEmptyNote` 호출부 | `rankings-view.tsx:326` 하나. 홈은 쓰지 않는다. `useNow`는 조건 분기 앞이라 훅 순서 안전 |
| `seasonFallbackLabel` | `rankings-view.tsx:128` 하나. 첫 로딩의 빈 값은 「—」 |
| `dashboardSummaryOptions` | 훅 `:70` 하나. 사이드바·모바일·홈은 같은 훅 |
| 목 `mockProfileScrim` 시나리오 | 아래 |
| 이전 경계 시나리오(T0–T4, stale, 시즌 없음) | 전부 같은 값으로 통과 |

| 시나리오 | 프로필 `season` | ratings | recent | 빈 문구 | /seasons |
| --- | --- | --- | --- | --- | --- |
| 없음·stale·me_outside·error | 시즌 2 | 2 | 5 | - | 시즌 2, 시즌 1 |
| final | null | 0 | 5 | 다음 시즌 준비 중 | 시즌 1 |
| no_season | null | 0 | 5 | 다음 시즌 준비 중 | 없음 |
| empty | 시즌 2 | 0 | 0 | 내전 기록 없음 / 시즌 2 | 시즌 2, 시즌 1 |

`final`이 실제 시즌 공백과 같은 모양이다(`season` null, 최근 내전은 그대로). `scenarioState`는 얕은 복사만 하므로 저장 상태를 바꾸지 않는다. 시나리오를 끈 뒤 응답과 목 DB가 처음과 같음을 확인했다.

`loading`은 응답을 일부러 보내지 않아 제외했고, `me_error`는 세션 부팅 경로라 이 표에서 제외했다.

## 테스트 공백(참고, 수정 필수 아님)

| 변형 | 결과 | 의미 |
| --- | --- | --- |
| `ratio === 0.5` → `Math.round(ratio*100) === 50` | 225건 통과 | 테스트 제목은 「정확히 0·0.5·1일 때만」인데 0.49·0.51까지만 본다. 0.4999·0.5001 단언 2줄이면 막는다. 코드는 맞다(직접 재현) |
| 목 프로필의 `scenarioState` 제거 | 225건 통과 | 결함 2의 브라우저 확인을 위한 목 변경을 고정하는 단위 테스트가 없다. 목 전용이다. 위 표로 직접 확인했다 |

`rankings-view`의 필터·보조 문구 연결과 `useDashboardSummary`의 `enabled` 조건도 단위 테스트가 없다. 구현자 브라우저 기록과 코드 확인뿐이다.

## 관찰(결함 아님)

`/seasons` 캐시가 시즌 1 진행 중에 받은 것이고(`is_current: true`) 그 뒤 다른 운영진의 승인으로 시즌 2가 생긴 경우, 화면에는 「시즌 1 (진행 중)」 옵션이 남는다. 이를 고르면 `rankings-view.tsx:189`가 `season: null`로 보내 다시 시즌 2가 보인다.

캐시 유지 시간(10분) 안의 좁은 구간이고 값은 틀리지 않는다. 코드 확인만 했고 실행하지는 않았다.

## 미실행

| 항목 | 이유 |
| --- | --- |
| 실제 `docker build`, Railway 로그, API 이미지 빌드 | Docker 없음. 결함 1은 재현으로 확인 |
| `pnpm install --frozen-lockfile --filter "web..."` | 설치 금지 지시. lockfile 일치는 내용으로 확인 |
| Node 22 실행, 저장소 `vitest.config.ts`, 전체 `pnpm -r` | 이 PC는 Node 20.11. web만 임시 설정으로 재실행. 나머지는 리더 실행 결과에 의존 |
| DB e2e 42건, `migrate deploy`, 실제 SQL·잠금 | PostgreSQL 없음. 이전 재검증 조건 2가 그대로 남았다 |
| 브라우저 확인 | 이번 QA는 안 했다. 표시는 구현자 기록이고, 여기서는 순수 함수와 코드 연결까지만 확인 |
| 웹 런타임의 실제 API 연결 | `next start`는 로그인 페이지와 미들웨어 이동까지만 확인 |
| 사용자 판단 Q1–Q8 | 답변 대기 |

## 이전 결함 재확인

| # | 결과 |
| --- | --- |
| 1 blocker | 고침(재현 기준) |
| 2 | 고침 |
| 3 | 고침 |
| 4 | 고침 |
| 5 | 보류, 계약 기록과 일치 |
| 6 | 고침 |
| 소프트 리셋 문구(C6) | 고침 |
