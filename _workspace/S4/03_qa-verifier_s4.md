# QA: S4 전체 교차 대조 — 판정: fail

blocker 1, major 0, minor 5(1건은 이전 QA에서 이월). 명세 갱신 필요 22건, 계약 정정 필요 15건.

S4 기능 코드의 계약 일치는 확인했다. 레이팅 흐름, 응답 경계, 이전 수정 재검증에서는 결함이 없었다. fail 사유는 **웹 Docker 이미지가 빌드되지 않는 것**이다. 이 결함은 S4가 만든 것이 아니라 S3(e905f88)부터 있었고, 수정은 Dockerfile 1줄이다.

코드 수정·커밋은 없다. 패키지 설치도 시도하지 않았다. 임시 파일은 스크래치패드에만 두었고 `git status` 항목 수는 시작과 같은 96이다. `apps/web/.next`는 건드리지 않았다.

사용 가능한 도구: Read, Bash, Write, SubagentHandback.

**중요 한계:** 실제 PostgreSQL을 쓰지 못했다. 아래 「통과」에서 DB 동작은 실행 확인이 아니다(「미실행」 참고). API 응답은 FakePrisma 위의 실제 Nest 앱에서 받았다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `tsc -p tsconfig.json --noEmit`(shared, core, web, api) | 4개 모두 exit 0 |
| vitest core(임시 설정) | 9파일 347 통과 |
| vitest shared(임시 설정) | 5파일 91 통과 |
| vitest web(임시 설정) | 20파일 220 통과 |
| vitest api(임시 설정) | 28파일 통과·7파일 skip, 470 통과 / 42 skip |
| `prisma validate` | DATABASE_URL 없으면 P1012(환경 변수). 가짜 값을 주면 통과 |
| `prisma migrate diff`(HEAD schema → 현재) vs `migration.sql` | 주석 제외 일치. 차이는 머리 주석 6줄뿐 |
| `grep warn\|For more` 마이그레이션 전체 | 없음 |
| SQL `DROP` 문장 | 없음 |
| `tsc` build → dist 비교(core, shared) | `.js`·`.d.ts` 차이 없음 |
| **웹 Dockerfile 문맥 재현 `next build`** | **exit 1**, `src/lib/api/mock/rankings.ts:13 Cannot find module '@gcd/core'`(결함 1) |
| 대조군: 같은 문맥 + `packages/core` 소스 | exit 0, `/rankings` 포함 |
| 임시 spec: 시즌 수명주기 + 웹 순수 함수 | 4건 통과(「경계 대조」) |
| 뮤테이션 13종(스크래치 복사본) | 11종 검출, 2종 생존(「이전 수정 재검증」) |

Node 20.11이라 저장소 `vitest.config.ts`는 읽지 못한다. 같은 내용의 임시 설정 결과다.

