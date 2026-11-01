# QA: s2 (교차 대조·명세 대조) — 판정: pass

작성: qa-verifier, 2026-10-29
대상: S2 전체(shared 계약 코드 `scrims.ts`·`game-catalog.ts`·`paths.ts`·`errors.ts`·`transitions.ts`·`games.ts`, packages/core `scrim.ts`·`no-show.ts`, apps/api games·scrims 모듈·`scrim-lock.ts`·env·인증 보완, Prisma 스키마·마이그레이션 `20261029120000_s2`, apps/web 내전 화면 3개·훅·API·목·스팀 팝업)
기준: 계약 `_workspace/01_architect_contract.md`(D73–D96, 변경 이력 2행 포함), 슬라이스 `_workspace/00_input/slice.md`, 명세 2·5·6·7-4·8장, qa-boundary-check 2절 「교차 대조」「명세 대조」.
모듈별 보고서: `_workspace/03_qa-verifier_{core,backend,web}.md`(모두 pass). 구현 보고서: `02_domain-logic-dev_report.md`, `02_backend-dev_scrims.md`, `02_frontend-dev_scrims.md`.
사용 가능 도구: Read, Grep, Glob, Shell(PowerShell), Write. 브라우저·스크린샷 도구는 쓰지 않았다.

## 실행한 명령과 결과 (2026-10-29 14:29–14:33, 순차 실행)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·web·api 4개 Done, EXIT 0 |
| `corepack pnpm -r test` | shared **53** / core **148** / web **125** passed / api **332** passed, 27 skipped(DB e2e 4개 파일: sync-store 8, auth 6, scrims 6, game-accounts 7). Test Files api 22 passed / 4 skipped. EXIT 0 |
| `corepack pnpm -r build` (typecheck·test 뒤 순차) | 4개 패키지 성공. web: `○ /scrims 3.23 kB`, `ƒ /scrims/[id] 8.4 kB`, `○ /scrims/new 176 B`, `○ /steam-link/complete 5.22 kB`, `ƒ Middleware 50.6 kB`, 12/12 페이지. EXIT 0 |
| `npx prisma validate` | `The schema at prisma\schema.prisma is valid` |
| `prisma migrate diff --from-schema-datamodel <7016593 schema> --to-schema-datamodel prisma/schema.prisma --script` | 출력이 `migrations/20261029120000_s2/migration.sql` 7–21줄(CreateEnum 1, games ALTER 1, scrims ALTER 1)과 **같다**. 마이그레이션에 `DROP INDEX` 문 없음(주석만), 수동 블록 UPDATE 2줄 |
| core dist 재현(node, 코드 미수정) | `computeScrimRestriction([35일 전, 33일 전, 6일 전], now, 3/30/7)` → `restricted: true, recentCount: 1`(결함 1). `computeOpenPositions(롤 5포지션, 10, 미드×9)` → 4개 포지션 각 2(결함 2) |
| DB e2e(`test/db/scrims.db.e2e.spec.ts` 6건, `auth.db.e2e.spec.ts` 6건) | **미실행**(PostgreSQL·Docker 없음) |

## 결함

