# backend-dev 보고서 — S2 내전(scrims) + 인증 보완 2건

계약: `_workspace/01_architect_contract.md`(S2, D73–D96), 담당 배정 12절 backend 1–7.
Q1–Q3은 계약 현재 기본값(D78 자동 마감 60분, D76 롤 10 고정, D83 표시 시각 기준)대로 구현.

## 1. 구현 엔드포인트 (모두 `/api/v1`, JWT)

| 메서드 | 경로 | 권한 | 응답 |
| --- | --- | --- | --- |
| GET | /games | 멤버 | 200 ListGamesResponse |
| GET | /scrims | 멤버 | 200 ListScrimsResponse(탭 open/playing/ended, game, cursor, limit) |
| POST | /scrims | 멤버 | 201 ScrimDetail |
| GET | /scrims/:id | 멤버 | 200 ScrimDetail |
| PATCH | /scrims/:id | 방장 | 200 ScrimDetail |
| POST | /scrims/:id/join | 멤버 | 200 ScrimDetail(참가·대기·희망 포지션 변경) |
| DELETE | /scrims/:id/join | 멤버 | 200 ScrimDetail |
| POST | /scrims/:id/start | 방장·운영진 | 200 ScrimDetail |
| POST | /scrims/:id/cancel | 방장·운영진 | 200 ScrimDetail |
| PUT | /scrims/:id/players/:userId/no-show | 운영진(`@Roles('admin')` + RolesGuard) | 200 ScrimDetail |
| GET | /me/scrim-restriction | 멤버 | 200 GetMyScrimRestrictionResponse |

- 5-0 잠금: `src/common/scrim-lock.ts` `lockScrim()` = 트랜잭션 첫 문장 `SELECT … FROM scrims WHERE id = $1::uuid FOR UPDATE`. 사용처 7곳: 수정·참가·취소·시작·모집 취소·노쇼·자동 마감(건별). 작성은 새 행이라 잠금 없음.
- 상태 변경은 모두 `canTransition`(shared 맵) 검사 후(`assertScrimTransition`/`assertPlayerTransition`, 위반 시 INTERNAL_ERROR + 로그).
- 계산은 전부 `@gcd/core` 호출: validateScrimSchedule, isCapacityInRange, validatePreferredPositions, placeNewParticipant, statusForJoinedCount, planRosterAfterChange, orderWaitlist, canStartScrim, decideOverdueScrim, computeOpenPositions, isJoinClosed, isNoShowMarkWindowOpen, computeScrimRestriction, noShowLookbackStart.
- 직렬화: ScrimSummary/ScrimDetail/ListGamesResponse/GetMyScrimRestrictionResponse 모두 shared parse. 사용자는 ScrimUserRef(id·nickname·avatar_url)만.
- 자동 마감: `ScrimAutoCloser.runOnce()`(advisory xact lock `hashtext('scrim-auto-close')` → 대상 최대 100건 → 건별 트랜잭션 + 행 잠금 + decideOverdueScrim), `ScrimAutoCloseScheduler`(`*/5 * * * *` Asia/Seoul + 시작 시 1회, 기동을 막지 않음)는 `SCRIM_JOBS_ENABLED=true`일 때만 등록(`ScrimsModule.forRoot`).

## 2. 인증 보완

- 9-1(D73): `RefreshTokenService.rotate` — 미폐기·미만료 토큰이 `now − created_at < REFRESH_ROTATE_AFTER_HOURS`이면 `{kind:'kept'}`(DB 쓰기 없음). 0이면 매번 회전. 컨트롤러·AuthService는 `rotated`일 때만 Set-Cookie(기존 코드 그대로 동작).
- 9-2(D74): 요청 `display` → 쿠키 payload `display`(없으면 redirect, 옛 쿠키 호환) → `steamReturnTo(config, state, display)`(popup이면 `&display=popup`). 콜백 도착지: 유효한 쿠키의 display, 쿠키 없음·깨짐이면 쿼리 `display === 'popup'`일 때만 `/steam-link/complete`. 검증 기준 return_to는 쿠키 display로 만든다.
- env.ts: 11절 8개(REFRESH_ROTATE_AFTER_HOURS 0 이상 정수, SCRIM_* 양의 정수, SCRIM_JOBS_ENABLED 엄격 true/false) + `scrimJobsEnabledFromEnv()`.

## 3. 테스트 결과 (실제 실행)

