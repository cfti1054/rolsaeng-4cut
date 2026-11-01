# frontend-dev S6 보고서 — 관리자 도구·정보·되돌리기·이의 제기·알림 설정

계약: `_workspace/01_architect_contract.md`(S6) 13절·18절 frontend. 목 모드에서 전부 동작합니다. 실제 API와는 연결해 보지 않았습니다(backend 진행 중).

## 검증 (Node 24, apps/web/.next 지운 뒤)
- `corepack pnpm --filter web typecheck`: 통과
- `corepack pnpm exec vitest run`(apps/web): 30개 파일, 344개 통과(기준 305개에서 39개 늘어남, 새 파일 3개: `lib/admin.test.ts`, `lib/news.test.ts`, `lib/api/mock/admin.test.ts`)
- `corepack pnpm --filter web build`: 통과(`/admin` ○, `/news` ○)
- 브라우저(목 모드 `next dev -p 3461`, Playwright): 데스크톱 1440·모바일 390 × 다크·라이트 × 운영진·멤버, 54개 화면. 가로 넘침 0, 화면 밖으로 잘린 버튼·링크·제목 0, 콘솔 오류 0. 클릭 흐름은 데스크톱 다크에서 확인: 「최근 승인」 칩, 상세에서 승인 되돌리기(사유 입력 → 「결과 되돌림 · 재입력 대기」와 결과 입력 영역 다시 열림), API 키 발급(원문 대화상자). 멤버 계정으로 `/admin`을 열면 FORBIDDEN 상태가 나옵니다. 개발 서버는 확인 뒤 종료했습니다(3461 포트 비어 있음).
- 처음 확인 때 캘린더 막대가 날짜 숫자 위에 겹쳐 그려졌고, 고친 뒤 다시 확인했습니다.

## 라우트·화면
| 라우트 | 내용 | 목업 |
| --- | --- | --- |
| `/admin` | 탭 6개(`?tab=`, 기본 results): 결과·노쇼(통계 4칸, APPROVAL QUEUE 보기 칩 대기·최근 승인·이의 제기, NO-SHOW, 이의 제기 패널) / 멤버(MEMBERS 표, 검색 300ms debounce, 역할 필터·정렬, 역할 select와 확인 대화상자, 잠금 아이콘) / 공지·소식(NOTICE 작성·목록·디스코드 상태, 패치노트·이벤트 작성·수정·삭제) / 시즌 / API 키 / 감사 로그 | Admin(첫 탭·멤버·공지). **패치노트·이벤트·시즌·API 키·감사 로그는 목업 없음** → 기존 카드·표·칩·토큰 패턴 |
| `/news` | 보기 칩(전체·공지·패치노트·이벤트 = `tab`), 공지(3개씩 「더 보기」, 펼치기), 패치노트(게임 칩, 원문 보기 `target=_blank rel="noopener noreferrer"`), 이벤트 캘린더(‹ › 오늘, 게임 칩, KST 월 격자 7열 월요일 시작, 여러 날 이벤트는 주마다 막대, 모바일은 목록형). 운영진에게만 섹션마다 「관리 →」. 스팀 할인 없음 | **목업 없음** |
| `/` 홈 | 상단 공지 줄(`news.notice`), 「패치 · 이벤트」 카드(월·일 블록, 게임 태그, subtitle, 「전체 보기」, 빈 상태와 운영진 관리 링크). 최근 결과 카드는 col-span-2를 풀고 목업처럼 나란히 둠 | Main |
| `/settings` | 「알림」 섹션 토글 2개(scrim_start, patch). 즉시 저장, 낙관적 갱신, 실패하면 되돌림. `discord_linked` false면 안내 | Settings |
| `/scrims/[id]` | reverted이면 「승인 되돌림 · 운영진 · 사유」 Notice, 입력 영역이 다시 열림. `open_dispute_count` 배지. 이의 제기 버튼과 사유 대화상자 / 「이의 제기 접수됨」. 운영진은 「승인 되돌리기」(막히면 비활성 + 이유 문구). 목록·상세 배지·단계에 「결과 되돌림」 | ScrimDetail 확장 |
| 셸 | 사이드바 MENU에 「정보」(랭킹 다음). **모바일 하단 탭은 이미 5칸이 차 있어** 「정보」를 모바일 머리 아이콘으로 열고, 운영진에게만 「관리자」 아이콘도 렌더(기존에는 모바일에서 /admin으로 가는 길이 없었음) | — |

## 훅·API 클라이언트 (웹이 부르는 31개)
- `lib/api/admin.ts` 24개, `lib/api/news.ts` 3개, `lib/api/notification-settings.ts` 2개, `lib/api/scrims.ts`에 revert·disputes 2개. 응답은 모두 shared zod 스키마로 parse합니다.
- 훅: `lib/hooks/admin.ts`(키 `['admin', …]`), `lib/hooks/news.ts`(`['news', …]`), `lib/hooks/notification-settings.ts`(`['me','notification-settings']`), `lib/hooks/scrims.ts`의 `useRevertScrimResult`·`useCreateScrimDispute`.
- 무효화는 13절대로입니다. 결과 변경(승인·반려·되돌리기)은 상세 화면에서 해도 `['scrims']`·`['admin']`·`['dashboard']`·`['rankings']`와 프로필·시즌을, 정보 쓰기는 `['news']`·`['dashboard']`·`['admin','audit']`를, 역할 변경은 members·overview·audit를 무효화합니다.
- 운영진 API가 403이면 `['me']`를 다시 읽고, `/admin`은 overview가 FORBIDDEN이면 FORBIDDEN 상태를 그립니다(D263).
- 노쇼 저장은 바뀐 참가자만 기존 PUT을 차례로 부르고, 첫 실패에서 멈춥니다(`runNoShowChanges`). 실패하면 「앞의 N명은 저장됐어요」를 보여 주고 다시 조회합니다.