blocker 0, major 0, minor 4.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/web/src/lib/scrims.ts:275-278(`restrictionText`), 계약 8절 배너 문구, core `no-show.ts`의 `recentCount` | 제한 배너가 제한 이유를 맞게 말한다 | 배너는 「노쇼 {recent_no_show_count}회로 …까지 제한」인데 `recent_no_show_count` = (now − 30일, now] 개수다. 발동 구간은 (m − 30일, m]이라 제한 중인데 최근 30일 개수가 기준(3)보다 작을 수 있다. 사용자는 「노쇼 1회로 제한」을 보게 된다. 목(mock)도 같은 식 | 노쇼 표시 시각이 35일·33일·6일 전인 사용자 → `GET /me/scrim-restriction` = `restricted: true, recent_no_show_count: 1` → `/scrims` 배너 「노쇼 1회로 10.30 14:00까지…」(core dist로 값 확인). 계약 8절 문구를 「노쇼 누적으로 …까지」로 바꾸거나 발동 구간 개수를 따로 내려야 한다(architect 결정) |
| 2 | minor | packages/core/src/scrim.ts:156-167 → apps/web/src/lib/scrims.ts:203(카드 보조 줄) | 「… 구함」 합계가 실제 빈 자리 수를 넘지 않는다 | core QA 결함 1이 그대로 남아 목록 카드에 보인다. 계약 7절 식 그대로라 계약 위반은 아니다 | 롤 10명 내전에 1지망 미드 9명 → 빈 자리 1인데 카드 「탑 2 · 정글 2 · 원딜 2 · 서폿 2 구함」. 합계를 빈 자리로 자를지 architect가 정할 것 |
| 3 | minor | apps/web/src/lib/errors.ts:52(「시작 후 7일 안」), components/scrims/scrim-detail.tsx:304(「60분 뒤」), :466-467(「30일 … 3회 … 7일」), components/scrims/scrim-new-form.tsx:108-109(`SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT`) | 환경 변수로 바뀌는 값(계약 11절)은 화면도 같은 값을 쓴다 | 웹이 기본값을 글자·상수로 박아 둔다. API env를 바꾸면 안내 문구가 틀리고, 작성 폼 사전 검사는 서버와 다른 범위를 막는다(상한을 늘리면 클라이언트가 막고, 줄이면 서버 400) | `SCRIM_NO_SHOW_THRESHOLD=2`, `SCRIM_SCHEDULE_MAX_DAYS_AHEAD=60`으로 API 기동 → 노쇼 확인 대화상자는 여전히 「3회」, 45일 뒤 작성은 웹이 「30일 안의 시각만」으로 막음. 노쇼 정책은 `GET /me/scrim-restriction`의 `policy`로 이미 받으므로 그 값을 쓰면 된다. 표시 기한·자동 마감·작성 상한은 API로 내려오지 않으니 문구에서 숫자를 빼거나 계약에 노출 필드를 추가 |
| 4 | minor | apps/web/src/components/scrims/scrim-detail.tsx:90-98(`useJoinClosed`, 리더 수정분) | D93: 마감 판단은 서버 시각 기준(클라이언트 시계 오차 방지) | 클라이언트 시계가 서버보다 빠르면 화면이 서버보다 먼저 「시작 시각이 지나 참가·취소할 수 없어요」로 바뀌고 참가·취소 버튼을 숨긴다. 재조회는 1번만 하고, 서버가 `join_closed: false`를 돌려줘도 `passed`가 이기므로 오차만큼(최대 다음 폴링 이후까지) 참가를 못 한다. 반대로 시계가 느리면 수정 전과 같다(서버 409로 복구). 데이터 영향 없음 | PC 시계를 3분 빠르게 두고 시작 2분 전 상세를 열면 즉시 마감 안내가 뜨고 「참가하기」가 없다. 서버 시각 오프셋(응답 `Date` 헤더 등)으로 보정하거나, 화면 판정은 서버값만 쓰고 0초 도달 시 재조회만 하도록 권장 |

### 결함 처리 (리더, 2026-10-29)

- 4 → 수정: 화면이 먼저 막고 재조회한 뒤 받은 응답(`dataUpdatedAt` > 막은 시각)이 `join_closed: false`면 서버값을 따른다. 시작 시각 이전으로 돌아가면(방장 수정) 기준을 초기화한다. 리더가 web typecheck·test 125·build만 확인, QA 재검증 없음
- 1·2·3 → 남김. 계약 문구·식·노출 필드 결정이 필요(architect, 다음 슬라이스 전 처리 권장)

## 교차 대조 표

### 1. 엔드포인트 11개 일대일 (계약 4절 ↔ ApiPath ↔ 컨트롤러 ↔ 웹 API·훅 ↔ 목)