- `corepack pnpm --filter api typecheck` 통과.
- `corepack pnpm --filter api test`: **Test Files 21 passed | 4 skipped (25), Tests 331 passed | 27 skipped (358)**. (S1 종료 시점 293 passed → +38)
  - 새 `test/scrims.e2e.spec.ts` 38개: 게임 목록, 작성(details 한 번에·30일 경계·적용값·SCRIM_BANNED Retry-After 정확값·본문 {code,message}), 제한 조회(정책·환경 변수), 목록(탭·정렬·게임 필터·커서 페이징·다른 탭/깨진 커서 400·my_status·open_positions), 참가(joined→full→waitlist·잠금 호출 확인·재참가 맨 뒤·포지션 변경 멱등·포지션 검증 3종·JOIN_CLOSED·제한 중 새 신청 403/포지션 변경·취소 허용/취소 후 재참가 403·404/400/401), 취소(대기 1번 승격·포지션·joined_at 유지·full→recruiting·방장 409·멱등), 수정(축소 409·확대 승격+상태·미루기로 join_closed 해제·비방장/운영진 403·범위 400·rules 지움·auto_balance 적용값·NOT_RECRUITING), 시작(롤 9명 409·롤체 1명 409·2명 playing·대기열 유지·운영진 가능·멤버 403), 모집 취소(host/admin·403·이후 409), 노쇼(FORBIDDEN이 NOT_FOUND보다 먼저·시작 전 409·표시/멱등/정정·방장 대상·대기자 409·기록 없음 404·기한 정각 허용/+1ms 409·정정 기한 없음·3회 표시 → 제한), 자동 마감(start/cancel not_started/59분 유지/advisory 실패 시 무동작/환경 변수/재판정 null), 모듈 등록(D96), 스케줄러 오류 삼킴. 모든 응답에서 `email|discord` 문자열 없음 확인.
  - auth.e2e: D73 describe 5개 추가(24시간 미만 미회전·DB 불변, 정확히 24시간 회전·Max-Age, 유예/REUSED, 로그아웃 후 INVALID, 미회전 토큰 절대 만료). 기존 회전 테스트는 `REFRESH_ROTATE_AFTER_HOURS=0`으로 S0 동작 검증 유지.
  - refresh-token.service.spec: kept/rotated 경계, 동시 refresh 24시간 경계, 0이면 항상 회전.
  - sync-and-steam.e2e: 팝업 10개(return_to 형식·쿠키 payload, 성공/오류 → 완료 페이지, 쿠키 없음+쿼리 popup → STATE_INVALID 완료 페이지, 쿠키 우선, display 변조 → STEAM_OPENID_INVALID, 옛 쿠키 호환, 잘못된 display 400). 기존 S1 redirect 테스트 그대로 통과.
  - env.spec: S2 기본값·검증 3개.
- `ScheduleModule.forRoot()` 중복 import(JobsModule + ScrimsModule 둘 다 켜짐) 시 cron이 두 번 등록되지 않음을 임시 테스트로 확인(삭제함).

## 4. 미실행 테스트 (PostgreSQL·Docker 없음 — 통과 아님)

- `test/db/scrims.db.e2e.spec.ts`(6개, 작성만): 마지막 자리 동시 참가 Promise.all(10) → joined = capacity·나머지 waitlist·순번 중복 없음, 동시 취소+참가 불변식, 동시 정원 확대+참가 불변식, 동시 시작+모집 취소 한쪽만 성공, 자동 마감 동시 실행 1회만, 잠금 SQL(uuid 캐스팅·enum ::text) 실제 동작.
- `test/db/auth.db.e2e.spec.ts`: 회전 테스트 3개에 created_at을 24시간 전으로 옮기는 `ageTokens()` 추가, 24시간 미만 미회전 1개 추가, 동시 refresh를 24시간 경계로 변경. 미실행.
- 마이그레이션 `20261029120000_s2` DB 적용도 미실행(architect 작성분, 변경 없음).

## 5. 남은 문제·계약과 다른 점(리더 확인 요청)

1. **목록 집계 방식**: 계약 4-1은 「status별 groupBy + 요청자 행 1회 조회」인데, 페이지 내전 id IN으로 `scrim_players`(joined·waitlist·no_show) 한 번 조회해 개수·1지망·my_status를 함께 계산했다. N+1 없음, 쿼리 수는 더 적다(행 수 ≤ limit × (정원+대기)). 계약 문구를 이 방식으로 바꿔도 되는지 확인 요청.
2. `last_no_show_at`: 조회 범위(window + restriction = 37일) 밖의 노쇼는 보지 않아 null일 수 있다(logic 안내대로 별도 조회 안 함). 계약 5-6 문구에 명시 요청.
3. `ScrimsModule`이 `ScheduleModule.forRoot()`를 직접 import한다(JobsModule은 SYNC_JOBS_ENABLED=true일 때만 import하므로). 중복 등록 없음 확인함.
4. `viewer.preferred_positions`는 joined·waitlist일 때만 값, no_show면 `[]`(shared 주석 「참가·대기 중일 때」 해석).
5. `joined_count`는 항상 joined + no_show로 계산(모집 중엔 no_show 행이 없어 계약과 같은 값).
6. `POST /join`에 본문이 없으면 VALIDATION_FAILED(shared 주석 「본문은 항상 객체」). 웹은 `{}`를 보내야 한다.
7. FakePrisma 한계: 행 잠금·격리 수준은 흉내 내지 않고 트랜잭션 직렬화로 대체, 중첩 트랜잭션(자동 마감)은 바깥 트랜잭션 흐름에서 바로 실행. 동시성 보장은 DB e2e로만 확인 가능(미실행).
8. 보고서 파일명: 계약 12절은 `02_backend-dev_s2.md`, 리더 지시는 `02_backend-dev_scrims.md` → 리더 지시를 따름.
9. `prisma generate`를 실행해 클라이언트를 새 스키마로 갱신했다(스키마 파일은 수정 안 함).