## 목 백엔드 (`lib/api/mock/admin.ts`, 31개)
- 판정은 core S6 함수를 그대로 import합니다: `revertBlockReason`, `planRatingRevert`, `disputeBlock`, `seasonPhase`·`seasonEditable`·`validateSeasonWrite`·`validateSeasonDelete`, `planRoleChange`, `adminMemberStatus`, `previewNoShowRestriction`, `newsSubtitle`, `resolveEventsRange`, `dashboardNewsWindow`(logic-dev가 작업 중 추가한 core 소스).
- architect 임시값 교체: `mock/scrims.ts` viewer 4필드 → `mockS6Viewer`, `mock/ratings.ts` 결과 4필드(MockResult에 reverted_* 추가, 기본 null), `mock/rankings.ts` news → `mockDashboardNews`.
- 시드(SEED_VERSION 12): 공지 4(전송됨·대기·72h 경과·알림 없음), 패치노트 4, 이벤트 5(여러 날·게임 무관·다음 달), 이의 제기 3(open 2·resolved 1), API 키 2(사용 중·폐기, CLI 발급), 감사 3, 멤버 운영 정보(운영진 2, ENV 잠금 1, 탈퇴 1, 미연동 2), 「내가 제출한 롤체 로비」(대기, 승인 버튼 비활성), 노쇼 기록용 롤체 연습 5개(칼바람러 제한 중, 원딜장인 「표시하면 참가 제한」).
- 시나리오는 localStorage `gcd-mock-admin`로 고릅니다:
  - `empty`: 목록·홈 news가 빔
  - `error`: 정보·관리 API가 500
  - `demoted`: 운영진 API가 403을 돌려주고, 첫 403 뒤 `GET /me`가 member를 돌려줌(backend.ts)
- 반려하면 이의 제기를 자동 처리하고, 제출 취소·내전 삭제하면 이의 제기를 cascade로 지웁니다.

## 테스트 (18절 frontend 3번)
- 목 되돌리기: 이후 경기가 있으면 later_games로 비활성. 마지막 경기 되돌리기 뒤 레이팅·playing·자동 처리·감사 스냅샷을 확인하고, 앞 경기의 later_games가 풀리는지, 7일 경계, NOT_APPROVED, 자기 제출 결과의 can_review false도 봅니다.
- 그 밖에 확인하는 것:
  - 막는 이유 문구 5종(7은 shared 상수)
  - 노쇼 저장(바뀐 행만, 첫 실패에서 멈춤)
  - API 키 원문 1회(목록에 원문 없음, prefix = 원문 4–12자)
  - 시즌 editable·lead·겹침, 폼 잠금 칸 패치 제외
  - 캘린더(KST 경계, 6주·4주 격자, 여러 날 막대 lane·fromPrev·toNext)
  - 역할 5분기, 이의 제기 중복·반려 자동 처리, 알림 설정, 홈 news 순서, empty 시나리오
- 렌더 테스트 도구가 없어(node 환경, React Testing Library 없음) 아래 셋은 **소스 검사 테스트로 대신**했습니다. 브라우저로도 확인했습니다.
  - 외부 링크 rel
  - 비운영진 FORBIDDEN·STAFF 미렌더
  - S6 화면에 직접 만든 `<button>` 없음

## 공용 컴포넌트 변경
- `Button`에 `size="sm"`(32px 칩)·`size="custom"`, `variant="plain"`을 추가했습니다. 스위치·토글 행·캘린더 막대도 Button으로 만들어 S6 새 화면에는 직접 만든 button이 없습니다. 기존 화면의 raw button(ErrorState 등)은 손대지 않았습니다.
- 새 파일 `components/ui/form.tsx`(Field·입력·CheckboxRow·SwitchRow·FilterChips·PanelHead·ReasonDialog·apiErrorText). 아이콘 6개를 추가했습니다.
- `scrim-teams.tsx` STALE_CODES에 `SCRIM_RESULT_NOT_APPROVED`를 추가했습니다(오래된 화면 → 토스트 + 다시 조회).

## 화면 숫자 출처
- 노쇼 문구·열 이름(`NO-SHOW {window_days}D`)은 서버 정책값입니다. 멤버 표는 `/me/scrim-restriction`의 policy를 씁니다.
- 기한 7·3일, 72시간, 시즌 lead·길이, 글자 수 상한은 shared 상수입니다.
- 페이지 크기(공지 3개 등)는 화면에 보이지 않는 UI 설정값입니다.