| # | 계약 | ApiPath | 컨트롤러(파일:줄) / 상태 | 요청 파싱 | 응답 직렬화 | 웹 API → 훅 | 목 | 일치 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | GET /games | games | games.controller.ts / 200 | - | `ListGamesResponse.parse`(games.service.ts:29), id 비노출, next_cursor null | `listGames` → `useGames` | mock/scrims.ts:584 | O |
| 2 | GET /scrims | scrims | scrims.controller.ts:42 / 200 | `ListScrimsQuery` | `ListScrimsResponse.parse`(scrims.service.ts:130) | `listScrims`(game·status·cursor·limit 12) → `useScrims`(useInfiniteQuery) | :605 | O |
| 3 | POST /scrims | scrims | :51 `@HttpCode(201)` | `CreateScrimRequest` | `ScrimDetail.parse`(scrim-views.service.ts:191) | `createScrim` → `useCreateScrim` → `router.push(routes.scrim(id))` | :634(201) | O |
| 4 | GET /scrims/:id | scrim | :61 / 200 | `IdParam` | ScrimDetail | `getScrim` → `useScrim`(모집 중 20초·포커스) | :797 | O |
| 5 | PATCH /scrims/:id | scrim | :67 / 200 | `IdParam` + `UpdateScrimRequest` | ScrimDetail | `updateScrim` → `useUpdateScrim`(`buildScrimPatch`로 바뀐 필드만) | :797 | O |
| 6 | POST /scrims/:id/join | scrimJoin | :77 `@HttpCode(200)` | `JoinScrimRequest`(본문 필수) | ScrimDetail | `joinScrim` → `useJoinScrim`(항상 `{preferred_positions}`) | :714 | O |
| 7 | DELETE /scrims/:id/join | scrimJoin | :88 `@HttpCode(200)` | `IdParam` | ScrimDetail | `leaveScrim` → `useLeaveScrim` | :714 | O |
| 8 | POST /scrims/:id/start | scrimStart | :95 / 200 | `IdParam` | ScrimDetail | `startScrim` → `useStartScrim` | :715 | O |
| 9 | POST /scrims/:id/cancel | scrimCancel | :102 / 200 | `IdParam` | ScrimDetail | `cancelScrim` → `useCancelScrim` | :716 | O |
| 10 | PUT /scrims/:id/players/:userId/no-show | scrimPlayerNoShow | :109 `RolesGuard` + `@Roles('admin')` / 200 | `SetScrimNoShowParams` + `SetScrimNoShowRequest` | ScrimDetail | `setScrimNoShow` → `useSetScrimNoShow` | :684 | O |
| 11 | GET /me/scrim-restriction | myScrimRestriction | :122 / 200 | - | `GetMyScrimRestrictionResponse.parse`(scrim-restriction.service.ts:58) | `getMyScrimRestriction` → `useMyScrimRestriction` | :590 | O |

- 서버와 웹 모두 `ApiPath` 상수만 쓴다(웹은 `fillPath`). 웹 응답은 `apiClient.request(path, schema)`가 shared 스키마로 `safeParse`한다. 제네릭 단언만 쓰는 호출은 없다.
- 11개 모두 웹에서 쓴다(봇·관리 전용 없음). 계약 밖 엔드포인트, S3 경로(`/balance`·`/result*`)는 구현하지 않았다.
- `GamesModule`·`ScrimsModule.forRoot()`가 app.module.ts:32-33에 등록돼 있다.
- snake_case: API는 Prisma camelCase를 views에서 snake_case로 바꿔 parse하고, 웹은 `joined_count`·`open_positions`·`viewer.can_*`·`restricted_until`을 그대로 쓴다. 중간 camelCase 변환은 없다.

### 2. 응답 필드 의미 (API ↔ 웹 목 ↔ 화면)

| 필드 | API(scrim-views.service.ts) | 웹 화면 사용 | 일치 |
| --- | --- | --- | --- |
| joined_count | joined + no_show(:114). 모집 중엔 no_show가 없어 계약 4-2와 같은 값 | 카드 인원, 상세 `N / capacity` | O |
| open_positions | 모집 중 && use_positions일 때만 core `computeOpenPositions`(1지망 = `preferred_positions[0]`) | 카드 「… 구함」(결함 2) | O |
| join_closed | core `isJoinClosed` | 카드 배지 「시작 대기」, 상세 마감 안내(결함 4) | O |
| my_status | cancelled·없음 → null | 카드 「참가 중 / 대기 중」(모집 중일 때만) | O |
| players 순서 | 방장 → joined_at → user id(:168-177) | 슬롯 순서 그대로, 빈 슬롯 = capacity − players.length(모집 중만) | O |
| waitlist | core `orderWaitlist`, order 1부터 | WAITLIST 섹션(모집 중만, D95) | O |
| viewer.can_* | shared 주석(scrims.ts:203-209)과 같은 식(:220-232) | 버튼 노출은 can_*만(D93). 노쇼 정정은 `me.role === 'admin'` + 상태(playing·finished) — 서버가 정정 기한을 두지 않으므로 맞다 | O |
| viewer.restricted_until | 제한 중일 때 core until | 참가 영역 제한 안내(참가·대기 중이 아닐 때만) | O |
| balance / result | 항상 null | 빈 상태 카드 2개 | O |

### 3. 오류 코드

