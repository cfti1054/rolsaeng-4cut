# QA: web (apps/web S1) — 판정: pass (minor 1)

작성: qa-verifier, 2026-10-29
대상: `/settings`의 게임 계정 연동·디스코드 섹션, `/members/[id]`, 훅 8개(`lib/hooks/game-accounts.ts`), API 함수(`lib/api/game-accounts.ts`), 목 백엔드(`lib/api/mock/game-accounts.ts`, `backend.ts` 위임), `lib/errors.ts`·`lib/tiers.ts`·`lib/format.ts`·`lib/game-accounts.ts`
구현자 보고서: `_workspace/02_frontend-dev_s1.md`
기준: 계약 4·6-1·8·12절, D38·D48·D53·D58·D60·D61·D65(다른 아이콘 받기)·D66(롤체 1위 표기), P5·P6 처리. 체크리스트 `_workspace/03_qa-verifier_plan.md` E절.
제외: 실제 API와의 교차 대조. 백엔드가 구현 중이라 s1 단계에서 한다.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `rm -rf apps/web/.next` 후 `corepack pnpm --filter web typecheck` | 오류 0 |
| `corepack pnpm --filter web test` | **9 files, 80 passed** — 보고서 수치와 같음 |
| `corepack pnpm --filter web build` | 성공. `/settings` 7.72 kB(Static), `/members/[id]` 8.23 kB(Dynamic), Middleware 49.4 kB — 보고서와 같음 |
| `grep -rnE "#[0-9A-Fa-f]{3,8}\b\|rgba?\(" components app --include=*.tsx` | 0건 — hex·rgb 직접 사용 없음(D53) |
| `grep -rnE "1421\|\+21\|#3 ELO\|76561\|58%" components app --include=*.tsx` | 0건 — 목업의 가짜 숫자·스팀 ID·「순방 %」를 하드코딩하지 않음 |
| `TIER_META` 토큰 11개(`text-faint` … `text-orange-text`, `text-muted`) ↔ `app/globals.css`의 `--color-*` | 11개 모두 정의돼 있음 |
| `grep -rn "riotgames\|steampowered\|steamcommunity.com/openid\|ddragon" apps/web/src` | 0건 — 외부 API 직접 호출 없음. 아이콘 이미지는 서버가 준 `icon_image_url`만 사용 |
| 응답 단언 검색(`as GetMyGameAccountsResponse`, `as GetUserProfileResponse`, `as any`) | 0건. 캐시 갱신용 `setQueriesData<…>` 제네릭 1곳뿐(파싱된 데이터를 다시 씀) |
| 브라우저 렌더(데스크톱·모바일 × 라이트·다크) | **미실행**(도구 없음) |

## 체크리스트 대조

### E1 훅·호출
- 훅 8개가 계약 12절의 이름 그대로 있음.
- API 함수 8개가 모두 `apiClient.request(fillPath(ApiPath.x, {id}), shared스키마, …)` 형태(lib/api/game-accounts.ts:20-61). 메서드는 계약 4절과 같음.
- 204 응답(DELETE 2개)은 `schema=null` 경로라 본문을 파싱하지 않음(client.ts:220).
- `Retry-After`는 `ApiError.retryAfterSec`로 받음(client.ts `parseRetryAfter`). RATE_LIMITED와 GAME_PROVIDER_RATE_LIMITED는 「N초/분 뒤 가능」으로 안내함(`errorMessageWithRetry`). SYNC_LIMIT_EXCEEDED는 「자정(한국 시간)」 문구로 대신함.
- 캐시 처리:
  - 대표 지정: 낙관적 갱신, 실패하면 롤백(테스트 있음).
  - 소유 확인·해제: 성공하면 `mine`·`profiles`를 무효화.
  - sync: 202 응답의 accounts·quota를 바로 반영.
- 필드 이름은 snake_case 그대로 쓰고 camelCase로 바꾸지 않음.

### E2 설정 화면
- 섹션 순서: 화면 테마 → 게임 계정 연동 → 디스코드(settings/page.tsx:17-19). 알림 섹션 없음(D48). 디스코드 「연동 코드 발급」 UI 없음(D23).
- 라이엇 카드:
  - lol·tft 두 행을 display_name으로 묶음. 카드 id·sync는 lol 행 기준(P6, lib/game-accounts.ts:48-51).
  - 「대표」 배지, 「라이엇 ID · 롤, 롤체 공통 · … 동기화」, 롤·롤체 티어 요약.
  - 동기화 실패 안내는 `SYNC_ERROR_MESSAGES`, 즉 GameAccountSyncError 7개를 Record로 매핑.
  - 버튼: 「지금 갱신 · 오늘 N회 남음」(remaining 0이면 비활성), 부계정에만 「대표로 지정」, 「연동 해제」 확인 대화상자(대표면 승격될 계정 이름 안내).
- 부계정 추가: `limits.riot_accounts_max`(D61)보다 적고 진행 중 확인이 없을 때만 보임. 한도에 닿으면 비활성 + 안내. 0개면 「라이엇 ID 연동」(D58).
- 소유 확인 카드:
  - 입력 검증은 shared `RiotIdInput`을 재사용(정규식 복제 없음).
  - 아이콘 이미지가 없으면 `#번호`, 카운트다운 1초 간격 mm:ss.
  - 만료(클라이언트 0초, 서버 expired, 410)되면 「다시 시작」.
  - OWNERSHIP_CHECK_FAILED·RATE_LIMITED는 카드 안에 인라인으로 표시.
  - 「이 아이콘이 없나요? 다른 아이콘 받기」(D65).
  - 단계 표기는 1/2, 대조 중에는 2/2(P5).