## 계약 모호·충돌 (임의로 바꾸지 않음)
1. 멤버 표 NO-SHOW 열 기간: `ListAdminMembersResponse`에 노쇼 정책이 없어 `/me/scrim-restriction` policy를 빌려 씁니다. 응답에 `policy`를 넣을지 architect 판단이 필요합니다.
2. 큐 행에 목업의 「블루 +15 ~ +19」 변동 범위를 그릴 필드가 `AdminResultItem`에 없습니다. 대신 레이팅 상태·승인자 문구를 그렸습니다(필드를 새로 만들지 않음).
3. `SCRIM_RESULT_REVERT_NOT_ALLOWED`의 이유는 message에만 있습니다. 화면은 code로 문구를 정하므로(S0 3절) 시도 응답은 rating_mismatch 문구로 보여 줍니다. 큐·상세의 `revert_blocked_reason`이 다른 이유를 미리 보여 주지만, 경합으로 later_games 등이 시도 때 처음 생기면 문구가 맞지 않을 수 있습니다. `details`에 이유 code를 싣는 것을 제안합니다.
4. 노쇼 경고: 목업은 「저장하면 30일 노쇼 3회가 되어」라고 쓰지만, 이미 기준 이상(지난 제한이 풀린 회원)이면 횟수가 threshold와 다릅니다. 그래서 「저장하면 내전 참가가 제한돼요({정책 문구})」로 썼습니다.
5. `/news`의 `tab` 쿼리 의미(섹션 하나만 보기)는 frontend가 정했습니다.
6. `GET /events` 관리 목록 구간(오늘 − 30일부터 92일)도 frontend가 정했습니다. 운영진 전용 목록이 없어 그 구간 밖 이벤트는 관리 탭에서 보이지 않습니다.

## 목 사용 위치
- 전부 `NEXT_PUBLIC_API_MOCK=true`일 때만 씁니다.
- `lib/api/mock/admin.ts`(새 파일)
- `mock/scrims.ts`(시드·라우팅·viewer), `mock/ratings.ts`, `mock/rankings.ts`, `mock/backend.ts`(시나리오·demoted)

## QA 수정 (`_workspace/03_qa-verifier_s6_web.md` minor 8건, 2026-11-01)
| # | 수정 | 위치 |
| --- | --- | --- |
| 1 | B안: `revertErrorText(code, blocked)` — `SCRIM_RESULT_REVERT_NOT_ALLOWED`면 오류 뒤 다시 읽은 `revert_blocked_reason` 이유 문구, 없으면 rating_mismatch 문구. 큐는 행의 `r.revert_blocked_reason`, 상세는 `viewer.revert_blocked_reason`을 넘긴다(API 변경 없음). 테스트 추가 | `lib/admin.ts`, `admin-results.tsx`, `scrim-result.tsx`, `lib/admin.test.ts` |
| 2 | 상세 되돌리기 403이면 `['me']`도 다시 읽기(D263) | `lib/hooks/scrims.ts` `useRevertScrimResult` |
| 3 | 관리 탭 이벤트 목록에 구간 이동(‹ 이전 · 다음 › · 「오늘 기준」). 공개 `GET /events`를 `EVENTS_RANGE_MAX_DAYS` 길이 구간 단위로 옮긴다 → 모든 기간의 이벤트를 수정·삭제 가능 | `admin-news.tsx` `EventsList` |
| 4 | 「멤버으로」 → 「멤버로」. 역할별 조사 표(`ROLE_TO`)로 확인 대화상자 버튼·토스트 모두 고침. 목 감사 summary도 같은 오류가 있어 함께 고침. 다른 「…으로」 문구는 「운영진으로」뿐이라 맞음 | `admin-members.tsx`, `mock/admin.ts` |
| 5 | 홈 이벤트 행 링크에 `month`(이벤트 시작 달) 추가 → `/news?tab=events&month=YYYY-MM` | `home-view.tsx` |
| 6 | 상세 되돌리기가 ApiError가 아닌 실패(네트워크)여도 대화상자에 오류 문구 | `scrim-result.tsx` |
| 7 | API 키 원문 대화상자를 닫으면 `create.reset()`으로 mutation 결과의 원문까지 지움 | `admin-api-keys.tsx` |
| 8 | 안 쓰는 `usePatchNotesPage` 삭제. `useEvents`는 `next_cursor`가 없을 때까지 이어 받아 한 구간의 이벤트를 모두 합친다(캘린더·관리 목록 공통) | `lib/hooks/news.ts` |

**다시 돌린 검증** (Node 24)
- web typecheck: 통과
- `corepack pnpm exec vitest run`(web): 30개 파일, 344개 통과
- `rm -rf apps/web/.next` 후 build: 통과

**브라우저 확인** (목 모드 개발 서버 3461, 1440·390, 확인 뒤 종료)
- 관리 탭 「다음 구간」으로 다음 달 이벤트가 보이고 「오늘 기준」 버튼이 나온다.
- 역할 확인 대화상자 버튼은 「운영진으로 변경」으로 나온다. 「멤버로 변경」 방향은 브라우저로 보지 않았다(코드로만 확인).
- 홈 이벤트 링크에 `month`가 붙는다.
- 가로 넘침 0, 콘솔 오류 0.

**확인 범위**
- 8번 여러 페이지 이어 받기는 목 데이터가 한 페이지(100건) 안이라 이어 받는 경로는 실제로 돌지 않았다. 코드로만 확인했다.
- api·shared는 손대지 않았다.

