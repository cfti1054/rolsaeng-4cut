# QA: S6 web (관리자·정보·되돌리기·이의 제기·알림 설정) — 판정: pass

작성 2026-11-01. 대상: `_workspace/02_frontend-dev_s6.md`. 대조: 계약 `_workspace/01_architect_contract.md` 4·5·13절·D241–D280, `_workspace/02_backend-dev_s6.md`, 목업 `Admin.dc.html`. 코드 수정 없음(프로브는 scratchpad).
사용한 도구: Read, Bash, Write(이 보고서), SubagentHandback.

blocker 0, major 0, minor 8. 계약 변경 제안 2건(아래 「결정이 필요한 것」 1·3).

## 실행한 명령과 결과 (Node 24.22.2)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter web typecheck` | 통과 (EXIT 0) |
| `corepack pnpm -r typecheck` | shared·core·api·web 4개 Done |
| `cd apps/web && corepack pnpm exec vitest run` | 30 files, 344 passed (EXIT 0) |
| `rm -rf apps/web/.next && corepack pnpm --filter web build` | 통과. `/admin` ○ 16.3 kB, `/news` ○ 6.56 kB, 13개 페이지 생성 |
| 프로브 `scratchpad/probe-web/s6-web.probe.test.ts`(별도 vitest config) | 1 passed. 아래 설명 |

