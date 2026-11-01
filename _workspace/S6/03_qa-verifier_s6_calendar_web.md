# QA: S6 후속 web (이의 제기 제거 · 캘린더 · 일정 시각/다가오는 일정) — 판정: pass

대상: `_workspace/S6/02_frontend-dev_s6.md`의 「이의 제기 제거(D281)」「캘린더」「일정 시각 · 다가오는 일정」 절. 기준: 계약 13절, 18-1절, 23절(23-8 포함), D281–D310. blocker 0, major 0, minor 4. 아래 제안 3건은 계약 문구를 바꿀 때만 필요하다.

## 실행한 명령과 결과 (Node v24.22.2, 2026-11-01)

| 명령 | 결과 |
| --- | --- |
| `apps/web: corepack pnpm run typecheck` | exit 0 |
| `apps/web: corepack pnpm exec vitest run` | 31개 파일, 380개 테스트 통과, exit 0 |
| `rm -rf apps/web/.next && corepack pnpm run build` | exit 0 |
| 독립 프로브 `scratchpad/probe-calweb/calweb.probe.test.ts` (웹 `lib/api/*` 함수를 목 백엔드에 연결, `vi.mock('@/lib/api/index')`) | 8개 통과 |
| `grep -rni "dispute\|이의" apps/web/src` | 회귀 테스트(`mock/admin.test.ts:143-153`)와 주석 1줄(`lib/admin.ts:101`)만 남음 |

프로브가 확인한 것:
- `getCalendar`: 6개 달(2026-09~2027-01, 생략) × 4개 게임 필터(전체·lol·tft·steam), 24개 조합 모두 shared `GetCalendarResponse` parse를 통과했다.
  - 일정 항목에는 `start_time`·`end_time` 키가 항상 있다. 2단계(D305)에서 optional을 빼도 깨지지 않는다.
  - 순서는 일정 → 내전이다. 취소된 내전이 없고 `host`·`players`가 없다.
  - game 필터를 걸면 그 게임만 나오고 game null 일정은 빠진다.
  - 2026-11의 from·to는 `2026-10-26`·`2026-12-06`으로 계약 예시와 같다.
- 잘못된 month는 400 VALIDATION_FAILED. 일정 101개면 100개만 오고 `truncated.events`가 true다.
- `getAdminOverview` parse 통과. `upcoming`은 from `2026-10-31`, to `2026-11-30`, 5개, `has_more` true. 첫 행은 「진행 중 · ~11.04 종일 · 게임 무관」이다.
- `createEvent`(21:00–23:00)의 값이 캘린더와 upcoming에 바로 나온다. PATCH `{start_time:null}`만 보내면 400 path end_time, `{start_time:'23:30'}`만 보내면 400, 둘 다 null이면 종일이 된다. 여러 날 일정은 시각이 역순이어도 통과하고, DELETE 뒤 캘린더에서 사라진다(D300 예와 같음).
- 멤버: 캘린더 200, overview 403, 일정 쓰기 403. `empty` 시나리오: 캘린더 `items []`, upcoming `{items: [], has_more: false}`.
- `GET /events` limit 1 커서로 다음 페이지가 이어진다.
- 시각 규칙 7가지 경우에서 shared `eventScheduleIssues` 결과와 `CreateEventRequest.safeParse` 성공 여부가 모두 같았다.

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | `apps/web/src/lib/admin.ts:178` | 내전 행 링크 이름이 자연스럽다(23-8-5 예 「11월 13일 21:00 금요 5:5 내전 상세」) | `{제목} {칩} 상세`로 만들어서, 제목이 「내전」으로 끝나면 「10월 31일 15:00 화요일 저녁 5:5 내전 내전 상세」처럼 중복된다. 시드 내전 5개 중 3개가 이 경우다 | 프로브 출력의 `upcomingRows` linkLabel |
| 2 | minor | `apps/web/src/components/admin/admin-news.tsx:587` (shared `news.ts:284,287` 메시지를 그대로 씀) | 화면 오류 문구는 해요체다(「…이후여야 해요」) | 「종료 시각은 시작 시각 이후」「종료 시각은 시작 시각이 있을 때만」처럼 shared 메시지가 그대로 보인다(구현자 모호점 7) | 시작 21:00, 종료 20:00 입력 |
| 3 | minor | `apps/web/src/lib/admin.ts:101` | 리더 기준: 이의 제기 흔적은 회귀 테스트뿐 | 주석 「D281: 목업의 「결과 이의 제기」 칸 자리」가 남아 있다. 결정 근거를 적은 주석이라 동작에는 영향이 없다 | grep |
| 4 | minor | `apps/web/src/lib/hooks/admin.ts:239-248` `useSaveNoShows` | 노쇼 저장 경로들이 같은 키를 무효화한다 | `['admin','overview']`는 무효화하지만 `['calendar']`는 하지 않는다. 내전 상세의 노쇼(`useSetScrimNoShow`, `applyScrimDetail` 경유)는 둘 다 무효화한다. 지금은 화면 차이가 없다: `joined_count`에 no_show가 포함되고, `my_status`가 no_show여도 null이 아니라서 굵게 표시가 그대로다. 계약 13절 무효화 목록에도 노쇼는 없다(구현자 모호점 7) | 코드 대조 |