## 이의 제기 제거(D281) (2026-11-01, 사용자 결정, 계약 18-1절·13절)
이의 제기 코드는 숨기지 않고 **삭제**했다. 반려·승인 되돌리기·노쇼 UI와 동작은 그대로다.

| 파일 | 변경 |
| --- | --- |
| `lib/errors.ts` | 이의 제기 오류 문구 3줄 삭제 |
| `lib/api/scrims.ts`, `lib/hooks/scrims.ts` | `createScrimDispute`·`useCreateScrimDispute`·import 삭제, 주석 「승인 되돌리기」 |
| `lib/api/admin.ts`, `lib/hooks/admin.ts` | `listAdminDisputes`·`resolveAdminDispute`, `adminKeys.disputes`·`useAdminDisputes`·`useResolveDispute` 삭제(운영진 API 21개) |
| `lib/admin.ts`·`lib/admin.test.ts` | 큐 보기 라벨 2종(대기·최근 승인). 통계 칸 `disputes` → `scrims_week`: 「이번 주 내전」 = `scrims_this_week`, 단위 「경기」, 보조 「월요일부터 · 취소 제외」. 감사 라벨 `dispute.resolve` 삭제. 테스트 기대값 갱신 |
| `components/admin/admin-results.tsx` | `DisputesPanel`·`DisputeRow`·필터·「이의 제기 N건」 배지·행 테두리 분기·disputed 보기·빈 상태 분기 삭제. NO-SHOW는 한 줄 전체 폭. 되돌리기 placeholder 「예: 승리 팀이 반대로 입력됐어요」 |
| `components/scrims/scrim-result.tsx` | `DisputeBar`·「이의 제기 N건 검토 중」 배지·import 삭제, 절 주석 「S6 승인 되돌리기(운영진)」 |
| `components/ui/form.tsx` | ReasonDialog 주석 「(반려·되돌리기)」 |
| `lib/api/mock/ratings.ts` | `openDisputes` 옵션·`open_dispute_count` 삭제 |
| `lib/api/mock/scrims.ts` | 이의 제기 import, viewer `isParticipant`, 반려의 자동 처리, 제출 취소·내전 삭제의 cascade 호출, 주석 삭제 |
| `lib/api/mock/admin.ts` | `MockDispute`·`disputes` 상태 삭제(저장된 목 DB의 옛 `disputes`는 zod 객체가 버린다). 함께 지운 것: `disputeBlock` 사용, `openDisputeCount`·`autoResolveDisputes`·`dropDisputesOf`, 시드 3건, 참가자 이의 제기 핸들러, `GET /admin/disputes`·`POST /admin/disputes/:id/resolve`, overview `open_disputes`, 큐 disputed 보기·`open_dispute_count`. viewer 도우미는 되돌리기 2필드만 돌려준다. 경로 정규식은 `revert`만. 웹이 부르는 목 엔드포인트 28개 |
| `lib/api/mock/admin.test.ts` | 「S6 목: 이의 제기」 describe·자동 처리 단언·`open_dispute_count` 기대값 삭제. 회귀 테스트 1개 추가: 이의 제기 경로 404, 큐 `view=disputed` 400, 상세에 관련 필드 없음 |

`grep -rni "dispute\|이의 제기" apps/web/src` 결과는 회귀 테스트 이름·단언만 남는다.

**검증** (Node 24)
- web typecheck: 통과
- `corepack pnpm exec vitest run`(web): 30개 파일, 343개 통과(이의 제기 테스트 3개 삭제, 회귀 1개 추가)
- `rm -rf apps/web/.next` 후 build: 통과

**브라우저 확인** (목 모드 3461, 1440·390 × 다크·라이트 × 운영진·멤버, 확인 뒤 서버 종료)
- `/admin` 결과 탭: 보기 칩 「대기 · 최근 승인」 2종, 통계 칸 4개(두 번째가 「이번 주 내전 12경기 · 월요일부터 · 취소 제외」)
- 내전 상세(「어제 밤 협곡 내전」 승인됨, 「승인 대기 협곡 내전」): 「이의」 문구가 없다. 운영진에게는 승인 결과의 「승인 되돌리기」가 그대로 있고, 멤버에게는 없다.
- 가로 넘침 0, 콘솔 오류 0.

**참고: 칸 위치가 지시와 다르다**
- 리더 메시지는 「통계 4번째 칸을 이번 주 내전으로」였다.
- 계약 13절·18-1절은 이 값을 **목업 「결과 이의 제기」 칸 자리(두 번째)**에 넣으라고 해서 그 순서를 따랐다: 승인 대기 · 이번 주 내전 · 이번 달 노쇼 · 참가 제한 중.
- 후속 캘린더 작업이 네 번째 칸(참가 제한 중)을 바꾸는 것이라면, 순서는 `lib/admin.ts` `overviewCards` 배열 한 곳만 바꾸면 된다.

## 캘린더 (S6 후속, 계약 23절·13절, D282–D297, 2026-11-01, 목업 없음)

