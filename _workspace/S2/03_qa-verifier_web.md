# QA: S2 apps/web (내전 화면 3개 + 스팀 팝업 완료 페이지 + 목 백엔드) — 판정: pass

대상: `apps/web/src/{app/(main)/scrims/**, app/steam-link/complete, components/scrims/**, components/settings/{game-accounts-section,steam-link-complete}.tsx, lib/{scrims,steam-link-popup,routes,errors,games}.ts, lib/api/scrims.ts, lib/hooks/scrims.ts, lib/api/mock/{scrims,backend,game-accounts}.ts, middleware.ts}`
기준: 계약 `_workspace/01_architect_contract.md` 2·4·6·8·9-2절, D86·D87·D91·D93, 프런트 보고서 `02_frontend-dev_scrims.md`, 백엔드 보고서 `02_backend-dev_scrims.md`, core QA `03_qa-verifier_core.md` 참고 항목, 목업 Scrims·ScrimNew·ScrimDetail
사용 가능 도구: Read, Grep, Glob, Bash(Git Bash), Write. 브라우저·스크린샷 도구 없음.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter web typecheck` | `tsc -p tsconfig.json --noEmit` 출력 없음(오류 0) |
| `corepack pnpm --filter web test` | routes 6, nickname 6, scrims 15, steam-link-popup 7, client 14, game-accounts 17, format 7, mock/backend 5, hooks/game-accounts 2, mock/game-accounts 10, mock/scrims 19, theme 15, middleware 2 → **Test Files 13 passed (13), Tests 125 passed (125)** |
| `corepack pnpm --filter web build` | `✓ Compiled successfully`, `Linting and checking validity of types` 통과, 12/12 페이지. `○ /scrims 3.23 kB`, `ƒ /scrims/[id] 8.3 kB`, `○ /scrims/new 176 B`, `○ /steam-link/complete 5.22 kB`, `ƒ Middleware 50.6 kB`. exit 0 |
| 목 규칙 ↔ core 무작위 대조(스크래치, 코드 미수정) | mock/scrims.ts:159-194의 `orderWaitlist`·`validatePositions`·`computeOpenPositions`·`computeRestriction`을 그대로 떼어 `packages/core/dist`의 `orderWaitlist`·`validatePreferredPositions`(ok 여부)·`computeOpenPositions`·`computeScrimRestriction`과 각 20,000건 비교(동률 joined_at·짧은 id, 포지션 0–5개·정원 2–16·null/범위 밖 1지망, 임의 정책 1–4/1–30/1–10·반나절 양자화 시각·미래 시각). **불일치 0건** `{"wait":0,"open":0,"restr":0,"pos":0}` |
| 하드코딩 색 검사 | S2 파일(components/scrims, steam-link-complete, game-accounts-section, app/(main)/scrims, app/steam-link, lib/games.ts, lib/scrims.ts)에 hex·rgb·hsl 0건. 색 유틸리티(bg-/text-/border-/fill-/stroke-…)를 globals.css `--color-*` 토큰 목록과 대조 → 토큰 밖 색 0건(나온 것은 text-sm·border-dashed 같은 크기·모양 유틸리티와 bg-transparent뿐). globals.css가 `--color-*: initial`로 기본 팔레트를 지움 |

미실행: 브라우저 목 모드 데스크톱·모바일 × 라이트·다크 육안 확인, 팝업 차단 수동 절차(브라우저 도구 없음). 결함이 아니라 미검증 항목이다.

## 결함

blocker 0, major 0, minor 5.

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 1 | minor | apps/web/src/lib/api/mock/scrims.ts:159-194, :446-450, :462-479, :574-581 | 목이 core 규칙을 그대로 써서 core가 바뀌면 같이 바뀐다 | `orderWaitlist`·`validatePositions`·`computeOpenPositions`·`computeRestriction`·`canStart`·자동 마감·`settleRoster`(= planRosterAfterChange)·`scheduleIssue`(= validateScrimSchedule)를 목 안에 다시 적었다. 지금은 무작위 대조 불일치 0건이라 동작은 같다 | core는 시계·env·I/O 없이 `@gcd/shared`만 의존(core QA 확인). `apps/web/package.json`에 `"@gcd/core": "workspace:*"`를 넣고 목에서 import하기를 권고. 정책·정원 값이 env로 바뀌거나 S3에서 규칙이 늘면 갈라질 수 있다 |
| 2 | minor | apps/web/src/lib/api/mock/scrims.ts:720-730(POST /join), :797-806(PATCH /scrims/:id) | 서버와 같은 판정 순서: Nest `@Body(ZodValidationPipe)`가 서비스(NOT_FOUND)보다 먼저 → 없는 내전 + 잘못된 본문 = 400 VALIDATION_FAILED | 목은 NOT_FOUND를 먼저 보고 그다음 본문을 parse → 같은 요청이 404 | 목 모드에서 `POST /scrims/{없는 uuid}/join` 본문 없이 → 목 404, 실제 API 400. 화면 동작에 영향 없음(둘 다 「찾을 수 없음」 또는 오류 문구) |
| 3 | minor | apps/web/src/components/scrims/scrims-view.tsx:144 | 「더 보기」 실패 문구가 실제 오류 코드를 따른다 | `errorMessage('NETWORK_ERROR')` 고정. 커서 400(VALIDATION_FAILED)·401 등도 「연결」 문구로 보인다 | 다른 탭 커서처럼 서버가 400을 주면 네트워크 오류 안내가 뜬다. `isApiError(list.error) ? errorMessage(list.error.code) : …`로 첫 페이지 오류(:110)와 같게 처리 권장 |
| 4 | minor | apps/web/src/components/scrims/scrim-detail.tsx:149-153, lib/hooks/scrims.ts:85 | 카운트다운이 0이 되면 「시작 시각이 지나 참가·취소할 수 없어요」로 바뀐다 | `join_closed`는 서버값이라 다음 재조회(최대 20초)까지 카운트다운이 `00:00:00`에 머물고 참가 버튼이 남는다. 누르면 서버가 SCRIM_JOIN_CLOSED(409)로 거절 → 문구 + 상세 재조회로 복구되므로 데이터 문제는 없다(D93대로) | 시작 1분 전 모집글 상세를 열어 두고 0초가 지난 직후 「참가하기」 → 409 문구. 0초 도달 시 `refetch()` 한 번 부르기를 권장 |
| 5 | minor | apps/web/src/components/scrims/scrim-detail.tsx:389-398 | 계약 8절 「joined → 「노쇼 표시」(can_mark_no_show일 때)」 | 운영진이면 기한이 지나도 버튼을 **비활성 + 이유 툴팁**으로 보인다(누를 수는 없음). 서버 판단(can_mark_no_show)으로 막고 있어 안전하지만 계약 문구(노출 조건)와 다르다 | role admin으로 시작 7일이 지난 종료 내전 상세 → 비활성 「노쇼 표시」 버튼. 의도된 UX라면 계약 문구만 맞추면 된다 |

## 교차 대조 표 — 엔드포인트 11개

| # | 계약 4절 | 백엔드 컨트롤러 | 웹 API(lib/api/scrims.ts) → 응답 parse | 웹 훅(lib/hooks/scrims.ts) | 목 핸들러(mock/scrims.ts) | 일치 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | GET /games | games.controller `@Get(ApiPath.games)` | listGames :30 → `ListGamesResponse` | useGames :56 | :584 | O |
| 2 | GET /scrims | `list` `@Get(ApiPath.scrims)` + `ListScrimsQuery` | listScrims :42(game·status·cursor·limit) → `ListScrimsResponse` | useScrims :66(useInfiniteQuery, next_cursor) | :605(탭·정렬·커서 t 검사) | O |
| 3 | POST /scrims 201 | `create` `@HttpCode(201)` | createScrim :52 → `CreateScrimResponse` | useCreateScrim :121 | :634 → 201 | O |
| 4 | GET /scrims/:id | `get` | getScrim :57 → `GetScrimResponse` | useScrim :79(모집 중 20초 + 포커스) | :803 | O |
| 5 | PATCH /scrims/:id | `update` | updateScrim :62 → `UpdateScrimResponse` | useUpdateScrim :131 | :805 | O |
| 6 | POST /scrims/:id/join(본문 필수) | `join` `@Body(JoinScrimRequest)` 200 | joinScrim :67 → `JoinScrimResponse` | useJoinScrim :141 — 항상 `{ preferred_positions }` 전송(포지션 없는 게임은 `[]`) | :729 본문 없음 → VALIDATION_FAILED(테스트 :378) | O |
| 7 | DELETE /scrims/:id/join | `leave` 200 | leaveScrim :72(본문 없음) → `LeaveScrimResponse` | useLeaveScrim :151 | :764 | O |
| 8 | POST /scrims/:id/start | `start` 200 | startScrim :77 → `StartScrimResponse` | useStartScrim :161 | :778 | O |
| 9 | POST /scrims/:id/cancel | `cancel` 200 | cancelScrim :82 → `CancelScrimResponse` | useCancelScrim :171 | :787(reason host/admin) | O |
| 10 | PUT /scrims/:id/players/:userId/no-show | `setNoShow` RolesGuard + `@Roles('admin')` | setScrimNoShow :87(`{no_show}`) → `SetScrimNoShowResponse` | useSetScrimNoShow :181 | :685(역할 검사 먼저) | O |
| 11 | GET /me/scrim-restriction | `myRestriction` | getMyScrimRestriction :95 → `GetMyScrimRestrictionResponse` | useMyScrimRestriction :91 | :590 | O |

- 경로는 모두 `ApiPath` + `fillPath`(웹 하드코딩 경로 없음). 응답은 `apiClient.request(path, schema)`가 `safeParse`, 실패하면 INVALID_RESPONSE(client.ts `parseBody`). 제네릭 단언만 있는 호출 없음.
- snake_case 그대로: 훅·화면이 `joined_count`, `open_positions`, `viewer.can_*`, `restricted_until` 등을 변환 없이 사용.
- 상태 변경 응답 → `applyScrimDetail`(상세 캐시 `setQueryData` + 목록 무효화, D87). 실패 → `handleScrimMutationError`: SCRIM_BANNED면 제한 조회 무효화, 403·404·409면 상세·목록 무효화.
- 목 viewer 규칙(mock :547-562)과 백엔드(scrim-views.service.ts:214-232), shared 주석(scrims.ts:203-209)이 같은 식: can_join·can_leave·can_edit·can_cancel·can_start·can_mark_no_show, `preferred_positions`는 joined·waitlist일 때만, `waitlist_order`는 (joined_at, 행 id) 순서. 목·백엔드 모두 scrim_players 행 id로 동률 처리.

## 오류 코드 7개

| code | 웹 문구(lib/errors.ts) | 화면 처리 |
| --- | --- | --- |
| SCRIM_NOT_RECRUITING | :46 | 상세 재조회 → 닫힌 상태 문구(ClosedStateText) |
| SCRIM_JOIN_CLOSED | :47 | 재조회 → 「시작 시각이 지나 참가·취소할 수 없어요」 Notice, 방장은 수정 안내 |
| SCRIM_HOST_CANNOT_LEAVE | :48 | 방장은 can_leave false라 버튼 없음 + 안내 문구(:603) |
| SCRIM_BANNED | :49 + 해제 시각 | `scrimErrorText`(scrim-bits.tsx:114): 조회값 `restriction.until` 우선, 없으면 `Retry-After`로 「MM.DD HH:mm에 풀려요」. errorMessageWithRetry가 SCRIM_BANNED에 「N분 뒤」를 붙이지 않음(errors.ts:100) |
| SCRIM_CAPACITY_BELOW_JOINED | :50 | 수정 대화상자 서버 오류 + 클라이언트 사전 검사(edit-dialog:55, 스테퍼 min = max(정원 하한, joined)) |
| SCRIM_CANNOT_START | :51 | 방장 메뉴 InlineError, can_start false면 버튼 비활성 + `startBlockedReason` |
| SCRIM_NO_SHOW_NOT_ALLOWED | :52 | 참가자 목록 InlineError |

`ERROR_MESSAGES: Record<AppErrorCode, string>`이라 36개 누락은 typecheck가 막는다(통과).

## 상태별 화면

| 상태 | 상세 배지 / 진행 단계 | 참가 영역 | 방장 메뉴 |
| --- | --- | --- | --- |
| recruiting | 「모집 중」, 1단계 current, 카운트다운 | can_join → 참가하기, 참가 중 → 포지션 변경 + 참가 취소 | 수정·시작(조건 미달 비활성 + 이유)·모집 취소 |
| full | 「정원 마감 · 팀 구성 중」, 1 done·2 current, WAITLIST 섹션 | 「대기열 등록」 + 「지금 신청하면 대기 N번」 | 같음 |
| recruiting·full + join_closed | 「시작 대기」, 카운트다운 대신 「시작 시각이 지났어요」 | Notice(방장에겐 미루기 안내) | 같음 |
| playing | 「경기 진행 중」, 1–2 done·3 current | 진행 중 문구 | 없음(can_* false), 운영진 노쇼 표시·정정 |
| finished | 「종료」, 4단계 모두 done | 「끝난 내전이에요」 | 운영진 노쇼(기한 안) |
| cancelled | 단계 대신 「취소된 내전 · 방장/운영진/자동 취소」 + 취소 시각 | 「취소된 내전이라…」 | 없음 |

`lib/scrims.ts` `scrimSteps`·`scrimDetailBadge`·`scrimCardBadge`·`CANCEL_REASON_TEXT`가 계약 6절 표와 일치. 버튼 노출은 `viewer.can_*`만(운영진 노쇼 버튼의 노출 조건은 결함 5).

## 라우트-링크 대조

| 라우트 | app 파일 | 링크 생성 |
| --- | --- | --- |
| /scrims(?game&status, open 생략) | app/(main)/scrims/page.tsx(Suspense로 useSearchParams 감쌈, 빌드 ○) | `routes.scrims(q)` — 필터·탭 `router.replace`, 상세·작성의 「← 내전 목록」 |
| /scrims/new | app/(main)/scrims/new/page.tsx | `routes.scrimNew()` — 헤더 버튼·빈 상태 |
| /scrims/[id] | app/(main)/scrims/[id]/page.tsx | `routes.scrim(id)` — 카드 제목·버튼, 작성 성공 `router.push` |
| /steam-link/complete | app/steam-link/complete/page.tsx(그룹 밖) | API 콜백 302(`STEAM_LINK_COMPLETE_PATH` = 같은 값), 목 authorize_url |

- S2 파일에 `/scrims` 문자열 하드코딩 링크 없음(`scrims-view.tsx:37` pathname 비교와 nav 활성 판정만).
- middleware matcher(middleware.ts:26) 제외 목록에 추가된 것은 `steam-link/`(슬래시 포함)뿐 → `/steam-link/` 아래만 쿠키 검사 제외. `/scrims`, `/scrims/new`, `/scrims/abc`, `/settings`는 계속 검사(middleware.test.ts). 범위 과다 아님.

## 스팀 팝업(9-2)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 클릭에서 동기적으로 window.open | O | game-accounts-section.tsx:612(mutate 전에 연다) |
| 차단(null) → display=redirect + location.assign | O | :614-620 |
| 열림 → display=popup, 성공 시 popup.location.href, 실패 시 close + 토스트 + 리스너 정리 | O | :648-669 |
| window message origin 검사 | O | steam-link-popup.ts:109-111 `ev.origin !== o.origin` 무시 |
| 스키마 검사 | O | `SteamLinkPopupMessage.safeParse`(strict, type literal) :42-45 |
| 첫 메시지만 | O | `done` 플래그 + 첫 유효 메시지에서 cleanup 후 onResult :102-108 (테스트 7개) |
| BroadcastChannel 리스너 600초 유지, 닫힘 1초 감시 → 1회 재조회 + 버튼 복구 | O | :23, :655-661 |
| 완료 페이지가 refresh를 부르지 않음 | O | steam-link-complete.tsx는 API 호출 없음. 루트 layout의 `Providers`(providers.tsx)는 QueryClient 생성·onSession 등록만, 쿼리 실행 없음. AppShell(인증 부팅)은 (main) 그룹에만 있음 |
| 쿼리 파싱 실패 → INTERNAL_ERROR, 두 경로 전송 후 close, 300ms 뒤 「설정으로 돌아가기」(`routes.settings(query)`) | O | steam-link-popup.ts:26-39, steam-link-complete.tsx:24-37, :74 |

## 목업 대조

- 게임 필터: 선택 = `bg-accent text-on-accent`, 점 = `bg-on-accent`, 비선택 = 투명 + `text-text-2` + 게임 점 색 → 목업 Scrims.dc.html:178과 같다. 숫자 배지는 D86대로 없음.
- 상태 탭: 선택 = `border-line-3 bg-surface-2 font-semibold text-text`, 높이 36·반경 10 → 목업과 같다.
- 카드: 상태 알약(모집 중 accent / 정원 마감 orange / 참가 중 cyan), 버튼(참가하기 accent / 대기열 등록 line-2 / 참가 중 surface-2 + accent-ink), 내 카드 테두리 accent 35%(목업 `#D4FF3A55` → `border-accent/35` 토큰), 보조 줄 `text-orange-ink-2` → 목업 상수와 같다.
- 상세 진행 단계: done = accent 배경·✓, current = on-accent 배경·accent-ink 글자·accent 테두리, todo = line-3 테두리·faint → 목업 ScrimDetail.dc.html:278-284와 같다.
- 작성 게임 카드: 선택 = `border-accent bg-accent/5`(목업 `#D4FF3A0D`를 토큰으로), 비선택 `border-line bg-surface-2`.
- 라이트/다크: 모든 색이 토큰 유틸리티라 `data-theme` 전환을 따른다. 실제 렌더 육안 확인은 미실행.