- shared `ErrorCode` 36개(S0 15 + S1 14 + S2 7) = `ERROR_HTTP_STATUS` 36 = API `DEFAULT_ERROR_MESSAGE`(app-error.ts:36-42에 S2 7개) = 웹 `ERROR_MESSAGES`(errors.ts:46-52). 둘 다 `Record` 타입이라 누락 시 typecheck 실패 — 통과.
- S2 7개 throw 위치: NOT_RECRUITING(scrims.service.ts:213, 284, 330, 354, 374), JOIN_CLOSED(:285, 331), HOST_CANNOT_LEAVE(:332), BANNED(scrim-restriction.service.ts:48), CAPACITY_BELOW_JOINED(:230), CANNOT_START(:358), NO_SHOW_NOT_ALLOWED(:393, 396, 400). 모두 e2e로 확인된다.
- SCRIM_BANNED: `Retry-After` 헤더(초, 올림), 본문 `{code, message}`. 웹은 SCRIM_BANNED에 「N분 뒤」를 붙이지 않고(errors.ts:100) 제한 조회를 다시 받아 해제 시각을 표시한다(hooks/scrims.ts:113, scrim-bits.tsx:116-118).
- 오류 판정 순서(계약 4절 왼쪽부터): join = 잠금(NOT_FOUND) → NOT_RECRUITING → JOIN_CLOSED → 포지션 VALIDATION → 기존 행이면 포지션 변경 → BANNED. 노쇼는 가드가 파이프보다 먼저라 FORBIDDEN이 NOT_FOUND·VALIDATION보다 앞선다. 계약과 같다.

### 4. 상태 전이 전 경로 (shared 맵 ↔ core ↔ 서비스 ↔ 화면 버튼)

| 전이 | shared 맵 | core 판단 | 서비스(scrims.service.ts) | 화면 트리거 |
| --- | --- | --- | --- | --- |
| scrims recruiting → full | O | `statusForJoinedCount` / `planRosterAfterChange` | join :314-319, applyRoster :269-272(정원 축소는 CAPACITY_BELOW_JOINED로 막혀 실제로는 정원 = joined로 줄일 때) | 「참가하기」, 수정 대화상자 정원 |
| scrims full → recruiting | O | `planRosterAfterChange` | applyRoster(취소 :338, 정원 확대 :245) | 「참가 취소」, 수정 정원 확대 |
| scrims recruiting·full → playing | O(recruiting → playing은 S2 추가) | `canStartScrim`, `decideOverdueScrim` | start :360-362, auto-close closeOne :79-80 | 방장·운영진 「내전 시작」(can_start), cron |
| scrims recruiting·full → cancelled | O | `decideOverdueScrim`(not_started) | cancel :375-379(host/admin), auto-close :82-85 | 「모집 취소」(can_cancel), cron |
| scrims playing → finished | O | - | 없음(S3) | 없음 — 맵에 있고 S2 미구현이 맞다 |
| players waitlist → joined | O | `planRosterAfterChange.promoteIds` | applyRoster :261-267(updateMany 조건 status=waitlist, 행 수 검사, preferred_positions·joined_at 유지) | 간접(다른 사람의 취소·정원 확대) |
| players joined·waitlist → cancelled | O | - | leave :335-336 | 「참가 취소」/「대기 취소」(can_leave) |
| players cancelled → joined·waitlist | O | `placeNewParticipant` | join :302-307(같은 행, joined_at = now → 대기열 맨 뒤) | 「참가하기」/「대기열 등록」(can_join) |
| players joined → no_show | O | `isNoShowMarkWindowOpen` | setNoShow :402-406 | 운영진 「노쇼 표시」(can_mark_no_show일 때만 — 리더 수정 5 확인) |
| players no_show → joined | O | - | setNoShow :409-413(기한 없음) | 운영진 「노쇼 정정」 |
| (삭제) players joined → waitlist | 없음(D79) | - | 없음 | 없음 |

- `status` 갱신 코드 전수: 모두 `assertScrimTransition`/`assertPlayerTransition`(= `canTransition`) 뒤에 있다. 맵 밖 전이 없음, 맵 안 전이 중 S2 범위 미구현 없음.
- 불변식 「대기가 있으면 joined = capacity, joined ≤ capacity」: 새 참가는 `placeNewParticipant`, 자리 변화는 모두 `planRosterAfterChange` → 위반 경로 없음.
- 5-0 잠금: 7개 경로(수정 :211, 참가 :283, 취소 :329, 시작 :352, 모집 취소 :371, 노쇼 :392, 자동 마감 closeOne scrim-auto-close.ts:68) 모두 트랜잭션 첫 문장이 `lockOrNotFound`. SQL(scrim-lock.ts:34-36)의 컬럼명 `scheduled_at`·`host_id`·`use_positions`·`game_id`가 schema.prisma `@map`과 같다. 계약 12절도 「7개」로 고쳐졌다(이전 backend 결함 4 해소).
- 웹 진행 단계(`scrimSteps`·`scrimDetailBadge`)가 계약 6절 표와 같다: recruiting 1단계 current / full 1 done·2 current / playing 1–2 done·3 current / finished 모두 done / cancelled는 단계 대신 이유 문구(`CANCEL_REASON_TEXT` 3개 = Prisma enum = shared enum).