**라우트·호출**
- 홈 `/`: 패널 그리드 아래 전체 폭 `<CommunityCalendar mode="read" />`. `GET /calendar`를 요약과 따로 부른다. 「패치 · 이벤트」 카드는 그대로 둔다. 운영진에게는 「관리 →」(`routes.admin()`)만 보이고 편집 UI는 없다.
- `/admin` 결과 탭: 통계 3칸 → 캘린더(admin) → APPROVAL QUEUE → NO-SHOW. 일정 쓰기는 기존 `POST/PATCH/DELETE /admin/events…`를 쓴다.
- `/news`(`news-view.tsx`): 바꾸지 않았다(D296).

**파일**
- 새 파일: `components/calendar/community-calendar.tsx`, `lib/api/calendar.ts`(`getCalendar`, `GetCalendarResponse` parse), `lib/hooks/calendar.ts`(`calendarKeys`, `useCalendar`: staleTime 60초, keepPreviousData, 4xx는 재시도 안 함), `lib/calendar.ts` + `calendar.test.ts`(15개).
- `lib/admin.ts`·`admin.test.ts`: `restricted` 칸을 지웠다. 값은 `[2, 4, 3]`이고, 「참가 제한 중」 칸이 없다는 단언을 추가했다.
- `admin-results.tsx`: `md:grid-cols-3`. 모바일은 2열이고 세 번째 칸이 `col-span-2`를 차지한다. 스켈레톤도 3칸이다.
- `admin-news.tsx`: `DeleteDialog`·`useGameOptions`·`EventForm`을 export했다. `EventForm`에는 `onSaved?` 콜백만 추가했다(콜백이 없으면 기존 동작).
- 무효화(`['calendar']`): `invalidateAfterResultChange`(승인·반려·되돌리기), `invalidateAfterNewsWrite`(공지·패치·이벤트 쓰기), `applyScrimDetail`(작성·수정·참가·취소·시작·결과), `handleScrimMutationError`(403·404·409), `useDeleteScrim`.
- 목: `S6_EXACT`에 `ApiPath.calendar`를 넣었고, `MockS6Context.summary`를 추가했다. `GET /calendar` 목은 core `resolveCalendarMonth`·`calendarMonthRange`·`kstDateKey`로 구간을 계산한다. 취소 제외, KST 구간, 일정 → 내전 정렬, 한도·truncated, `empty` 시나리오를 처리한다. 시드는 기존 S2 내전·S6 이벤트를 그대로 쓴다(추가하지 않음). 목 테스트 6개는 `mock/admin.test.ts`에 있다.

**검증** (Node 24)
- web typecheck 통과. web vitest 31개 파일 365개 통과. core vitest 516개 통과(calendar.test.ts 15개 포함, logic 구현 완료 뒤 실행).
- `rm -rf apps/web/.next` 후 build 통과.
- 브라우저(목 모드 3461, Playwright, 1440·390 × 다크·라이트 × 운영진·멤버, 28개 화면): 가로 넘침 0, 잘림 0, 콘솔 오류 0.
  - 홈: 운영진·멤버 모두 캘린더 안에 「일정 추가」·「수정」 버튼이 0개다. 「관리 →」는 운영진에게만 보인다.
  - `/admin`: 섹션 순서가 운영 요약 → 일정 → 결과 승인 대기 → 노쇼다. 「참가 제한 중」 문구는 없다. 멤버로 열면 FORBIDDEN이고 캘린더는 보이지 않는다.
  - 데스크톱 다크에서 쓰기 흐름을 끝까지 확인했다: 11월 20일 칸 「+」 → 날짜가 2026-11-20·2026-11-20으로 채워짐 → 등록 → 토스트 「일정을 추가했어요.」 → 막대가 생김 → 막대 클릭 → 「일정 수정」(제목이 채워짐) → 저장 → 「일정을 고쳤어요.」 → 삭제 → 확인 대화상자 「일정을 삭제할까요?」 → 「일정을 삭제했어요.」 → 막대가 사라지고 열린 대화상자 0개.
  - 그 밖에: 상세 「+ 이 날 일정 추가」는 그 날짜로 열리고 Esc로 닫힌다. 내전 줄 링크는 `/scrims/{id}`다. 다음 달·「오늘」·롤체 필터가 동작한다. 모바일 「+ 일정 추가」(오늘 날짜)와 일정 행 「수정」을 확인했다. 시계를 11-12로 고정하면 「지난 일정 7개 보기」로 접히고 펼쳐진다.
  - 개발 서버는 끝난 뒤 종료했다(3461 비어 있음).