## 웹 목 ↔ core

- 무작위 대조 불일치 0건(위 표). 대기열 순서(joined_at → 행 id 코드 유닛), 1지망 = `preferred_positions[0]`, open_positions 식(나누어떨어지지 않으면 `[]`), 노쇼 판정(발동 m마다 (m − window, m], until = 최대 발동 + restriction, 미래 시각 무시, recentCount·last)이 core와 같다.
- 승격(`settleRoster`)은 대기 1번부터 빈 자리만큼, preferred_positions·joined_at 유지 → `planRosterAfterChange`와 같은 결과. 시작 조건(`capacity_min === capacity_max`면 꽉 참, 아니면 2명)도 같다.
- 그래도 복사본이라 결함 1로 core import를 권고한다.

## 결함 처리 (리더, 2026-10-29)

| # | 처리 |
| --- | --- |
| 1 | 그대로 둠(목 전용, 무작위 대조 불일치 0건). core import는 이후 슬라이스에서 검토 |
| 2 | 그대로 둠(목 전용 판정 순서, 실제 API 영향 없음) |
| 3 | 수정: scrims-view.tsx 「더 보기」 오류도 `isApiError ? errorMessage(code) : NETWORK_ERROR` |
| 4 | 수정: scrim-detail.tsx `useJoinClosed` — 시작 시각 도달 즉시 화면에서 join_closed로 취급(카운트다운 → 「시작 시각이 지났어요」, 참가 영역 → 안내 문구)하고 상세를 한 번 재조회 |
| 5 | 수정: `can_mark_no_show`가 false면 「노쇼 표시」 버튼을 숨김. 「노쇼 정정」은 서버가 기한을 걸지 않으므로(scrims.service.ts:397-401) 그대로 노출 |

QA 재검증 없음. 리더가 `pnpm -r typecheck`(4개 Done), `pnpm -r test`(shared 53, core 148, web 125, api 332 passed / 27 skipped), `pnpm --filter web build`(성공)만 확인. 브라우저 육안 확인은 미실행.

## 참고

- core QA 결함 1(open_positions 합계가 빈 자리보다 클 수 있음)은 카드 보조 줄 「… 구함」에 그대로 보인다(scrims.ts:203). 계약 식을 따른 결과라 웹 결함으로 잡지 않았다.
- 프런트 보고서 경로는 계약 12절(`02_frontend-dev_s2.md`)과 다르다(리더 지시 이름).
