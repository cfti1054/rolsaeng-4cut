# 계약: S1 게임 계정 연동·티어 동기화, 프로필·설정 화면

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서"), 슬라이스: `_workspace/00_input/slice.md`
선행 계약: `_workspace/S0/01_architect_contract.md`(D1–D31). 와이어 형식(S0 3절), 인증(S0 5절), 테마 규칙(S0 9절)은 그대로 쓴다. 이 문서는 S0 계약을 **확장**한다.
실제 계약은 코드가 우선한다: `packages/shared/src/**`, `apps/api/prisma/schema.prisma`.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-28 | S1 최초 작성: 연동·소유 확인·동기화·프로필 계약, 스키마 증분(마이그레이션 `20261028120000_s1`), 오류 코드 13개, 환경 변수 11개(→ 이후 변경으로 표 13행, 11절) | architect |
| 2026-10-28 | 「확인 필요」 Q1–Q3 사용자 답변 반영. Q1: 라이엇 부계정 허용 + 대표 계정(D37 변경, D56–D58 추가) — `game_accounts.is_primary`, (user_id, game_id) UNIQUE 삭제, 부분 고유 인덱스(마이그레이션 수동 추가), `POST /me/game-accounts/:id/primary`, `GameAccountView.is_primary·rank`, 환경 변수 `RIOT_ACCOUNTS_MAX`. Q2: D45 확정. Q3: D40 확정. 영향 파일: `packages/shared/src/game-accounts.ts`·`profile.ts`·`paths.ts`·`constants/games.ts`·`contract.s1.test.ts`, `apps/api/prisma/schema.prisma`, `migrations/20261028120000_s1/migration.sql`(재생성), `.env.example`, 이 문서 1·2·3·4·5·6·8·11·12·13·14·15·16절 | architect |
| 2026-10-28 | QA 계약 점검(`_workspace/03_qa-verifier_plan.md` P1–P7) 반영. **P1** sync_state 전이 맵에 멈춘 행 전용 전이 3개(queued→queued, running→queued, running→running) 추가 + `SYNC_STATE_STALE_MS`·`isStaleOnlySyncTransition`. **P4** `GetMyGameAccountsResponse.limits`(riot_accounts_max, steam_accounts_max) + `STEAM_ACCOUNTS_MAX`. **P3** 오류 코드 `GAME_ACCOUNT_ALREADY_LINKED_TO_ME` 분리(전체 29개), LIMIT_REACHED·ALREADY_LINKED 문구 갱신. P2 스팀 1개 DB 보장·P2002 구분 규칙, P5 단계 표기 1/2로 통일, P6 matches_synced_at은 lol 행 기준, P7 환경 변수 13행, 10절 apex rank 무시. 스키마 변경 없음. 영향 파일: `packages/shared/src/constants/transitions.ts`·`game-accounts.ts`·`common/errors.ts`·`contract.s1.test.ts`, `apps/api/src/common/app-error.ts`, `apps/web/src/lib/errors.ts`(32–34행) | architect |

---

## 1. 범위

### 포함 (문서 2장 행 기준)

| 문서 2장 행 | S1 범위 |
| --- | --- |
| 계정 · 게임 계정 연동 (P0) | 라이엇 ID 연동 + 프로필 아이콘 소유 확인(lol·tft 2행, D25) — 라이엇 ID 최대 3개(부계정), 대표 계정 지정(D56). Steam OpenID 연동(1개), 연동 해제 |
| 프로필 · 내 프로필 (P0) | **대표 라이엇 계정** 기준 게임별 티어(롤 솔로 랭크, 롤체 랭크), 주 포지션(솔로 랭크 최근 경기), 최근 전적(솔로 랭크). 부계정은 연동 칩에만. 내전 승률·레이팅 그래프·뱃지는 **빈 자리**(`scrim: null`, `badges: null`) |
| (9장) 캐싱·갱신 | 티어 1시간(최근 활동 멤버 우선), 최근 전적 6시간 캐시(프로필 조회 시 큐 등록), 스팀 플레이타임 하루 1회 05:00 KST, 수동 새로고침 하루 5회(KST 자정 초기화), 429 `Retry-After` 대기 |
| (8장) 화면 | `/members/[id]` 프로필, `/settings`의 「게임 계정 연동」·「디스코드 계정」(읽기 전용) 섹션. 「화면 테마」는 S0 그대로 |

### 제외

내전 레이팅·그래프·승률·내전 기준 주 포지션(S3), 뱃지(P2), 알림 설정(알림 발송 기능 생기는 슬라이스, D48), 활동·플레이타임 랭킹(S5 — S1은 데이터 수집까지), 티어 랭킹 화면·티어 점수 계산(S4 — enum과 순서값만 S1에서 확정), 운영진 수동 소유 승인(S6 — 경로만 예약), 롤체 최근 전적(D40).

---

## 2. 오류 코드 (S1 추가분, `packages/shared/src/common/errors.ts`)

S0 오류 코드 15개는 그대로. 아래 14개 추가(전체 29개).

| code | HTTP | 발생 |
| --- | --- | --- |
| GAME_PROVIDER_NOT_CONFIGURED | 503 | `RIOT_API_KEY`(라이엇 연동·동기화) 또는 `STEAM_API_KEY`(스팀) 비어 있음 |
| GAME_PROVIDER_ERROR | 502 | 요청 처리 중 라이엇·스팀 호출 실패: 401/403(키 만료·권한), 5xx·타임아웃(1회 재시도 후), 응답 형식 불일치 |
| GAME_PROVIDER_RATE_LIMITED | 503 | 요청 처리 중 외부 429, 또는 서버 토큰 버킷이 3초 안에 비지 않음. **`Retry-After` 헤더(초)** 동반 |
| GAME_ACCOUNT_LIMIT_REACHED | 409 | 라이엇 ID가 이미 `RIOT_ACCOUNTS_MAX`개(기본 3), 또는 스팀을 이미 1개 연동함(D37). 한도는 `GetMyGameAccountsResponse.limits`로 웹에 전달 |
| GAME_ACCOUNT_ALREADY_LINKED | 409 | 그 외부 계정(PUUID·스팀 ID)이 **다른 멤버**에게 연동돼 있음 → 「운영진에게 문의」(D45) |
| GAME_ACCOUNT_ALREADY_LINKED_TO_ME | 409 | 내가 이미 연동한 라이엇 ID를 다시 추가(부계정 추가 시). 스팀은 1개라 이 경우 LIMIT_REACHED |
| RIOT_ID_NOT_FOUND | 404 | Account-V1 by-riot-id 404 |
| RIOT_SUMMONER_NOT_FOUND | 404 | Summoner-V4(kr) by-puuid 404 — KR 롤 기록 없음, 아이콘 확인 불가 |
| OWNERSHIP_CHECK_FAILED | 409 | 현재 아이콘 ≠ 지정 아이콘. 확인은 pending 유지(다시 확인 가능) |
| OWNERSHIP_CHECK_EXPIRED | 410 | 확인 제한 시간 경과, 또는 cancelled 상태 확인에 confirm |
| STEAM_LINK_STATE_INVALID | 400 | `gcd_steam` 쿠키 없음·서명 불일치·600초 초과·쿼리 state 불일치 |
| STEAM_LINK_CANCELLED | 400 | `openid.mode=cancel` |
| STEAM_OPENID_INVALID | 400 | `openid.mode`≠id_res, op_endpoint·return_to·claimed_id 검증 실패, `check_authentication` 결과 `is_valid:true` 아님 |
| SYNC_LIMIT_EXCEEDED | 429 | 오늘(KST) 수동 새로고침 한도 소진. **`Retry-After` = 다음 KST 자정까지 초** |

- `Retry-After`는 응답 **헤더**로만 준다(오류 본문은 S0 그대로 `{code, message}`). backend는 `AppError`에 `retryAfterSec` 옵션을 추가하고 error filter가 헤더를 붙인다.
- 기존 코드 재사용: `NOT_FOUND`(남의 계정·확인 id 포함 — 존재 여부를 숨긴다), `RATE_LIMITED`(소유 확인 시작 하루 10회·확인 간격 5초, `Retry-After` 동반), `VALIDATION_FAILED`(path `:id`가 UUID 아님 포함).
- **동기화 실패는 HTTP 오류가 아니다.** 동기화는 비동기(202)라 실패 사유는 `game_accounts.last_sync_error`에 `GameAccountSyncError` 값으로 기록하고 응답의 `sync.error`로 보여준다(D44). `STEAM_PROFILE_PRIVATE`는 여기에 있다.

`GameAccountSyncError` (`constants/enums.ts`):

| code | 발생 | 화면 |
| --- | --- | --- |
| STEAM_PROFILE_PRIVATE | GetOwnedGames 응답 `response`에 `game_count` 없음 | 목업 Settings 「플레이타임을 가져오지 못했어요 … 게임 세부 정보를 공개로」 + 「다시 시도 · 오늘 N회 남음」 |
| ACCOUNT_NOT_FOUND | PUUID·스팀 ID 조회 404 | 「계정을 찾지 못했어요. 해제 후 다시 연동」 |
| PROVIDER_AUTH_FAILED | 401/403. 재시도 안 함(키 만료) | 「잠시 후 자동으로 다시 시도」 |
| PROVIDER_RATE_LIMITED | 같은 작업이 429로 3번 다시 넣어진 뒤에도 실패 | 같음 |
| PROVIDER_UNAVAILABLE | 5xx·타임아웃이 백오프 3회 후에도 실패 | 같음 |
| PROVIDER_NOT_CONFIGURED | 작업 실행 시 키 없음 | 「운영진에게 알려 주세요」 |
| INTERNAL_ERROR | 그 밖(응답 형식 불일치 포함) | 같음 |

스팀 콜백은 브라우저 이동이라 JSON 오류 대신 `302 {WEB_ORIGIN}/settings?steam_error={SteamLinkErrorCode}`. `SteamLinkErrorCode` = STEAM_LINK_STATE_INVALID | STEAM_LINK_CANCELLED | STEAM_OPENID_INVALID | GAME_PROVIDER_NOT_CONFIGURED | GAME_PROVIDER_ERROR | GAME_PROVIDER_RATE_LIMITED | GAME_ACCOUNT_LIMIT_REACHED | GAME_ACCOUNT_ALREADY_LINKED | UNAUTHENTICATED | INTERNAL_ERROR.

---