**계약 모호·충돌 (임의로 바꾸지 않고 이렇게 처리)**
1. 보고서 파일: 계약 23-7은 `_workspace/02_frontend-dev_s6_calendar.md`를 지정했지만, 리더 지시대로 이 파일 끝에 적었다.
2. `DeleteDialog` 제목은 `${what}를`이라 「일정를」이 된다. 받침이 있으면 「을」을 쓰도록 바꿨다. 기존 호출(공지·패치노트·이벤트)은 모두 받침이 없어 문구가 그대로다.
3. 모바일 목록에서 여러 날 일정은 날마다 되풀이하지 않고 한 번만 보인다. 기준일은 시작일과 그 달 1일 중 늦은 날이다. 이번 달에 이미 시작해 오늘 진행 중인 일정은 오늘에 둔다(지난 일정으로 접히지 않게). 계약에 이 규칙이 없어 정했다. 「지난 일정 N개」의 N은 지난 날짜 묶음 안의 항목 수(일정 + 내전)다.
4. read 모드에서 일정 막대를 누르면 그 주 막대의 첫날을 선택해 상세 목록을 연다. admin 모드에서는 수정 대화상자를 연다.
5. 머리 「+ 일정 추가」는 다른 달을 보고 있어도 오늘 날짜로 연다(계약 문구 그대로).
6. 컴포넌트 렌더 테스트: 웹에 RTL이 없어(node 환경) 만들지 않았다. read 모드에 편집 UI가 없음, 날짜 칸 → 폼 날짜, 내전 링크, 외부 링크 rel은 브라우저 확인과 코드로 대신했다(외부 링크는 `target=_blank rel="noopener noreferrer"`).
7. 노쇼 저장(`useSaveNoShows`)에는 캘린더 무효화를 넣지 않았다. 계약 목록에 없고, 노쇼는 `joined_count`(joined + no_show)를 바꾸지 않는다. 다만 운영진 본인을 노쇼로 표시하면 그 사람의 `my_status`는 60초 staleTime 동안 늦게 반영될 수 있다.
8. `GameCode`가 enum(lol·tft·steam)이라 「games 행 없는 코드 → items []」 경우는 목에서 생기지 않는다. 모르는 코드는 400이다.
9. 홈 캘린더는 계약 23-7 지시대로 `Dashboard` 안(그리드 다음)에 두었다. 그래서 요약 응답 자체가 실패하면 캘린더도 그려지지 않는다. 캘린더가 실패할 때는 카드 안에서만 ErrorState가 뜨고 나머지 홈은 그대로다(D293).

## 일정 시각 · 「다가오는 일정」 (계약 23-8, D298–D310, 목업 없음)

**화면**
- `/admin` 결과 탭 통계 4칸(`admin-results.tsx` `StatsGrid`): `grid-cols-2 md:grid-cols-3 xl:grid-cols-4`. 노쇼는 `col-span-2 md:col-span-1`, 「다가오는 일정」은 `col-span-2 md:col-span-3 xl:col-span-1`. 스켈레톤 4개(4번째 h-[236px]). 통계 칸은 위 정렬(flex-col, 늘어나도 숫자 위치 그대로).
- `UpcomingCard`: cyan 점 + 「다가오는 일정」 + 「오늘부터 {ADMIN_UPCOMING_DAYS}일」. 행 = 날짜·시각·게임·제목·칩(좁은 칸 두 줄, md 전체 폭 한 줄). 내전 행만 `Link`(`routes.scrim`, aria-label 「11월 13일 21:00 금요 5:5 내전 상세」), 일정 행은 링크 없음. 빈 상태 「다가오는 일정이 없어요」, `has_more`면 「캘린더에서 더 보기 ↓」(`#admin-calendar`). 목록 `aria-label="다가오는 일정 N개"`.
- 캘린더 카드: `CommunityCalendar`에 `id` prop 추가 → `/admin`만 `id="admin-calendar"` + `scroll-mt-4`.
- 시각 표시: `lib/news.ts` `eventScheduleText`·`eventTimeText`. 캘린더·`/news` 막대 첫 조각에 `21:00 ` 접두사, title·aria-label = `eventScheduleText`. 캘린더 날짜 상세·모바일 행, `/news` `EventDetail`, 관리자 이벤트 목록 meta = `eventScheduleText`. 홈 「패치 · 이벤트」 이벤트 행은 `start_time`이 있으면 태그 옆에 `eventTimeText`. 캘린더 대화상자 안내 = 「시각을 비우면 종일 일정으로 저장돼요」.
- `EventForm`: 「시작 시각(선택)」「종료 시각(선택)」 `<input type="time">`. 빈 값 = null, 시작을 비우면 종료 값도 비우고 입력을 막는다. 힌트 「비우면 종일 일정이에요」. 수정 초기값 = `editing.start_time ?? ''`. 저장 본문은 POST·PATCH 모두 `CreateEventRequest` 결과 전체(`start_time`·`end_time`을 늘 함께 보냄 → `start_time: null`이면 `end_time: null`도 같이 감).
  - 클라이언트 검증은 shared `eventScheduleIssues`를 따로 호출한다. zod 4에서는 필드 오류(예: 제목 비어 있음)가 있으면 `superRefine`이 돌지 않아 시각 오류가 늦게 보이기 때문이다. 오류는 종료 시각 칸 아래에 바로 표시하고, 등록·저장은 `CreateEventRequest.safeParse` 실패로 막힌다.
- 무효화: `invalidateAfterNewsWrite`에 `adminKeys.overview`. `hooks/scrims.ts`의 3곳(`applyScrimDetail`·`handleScrimMutationError`·`useDeleteScrim`)에 `ADMIN_OVERVIEW_KEY`(`hooks/calendar.ts`에 정의, `adminKeys.overview`도 같은 상수를 씀).

