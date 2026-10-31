# QA: S4 후속 변경 2 (계약 20절) — shared·core·api — 판정: pass

대상: 계약 `_workspace/01_architect_contract.md` 20절 중 shared·core·api. apps/web은 제외(frontend 작업 중, web typecheck 실패는 결함으로 세지 않음).
참고 보고서: `02_domain-logic-dev_report.md` 20절, `02_backend-dev_s4.md` 20절.
검증자가 쓴 도구: Read, Grep, Glob, Shell(Bash), Write. 코드는 고치지 않았다.

## 실행한 명령과 결과

환경: Node 20.11.0(저장소 engines ≥ 22), DB·Docker 없음. 저장소 `vitest.config.ts`가 Node 20에서 로드되지 않아(`ERR_REQUIRE_ESM`) 내용이 같은 임시 `.mjs` 설정을 `/tmp/gcdqa/`에 두고 `--config <tmp> --root .`로 실행한 뒤 디렉터리를 지웠다(api 설정은 `unplugin-swc` ESM 절대 경로 import, env·testTimeout·include 동일).

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter @gcd/shared typecheck` | exit 0 |
| `corepack pnpm --filter @gcd/core typecheck` | exit 0 |
| `corepack pnpm --filter api typecheck` | exit 0 |
| `corepack pnpm --filter api build` | exit 0 (dist에 `rating-carry.js` 없음) |
| shared `npx vitest run` (임시 설정) | 5파일 **99 passed** |
| core `npx vitest run` (임시 설정) | 9파일 **355 passed** |
| api `npx vitest run` (임시 설정) | 37파일 중 30 passed·7 skipped, **498 passed / 42 skipped / 0 failed** (skip = `test/db/*` DB e2e, 정상) |
| `DATABASE_URL=… npx prisma validate` (apps/api) | `The schema at prisma/schema.prisma is valid` |
| `git status prisma` | `schema.prisma`만 M, 새 마이그레이션 폴더 없음. diff는 `///` 주석 3줄뿐 |
| core·shared dist 신선도: `tsc -p tsconfig.build.json --outDir /tmp/…` 후 `dist/*.js`와 비교(sourceMappingURL 줄 제외) | 차이 없음. `src/balance.ts`(14:29)가 `dist/balance.js`(14:21)보다 새것이지만 산출물은 동일(주석 변경으로 판단) |
| 빌드된 core(`packages/core/dist/index.js`)로 20-3 표 계산 | 9행 모두 일치(아래) |
| 빌드된 shared(`@gcd/shared` dist) + 빌드된 api `loadConfig`로 응답 객체 parse | 모두 통과(아래) |

### core 20-3 검증 값 (빌드된 dist로 직접 계산)

| tierSeed | seasonElo | seasonGames | w(계산) | skill(계산) | 기대 | 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| 1800 | 1000 | 0 | 0 | 1800 | 1800 | OK |
| 1800 | 1000 | 1 | 0.02 | 1784 | 1784 | OK |
| 1800 | 1000 | 5 | 0.1 | 1720 | 1720 | OK |
| 1800 | 1000 | 10 | 0.2 | 1640 | 1640 | OK |
| 1800 | 1000 | 25 | 0.2 | 1640 | 1640 | OK |
| 600 | 1400 | 10 | 0.2 | 760 | 760 | OK |
| 1200 | 1500 | 10 | 0.2 | 1260 | 1260 | OK |
| 1000 | null | 0 | 0 | 1000 | 1000 | OK |
| 1800 | null | 3 | 0.06000000000000001 | 1752 | 1752 | OK (w 부동소수 꼬리는 반올림 결과에 영향 없음) |

`balanceEloWeight`: 0→0, 1→0.02, 5→0.1, 10→0.2, 11→0.2. −1·1.5·NaN → `RangeError`(`balanceEloWeight`, `computeSkill` 둘 다). dist export에 `softResetElo`·`seasonStartElo`·`pickPreviousRating`·`SEASON_SOFT_RESET_CENTER` 없음.

### 런타임 parse 확인 (빌드된 shared 스키마)

- `loadConfig({필수값, SEASON_SOFT_RESET_RATIO: '0.5'})` 성공, 결과에 `seasonSoftResetRatio`·`soft` 문자열 없음.
- 요약 `rating_policy`(`dashboard.service.ts:80–88`와 같은 조립, 기본 설정) → `DashboardRatingPolicy.parse` 통과: `{min_games:5,k_base:32,k_new:40,new_player_games:10,loss_ratio:0.5,full_weight_games:10,elo_weight_max:0.2}`.
- 밸런스 `rating_policy`(`scrim-teams.service.ts:120–127`) → `RatingPolicyView.parse` 통과, `elo_weight_max` 0.2.
- 옛 모양(`soft_reset_ratio` 있고 새 필드 없음)은 실패, 새 모양에 `soft_reset_ratio`를 섞으면 제거됨(zod strip) — 20-14 배포 순서 설명과 일치.
- 추천 응답: 2개·1개·`[]`+계정 `synced_at`·롤체/스팀 빈 응답 5가지 모두 `GetMyPositionSuggestionsResponse` 통과. `LolPosition` 5값 전부 `ScrimPosition` 정규식 통과, shared 게임 시드 lol positions = `LolPosition`과 같은 5개 → `PreferredPositions`(max 2, 중복 금지) parse 실패 경로 없음(`computeMainPosition`은 서로 다른 포지션만 반환, `slice(0, SCRIM_PREFERRED_POSITIONS_MAX)`).
- `GetMyPositionSuggestionsQuery`: game 누락·모르는 값 실패. `ApiPath.myPositionSuggestions` = `/me/position-suggestions`. `ErrorCode` 43개 유지.

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 | 담당 |
| --- | --- | --- | --- | --- | --- | --- |
| - | - | - | - | 결함 없음 | - | - |

## 20-13 대조 (화면·추천 기본값 웹 항목 제외)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 승인 경로 시작값 = `RATING_START_ELO` 외 계산 없음 | OK | `scrim-results.service.ts:201–209` `createMany({ data: missing.map(… elo: RATING_START_ELO) }), skipDuplicates: true`. `seasonStartElo`·`tierSeedRating`·`loadTierSeeds`·`loadPreviousRatings` import 없음(:1–33) |
| `rating.create`/`createMany`가 승인 9단계에만 | OK | `rg 'rating\.(create\|createMany\|upsert)\b' apps/api/src` → `scrim-results.service.ts:205` 1곳 |
| `carriedFromSeasonId` 쓰기 없음 | OK | `rg 'carriedFromSeasonId\|carried_from_season_id' apps/api/src prisma/seed.ts` → 0건. 테스트 `season-transition.e2e.spec.ts:107–132`가 createMany 데이터 = `{userId, gameId, seasonId, elo: 1000}`(carried 키 없음) 확인 |
| 삭제 키워드 전역(목·테스트 포함, `_workspace/**`·web 제외) | OK(정당한 예외만) | 아래 「삭제 키워드 예외 판단」 |
| 7c `lockSeasonForRating` 유지 | OK | `rating-locks.ts:42–50`(`FOR SHARE` + `closed_at` 검사, INTERNAL_ERROR), 호출 `scrim-results.service.ts:199`(사용자 잠금 :192 뒤, 9단계 ratings 쓰기 앞) |
| 8단계 사용자 잠금 유지 | OK | `rating-locks.ts:27–34`, 호출 `scrim-results.service.ts:192`, now는 잠금 직후 :194 |
| 6-5 4·6–9행 테스트 통과 | OK | `season-transition.e2e.spec.ts:173`(시나리오 4), `:344`(6), `:353`(7), `:325`(8), `:366`(9) 모두 api 테스트 실행에서 통과. 1·2·11: `:408`, `:418` 통과 |
| K 신규 판정 그대로 | OK | `scrim-results.service.ts:212–216` `countRatedGames(tx, game.id, locked)`(모든 시즌 rating_history 수) → `RatedPlayer.gamesPlayed`. `rating-inputs.service.ts:30–45` 변경 없음 |
| w: core 표 | OK | 위 표 |
| `rating-inputs`의 `seasonGames` = 현재 시즌 행 `wins + losses` | OK | `rating-inputs.service.ts:68–78`: 현재 시즌만 조회(:70), `seasonGames = row ? row.wins + row.losses : 0`(:78), `seasonElo = row?.elo ?? null`(:77), `rating = seasonElo ?? RATING_START_ELO`(:88). 이전 시즌 조회 없음 |
| `isNew`는 모든 시즌 이력 수 | OK | `rating-inputs.service.ts:79, 89` `gamesPlayed = countRatedGames` → `isNew: gamesPlayed < newPlayerGames`. 테스트 `season-transition.e2e.spec.ts:455–465`(지난 시즌 10경기, 새 시즌 0경기 → skill 1800·is_new false) |
| 밸런스 `members[].skill` = 상세 `players[].skill` | OK | 둘 다 `RatingInputsService.forUsers`(`scrim-teams.service.ts:72`, `scrim-views.service.ts:297`). 테스트 `scrim-results.e2e.spec.ts:203` 통과 |
| 밸런스 `rating_policy.elo_weight_max` = 0.2 | OK | `scrim-teams.service.ts:126`, `BalanceScrimResponse.parse`(:102) 경유 |
| 요약 `rating_policy`: `soft_reset_ratio` 없음, `full_weight_games` 10, `elo_weight_max` 0.2 | OK | `dashboard.service.ts:80–88`, `GetDashboardSummaryResponse.parse`(:72) 경유. shared `dashboard.ts:48–56` 필수 필드 |
| env ↔ `.env.example` ↔ `config/env.ts`에 `SEASON_SOFT_RESET_RATIO` 없음 | OK | `rg 'SOFT\|soft' apps/api/src/config/env.ts .env.example` → 0건. `env.ts:61` `z.object`(strip) → 남은 키 무시 |
| 남은 env가 기동을 막지 않음 | OK | `env.spec.ts:172–177`(0.5·0.25·half·-1 → 설정 동일), `season-transition.e2e.spec.ts:134–141`(앱 기동 + 시작값 1000), 직접 `loadConfig` 실행도 성공 |
| 추천: 엔드포인트 ↔ `ApiPath` | OK | `profile.controller.ts:33` `@Get(ApiPath.myPositionSuggestions)`, `paths.ts:54`. 웹 클라이언트·목은 범위 밖 |
| 추천: 본인 것만 | OK | `profile.controller.ts:34–38` — 경로·쿼리에 사용자 id 없음, `user.id`(JWT)만 전달. `@UseGuards(JwtGuard)` 클래스 단위(:16) |
| 추천: 외부 호출·enqueue 없음 | OK | `position-suggestions.service.ts:17–20` 생성자 주입 = `PrismaService`, `GameCatalog`뿐. `rg 'enqueue\|SyncEnqueuer\|Riot\|Steam\|fetch\('` 0건. 테스트 `position-suggestions.e2e.spec.ts:61–65` `enqueue` 미호출 |
| 추천: 프로필 `main_position`과 같은 조회·필터 | OK | 공용 `recent-matches.ts:10–26`(`playedAt desc, id asc`, `take: RECENT_MATCHES_MAX`, safeParse 실패·`win` null 건너뜀)을 `profile.service.ts:70`과 `position-suggestions.service.ts:36`이 같이 씀. 계정 선택: 프로필 `primaryRiotRows`(`game-account-views.service.ts:53`, code lol && isPrimary) ↔ 추천 `findFirst({userId, gameId, isPrimary: true})`(:32). 부분 고유 인덱스 `game_accounts_one_primary_per_user_game`(s1 migration:67)로 대표는 최대 1행이라 동일. 추천은 `game.positions` 필터를 더하지만 시드 lol positions = `LolPosition` 전체라 결과 같음. 테스트 `position-suggestions.e2e.spec.ts:70–71` |
| 추천: 게임 행 조회는 `GameCatalog` | OK | `position-suggestions.service.ts:24–29`(`catalog.ids()` → `game.findUnique`, 없으면 로그 + INTERNAL_ERROR) |
| 참가·작성 서비스가 빈 포지션을 채우지 않음 | OK | `git diff --stat apps/api/src/modules/scrims` = `scrim-results.service.ts`, `scrim-teams.service.ts`만. `rg 'PositionSuggestions\|loadRecentLolMatches\|computeMainPosition'` → profile 모듈 밖 사용 0건 |
| 스키마 diff 주석뿐, 새 마이그레이션 없음 | OK | `git diff prisma/schema.prisma` = `///` 3줄, migrations 변경 없음, `prisma validate` 통과 |

### 그 밖에 확인한 것

- 20-2: `rating-carry.ts` 삭제(소스·dist 모두 없음), `ratings.module.ts` 주석만, `season-closer.ts` 주석만(동작 변경 없음, D186), `rating-seed.ts` 주석만.
- 20-3: `index.ts:63–64` `balanceEloWeight`·`computeSkill` export, 삭제 3개 export 없음. `config.ts:31, 46`, `rating.ts:36` 주석 「밸런스 티어 환산값, ELO 시작값 아님」. `computeSkill` 호출부는 api `rating-inputs.service.ts:87` 1곳.
- 20-6 shared: `RATING_START_ELO = 1000`(`scrims.ts:67`), `BALANCE_ELO_WEIGHT_MAX = 0.2`(:72), `BALANCE_FULL_WEIGHT_GAMES = 10`(:74), 추천 스키마 `scrims.ts:644–664`.
- 20-12 backend 테스트 목록: 6-1 교체(`season-transition.e2e.spec.ts:49–141`), D193(:89–105), 읽기 w(:430–), 추천 e2e 7건(롤 2개·1개·기록 없음·롤체/스팀/계정 없음·다른 사용자/부계정·positions 필터·400/401), DB e2e 기대값(`season-close.db.e2e.spec.ts:199–239`, 실행은 skip) 모두 존재.

### 삭제 키워드 예외 판단

`rg 'softResetElo|seasonStartElo|pickPreviousRating|SEASON_SOFT_RESET|seasonSoftResetRatio|soft_reset_ratio|loadPreviousRatings'`(`_workspace/**`·`apps/web` 제외) 결과와 판단:

| 위치 | 판단 |
| --- | --- |
| `apps/api/src/config/env.spec.ts:172, 175` | **정당한 예외.** 20-12가 요구한 「`SEASON_SOFT_RESET_RATIO`가 env에 남아 있어도 기동 성공」 테스트. 키 문자열 없이는 이 동작을 검증할 수 없다. 20-13 삭제 확인의 취지(죽은 코드·설정이 다시 쓰이지 않게)는 프로덕션 코드 기준으로 충족 |
| `apps/api/test/season-transition.e2e.spec.ts:134–135` | **정당한 예외.** 같은 요구(앱 전체 기동 + 시작값 1000) |
| `packages/shared/src/contract.s4.test.ts:223, 225, 228` | **정당한 예외.** architect의 「소프트 리셋 상수 없음」, 「요약 `rating_policy`에 `soft_reset_ratio` 없음」 회귀 테스트(부재를 단언) |
| `packages/shared/src/dashboard.ts:46`(+ dist 같은 줄) | **허용.** 「20절에서 `soft_reset_ratio`를 뺐다」는 이력 주석. 식별자·동작 아님. 정리하려면 architect 몫이지만 결함으로 세지 않는다 |

프로덕션 코드(api src 비테스트, core src, shared 스키마 정의)에는 남은 것이 없다. 20-13 문구는 「테스트 포함 남지 않음」이지만 20-12 요구와 충돌하므로, 위 테스트 3파일은 계약 해석상 예외로 기록한다(리더가 20-13 문구에 예외를 명시하면 깔끔하다).

## 참고 (결함 아님)

- 새 시즌 1000 재시작 뒤 승인에서 기존 멤버가 `k_base`(신규 K 아님)로 반영되는지를 **승인 경로에서 직접** 단언하는 테스트는 보이지 않는다. 코드상 `countRatedGames`(모든 시즌) 그대로라 동작은 맞고, 읽기 쪽 `is_new false`는 `season-transition.e2e.spec.ts:464`가 단언한다. 20-12 필수 목록에 없던 항목이라 결함으로 세지 않는다.
- 추천에서 `game.positions` 필터로 값이 모두 빠지면 `positions: []`인데 `sample_size > 0`일 수 있다. 계약 20-5 4번(`sample_size` = 결과 값) 그대로이며, 현재 시드에서는 발생하지 않는다.
- `apps/api/src/modules/ratings/rating-seed.spec.ts:5` 주석에 「티어 시드(D103)」 표기가 남아 있다. 테스트 주석이고 D189가 식별자 유지를 허용하므로 결함 아님.
- 실행은 Node 20.11 + 임시 vitest 설정 기준이다. Node 22 + 저장소 설정 그대로, DB e2e는 실행하지 않았다.