프로브: `lib/api/index`를 vi.mock으로 바꿔 **실제 웹 API 함수**(`lib/api/admin.ts` 24개, `news.ts` 3개, `notification-settings.ts` 2개, `scrims.ts`의 revert·disputes 2개)를 목 백엔드에 대고 실제 client(shared zod parse)로 끝까지 호출했다. 31개 모두 parse 성공. 오류 분기도 확인: 이의 제기 재처리 `DISPUTE_ALREADY_RESOLVED`, 자기 역할 변경 `ADMIN_SELF_ROLE_CHANGE`, 삭제된 공지 삭제 `NOT_FOUND`, 진행 중 시즌 삭제 `SEASON_NOT_EDITABLE`, 폐기 두 번 200(멱등), 멤버의 `/admin/overview` `FORBIDDEN`, 멤버 커서 2쪽, 홈 요약 parse. 나간 요청의 메서드·경로는 계약 4-1·4-2 표와 같다(`GET /admin/no-show/scrims`, `POST /admin/api-keys/:id/revoke`, `DELETE /admin/seasons/:id` 등 31개 고유 조합).
개발 서버는 띄우지 않았다(3000·3461 포트 비어 있음).

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | `apps/web/src/lib/admin.ts:51`, 사용처 `components/admin/admin-results.tsx:192`, `components/scrims/scrim-result.tsx:469` | 되돌리기 시도가 `SCRIM_RESULT_REVERT_NOT_ALLOWED`로 실패하면 실제 이유에 맞는 문구가 나와야 함 | 이유와 관계없이 항상 rating_mismatch 문구 「레이팅 기록이 맞지 않아요. 개발자에게 알려 주세요」. 화면을 열어 둔 사이 7일이 지나거나(window_passed), 다른 승인이 끼어들면(later_games) 「개발자에게 알려 달라」는 잘못된 안내가 나온다 | 큐 「최근 승인」에서 can_revert true인 행을 띄워 두고 승인 후 7일이 지난 뒤 되돌리기. 목 test `admin.test.ts`의 later_games 시도도 같은 코드를 받는다. 해결 방법은 「결정 3」 |
| 2 | minor | `apps/web/src/lib/hooks/scrims.ts:174-182`(`handleScrimMutationError`), `:356`(`useRevertScrimResult`) | 계약 5절·D263: 운영진 API가 403이면 `['me']`를 다시 읽음 | `/admin` 훅은 `guarded()`로 `['me']`를 다시 읽지만, 상세 화면의 「승인 되돌리기」(운영진 API)와 기존 승인·반려는 403에서 상세·목록만 다시 읽는다. 강등 직후 상세에서 되돌리기를 누르면 버튼은 사라지지만 사이드바 STAFF·모바일 관리자 아이콘은 다음 `/me` 조회까지 남는다 | 목 `gcd-mock-admin=demoted`로 `/scrims/{승인된 id}`에서 되돌리기 → 사이드바 STAFF 유지 |
| 3 | minor | `apps/web/src/components/admin/admin-news.tsx:424-428` | 운영진이 등록한 이벤트를 관리 탭에서 고치고 지울 수 있음 | 관리 목록이 오늘 −30일부터 92일 구간(`from = today − floor(92/3)`, `to = from + 92`)만 읽는다. 62일보다 먼 미래나 30일보다 지난 이벤트는 등록은 되지만 등록 직후부터 목록에 보이지 않아 수정·삭제할 방법이 없다. `/news` 캘린더에는 수정 진입점이 없다 | 관리 탭에서 시작일을 4개월 뒤로 이벤트 등록 → 성공 토스트, 목록에 없음. 해결은 「결정 6」(웹만 고치면 됨) |
| 4 | minor | `apps/web/src/components/admin/admin-members.tsx:184`, `:193` | 「멤버로 변경」, 「멤버로 바꿨어요」 | `${ROLE_LABEL[next]}으로`라서 「멤버으로 변경」, 「…역할을 멤버으로 바꿨어요」가 된다(운영진은 「운영진으로」라 맞음) | 멤버 탭에서 운영진 행의 역할을 member로 바꾸기 |
| 5 | minor | `apps/web/src/components/home/home-view.tsx:601` | 홈 「패치 · 이벤트」의 이벤트 행을 누르면 그 이벤트가 있는 달이 열림 | `routes.news({ tab: 'events' })`에 `month`가 없어 항상 이번 달이 열린다. 홈 이벤트는 오늘 +30일까지라 다음 달 이벤트는 누른 뒤 화면에 없다 | 목 시드의 「다음 달」 이벤트가 홈에 보일 때 클릭. `month: monthOf(n.date)`(ongoing이면 이번 달)를 넘기면 해결 |
| 6 | minor | `apps/web/src/components/scrims/scrim-result.tsx:469` | 되돌리기가 네트워크 오류로 실패해도 대화상자에 오류가 보임 | `err`가 `isApiError`일 때만 만들어져 NETWORK_ERROR(비 ApiError)면 아무 문구 없이 대화상자가 그대로다(큐 `admin-results.tsx:192`는 `apiErrorText`로 처리함) | 오프라인에서 상세 되돌리기 확인 |
| 7 | minor | `apps/web/src/components/admin/admin-api-keys.tsx:61-67` | 원문은 대화상자를 닫으면 버림 | 화면 상태 `raw`는 비우지만 `create.data.key`(useMutation 결과)는 탭이 열려 있는 동안 메모리에 남는다. 목록·로그·localStorage에는 원문이 없다(확인함: 목 저장소는 prefix만, `client.ts:140` console.error는 zod issue만 찍음). 닫을 때 `create.reset()` 권장 | 코드 확인 |
| 8 | minor | `apps/web/src/lib/hooks/news.ts:60`, `components/news/news-view.tsx:296` | - | `usePatchNotesPage`는 어디서도 쓰지 않는다(죽은 코드). 캘린더는 `limit=100` 첫 쪽만 읽고 `next_cursor`를 버린다(한 화면 6주에 100개 넘을 일은 드묾. 넘으면 조용히 빠진다) | grep |

## 교차 대조 표 — 웹이 부르는 31개 ↔ ApiPath ↔ api 컨트롤러

모든 컨트롤러 데코레이터가 `ApiPath` 상수를 쓰고 응답을 shared 스키마 `.parse`로 직렬화한다(admin·news·users 서비스 grep 확인). 웹은 `fillPath(ApiPath.*)` + shared Response 스키마로 parse한다(제네릭 단언 없음).