**목** (`lib/api/mock/admin.ts`)
- `MockEvent.start_time·end_time = EventTime.nullable().default(null)`(예전 localStorage 상태 호환). `eventView`·홈 news 이벤트 행·캘린더 일정 항목·`overview.upcoming`이 1단계 optional 필드를 항상 채운다.
- `eventOrder` = core `compareEventSchedule`(GET /events·캘린더·홈 news·upcoming 공통). `scrimItem`·`eventItem`·`byScheduled`를 핸들러 위쪽으로 옮겨 캘린더와 overview가 함께 쓴다.
- overview `upcoming`: core `upcomingWindow`·`mergeUpcomingItems`, 일정(ends_on ≥ from && starts_on ≤ to, 게임 무관 포함, MAX+1), 내전(취소 제외, [now, scrimBefore), MAX+1), `empty` 시나리오 → 빈 목록.
- PATCH: 저장값과 합친 4필드를 shared `eventScheduleIssues`로 검사한다. 오류 details path는 `ends_on`·`end_time` 그대로. 기존의 기간 검사 코드를 이것으로 바꿨다.
- 시드: 「월즈 결승 응원 내전」 19:00–23:00(하루, 시작·끝), 「롤체 신규 세트 출시」 21:00(여러 날, 시작만).

**테스트**
- `lib/news.test.ts`: 6가지 표기, 옛 응답(필드 없음) = 종일, `eventTimeText` 4가지.
- `lib/admin.test.ts`: `upcomingRows` — undefined → [](1단계), 진행 중 「진행 중 · ~MM.DD」, 종일·시작만·시작–끝, 내전 KST(15:00Z 경계), 스팀 「모집」, 내 참가 bold, 응답 순서.
- `lib/api/mock/admin.test.ts`(7개 추가): 생성 시각·종일·end_time만 400·같은 날 역순 400·같은 시각 허용·여러 날 역순 통과·감사 details 시각, PATCH 병합(D300 예 4가지 + 기간), 정렬(종일 → 종일 이틀 → 08:00 → 21:00, GET /events·캘린더), 시드 시각·홈 news 시각, upcoming(구간·시작 순·취소/지난 내전 제외·shared parse, 6개 이상이면 5개 + has_more, 진행 중 일정 맨 앞, empty).

**검증** (Node 24, core 4함수 구현·dist 완료 확인 뒤)
- web typecheck 통과, web vitest 31개 파일 380개 통과, `rm -rf apps/web/.next` 후 build 통과.
- 브라우저(목 모드 3462, Playwright; 1440·390 × 다크·라이트 + 1024 다크): 가로 넘침 0, 잘림 0, 콘솔 오류 0.
  - 4칸 배치: 1440은 4열 한 줄(각 272px), 1024는 3열 + 다음 줄 전체 폭(720px), 390은 2열 / 노쇼 전체 폭 / 다가오는 일정 전체 폭.
  - 「다가오는 일정 5개」, 첫 행 「진행 중 · ~11.05 종일 · 게임 무관 · 서버 2주년 이벤트」, 내전 링크 4개(href·aria-label 확인), 「캘린더에서 더 보기 ↓」를 누르면 캘린더 카드가 화면 위(top 16px)로 온다.
  - 홈: 이벤트 행에 「19:00–23:00」. `/news`: 막대 「19:00 월즈 결승 응원 내전」·「21:00 롤체 신규 세트 출시」(다음 주 조각에는 접두사 없음), aria-label 「… 11.07 21:00 – 11.11」, 모바일 목록 「11.03 19:00–23:00」.
  - 흐름(1440·390 다크): 「+ 일정 추가」 → 시각 입력 2개, 종료 입력은 막혀 있음 → 21:00/20:00 → 「종료 시각은 시작 시각 이후」 + 등록 비활성 → 23:00 → 등록 → 「일정을 추가했어요.」 → 다가오는 일정에 「11.01 (일) 21:00–23:00 … 일정」, 막대 「21:00 시각 확인 d」 → 수정 열기(21:00·23:00 채워짐) → 시작 시각 비우기 → 종료가 비고 막힘 → 저장 → 「일정을 고쳤어요.」(400 없음 = 두 시각이 함께 null로 감) → 「11.01 (일) 종일」.
  - 개발 서버는 끝난 뒤 종료했다(3462 비어 있음).

