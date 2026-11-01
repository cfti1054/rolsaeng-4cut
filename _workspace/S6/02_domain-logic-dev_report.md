# domain-logic-dev 보고서 — S6 core (계약 14절·18절 logic)

## 함수 (14개, 시그니처 계약 그대로)

| 파일 | 함수 |
| --- | --- |
| `packages/core/src/result-review.ts`(새) | `inferRevertOutcomes`, `revertBlockReason`, `planRatingRevert`, `disputeBlock` + 타입 `RatingOutcome`, `RevertHistoryRow`, `RevertRatingRow`, `DisputeBlock` |
| `packages/core/src/season.ts`(추가) | `seasonPhase`, `seasonEditable`, `validateSeasonWrite`, `validateSeasonDelete` + 타입 `SeasonPhase`(= shared `AdminSeasonPhase`), `SeasonWriteIssue` |
| `packages/core/src/admin.ts`(새) | `planRoleChange`, `adminMemberStatus` |
| `packages/core/src/no-show.ts`(추가) | `previewNoShowRestriction` |
| `packages/core/src/news.ts`(새) | `newsSubtitle`, `resolveEventsRange`, `dashboardNewsWindow` |

`index.ts` export 추가, `packages/core/dist` 재빌드(14개 모두 `require` 확인). core에 새 상수 없음 — 테스트는 `@gcd/shared` 상수(`SCRIM_RESULT_REVERT_WINDOW_DAYS`, `SCRIM_DISPUTE_WINDOW_DAYS`, `SEASON_*`, `DASHBOARD_NEWS_*`, `NO_SHOW_*_DEFAULT`, `SCRIM_ELO_*_DEFAULT`)를 쓴다.

## 테스트

- 새 파일: `src/result-review.test.ts`, `src/season-admin.test.ts`, `src/admin-news.test.ts`.
- `corepack pnpm exec vitest run`(packages/core): **13 files, 509 passed**(기준선 418 → +91, 실패 0).
- `corepack pnpm -r typecheck`: shared·core·web·api 모두 Done.
- 14-6 필수 경우 전부 포함. 왕복 테스트 3개: 팀 1(노쇼·팀 없음 섞인 8명 → selectRatedParticipants → computeTeamEloUpdates), 개인 2(1위 노쇼 롤체 8명 / 동순위 입력 순서 4명 → computePlacementEloUpdates). outcome 일치 + planRatingRevert로 승인 전 ratings(elo·wins·losses)로 정확히 복귀까지 확인.

## 해석 (계약에 명시가 없어 가장 단순하게 정한 것)

1. **inferRevertOutcomes 개인**: placements에 같은 user가 여러 번이면 첫 항목만 쓴다(S3 `selectRatedParticipants`와 같게 해야 왕복이 맞음). rated user의 placement가 유한한 숫자가 아니면 null. ratedUserIds가 비면 빈 Map(null 아님).
2. **planRatingRevert**: ratings 입력에 같은 userId 행이 둘 이상이면 그 user 실패(rating_mismatch). 실패 userIds는 중복 없이 history 순서. 이력이 비면 `{ ok: true, updates: [] }`.
3. **revertBlockReason·disputeBlock**: windowDays가 음수·NaN이면 RangeError. disputeBlock에서 pending은 approvedAt 값이 들어와도 기한을 보지 않는다.
4. **validateSeasonWrite**
   - 생성(target null)은 `changed`를 무시하고 두 필드 모두 바뀐 것으로, 단계는 upcoming으로 본다.
   - lead(`starts_at ≥ now + lead`)는 「생성 또는 upcoming에서 starts_at을 바꿀 때」만 검사한다. 계약 문구 「생성·upcoming 수정」을 문자 그대로 읽으면 이름만 바꾸거나 끝만 바꿔도 검사하게 되어, 30분 뒤 시작하는 시즌의 이름을 바꿀 수 없게 된다. 그래서 이렇게 해석했다.
   - 길이·`ends > starts`·겹침은 기간(starts/ends)이 하나라도 바뀔 때만 본다. 이름만 바꾸면 `[]`.
   - `ends ≤ starts`면 invalid 1개만 낸다(길이 문구를 겹쳐 내지 않음). 길이는 양끝을 포함한다(정확히 7일·366일 허용).
   - not_editable이 있어도 invalid·overlap을 계속 계산해 모두 돌려준다(계약 「반환 순서」). 서버는 첫 종류만 응답한다.
   - invalid `message`는 한국어 고정 문구다. 구체 값(1시간, 7–366일)은 넣지 않았고, 화면 문구는 서버·웹이 정한다.
   - policy 값이 음수이거나 max < min이면 RangeError.