### 5. 노쇼 제한 계산 (core ↔ 서비스 ↔ 웹 목)

| 단계 | core | API | 웹 목 |
| --- | --- | --- | --- |
| 조회 하한 | `noShowLookbackStart` = now − (window + restriction)일 | `noShowMarkedAt: { gt: noShowLookbackStart(now, policy) }`(scrim-restriction.service.ts:37) — 「초과」 | 시드 노쇼 3회, 같은 식(web QA 무작위 대조 불일치 0) |
| 판정 | `computeScrimRestriction`(발동 m마다 (m − window, m], until = 최대 발동 + restriction, now = until 해제, 미래 무시) | 그대로 호출 | 복사본(web 결함 1, 리더가 유지 결정) |
| 정책값 | 인자 | env 4개(양의 정수) → `config.scrim.noShow` | 기본값 |
| 적용 범위 | - | 작성(:175, 검증 뒤)·새 참가(:298, 기존 행 포지션 변경 뒤)만 → 기존 참가·포지션 변경·취소 허용(D83) | 같음 |
| 응답 | - | SCRIM_BANNED + Retry-After, `viewer.restricted_until`, `GET /me/scrim-restriction`(policy 포함) | 같음 |
| 화면 | - | - | 목록 배너·작성 버튼 비활성+툴팁·작성 폼 배너·상세 제한 안내. 문구의 횟수는 결함 1 |

### 6. 라우트 ↔ 링크

| 라우트 | app 파일 | 링크 생성 |
| --- | --- | --- |
| /scrims(?game&status, open 생략) | app/(main)/scrims/page.tsx | `routes.scrims(q)` — 필터·탭 `router.replace`, 상세·작성 「← 내전 목록」 |
| /scrims/new | app/(main)/scrims/new/page.tsx | `routes.scrimNew()` — 헤더 버튼·빈 상태 |
| /scrims/[id] | app/(main)/scrims/[id]/page.tsx | `routes.scrim(id)` — 카드(scrim-card.tsx:36), 작성 성공 `router.push` |
| /members/[id] | app/(main)/members/[id]/page.tsx | 상세 참가자 닉네임 `routes.member(id)` |
| /steam-link/complete | app/steam-link/complete/page.tsx(그룹 밖) | API 콜백 302(`STEAM_LINK_COMPLETE_PATH`, steam-link.service.ts:80), 목, 「설정으로 돌아가기」 `routes.settings(q)` |

- S2 화면 파일에 문자열 하드코딩 링크 없음. middleware matcher(middleware.ts:26)는 `steam-link/`만 추가로 제외.

### 7. Prisma 스키마·마이그레이션 ↔ 서비스 쿼리

| 항목 | 결과 |
| --- | --- |
| migration.sql = migrate diff(7016593 → 현재) | 같다(위 명령) |
| `DROP INDEX "game_accounts_one_primary_per_user_game"` | 없음. S1 부분 고유 인덱스 유지 |
| Prisma enum `scrim_cancel_reason`(host·admin·not_started) ↔ shared `ScrimCancelReason` | 같다 |
| games capacity 3열 기본값(2/16/8) + 수동 UPDATE(lol 10/10/10, tft 2/8/8) ↔ `GAME_SEED`(games.ts:41-67: lol 10/10/10, tft 2/8/8, steam 2/16/8) ↔ seed.ts:19-21 upsert | 같다 |
| scrims 새 열 6개 ↔ 서비스 사용 | rated·autoBalance·usePositions(create :187-189, update :240-241), startedAt(start·auto-close), cancelledAt·cancelReason(cancel·auto-close) |
| 인덱스 사용 | 목록 `(status, scheduled_at)`·`(game_id, status, scheduled_at)`, 참가자 `(scrim_id, status)`, 노쇼 `(user_id, status, no_show_marked_at)`, 중복 방지 `(scrim_id, user_id)` UNIQUE |
| 롤 정원 / 포지션 | 10 ÷ 5포지션 = 2 → `computeOpenPositions` 동작. tft는 has_positions false |

### 8. env·config 일치 (계약 11절 8개)