## 확인 항목별 결과

### (1) 이의 제기 제거
- web 안의 UI·훅·API 함수·오류 문구·목 상태·목 경로가 모두 없어졌다. 남은 것은 회귀 테스트와 주석 1줄(결함 3)뿐이다.
- 유지된 것:
  - 반려: `scrim-result.tsx:238` `useRejectScrimResult`, 큐의 반려 버튼
  - 되돌리기: `scrim-result.tsx:450-481`, `admin-results.tsx:311,351`
  - 노쇼: `admin-results.tsx:365` `NoShowPanel`, `scrim-detail.tsx:465-546`
- 큐 보기는 `RESULT_VIEW_LABEL`의 대기·최근 승인 2종이다.

### (2) 훅·API ↔ shared ↔ 컨트롤러 (일대일)

| 웹 함수 | ApiPath | api 컨트롤러 | 응답 parse |
| --- | --- | --- | --- |
| `getCalendar` (`lib/api/calendar.ts:10`) | `calendar` `/calendar` | `CalendarController.get` (`@Get`, JwtGuard) | `GetCalendarResponse` |
| `getAdminOverview` (`lib/api/admin.ts:59`) | `adminOverview` | `AdminController.overview(user)` | `GetAdminOverviewResponse` |
| `createEvent` / `updateEvent` / `deleteEvent` (`lib/api/admin.ts:120-130`) | `adminEvents` / `adminEvent` | `NewsController` POST 201 / PATCH / DELETE 204 | `CreateEventResponse` / `UpdateEventResponse` / null |

- 쿼리 키: `calendarKeys` = `['calendar']`, `['calendar', month, game|'all']`. `ADMIN_OVERVIEW_KEY` = `adminKeys.overview`이며 같은 상수를 쓴다.
- `useCalendar`: staleTime 60초, keepPreviousData, 4xx는 재시도하지 않는다.
- 무효화 위치:
  - `['calendar']`: `invalidateAfterResultChange`(승인·반려·되돌리기, 큐와 상세 모두), `invalidateAfterNewsWrite`(공지·패치·이벤트 쓰기), `applyScrimDetail`(작성·수정·참가·취소·시작·듀오·팀 저장·결과 제출·철회·상세 노쇼), `handleScrimMutationError`(403·404·409), `useDeleteScrim`
  - `['admin','overview']`: 위와 같은 자리, 그리고 `useSaveNoShows`. `invalidateAfterResultChange`는 `adminKeys.all`로 overview를 포함한다.

### (3) 목 백엔드
- `GET /calendar`(`mock/admin.ts:685-713`)는 core `resolveCalendarMonth`·`calendarMonthRange`·`kstDateKey`를 쓴다. 정렬은 core `compareEventSchedule`(= 서버 `EVENT_ORDER_BY`)이고, 한도와 truncated 처리는 api `calendar.service.ts:81-101`과 조건이 같다.
- overview `upcoming`(`mock/admin.ts:786-800`)은 core `upcomingWindow`·`mergeUpcomingItems`를 쓴다. 일정은 `ends_on ≥ from && starts_on ≤ to`, 내전은 `[now, scrimBefore)`이고 각각 MAX+1개를 읽는다. api `calendar.service.ts:112-128`과 같다.
- PATCH 일정(`mock/admin.ts:1067`)은 서버(`news.service.ts:570`)처럼 저장값과 합친 값을 shared `eventScheduleIssues`로 다시 검사한다.
- `events2` 커서: 목은 필요 없다. 웹은 `next_cursor`를 그대로 돌려보내기만 하고, 목은 offset 커서(`events:{from}:{to}:{game}`)를 쓰지만 정렬이 서버와 같아 페이지 경계 의미가 같다. 프로브에서 이어 받기를 확인했다.
- 목 응답은 모두 shared 스키마 parse를 통과했다(위 프로브). 일정 항목·홈 news·upcoming은 optional 시각 필드를 항상 채운다.