5. **planRoleChange**: adminCount 검증(RangeError)을 noop 판정보다 먼저 한다. 강등 = `currentRole === 'admin' && nextRole !== 'admin'`. adminCount 0(데이터 이상)에서 강등하면 ADMIN_LAST_ADMIN.
6. **previewNoShowRestriction**: 이미 제한 중이면 `newlyRestricted: false`이고, `until`은 표시 후 값(연장된 해제 시각)이다.
7. **newsSubtitle**: 「첫 줄(앞뒤 공백 제거)」을 「전체를 trim → \r\n·\r·\n 기준 첫 줄 → 다시 trim」으로 읽었다. 그래서 앞쪽 빈 줄은 건너뛴다. max가 정수가 아니면 RangeError. text가 null이어도 max 검사는 먼저 한다.
8. **resolveEventsRange**: 입력 날짜 형식이나 실재하지 않는 날짜(2026-02-30)는 RangeError. 둘 다 있으면 그대로 돌려준다(순서·92일 검증은 하지 않음 — shared 담당).
9. **dashboardNewsWindow**: 일수가 0 이상 정수가 아니면 RangeError.

## 계약 모호·충돌 (변경하지 않음, 확인 요청)

- 14-2 `validateSeasonWrite`의 lead 적용 범위(해석 4-2). backend·frontend가 「upcoming이면 이름만 바꿔도 lead 검사」를 기대한다면 알려 달라.
- 14-6 revertBlockReason 「승인자 본인(= actor)이어도 제출자가 아니면 null」: 함수 입력에 승인자 id가 없다. 그래서 「제출자만 본다」를 테스트로 고정했다(시그니처 그대로).
- 계약 14-6 표의 테스트 파일 위치는 지정이 없다. 기존 관례(`src/*.test.ts`, vitest include)를 따랐다(`packages/core/test/` 아님).

## 호출 측 참고

- `apps/api/src/modules/news/news.service.ts`, `scrims/scrim-views.service.ts`가 이미 새 함수를 import한다. 전체 typecheck는 통과한다.
- 커밋하지 않았다.

---

## 캘린더 (S6 후속, 계약 14-7·23-7 logic, D285)

### 구현

| 파일 | 내용 |
| --- | --- |
| `packages/core/src/calendar.ts`(새) | `calendarMonthRange(month)`, `resolveCalendarMonth(month, now)` — 시그니처는 14-7 그대로 |
| `packages/core/src/calendar.test.ts`(새) | 16개 |
| `packages/core/src/index.ts` | 146줄 export 추가, 머리 주석 S6 줄에 「커뮤니티 캘린더 구간(calendar.ts)」 |
| `packages/core/dist` | 재빌드. `require('dist/index.js').calendarMonthRange('2026-11')`가 나오는 것 확인 |

- 날짜 계산은 `news.ts`와 같은 방식(달력 날짜 = UTC 자정 ms, `DAY_MS` 더하기, `toISOString().slice(0, 10)`)으로 했다. news.ts에서 export한 것은 없다.
- `fromAt = (from의 UTC 자정) − KST_OFFSET_MS`, `toBefore = (to의 UTC 자정) + DAY_MS − KST_OFFSET_MS`(config.ts 상수).
- 형식 검사는 `@gcd/shared` `CalendarMonth.safeParse`를 쓴다. 정규식을 따로 만들지 않았고 core에 새 상수도 없다.
- core 함수 합계 15개(13 + 2).

### 테스트

- `corepack pnpm exec vitest run`(packages/core): **14 files, 516 passed**, 실패 0. core typecheck 통과. `-r typecheck`: shared·core·api 통과. web 실패 1건은 `admin-results.tsx`가 아직 없는 `community-calendar` 파일을 import해서다(frontend 작업 중, core와 관계없음).
- 14-7 필수 경우를 모두 넣었다.
  - 2026-11 → 10-26 ~ 12-06(42일)
  - 2027-02 → 02-01 ~ 02-28(28일)
  - 1일이 월요일(2026-06), 말일이 일요일(2026-05)
  - 연 넘김: 2026-12 → to 2027-01-03, 2027-01 → from 2026-12-28
  - 윤년 2028-02(말일 29일, to 03-05)와 2000-02
  - fromAt·toBefore가 UTC 전날 15:00
  - now 10-31T15:00Z → '2026-11', 14:59:59.999Z → '2026-10', KST 연 넘김
  - 형식 오류 10종 + 문자열이 아닌 값 → RangeError
