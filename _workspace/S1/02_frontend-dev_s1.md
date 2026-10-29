# S1 frontend (apps/web) 보고

## 범위와 라우트

| 라우트 | 내용 | 호출 엔드포인트 | 목 |
| --- | --- | --- | --- |
| `/settings` | 화면 테마(S0 유지) → 게임 계정 연동 → 디스코드 계정(읽기 전용). 알림 섹션 없음(D48) | GET/POST `/me/game-accounts`, POST `…/riot-verifications/:id/confirm`, DELETE `…/riot-verifications/:id`, POST `…/:id/primary`, POST `…/:id/sync`, DELETE `…/:id`, GET `/me` | `NEXT_PUBLIC_API_MOCK=true`일 때 |
| `/members/[id]` | 배너(주 포지션 영문 워터마크, 역할·가입 월), 연동 칩, 본인이면 「지금 갱신 · 오늘 N회 남음」, 카드 4개(롤 솔로·롤체·주 포지션·내전 레이팅 빈 상태), RATING HISTORY·BADGES·SCRIMS 빈 상태, RANKED SOLO 최근 10경기 | GET `/users/:id/profile`, POST `…/:id/sync` | 같음 |
| 사이드바·하단 탭 「내 프로필」 | S0 `nav-items.ts`가 이미 `routes.member(me.id)`로 연결함(변경 없음) | - | - |

## 계약 대응

- 훅 8개 `src/lib/hooks/game-accounts.ts`: useMyGameAccounts, useSetPrimaryGameAccount(낙관적 갱신 + 롤백, 옵션 팩토리 `setPrimaryMutationOptions`), useLinkGameAccount, useConfirmRiotVerification, useCancelRiotVerification, useUnlinkGameAccount, useSyncGameAccount, useUserProfile. 모든 응답은 `src/lib/api/game-accounts.ts`에서 shared zod로 parse(`apiClient.request(path, Schema)`), 경로는 `fillPath(ApiPath.x, {id})`.
- 폴링(6-1): `sync.state ≠ idle`이면 2초, 처음 본 시각부터 60초까지(`nextPollInterval`). 프로필 `refresh_queued`면 10초 뒤 1회 재조회.
- 라이엇 카드: display_name으로 lol·tft 묶음, 동기화 정보·카드 id는 lol 행 기준(P6). 대표 배지, 「대표로 지정」, 「연동 해제」(네이티브 dialog, 대표면 승격될 계정 이름 안내), 롤·롤체 티어 요약, 동기화 실패 안내.
- 「+ 부계정 추가」: `라이엇 ID 수 < limits.riot_accounts_max` 이고 진행 중 확인이 없을 때(D58·D61). 도달 시 비활성 + 안내. 0개면 「라이엇 ID 연동」 입력 카드가 바로 보임.
- 단계 표기(P5): 입력 화면 표기 없음, 아이콘 카드 「소유 확인 1 / 2 단계」, 확인 요청 중 「2 / 2 단계 · 아이콘 대조 중」. 카운트다운 1초 갱신, 0이거나 서버 expired면 「다시 시작」(같은 라이엇 ID로 POST)·「취소」. OWNERSHIP_CHECK_FAILED·RATE_LIMITED(「N초 뒤 가능」)는 카드 안 인라인. 「이 아이콘이 없나요? 다른 아이콘 받기」(D65) = 같은 라이엇 ID로 POST 재시작(서버가 기존 pending 취소 + 새 아이콘).
- 스팀: 「Steam으로 로그인」 → `location.assign(authorize_url)`. 연동됨: personaname(D38), 「보유 게임 N개」, STEAM_PROFILE_PRIVATE면 「게임 정보 비공개」 배지 + 목업 문구 + 「다시 시도 · 오늘 N회 남음」 + 「마지막 성공 값(MM.DD)」(synced_at 있을 때).
- 콜백 쿼리: `parseSteamCallbackQuery`(SettingsPageQuery 전체 parse, 실패 시 무시) → 토스트 → `router.replace('/settings')`. 잘못된 값도 쿼리는 지움.
- 갱신 시각: KST 고정 표기 `formatSyncedAt`(방금 / N분 전 / 오늘 HH:mm / MM.DD HH:mm), `<time title=전체 시각>`.
- 티어 색 매핑표 `src/lib/tiers.ts` 한 곳(D53, 토큰만). 게임·제공자·포지션 메타 `src/lib/games.ts`.
- `ApiError.retryAfterSec` 추가(`Retry-After` 헤더 정수 초 파싱, `client.ts`). 기존 S0 테스트 그대로 통과.
- `lib/errors.ts`: S1 문구 다듬음. LIMIT_REACHED·ALREADY_LINKED·ALREADY_LINKED_TO_ME 3줄은 architect 수정본 그대로 둠. `SYNC_ERROR_MESSAGES`(GameAccountSyncError 7개, 계약 2절 표 문구), `errorMessageWithRetry` 추가.
- `routes.settings(q?: SettingsPageQuery)`.

## 목 사용 위치

