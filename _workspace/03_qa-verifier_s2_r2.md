# QA: s2 재검증 r2 (결함 s2-1~3 수정 D99–D102 + 리더 수정분) — 판정: pass

작성: qa-verifier, 2026-10-30
대상: 작업 트리 미커밋 변경 18개 파일(shared `scrims.ts`·`contract.s2.test.ts`, core `scrim.ts`·`scrim.test.ts`·dist, api `scrim-restriction.service.ts`·`test/scrims.e2e.spec.ts`, web `lib/scrims.ts`·`lib/errors.ts`·`lib/api/mock/scrims.ts`·`components/scrims/scrim-detail.tsx`·`scrim-edit-dialog.tsx`·`scrim-new-form.tsx`·테스트 2개) + 커밋 7e8a573(노쇼 제한 기본 1일) + 리더 수정분(이전 s2 결함 4 `useJoinClosed`)
기준: 계약 `_workspace/01_architect_contract.md` 변경 이력 3·4행, 5-6·7·8·11·13(D99–D102)·15-1절, qa-boundary-check 「교차 대조」. 이전 보고서 `03_qa-verifier_s2.md`.
구현 보고: `02_domain-logic-dev_report.md`, `02_backend-dev_scrims.md`, `02_frontend-dev_scrims.md` 끝부분.
사용 가능 도구: Read, Grep, Glob, Bash(Git Bash), Write. 브라우저·스크린샷 도구는 쓰지 않았다.

## 실행한 명령과 결과 (2026-10-30, 순차 실행)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm -r typecheck` | shared·core·web·api 4개 Done, EXIT 0 |
| `corepack pnpm -r test` | shared **57** / core **155** / web **136** passed / api **345** passed, 27 skipped(DB e2e 4개 파일). Test Files api 23 passed / 4 skipped. EXIT 0 |
| `build` | 지시대로 실행하지 않음(리더 별도 실행) |
| core dist 확인 | `packages/core/dist/scrim.js:166` `return total > open ? [] : result;` — dist(10:17)가 src(10:16)보다 새것. api는 `@gcd/core` default = dist라 e2e D100 테스트가 실제 새 규칙을 탄다 |
| 무작위 대조 1(스크래치 스크립트, 코드 미수정) | core dist `computeOpenPositions` ↔ web 목 복사본(소스에서 함수 본문을 그대로 추출해 실행) 100,000회, positions 0–5개·정원 1–16·1지망에 null·`adc`·`zzz` 섞음 → **불일치 0, 불변식(합계 ≤ max(0, 빈 자리), count ≥ 1) 위반 0**, 비어 있지 않은 결과 6,121건 |
| 고정 사례 | 롤 10명 미드 9명 → core·목 모두 `[]`. 탑2·정글2·미드2·원딜1·서폿1 → `[bot 1, support 1]` |
| 무작위 대조 2 | `computeScrimRestriction` 전체 노쇼 vs `> noShowLookbackStart` 필터 50,000회(정책 3/30/1 절반 + 무작위 정책) → restricted·until·recentCount **불일치 0**. 3/30/1 조회 하한 = 31일(계약 변경 이력 4행과 같음) |
| `grep -rnE 'NO_SHOW_.*_DEFAULT\|SCRIM_(SCHEDULE_MAX_DAYS_AHEAD\|AUTO_CLOSE_AFTER_MIN)_DEFAULT' apps/web/src \| grep -v lib/api/mock/` | **0건** |
| `grep -rnE '[0-9]+ ?(일\|분\|회)'`(web, 테스트·목 제외) | 내전 관련 0건(나머지는 client 주석, 라이엇 rate limit 「1–2분」, 포맷 주석, 티어 문구 — S2 env 값 아님) |
| 내전 화면 숫자 리터럴 `30\|60\|7\|3\|1`(components/scrims, lib/scrims.ts, lib/errors.ts, hooks) | env 값으로 쓰인 리터럴 0건(초·분 변환 60, 월 +1, 단계 인덱스만) |

## 결함