## 3. 스키마 변경 (`apps/api/prisma/schema.prisma`)

마이그레이션: `apps/api/prisma/migrations/20261028120000_s1/migration.sql` — `prisma migrate diff --from-schema-datamodel <450b091의 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`로 생성한 **S0 이후 증분** + 맨 끝에 수동으로 추가한 부분 고유 인덱스 1개. DB 적용은 미실행(Docker 없음).

> **이후 슬라이스 주의**: Prisma 6은 부분 인덱스를 모르므로 `prisma migrate dev`/`diff`가 `DROP INDEX "game_accounts_one_primary_per_user_game"`을 만들 수 있다. 그런 줄이 생기면 지우고 인덱스를 유지한다(QA 대조 항목).

| 대상 | 변경 | 근거 |
| --- | --- | --- |
| enum `game_account_sync_state` | 새로: idle, queued, running | 6-1 진행 표시 |
| enum `riot_link_verification_status` | 새로: pending, verified, expired, cancelled | 5-1 |
| **riot_link_verifications** (새 테이블) | user_id(FK Cascade), puuid, game_name, tag_line, icon_id int, status, expires_at, check_count int, last_checked_at?, verified_at?, created_at, updated_at. 인덱스 (user_id, status), (user_id, created_at) | D33 진행 중 확인을 game_accounts와 분리 |
| game_accounts | **삭제**: verification_challenge, verification_expires_at (S0에서 만들었지만 쓰는 코드 없음 — 데이터 손실 없음) | D33 |
| game_accounts | **추가**: sync_state(기본 idle), sync_state_at?, matches_synced_at? | 6-1, 9장 6시간 캐시 |
| game_accounts | **추가**: is_primary(기본 false). 인덱스 (user_id) → (user_id, game_id)로 교체(UNIQUE 아님 — 라이엇 부계정 허용) | D37, D56 |
| game_accounts | **부분 고유 인덱스** `game_accounts_one_primary_per_user_game` ON (user_id, game_id) **WHERE is_primary**. Prisma 6 스키마로 표현할 수 없어 `migration.sql` 맨 끝 「수동 추가」 블록에 직접 썼다(schema.prisma에는 주석만) | D56 |
| game_account_sync_requests | game_account_id NOT NULL → **nullable, ON DELETE SET NULL**(S0는 Cascade) | D41 해제·재연동으로 횟수 회복 방지 |
| recent_matches.summary | 형식 확정: shared `LolMatchSummary` | 7절 |

컬럼 의미(S1 확정):

| 컬럼 | 의미 |
| --- | --- |
| game_accounts.is_primary | 대표 계정. 라이엇: 사용자당 라이엇 ID 하나의 lol·tft 두 행만 true(항상 둘이 함께 바뀜). 스팀: 항상 true. 대표 라이엇 계정이 쓰이는 곳: 프로필 티어 카드·주 포지션·최근 전적(S1), 팀 밸런스 티어 시드(S3), 티어 랭킹(S4) |
| game_accounts.verified / verified_at | S1부터 행은 소유 확인이 끝난 계정만 생성 → 항상 true / 생성 시각. (S6 운영진 승인도 같은 규칙) |
| game_accounts.external_id | 라이엇 PUUID(lol·tft 같은 값), 스팀 64비트 ID. **응답 노출 금지**(D38) |
| game_accounts.display_name | 라이엇 `게임이름#태그`(Account-V1 표기), 스팀 personaname(D52) |
| game_accounts.last_synced_at | 마지막 **성공** 시각. 라이엇 = 티어, 스팀 = 플레이타임 |
| game_accounts.last_sync_error / _at | 마지막 실패 `GameAccountSyncError` 코드와 시각. 다음 성공 시 둘 다 null |
| game_accounts.matches_synced_at | lol 행만. 최근 전적 마지막 성공 시각 |
| rank_snapshots.queue / tier / division | `RankedQueue` / `RankTier`(UNRANKED 포함) / `RiotDivision` 또는 null(UNRANKED·MASTER 이상) |
| steam_playtime | minutes_total ← playtime_forever, minutes_recent ← playtime_2weeks(없으면 0), app_name ← name |

---

## 4. 엔드포인트 (S1)

모두 `/api/v1` 접두사, Request/Response 이름은 `packages/shared` export 이름, 경로 상수는 `ApiPath`(웹은 `fillPath(ApiPath.x, { id })`).

| 메서드 | 경로 (`ApiPath`) | 인증 | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- | --- |
| GET | /me/game-accounts (`myGameAccounts`) | JWT | - | 200 `GetMyGameAccountsResponse`(accounts, riot_verification, sync_quota, **limits**) | UNAUTHENTICATED, ACCESS_TOKEN_EXPIRED |
| POST | /me/game-accounts (`myGameAccounts`) | JWT | `LinkGameAccountRequest` | 200 `LinkGameAccountResponse` (steam이면 Set-Cookie `gcd_steam`) | VALIDATION_FAILED, GAME_PROVIDER_NOT_CONFIGURED, GAME_ACCOUNT_LIMIT_REACHED, RATE_LIMITED, RIOT_ID_NOT_FOUND, GAME_ACCOUNT_ALREADY_LINKED_TO_ME, GAME_ACCOUNT_ALREADY_LINKED, RIOT_SUMMONER_NOT_FOUND, GAME_PROVIDER_RATE_LIMITED, GAME_PROVIDER_ERROR |
| POST | /me/game-accounts/riot-verifications/:id/confirm (`riotVerificationConfirm`) | JWT | 본문 없음, `IdParam` | 200 `ConfirmRiotVerificationResponse` | VALIDATION_FAILED, NOT_FOUND, OWNERSHIP_CHECK_EXPIRED, RATE_LIMITED, OWNERSHIP_CHECK_FAILED, RIOT_SUMMONER_NOT_FOUND, GAME_ACCOUNT_LIMIT_REACHED, GAME_ACCOUNT_ALREADY_LINKED_TO_ME, GAME_ACCOUNT_ALREADY_LINKED, GAME_PROVIDER_* |
| DELETE | /me/game-accounts/riot-verifications/:id (`riotVerification`) | JWT | `IdParam` | 204 | VALIDATION_FAILED, NOT_FOUND |
| GET | /me/game-accounts/steam/callback (`steamLinkCallback`) | `gcd_steam` 쿠키(**JWT 가드 없음**) | `SteamLinkCallbackQuery` | 302 `{WEB_ORIGIN}/settings?steam=linked` | 302 `/settings?steam_error={SteamLinkErrorCode}` |
| DELETE | /me/game-accounts/:id (`myGameAccount`) | JWT | `IdParam` | 204 | VALIDATION_FAILED, NOT_FOUND |
| POST | /me/game-accounts/:id/primary (`myGameAccountPrimary`) | JWT | 본문 없음, `IdParam` | 200 `SetPrimaryGameAccountResponse` | VALIDATION_FAILED, NOT_FOUND |
| POST | /me/game-accounts/:id/sync (`myGameAccountSync`) | JWT | 본문 없음, `IdParam` | **202** `SyncGameAccountResponse` | VALIDATION_FAILED, NOT_FOUND, GAME_PROVIDER_NOT_CONFIGURED, SYNC_LIMIT_EXCEEDED |
| GET | /users/:id/profile (`userProfile`) | JWT(로그인 멤버 누구나) | `IdParam` | 200 `GetUserProfileResponse` | VALIDATION_FAILED, NOT_FOUND |
| (S6 예약) | POST /admin/riot-verifications/:id/approve | admin | - | - | S6에서 정의. S1은 구현하지 않음 |

- 대표 지정 `POST …/:id/primary`는 문서에 없어 추가(D56). 라이엇 행이면 한 트랜잭션에서 기존 대표 lol·tft → false **다음에** 대상 라이엇 ID lol·tft → true(순서를 바꾸면 부분 고유 인덱스 위반). 이미 대표인 행·스팀 행은 변경 없이 200.
- 문서 6장 `DELETE /me/game-accounts`는 `/me/game-accounts/:id`로 구체화했다(어느 계정인지 필요). `GET /me/game-accounts`와 소유 확인 경로 2개는 문서에 없어 추가(D35, D32).
- 오류 판정 순서는 표의 왼쪽부터(5절 흐름의 단계 순서와 같다).
- `GameAccountView`(계정 1행) 필드: `id, game, provider, display_name, verified_at, is_primary, rank|null, sync{state, synced_at, matches_synced_at, error{code, at}|null}, steam_owned_game_count`. 라이엇은 라이엇 ID마다 lol·tft 2행이 같은 display_name·is_primary·sync.state·sync.synced_at·sync.error로 나온다. 단 `sync.matches_synced_at`은 **lol 행만** 값이 있고 tft 행은 null — 웹은 provider + display_name으로 묶어 라이엇 ID당 카드 1개로 그리고, 카드의 동기화 정보는 **lol 행 값**을 쓴다. `rank` = 이 행의 최신 스냅샷(lol 솔로 / tft), 부계정 포함(D57).
- 계정 목록 정렬(설정·프로필 공통): 대표 라이엇(lol, tft) → 부계정(verified_at 오름차순, 같으면 id 순, 각 lol, tft) → 스팀.

---

## 5. 연동 흐름

### 5-1. 라이엇: 프로필 아이콘 소유 확인 (D32, D33)

```
riot_link_verifications.status
  pending ──(아이콘 일치)──────────▶ verified
     │ ──(now ≥ expires_at, 확인 시점에 지연 반영)──▶ expired
     └ ──(사용자 취소 / 새 확인 시작)──▶ cancelled
  아이콘 불일치: pending 유지(제한 시간 안 재확인 가능)
```
shared `RIOT_LINK_VERIFICATION_TRANSITIONS`. 상태 변경은 `canTransition` 검사 후 조건부 update(`WHERE id=? AND status='pending'`).

**시작 `POST /me/game-accounts {provider:'riot', riot_id:'게임이름#태그'}`**