- 스팀:
  - 미연동이면 「Steam으로 로그인」 버튼 1개로 `location.assign(authorize_url)`.
  - 연동됨이면 personaname(D38, ID 숫자 없음), 「보유 게임 N개」.
  - STEAM_PROFILE_PRIVATE면 「게임 정보 비공개」 배지, 목업 문구, 「다시 시도 · 오늘 N회 남음」, 「마지막 성공 값(MM.DD)」.
- 콜백 쿼리: `SettingsPageQuery`로 파싱하고, 실패하면 무시 → 토스트 → `router.replace('/settings')`. 잘못된 값이어도 쿼리는 지움.

### E3 프로필 화면
- 헤더: 주 포지션 1순위 영문 워터마크, 「멤버/운영진 · YYYY.MM 가입」. ELO 순위는 표시 안 함.
- 연동 칩: 라이엇 display_name(대표 표기), 「스팀 연동됨」, 디스코드 연동/미연동. 외부 ID는 표시하지 않음.
- 갱신 버튼: `is_self`이고 quota가 있을 때만. 대상은 `tiers`의 lol `game_account_id`, 없으면 스팀 행(계약 8절 마지막 줄).
- 카드 4개:
  - 티어: tiers가 비면 「미연동」, rank null이면 「동기화 대기 중」, UNRANKED면 「이번 시즌 기록 없음」.
  - 롤체 보조 줄: 「1위 N회 (비율)」(D66).
  - 주 포지션: 「솔로 랭크 최근 N경기 기준 탑 NN%」.
  - 내전 레이팅: 「준비 중」.
- RATING HISTORY·BADGES·SCRIMS는 빈 상태. `scrim`·`badges`가 null이니 그대로 맞음.
- 최근 솔로 랭크:
  - `recent_matches`가 null이면 「라이엇 계정이 없어요」.
  - items가 비고 `refresh_queued`면 스켈레톤, 아니면 빈 상태.
  - 「라이엇 API · 시각」 표시.
  - `refresh_queued`면 10초 뒤 한 번 다시 조회(hooks:135-143).
- UUID가 아니거나 NOT_FOUND·VALIDATION_FAILED면 「멤버를 찾을 수 없어요」. 로딩·오류 상태 있음.

### E4 폴링·시각·기타
- 폴링: `sync.state ≠ idle`이면 2초, 진행 상태를 처음 본 시각부터 60초까지(`nextPollInterval`, 테스트 있음). 설정·프로필 둘 다 적용.
- 시각 표기는 `Intl.DateTimeFormat(timeZone: 'Asia/Seoul')`로 KST 고정(format.ts). 브라우저 시간대와 무관함(format.test 있음).
- 티어 색 매핑표는 `lib/tiers.ts` 한 곳에만 있고 토큰만 씀(D53). 항상 마크·라벨 텍스트를 함께 씀.
- `routes.settings(q)`를 추가함. 프로필·설정 링크는 모두 `routes.*`로 만듦.
- 목 백엔드: 9개 엔드포인트 중 브라우저가 호출하지 않는 steam callback을 뺀 8개를 흉내 냄. 응답은 `GameAccountView.parse` 등 shared 스키마를 통과함. 스팀 `authorize_url`은 `/settings?steam=linked`. 목 테스트 10개가 실제 클라이언트의 zod 파싱 경로로 흐름을 검증함(내부 필드 비노출 포함).

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| m1 | minor | `apps/web/src/components/settings/game-accounts-section.tsx:349`(`open` 상태), 351(verifying 조기 반환), 368(`open && state==='more'`) | 부계정 소유 확인이 끝나면 「+ 부계정 추가」 버튼 상태로 돌아감 | `RiotAddArea`는 verifying일 때 다른 요소를 반환하지만 같은 트리 위치에 남아 있어 `open=true`가 유지됨. 확인이 성공해 `riot_verification`이 null이 되고 라이엇 ID가 아직 한도보다 적으면 입력 폼이 다시 열린 채로 보임 | 목 모드: 라이엇 1개 연동 → 「+ 부계정 추가」 → ID 입력 → 「바꿨어요, 확인」(5초 뒤 성공) → 새 카드 아래에 「부계정 추가」 입력 폼이 열린 채 남음. 데이터 오류는 아니고 표시 문제(취소 후 다시 열리는 것은 의도일 수도 있음) |

## 참고 (결함 아님)

1. 소유 확인 카운트다운은 클라이언트 시계로 계산한다(`Date.parse(expires_at) - now`). 계약 12절은 기준 시계를 정하지 않았다. 판정은 서버가 하므로(만료 410) 시계가 어긋나도 데이터에는 영향이 없다.
2. `sortAccounts`(낙관적 갱신 전용)는 verified_at이 같을 때 display_name으로 순서를 정한다. 계약은 id 순이다. 서버 응답이 오면 바로 덮어쓰므로 영향이 없다. `unlinkPromotes`는 서버 정렬을 안정 정렬로 유지해 계약과 같은 결과다.
3. 폴링 60초 상한에 걸린 뒤 같은 계정이 idle로 돌아오지 않은 채 다시 「지금 갱신」을 누르면 폴링이 재개되지 않는다. 서버가 10분 넘게 멈춘 상태에서만 생기는 경우다.
4. `lib/api/client.ts`의 `export type FetchLike =(input…` 띄어쓰기 1곳이 포맷과 다르다(동작 무관).
5. 실제 API와의 교차 대조(오류 코드 실제 반환, `limits`·`GAME_ACCOUNT_ALREADY_LINKED_TO_ME` 응답)는 s1 단계에서 한다.