| 변수 | shared 기본값 상수 | env.ts 검증 | AppConfig | .env.example | 사용처 |
| --- | --- | --- | --- | --- | --- |
| REFRESH_ROTATE_AFTER_HOURS | 24(auth.ts:25) | nonNegInt | refreshRotateAfterHours | 24 | refresh-token.service.ts:77 |
| SCRIM_SCHEDULE_MAX_DAYS_AHEAD | 30 | posInt | scrim.scheduleMaxDaysAhead | 30 | scrims.service.ts:143 (웹은 상수 — 결함 3) |
| SCRIM_AUTO_CLOSE_AFTER_MIN | 60 | posInt | scrim.autoCloseAfterMin | 60 | scrim-auto-close.ts:41, 75 (웹 문구 — 결함 3) |
| SCRIM_JOBS_ENABLED | (true) | strictBool | scrim.jobsEnabled + `scrimJobsEnabledFromEnv` | true | ScrimsModule.forRoot, vitest false |
| SCRIM_NO_SHOW_THRESHOLD / WINDOW_DAYS / RESTRICTION_DAYS | 3 / 30 / 7 | posInt | scrim.noShow | 3 / 30 / 7 | scrim-restriction.service.ts (웹 문구 — 결함 3) |
| SCRIM_NO_SHOW_MARK_WINDOW_DAYS | 7 | posInt | scrim.noShowMarkWindowDays | 7 | setNoShow :399, viewer :231 (웹 문구 — 결함 3) |

API 쪽 8개는 모두 일치한다. Railway는 값을 넣지 않아도 기본값으로 동작한다.

### 9. 인증 보완 (교차 확인)

- 9-1: `rotateAfterMs > 0 && now − created_at < rotateAfterMs` → `kept`(DB 쓰기 없음), 컨트롤러는 `rotated`일 때만 Set-Cookie. 폐기 토큰 처리(유예·재사용 감지·D26)가 주기 판단보다 먼저. 웹은 Set-Cookie를 읽지 않음(client.test.ts). auth e2e D73 5건 통과.
- 9-2: shared `STEAM_LINK_COMPLETE_PATH` = API 302 도착지 = 웹 라우트 = middleware 제외. `SteamLinkDisplay`가 요청 → 쿠키 payload → return_to(state 먼저, `&display=popup`)로 이어지고, 검증 기준 return_to는 쿠키 display로 만든다(쿼리 변조 → STEAM_OPENID_INVALID). 웹 리스너는 origin 검사 + `SteamLinkPopupMessage.safeParse` + 첫 메시지만. 완료 페이지는 API 호출 없음.

## 이전 결함 재확인

| 출처 | 결함 | 상태 |
| --- | --- | --- |
| web 3 | 「더 보기」 실패 문구가 NETWORK_ERROR 고정 | **해소.** scrims-view.tsx:144-148 `isApiError(list.error) ? errorMessage(list.error.code) : errorMessage('NETWORK_ERROR')`, 첫 페이지 오류(:110)와 같은 처리 |
| web 4 | 카운트다운 0초 뒤에도 참가 버튼 남음 | **해소.** scrim-detail.tsx:90-98 `useJoinClosed`가 시작 시각 도달 시 화면을 마감 상태로 바꾸고(Hero 카운트다운 → 「시작 시각이 지났어요」, JoinControls → 마감 안내) `refetch()`를 1번 부른다. `refetch`는 react-query observer의 고정 참조라 반복 호출 루프 없음. HostMenu·수정 대화상자에도 덮어쓴 `join_closed`가 전달된다. 다만 클라이언트 시계가 빠를 때의 부작용은 새 결함 4 |
| web 5 | 기한 지난 「노쇼 표시」가 비활성으로 노출 | **해소.** scrim-detail.tsx:419-424 `s.viewer.can_mark_no_show &&`일 때만 렌더. 「노쇼 정정」은 서버가 기한을 두지 않으므로(scrims.service.ts:407-413) 계속 노출 — 계약 8절 「no_show → 노쇼 정정(항상)」과 같다 |
| web 1·2 | 목의 core 규칙 복사, 목 판정 순서 | 리더 결정으로 유지(목 전용). 이번 대조에서 실제 API 경로 영향 없음 |
| backend 1 | 자동 마감이 커넥션 2개 필요 | 열린 상태(운영 메모 수준). 배포 `DATABASE_URL`에 `connection_limit=1`을 두지 말 것 |
| backend 2 / core 2 | `last_no_show_at`이 37일 밖이면 null | 계약 변경 이력 2행에 반영됨. 화면은 이 값을 쓰지 않는다. 계약 5-6·7절 본문 문구는 아직 옛 표현(아래 문서 갱신 목록) |
| backend 3 | ScheduleModule 중복 등록 테스트 삭제됨 | **해소.** `apps/api/test/schedule-dedupe.spec.ts` 추가, 이번 실행에서 통과(api Test Files 22) |
| backend 4 | 계약 12절 「9개」 | **해소.** 계약 12절이 「7개 변경 경로」로 고쳐짐 |
| core 1 | open_positions 합계 > 빈 자리 | 열린 상태 → 이번 결함 2(화면 노출 확인) |
| core 3·4 | 숫자 인자 미검사, lookback 테스트 기본 정책만 | 열린 상태(env 검증이 막고, QA 무작위 대조 불일치 0). 결함 목록에는 다시 올리지 않음 |