1. `RiotIdInput`으로 파싱(마지막 `#` 기준, 이름 1–16자, 태그 1–5자 문자·숫자) → 실패 VALIDATION_FAILED.
2. `RIOT_API_KEY` 없음 → GAME_PROVIDER_NOT_CONFIGURED.
3. 사용자의 라이엇 ID 수(lol 행 수) ≥ `RIOT_ACCOUNTS_MAX`(기본 3) → GAME_ACCOUNT_LIMIT_REACHED.
4. 오늘(KST) 이 사용자의 riot_link_verifications 생성 수 ≥ 10(`RIOT_VERIFICATION_DAILY_START_LIMIT`) → RATE_LIMITED(Retry-After = 다음 KST 자정까지).
5. Account-V1 `by-riot-id`(지역 `asia`) → 404면 RIOT_ID_NOT_FOUND. PUUID·표기(gameName, tagLine) 획득.
6. 그 PUUID의 lol 행이 이미 있음 → 그 행이 본인 것이면 GAME_ACCOUNT_ALREADY_LINKED_TO_ME, 다른 사용자 것이면 GAME_ACCOUNT_ALREADY_LINKED.
7. Summoner-V4 `by-puuid`(플랫폼 `kr`) → 404면 RIOT_SUMMONER_NOT_FOUND. 현재 `profileIconId` 획득.
8. `icon_id = pickVerificationIcon(현재 아이콘, Math.random)`(core) — `RIOT_VERIFICATION_ICON_IDS`(0–28) 중 현재와 다른 것.
9. 트랜잭션: 이 사용자의 pending 확인 → cancelled, 새 행 insert(`expires_at = now + RIOT_VERIFICATION_TTL_SEC`).
10. 200 `{ provider:'riot', verification }`. `icon_image_url`은 Data Dragon `…/cdn/{버전}/img/profileicon/{id}.png`, 버전을 못 구하면 null.

**확인 `POST /me/game-accounts/riot-verifications/:id/confirm`**

1. `id`+`user_id`로 조회, 없으면 NOT_FOUND.
2. status=verified → 200(멱등, 현재 lol·tft 행으로 응답). cancelled/expired → OWNERSHIP_CHECK_EXPIRED. pending인데 `now ≥ expires_at` → expired로 바꾸고 OWNERSHIP_CHECK_EXPIRED.
3. `last_checked_at`이 5초 이내 → RATE_LIMITED(Retry-After = 남은 초). 아니면 `last_checked_at=now, check_count+1`.
4. Summoner-V4 by-puuid → `profileIconId ≠ icon_id` → OWNERSHIP_CHECK_FAILED.
5. 트랜잭션(사용자 advisory lock `pg_advisory_xact_lock(hashtext('game-accounts:' || user_id))` — 연동·해제·대표 지정이 공유): 라이엇 ID 수가 이미 한도면 GAME_ACCOUNT_LIMIT_REACHED, PUUID가 이미 연동돼 있으면 시작 6단계와 같은 구분(본인 → ALREADY_LINKED_TO_ME, 타인 → ALREADY_LINKED). insert의 P2002는 아래 「P2002 구분」 규칙. lol·tft 두 행 insert(`external_id=puuid, display_name=formatRiotId, verified=true, verified_at=now, is_primary=(사용자에게 라이엇 행이 없었음), sync_state=queued, sync_state_at=now`). 확인 → verified, verified_at=now.
6. 커밋 후 `riot-full` 작업 등록(reason `link`, **횟수 차감 없음**). 200 `{ verification, accounts:[lol, tft] }`.

**취소 `DELETE …/riot-verifications/:id`**: 본인 것 아니면 NOT_FOUND. pending → cancelled. 이미 끝난 상태면 변경 없이 204.

**설정 화면 상태 표시**: `GET /me/game-accounts`의 `riot_verification` = 가장 최근 확인이 pending이면 그 값(expires_at 지났으면 status를 `expired`로 바꿔 내려줌), 아니면 null. 웹은 `expires_at`까지 카운트다운(목업 「08:42」), 0이 되면 「다시 시작」.

### 5-2. 스팀: OpenID 2.0 (D34)

**시작 `POST /me/game-accounts {provider:'steam'}`**

1. `STEAM_API_KEY` 없음 → GAME_PROVIDER_NOT_CONFIGURED. 스팀 행 이미 있음 → GAME_ACCOUNT_LIMIT_REACHED.
2. `state` = 32바이트 난수 base64url. 쿠키 `gcd_steam`(`STEAM_LINK_COOKIE`) = COOKIE_SECRET 서명 JSON `{ state, user_id, iat }`; HttpOnly, SameSite=Lax, **Path=/api/v1/me/game-accounts/steam**, Max-Age=600, production에서 Secure.
3. `return_to = {WEB_ORIGIN}/api/v1/me/game-accounts/steam/callback?state={state}`, `realm = {WEB_ORIGIN}`(S0 D1: 웹 오리진 프록시).
4. 200 `{ provider:'steam', authorize_url }` = `STEAM_OPENID_ENDPOINT?openid.ns=http://specs.openid.net/auth/2.0&openid.mode=checkid_setup&openid.return_to=…&openid.realm=…&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select`(값은 URL 인코딩).
5. 웹: `location.href = authorize_url`.

**콜백 `GET /me/game-accounts/steam/callback?state=…&openid.*=…`** (JWT 없음 — 브라우저 이동. 사용자는 서명 쿠키의 user_id로 식별)

1. `gcd_steam` 즉시 삭제(성공·실패 무관, 같은 Path).
2. `openid.mode=cancel` → STEAM_LINK_CANCELLED. `openid.mode≠id_res` → STEAM_OPENID_INVALID.
3. 쿠키 없음·서명 불일치·`iat`+600초 초과·쿼리 `state` 불일치(상수 시간 비교) → STEAM_LINK_STATE_INVALID.
4. 형식 검증 → 실패 시 STEAM_OPENID_INVALID: `openid.ns`=`http://specs.openid.net/auth/2.0`, `openid.op_endpoint`=`STEAM_OPENID_ENDPOINT`, `openid.return_to`가 3번에서 만든 값과 정확히 같음, `openid.claimed_id`가 `STEAM_CLAIMED_ID_PATTERN`에 맞고 `openid.identity`와 같음.
5. `check_authentication`: 받은 `openid.*` 전부를 그대로 두고 `openid.mode`만 `check_authentication`으로 바꿔 `STEAM_OPENID_ENDPOINT`에 `POST`(form). 응답 본문에 `is_valid:true` 줄이 없으면 STEAM_OPENID_INVALID. 네트워크·5xx → GAME_PROVIDER_ERROR.
6. 쿠키의 user_id 사용자가 없으면 UNAUTHENTICATED.
7. GetPlayerSummaries → personaname(실패해도 진행, 이름 `스팀 사용자`, D52).
8. 트랜잭션(같은 사용자 advisory lock): 스팀 행 이미 있음 → GAME_ACCOUNT_LIMIT_REACHED, 스팀 ID가 다른 사용자에게 있음 → GAME_ACCOUNT_ALREADY_LINKED. 행 insert(verified, `is_primary=true`, `sync_state=queued`). 스팀 1개 제한은 이 잠금 + 검사가 1차, **DB에서도** 부분 고유 인덱스 `game_accounts_one_primary_per_user_game`이 보장한다(스팀 행은 항상 is_primary=true라 사용자당 스팀 대표 행 = 스팀 행 최대 1개).
9. 커밋 후 `steam-playtime` 작업 등록(reason `link`, 횟수 차감 없음). `302 {WEB_ORIGIN}/settings?steam=linked`.
10. 2–8 실패는 `302 {WEB_ORIGIN}/settings?steam_error={code}`, 예상 못한 예외는 INTERNAL_ERROR.

비공개 프로필은 연동 실패가 아니다: 연동은 성공하고 첫 동기화가 `STEAM_PROFILE_PRIVATE`로 기록된다(목업 Settings 「게임 정보 비공개」 배지).

### 5-2a. insert 고유 제약 위반(P2002) 구분

잠금 + 사전 검사가 1차 방어이고, P2002는 경합·누락 대비 2차 방어다. Prisma 오류의 `meta.target`(필드 배열 또는 인덱스 이름)로 구분한다.

| 위반한 제약 | 라이엇 연동(5-1 확인 5단계) | 스팀 연동(5-2 8단계) |
| --- | --- | --- |
| `game_accounts_game_id_external_id_key` (game_id, external_id) | 기존 행 소유자를 다시 조회해 본인 → GAME_ACCOUNT_ALREADY_LINKED_TO_ME, 타인 → GAME_ACCOUNT_ALREADY_LINKED | GAME_ACCOUNT_ALREADY_LINKED(본인이면 이미 스팀이 있다는 뜻이라 LIMIT_REACHED) |
| `game_accounts_one_primary_per_user_game` (user_id, game_id) WHERE is_primary | 대표 결정 경합 — 잠금 안에서는 생기지 않아야 함 → INTERNAL_ERROR + 로그 | GAME_ACCOUNT_LIMIT_REACHED |

`meta.target`을 해석하지 못하면 INTERNAL_ERROR. 구분 함수 하나(backend `common/`)로 두고 단위 테스트한다.

### 5-3. 연동 해제 `DELETE /me/game-accounts/:id`

본인 행 아니면 NOT_FOUND. 라이엇 행(lol·tft 어느 쪽이든)이면 같은 라이엇 ID(같은 external_id)의 lol·tft 두 행을, 스팀이면 그 행을 삭제(D46). 대표 라이엇 ID를 지웠고 남은 라이엇 ID가 있으면 **같은 트랜잭션**(사용자 advisory lock)에서 가장 먼저 연동한 것(verified_at 오름차순, 같으면 lol 행 id 순)의 lol·tft를 `is_primary=true`로(D56). rank_snapshots·recent_matches·steam_playtime은 Cascade, game_account_sync_requests는 SetNull(횟수 기록 유지). 실행 중인 작업은 계정이 없으면 아무것도 하지 않고 끝낸다.

---

## 6. 동기화

### 6-1. 상태 (`game_accounts.sync_state`, shared `GAME_ACCOUNT_SYNC_STATE_TRANSITIONS`)

```
idle → queued    수동 새로고침, 연동 직후
idle → running   주기 작업·프로필 조회 전적 갱신이 바로 실행
queued → running 작업자 시작
queued → idle    작업 버림(계정 해제 등)
running → idle   성공·실패 모두(결과는 last_synced_at / last_sync_error)

멈춘 행 전용(sync_state_at < now − 10분 = SYNC_STATE_STALE_MS, 조건부 update의 WHERE로 보장):
queued → queued   멈춘 작업 정리: 다시 등록 + sync_state_at=now
running → queued  멈춘 작업 정리: 실행 중 죽은 작업을 다시 등록 + sync_state_at=now
running → running 작업자가 멈춘 running 행을 다시 잡음(잠금 재획득) + sync_state_at=now
```