### (4) 화면 (코드 대조)
- `/admin` 4칸(`admin-results.tsx:76-109`): `grid-cols-2 md:grid-cols-3 xl:grid-cols-4`. 노쇼는 `col-span-2 md:col-span-1`, 다가오는 일정은 `col-span-2 md:col-span-3 xl:col-span-1`이고, 통계 칸은 `flex-col`이라 내용이 위에 붙는다. 스켈레톤 4개. 23-8-5 표와 같다.
- 「다가오는 일정」 카드:
  - 머리 문구 「오늘부터 {ADMIN_UPCOMING_DAYS}일」은 shared 상수를 쓴다.
  - 「진행 중 · ~MM.DD」 판정은 `starts_on < from`이다.
  - 행은 응답 순서 그대로이고, 응답이 `.max(5)`로 parse된다.
  - 내전 행만 `Link`(`routes.scrim`)이고, 내 참가 행은 굵게 표시한다. 빈 상태 문구가 있다.
  - `has_more`면 `<a href="#admin-calendar">`가 나온다. 캘린더 Card에 `id`와 `scroll-mt-4`가 있다.
- 편집 캘린더:
  - 편집 허용 조건 `canEdit = mode==='admin' && isAdmin && onToast`.
  - 날짜 칸 「+」(aria-label 「11월 6일에 일정 추가」), 머리 「+ 일정 추가」(오늘), 상세 「+ 이 날 일정 추가」, 막대 클릭은 수정 대화상자를 연다. 삭제는 수정 대화상자 안의 `DeleteDialog`이고 제목은 「일정을 삭제할까요?」(`objectParticle`).
  - 내전은 `Link`만 있어 읽기 전용이다.
- 홈 캘린더: `home-view.tsx:113` `<CommunityCalendar mode="read" />`는 onToast가 없어서 운영진이어도 `canEdit`가 false다. 운영진에게는 「관리 →」만 보인다.
- `/news`: 막대 첫 조각에 `start_time` 접두사가 붙고, title·aria-label과 `EventDetail`은 `eventScheduleText`를 쓴다. `GET /events`를 쓰는 동작은 그대로다(D296·D310).
- `EventForm`(`admin-news.tsx:495-619`):
  - 시작 시각을 비우면 종료 시각도 비우고 입력을 막는다.
  - 본문은 `end_time: startTime ? endTime||null : null`이다.
  - 클라이언트 검증은 shared `eventScheduleIssues`와 `CreateEventRequest`를 쓴다. 서버와 같은 함수다.
  - 같은 날이면 종료 입력에 `min`을 건다. 수정 초기값은 `editing.start_time ?? ''`.

### (5) 하드코딩·버튼·rel·조사·모바일
- 정책값 리터럴: 다가오는 일정 일수는 `ADMIN_UPCOMING_DAYS`를 쓰고, 5행은 응답 길이를 따른다. 300·100은 목 안에서만 `CALENDAR_*_MAX`로 쓰인다. 칸 3줄은 웹 표시값 `CALENDAR_CELL_SCRIMS`다. 하드코딩 없음.
- 직접 만든 `<button>`: 캘린더·admin-results·admin-news·news·home에 없다(모두 `Button`).
- 외부 링크: 캘린더 `EventRow`는 `target=_blank rel="noopener noreferrer"`이고 sr-only 「(새 창)」이 있다. 참고로 기존 스팀 링크(`scrim-detail.tsx:249`, `steam-app-picker.tsx:59`)는 `rel="noreferrer"`뿐이다. 이번 범위 밖이고, noreferrer가 noopener를 포함한다.
- 조사: 「일정을 추가했어요 / 고쳤어요 / 삭제했어요」, 「일정을 삭제할까요?」 정상.
- 모바일: md 미만은 목록형이고 「지난 일정 N개 보기」, 빈 상태, 「앞으로 남은 일정이 없어요」가 있다. truncated 안내 Notice는 격자 밖에 있어 모바일에서도 보인다.

### (6) 구현자 모호점 판단 (일정 시각 절 8개 + 캘린더 절 일부)