## 명세 대조 (문서 2·5·6·7-4·8장)

| 장 | 명세 항목 | 구현 | 차이(계약 D번호) |
| --- | --- | --- | --- |
| 2장 | 내전·모집글(P0): 게임·인원·시작 시간·규칙으로 작성 | 구현됨 | 제목(5장 컬럼)·진행 방식 3개 추가(D77), 수정·모집 취소(D80), 시작 수동 + 60분 뒤 자동 마감(D78), 롤 10 고정·롤체 2–8·스팀 2–16(D76), 시작 시각 미래 30일 안(메인 기본값 2) |
| 2장 | 내전·참가 관리(P0): 참가, 대기, 취소, 포지션 선택, 정원 마감 처리 | 구현됨 | 1지망 필수·2지망 선택(D82), 이미 참가 중이면 POST가 포지션 변경(D81), 시작 시각에 참가·취소 마감(D92), 방장 취소 불가(D94), 정원을 참가 인원 아래로 못 줄임(D79), 시작 후 대기열 유지(D95) |
| 2장 | 팀 자동 밸런스·결과 입력·승인(P0) | S3(상세에 빈 상태 카드, `balance`·`result` = null) | 누락 아님(슬라이스 제외) |
| 5장 | scrims(game_id, host_id, title, scheduled_at, capacity, status, rules), status 5개 | 있음 | 추가 열 rated·auto_balance·use_positions·started_at·cancelled_at·cancel_reason(D77, D78, D80), games 정원 3열(D76) |
| 5장 | scrim_players(scrim_id, user_id, status, position, team), status 4개 | 있음 | S0부터 preferred_positions·joined_at·no_show_marked_at·_by. 대기 순번 = (joined_at, id)(D85) |
| 5장 | 인덱스 `scrim_players(scrim_id, status)` | 있음 | - |
| 6장 | `GET /scrims?game=&status=` | 구현됨 | `status`는 상태값이 아닌 탭(open·playing·ended) + cursor·limit, 탭 개수 없음(D86) |
| 6장 | `POST /scrims`, `GET /scrims/{id}` | 구현됨 | POST 201 ScrimDetail, 상세에 viewer·대기열 |
| 6장 | `POST, DELETE /scrims/{id}/join`, 정원 초과 시 대기열 | 구현됨 | POST 본문 필수·멱등 포지션 변경, DELETE도 200 + ScrimDetail(D81, D87) |
| 6장 | (없음) | 추가 | `GET /games`(D75), `PATCH /scrims/{id}`·`POST /start`·`POST /cancel`(D78, D80), `PUT /scrims/{id}/players/{userId}/no-show`(D83), `GET /me/scrim-restriction`(D84) |
| 7-4 | 운영진이 **내전 종료 후** 노쇼 표시 → 30일 안 3회면 7일간 **모집 참가** 제한 | 구현됨 | 표시 가능 상태 = playing·finished(종료 전 진행 중에도 가능), 시작 후 7일 안에만 표시·정정은 기한 없음, 기준 시각 = 표시 시각, 24시간 이동 구간, 발동 노쇼마다 7일(가장 늦은 것 기준), 제한 범위 = 새 참가·대기 등록·**모집글 작성**(사용자 결정), 기존 참가는 유지, 값은 env(D83, D84, 메인 기본값 1) |
| 8장 | `/scrims`: 게임별 필터, 모집 중·마감 구분, 참가 인원 표시 | 구현됨 | 「모집 중·마감」 대신 「모집 중 / 진행 중 / 종료」 탭(정원 마감은 모집 중 탭 안 배지)(D86), 카드 버튼은 모두 상세 이동(D91), 노쇼 제한 배너 |
| 8장 | `/scrims/new`: 게임, 시작 시간, 정원, 규칙 | 구현됨 | 제목, 진행 방식 토글 3개, 방장 희망 포지션(D77, D82), KST 입력 |
| 8장 | `/scrims/[id]`: 참가자 슬롯, 포지션 선택, 팀 밸런스 결과, 결과 입력 | 슬롯·포지션 선택 구현, 밸런스·결과는 빈 상태(S3) | 진행 단계·방장 메뉴(수정·시작·모집 취소)·대기열·운영진 노쇼 버튼 추가(D90, 계약 6절) |
| (슬라이스) | 인증 보완: 리프레시 하루 1회 회전, 스팀 팝업 | 구현됨 | D73, D74. 명세 문서에는 해당 절이 없어 계약에만 기록 |