- 전이 맵: shared `GAME_ACCOUNT_SYNC_STATE_TRANSITIONS`. 위 3개 전이는 맵에 있지만 `isStaleOnlySyncTransition(from, to)`가 true인 전이이므로, 반드시 `sync_state_at < now() − interval '10 minutes'` 조건을 WHERE에 넣은 조건부 update로만 실행한다(조건 없이 쓰면 QA 위반).
- 라이엇 lol·tft 두 행은 항상 함께 바꾼다. 상태를 바꿀 때마다 `sync_state_at=now`.
- 작업자 잠금: `UPDATE … SET sync_state='running', sync_state_at=now() WHERE id IN (대상 행) AND (sync_state IN ('idle','queued') OR sync_state_at < now()-10분)` — idle/queued → running, 또는 멈춘 running → running. 영향 0행이면 다른 작업자가 실행 중 → 이 작업은 건너뜀.
- 웹 폴링: `sync.state ≠ idle`인 계정이 있으면 `GET /me/game-accounts`(프로필은 `GET /users/:id/profile`)를 2초 간격, 최대 60초 다시 조회.

### 6-2. 작업 목록 (문서 9장, external-api-integration 5절)

| 작업 | 생산자·주기 | 대상·순서 | 하는 일 | BullMQ 우선순위 |
| --- | --- | --- | --- | --- |
| `riot-full` | 수동 새로고침, 소유 확인 성공 직후 | 그 라이엇 ID의 lol·tft 행 | Account-V1 by-puuid로 display_name 갱신 → lol 티어(League-V4 by-puuid, `RANKED_SOLO_5x5`) → tft 티어(TFT-League by-puuid, `RANKED_TFT`) → **대표 계정일 때만** 최근 전적(아래 `riot-matches`와 같음) | 1 |
| `steam-playtime` (manual/link) | 수동 새로고침, 스팀 연동 직후 | 그 스팀 행 | GetPlayerSummaries로 display_name 갱신 → GetOwnedGames | 1 |
| `riot-matches` | `GET /users/:id/profile` 조회 시 **대표** lol 행의 `matches_synced_at`이 null 또는 6시간 초과이고 `sync_state=idle`이며 `last_sync_error_at`이 30분 이내가 아닐 때 | 그 lol 행 | Match-V5 ids(`queue=420&type=ranked&count=20`) → `recent_matches`에 없는 매치만 상세 조회 → `LolMatchSummary`로 upsert → 계정당 played_at 최신 20개만 남김 → `matches_synced_at=now` | 2 |
| `riot-tier` | cron **매시 정각**(`0 * * * *`, Asia/Seoul) | 아래 SQL 순서(대표·부계정 모두, D57) | lol·tft 티어만 | 활동 멤버의 대표 3, 그 외 4 |
| `steam-playtime` (schedule) | cron **매일 05:00 KST**(`0 5 * * *`, Asia/Seoul) | 모든 스팀 행(`last_synced_at` 오래된 순) | GetOwnedGames만 | 5 |
| 멈춘 작업 정리 | cron 5분마다 + 프로세스 시작 시 | `sync_state IN (queued, running) AND sync_state_at < now()-10분`(시작 시: in-process 모드는 전부) | 같은 종류 작업을 다시 등록하고 `queued, sync_state_at=now`(전이 queued→queued / running→queued, 6-1 멈춘 행 전용) | - |

`riot-tier` 대상 선택(라이엇 lol 행 기준, tft 행은 같은 사용자 것을 함께):
```sql
WHERE ga.verified AND ga.sync_state = 'idle'
  AND (ga.last_synced_at IS NULL OR ga.last_synced_at < now() - interval '55 minutes')
ORDER BY
  CASE WHEN u.last_login_at >= now() - interval '7 days'
         OR EXISTS (SELECT 1 FROM scrim_players sp WHERE sp.user_id = u.id AND sp.joined_at >= now() - interval '7 days')
         OR EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.started_at >= now() - interval '7 days')
       THEN 0 ELSE 1 END,
  ga.is_primary DESC,          -- 대표 먼저, 부계정은 같은 활동 그룹 안에서 뒤로
  ga.last_synced_at NULLS FIRST
```
(scrim_players·activity_logs는 S2·S5 전까지 비어 있어 사실상 `last_login_at` 기준.)

**결과 저장 규칙**
- 티어: 큐별 항목이 없으면 `UNRANKED`(division null, 0/0/0). `toRankValue`(core)로 변환, 같은 큐의 최신 스냅샷과 `isSameRank`(core)가 false일 때만 새 `rank_snapshots` 행(`captured_at=now`, D55). `last_synced_at`은 성공할 때마다 갱신.
- 성공한 부분만 시각 갱신: 티어 성공 → `last_synced_at`, 전적 성공 → `matches_synced_at`. 어느 부분이든 실패하면 `last_sync_error/_at`을 두 행에 기록. 모든 부분이 성공하면 둘 다 null.
- **실패해도 기존 데이터를 지우지 않는다.** 스팀 비공개면 기존 steam_playtime 행 유지(목업 「마지막 성공 값(10.20)」).
- 스팀: `response.game_count`가 없으면 STEAM_PROFILE_PRIVATE. `game_count: 0`은 공개 + 보유 0개(성공).
- 매치: `played_at` = `info.gameEndTimestamp`(없으면 `gameStartTimestamp`), `win` = participant.win, `placement` = null, `duration_sec` = `info.gameDuration`, position = `toLolPosition(teamPosition)`.

### 6-3. 큐 구현 (D43)

- **생산자는 Redis 유무와 무관하게 `@nestjs/schedule` cron**. cron 핸들러는 `pg_try_advisory_lock(작업별 상수 키)`를 얻은 경우에만 대상 선택·등록을 하고 끝나면 푼다(여러 인스턴스 중복 방지). `SYNC_JOBS_ENABLED=false`면 cron 등록 자체를 안 한다.
- **소비자**는 `SyncQueue` 인터페이스(9절) 뒤에 둔다.
  - `REDIS_URL` 있음: `BullMqSyncQueue` — 큐 `external-sync`, 우선순위 위 표, `jobId`로 중복 제거(`{kind}:{대상 행 id}`, manual/link는 `manual:{행 id}` 별도).
  - `REDIS_URL` 없음: `InProcessSyncQueue` — 메모리 우선순위 큐, 제공자(riot/steam)별 동시 실행 1, 같은 키 중복 제거. 재시작으로 잃은 수동 요청은 DB `sync_state`가 원본이라 「멈춘 작업 정리」가 다시 등록한다.
- 테스트는 in-process 구현과 `SyncQueue` 목으로 한다(이 PC에 Redis 없음). BullMQ 구현은 작성만 하고 실행 미확인으로 보고.

### 6-4. 호출 한도·재시도 (external-api-integration 4절)

| 상황 | 백그라운드 작업 | HTTP 요청 처리 중(연동 시작·확인·스팀 콜백) |
| --- | --- | --- |
| 토큰 버킷 | 호스트별(`{asia}.api.riotgames.com`, `{kr}.api.riotgames.com`) 초당 `RIOT_RATE_LIMIT_PER_SEC`, 2분당 `RIOT_RATE_LIMIT_PER_2MIN`. 빌 때까지 대기 | 3초 넘게 기다려야 하면 GAME_PROVIDER_RATE_LIMITED(Retry-After = 예상 대기 초) |
| 429 | `Retry-After`(없으면 60초)만큼 그 호스트를 멈춤(BullMQ: `queue.pause` → 타이머 → `resume`, in-process: 해당 레인 일시정지) 후 작업을 다시 넣음. **즉시 재시도 금지.** 같은 작업 3번째 429 → PROVIDER_RATE_LIMITED 기록 | 호스트 멈춤은 같게 적용, 요청은 GAME_PROVIDER_RATE_LIMITED + Retry-After 그대로 |
| 5xx·타임아웃(`EXTERNAL_API_TIMEOUT_MS`) | 지수 백오프 1·2·4초, 3회 후 PROVIDER_UNAVAILABLE | 1회 재시도 후 GAME_PROVIDER_ERROR |
| 401/403 | 재시도 없음, PROVIDER_AUTH_FAILED + 로그 「라이엇 키 만료/권한」 | GAME_PROVIDER_ERROR |
| 404 | 계정 조회면 ACCOUNT_NOT_FOUND. 리그 항목 없음은 오류 아님(빈 배열 → UNRANKED) | 5-1 각 단계 코드 |

스팀은 호출량이 작아 토큰 버킷을 두지 않고 429·5xx 규칙만 같은 방식으로 적용한다.

---

## 7. 수동 새로고침 (`POST /me/game-accounts/:id/sync`, D41)

1. 본인 행 아니면 NOT_FOUND. 제공자 키 없음 → GAME_PROVIDER_NOT_CONFIGURED.
2. 트랜잭션 + `pg_advisory_xact_lock(hashtext('sync-quota:' || user_id))`(동시 요청으로 5회를 넘지 않게):
   - 대상 행(라이엇이면 lol·tft)이 `queued`/`running`이고 `sync_state_at`이 10분 이내 → **차감 없이** 202(`quota_consumed=false`).
   - `used` = `game_account_sync_requests`에서 `user_id`이고 `created_at ≥ 오늘 KST 00:00`(core `kstDayWindow(now).start`)인 행 수. `used ≥ SYNC_DAILY_LIMIT` → SYNC_LIMIT_EXCEEDED, `Retry-After` = `kstDayWindow(now).end - now`(초, 올림).
   - `game_account_sync_requests` insert(`game_account_id` = 요청한 행 id) + 대상 행 `queued`.
3. 커밋 후 `riot-full` 또는 `steam-playtime`(reason manual) 등록. 202 `{ accounts, sync_quota, quota_consumed:true }`.

규칙: 사용자 단위, 라이엇·스팀 **합산**, 라이엇 1회 = lol·tft 함께. 외부 호출이 실패해도 차감 유지(목업 「다시 시도 · 오늘 4회 남음」). 연동 직후·프로필 조회·주기 작업은 차감하지 않는다. `SyncQuota.resets_at`은 `+09:00` 오프셋 표기(`2026-10-29T00:00:00.000+09:00`), core `buildSyncQuota`가 만든다.

---

## 8. 프로필 응답 (`GET /users/:id/profile`)