- 추가로 2000-01 ~ 2099-12의 1200개 달을 모두 확인했다. 매달 월요일 시작·일요일 끝, 길이는 28·35·42 중 하나이고 세 길이가 모두 나온다. 1일·말일이 격자 안에 들고, fromAt·toBefore는 KST 자정이다.
- **웹 `monthGrid`와 같은 구간인지 확인했다.** 웹 테스트 파일(`apps/web/src/lib/news.test.ts`)에 비교 테스트를 넣는 일은 23-7에서 frontend 담당이다. frontend가 작업 중이라 그 파일은 고치지 않았다. 대신 스크래치 스크립트를 Node 24 타입 제거 방식으로 돌렸다. `apps/web/src/lib/news.ts`의 실제 `monthGrid`와 core dist의 `calendarMonthRange`를 1200개 달 전부에서 비교했다. from·to·격자 첫·끝 칸·칸 수(= (toBefore − fromAt)/1일)가 **불일치 0건**이었다. 스크립트는 `/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/ecf7f0de-031c-49ed-9801-f3ea7a17127a/scratchpad/calcmp/compare.mjs`에 있다.

### 해석·모호한 점 (계약은 바꾸지 않음)

1. **허용 범위**: 14-7은 「shared CalendarMonth 형식」이라고 했다. 그래서 shared 정규식대로 **2000-01 ~ 2099-12 밖이면 RangeError**로 했다(1999-12, 2100-01 포함). 웹 `parseMonth`는 연도 제한이 없는 `^\d{4}-(0[1-9]|1[0-2])$`이므로, 범위 밖의 달에서는 웹은 격자를 내고 core는 RangeError를 낸다. 서버 입력은 zod가 먼저 400으로 막으므로 실제 차이는 없다.
2. **month 생략 + now가 2100년 이후**: `resolveCalendarMonth`가 '2100-01'을 돌려주고, 그 뒤 `calendarMonthRange`가 RangeError를 낸다. 현실적으로 일어나지 않아 막지 않았다.
3. **빈 문자열 month**: 생략(undefined)으로 보지 않고 RangeError를 낸다. 14-7 「있으면 형식 검사」를 문자 그대로 따랐다. 쿼리 `?month=`는 shared zod가 400을 낸다.
4. **14-7 문구 「35 또는 42일, 2월 평년 1일이 월요일이면 28일」**: 계산 결과와 맞는다. 다만 28일이 되려면 「1일이 월요일인 평년 2월」이어야 하고, 이때 말일은 자동으로 일요일이다. 1200개 달 확인에서 다른 길이는 나오지 않았다.
5. `resolveCalendarMonth`는 month가 주어지면 now를 검사하지 않는다(쓰지 않으므로). 생략일 때만 잘못된 Date에 RangeError를 낸다.

## S6 후속 일정 시각 · 「다가오는 일정」 (2026-11-01 (3), 계약 14-7 추가 · 23-8, D302·D306–D308)

### 변경 파일

| 파일 | 내용 |
| --- | --- |
| `packages/core/src/calendar.ts` | 끝에 `EventScheduleKey` 타입과 함수 4개(`compareEventSchedule`, `eventStartsAt`, `upcomingWindow`, `mergeUpcomingItems`)를 추가했다. 기존 `calendarMonthRange`·`resolveCalendarMonth`는 바꾸지 않았다(import 줄만 늘어남) |
| `packages/core/src/calendar.test.ts` | 14-7 추가 「테스트 필수」 전부와 경계 사례. 새 테스트 26개(파일 합계 41개) |
| `packages/core/src/index.ts` | calendar export에 함수 4개와 `type EventScheduleKey` 추가 |
| `packages/core/dist` | 재빌드. dist에서 `eventStartsAt('2026-11-08','21:00')` = `2026-11-08T12:00:00.000Z`, `upcomingWindow(10-31T15:00Z, 30)` = 11-01 / 12-01 / 12-01T15:00Z인 것 확인 |

- 시그니처는 14-7과 같고 바꾸지 않았다.
- 새 상수는 만들지 않았다. `days`·`max`는 인자이고, 호출하는 쪽에서 shared `ADMIN_UPCOMING_DAYS`·`ADMIN_UPCOMING_MAX`를 넘긴다. 형식 검사는 shared `IsoDate`·`EventTime` 스키마의 `safeParse`로 하고, 정규식을 새로 만들지 않았다. 오프셋·하루 길이는 기존 `config.ts`의 `KST_OFFSET_MS`·`DAY_MS`를 쓴다.
- core 함수 합계 19개(15 + 4).

### 테스트