| # | 웹 함수 | 메서드·경로 | 요청 / 응답 스키마 | api 위치 | HTTP |
| --- | --- | --- | --- | --- | --- |
| 1 | getAdminOverview | GET /admin/overview | - / GetAdminOverviewResponse | admin.controller `overview` | 200 |
| 2 | listAdminResults | GET /admin/results?view | ListAdminResultsQuery / ListAdminResultsResponse | `results` | 200 |
| 3 | listAdminDisputes | GET /admin/disputes?status | ListAdminDisputesQuery / ListAdminDisputesResponse | `disputes` | 200 |
| 4 | resolveAdminDispute | POST /admin/disputes/:id/resolve | ResolveDisputeRequest / ResolveDisputeResponse | `resolveDispute` | 200 |
| 5 | listAdminNoShowScrims | GET /admin/no-show/scrims | PaginationQuery / ListAdminNoShowScrimsResponse(+policy) | `noShowScrims` | 200 |
| 6 | listAdminMembers | GET /admin/members?q&role&sort | ListAdminMembersQuery / ListAdminMembersResponse | `listMembers` | 200 |
| 7 | changeMemberRole | PATCH /admin/members/:id/role | ChangeMemberRoleRequest / AdminMemberItem | `changeRole` | 200 |
| 8–10 | createNotice / updateNotice / deleteNotice | POST /admin/notices, PATCH·DELETE /admin/notices/:id | Create·UpdateNoticeRequest / NoticeView, 204 | news.controller AdminNewsController | 201/200/204 |
| 11–13 | create/update/deletePatchNote | POST /admin/patch-notes, PATCH·DELETE …/:id | Create·UpdatePatchNoteRequest / PatchNoteView, 204 | 같음 | 201/200/204 |
| 14–16 | create/update/deleteEvent | POST /admin/events, PATCH·DELETE …/:id | Create·UpdateEventRequest / EventView, 204 | 같음 | 201/200/204 |
| 17 | listAdminApiKeys | GET /admin/api-keys | - / ListAdminApiKeysResponse | `listApiKeys` | 200 |
| 18 | createApiKey | POST /admin/api-keys | CreateApiKeyRequest / CreateApiKeyResponse | `createApiKey` | 201 |
| 19 | revokeApiKey | POST /admin/api-keys/:id/revoke | 본문 없음 / AdminApiKeyItem | `revokeApiKey` | 200 |
| 20–23 | list/create/update/deleteSeason | GET·POST /admin/seasons, PATCH·DELETE …/:id | Create·UpdateSeasonRequest / AdminSeasonItem, 204 | `listSeasons`… | 200/201/200/204 |
| 24 | listAdminAuditLogs | GET /admin/audit-logs?action | ListAdminAuditLogsQuery / ListAdminAuditLogsResponse | `auditLogs` | 200 |
| 25 | listNotices | GET /notices | ListNoticesQuery / ListNoticesResponse | NewsController `notices` | 200 |
| 26 | listPatchNotes | GET /patch-notes?game | ListPatchNotesQuery / ListPatchNotesResponse | `patchNotes` | 200 |
| 27 | listEvents | GET /events?from&to&game | ListEventsQuery / ListEventsResponse | `events` | 200 |
| 28 | getMyNotificationSettings | GET /me/notification-settings | - / GetMyNotificationSettingsResponse | users.controller | 200 |
| 29 | updateMyNotificationSettings | PATCH /me/notification-settings | UpdateMyNotificationSettingsRequest / 같은 모양 | users.controller | 200 |
| 30 | revertScrimResult | POST /scrims/:id/result/revert | RevertScrimResultRequest / ScrimDetail | scrims.controller:232 (@Roles admin) | 200 |
| 31 | createScrimDispute | POST /scrims/:id/result/disputes | CreateScrimDisputeRequest / ScrimDetail | scrims.controller:245 | 201 |
| - | (봇 4개) | /bot/notices/*, /bot/patch-notes/* | - | bot.controller | 웹 미사용(봇 전용) |

쿼리 이름(`view`, `status`, `q`, `role`, `sort`, `action`, `cursor`, `limit`, `game`, `from`, `to`)이 shared Query 스키마 키와 같다. 웹이 보내는 `limit` 최대값은 `PAGE_LIMIT_MAX`(100)이고, 이벤트 조회 구간(달 격자 최대 42일, 관리 탭 92일)은 `EVENTS_RANGE_MAX_DAYS`(92) 안이다.

### 무효화 (13절)
| 행위 | 계약 | 구현(`lib/hooks/admin.ts`, `scrims.ts`) |
| --- | --- | --- |
| 승인·반려·되돌리기(큐·상세) | scrims, admin, dashboard, rankings | `invalidateAfterResultChange`: 4개 + 프로필(`['users']`)·`['seasons']`. 상세 훅(approve·reject·revert)도 이 함수를 부름 |
| 공지·패치·이벤트 쓰기 | news, dashboard, admin/audit | `invalidateAfterNewsWrite` 3개 일치 |
| 역할 변경 | admin/members, admin/overview | 2개 + admin/audit |
| 이의 제기 처리·제출 | (명시 없음) | admin 전체 + scrims(처리), admin(제출) |
| 노쇼 저장 | (명시 없음) | admin/no-show·overview·members, 상세, 프로필 |
| 시즌 쓰기 | (명시 없음) | admin/seasons·audit, `['seasons']`, dashboard, rankings |

`hooks/admin.ts`와 `hooks/scrims.ts`가 서로 import한다(순환). 둘 다 상수를 함수 안에서만 써서 실행 순서 문제는 없다(빌드·테스트 통과). 참고로만 적는다.

## 라우트·링크 대조
- `routes.admin(tab)` → `/admin` 또는 `/admin?tab=members|news|seasons|api-keys|audit`(results는 쿼리 생략). `AdminView`가 `ADMIN_TABS`가 아닌 값은 results로 처리. `app/(main)/admin/page.tsx`는 Suspense로 감싸 정적 빌드 ○.
- `routes.news({tab, game, month})` → `/news?…`. `NEWS_TABS = notices|patch-notes|events`, 잘못된 `month`·`game`은 무시. `app/(main)/news/page.tsx` 있음.
- 링크 출처: 사이드바 MENU 「정보」(`nav-items.ts`, `tab: false`라 하단 탭에서 빠짐), 모바일 머리 아이콘 정보(`app-shell.tsx:258`)·관리자(`:262`, admin만 렌더), 사이드바 STAFF(`:115-119`, admin만), 홈 공지 줄 → `/news?tab=notices`, 「전체 보기」 → `/news`, 행 → `/news?tab=patch-notes|events`(결함 5), 빈 상태 운영진 「관리」 → `/admin?tab=news`, `/news` 섹션 「관리 →」 → `/admin?tab=news`(admin만), 큐·이의 제기 행 → `routes.scrim(id)`, 멤버 → `routes.member(id)`. 모두 `app/` 라우트와 맞다. 리터럴 `href="/…"`는 없다.
- 비운영진: `/admin`은 `me.role !== 'admin'`이면 머리 + `ErrorState(FORBIDDEN)`만 그리고 overview 쿼리를 끈다(`enabled: isAdmin`). 운영진 API가 403이면 `guarded()`가 `['me']`를 exact로 무효화 → role이 member로 오면 같은 FORBIDDEN 상태, overview가 FORBIDDEN이어도 같은 상태(`admin-view.tsx:43`). 실제 api의 `GET /me`는 DB에서 읽는다(`users.service#getMe`)라 강등이 반영된다. 상세 화면 경로만 빠졌다(결함 2).

## 목 백엔드
- 판정은 core 함수를 import해 쓴다: `revertBlockReason`(`mockRevertBlock`), `disputeBlock`(`mockS6Viewer`), `planRatingRevert`, `planRoleChange`, `adminMemberStatus`, `previewNoShowRestriction`·`computeScrimRestriction`, `seasonPhase`·`seasonEditable`·`validateSeasonWrite`·`validateSeasonDelete`, `newsSubtitle`, `resolveEventsRange`, `dashboardNewsWindow`. 요청은 shared Request·Query 스키마로 safeParse한다.
- 응답 구조: 목·api 둘 다 같은 shared 스키마로 parse한다(api는 서비스에서 `.parse`, 목은 웹 client에서 parse). 프로브로 31개 확인. 큐 `view` 의미(pending ASC, approved는 7일 안 DESC)도 shared 주석·api와 같다.
- API 키: 목 저장소에는 prefix만 있고(`mock/admin.ts:1140-1154`), 감사 details에도 원문이 없다.
- demoted 시나리오는 `/admin/*`·`/result/revert`만 403을 준다(`backend.ts:174`). 상세 승인·반려는 흉내 내지 않는다(결함 2 재현은 되돌리기로).

## 화면 점검 (5)
- 정책값 리터럴: S6 화면·`lib/admin.ts`·`lib/news.ts`에 30일·3회·7일·72시간·15분 같은 리터럴이 없다. 되돌리기 7일 = `SCRIM_RESULT_REVERT_WINDOW_DAYS`, 이의 제기 3일 = `SCRIM_DISPUTE_WINDOW_DAYS`, 72시간 = `BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS`, 시즌 lead·길이는 shared 상수, 노쇼 문구·「최근 N일」·`NO-SHOW {N}D`는 서버 `policy`. 남은 숫자:
  - 설정 「참가한 내전 시작 30분 전」(`notification-section.tsx:13`)은 계약 13절 문구 그대로다. shared에 상수가 없고 봇이 정하는 값이다. 상수가 생기면 바꿀 것(참고).
  - `9 * 3_600_000`(KST 오프셋, `lib/admin.ts` isoToKstLocalInput)과 페이지 크기 3·6·20은 정책값이 아니다.
- 직접 만든 `<button>`: S6 새 파일(`components/admin/*`, `components/news/*`, `notification-section.tsx`, `ui/form.tsx`, `scrim-result.tsx`의 S6 추가분)에는 없다. 남은 raw button은 모두 이전 슬라이스 파일이다(보고서대로 손대지 않음). 공지·감사 로그 펼치기는 `<details>/<summary>`다.
- 외부 링크: `news-view.tsx:237`(원문 보기)·`:405`(안내 보기) 모두 `target="_blank" rel="noopener noreferrer"` + 「(새 창)」 sr-only. 홈 news 행은 `url`이 있어도 내부 `/news` 링크만 쓴다.
- API 키 원문: 발급 응답의 `key`는 대화상자 상태에만 들어가고 목록은 `apiKeyPrefixText(key_prefix)`만 쓴다. 웹 소스의 console 호출은 `client.ts:140` 하나(계약 위반 시 zod issues)다. 결함 7은 메모리 잔류만.
- 상태 처리: 탭·섹션마다 로딩(Skeleton, aria-busy)·빈(EmptyState 문구)·오류(ErrorState + 다시 시도) 상태가 있다. 비활성 이유도 보인다: 「내가 제출한 결과」, 되돌리기 막는 이유 5종, 시즌 잠금 칸 hint 「이 단계에서는 바꿀 수 없어요」, 역할 잠금 아이콘·title, 「디스코드로 이미 보냈어요」, 노쇼 「표시하면 참가 제한」·「제한 중 ~MM.DD」, 알림 미연동 안내. 「더 보기」 실패 문구는 `/news`에만 있다(관리 탭 목록은 hasNextPage 버튼만).

## 이전 슬라이스 회귀 (6)
- 공용 `Button`: md·lg는 바뀌기 전과 클래스 집합이 같다(base `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap` + 같은 size 문자열 + variant). `sm`·`custom`·`plain`만 새로 생겼다. 기존 호출부는 size를 md·lg로만 넘긴다 → 회귀 없음.
- 홈 `news` 필수: 웹 목(`mock/rankings.ts` → `mockDashboardNews`)과 api(`dashboard.service#news`) 둘 다 채우고, 프로브에서 `GetDashboardSummaryResponse` parse 통과. 옛 api + 새 웹이면 parse가 실패한다 → 계약 19절대로 같은 커밋 배포.
- 홈 레이아웃: `RecentResultsPanel`의 `xl:col-span-2`를 풀어 `xl:grid-cols-[3fr_2fr]` 격자에 최근 결과·패치 이벤트가 나란히 놓인다(보고서대로, 목업 Main과 같음).
- 내전 상세·목록: `resultPanelState`는 reverted(playing + can_submit_result)를 `input`으로 보내 결과 입력이 다시 열린다. 카드·상세 배지·단계는 reverted 분기가 pending 다음에 추가됐고 기존 분기는 그대로다. `STALE_CODES`에 `SCRIM_RESULT_NOT_APPROVED`가 추가됐는데, 이 코드는 되돌리기에서만 나온다. 상세 승인·반려 성공 뒤 무효화가 넓어져(`['scrims']` 전체) 방금 setQueryData한 상세를 한 번 더 받는다. 부작용은 없다.
- 설정: 섹션이 하나 추가됐을 뿐 기존 섹션은 바뀌지 않았다.

## 구현자 「결정이 필요한 것」 1–6 판단

| # | 판단 | 근거 | api 쪽 변경 |
| --- | --- | --- | --- |
| 1 멤버 표 NO-SHOW 열 기간 | **지금 구현을 유지해도 된다(결함 아님). 계약 변경을 제안한다(낮은 우선순위)** | `/me/scrim-restriction`의 `policy`도 같은 서버 `NoShowPolicyView`(D101)라 값이 같다. 다만 멤버 표가 다른 도메인 응답에 기대고, 그 요청이 실패하면 머리가 「NO-SHOW」로만 나온다 | 제안: `ListAdminMembersResponse = paginated(AdminMemberItem).extend({ policy: NoShowPolicyView })`(`ListAdminNoShowScrimsResponse`와 같은 방식). 바뀌는 것: shared admin.ts, api `admin-members.service#list`(빈 결과 분기 `:136` 포함), 웹 목, 화면 1줄 |
| 2 큐 「블루 +15 ~ +19」 | **변동 범위 없이 가는 지금 구현이 맞다** | 계약 13절 APPROVAL QUEUE 행 구성(게임 약칭·제목·배지·when·제출자·결과 문구)에 변동 범위가 없다. pending의 범위를 만들려면 승인 전 ELO 미리보기를 서버가 계산해야 해서 범위가 커진다 | 없음(원하면 별도 슬라이스) |
| 3 REVERT_NOT_ALLOWED 이유 | **결함 1로 기록했다. 계약 변경 제안** | S0 원칙(문구는 code로 정함) 때문에 지금은 이유를 알 수 없다. `ErrorBody` 주석은 「details는 VALIDATION_FAILED에서만」이다(`packages/shared/src/common/errors.ts:151-159`). backend는 `revertNotAllowed(reason)`(`scrim-results.service.ts:71-73`)에서 이유를 이미 알고 있다 | 제안 A(추천): 계약 2절에 「SCRIM_RESULT_REVERT_NOT_ALLOWED는 `details: [{ path: 'reason', message: <ScrimResultRevertBlock> }]`」를 넣고, ErrorBody 주석의 예외로 적는다. api는 `revertNotAllowed`에서 details를 붙이고, 웹은 `details[0].message`를 `ScrimResultRevertBlock.safeParse`해 `REVERT_BLOCK_TEXT`로 바꾼다(실패하면 rating_mismatch). 제안 B(api 변경 없음): 오류 뒤 다시 받은 큐·상세의 `revert_blocked_reason`이 null이 아니면 그 문구를, null이면 rating_mismatch 문구를 쓴다(이미 오류 시 다시 조회함). B는 경합을 다시 읽은 값으로 맞추므로 A보다 한 박자 늦다 |
| 4 노쇼 경고 문구 | **구현이 맞다** | Q17·12-6: 문구는 서버 정책값으로 만든다. 목업 「저장하면 30일 노쇼 3회가 되어」는 예시값이고, 이미 기준을 넘은 회원은 횟수가 threshold와 다르다. 행마다 「최근 N일 노쇼 {체크 반영 수}회」를 따로 보여 주므로 정보가 빠지지 않는다 | 없음 |
| 5 `/news?tab=` 의미 | **구현을 인정한다(계약 보충 권장)** | 계약 13절은 `routes.news(q)`에 `tab`·`game`·`month`만 정하고 뜻은 정하지 않았다. 「tab = 보이는 섹션 하나, 없으면 셋 다」는 홈 행 링크와 관리 링크에 쓰기 좋다. `game` 하나를 패치노트·이벤트가 같이 쓰는 것도 계약 파라미터가 하나라 맞다 | 없음. architect가 13절에 한 줄 추가 |
| 6 관리 탭 이벤트 구간 | **결함 3으로 기록했다. 웹에서만 고치면 된다** | 「운영진 전용 목록 없음」(4-2)은 유지할 수 있다. 공개 `GET /events`는 from·to를 받으므로 관리 탭에 92일 구간 이동(‹ ›)이나 월 선택을 붙이면 모든 이벤트에 닿는다. 등록 직후 그 이벤트가 있는 구간으로 이동하면 「등록했는데 안 보임」도 없어진다 | 없음 |

## 이전 결함 재확인
첫 검증이라 해당 없음.