### 일정 시각 — 계약 모호·충돌 (임의로 바꾸지 않고 이렇게 처리)
1. `upcomingRows(u, now)` / `<UpcomingCard … now={now} />`: 표기 규칙(23-8-5)에 `now`가 필요한 곳이 없다. 「진행 중」 판정은 `starts_on < upcoming.from`(서버 값)이고, 내전 날짜는 응답의 `date`를 쓴다. 그래서 `upcomingRows(u)`, `<UpcomingCard upcoming={…} />`로 `now` 없이 만들었다. 필요하면 인자만 다시 추가하면 된다.
2. 「스팀 모집이면 「모집」 — 화면에 이미 있는 규칙」: 칩 문구를 정하는 함수가 따로 없어, `ScrimGameRef.has_results === false`(shared 주석 「false면 인원 모집」, `scrim-results.ts` recruitment 분기와 같은 기준)이면 「모집」, 아니면 「내전」으로 했다.
3. 「일정 추가」 같은 이동 링크: 23-8-5 「다가오는 일정」 카드에는 「캘린더에서 더 보기 ↓」만 정의돼 있어 그것만 넣었다(카드에 「일정 추가」 링크는 없음, 추가는 바로 아래 캘린더 머리 「+ 일정 추가」).
4. 내전 행 링크 이름은 계약 예 「… 금요 5:5 내전 상세」를 `{제목} {칩} 상세`로 일반화했다. 그래서 제목이 「… 내전」으로 끝나면 「… 내전 내전 상세」처럼 반복된다(계약 모양 그대로 둠).
5. `eventTimeText`를 여러 날 일정에 쓰면 끝 시각을 붙이지 않는다(「21:00」). 끝 시각이 다른 날의 시각이라 「21:00–18:00」처럼 보이면 안 되기 때문이다. 계약 정의는 「하루 목록용」이고, 홈·다가오는 일정의 여러 날 일정이 이 규칙을 따른다.
6. `/news`의 막대에는 원래 aria-label이 없었다(이름 = 글자). 23-8-5 「title·aria-label은 eventScheduleText」에 따라 캘린더와 같은 모양 「일정 {제목} {eventScheduleText}」을 넣었다. 이 때문에 `/news` 막대의 접근성 이름이 바뀌었다.
7. `EventForm` 오류 문구는 shared 메시지를 그대로 보여 준다(「종료 시각은 시작 시각 이후」·「종료 시각은 시작 시각이 있을 때만」). 화면용 문장(「…이후여야 해요」)으로 바꾸려면 shared 메시지나 웹 매핑 중 어디서 할지 정해야 한다. 종료 시각 칸 힌트(「시작 시각 이후」/「종료일의 시각」/「시작 시각을 먼저 정해 주세요」)는 계약에 없어 새로 넣었다.
8. 2단계(D305) 대비: 웹은 `upcoming`이 없으면 빈 목록으로 그린다(`upcomingRows(undefined) → []`, 해당 테스트 1개). 2단계에서 optional이 빠지면 `upcomingRows` 인자 타입, `admin.test.ts` 「1단계」 단언, `admin-results.tsx` 주석 1줄을 정리하면 된다. `lib/news.ts` `EventSchedule`의 optional 시각 필드는 홈 news 등 다른 타입과도 맞추려고 남겨도 문제없다.

## QA 수정(캘린더) — `_workspace/03_qa-verifier_s6_calendar_web.md` minor 4건

1. **내전 행 링크 이름의 반복**(`lib/admin.ts` `upcomingRows`): 제목(뒤 공백 제거)이 칩 문구로 끝나면 칩을 생략한다. 예: 「화요일 저녁 5:5 내전」 → 「… 5:5 내전 상세」, 「금요 5:5」 → 「… 금요 5:5 내전 상세」. 칩과 다른 단어로 끝나면 그대로 붙인다(「스팀 내전」 + 모집 → 「스팀 내전 모집 상세」). 위 「일정 시각 — 계약 모호·충돌」 4번은 이것으로 해소됐다. 테스트 1개(5가지 경우).
2. **시각 오류 문구 해요체**(`lib/admin.ts` `eventScheduleIssueText`, `admin-news.tsx` `EventForm`의 시작 시각·종료 시각·하단 오류 3곳): shared 이슈에는 code가 없어 `path + shared 메시지`로 구분해 매핑한다. 모르는 이슈는 shared 메시지로 폴백한다.
   - `ends_on`·「ends_on은 starts_on 이후」 → 「종료일은 시작일과 같거나 그 뒤여야 해요」
   - `ends_on`·「이벤트 기간은 최대 {EVENT_SPAN_MAX_DAYS}일」 → 「일정 기간은 최대 {EVENT_SPAN_MAX_DAYS}일까지예요」(shared 상수)
   - `end_time`·「종료 시각은 시작 시각이 있을 때만」 → 「종료 시각만 입력할 수 없어요. 시작 시각을 먼저 정해 주세요」
   - `end_time`·「종료 시각은 시작 시각 이후」 → 「종료 시각은 시작 시각 이후여야 해요」
   - `start_time`/`end_time`·「HH:mm 형식이어야 함」(zod `EventTime`) → 「시각은 HH:mm 형식이어야 해요」
   - 테스트 2개. 실제 `eventScheduleIssues`·`EventTime.safeParse` 출력으로 매핑하므로 shared 메시지가 바뀌면 테스트가 실패한다. 폴백도 검사한다. 위 7번(오류 문구) 항목은 이것으로 해소됐다.
3. **주석**(`lib/admin.ts` 이번 주 내전 칸): 「결과 이의 제기」 문구를 지우고 「목업 두 번째 칸 자리(그 칸의 기능은 D281로 제거)」로 바꿨다.
4. **노쇼 저장 무효화**(`lib/hooks/admin.ts` `useSaveNoShows` onSettled): `calendarKeys.all` 무효화를 추가했다. S6 캘린더 7번(노쇼 저장에 캘린더 무효화 없음)은 이것으로 해소됐다.

**검증** (Node 24): web typecheck 통과, web vitest 31개 파일 383개 통과(+3), `rm -rf apps/web/.next` 후 build 통과. 목 모드 브라우저(1440·390)에서 21:00/20:00 입력 시 「종료 시각은 시작 시각 이후여야 해요」가 보이고, 다가오는 일정 링크 이름은 「11월 1일 22:30 화요일 저녁 5:5 내전 상세」(반복 없음)이다. 가로 넘침·콘솔 오류 0. 개발 서버(3462)는 종료했다. api·shared는 바꾸지 않았다.