blocker 0, major 0, minor 4.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/web/src/components/scrims/scrim-edit-dialog.tsx:118 | 계약 5-6 표 `scrim_policy.schedule_max_days_ahead` 웹 사용처 「작성·수정 폼 날짜 상한(`max`)·사전 검사 문구」, 8절 「수정 대화상자도 같다」. frontend 보고서도 「작성 폼·수정 대화상자: 날짜 `max`·사전 검사·문구 모두」라고 적음 | 수정 대화상자 날짜 입력에 `max`(그리고 `min`)가 없다. 사전 검사(:59-63)와 문구는 들어갔다. 작성 폼(scrim-new-form.tsx:288-289)에는 둘 다 있다 | 수정 대화상자에서 날짜 선택기를 열면 상한 뒤 날짜도 고를 수 있고, 제출 때 「30일 안의 시각만 고를 수 있어요.」로 막힌다. 데이터 영향 없음 |
| 2 | minor | apps/web/src/lib/scrims.ts:348-351(`restrictionPolicyText`, 목록·작성 배너 보조 문구, scrim-bits.tsx:121) | 배너 제목의 해제 시각과 보조 문구 규칙이 서로 맞는다(계약 5-6: until = **가장 늦은 발동** m + restriction) | 보조 문구가 「…마지막 노쇼부터 {restriction_days}일 동안…」이다. 마지막 노쇼가 발동이 아니면 제목의 until과 어긋난다. 계약 8절 예시 문구에는 「마지막 노쇼부터」가 없다. 기존 문구(이번 변경 밖)지만 restriction 1일이 되면서 차이가 쉽게 보인다 | core dist: 노쇼가 30.6일·30.4일·0.8일·0.2일 전, 정책 3/30/1 → `restricted: true, until = now + 4.8h`. 마지막 노쇼(0.2일 전) + 1일 = now + 19.2h. 배너는 「…10.31 01:48까지…」인데 보조 문구대로 계산하면 10.31 16:12 |
| 3 | minor | apps/web/src/components/scrims/scrim-detail.tsx:119-120(`useJoinClosed` 서버값 우선) ↔ :224-228, :273-277(Hero) | 서버가 아직 열려 있다고 하면 화면도 자연스럽게 열린 상태 | 클라이언트 시계가 빠를 때 재조회 응답이 `join_closed: false`면 참가·취소 버튼은 돌아오지만(정상), Hero는 `counting`(= open && !join_closed)이라 카운트다운을 계속 그리고, `remaining`이 음수라 `formatHms`가 0으로 잘라 「시작까지 00:00:00」이 다음 폴링(최대 20초)까지 남는다. 표시만의 문제 | PC 시계를 3분 빠르게, 시작 2분 전 상세 열기 → 즉시 마감 안내 → 재조회 후 버튼 복귀, 카운트다운 00:00:00 고정 → 서버 시각이 시작을 지난 다음 폴링에서 「시작 시각이 지났어요」 |
| 4 | minor | apps/web/src/lib/api/mock/scrims.test.ts:150-151 | 무작위 대조는 시드 고정(core 테스트 scrim.test.ts:386-418은 mulberry32 시드) | `Math.random()`을 써서 실패해도 같은 입력을 다시 만들 수 없다. 현재 규칙에서는 통과(내 100,000회 대조로 불일치 0 확인) | 테스트 코드 확인 |

## 검증 항목별 결과

### (1) 새 필드 3개 일대일 (shared ↔ api ↔ web 훅 ↔ 목)

| 필드 | shared 스키마(scrims.ts) | api 직렬화(scrim-restriction.service.ts) | web 파싱 | 웹 목(mock/scrims.ts:678-687) | 웹 사용처 | 일치 |
| --- | --- | --- | --- | --- | --- | --- |
| `policy.mark_window_days` | :570 `z.number().int().min(1)` 필수 | :67 `config.scrim.noShowMarkWindowDays`(env.ts:220 ← `SCRIM_NO_SHOW_MARK_WINDOW_DAYS`) | `getMyScrimRestriction` → `apiClient.request(ApiPath.myScrimRestriction, GetMyScrimRestrictionResponse)`(lib/api/scrims.ts:103) → `useMyScrimRestriction`(hooks/scrims.ts:106) | `NO_SHOW_MARK_WINDOW_DAYS_DEFAULT` | `noShowMarkHintText`(scrim-detail.tsx Roster, policy 있을 때만) | O |
| `scrim_policy.schedule_max_days_ahead` | :580 필수 int ≥ 1 | :71 `config.scrim.scheduleMaxDaysAhead`(env.ts:212) — 서버 검사(scrims.service.ts:146)와 같은 값 | 같음 | `SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT` | `scheduleMaxMs`·`scheduleMaxText`(작성 폼 max·사전 검사, 수정 대화상자 사전 검사) | O(수정 대화상자 max는 결함 1) |
| `scrim_policy.auto_close_after_min` | :582 필수 int ≥ 1 | :72 `config.scrim.autoCloseAfterMin`(env.ts:213) — cron(scrim-auto-close.ts)과 같은 값 | 같음 | `SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT` | `autoCloseHintText`(방장 메뉴) | O |