임시 spec: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4x/b/boundary.spec.ts`
빌드 로그: `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/e233e4b2-3bf7-462c-b6b6-38b3cca3cb01/scratchpad/s4x/logs/dock-build.log`

## 결함

| # | 심각도 | 위치 | 기대 | 실제 | 재현 | 처리 제안 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **blocker** | `apps/web/Dockerfile:26`(주석 `:25`) | 슬라이스 환경 제약대로 Railway(Dockerfile)에서 웹 이미지가 빌드된다 | `COPY packages/shared`만 있고 `packages/core` 소스를 복사하지 않는다. `lib/api/index.ts:2`가 목 백엔드를 정적으로 import하고 목은 `@gcd/core`를 import한다. `@gcd/core`의 `types`·`source`는 `src/index.ts`라 타입 검사에서 실패한다. `NEXT_PUBLIC_API_MOCK=false`도 같다. 로컬 빌드는 소스가 다 있어 드러나지 않았다 | 스크래치패드에 Dockerfile의 복사 범위만 재현(`packages/core`는 package.json만) → `next build` exit 1. `packages/core` 소스만 추가 → exit 0 | `COPY packages/core ./packages/core` 추가, `:25` 주석 수정. 수정 뒤 실제 `docker build` 또는 같은 재현 필요 |
| 2 | minor | `apps/web/src/components/profile/profile-scrim.tsx:33`, `apps/api/src/modules/profile/profile-scrim.service.ts:31,144` | 시즌이 끝나고 다음 시즌이 없는 동안(D143, 정상 상태) 기록이 있는 멤버를 기록 없음으로 말하지 않는다 | API는 `scrim.season: null`, `ratings: []`를 준다(규칙대로). 화면은 「내전 기록 없음」 + 「아직 반영된 내전이 없어요」를 표시한다. 같은 화면의 최근 내전과 그래프(`latestStartedSeason` 기준)에는 기록이 나온다. 다음 승인까지 며칠이고 이어질 수 있다 | 임시 spec T1: 응답 `{season:null, ratings:[]}`. 문구는 코드 확인 | architect 판단. `season === null`일 때 「시즌 종료 · 다음 시즌 준비 중」으로 바꾸는 것이 가장 작다 |
| 3 | minor | `apps/web/src/lib/rankings.ts:105-108` | 끝난 시즌에 앞으로 쌓인다는 안내가 없다 | 끝났지만 미처리 시즌(`is_final: false`)이 빈 목록이면 「운영진이 내전 결과를 승인하면 순위가 쌓여요.」가 나온다. 승인은 다음 시즌으로 간다. 정상 운영에서는 유예 + 5분 주기 안의 짧은 구간이고, `RANKING_JOBS_ENABLED=false`면 계속된다 | 임시 spec T1의 `eloEmptyNote` 값. 빈 목록 화면은 코드 확인 | `season.ends_at <= now`면 보조 문구 생략. 우선순위 낮음 |
| 4 | minor | `apps/web/src/lib/hooks/ratings.ts:25`, `apps/web/src/components/rankings/rankings-view.tsx:190` | 필터가 현재 표시 시즌 이름을 보여 준다 | 다른 운영진의 승인으로 새 시즌이 생기면 `/seasons` 캐시(10분, 포커스 재조회 없음)에 그 시즌이 없어 필터가 「—」로 보인다. 본인 승인은 `hooks/scrims.ts:286`이 무효화해서 괜찮다. 표는 맞다 | 코드 확인(실행 안 함) | `elo.data.season`이 목록에 없으면 응답의 시즌 이름을 옵션으로 쓴다 |
| 5 | minor(이월) | `apps/api/src/modules/dashboard/dashboard.service.ts:85,129-145` | `top_rankers: null`은 「시즌 없음」 | (a) backend QA 결함 4 미수정: 첫 계산 실패 시 요약 전체 500. (b) 추가 확인: 시즌이 있어도 `games`가 비면 null이고 화면은 「아직 시즌이 없어요」. 배포 CMD가 시드를 돌리므로 시드 없는 DB에서만 생긴다 | (b) 임시 spec `no games`: `{season:'시즌 1', top:null}`. (a) backend QA 재현 그대로 | architect가 (a)와 함께 판단(계약 정정 C14). 이번 슬라이스 차단 사유는 아니다 |
| 6 | minor(테스트) | `apps/web/src/lib/hooks/rankings.ts:63` | web 결함 1의 수정이 테스트로 고정된다 | `useDashboardSummary`의 `refetchInterval`을 지운 변형이 220건 모두 통과. 코드와 구현자의 브라우저 확인은 맞다 | 뮤테이션 W1 | 훅 옵션 추출 또는 단위 테스트 1건. 필수는 아니다 |

### 결함 1의 범위

- S4가 만든 결함이 아니다. web이 `@gcd/core`를 처음 import한 것은 e905f88(S3)이고, 355ba0f의 목에는 「web은 @gcd/core에 의존하지 않는다」 주석이 있었다. Dockerfile은 7016593 이후 바뀌지 않았다. HEAD의 `mock/scrims.ts:12`, `mock/ratings.ts:21`도 같은 import다.
- S3 HEAD를 직접 빌드하지는 않았다. import 근거로 같은 실패를 추론했다.
- 실제 Docker와 Railway 로그는 보지 못했다. 재현은 Dockerfile의 복사 범위를 스크래치패드에 옮겨 Node 20.11로 실행한 것이다. 실패 원인이 파일 부재라 Node 버전과 무관하다고 판단한다.
- `apps/api/Dockerfile`은 `COPY packages ./packages`라 영향이 없다.

## 교차 대조 표

| 계약 4절 | ApiPath | 컨트롤러 | 웹 호출 | 훅 → 화면 | 파싱 |
| --- | --- | --- | --- | --- | --- |
| GET /rankings/tier | rankingsTier | `RankingsController.tier` | `getTierRanking` | `useTierRanking` → TierPanel | GetTierRankingResponse |
| GET /rankings/elo | rankingsElo | `RankingsController.elo` | `getEloRanking` | `useEloRanking` → EloPanel | GetEloRankingResponse |
| GET /dashboard/summary | dashboardSummary | `DashboardController.summary` | `getDashboardSummary` | `useDashboardSummary` → 홈·사이드바·모바일 머리 | GetDashboardSummaryResponse |
| GET /users/:id/profile | 기존 | 기존 | 기존 | `useUserProfile` → 뱃지·칩·카드 | GetUserProfileResponse |
| GET /games, /seasons(필터) | 기존 | 기존 | 기존 | `useGames`, `useSeasons` | 기존 |

일대일이다. 웹에서 안 쓰는 S4 엔드포인트는 없다. `activity`·`playtime`·패치·이벤트 경로는 `ApiPath`에 없다. 세 응답 모두 shared parse를 거치고 snake_case가 웹까지 유지된다.

| 항목 | 결과 |
| --- | --- |
| 오류 코드 | `ErrorCode` 43개 실행 확인, 추가 없음. 400·401·404는 `rankings.e2e.spec.ts:56` |
| 웹의 NOT_FOUND | `rankings-view.tsx:328` 전용 상태. `season=abc`는 `parseRankingsQuery`가 버려 400이 나가지 않는다 |
| env 3개 | `.env.example:98,100,103` ↔ `env.ts` ↔ `AppConfig` ↔ 응답 `rating_policy`·`min_games` 일치 |
| 라우트 | `/`, `/rankings`, `/members/[id]`, `/scrims`, `/scrims/[id]`, `/scrims/new`, `/settings`가 `app/`에 있다. middleware 보호 범위 안 |
| 화면의 env 값 | `*_DEFAULT` import 없음(`lib/scrim-results.ts`는 주석). 공식 리터럴 없음 |
| 외부 연동 | 새 호출 없음, `RGAPI-` 없음 |
| 스키마 | `discord_id`, `idempotency_key`(unique), `key_hash` 있음 |

## 경계 대조: 실제 API 응답 → 웹

임시 spec이 Nest 앱의 응답을 shared 스키마로 parse한 뒤 웹 순수 함수에 넣었다.

| 상태 | API 실제 값 | 웹 표시 | 판단 |
| --- | --- | --- | --- |
| rank 공백 | 종료 시즌 `[2,3]`, total 2 | 시상대 `[[2,2],[3,3]]`, 1위 자리 비움 | 일치 |
| stale | `stale: true`, `synced_at` 유지, 요약과 랭킹이 같은 값 | 「갱신 지연 · 마지막 12:00」 | 일치 |
| is_final | synced = closed_at, `rank_change` 전부 null | 「시즌 최종 순위」 | 일치 |
| season null | season·synced null, stale false | 칩 없음, 「아직 시즌이 없어요」, 규칙 없음 | 일치 |
| me null | 현재 시즌 없음·행 없음 | `userEloText` null → 기존 사용자 카드 | 일치 |
| top_rankers null | 시즌 없음 | 「아직 시즌이 없어요」, `/rankings` 링크 | 일치. 예외는 결함 5(b) |
| 끝났지만 종료 전 | `season` null, `me` null, top은 S·`is_final` false, 캐시 출처 | 「다음 시즌 준비 중」, 제목 「시즌 ELO TOP 5」(시즌 이름 없음) | 계약대로. 문구는 결함 3 |
| 종료 시즌 프로필 rank | 프로필은 현재 시즌만 준다. 닫힌 시즌은 `ratings`에 나타나지 않는다 | 해당 없음 | 일치. 공백 기간 표시는 결함 2 |

**이전 보고서 정정:** web QA 「목과 실제 차이」의 「종료 시즌 프로필 rank: 목은 값이 나온다」는 부정확하다. `mock/ratings.ts`도 `currentSeason`만 쓰므로 실제와 같다. 실제로 rank null이 되는 경로는 캐시 키 삭제가 아니라 현재 시즌에 없는 것이다.

## 레이팅 흐름 무결성

임시 spec의 한 시간축으로 실행했다. FakePrisma 기준이다.

| 단계 | 실행 결과 |
| --- | --- |
| T0 진행 중 | 요약 `me` {1421, #2} = ELO `me` #2 = 프로필 rank 2 = 사이드바 「ELO 1421 · #2」 |
| T1 ends_at + 30초 | 종료 작업 closed 0. 랭킹은 S1, 요약 season·me null, 프로필 ratings [] |
| T2 승인 | 시즌 2 자동 생성(S1 끝에서 이어짐). `rating_history.elo_before` 1211 = `softResetElo(1421)`, `carried_from` = S1, S1 행 1421 불변. 요약 me·프로필 elo 1233, rank null(5경기 미만). top_rankers는 S2 빈 목록 |
| T3 ends_at + 60초 | closed 1. S1 캐시 키 삭제. S1 최종 순위 1500·1421·1300, 미달 멤버 제외. 뱃지 `season_lol_top2` |
| T4 탈퇴 | 저장 순위를 다시 매기지 않음 |

| 불변식 | 판단 |
| --- | --- |
| 소프트 리셋 1회 | 행 생성 경로는 승인 하나, 사용자 잠금 + 유일 키. 값 일치, 동시 실행은 미실행 |
| 승인 2회 → 1회 반영 | `scrim-results.e2e.spec.ts:465` 409, 이력 그대로 |
| 종료 작업이 ratings를 쓰지 않음 | 코드 확인, T3에서 S1 행 불변 |
| 공식 재구현 없음 | api·web 화면 코드 grep 없음. 전부 core 호출 |
| 7c 순서 | 사용자 잠금 < FOR SHARE < 첫 rating 쓰기(코드 + 뮤테이션 2종) |
| 읽기 이월(D160) | `rating-inputs`가 승인과 같은 `loadPreviousRatings`·`seasonStartElo`를 쓴다 |

계약 6-5의 11줄은 backend QA 대조를 다시 읽었고 코드 변경이 테스트뿐이라 판단이 그대로다. 시나리오 3·5·6의 실제 동시성은 미실행이다.

## 이전 수정 재검증

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 마이그레이션 경고 2줄 | **고침** | 경고 없음. `migrate diff`와 주석 제외 일치. 실제 적용은 미실행 |
| backend 2, 7c 순서 테스트 | **고침** | 7c를 createMany 뒤로(M7) → 1건 실패. 사용자 잠금 앞으로(M7b) → 1건 실패 |
| backend 3, env 8조합 | **고침** | forRoot 직접 호출 → 4건, ScrimsModule 캐시 제거 → 10건, Dashboard DI 파손 → 296건 실패 |
| web 1 재조회 주기 | 고침, 테스트 공백 | `hooks/rankings.ts:63`. 결함 6 |
| web 2 뱃지 월 | **고침** | `-1ms` 제거 시 3건 실패. 설계는 계약 C5 |
| web 3 종료 시즌 빈 상태 | **고침** | `eloEmptyNote`, 홈도 `eloEmptyState` 사용 |
| web 4 없는 시즌 필터 | **고침** | `rankings-view.tsx:190`. 같은 줄의 별도 경로가 결함 4 |
| web 5 시상대 rank 기준 | **고침** | `podiumOrder`, 실제 API 공백 응답으로 확인 |
| web 6 시드 시간순 | **고침** | 정렬 제거 시 1건 실패 |
| web 7 시나리오의 /seasons 적용 | **고침** | 코드·단위 테스트 |
| web 8 /me 실패 시 스켈레톤 | **고침** | `season-card.tsx:14`, `home-view` 분기 코드 확인 |
| web 9 사용자 전환 | **고침, 지시와 다른 구현 수용** | 아래 |
| web 10 요약 무효화 | **고침** | 제거 시 3건 실패 |
| 시드 버전 5 | **고침** | `SEED_VERSION = 5`, 버전 불일치면 재시드. 상수를 4로 바꾼 변형은 생존하나 상수를 고정할 이유는 없다 |
| core 1 프로토타입 키 | **고침** | `constructor` → RangeError 직접 실행 |
| core 2 `value` 필드 보존 | **고침** | 두 함수 모두 호출자 `value` 유지 |
| core 3 뱃지 rank 테스트 | **고침** | 입력 0, −1, 1.5, 2.999, 4 제외. 실행 결과 1·2·3만 |

**web 9, `resetQueries`:** 지시한 `qc.clear()`보다 낫다. 제거 방식 변형(`removeQueries`, clear와 같이 observer에 알리지 않는다)은 「떠 있는 화면은 새 사용자 값으로 바뀐다」 테스트 1건에서 실패한다. 구현자의 실측과 맞다. `prev`가 없는 첫 세션은 지우지 않고 `me` 키는 제외한다. 사용자별 키가 없는 요약은 이 경로가 지켜 준다. 다른 탭 전환의 실제 브라우저 실행은 미실행이다.

## 슬라이스·명세 대조

| 구분 | 결과 |
| --- | --- |
| 슬라이스 포함 15행 | 전부 구현. 누락 없음 |
| 슬라이스 제외 | 활동·플레이타임 탭 비활성 + 「봇 연동 후 제공」, 음성·활동 카드, 스파크라인, 패치·이벤트, 시즌 관리자 없음. 응답에도 필드 없음 |
| 메인 기본값 1–5 | 1 대표 계정·큐·언랭 제외, 2 게임별 1–3위, 3 주 기준, 4 D161(Q4 대기), 5 주기 작업. 모두 코드와 일치 |
| 문서 7-3 | 티어 식, 레이팅·승률 정렬, 5경기, 5분 캐시, 최종 순위·뱃지·소프트 리셋 일치. 시점은 D140으로 다르다(명세 16) |
| 문서 6장 | 세 경로 일치. 경로는 그대로이고 필수 값·응답 필드가 늘었다 |
| 문서 8장 | `/`, `/rankings`, `/members/[id]` P0 범위 구현. 빠진 항목은 슬라이스 제외와 같다 |
| 문서 9장 | 마지막 성공값 + 갱신 시각 일치. 「서버 캐시」는 PostgreSQL |
| 2장 P0 | 티어 랭킹 구현. ELO 랭킹의 주간·월간은 **누락이 아니라 Q6 대기**다 |

## 명세 문서 갱신 필요 목록 (22건)

| # | 문서 위치 | 현재 | 갱신 내용 | 근거 |
| --- | --- | --- | --- | --- |
| 1 | 2장 내전 ELO 랭킹 | 주간·월간·시즌 단위 | 시즌 단위. 주간·월간은 사용자 답변 후 | D162, Q6 |
| 2 | 2장 프로필 뱃지 / 업적·포인트 | 뱃지가 P0과 P2에 함께 있음 | 시즌 순위 뱃지 P0, 나머지 P2 | D145 |
| 3 | 3·4장 | 랭킹 계산은 워커, Redis·BullMQ | API 프로세스 cron + PostgreSQL | D146, D164 |
| 4 | 5장 seasons | 컬럼 3개 | `closed_at` 추가 | D141, D144 |
| 5 | 5장 ratings | - | `carried_from_season_id` 추가 | D140 |
| 6 | 5장 | 없음 | `ranking_caches` 표 | D146, D153 |
| 7 | 5장 | 없음 | `season_standings` 표, 최소 경기 수 이상만 | D145 |
| 8 | 5장 badges, user_badges | season 없음 | `user_badges.season_id`, `badges.description`, 유일 키 | D145 |
| 9 | 6장 공통 | 목록은 cursor·limit | 랭킹 예외: 최대 200행, `next_cursor` null, `total` | D154 |
| 10 | 6장 /rankings/* | `game=`, `season=` | game 필수, steam 티어 400, 없는 시즌 404, `me`·`total`·`synced_at`·`stale`·`is_final`·`min_games` | 계약 4절 |
| 11 | 6장 /dashboard/summary | 진행 중 내전, 상위 랭커, 활동 통계 | 다음 내전, 모집 중, 시즌, 상위 랭커, 최근 결과, 내전 통계, 내 ELO. 활동 통계는 S5 | 계약 8절 |
| 12 | 6장 /users/{id}/profile | 뱃지 | `badges` 배열, `ratings[].rank` | D159 |
| 13 | 7-3 티어 | 식만 있음 | 티어·디비전 숫자, 마스터 이상, 언랭 제외, 대표 계정, 동점 | D152, 기본값 1 |
| 14 | 7-3 ELO | 레이팅, 같으면 승률 | 승률 → 경기 수 → user id, 공동 순위 없음, 최소 경기 수 설정값 | D152, D163 |
| 15 | 7-3 캐시 | 요청마다 계산 안 함 | 빈 캐시 첫 요청 동기 계산 예외, 순위 변동 기준 = KST 주 시작 | D148, D153 |
| 16 | 7-3 소프트 리셋 | 시즌이 끝나면 적용 | 새 시즌 첫 행 생성 때 적용, 반올림, 비율 설정값, 5경기 미만·빈 시즌 규칙 | D140, D142 |
| 17 | 7-3 시즌 종료 | 절차 한 줄 | 유예 60초, 다음 시즌은 다음 승인 때 생성, 게임별 1–3위, 경계 pending은 다음 시즌 | D141, D143, D145, D165 |
| 18 | 7-1 첫 레이팅 | 연동 티어로 시드 | 이전 시즌 행이 없을 때만 시드 | D103 변경, Q1 |
| 19 | 8장 `/` | 접속 인원, 패치 소식 | 현재 통계 2종. 접속 인원 S5, 패치 S6 | 슬라이스 제외 |
| 20 | 8장 `/rankings` | 기간 선택 | 게임·시즌 필터, 활동·플레이타임 S5 | D162 |
| 21 | 8장 | 없음 | 사이드바 시즌 카드, 내 ELO·순위, 모바일 머리 | D157 |
| 22 | 9장 캐싱 표 | 랭킹 5분 서버 캐시 | PostgreSQL 저장, 실패 시 `stale`, 660초 기준 | D146, D149 |

## 계약 문서 정정 필요 목록 (15건)

대상: `_workspace/01_architect_contract.md`.

| # | 위치 | 정정 |
| --- | --- | --- |
| C1 | 62행, 637행 | 지금은 사실이다(재검증 일치). 문구는 유지하고 이력 추가: 최초 파일에 CLI 경고 2줄이 들어가 리더가 삭제, stdout만 저장. `prisma validate`는 DATABASE_URL 값이 필요 |
| C2 | 459행(11절) | export에 `RankingRefresher`, `SeasonCloser` 추가 |
| C3 | 460행(11절) | `ScheduleModule.forRoot()` → `sharedScheduleModule`. `common/shared-schedule.ts`, `jobs/jobs.module.ts` 행 추가 |
| C4 | 469행, D164 | `ScrimsModule.forRoot` 동일 객체 규칙, ScrimViews export 위치 |
| C5 | 445행 + 새 D 항목 | 뱃지 월 = `earned_at − 1ms`의 KST 월(표시만). 저장 규칙 82행은 유지. `ends_at`이 배타적 끝이기 때문 |
| C6 | 437행 | 「{ratio%}만 유지」는 실제 식과 뉘앙스가 다르다. ratio 0.3이면 1600 → 1180이지 480이 아니고, ratio 1이면 「100%만 유지」가 된다. 예: 「종료 시 1000 기준 차이의 30%만 유지」, ratio 1·0 별도 문구. 기본값 0.5에서는 표시 영향 없음 |
| C7 | 433행 | 요약·랭킹 `refetchInterval` 5분 명시 |
| C8 | 412–418행 | 빈 상태 3종(종료 시즌, 시작 전, NOT_FOUND), is_final 규칙 문구, 시상대 rank 기준, 필터 「—」·「시즌 없음」, 모바일 열 합침, 팀 평균·티어 육각형 제외 |
| C9 | 451행 | 목 시나리오(`gcd-mock-rankings`, `me_error`), GET /seasons 적용, 시드 버전 5 |
| C10 | 130행, 4-4 | `eloRankOf(game, seasonId, userId)`, `eloView`·`eloEntryOf` 공개, 뱃지는 표별 조회 |
| C11 | 265행, 7-2 | 티어 SQL은 id 배열 대신 `JOIN game_accounts` |
| C12 | 375행, 394행, 400행 | `tierScore` RangeError, `computeSeasonBadges`는 rank 1·2·3만, 추가 export(`SEASON_SOFT_RESET_CENTER`, 타입 2개) |
| C13 | 10절 또는 새 D 항목 | 세션 사용자 변경 시 `applySessionUser`가 `me` 외 쿼리를 `resetQueries`. `clear()`를 쓰지 않는 이유 |
| C14 | 2절, 8-2, `packages/shared/src/dashboard.ts:81` 주석 | 요약 첫 계산 실패 처리 결정. `top_rankers` null의 의미와 `games` 빈 경우 |
| C15 | 11행 변경 이력, 10절 | QA 수정 이력 추가. 시즌 공백 중 프로필 표시 규칙(결함 2). 배포 영향(결함 1)을 18절에 추가 |

## 미실행

| 항목 | 이유 |
| --- | --- |
| DB e2e 42건(S4 신규 9건 포함) | PostgreSQL·Docker 없음 |
| `prisma migrate deploy`, 마이그레이션 실제 적용 | 같음 |
| 실제 SQL: `ON CONFLICT … WHERE`, `DISTINCT ON`, `FOR SHARE`, `FOR NO KEY UPDATE`, FK 비대기, `$queryRaw` 날짜 변환, `user: {}` 관계 필터 | 같음. FakePrisma는 SQL을 해석하지 않는다 |
| 잠금 대기, 교착 없음, 6-5 시나리오 3·5·6의 동시 실행 | 같음 |
| 실제 API + 실제 DB + 브라우저 연결 | 같음. 경계 대조는 FakePrisma 위 실제 Nest 응답 + 웹 순수 함수까지다. 렌더링은 아니다 |
| 이번 QA의 브라우저 재확인 | 목 화면은 구현자 기록(수정 후 60페이지). final·empty·me_outside 전체 화면은 수정 후 빌드에서 구현자도 다시 보지 않았다. ELO 안내 줄 0개 재측정도 구현자 값이다 |
| 다른 탭 계정 전환의 실제 브라우저 실행 | 단위 테스트만 |
| 실제 `docker build`, Railway 로그, S3 HEAD 직접 빌드 | Docker 없음. 결함 1은 복사 범위 재현 |
| 저장소 `vitest.config.ts`, `pnpm -r test`, Node 22 실행 | 이 PC는 Node 20.11. 임시 설정 결과 |
| 사용자 판단 Q1–Q7 | 답변 대기. 현재 계약대로 검증 |

## 재검증 조건

1. 결함 1 수정 후 웹 이미지 빌드. 실제 Docker가 없으면 같은 복사 범위 재현으로 대신한다.
2. PostgreSQL이 있는 환경에서 `migrate deploy` + DB e2e 42건, 특히 `season-close`·`ranking-cache`.

## 이전 결함 재확인

「이전 수정 재검증」 표 참고. 17건 중 고침 16건, 고쳤으나 테스트 공백 1건(web 1). 미수정은 리더 지시로 보류한 backend 결함 4뿐이다(결함 5).