로그인 멤버 누구나 조회. 사용자 없으면 NOT_FOUND.

| 필드 | 내용 | 빈 상태 |
| --- | --- | --- |
| user | `ProfileUser {id, nickname, role, avatar_url, discord_linked, joined_at}`. `discord_linked` = discord_id가 있고 `dev-`로 시작하지 않음 | - |
| is_self | 요청자 = 대상 | - |
| game_accounts | `GameAccountView[]` 전부(대표 + 부계정 + 스팀, 4절 정렬). 화면은 연동 칩으로만 쓴다 | `[]` → 「연동한 계정이 없어요」 |
| tiers | **대표** 라이엇 계정의 lol·tft 2개 `ProfileTierCard{game_account_id, game, queue, rank, synced_at}`. rank = 해당 큐 최신 스냅샷 | `[]`(라이엇 없음), `rank: null`(아직 동기화 성공 없음), `rank.tier='UNRANKED'`(언랭) |
| main_position | core `computeMainPosition(대표 lol 행 recent_matches 최신 20개의 summary.position)` | null(롤 없음·경기 없음·포지션 전부 null) |
| recent_matches | 대표 lol 행의 `{items: RecentLolMatch[] 최신 10개, synced_at: matches_synced_at, refresh_queued}`. 6-2 조건이면 `riot-matches` 등록하고 `refresh_queued=true`, sync_state가 idle이 아니어도 true | null(롤 계정 없음), `items: []`(경기 없음·첫 동기화 전) |
| sync_quota | `is_self`일 때만 `SyncQuota` | null(다른 사람) |
| scrim | **S3 자리. S1은 항상 null** | 웹: 「내전 기록은 곧 열려요」류 빈 상태(레이팅 카드·그래프·최근 내전 3곳) |
| badges | **P2 자리. S1은 항상 null** | 웹: 뱃지 빈 상태 |

- `RecentLolMatch`: `id`(우리 UUID), played_at, win, champion_id, champion_key, champion_name(Data Dragon ko_KR, 없으면 key), champion_image_url|null, position, kills, deaths, assists, duration_sec. `summary`가 `LolMatchSummary`로 파싱되지 않는 행은 건너뛴다.
- 자리 필드 규칙(D39): 이후 슬라이스는 `z.null()`을 `객체.nullable()`(badges는 `배열.nullable()`)로 **넓히기만** 한다. null은 언제나 「표시할 데이터 없음」이라 S1 웹 코드가 그대로 동작한다.
- 목업 Profile의 「지금 갱신 · 오늘 N회 남음」은 `is_self`일 때만: 대표 라이엇 lol 행 id로, 없고 스팀만 있으면 스팀 행 id로 `POST …/sync`.

### 외부 식별자 비노출 (D38)

어떤 응답에도 넣지 않는다: `game_accounts.external_id`(PUUID·스팀 64비트 ID), `riot_link_verifications.puuid`, `recent_matches.external_match_id`, users의 email·discord_id(프로필). 본인 설정 화면도 같다(목업 Settings의 스팀 ID 숫자 대신 personaname). shared 응답 스키마는 해당 필드가 없고 zod `object`가 모르는 키를 제거하므로 직렬화가 스키마 parse를 거치면 새지 않는다 — **QA는 응답 스키마 parse 경로를 우회하는 코드가 없는지 확인한다.** 로그에도 PUUID 원문 대신 game_account id를 쓴다.

---

## 9. 구현 인터페이스 (API 내부 계약)

shared가 아니라 `apps/api` 내부 경계다. integration이 **첫 작업으로** `apps/api/src/integrations/contracts.ts`에 아래 타입을 만들고, backend는 그 타입과 목으로 병렬 작업한다.

```ts
export type ExternalErrorKind = 'not_found' | 'auth' | 'rate_limited' | 'unavailable' | 'bad_response' | 'not_configured';
export class ExternalApiError extends Error { kind: ExternalErrorKind; retryAfterSec?: number }

export interface RiotApi {
  /** mode 'interactive' = HTTP 요청 처리 중(3초 대기 한도, 1회 재시도), 'background' = 작업자(6-4) */
  getAccountByRiotId(gameName: string, tagLine: string, mode: CallMode): Promise<{ puuid: string; gameName: string; tagLine: string }>;
  getAccountByPuuid(puuid: string, mode: CallMode): Promise<{ puuid: string; gameName: string; tagLine: string }>;
  getSummonerByPuuid(puuid: string, mode: CallMode): Promise<{ profileIconId: number }>;
  getLolLeagueEntries(puuid: string): Promise<RiotLeagueEntry[]>;   // background
  getTftLeagueEntries(puuid: string): Promise<RiotLeagueEntry[]>;   // background
  getLolMatchIds(puuid: string, opts: { queue: number; count: number }): Promise<string[]>;
  getLolMatch(matchId: string): Promise<RiotMatch>;                  // 필요한 필드만 zod로 파싱
}
export type CallMode = 'interactive' | 'background';
export type RiotLeagueEntry = { queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number };

export interface SteamApi {
  getOwnedGames(steamId: string): Promise<{ visibility: 'private' } | { visibility: 'public'; games: { appId: number; name: string | null; minutesTotal: number; minutesRecent: number }[] }>;
  getPlayerSummary(steamId: string): Promise<{ personaName: string } | null>;
  /** 5-2 4·5단계. 형식 불일치·is_valid≠true → { ok:false }, 네트워크·5xx → ExternalApiError */
  verifyOpenIdAssertion(query: Record<string, string>, expectedReturnTo: string): Promise<{ ok: true; steamId: string } | { ok: false }>;
}

export interface DataDragon {
  profileIconUrl(iconId: number): Promise<string | null>;
  champion(championId: number): Promise<{ key: string; nameKo: string; imageUrl: string | null } | null>;
}

export type SyncJobKind = 'riot-full' | 'riot-tier' | 'riot-matches' | 'steam-playtime';
export type SyncJobReason = 'manual' | 'link' | 'profile-view' | 'schedule' | 'recovery';
export type SyncJob = { kind: SyncJobKind; gameAccountId: string; reason: SyncJobReason; priority: number };
export interface SyncQueue { enqueue(job: SyncJob): Promise<void> }   // 중복 키는 조용히 무시
export const RIOT_API = Symbol('RIOT_API'); export const STEAM_API = Symbol('STEAM_API');
export const DATA_DRAGON = Symbol('DATA_DRAGON'); export const SYNC_QUEUE = Symbol('SYNC_QUEUE');
```

경계: **backend**는 HTTP 엔드포인트(4절 전부), 소유 확인·연동·해제·횟수 검사·`idle→queued` 전이와 `SyncQueue.enqueue` 호출, 프로필 조회까지. **integration**은 외부 클라이언트, 한도·재시도, Data Dragon, 큐 구현, 작업자(결과 DB 기록, `queued→running→idle`), cron 생산자, 멈춘 작업 정리.

### integration 확인 항목 (공식 문서로 확인 후 보고서에 URL·날짜)

| # | 항목 |
| --- | --- |
| I1 | 경로: Account-V1 `by-riot-id`·`by-puuid`, Summoner-V4 `by-puuid`, League-V4 `entries/by-puuid`, TFT-League `by-puuid`, Match-V5 `matches/by-puuid/{puuid}/ids`(queue·type·count), `matches/{id}` |
| I2 | 아이콘 0–28이 모든 계정에서 선택 가능한지. 아니면 `RIOT_VERIFICATION_ICON_IDS` 변경을 architect에 요청 |
| I3 | TFT 리그 항목의 wins/losses 의미(1등 기준 / 4등 이내 기준). 웹의 「순방 %」 표기 여부가 여기에 달림 — frontend에 전달 |
| I4 | Steam OpenID `check_authentication` 응답 형식, GetOwnedGames 비공개 응답 형태(`{"response":{}}`), GetPlayerSummaries |
| I5 | Data Dragon versions.json·profileicon·champion(ko_KR) 경로 |

---

## 10. core 함수 (`packages/core`, domain-logic)

I/O 없음, 시각은 인자로. 모두 단위 테스트 필수.

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| kstDayWindow | `(now: Date) => { start: Date; end: Date }` | start = now의 KST 날짜 00:00(+09:00)을 가리키는 시각, end = start + 24h. 경계: KST 23:59:59.999 / 00:00:00.000 |
| buildSyncQuota | `(used: number, limit: number, now: Date) => SyncQuota` | remaining = max(0, limit−used), resets_at = `kstDayWindow(now).end`를 `YYYY-MM-DDT00:00:00.000+09:00`로 |
| computeMainPosition | `(positions: readonly (LolPosition \| null)[]) => MainPosition \| null` | 입력은 최신순. 앞 `RECENT_MATCHES_MAX`(20)개만, null 제외한 수 = sample_size(0이면 null). 경기 수 내림차순, 동률은 `LolPosition` 순서, 최대 2개. ratio = count/sample_size 소수 둘째 자리 반올림. source `riot_ranked_solo` |
| pickVerificationIcon | `(currentIconId: number, random: () => number) => number` | `RIOT_VERIFICATION_ICON_IDS`에서 현재 아이콘 뺀 목록 중 `floor(random()*n)`번째 |
| toRankValue | `(entry: { tier: string; rank: string; leaguePoints: number; wins: number; losses: number } \| undefined) => RankValue` | undefined → UNRANKED 0/0/0. `RIOT_APEX_TIERS`면 division null(라이엇이 주는 `rank` 값 'I'는 **무시**하고 검사도 하지 않음). 모르는 tier·rank 문자열 → 예외(작업자는 INTERNAL_ERROR로 기록) |
| isSameRank | `(a: RankValue, b: RankValue) => boolean` | tier·division·lp·wins·losses 모두 같음 |
| isMatchesCacheStale | `(matchesSyncedAt: Date \| null, now: Date, ttlHours?: number) => boolean` | null 또는 `now − synced ≥ ttlHours`(기본 `RECENT_MATCHES_TTL_HOURS`) |

---

## 11. 환경 변수 (`.env.example` 반영됨, 표 13행 = 신규 10개 + 기존 3개 의미·기본값 변경: RIOT_API_KEY, STEAM_API_KEY, REDIS_URL)