- 필드명 snake_case가 shared·api·목·웹에서 같다. 중간 camelCase 변환 없음.
- `ScrimRestriction.scrim_policy`가 필수라 api가 안 채우면 parse(500)인데, api가 제한 여부와 무관하게 항상 채운다. e2e: 제한 아님·제한 중 모두 값 확인(scrims.e2e.spec.ts:205-216), env 6개를 바꾸면 그대로 따라감(:229-248). shared 계약 테스트가 필드 누락·0·소수를 거부(contract.s2.test.ts:245-268).
- 목 테스트가 실제 클라이언트(zod)로 새 필드를 받고, 제한 아닐 때도 채움을 확인(mock/scrims.test.ts).

### (2) computeOpenPositions D100

- core(scrim.ts:156-179): 계약 7절 1)–5) 순서 그대로. `raw ≥ 1`만 더한 total과 `max(0, raw)` 합계는 같으므로 「Σ raw_p > open → []」와 동치.
- 웹 목 복사본(mock/scrims.ts:218-226): 같은 식, 무작위 100,000회 core와 불일치 0.
- api 목록·상세(scrim-views.service.ts:91-98): 모집 중 && use_positions일 때 core 결과 그대로, 1지망 = `preferred_positions[0] ?? null`, 입력은 joined 행 → open = capacity − joined(모집 중엔 no_show 없음 → `joined_count`와 같음). 목도 같은 입력(mock/scrims.ts:556-559).
- e2e 「mid 3명 → []」(scrims.e2e.spec.ts:327-339) 통과. 카드 `scrimNeedLine`(lib/scrims.ts:217-226)은 `[]`면 「N자리 남음」(N = capacity − joined_count) — 테스트 「1자리 남음」 통과. 계약 8절 「웹은 따로 자르지 않는다」와 같다.

### (3) 웹 env 값 하드코딩·문구 대조

grep 0건(위 명령 표). 계약 8절 문구 ↔ 화면:

| 계약 8절 | 화면(함수) | 일치 |
| --- | --- | --- |
| 배너 「노쇼가 누적되어 {until KST MM.DD HH:mm}까지 내전을 만들거나 참가할 수 없어요」, 횟수 없음 | `restrictionText` → `restrictionUntilText`(lib/scrims.ts:303-312) | O. `recent_no_show_count`를 Pick에서 제거, 화면 코드에서 이 필드 사용 0건 |
| 상세 제한 안내: 배너와 같은 문구, 조회 없을 때도 viewer.restricted_until로 | scrim-detail.tsx JoinControls `restrictionUntilText(restrictedUntil)` 하나로 | O |
| 작성: 「{schedule_max_days_ahead}일 안의 시각만 고를 수 있어요」, 조회 없거나 실패면 상한 검사 생략 | `scheduleMaxText`, `scheduleMaxMs`가 정책 없으면 null → max 속성 없음·검사 생략(scrim-new-form.tsx:108-111, 122-125) | O |
| 방장 메뉴 「시작 시각 {auto_close_after_min}분 뒤까지 시작하지 않으면 자동으로 정리돼요」 / 없으면 「시작 시각이 한참 지나도 시작하지 않으면 자동으로 정리돼요」 | `autoCloseHintText` | O |
| 노쇼 확인 대화상자 숫자 = policy, 없으면 「노쇼가 누적되면 일정 기간 내전 참가·모집이 제한돼요」 | `noShowRuleText(policy)` | O |
| 기한 안내 「시작 후 {policy.mark_window_days}일 안에만 표시할 수 있어요」 | `noShowMarkHintText` + 「정정은 언제든 할 수 있어요.」, policy 없으면 줄 자체를 숨김 | O |
| `ERROR_MESSAGES.SCRIM_NO_SHOW_NOT_ALLOWED`(D102) | errors.ts:52 문구가 계약과 글자 그대로 같고 숫자 없음(테스트로 고정) | O |
| 보조 규칙 문구(policy 값) | `restrictionPolicyText` 「마지막 노쇼부터」 | 결함 2 |