- `corepack pnpm exec vitest run`(packages/core): **14 files, 542 passed**(이전 516 + 26), 실패 0. core typecheck 통과.
- compareEventSchedule
  - 같은 날 종일 < 08:00 < 21:00, 종일 < '00:00'
  - undefined = null
  - 앞 날짜가 시각과 무관하게 먼저(월·연 넘김 포함)
  - 같은 시작이면 ends_on, 그다음 id
  - 종일 여러 날이 시각 있는 하루보다 먼저(ends_on보다 start_time을 먼저 비교)
  - id 문자열 비교
- eventStartsAt
  - 문서 예시값
  - null·undefined = 전날 15:00Z(연 넘김 포함)
  - KST 경계 08:59 / 09:00 / 23:59
  - 형식 오류: 날짜 5종, 시각 6종(`24:00`·한 자리 시·초 포함), 문자열이 아닌 값 → RangeError
- upcomingWindow
  - 문서 예시값, KST 자정 직전(14:59:59.999Z), 그날 23:59 KST
  - 연 넘김, 평년·윤년 2월 넘김
  - days 0
  - 잘못된 now, days -1·1.5·NaN·Infinity → RangeError
- mergeUpcomingItems
  - 진행 중 여러 날 일정(어제 시작)이 가장 먼저
  - 같은 순간이면 일정 먼저(21:00 대 21:00, 종일 대 00:00 KST 내전)
  - 21:00 일정과 20:00 내전 → 내전 먼저
  - 6개 → 5개 + hasMore(섞인 경우, 한 종류만 있는 경우)
  - 정확히 5개 → false
  - 입력 순서 안정, 객체를 복사하지 않고 그대로 담음
  - 23-8-4 서버 흐름을 재현한 통합 테스트
  - 빈 입력, max 0·-1·1.5·NaN → RangeError
  - 형식 오류 시각 → RangeError

### 일정 시각 (해석·모호한 점, 계약은 바꾸지 않음)

1. **KST 오프셋 위치**: 23-8-7 logic 표에는 「KST 오프셋은 `time.ts` 상수」라고 되어 있다. 실제 상수 `KST_OFFSET_MS`는 `config.ts`에 있고, 기존 `calendarMonthRange`도 그쪽을 쓴다. 그래서 `config.ts`를 썼다. 계약 문구만 정정하면 된다.
2. **compareEventSchedule는 형식을 검사하지 않는다.** 정렬 비교 함수 안에서 예외를 던지면 `Array.sort` 도중에 실패하기 때문이다. 입력은 이미 shared 스키마를 통과한 값이라고 본다. 고정 길이 형식(`YYYY-MM-DD`, `HH:mm`, 소문자 uuid)이라 문자열 비교가 PostgreSQL 순서와 같다. 대문자 uuid가 섞이면 순서가 PostgreSQL과 다를 수 있다(uuid 타입 정렬은 바이트 순서다). 서버 직렬화는 소문자라 문제가 없다.
3. **mergeUpcomingItems는 입력을 다시 정렬하지 않는다**(계약 「입력은 이미 정렬됨」). compareEventSchedule 순이면 `eventStartsAt` 키는 감소하지 않는다. 종일과 '00:00'은 같은 순간이고, 이때는 입력 순서가 유지된다. 정렬되지 않은 입력을 넣으면 결과가 시작 순이 아닐 수 있다. 검사는 하지 않는다.
4. **병합 중 형식 오류**: 일정 `starts_on`·`start_time`이나 내전 `scheduled_at`이 잘못되면 RangeError를 던진다(eventStartsAt과 같은 규칙). 한쪽 종류가 다 떨어진 뒤의 나머지 항목은 비교하지 않으므로 검사도 하지 않는다.
5. **hasMore = events.length + scrims.length > max**를 계약 문자 그대로 구현했다. 종류별로 `take: max + 1`로 읽으면 정확하다(D308). 호출하는 쪽이 종류별로 max개 이하만 넘기면, 실제로는 더 있는데 false가 나올 수 있다. backend가 `ADMIN_UPCOMING_MAX + 1`을 지켜야 한다.
6. **진행 중 일정의 키는 지난 순간이다.** 어제 시작한 일정의 키는 `now`보다 앞이라, `now` 이후 내전보다 항상 먼저 나온다(테스트 필수와 같다). 같은 날 이미 시작 시각이 지난 일정(오늘 09:00 시작, 지금 12:00)도 날짜 기준 선택(D303) 그대로 목록에 남고, 오늘 내전보다 앞에 온다.
7. **upcomingWindow `days` 0 허용**: 계약 「0 이상 정수」대로다. from = to = 오늘, scrimBefore = 내일 KST 00:00. now는 검사하고(잘못된 Date → RangeError) 시각 성분은 버린다. 내전 하한 `now`는 호출하는 쪽이 쓴다(반환값에 없음, 시그니처 그대로).