| 변수 | 사용처 | 기본 | 비고 |
| --- | --- | --- | --- |
| RIOT_API_KEY | api | (키 필요) | S0에 자리만 있었음. 비면 라이엇 연동·동기화 GAME_PROVIDER_NOT_CONFIGURED / PROVIDER_NOT_CONFIGURED |
| STEAM_API_KEY | api | (키 필요) | 같음(스팀) |
| RIOT_REGIONAL_ROUTING | api | asia | Account-V1·Match-V5 호스트 `{값}.api.riotgames.com` |
| RIOT_PLATFORM_ROUTING | api | kr | Summoner-V4·League-V4·TFT-League |
| RIOT_RATE_LIMIT_PER_SEC | api | 20 | 호스트별 |
| RIOT_RATE_LIMIT_PER_2MIN | api | 100 | 호스트별 |
| EXTERNAL_API_TIMEOUT_MS | api | 5000 | 라이엇·스팀·Data Dragon·Steam OpenID |
| RIOT_VERIFICATION_TTL_SEC | api | 600 | 소유 확인 제한 시간 |
| RIOT_ACCOUNTS_MAX | api | 3 | 사용자당 라이엇 ID 최대 개수(D37, D56). 1 이상 정수. 스팀은 1개 고정 |
| RIOT_DDRAGON_VERSION | api | (빈 값) | 비면 versions.json 최신값을 하루 1회 캐시 |
| SYNC_DAILY_LIMIT | api | 5 | 수동 새로고침 하루 한도 |
| SYNC_JOBS_ENABLED | api | true | false면 cron 미등록(테스트) |
| REDIS_URL | api | **빈 값으로 변경**(D47) | 있으면 BullMQ, 없으면 in-process |

`config/env.ts`(backend)는 위 값을 zod로 검증한다. 숫자는 양의 정수, 라우팅은 소문자 영문. 키가 없어도 서버는 시작한다.

---

## 12. 화면 (frontend)

### `/settings` (목업 Settings, 섹션 순서: 화면 테마 → 게임 계정 연동 → 디스코드 계정. **알림 섹션 없음**)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 게임 계정 연동 · 라이엇 카드(연동됨, 라이엇 ID마다 1장, 대표 먼저) | provider=riot 행을 display_name으로 묶음(2행 → 1카드), 「라이엇 ID · 롤, 롤체 공통 · HH:mm 동기화」, 대표면 「대표」 배지, 롤·롤체 티어 요약(`rank`), sync.error 있으면 안내 | 「지금 갱신 · 오늘 N회 남음」(lol 행 id로 sync, remaining 0이면 비활성), 부계정이면 「대표로 지정」(primary), 「연동 해제」(확인 대화상자, 대표를 해제하면 「다음 계정이 대표가 돼요」 안내) |
| 라이엇 「+ 부계정 추가」 | 라이엇 ID 수 < `limits.riot_accounts_max`이고 진행 중 확인이 없을 때(목업 「부계정 추가」, D58). 라이엇 연동이 하나도 없으면 「라이엇 ID 연동」 문구 | 아래 1단계로 |
| 라이엇 카드(미연동) — 라이엇 ID 입력(단계 표기 없음) | - | 라이엇 ID 입력(`게임이름#태그`) → POST → 오류 코드별 문구 |
| 라이엇 카드 — 아이콘 변경(「소유 확인 1/2 단계」, 목업·D58) | `riot_verification` | 아이콘 이미지(없으면 `#번호`), 「게임 클라이언트에서 프로필 아이콘을 #N으로 바꿔 주세요」, `expires_at` 카운트다운, 「바꿨어요, 확인」(confirm), 「취소」(DELETE). expired → 「다시 시작」. OWNERSHIP_CHECK_FAILED는 카드 안 인라인 안내 |
| 라이엇 카드 — 확인 중(「소유 확인 2/2 단계」) | confirm 요청 진행 중 | 버튼 비활성 + 「라이엇 API로 아이콘을 대조하고 있어요」. 성공 시 연동된 카드로 바뀜 |
| 스팀 카드(미연동) | - | 「Steam으로 로그인」 버튼 1개 → POST {provider:'steam'} → `location.href = authorize_url` |
| 스팀 카드(연동됨) | display_name, 「보유 게임 N개」(`steam_owned_game_count`), STEAM_PROFILE_PRIVATE면 「게임 정보 비공개」 배지 + 목업 안내 문구 + 「다시 시도 · 오늘 N회 남음」(sync) + 「마지막 성공 값(MM.DD)」(synced_at 있을 때) | 「연동 해제」 |
| 스팀 콜백 결과 | `SettingsPageQuery`(`steam=linked` / `steam_error`) | 토스트 후 쿼리 제거(`router.replace('/settings')`) |
| 디스코드 계정(읽기 전용) | `GET /me`: avatar_url, discord_username, discord_guild_verified_at | 「로그인한 디스코드 계정」 표시만. 연동 코드 발급 UI 없음(D23) |

### `/members/[id]` (목업 Profile)

| 영역 | 데이터 | S1 |
| --- | --- | --- |
| 헤더 | user, main_position 1순위(「TOP LANER」 등), joined_at(「YYYY.MM 가입」), role | ELO 순위 「#3 ELO」는 S3 — 표시 안 함 |
| 연동 칩 | game_accounts(라이엇 display_name, 「스팀 연동됨」), user.discord_linked(「디스코드 연동/미연동」) | |
| 갱신 버튼 | is_self일 때만, sync_quota | 8절 마지막 줄 |
| 카드 4개 | 롤 솔로 랭크·롤체 랭크(tiers), 주 포지션(main_position, 「솔로 랭크 최근 N경기 기준 탑 71%」), 내전 레이팅 | 내전 레이팅 카드는 빈 상태(scrim=null) |
| RATING HISTORY / SCRIMS 최근 내전 / BADGES | scrim, badges | 빈 상태 |
| RANKED SOLO 최근 솔로 랭크 | recent_matches | 「라이엇 API · HH:mm」= synced_at, refresh_queued면 10초 뒤 1회 재조회 |

- 티어 색: 목업의 `#3DDC97` 같은 티어 hex는 **새로 들이지 않고** 기존 토큰으로 매핑(D53). 매핑표는 `apps/web/src/lib/` 한 곳.
- 훅 이름: `useMyGameAccounts`, `useSetPrimaryGameAccount`, `useLinkGameAccount`, `useConfirmRiotVerification`, `useCancelRiotVerification`, `useUnlinkGameAccount`, `useSyncGameAccount`, `useUserProfile`.
- 목 백엔드(`NEXT_PUBLIC_API_MOCK`)에 S1 엔드포인트 추가. 스팀은 `authorize_url`을 `/settings?steam=linked`로 돌려 흐름을 흉내 낸다.

---

## 13. 담당 배정

S1 실행 구현자: **integration**, **backend**, **logic**, **frontend** (+ qa).

### 의존 순서

```
architect(완료)
  ├─ logic ──────────────────────────────┐
  ├─ integration 1단계: contracts.ts ─┬─ integration 나머지 ─┤
  │                                   └─ backend(목으로) ────┼─ backend 실제 구현 연결 → qa
  └─ frontend(목 백엔드로) ─────────────────────────────────┘
```
logic·frontend·integration은 바로 시작. backend는 `contracts.ts`가 생기면 시작하고 core 함수는 logic 완료 전까지 시그니처대로 임시 구현 없이 import만 맞춘다(테스트는 logic 완료 후 통과).

### logic (domain-logic-dev) — `packages/core/src/**`

1. 10절 함수 7개 + vitest. KST 경계, 동률, 표본 20 초과, null 포지션, apex·언랭, 모르는 tier 예외 케이스 포함.
2. 보고서: `_workspace/02_logic-dev_s1.md`.

### integration (integration-dev) — `apps/api/src/integrations/**`, `apps/api/src/jobs/**`, `apps/api/test/fixtures/{riot,steam}/**`

1. `integrations/contracts.ts`(9절) — **가장 먼저**.
2. 공통 HTTP(타임아웃, `ExternalApiError` 분류), `rate-limiter.ts`(호스트별 버킷 2개, 429 일시정지).
3. `riot/*`(`RiotApi` 구현, 라우팅은 환경 변수), `steam/*`(`SteamApi`: GetOwnedGames `include_appinfo=1&include_played_free_games=1`, GetPlayerSummaries, OpenID 검증), `ddragon.ts`.
4. `jobs/`: `SyncQueue` 두 구현(BullMQ, in-process), 작업자 4종(sync_state 갱신은 6-1 전이 + 멈춘 행 조건, 6-2 결과 저장 규칙, `riot-full`의 전적은 대표일 때만, `riot-tier`는 부계정 포함·대표 먼저), cron 생산자 3종(advisory lock, `SYNC_JOBS_ENABLED`), 멈춘 작업 정리. 의존성 추가: `@nestjs/schedule`, `bullmq`(Nest 11 호환 버전, 고정 버전 표기).
5. fixture: 정상, 언랭, MASTER(division 무시), 429(+Retry-After), 401, 5xx, 스팀 비공개 `{"response":{}}`, 스팀 0개 공개, OpenID `is_valid:false`. 실제 키·PUUID·스팀 ID 금지(가짜 값).
6. 테스트: 클라이언트 분류·재시도·429 일시정지(가짜 타이머), 작업자 결과 저장(DB 필요분은 작성만), in-process 큐 우선순위·중복 제거.
7. 보고서: `_workspace/02_integration-dev_s1.md`(9절 I1–I5 확인 결과 포함, 실제 호출은 「키 필요」).

### backend (backend-dev) — `apps/api/src/modules/game-accounts/**`, `modules/profile/**`(또는 users 확장), `config/env.ts`, `common/**`