| # | 처리 | 판단 |
| --- | --- | --- |
| 1 | `upcomingRows(u)`에서 `now`를 뺐다 | 수용. 진행 중은 서버 `from`, 날짜는 응답 `date`로 정해져 `now`가 필요 없다. 계약 23-8-7 frontend 표의 시그니처 문구만 고치면 된다(제안 A) |
| 2 | 「모집」 칩 = `game.has_results === false` | 수용. shared 주석(「false면 인원 모집」)과 기존 화면 규칙(`scrim-results.ts:168` recruitment 분기, `scrim-edit-dialog.tsx:157-178` 「인원 모집이라…」)이 같은 기준이다. 스팀만 하드코딩하지 않아 게임이 늘어도 맞다 |
| 3 | 카드에 「일정 추가」 링크 없음 | 수용. 23-8-5가 정의한 링크는 「캘린더에서 더 보기 ↓」 하나다. 바로 아래 캘린더 머리에 「+ 일정 추가」가 있다. D309에 따라 카드는 보기 전용이다 |
| 4 | 링크 이름 `{제목} {칩} 상세` → 중복 | 결함 1(minor). 계약 예를 그대로 일반화한 결과다. 제안 B |
| 5 | 여러 날 일정은 `eventTimeText`에서 끝 시각을 생략 | 수용. 23-8-5 다가오는 일정 규칙 「같은 날 end_time이 있으면 21:00–23:00」과 `eventTimeText` 「하루 목록용」 정의에 맞다. 홈의 「끝이 있으면 21:00–23:00」도 같은 함수를 쓰므로 일관된다. 「21:00–18:00」 같은 오해를 막는다 |
| 6 | `/news` 막대에 aria-label 추가 | 수용. 23-8-5 표가 요구한 것이다(title·aria-label = `eventScheduleText`) |
| 7 | shared 오류 메시지를 그대로 표시 | 결함 2(minor). 제안 C |
| 8 | `upcoming` 없음 → 빈 목록(1단계) | 수용. 2단계 정리 목록이 보고서에 있다 |
| 캘린더 7 | 노쇼 저장 뒤 캘린더를 무효화하지 않음 | 수용(결함 4는 일관성 참고). 지금 화면 차이가 없다 |
| 캘린더 9 | 홈 캘린더가 `Dashboard` 안에 있어 요약이 실패하면 캘린더도 안 보임 | 계약 23-7 지시대로다. 캘린더가 요약과 따로 `GET /calendar`를 부르므로, 요약 오류와 상관없이 그리는 편이 D293의 취지(서로 영향 없음)에 더 맞다. 필요하면 계약에서 배치를 `Dashboard` 밖으로 바꾼다(제안 D, 선택) |

### (7) 회귀
- 홈 「패치 · 이벤트」 카드는 유지되고, `start_time`이 있으면 시각이 붙는다.
- 내전 상세: 되돌리기·반려·노쇼 UI가 유지된다.
- 설정·`/news`: typecheck·테스트·build 통과. `/news` 동작은 시각 표시와 aria-label만 바뀌었다.

## 계약 변경 제안 (architect)
- A. 23-8-7 frontend 표의 `upcomingRows(u: AdminUpcoming | undefined, now)`와 `<UpcomingCard … now={now} />`에서 `now`를 뺀다(구현과 맞춤).
- B. 23-8-5 내전 행 링크 이름을 「{M월 D일} {HH:mm} {칩} · {제목} 상세」로 바꾼다(칩을 제목 앞에 둠). 또는 「제목이 칩 문구로 끝나면 칩을 생략」 규칙을 넣는다.
- C. 일정 시각 오류 문구의 화면 표기를 정한다. shared 메시지를 해요체로 바꿀지(서버 details에도 나간다), 웹에서 path별로 매핑할지 고른다.
- D. (선택) 홈 캘린더를 요약 성공 여부와 상관없이 그리도록 23-7 배치 문구를 바꾼다.

## 검증하지 않은 것
- 브라우저 확인(Playwright)은 직접 돌리지 않았다. Next 15 `next dev`가 공유 폴더 `apps/web/.next`에 쓰기 때문에, 병행 중인 qa-verifier의 build와 부딪힐 수 있어서다. 배치·스크롤·편집 흐름은 코드 대조와 목 프로브로 확인했다. 실제 렌더링 증거는 구현자 브라우저 확인(보고서)뿐이다.
- 개발 서버를 띄우지 않았다. 코드와 git index는 바꾸지 않았다(프로브는 scratchpad `probe-calweb/`에만 있음).