### (4) 이전 QA 재검증 없던 리더 수정분

| 출처 | 내용 | 상태 |
| --- | --- | --- |
| s2 결함 4 | `useJoinClosed` 서버값 우선(scrim-detail.tsx:105-121) | **해소.** 시작 시각 도달 → `passedAt` 기록 + `refetch` 1회 → `dataUpdatedAt > passedAt`인 응답이 `join_closed: false`면 서버값을 따른다. 시작 시각이 미래로 바뀌면 `passedAt` 초기화. `refetch`는 react-query 고정 참조라 루프 없음. 시계가 빠를 때 남는 표시 문제는 결함 3(표시만). `dataUpdatedAt`이 `passedAt`과 같은 ms면 서버값을 못 따르고 다음 폴링까지 막힌 채 남는다(`>` 엄격 비교) — 실제 네트워크에선 사실상 없음, 참고만 |
| web 3 | 「더 보기」 실패 문구 | **해소 유지.** scrims-view.tsx:110, 146 같은 식 |
| web 4 | 카운트다운 0초 뒤 버튼 | **해소 유지.** 위 `useJoinClosed`가 대체 |
| web 5 | 기한 지난 「노쇼 표시」 노출 | **해소 유지.** scrim-detail.tsx:483 `s.viewer.can_mark_no_show &&`일 때만, 「노쇼 정정」은 항상 |
| 7e8a573 | 노쇼 제한 기본 7 → 1일 | **확인.** shared `NO_SHOW_RESTRICTION_DAYS_DEFAULT = 1`(scrims.ts:40) → api env.ts:109 기본값 → `.env.example:84` = 1 → 명세 문서 196줄 「1일간」 → 계약 5-6·11절·D83 = 1. 표시 기한 7일 유지(env.ts:220, e2e :697). 조회 하한 31일·판정 동치 무작위 확인(위). 목 시드 노쇼 20일·9일·6시간 전 → until = 6시간 전 + 1일(목 테스트 통과). 확인 대화상자의 옛 `?? *_DEFAULT` 대체값은 이번 변경에서 제거됨 |

### (5) 수정 대화상자 상한 검사

- scrim-edit-dialog.tsx:35 `useRestriction().restriction?.scrim_policy`, :59-63 정책이 있고 시작 시각을 **바꿨을 때만** `Date.parse(iso) > now + N일`이면 `scheduleMaxText` 오류.
- 서버와 맞물림: `buildScrimPatch`(lib/scrims.ts:382)는 시작 시각이 바뀐 때만 `scheduled_at`을 보내고, 서버 `scheduleDetail`(scrims.service.ts:145-151)은 `validateScrimSchedule(…, config.scrim.scheduleMaxDaysAhead)`로 같은 경계(`> now + N일` → too_far)를 쓴다 → 바꾸지 않은 옛 시각이 env 축소로 상한 밖이어도 클라이언트·서버 모두 막지 않는다. 일치.
- 정책이 없으면(조회 전·실패) 검사 생략 → 서버 VALIDATION_FAILED details를 `scrimErrorText`가 보여 준다. 계약 D101과 같다.
- 빠진 것: 날짜 입력 `max`(결함 1).

## 이전 결함 재확인

| 출처 | 결함 | 상태 |
| --- | --- | --- |
| s2 1 | 배너 「노쇼 N회」가 제한 이유와 안 맞음 | **해소**(D99 문구, 횟수 제거, 테스트 `not.toMatch(/\d+회/)`) |
| s2 2 / core 1 | open_positions 합계 > 빈 자리 | **해소**(D100, core·목·api 3곳 일치, 무작위 불일치 0) |
| s2 3 | 웹 env 기본값 하드코딩 | **해소**(D101·D102, grep 0건). 수정 대화상자 `max` 누락만 결함 1로 남음 |
| s2 4 | `useJoinClosed` 시계 빠를 때 | **해소**(위 (4)). 표시 잔여는 결함 3 |

## 미실행 (통과로 보지 말 것)

| 항목 | 이유 |
| --- | --- |
| `corepack pnpm -r build` | 리더 지시로 제외 |
| DB e2e 4개 파일 27건 | PostgreSQL·Docker 없음(이전과 같음) |
| 브라우저 렌더(수정 대화상자 날짜 선택기, 배너, 방장 메뉴 문구) | 브라우저 도구 미사용. 코드·단위 테스트로 대신함 |
