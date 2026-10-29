# frontend-dev 보고서 — S2 내전 화면 + 인증 보완 2

계약: `_workspace/01_architect_contract.md`(S2) 8·9-2절. Q1–Q3는 계약 기본값(D78·D76·D83)대로.

## 화면(라우트)

| 라우트 | 파일 | 호출 엔드포인트 |
| --- | --- | --- |
| `/scrims` | `app/(main)/scrims/page.tsx` → `components/scrims/scrims-view.tsx`, `scrim-card.tsx` | GET /games, GET /scrims(커서, limit 12, 「더 보기」), GET /me/scrim-restriction |
| `/scrims/new` | `app/(main)/scrims/new/page.tsx` → `scrim-new-form.tsx` | GET /games, GET /me/scrim-restriction, POST /scrims |
| `/scrims/[id]` | `app/(main)/scrims/[id]/page.tsx` → `scrim-detail.tsx`, `scrim-edit-dialog.tsx`, `position-picker.tsx` | GET /scrims/:id(모집 중 20초 + 포커스 재조회), PATCH, POST·DELETE /join, POST /start, POST /cancel, PUT …/no-show, GET /games, GET /me/scrim-restriction |
| `/steam-link/complete` | `app/steam-link/complete/page.tsx` → `components/settings/steam-link-complete.tsx` | 없음(/auth/refresh 호출 안 함) |

- 목록: 게임 필터(선택 = accent 배경)·상태 탭이 URL 쿼리(`game`, `status`, open은 생략)와 동기화. 카드 배지·보조 줄·버튼 문구는 계약 8절(모든 버튼이 상세로 이동, D91). 탭별 빈 상태, 오류 재시도, 「HH:mm 기준 · 새로 고침」.
- 작성: 게임 카드(설명은 has_teams·has_positions로), 제목 2–40자, 날짜+시간(KST → `YYYY-MM-DDTHH:mm:00+09:00`), 정원 스테퍼(min = max면 「10명 고정」), 방장 희망 포지션(1지망 필수·2지망 선택), 토글 3개(속성 없으면 비활성), 규칙 1000자, PREVIEW 카드. 클라이언트 검사 + `CreateScrimRequest.safeParse` + 서버 VALIDATION_FAILED details를 필드 아래에. 제한 중이면 배너 + 제출 비활성.
- 상세: 헤더(오늘 21:00 · 방장 · ELO 반영…, 카운트다운 HH:MM:SS/N일, 규칙 접기), 진행 단계 4개(cancelled는 이유 문구), ROSTER 슬롯 capacity개(빈 자리, 방장·노쇼 배지, 1·2지망 칩, 프로필 링크), WAITLIST(모집 중일 때만), 참가 영역(포지션 선택·참가하기/대기열 등록·포지션 변경·참가/대기 취소 확인, 결과 토스트 「참가 확정」/「대기 N번」, join_closed·제한 안내), 방장/운영진 메뉴(수정 대화상자, 시작 확인 — can_start false면 비활성 + 이유, 모집 취소 확인), 운영진 노쇼 표시(확인)·정정, AUTO BALANCE·RESULT 빈 상태 카드(S3 자리).
- 버튼 노출은 서버 `viewer.can_*`만 따른다(D93). 상태 변경 응답(ScrimDetail)으로 상세 캐시 교체 + 목록 무효화(D87). 403·404·409 오류면 상세·목록 재조회, SCRIM_BANNED면 제한 조회 재요청 + 해제 시각 문구(Retry-After 대체).

## 훅(`lib/hooks/scrims.ts`) ↔ API(`lib/api/scrims.ts`) ↔ 계약 4절 — 11개 일대일

useGames(GET /games) · useScrims(GET /scrims, useInfiniteQuery) · useScrim(GET /scrims/:id) · useCreateScrim(POST /scrims) · useUpdateScrim(PATCH /scrims/:id) · useJoinScrim(POST /scrims/:id/join, 본문 항상 `{preferred_positions}`) · useLeaveScrim(DELETE /scrims/:id/join) · useStartScrim(POST …/start) · useCancelScrim(POST …/cancel) · useSetScrimNoShow(PUT …/players/:userId/no-show) · useMyScrimRestriction(GET /me/scrim-restriction). 응답은 전부 shared 스키마로 parse.

backend 확정 사항 대조: (1) join 본문 필수 — 훅은 항상 객체를 보내고 목도 본문 없음을 VALIDATION_FAILED로 처리(테스트). (2) no_show면 viewer.preferred_positions [] — 목·테스트 일치. (3) last_no_show_at null — 화면이 쓰지 않음. (4) 경로 11개 일치.

## 목(mock) 사용 위치