`src/lib/api/mock/game-accounts.ts`(backend.ts가 인증 후 위임, localStorage `gcd-mock-db`의 `s1`에 저장, 형식이 안 맞으면 s1만 버림). 흉내 규칙:
- 게임 이름 `notfound` → RIOT_ID_NOT_FOUND, `nosummoner` → RIOT_SUMMONER_NOT_FOUND, `taken` → GAME_ACCOUNT_ALREADY_LINKED(다른 멤버), `busy` → GAME_PROVIDER_RATE_LIMITED(Retry-After 30), 내 목록에 있는 라이엇 ID → GAME_ACCOUNT_ALREADY_LINKED_TO_ME.
- 첫 「확인」은 OWNERSHIP_CHECK_FAILED, 5초 뒤부터 성공. 아이콘 이미지 url은 null(번호만 표시 경로).
- 동기화 작업자: queued → 1.5초 → running → 1.5초 → idle. 스팀 첫 동기화는 STEAM_PROFILE_PRIVATE, 다음은 84개 성공.
- 스팀 시작 시 행을 바로 만들고 `authorize_url = {origin}/settings?steam=linked`.
- 다른 멤버 프로필 1개 고정: `/members/0b9f6a52-8c1d-4e3a-9f27-5d6c7b8a9e10`(대표+부계정). 그 밖 id는 NOT_FOUND, UUID 아님은 VALIDATION_FAILED(화면은 「멤버를 찾을 수 없어요」).
- 같은 사용자로 다시 로그인하면 연동 상태 유지, 다른 사용자면 초기화.

## 검증

- `corepack pnpm --filter web typecheck` 통과
- `corepack pnpm --filter web test`: 9개 파일 80개 통과(S0 44 + S1 36). S1: `lib/game-accounts.test.ts`(묶기·P6, 부계정 추가 조건과 limits, 남은 시간·08:42·만료, applyPrimary, 승격 안내, 폴링 2초/60초, 스팀 콜백 쿼리 파싱), `lib/hooks/game-accounts.test.ts`(대표 지정 낙관적 갱신·성공·실패 롤백, QueryClient + MutationObserver), `lib/api/mock/game-accounts.test.ts`(실제 클라이언트 zod 파싱으로 목 9개 흐름: 소유 확인·5초 간격 Retry-After·만료 410·다른 아이콘 받기(D65)·오류 구분 7종·한도 limits·대표 지정/해제 승격·스팀 비공개→성공·새로고침 미차감/5회/자정 Retry-After·프로필 빈 상태/대표 기준/타인 sync_quota null/내부 필드 비노출), `lib/format.test.ts`(KST 표기, 티어 표기, Retry-After).
- `.next` 삭제 후 `next build` 통과(2026-10-29 재실행). 출력: `/settings 7.72 kB (First Load 153 kB, Static)`, `/members/[id] 8.23 kB (152 kB, Dynamic)`, Middleware 49.4 kB.
- 재실행 결과(같은 날, `.next` 삭제 후 순서대로): typecheck 오류 0, test `Test Files 9 passed (9) / Tests 80 passed (80)` — theme 15, routes 5, nickname 6, client 13, format 7, game-accounts 17, mock backend 5, mock game-accounts 10, hooks 2.
- 미실행: 실제 브라우저 렌더링(데스크톱·모바일 × 라이트·다크 스크린샷) — 이 환경에 브라우저 도구가 없음. 실제 백엔드 연결 미확인.

## 목업과 다른 점·판단

1. 롤체 보조 줄(D66): 목업 「순방 %」 대신 「N LP · 1위 W회 (1위 비율%)」(wins=1위, losses=2–8위). `tiers.ts` `tftRankSub`.
2. 티어 색 매핑: EMERALD→accent-ink, PLATINUM→cyan-text, DIAMOND→blue-text, MASTER→violet-text, GRANDMASTER→pink-ink, CHALLENGER→orange-text, IRON→faint, UNRANKED→muted. 항상 마크(E3)·라벨 텍스트를 함께 씀.
3. 프로필 「#3 ELO」 배지, 내전 카드 값은 S3 전까지 표시 안 함(빈 상태).
4. 사이드바 사용자 카드의 「ELO 1421 · #3」은 S0 그대로(멤버/운영진 · @username).
5. 동기화 중 버튼은 「갱신 중…」으로 비활성(서버는 미차감 202를 주지만 중복 요청 자체를 막음).
6. 부계정 카드에 「대표는 프로필·랭킹 기준」 한 줄 안내 추가.

## 리더 확인 요청

없음. 계약 변경 D60(ALREADY_LINKED_TO_ME, 목도 본인/타인 구분), D61(limits), P5(단계 표기), P6(lol 행 기준 동기화), D65(다른 아이콘 받기), D66(롤체 1위 표기)은 모두 반영함. 참고: 재개 공지에는 D65·D66 번호가 서로 바뀌어 적혀 있었으나 계약 14절 기준(D65=아이콘, D66=롤체)으로 맞춤.

## 사용 도구

Read, Grep, Glob, Bash(Git Bash, node 사용 — python 없음), Write, Edit.