## 6. 변경 파일

- 새로: `apps/api/src/common/scrim-lock.ts`, `apps/api/src/modules/games/{games.controller,games.module,games.service}.ts`, `apps/api/src/modules/scrims/{scrims.controller,scrims.module,scrims.service,scrim-views.service,scrim-restriction.service,scrim-cursor,scrim-auto-close}.ts`, `apps/api/test/scrims.e2e.spec.ts`, `apps/api/test/db/scrims.db.e2e.spec.ts`
- 수정: `apps/api/src/app.module.ts`, `src/config/env.ts`·`env.spec.ts`, `src/modules/auth/refresh-token.service.ts`, `src/modules/game-accounts/{steam-link-cookie,steam-link.service,game-accounts.controller}.ts`, `apps/api/vitest.config.ts`(SCRIM_JOBS_ENABLED=false), `test/support/fake-prisma.ts`(scrims·scrim_players·games 정원·user.findMany·$queryRaw·중첩 트랜잭션), `test/auth.e2e.spec.ts`, `test/refresh-token.service.spec.ts`, `test/sync-and-steam.e2e.spec.ts`, `test/db/auth.db.e2e.spec.ts`
- auth.controller.ts·auth.service.ts는 변경 불필요(이미 `refresh`가 있을 때만 Set-Cookie).

## 수정 이력

| 날짜 | 지적 | 수정 | 결과 |
| --- | --- | --- | --- |
| 2026-10-29 | QA minor 3: 임시로 확인 후 지운 ScheduleModule 중복 등록 검사를 정식 테스트로 | `apps/api/test/schedule-dedupe.spec.ts` 추가: `JobsModule.forRoot({SYNC_JOBS_ENABLED:'true'})`·`ScrimsModule.forRoot({SCRIM_JOBS_ENABLED:'true'})`의 실제 `imports`를 두 모듈에 각각 넣고, 이름 붙인 cron 2개가 SchedulerRegistry에 1번씩만 있는지 확인(중복이면 이름 충돌로 실패) | typecheck 통과, `corepack pnpm --filter api test` Test Files 22 passed \| 4 skipped (26), Tests 332 passed \| 27 skipped (359) |

(3절의 「임시 테스트로 확인(삭제함)」은 이 정식 테스트로 대체됨)
| 2026-10-30 | 계약 15-1(D99–D102): shared `GetMyScrimRestrictionResponse`에 필수 필드 `policy.mark_window_days`·`scrim_policy`가 추가되어 `GET /me/scrim-restriction`이 parse 실패(500) | `scrim-restriction.service.ts` `getMine`: `policy.mark_window_days = config.scrim.noShowMarkWindowDays`, `scrim_policy = { schedule_max_days_ahead: config.scrim.scheduleMaxDaysAhead, auto_close_after_min: config.scrim.autoCloseAfterMin }`(제한 여부와 무관하게 항상). D102: api는 shared `ERROR_MESSAGES`를 쓰지 않고 자체 문구(`app-error.ts` 「노쇼를 표시할 수 없는 상태입니다.」)에 숫자가 없어 변경 없음. 테스트(`test/scrims.e2e.spec.ts`): 기본값 응답 전체 비교에 새 필드 추가, 제한 중에도 같은 정책 값, env 6개 변경 시 응답이 따라감(제한 아님), D100 open_positions(mid 1지망 3명 → 합계 8 > 빈 자리 7 → `[]`) 추가 | typecheck 통과, `corepack pnpm --filter api test` Test Files 23 passed \| 4 skipped (27), Tests 345 passed \| 27 skipped (372). skipped는 DB e2e(PostgreSQL 필요, 미실행). D100 테스트는 core의 새 `computeOpenPositions` 반영 후 통과 |