1. `config/env.ts`: 11절 표 13행 전부.
2. `AppError` `retryAfterSec` + error filter `Retry-After` 헤더.
3. 4절 엔드포인트 9개, 5·7·8절 흐름 전부. 대표 계정(D56): 첫 라이엇 연동 대표, 대표 지정(기존 false → 대상 true 순서), 대표 해제 시 승격 — 모두 사용자 advisory lock 트랜잭션. 개수 한도 `RIOT_ACCOUNTS_MAX`. 스팀 콜백은 JwtGuard 없이, `gcd_steam` 서명·검증은 S0 `gcd_oauth`와 같은 유틸 재사용.
4. 직렬화: `GameAccountView`(last_sync_error 문자열이 `GameAccountSyncError`에 없으면 INTERNAL_ERROR로), `GetUserProfileResponse` — 반드시 shared 스키마 parse를 거친다(D38).
5. 테스트(목 `RiotApi`/`SteamApi`/`SyncQueue`): 소유 확인 성공·불일치·만료·5초 간격·하루 10회, 이미 연동(본인/타인), 라이엇 4번째 → LIMIT_REACHED, 첫 연동 대표·두 번째 부계정, 대표 지정 멱등·남의 계정 NOT_FOUND, 대표 해제 → 가장 오래된 부계정 승격, 프로필 티어·주 포지션·전적이 대표 기준, 스팀 콜백 분기(취소·state·return_to 변조·claimed_id 변조·is_valid false·성공), 해제 시 두 행 삭제·횟수 기록 유지, sync 차감·중복 미차감·한도 초과 Retry-After, 프로필 빈 상태·타인 조회 시 sync_quota null·external_id 미포함. 같은 라이엇 ID 재추가 → ALREADY_LINKED_TO_ME, P2002 구분 함수(5-2a) 단위 테스트. DB 필요분(동시 sync 5회 경계 `Promise.all`, 실제 P2002, 부분 고유 인덱스가 대표·스팀 2개를 거부)은 작성만.
6. 보고서: `_workspace/02_backend-dev_s1.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 12절 두 화면(라이엇 다계정 카드·부계정 추가·대표 지정 포함), 훅 8개, `lib/routes.ts`(settings 쿼리), `lib/errors.ts` S1 문구 다듬기(architect 초안 있음), 목 백엔드 S1 엔드포인트.
2. 폴링 규칙(6-1), 카운트다운, 빈 상태(scrim·badges·recent_matches·tiers).
3. 검증: `corepack pnpm --filter web typecheck && test && build`, 목 모드로 데스크톱·모바일 × 라이트·다크.
4. 보고서: `_workspace/02_frontend-dev_s1.md`.

### qa (qa-verifier)

- 교차 대조: 4절 9개 엔드포인트 ↔ 컨트롤러 ↔ 웹 훅, 오류 코드 29개 ↔ `DEFAULT_ERROR_MESSAGE` ↔ 웹 `ERROR_MESSAGES`, Prisma enum 2개 ↔ shared enum, 전이 맵 2개 ↔ 상태 갱신 코드.
- 마이그레이션에 부분 고유 인덱스 `game_accounts_one_primary_per_user_game`이 있는지, 대표 갱신 순서(기존 false → 대상 true).
- 보안 경계: 외부 식별자 비노출(8절), 남의 계정 대표 지정 → NOT_FOUND, 스팀 콜백 변조(return_to·claimed_id·op_endpoint·state), 남의 계정·확인 id → NOT_FOUND, 해제·재연동으로 횟수 회복 불가, 동시 sync 한도.

---

## 14. 결정 사항 (S1, D32부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D32 | 라이엇 소유 확인 = 프로필 아이콘 변경. 기본 아이콘 0–28 중 현재와 다른 것, 제한 10분, 불일치는 같은 확인으로 재시도, 시간 초과는 새로 시작. 경로 `POST …/riot-verifications/:id/confirm`, `DELETE …/riot-verifications/:id` 추가 | 메인 기본값 1, 문서 9장, external-api-integration 2절, 목업 Settings |
| D33 | 진행 중 확인은 새 테이블 `riot_link_verifications`에 두고 `game_accounts` 행은 확인 성공 시에만 만든다. S0의 `game_accounts.verification_challenge/_expires_at`은 삭제 | 미확인 행이 `(game_id, external_id)` UNIQUE를 차지하면 남의 라이엇 ID를 입력만 해서 진짜 주인의 연동을 막을 수 있다(선점). 쓰는 코드가 없어 지금 바꾸는 비용이 가장 낮다 |
| D34 | 스팀 소유 확인 = Steam OpenID 2.0. 시작은 JWT가 있는 `POST /me/game-accounts {provider:'steam'}`가 서명 쿠키 `gcd_steam`(user_id 포함) + `authorize_url`을 주고, 콜백은 쿠키로 사용자를 식별, 서버가 `check_authentication` 검증 | 메인 기본값 2. 액세스 토큰이 메모리에만 있어(S0 D2) 브라우저 이동 요청에 JWT를 실을 수 없다. 쿠키 Path를 콜백 경로로 좁혀 다른 요청에 안 실림 |
| D35 | `GET /me/game-accounts` 추가, 페이징 없는 객체 응답(`accounts` 최대 7행 = 라이엇 ID 3개 × lol·tft + 스팀 1, + `riot_verification` + `sync_quota`) | 설정 화면에 연동 상태·진행 중 확인·남은 횟수가 필요한데 문서 6장에 조회 경로가 없음. 사용자당 행 수 상한이 작아 커서가 의미 없다 |
| D36 | 「제공자」(riot/steam) 개념을 shared 상수 `GAME_PROVIDER_BY_CODE`로 둔다. games 테이블 컬럼은 추가하지 않음 | 연동·해제·동기화를 제공자 단위로 묶어야 함(D25). 새 게임 추가 시 enum·시드와 함께 한 줄 추가로 충분(설계 원칙 3 유지) |
| D37 | **(변경 — 사용자 답변 Q1)** 라이엇 ID는 사용자당 최대 `RIOT_ACCOUNTS_MAX`(기본 3)개, 스팀은 1개. `(user_id, game_id)` UNIQUE는 두지 않고 개수는 사용자 advisory lock + 검사로 보장. 랭킹·밸런스·프로필에 쓸 계정은 대표 계정(D56)으로 정한다 | 최초안(라이엇 1개)은 사용자 결정(2026-10-28)으로 바뀜. 3개·스팀 1개는 리더 기본값 |
| D38 | PUUID·스팀 ID·라이엇 매치 ID·이메일·discord_id는 프로필·설정 어디에도 노출하지 않음. 스팀은 personaname 표시 | 메인 기본값 7. 본인 설정까지 같은 규칙으로 두면 QA 규칙이 단순해지고 직렬화 실수 여지가 줄어든다 |
| D39 | 프로필의 미구현 자리는 `scrim: null`, `badges: null`(S1 스키마 `z.null()`). 이후 슬라이스는 nullable로 넓히기만 | 필드를 빼 두면 S3에서 응답 모양이 바뀌고, null 의미를 「데이터 없음」으로 고정하면 웹 빈 상태 코드가 그대로 재사용된다 |
| D40 | **(사용자 확정 Q3)** 최근 전적·주 포지션 = 대표 계정의 롤 **솔로 랭크(queue 420)** 최근 20경기. 프로필에는 10경기. 롤체 최근 전적은 S1 범위 밖(`recent_matches.placement` 자리만) | 목업 「RANKED SOLO 최근 솔로 랭크」, 메인 기본값 5. 롤체 Match API는 별도라 호출량이 두 배가 된다. 사용자 확정(2026-10-28) |
| D41 | 수동 새로고침 횟수는 DB(`game_account_sync_requests`)로 센다: 사용자 단위, 라이엇·스팀 합산, KST 자정 초기화, 라이엇 1회 = lol·tft, 진행 중이면 미차감, 실패해도 차감, advisory lock으로 동시 요청 직렬화. 해제 시 기록 유지(FK SetNull) | 메인 기본값 6, Redis 없이 동작. 해제·재연동으로 횟수를 되살리는 우회 차단 |
| D42 | 수동 새로고침은 비동기 202 + `sync_state` 폴링 | 라이엇 전체 동기화는 호출 20여 건이라 개발 키 한도에서 요청 시간 안에 끝난다는 보장이 없다 |
| D43 | cron 생산자는 Redis 유무와 무관하게 `@nestjs/schedule` + `pg_try_advisory_lock`, 소비자만 BullMQ/in-process로 교체. 수동 요청의 원본은 DB `sync_state` | 메인 기본값 3. 두 모드의 차이를 소비자 한 곳으로 줄여 Redis 없는 PC에서도 대부분을 테스트 |
| D44 | 동기화 실패 사유는 HTTP `ErrorCode`가 아닌 `GameAccountSyncError`(STEAM_PROFILE_PRIVATE 포함). 스팀 콜백 실패는 디스코드용 `OAUTH_*`를 재사용하지 않고 `STEAM_LINK_*` 별도 코드 | 동기화는 비동기라 HTTP 응답으로 실패를 줄 수 없다. `OAUTH_DENIED` 기본 메시지가 「디스코드 로그인 취소」라 의미가 섞인다 |
| D45 | **(사용자 확정 Q2)** 다른 멤버가 이미 연동한 외부 계정은 409 GAME_ACCOUNT_ALREADY_LINKED + 「운영진에게 문의」 안내. 소유 확인을 통과해도 옮기지 않음 | 사용자 결정(2026-10-28). 계정 양도·도용 분쟁은 운영진 판단(S6) |
| D46 | 연동 해제 = 행 삭제(티어 이력·전적·플레이타임 Cascade) | 해제한 계정의 과거 티어를 계속 보여줄 화면이 없다. 다시 연동하면 다시 쌓인다 |
| D47 | `.env.example`의 `REDIS_URL` 기본값을 빈 값으로 | S1부터 값이 있으면 BullMQ로 붙으려 한다. 그대로 복사한 Redis 없는 환경이 연결 오류로 시작하지 않게 |
| D48 | S0 D17의 「알림 설정 API 노출은 S1」을 철회, 알림 발송 기능 슬라이스로 미룸 | slice.md 제외 목록. 컬럼은 S0 그대로 둔다 |
| D49 | 라이엇 표시 이름(Riot ID 변경)은 연동 시와 수동 새로고침(`riot-full`) 때만 갱신, 주기 작업은 티어만 | 시간당 호출을 계정당 2건으로 유지 |
| D50 | 프로필 조회가 6시간 지난 전적 갱신을 큐에 넣는다(조회자 무관, 차감 없음). 30분 안에 실패 기록이 있으면 넣지 않음 | 문서 9장 「프로필 조회 시 6시간 이내 값이 없으면 갱신」. 키 만료 같은 지속 실패에 조회마다 호출하는 것을 막음 |
| D51 | 소유 확인 남용 방지: 시작 하루 10회(KST), 확인 간격 5초 → RATE_LIMITED | 시작·확인마다 라이엇 호출이 생겨 개발 키 한도를 소모 |
| D52 | 스팀 display_name = GetPlayerSummaries personaname(실패 시 「스팀 사용자」), 수동 새로고침 때 갱신 | D38로 스팀 ID를 못 보여주므로 사람이 알아볼 이름 필요 |
| D53 | 티어 색은 새 hex 없이 기존 토큰으로 매핑(매핑표는 웹 lib 한 곳) | S0 9-2 「컴포넌트 hex 금지」 유지. 예외는 D28 하나뿐 |
| D54 | `ApiPath`에 `:id` 템플릿을 두고 shared `fillPath`로 채운다 | 서버 라우트와 웹 호출이 같은 상수를 쓰게(S0 규칙 확장) |
| D55 | 티어 스냅샷은 tier·division·lp·wins·losses 중 하나라도 바뀔 때만 새 행. 언랭도 스냅샷으로 저장 | external-api-integration 5절. 시간당 동기화로 같은 행이 쌓이는 것 방지, 언랭 전환도 이력에 남김 |
| D56 | **(사용자 결정 Q1)** 대표 계정 `game_accounts.is_primary`. 라이엇은 라이엇 ID 단위(lol·tft 두 행 함께), 사용자당 1개. 첫 라이엇 연동이 자동 대표, 대표를 해제하면 남은 것 중 가장 먼저 연동한 것(verified_at, id 순) 승격, `POST /me/game-accounts/:id/primary`로 변경. 「사용자·게임별 대표 최대 1개」는 부분 고유 인덱스(WHERE is_primary)로 DB에서 보장 — Prisma가 표현 못 해 마이그레이션 SQL에 수동 추가. 스팀 행은 항상 is_primary=true. 대표를 쓰는 곳: 프로필 티어 카드·주 포지션·최근 전적(S1), 팀 밸런스 티어 시드(S3), 티어 랭킹(S4) | 사용자 결정(2026-10-28). 첫 대표·승격 규칙은 리더 기본값. 스팀을 항상 true로 두면 「게임별 대표 계정」 조회를 제공자 구분 없이 같은 조건으로 쓸 수 있다 |
| D57 | 부계정 티어도 동기화하고(`riot-tier`, 대표 다음 순서) 설정 목록의 `GameAccountView.rank`로 보여준다. 프로필 티어 카드·랭킹·밸런스에는 쓰지 않는다. 부계정 최근 전적은 수집하지 않는다 | 부계정을 대표로 바꾸면 바로 티어가 있어야 하고, 설정에서 대표를 고를 근거가 된다. 전적은 호출량이 커서 대표만 |
| D58 | 목업 Settings의 「부계정 추가 · 소유 확인 1/2 단계」를 그대로 살린다(진행 중 확인은 여전히 사용자당 1개). 단계 표기: 라이엇 ID 입력은 표기 없음, 아이콘 변경 = 1/2, 확인(대조) 중 = 2/2 | 사용자 결정 Q1 |
| D59 | (QA P1) 멈춘 행 정리·재획득을 위해 sync_state 전이에 queued→queued, running→queued, running→running을 추가하되, 10분(`SYNC_STATE_STALE_MS`) 지난 행에만 조건부 update로 허용 | 흐름을 두 단계(running→idle→queued)로 쪼개면 그 사이에 수동 요청이 끼어 중복 등록·횟수 판단이 흔들린다. 한 번의 조건부 update가 원자적 |
| D60 | (QA P3) 본인이 이미 연동한 라이엇 ID 재추가는 `GAME_ACCOUNT_ALREADY_LINKED_TO_ME`로 분리 | 부계정 허용(Q1) 후 「다른 멤버가 연동」 문구가 본인에게 나가는 오류 방지 |
| D61 | (QA P4) 연동 개수 한도를 `GetMyGameAccountsResponse.limits`로 내려준다 | `RIOT_ACCOUNTS_MAX`는 서버 환경 변수라 웹이 알 수 없음. 서버·웹 한도 불일치 방지 |
| D62 | 동기화 생산자의 DB 잠금은 세션 잠금(`pg_try_advisory_lock`)이 아니라 트랜잭션 잠금(`pg_try_advisory_xact_lock`)을 트랜잭션 안에서 쓴다 | integration 발견. 커넥션 풀에서 세션 잠금은 다른 커넥션에서 풀릴 수 있다. 리더 승인(2026-10-28) |
| D63 | BullMQ는 큐 하나(`external-sync`)를 쓴다. 429 시 `worker.rateLimit`이 큐 전체를 멈추므로 라이엇 429가 스팀 작업도 잠시 멈출 수 있다 — 허용 | 빈도가 낮고 큐 분리는 운영 복잡도만 늘림. 문제가 되면 제공자별 큐로 나눈다. 리더 승인 |
| D64 | 서버 시작 시 갓 `running`인 행은 건드리지 않고, 10분이 지나 멈춘 행 규칙(D59)으로만 회수한다 | 계약의 「시작 시 전부 정리」와 D59 멈춘 행 전용 규칙이 충돌. D59를 우선. 리더 승인 |
| D65 | 소유 확인 아이콘 후보 0–28이 모든 계정에서 선택 가능한지 공식 문서로 확인하지 못함(I2 미확인). 화면에 「이 아이콘이 없으면 다른 아이콘 받기」(= 재시작, 다른 아이콘 지정) 경로를 둔다. 실제 키로 확인 전까지 위험으로 남긴다 | integration I2. 실키 확인 필요 |
| D66 | 롤체 리그의 `wins`는 1위 횟수, `losses`는 2–8위(I3). 웹은 「순방 %」를 표시하지 않고 「1위 N회」와 1위 비율로 표기한다. 목업 Profile의 「순방 58%」 표기는 따르지 않는다 | integration I3(라이엇 스키마 필드 설명 기준, 부분 확인). 순방(4위 이내) 비율은 매치 데이터가 필요해 S1 범위 밖 |
| D67 | 멈춘 작업 정리(D59)와 서버 시작 시 queued 행 재등록은 라이엇이면 원래 종류와 상관없이 `riot-full`로 넣는다(6-2 「같은 종류 작업」 문구 대체). 이 회수 경로에 한해 D49의 「주기 작업은 티어만」 예외로 표시 이름 갱신을 허용한다 | QA integration m1. 행에 작업 종류가 저장되지 않으며 `riot-full`은 다른 종류를 모두 포함해 데이터 손실이 없다. 회수는 드문 경로라 호출 수 영향이 작다. 리더 결정(2026-10-29) |
| D68 | 중복 제거 키 형식은 `{kind}-{id}`(예: `manual-{id}`, `riot-tier-{id}`). 계약의 `{kind}:{id}` 표기를 대체 | BullMQ 6.5가 `:`가 들어간 jobId를 거부. QA integration 참고 |
| D69 | `SYNC_JOBS_ENABLED=false`는 cron 생산자(주기 작업·멈춘 작업 정리)만 끈다. 큐 소비자는 항상 실행한다 | QA integration m2. 소비자까지 끄면 수동 새로고침이 횟수만 차감되고 실행되지 않는다. 리더 결정 |
| D70 | `main.ts`는 `load-env.ts`로 `.env`를 AppModule import보다 먼저 읽는다 | `JobsModule.forRoot()`가 import 시점의 env(`REDIS_URL`, `SYNC_JOBS_ENABLED`)를 읽기 때문. backend B1, 리더 승인(2026-10-29) |
| D71 | 스팀 연동 실패 이동은 `/settings?steam_error={코드}`(shared `SettingsPageQuery`). 리더 지시문의 `?steam=코드` 표기는 오기 | backend B2 |
| D72 | `SYNC_JOBS_ENABLED`는 `true`/`false`만 허용하고 그 밖의 값은 기동 실패(`config/env.ts`). integration `options.ts`의 관대한 파싱은 검증을 통과한 값만 받으므로 그대로 둔다 | backend B11 |

---

## 15. 확인 필요 (사용자 판단)

현재 남은 항목 없음. 2026-10-28 질문 3건은 사용자 답변으로 해결됐다.

| # | 질문 | 해결 |
| --- | --- | --- |
| Q1 | 라이엇 부계정(목업 「부계정 추가」)을 허용하나? | 여러 개 허용 + 대표 계정 지정 → D37 변경, D56–D58 |
| Q2 | 다른 멤버가 이미 연동한 계정을 소유 확인 통과자에게 옮기나? | 옮기지 않고 막음 + 운영진 문의 안내 → D45 확정 |
| Q3 | 최근 전적·주 포지션 범위 | 솔로 랭크(420)만 → D40 확정 |

메인 기본값 1–7(아이콘 소유 확인, Steam OpenID, 큐 대체 경로, asia/kr 라우팅, 주 포지션 규칙, 하루 5회 합산, 프로필 공개·외부 식별자 비노출)은 이 계약에 그대로 반영했다(D32, D34, D43, 11절, D40, D41, D38).

---

## 16. 영향받는 기존 파일 (S0 계약 변경분)

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/common/errors.ts` | 오류 코드 14개·HTTP 상태 추가 |
| `packages/shared/src/constants/enums.ts` | GameProvider, GameAccountSyncState, GameAccountSyncError, RiotLinkVerificationStatus |
| `packages/shared/src/constants/games.ts` | GAME_PROVIDER_BY_CODE, GAME_CODES_BY_PROVIDER |
| `packages/shared/src/constants/transitions.ts` | RIOT_LINK_VERIFICATION_TRANSITIONS, GAME_ACCOUNT_SYNC_STATE_TRANSITIONS(멈춘 행 전이 포함), SYNC_STATE_STALE_MS, isStaleOnlySyncTransition |
| `packages/shared/src/paths.ts` | S1 경로 8개, `fillPath` |
| `packages/shared/src/index.ts` | 새 모듈 export |
| 새 파일 | `packages/shared/src/constants/riot.ts`, `game-accounts.ts`, `profile.ts`, `contract.s1.test.ts` |
| `apps/api/prisma/schema.prisma` + `migrations/20261028120000_s1/` | 3절 |
| `apps/api/src/common/app-error.ts` | `DEFAULT_ERROR_MESSAGE`에 S1 코드 14개(타입 검사 통과용 기본 문구) |
| `apps/web/src/lib/errors.ts` | `ERROR_MESSAGES`에 S1 코드 14개(초안, frontend가 다듬음) |
| `.env.example` | 11절 변수(RIOT_ACCOUNTS_MAX 포함), REDIS_URL 빈 값 |
| `_workspace/S0/01_architect_contract.md` 6절 game_accounts 행 | 역사 기록으로 두고 수정하지 않음 — S1 이후는 이 문서 3절이 우선 |