S2 범위 P0(2장 모집글·참가 관리, 7-4, 8장 내전 화면 3개) 중 누락은 없다.

## 미실행 (통과로 보지 말 것)

| 항목 | 이유 | 준비된 테스트 |
| --- | --- | --- |
| 마지막 자리 동시 참가 `Promise.all(10)`, 동시 취소+참가·정원 확대+참가 불변식, 시작+모집 취소 경쟁, 자동 마감 동시 실행 1회, 잠금 SQL(`::uuid`, `status::text`) 실제 실행 | PostgreSQL·Docker 없음 | `test/db/scrims.db.e2e.spec.ts`(6건, skip) |
| 동시 refresh 24시간 경계, 회전 DB 기록 | 같음 | `test/db/auth.db.e2e.spec.ts`(6건, skip) |
| 마이그레이션 `20261029120000_s2` 실제 적용, 수동 UPDATE 반영 | 같음 | 없음(diff 대조로 대신함) |
| 자동 마감 cron 실제 주기 실행(Asia/Seoul) | DB 없음 | e2e(인메모리)·schedule-dedupe |
| 브라우저 렌더(데스크톱·모바일 × 라이트·다크), 팝업 차단 수동 절차, 스팀 실제 왕복 | 브라우저 미사용·키 필요 | frontend 보고서 수동 절차, 빌드·정적 검사로 대체 |

## 명세 문서 갱신 필요 목록 (S2분)

1. 2장 내전·모집글: 제목, 진행 방식 3개(시즌 ELO 반영·팀 자동 밸런스·포지션 희망 받기), 방장 수정, 방장·운영진 모집 취소·시작, 시작 시각 + 60분 자동 마감, 게임별 정원 범위(롤 10 고정, 롤체 2–8, 스팀 2–16), 시작 시각 30일 안(D76–D78, D80).
2. 2장 내전·참가 관리: 1지망·2지망(1지망 필수), 대기 1번 자동 승격(희망 포지션 유지), 시작 시각에 참가·취소 마감, 방장 취소 불가, 정원 축소 하한 = 참가 인원(D79, D81, D82, D92, D94, D95).
3. 5장: games `capacity_min/max/default`, scrims `rated/auto_balance/use_positions/started_at/cancelled_at/cancel_reason`, scrim_players `preferred_positions/joined_at/no_show_marked_at/no_show_marked_by`(D76, D77, D80, D83).
4. 6장: `GET /scrims`의 `status`는 탭(open·playing·ended) + `cursor`·`limit`, `POST /join` 본문 필수·멱등 포지션 변경, `DELETE /join` 200 + 상세, 추가 경로 6개(`GET /games`, `PATCH /scrims/{id}`, `POST /scrims/{id}/start`, `POST /scrims/{id}/cancel`, `PUT /scrims/{id}/players/{userId}/no-show`, `GET /me/scrim-restriction`)(D75, D78, D80, D81, D83, D84, D86, D87).
5. 7-4: 표시 시점 「내전 종료 후」 → 진행 중·종료 내전, 시작 후 7일 안(정정은 기한 없음). 기준 = 표시 시각, 24시간 이동 구간. 제한 = 새 참가·대기 등록·모집글 작성(기존 참가 유지). 해제 = 제한을 일으킨 가장 늦은 노쇼 + 7일. 값은 환경 변수(D83, D84).
6. 8장 `/scrims`: 「모집 중·마감 구분」 → 모집 중 / 진행 중 / 종료 탭, 카드 버튼은 상세로 이동(D86, D91).
7. 8장 `/scrims/new`: 제목·진행 방식·방장 희망 포지션 입력 추가(D77, D82).
8. 8장 `/scrims/[id]`: 진행 단계 표시, 방장·운영진 메뉴, 운영진 노쇼 표시·정정 버튼(D90).
9. (보안·인증 절이 생기면) 리프레시 토큰 하루 1회 회전, 스팀 연동 팝업(D73, D74).

계약 문서 안에서 맞출 것(구현 영향 없음): 5-6·7절의 `lastNoShowAt` 설명을 「조회 범위(window + restriction일) 안의 마지막 노쇼, 없으면 null」로(변경 이력에만 있음), 4절 표에 `POST /join` 본문 필수 명시, 8절 제한 배너 문구(결함 1), 12절 보고서 파일명(실제 `02_domain-logic-dev_report.md`·`02_backend-dev_scrims.md`·`02_frontend-dev_scrims.md`).