`NEXT_PUBLIC_API_MOCK=true`일 때 `lib/api/mock/scrims.ts`(backend.ts에 연결)가 11개 엔드포인트를 흉내 낸다: 대기열 승격(joined_at·포지션 유지), recruiting ↔ full, 자동 마감(60분), 노쇼 제한(규칙 5-6, Retry-After), 커서 base64url, 권한 순서. core 함수는 web 의존성이 아니어서 같은 규칙을 목 안에 작게 복사했다.
시드: 모집 중 13개(마지막 페이지 확인용), 시작 대기 1, 진행 중(내가 참가) 1, 종료 1, 취소 1. 내가 방장인 정원 마감+대기 2명, 내가 참가 중인 모집글 포함. dev-login username이 `noshow`로 시작하면 노쇼 3회를 심어 제한 상태, role admin이면 노쇼 버튼 확인 가능.
스팀 목: display=popup이면 authorize_url = `/steam-link/complete?steam=linked`.

## 인증 보완

- 스팀 팝업(`components/settings/game-accounts-section.tsx` `useSteamLinkPopup`, 로직 `lib/steam-link-popup.ts`): 클릭에서 동기적으로 `window.open('', 'gcd-steam-link', 'popup,width=520,height=720')` → null이면 display=redirect + `location.assign`(기존 /settings?steam= 토스트 흐름 그대로) → 열리면 display=popup 요청 후 `popup.location.href`, 실패 시 팝업 닫기 + 오류 토스트. 결과는 BroadcastChannel + window message(origin 일치) 둘 다 듣고 `SteamLinkPopupMessage.safeParse` 성공한 첫 메시지만 처리 → 계정 목록 invalidate + 토스트 + 리스너 정리. 1초마다 popup.closed 감시, 메시지 없이 닫히면 1회 재조회·버튼 복구, 리스너는 600초까지 유지.
- 완료 페이지: 그룹 밖, API 호출 없음. 쿼리 파싱 실패·빈 쿼리 → INTERNAL_ERROR. 두 경로로 보낸 뒤 `window.close()`, 300ms 뒤에도 열려 있으면 결과 + 「설정으로 돌아가기」(`routes.settings(query)`).
- middleware matcher에 `steam-link/` 제외 추가(`middleware.test.ts`로 확인). matcher는 Next 정적 분석 때문에 문자열 리터럴 유지.
- 9-1 리프레시 미회전: 클라이언트는 Set-Cookie를 읽지 않는다. 200 + Set-Cookie 없음을 연속으로 받아도 세션 유지되는 테스트를 `client.test.ts`에 추가.

## 그 밖의 변경

`lib/routes.ts`(scrims(q), scrimNew, scrim(id), steamLinkComplete), `lib/errors.ts`(S2 7개 문구 다듬기, SCRIM_BANNED는 「N분 뒤」 대신 해제 시각), `lib/games.ts`(`GAME_SCRIM_META` 토큰 클래스, `positionLabel`), `components/ui/controls.tsx`(ConfirmDialog `confirmVariant`), `lib/scrims.ts`(KST·배지·단계·문구·PATCH 조립 순수 함수).

## 검증

- `corepack pnpm --filter web typecheck` 통과
- `corepack pnpm --filter web test` 13 파일 125 테스트 통과(S2 신규: mock/scrims 19, scrims 15, steam-link-popup 7, middleware 2, routes·client 각 1)
- `corepack pnpm --filter web build` 통과(/scrims ○, /scrims/new ○, /scrims/[id] ƒ, /steam-link/complete ○)
- 미실행: 브라우저 목 모드 데스크톱·모바일 × 라이트·다크 육안 확인과 스크린샷(이 세션에서 브라우저 도구 없음). QA 또는 수동 확인 필요.

## 팝업 차단 대체 경로 수동 확인 절차

1. `NEXT_PUBLIC_API_MOCK=true`로 실행, 로그인 후 /settings.
2. 주소창 팝업 차단 아이콘에서 localhost 팝업을 「차단」으로 설정 → 「Steam으로 로그인」 → 같은 창이 /settings?steam=linked로 이동하고 성공 토스트, 쿼리 제거 확인.
3. 팝업 허용 후 스팀 연동 해제 → 다시 클릭 → 작은 창이 열렸다 바로 닫히고 원래 창에 성공 토스트 + 스팀 카드가 새로고침 없이 나타남.
4. 완료 페이지를 직접 열기(`/steam-link/complete?steam_error=STEAM_LINK_CANCELLED`) → 300ms 뒤 오류 문구 + 「설정으로 돌아가기」 표시, 네트워크 탭에 /auth/refresh 없음.
5. 실제 API: 팝업에서 스팀 로그인 창을 그냥 닫기 → 1초 안에 버튼이 「Steam으로 로그인」으로 돌아오고 계정 목록 1회 재조회.

## 계약 변경 요청

없음. 참고(차단 아님): `ScrimGameRef`에 정원 범위가 없어 상세의 「시작 불가 이유」·수정 대화상자 정원 범위는 GET /games로 보완한다. 상세에서 /games 실패 시 수정 대화상자 대신 재시도 안내를 띄운다.
