# 계약: S5 봇 API, 디스코드 연동 판정, 서버 퇴장, 활동·플레이타임 랭킹, 홈 봇 데이터

명세: `게임 커뮤니티 대시보드 개발 문서.md`(이하 "문서") 2장 P1 「활동·플레이타임 랭킹」「지금 플레이 중」, 5장 activity_logs·api_keys·steam_playtime, 6장 봇 API·`/rankings/activity`·`/rankings/playtime`, 7-3, 8장 `/rankings`·`/settings`·`/`, 9장 캐싱. 슬라이스: `_workspace/00_input/slice.md`(메인 기본값 1–4 반영).
선행 계약: `_workspace/S0`(D1–D31), `S1`(D32–D72), `S2`(D73–D102), `S3`(D103–D139), `S4`(D140–D201)의 `01_architect_contract.md`. 와이어 형식(S0 3절), 외부 식별자 비노출(D38), 화면 env 값 노출(D101), 랭킹 캐시(S4 7절), 요약 부분 실패(S4 21절)는 그대로 쓴다. 이 문서는 다섯 계약을 **확장**하고, 깨는 것은 1-3절에 모두 적는다.
실제 계약은 코드가 우선한다: `packages/shared/src/**`(특히 `bot.ts`, `discord-link.ts`(연동 판정만), `rankings.ts` 끝 S5 절, `dashboard.ts` community), `apps/api/prisma/schema.prisma`.

## 변경 이력

| 날짜 | 변경 | 비고 |
| --- | --- | --- |
| 2026-10-31 | S5 최초 작성: 엔드포인트 신규 11개(웹 JWT 4 + 봇 7), 요약 응답 필수 블록 1개(`community`), 오류 코드 6개 추가(전체 49개), API 키 scope 2개 추가(전체 7개), 스키마 증분(마이그레이션 `20261031120000_s5`), core 함수 13개, 새 환경 변수 없음, 결정 D202–D231, 확인 필요 Q1–Q13 | architect |
| 2026-10-31 | **S5 수정 r1**(사용자 결정 + QA 결함): (1) Q3 답 = 활동 랭킹은 음성만. `ACTIVITY_RANKED_TYPES = ['voice']`, 응답 `play_sec` 제거(`total_sec = voice_sec`), 주 게임도 voice 기준, 표 머리 「VOICE TIME」. 봇은 play를 계속 받아 저장(D232, D233). (2) `GET /steam-apps` 보유자 조건을 플레이타임 랭킹과 같게, 화면 기본 게임 `pickDefaultPlaytimeAppId`(D234). (3) 보유자 0명 app도 빈 결과를 캐시에 저장, 플레이타임 `synced_at` non-null(D235). (4) 5-4 잠금 순서를 구현(advisory 먼저)에 맞춰 고침, 2절 NOT_FOUND 행 정리(D236). 마이그레이션·DB enum·오류 코드·엔드포인트 수 변경 없음. 확인 필요 Q3 닫음, Q14–Q16 추가. 작업 목록 14-1절 | architect |
| 2026-10-31 | **S5 수정 r2**(사용자 결정 2건): (A) 디스코드 연동 코드 기능 제거 — `POST /me/discord-link/code`, `POST /bot/link`, `GET /me/discord-link`(GET /me로 대체), `discord_link_codes` 표(마이그레이션 `20261031120000_s5` 다시 생성, migrate diff 일치), scope `bot:link`, 오류 코드 4개, shared 연동 코드 상수·함수·스키마, core `discordLinkCodeState`. 엔드포인트 신규 11 → 8(웹 2 + 봇 6), 오류 코드 추가 6 → 2(전체 45), scope 7 → 6, core 함수 13 → 12(D237, D238). 5절 전체를 「연동 판정」으로 축소, D236의 5-4 부분은 무효. (B) 활동 랭킹 행에 참고 열 `scrim_count`(그 기간 승인된 내전 참가 수, 정렬 무관, D239). 확인 필요 Q1·Q2·Q11·Q13 닫음, Q17 추가. 작업 목록 14-2절 | architect |
| 2026-10-31 | **S5 수정 D240**(사용자 결정): play는 「우리 채팅방 사람들과 같이 한 게임」이라는 보장이 없어 모든 활동 집계에서 제외한다(수신·저장만). shared `ACTIVITY_COUNTED_TYPES = ['voice', 'chat']` 추가, 활동 일수(`active_days`)·홈 `community.active_members` SQL이 이를 바인딩. D233 일수 부분 철회, Q14·Q15 닫음. `now_playing`·봇 수신 검증·마이그레이션·응답 모양 변경 없음 | backend |
| 2026-10-31 | **S2·S3 후속**(사용자 요청): 운영진만 `DELETE /scrims/:id`(승인 결과 있으면 409 `SCRIM_DELETE_NOT_ALLOWED`, 오류 코드 46). 롤체 `tft_mode` double_up·normal·ranked, 더블업만 2인 페어(`POST /scrims/:id/duos`, `duo_index`). 스팀·롤체 일반·랭크는 auto_balance 저장값 false. 스팀 `has_teams`는 유지(수동 팀·팀 승패). 마이그레이션 `20261031200000_scrim_delete_tft_mode`. 상세는 아래 「S2·S3 후속」 | 리더(architect 사용량 한도로 계약 초안 없이 구현) |

---

## 1. 범위

### 1-1. 포함

| 문서 행 | S5 범위 |
| --- | --- |
| 6장 봇 API 5개 중 4개 | `POST /bot/activity`, `GET /bot/users/lookup`, `GET /bot/scrims/upcoming`, `GET /bot/rankings/{type}`. `X-API-Key` 가드 + scope. `POST /bot/link`는 만들지 않는다(r2, D237) |
| 8장 `/settings` | 설정 화면 디스코드 영역: 「연동됨 / 미연동」 표시만(`GET /me`의 `discord_id`·`discord_username`, D238). 6장 연동 코드 흐름은 만들지 않는다(r2, D237) |
| S4 Q4 결정, S0 D24 | 서버 입장·퇴장 `POST /bot/member-events`(문서에 없음, D214) → `users.left_at`, 리프레시 토큰 폐기, `rankableUserWhere` |
| 2장 「지금 플레이 중」, 8장 홈 「접속 인원」 | 접속 현황 `PUT /bot/presence`(문서에 없음, D214), 요약 `community` 블록 |
| 2장·7-3 활동·플레이타임 랭킹 | `GET /rankings/activity?period=`, `GET /rankings/playtime?app_id=`, 같은 5분 캐시 |
| 9장 스팀 플레이타임 | S1 하루 1회 05:00 KST 배치 그대로 사용(코드 추가 없음, D225). 랭킹이 그 값을 읽는다 |
| 문서 5장 api_keys | 키 발급·목록·폐기 CLI(`apps/api/scripts/api-key.ts`, D221) |

### 1-2. 제외

디스코드 연동 코드 발급·봇 연결(`POST /me/discord-link/code`, `POST /bot/link`, `discord_link_codes`, r2 사용자 결정 D237), 관리자 화면 API 키 관리·패치노트·이벤트(S6), 실제 디스코드 봇 프로세스(이 저장소는 API까지, 호출 예시는 6-8절), 스팀 할인(출처 미정), 공통 보유 게임 추천(2장 P1, 슬라이스에 없음), 업적·포인트(P2), 지난주·지난달 활동 랭킹 조회(Q6), 결과·대기 승격 디스코드 DM(봇 엔드포인트 없음, Q12), 봇 요청 횟수 제한(Q11), 활동 기록 웹 조회(프로필 활동 그래프 없음).

### 1-3. 기존 결정 변경

| 기존 | 변경 | 이유 |
| --- | --- | --- |
| **S0 D23** 「`/bot/link` 연동 코드 테이블은 만들지 않음, S5에서 재검토」 | **재검토 결과 그대로 둔다(r2).** 연동 코드 표·흐름·`/bot/link`를 만들지 않는다. 연동 = 디스코드 로그인 때 자동으로 채워지는 `discord_id`(D237) | 사용자 결정. 로그인이 디스코드라 실제 회원은 가입 시점에 이미 연동된다. S5 최초 계약의 D202(코드 흐름 생성)는 철회 |
| **S4 D161** `rankableUserWhere = {}` | `{ leftAt: null }`. 원시 SQL용 같은 조건 `rankableUserSql`(`u.left_at IS NULL`)을 같은 파일에 둔다(D220) | S4 Q4 결정 그대로. 원시 SQL(티어 DISTINCT ON, 활동 집계)이 Prisma where를 쓸 수 없다 |
| **S4 `dashboard.ts` 주석** 「S5에서 stats에 추가한다(D39 넓히기)」 | `stats`는 그대로 두고 새 필수 블록 `community`에 넣는다(D218) | `stats`는 내전 집계(요청마다 DB)고 봇 자료는 각 칸이 자기 상태를 가져야 한다. 기존 `stats` 모양·테스트를 바꾸지 않는다 |
| **S1 프로필 `discord_linked`** `discordId && !startsWith('dev-')` | 같은 뜻을 shared `isLinkedDiscordId`(snowflake 정규식)로 정의. backend가 프로필도 이 함수로 바꾼다(값 변화 없음) | 연동 판정이 설정·봇·프로필에서 한 함수여야 한다 |
| **S0 auth 로그인 upsert** | 길드 검사를 실제로 통과한 로그인은 `left_at = null`, `guild_membership_at = max(기존, now)`(D220) | 봇이 꺼진 동안 재입장한 회원이 로그인으로 복구된다 |
| **S2 D98** `GET /steam-apps` 멤버 보유 게임 = `steam_playtime` 모든 행(app_name 있음) groupBy | 「보유자」= 플레이타임 랭킹 7-2와 같은 조건(대표·verified 스팀 계정, `minutes_total > 0`, 탈퇴 제외). q 없음·q 있음·`owner_count` 모두(D234) | 랭킹 게임 select 기본값이 빈 순위가 되는 결함(QA s5_web). `owner_count` 뜻을 하나로. 내전 작성 「스팀 게임 선택」 목록도 같이 좁아진다(Q16) |

그대로 유지: D38(웹 응답에 discord_id 없음 — 봇 응답만 예외, D209), D146(캐시 저장소 하나), D148(첫 요청 동기 계산), D153(티어·플레이타임 순위 변동 기준), D154(페이징 없음), D156(요약 전체 캐시 금지), D196–D201(요약 부분 실패).

---

## 2. 오류 코드

**2개 추가(전체 45개).** r2에서 연동 코드 오류 4개(`DISCORD_LINK_CODE_INVALID`, `DISCORD_LINK_CODE_EXPIRED`, `DISCORD_ID_ALREADY_LINKED`, `DISCORD_ACCOUNT_ALREADY_LINKED`)를 뺐다(D237). `packages/shared/src/common/errors.ts`, 기본 문구 `apps/api/src/common/app-error.ts`, 화면 문구 `apps/web/src/lib/errors.ts`(architect 반영 완료).

| code | HTTP | 상황 |
| --- | --- | --- |
| API_KEY_INVALID | 401 | `X-API-Key` 없음, `API_KEY_PATTERN` 불일치, 해시가 없는 키, `revoked_at` 있음 |
| API_KEY_SCOPE_MISSING | 403 | 키는 맞지만 `BOT_ENDPOINT_SCOPE[엔드포인트]`가 `scopes`에 없음 |

기존 코드 재사용:

| code | 상황 |
| --- | --- |
| VALIDATION_FAILED | 봇 요청 형식(모르는 필드 `.strict()`, 건수 한도, chat duration ≠ 0, 모르는 게임 코드, 오프셋 없는 시각), `period`·`app_id` 값, `GET /bot/rankings/:type`의 경로 `type`이 `BotRankingType` 밖(Nest 라우트는 하나, details path `type` — 6-5) |
| NOT_FOUND | `GET /bot/users/lookup`에 연결된 회원 없음(D224). 이 경우뿐이다 |
| INTERNAL_ERROR | 빈 캐시 첫 계산 실패(S4와 같음, `GET /rankings/*`·`GET /bot/rankings/*` 500) |

봇 활동·입퇴장·접속 현황의 건별 실패는 **HTTP 오류가 아니다**. 요청은 200이고 결과 배열의 `status`·`reason`으로 알린다(D213).

---

## 3. 스키마 변경 (`apps/api/prisma/schema.prisma`)

마이그레이션: `apps/api/prisma/migrations/20261031120000_s5/migration.sql` — `prisma migrate diff --from-schema-datamodel <S4 schema(HEAD 92370dd)> --to-schema-datamodel prisma/schema.prisma --script`의 **stdout만** 저장했고, 주석 줄을 뺀 비교에서 차이가 없다(architect 확인, **r2에서 `discord_link_codes`를 빼고 다시 생성·재확인**. 미배포·미커밋이라 같은 이름을 고쳐 썼다). 수동 블록 없음, `DROP` 문장 없음(주석에 단어만 있음). `prisma format`·`prisma validate`(가짜 `DATABASE_URL`)·`prisma generate` 통과. DB 적용 미실행(Docker 없음).

| 대상 | 변경 | 근거 |
| --- | --- | --- |
| users | **추가** `left_at timestamptz NULL`, `guild_membership_at timestamptz NULL` | S4 Q4, D220 |
| activity_logs | **추가** `api_key_id uuid NULL` FK api_keys(ON DELETE SET NULL) | D223 감사 |
| (r2) discord_link_codes | **만들지 않는다**(D237). `users.discord_id`는 S0 그대로 로그인 때 채운다 | 사용자 결정 |
| bot_presence | **새 표**: `id`, `source` UNIQUE, `captured_at`, `voice_member_count int`, `playing jsonb DEFAULT '[]'`, `api_key_id?` FK api_keys(SET NULL), `created_at`, `updated_at` | D214 |
| api_keys | 컬럼 변경 없음. `scopes` 값은 S5 봇 엔드포인트 6개와 1:1(`bot:activity`, `bot:users:read`, `bot:scrims:read`, `bot:rankings:read`, `bot:members`, `bot:presence`). S0의 `bot:link`는 r2에서 뺐다(text[]라 마이그레이션 없음, 발급된 키 없음) | D214, D237 |

문서 5장 인덱스 3개(`ratings(game_id, season_id, elo desc)`, `activity_logs(user_id, started_at)`, `scrim_players(scrim_id, status)`)와 `activity_logs.idempotency_key` UNIQUE는 그대로 있다. 활동 기간 집계는 기존 `activity_logs(started_at)` 인덱스를 쓴다.

컬럼 의미:

| 컬럼 | 의미 |
| --- | --- |
| users.left_at | 마지막으로 반영된 퇴장의 `occurred_at`. null이면 서버 멤버. 순위 대상 판정에만 쓴다(로그인·참가는 막지 않는다, Q8) |
| users.guild_membership_at | 마지막으로 반영한 입장·퇴장 판단 시각(봇 `occurred_at` 또는 길드 검사 통과 로그인 시각). 이보다 이르거나 같은 이벤트는 `stale` |
| bot_presence.source | 지금은 `'default'` 한 행(디스코드 서버 1개, Q9) |
| bot_presence.playing | shared `BotPresencePlayingStored`. 읽을 때 parse 실패면 `[]` |
| activity_logs.api_key_id | 그 행을 보낸 키. 키가 유출되면 이 값으로 행을 찾아 지울 수 있다 |

기존 행: `left_at` NULL(모두 서버 멤버로 본다). 이전 데이터 소급 없음.

---

## 4. 엔드포인트 (S5)

모두 `/api/v1`. 이름은 shared export, 경로는 `ApiPath`. 직렬화는 반드시 shared parse(D38).

### 4-1. 웹 (JWT, 멤버 전원)

| 메서드 | 경로 (`ApiPath`) | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- |
| GET | /rankings/activity (`rankingsActivity`) | `GetActivityRankingQuery {period?: week\|month}` | 200 `GetActivityRankingResponse` | VALIDATION_FAILED, INTERNAL_ERROR |
| GET | /rankings/playtime (`rankingsPlaytime`) | `GetPlaytimeRankingQuery {app_id}` | 200 `GetPlaytimeRankingResponse` | VALIDATION_FAILED, INTERNAL_ERROR |
| GET | /dashboard/summary (기존) | 그대로 | `community` 필수 블록 추가(8절) | 그대로 |

r2: `GET /me/discord-link`·`POST /me/discord-link/code`는 없다. 설정 화면 연동 상태는 기존 `GET /me`(`discord_id`, `discord_username`)로 그린다(D238).

### 4-2. 봇 (`X-API-Key`)

| 메서드 | 경로 (`ApiPath`) | scope | Request | Response | 오류 코드 |
| --- | --- | --- | --- | --- | --- |
| POST | /bot/activity (`botActivity`) | bot:activity | `PostBotActivityRequest` | 200 `PostBotActivityResponse` | API_KEY_*, VALIDATION_FAILED |
| GET | /bot/users/lookup (`botUserLookup`) | bot:users:read | `GetBotUserLookupQuery {discord_id}` | 200 `GetBotUserLookupResponse` | API_KEY_*, VALIDATION_FAILED, NOT_FOUND |
| GET | /bot/scrims/upcoming (`botUpcomingScrims`) | bot:scrims:read | `GetBotUpcomingScrimsQuery {within_min?}` | 200 `GetBotUpcomingScrimsResponse` | API_KEY_*, VALIDATION_FAILED |
| GET | /bot/rankings/:type (`botRanking`) | bot:rankings:read | `GetBotRankingParams` + `GetBotRankingQueryByType[type]` | 200 `GetBotRankingResponse` | API_KEY_*, VALIDATION_FAILED, INTERNAL_ERROR |
| POST | /bot/member-events (`botMemberEvents`) | bot:members | `PostBotMemberEventsRequest` | 200 `PostBotMemberEventsResponse` | API_KEY_*, VALIDATION_FAILED |
| PUT | /bot/presence (`botPresence`) | bot:presence | `PutBotPresenceRequest` | 200 `PutBotPresenceResponse` | API_KEY_*, VALIDATION_FAILED |

- 문서 6장 대비: 문서 5개 중 4개는 경로 그대로, `/bot/link`는 만들지 않는다(D237). `member-events`·`presence`는 문서에 없어 추가(D214). 봇 엔드포인트는 6개. `{type}`은 Nest `:type`.
- 봇 엔드포인트는 JWT 가드·`OriginGuard`를 거치지 않는다(서버 대 서버, CORS 없음 S0). 쿠키를 읽지 않는다.
- 봇 응답에는 `discord_id`가 들어간다(`BotUserRef`). 웹 응답 스키마에는 여전히 없다(D209).

---

## 5. 디스코드 연동 판정 (r2: D237, D238)

**r2(사용자 결정 2026-10-31): 연동 코드 기능을 만들지 않는다.** 로그인이 디스코드 OAuth라 가입·로그인 때 `users.discord_id`에 snowflake가 들어가고, 그것이 곧 연동이다(S0 5-2, D23). S5 최초 계약의 5-2–5-5(코드 발급·`/bot/link`·코드 수명·잠금 순서)는 전부 삭제했다. D236의 5-4 잠금 순서 정정도 대상이 없어졌다.

### 5-1. 연동 판정

`linked = isLinkedDiscordId(users.discord_id)` — `^\d{17,20}$`(shared `discord-link.ts`에 남은 유일한 export). 디스코드 로그인 회원은 첫 로그인부터 linked다. null·`dev-…`(개발 전용 로그인)는 미연동이고 바꿀 방법이 없다(개발 환경만의 상태).

| 쓰는 곳 | 규칙 |
| --- | --- |
| 봇 `POST /bot/activity`·`/bot/member-events` | `users.discord_id = 이벤트 discord_id`인 회원이 없으면 `unlinked`(저장·반영 안 함, D213 그대로) |
| 봇 `GET /bot/users/lookup` | 없으면 404 NOT_FOUND(D224) |
| `GET /bot/scrims/upcoming` `notify_discord_ids` | `isLinkedDiscordId` 통과자만 |
| 프로필 `discord_linked`(S1) | `isLinkedDiscordId`(값 변화 없음) |
| 웹 설정 화면 | `GET /me`의 `discord_id`로 `isLinkedDiscordId`, 이름은 `discord_username`(10절, D238) |

연동 해제는 없다(D204 그대로). 디스코드 계정을 바꾸려면 다른 디스코드 계정으로 로그인한다(새 회원이 된다, S0 규칙).

---

## 6. 봇 API (D209–D224)

### 6-1. 인증 가드 `ApiKeyGuard` + 데코레이터 `@BotScope(scope)`

1. 헤더 `x-api-key`(`BOT_API_KEY_HEADER`). 없음·`API_KEY_PATTERN` 불일치 → `API_KEY_INVALID`.
2. `hash = sha256Hex(raw)` → `apiKey.findUnique({ where: { keyHash } })`. 없음·`revokedAt` 있음 → `API_KEY_INVALID`.
3. 메타데이터 scope가 `scopes`에 없음 → `API_KEY_SCOPE_MISSING`. scope 메타데이터가 없는 핸들러에 가드가 붙어 있으면 거부(설정 실수 방지).
4. `lastUsedAt`이 null이거나 `now − lastUsedAt ≥ API_KEY_LAST_USED_WRITE_INTERVAL_SEC`이면 `updateMany({ where: { id, OR: [{lastUsedAt: null}, {lastUsedAt: {lte: now − 60s}}] }, data: { lastUsedAt: now } })`. 실패는 로그만(요청은 계속).
5. `request.apiKey = { id, name, scopes }`.

키 원문은 로그에 남기지 않는다(`key_prefix`만). 키 유틸 `apps/api/src/common/api-key.ts`:

```ts
export function generateApiKey(): { raw: string; prefix: string; hash: string }; // raw = API_KEY_PREFIX + randomBytes(32).toString('base64url')
export function hashApiKey(raw: string): string;                                  // sha256 hex
```

**발급 CLI** `apps/api/scripts/api-key.ts`(`package.json` 스크립트 `api-key`, tsx 실행):

```
corepack pnpm --filter api api-key create --name "디스코드 봇" --scopes bot:activity,bot:users:read,bot:scrims:read,bot:rankings:read,bot:members,bot:presence
  → 원문 1회 출력 + id, key_prefix, scopes
corepack pnpm --filter api api-key list      → id, name, key_prefix, scopes, last_used_at, revoked_at (원문 없음)
corepack pnpm --filter api api-key revoke --id <uuid>   (또는 --prefix <8자>) → revoked_at = now
```

scope 값은 `ApiKeyScope`로 parse한다(모르는 값이면 종료 코드 1). `created_by`는 null(CLI). 시드로 키를 만들지 않는다(원문이 저장소에 남는다, D221).

### 6-2. `POST /bot/activity` (D210–D213)

```
now = clock.now() 1회
1. body parse(PostBotActivityRequest). 실패 → 400 VALIDATION_FAILED(details path `events.3.type`)
2. stored = activity_logs.idempotency_key IN (요청 키 전체) → Set
3. users = users.discord_id IN (요청 discord_id 전체) → Map<discord_id, user_id>   (left_at 무관)
4. games = games.code IN (요청 game) → Map<code, game_id>. GameCode인데 행이 없으면 그 이벤트 game_id = null + 로그(D135와 같은 처리)
5. plan = core planActivityBatch({ events, storedKeys, userIdByDiscordId, now })
6. 'insert' 행: INSERT INTO activity_logs (...) VALUES ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key
   RETURNING에 없는 키 → duplicate(경합)
7. 200 { results(요청 순서), counts }
```

`planActivityBatch` 판정 순서(이벤트마다): 이 요청 안 앞 이벤트와 같은 키 → `duplicate` / `storedKeys`에 있음 → `duplicate` / `checkActivityEventTime` → `rejected` + reason / 회원 없음 → `unlinked` / 그 외 `insert(userId)`.

| 규칙 | 값 | 결정 |
| --- | --- | --- |
| 한 요청 최대 | 100건(`BOT_ACTIVITY_BATCH_MAX`), 넘으면 요청 전체 400 | D211 |
| 이벤트 길이 | voice·play 1–86400초, chat 정확히 0초 | D210, D212 |
| 과거 한도 | `started_at ≥ now − 7일`(같으면 허용), 아니면 `STARTED_AT_TOO_OLD` | D211 |
| 미래 한도 | `started_at + duration_sec ≤ now + 300초`(같으면 허용), 아니면 `ENDS_IN_FUTURE`. 끝난 세션만 받는다 | D211 |
| 미연동 | 저장 안 함, `unlinked`. 나중에 연동해도 소급 없음(메인 기본값 1) | D213 |
| 탈퇴 회원 | 저장한다(랭킹에서는 빠진다) | D220 |
| play 이벤트 | 그대로 받아 저장한다(`ActivityType`·DB enum 변경 없음). 활동 랭킹 시간·주 게임·활동 일수·홈 「이번 주 활동 멤버」 어디에도 쓰지 않는다(수신·저장만) | D232, D240 |
| 중복 | 먼저 저장된 것이 남는다. 내용이 달라도 덮지 않는다 | 문서 6장 |
| 겹치는 세션 | 서버가 합치거나 자르지 않는다(봇 책임) | D212 |
| 트랜잭션 | 묶지 않는다. 6번 INSERT 한 문장이 원자적. 2번 이후 경합은 ON CONFLICT가 막는다 | - |
| api_key_id | `request.apiKey.id` | D223 |

### 6-3. `GET /bot/users/lookup?discord_id=` (D224)

`users.discord_id = $1` 없음 → 404 NOT_FOUND. 탈퇴 회원도 찾는다(`left_at` 값 포함).

| 필드 | 출처 |
| --- | --- |
| user | `BotUserRef` + role, joined_at(created_at), left_at |
| tiers | 대표 라이엇 계정(`is_primary && verified`) lol·tft 각 큐 최신 스냅샷(프로필 S1 규칙). UNRANKED·없음은 행 생략. `synced_at` = 계정 `last_synced_at` |
| season | `resolveSeasonAt(now)`. 없으면 null |
| ratings | season 있으면 그 시즌 내 `ratings` 행(게임 sort_order 순). `rank` = `RankingsReader.eloRankOf`(캐시 읽기 전용) |

### 6-4. `GET /bot/scrims/upcoming?within_min=` (D222)

`status ∈ {recruiting, full} AND scheduled_at >= now AND scheduled_at < now + within_min분`, `scheduled_at ASC, id ASC`, 최대 50. N+1 금지(참가자·호스트 일괄 조회).

- `joined_count`·`waitlist_count`: `scrim_players` status별 수.
- `notify_discord_ids`: joined 참가자 중 `isLinkedDiscordId(discord_id) && notify_scrim_start && left_at IS NULL`, 중복 없음, 문자열 오름차순.
- `url` = `{WEB_ORIGIN}/scrims/{id}`, `host` = `BotUserRef`.
- 봇은 `within_min=30`으로 1–5분마다 부르고 `(scrim id, scheduled_at)`으로 보낸 기록을 관리한다(시작 시각을 바꾸면 다시 알린다).

### 6-5. `GET /bot/rankings/:type` (D215)

경로 `type`을 `GetBotRankingParams`로 parse(실패 → VALIDATION_FAILED, path `type`), 쿼리는 `GetBotRankingQueryByType[type]`.

| type | 읽는 곳(웹과 같은 캐시 행) | value | detail(서버 문구) | context | web_url |
| --- | --- | --- | --- | --- | --- |
| tier | `RankingsReader.tier(game)` | score | `{Tier} {Div} · {lp} LP`(마스터 이상 디비전 생략, 티어 첫 글자만 대문자) | game | `/rankings?tab=tier&game={game}` |
| elo | `eloView(game, 기본 시즌)` | elo | `{wins}승 {losses}패` | game, season, is_final | `/rankings?tab=elo&game={game}` |
| activity | `activity(period)` | total_sec(= 음성 초, D232) | `{period_days}일 중 {active_days}일 활동 · 내전 {scrim_count}회`(r2, D239. scrim_count 0이면 뒤 부분 생략) | period, period_start, period_end | `/rankings?tab=activity&period={period}` |
| playtime | `playtime(app_id)` | minutes_total | `최근 2주 {floor(minutes_recent/60)}시간` | app(보유자 없음이면 `{app_id, name: null}`) | `/rankings?tab=playtime&app_id={id}` |

`items` = 캐시 entries 앞 `limit`명(`me` 없음), `user` = `BotUserRef`(entries의 user id로 users를 일괄 조회해 discord_id·profile_url을 붙인다). `total`·`synced_at`·`stale`은 웹 응답과 같다. `unit` = `BOT_RANKING_UNIT_BY_TYPE[type]`. playtime `synced_at`은 보유자 없음에도 캐시 계산 시각이다(D235, null은 elo뿐). 빈 캐시 첫 계산 실패 → 500(웹과 같음). 순위 계산 경로를 새로 만들지 않는다.

### 6-6. `POST /bot/member-events` (D220, D230)

```
now = clock.now() 1회
users = users.discord_id IN (요청 discord_id) → Map
plan = core planMemberEvents({ events, users: Map<discord_id, {userId, guildMembershipAt}>, now })
트랜잭션(이벤트가 가리키는 사용자마다 advisoryXactLock(`membership:{userId}`), user id 오름차순으로 잠근다):
  사용자별 최종 상태를 조건부 update:
    users.updateMany({ where: { id, OR: [{guildMembershipAt: null}, {guildMembershipAt: {lt: 최종 occurred_at}}] },
                       data: { leftAt, guildMembershipAt } })
    영향 0행(잠금 전 다른 요청이 더 새 값을 씀) → 그 사용자 이벤트 결과를 stale로 바꾼다
  최종 상태가 leave이고 반영됐으면 refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })  (S0 D24)
200 { results(요청 순서) }
```

`planMemberEvents` 규칙: 미래 한도(`occurred_at > now + 300초`) → `rejected`. 회원 없음 → `unlinked`. 같은 사용자 이벤트는 `occurred_at` 오름차순(같으면 요청 순서)으로 차례로 보고, 현재 판단 시각(처음엔 `guild_membership_at`)보다 늦으면 `applied` + 현재 시각 갱신, 아니면 `stale`. leave → `left_at = occurred_at`, join → `left_at = null`. 같은 사용자의 마지막 applied가 최종 상태다.

| 시나리오 | 결과 |
| --- | --- |
| 퇴장 → 재입장(같은 요청) | 둘 다 applied, 최종 left_at null. 최종이 join이라 토큰을 폐기하지 않는다 |
| 재입장이 먼저 도착하고 퇴장(더 이른 시각)이 나중에 도착 | 퇴장 stale(무시) |
| 퇴장 재전송 | stale |
| 로그인(길드 검사 통과) 뒤 그보다 이른 퇴장 도착 | stale(로그인이 guild_membership_at = now로 앞섰다) |
| 미연동 회원 퇴장 | unlinked |

로그인 쪽(`auth.service.ts`): 길드 검사를 실제로 한 로그인에서 통과하면 같은 upsert에 `leftAt: null`과 `guildMembershipAt: now`를 넣는다. 단 `guildMembershipAt > now`면(시계 차이) 그대로 둔다. `DISCORD_GUILD_ID`가 비어 검사를 안 하면 두 컬럼을 건드리지 않는다.

### 6-7. `PUT /bot/presence` (D214, D219)

```
now = clock.now()
reason = core checkPresenceCapture({ capturedAt, storedCapturedAt: null, now })  → IN_FUTURE | TOO_OLD 이면 200 {accepted:false, reason}
INSERT INTO bot_presence (id, source, captured_at, voice_member_count, playing, api_key_id, created_at, updated_at)
VALUES (gen, 'default', …) ON CONFLICT (source) DO UPDATE SET … WHERE bot_presence.captured_at < EXCLUDED.captured_at
RETURNING id
없음 → {accepted:false, reason:'OLDER_THAN_STORED'}, 있음 → {accepted:true, reason:null}
```

`id`는 앱에서 `randomUUID()`(Prisma `@default(uuid())`는 원시 SQL에 적용되지 않는다). 봇 권장 간격 60초. 접속 현황은 이력을 쌓지 않는다(마지막 1행).

### 6-8. 봇 호출 예시

```bash
API=https://gcd.example/api/v1 ; KEY=gcd_xxx…

# 음성 세션 종료 시(KST 자정을 넘기면 나눠서 보낸다)
curl -sX POST $API/bot/activity -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "events":[
    {"idempotency_key":"voice-123456789012345678-20261027T2010","discord_id":"123456789012345678","type":"voice","game":"lol","started_at":"2026-10-27T20:10:00+09:00","duration_sec":3600},
    {"idempotency_key":"chat-123456789012345678-20261027","discord_id":"123456789012345678","type":"chat","started_at":"2026-10-27T20:15:00+09:00","duration_sec":0}
  ]}'
# → 200 {"results":[{"idempotency_key":"voice-…","status":"created","reason":null},{"idempotency_key":"chat-…","status":"duplicate","reason":null}],"counts":{"created":1,"duplicate":1,"unlinked":0,"rejected":0}}
# 재전송 정책: 5xx·네트워크 실패면 같은 키로 그대로 재전송(duplicate는 성공으로 본다). unlinked·rejected는 재전송하지 않는다

curl -s "$API/bot/users/lookup?discord_id=123456789012345678" -H "X-API-Key: $KEY"
curl -s "$API/bot/scrims/upcoming?within_min=30" -H "X-API-Key: $KEY"
curl -s "$API/bot/rankings/elo?game=lol&limit=5" -H "X-API-Key: $KEY"
curl -s "$API/bot/rankings/activity?period=week" -H "X-API-Key: $KEY"
curl -s "$API/bot/rankings/playtime?app_id=578080" -H "X-API-Key: $KEY"

# guildMemberRemove / guildMemberAdd
curl -sX POST $API/bot/member-events -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"events":[{"discord_id":"123456789012345678","type":"leave","occurred_at":"2026-10-31T21:00:00+09:00"}]}'

# 60초마다
curl -sX PUT $API/bot/presence -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"captured_at":"2026-10-31T21:00:00+09:00","voice_member_count":23,"playing":[{"name":"League of Legends","game":"lol","steam_app_id":null,"count":8}]}'
```

멱등 키 권장 형식: `{type}-{discord_id}-{세션 시작 KST yyyyMMddTHHmm}`(문서 예시와 같은 모양). chat은 `chat-{discord_id}-{KST yyyyMMdd}`로 하루 1건.

---

## 7. 활동·플레이타임 랭킹 (D215–D217, D232–D235, D240)

S4 7절 캐시(`ranking_caches`, `RankingCacheStore`, `RankingCalculator.computeAndStore`, `RankingsReader`, `RankingRefresher`, 5분 cron)를 그대로 쓴다. 키 2종류 추가(`ranking-keys.ts`):

| key | payload | 갱신 대상(S4 7-4 targets에 추가) |
| --- | --- | --- |
| `rankings:activity:week`, `rankings:activity:month` | `ActivityRankingCachePayload` | 항상 둘 다 |
| `rankings:playtime:{app_id}` | `PlaytimeRankingCachePayload` | 보유자(아래 정의) 수 상위 `RANKING_PLAYTIME_APPS_MAX`(50)개 app(보유자 수 DESC, app_id ASC 동점) |

**플레이타임 「보유자」(D234)** — 한 곳의 정의를 7-2 랭킹 행, 갱신 대상 상위 50, `GET /steam-apps`(7-4)가 함께 쓴다:

```
steam_playtime sp
JOIN game_accounts ga ON ga.id = sp.game_account_id AND ga.is_primary AND ga.verified
JOIN games g ON g.id = ga.game_id AND g.code = <steam 제공자 코드>
JOIN users u ON u.id = ga.user_id AND <rankableUserSql>
WHERE sp.minutes_total > 0
```

backend는 이 조건을 SQL 조각 하나(예: `rankings/playtime-holders.ts`의 `playtimeHolderJoinSql`)로 두고 세 곳이 import한다(복제 금지).

`deleteExcept`가 대상 밖 playtime 키를 지운다. 대상 밖 게임을 누가 요청하면 첫 계산 → 저장(보유자 0명이어도 빈 결과를 저장, D235) → 다음 주기에 삭제 → 다음 요청에 다시 계산. 즉 어떤 app_id든 최대 5분에 한 번 계산된다(D217). `/steam-apps`(q 없음) 20개는 같은 조건·같은 순서의 앞부분이라 미리 갱신 대상 안에 있다(이름 없는 app을 빼서 밀린 경우만 예외이고, 그때도 첫 요청 계산 뒤 캐시를 읽는다).

### 7-1. 활동 entries (`period`)

```
w = core activityPeriodWindow(period, now)        // {start, end, days}
행 = SELECT al.user_id,
        SUM(CASE WHEN al.type IN (<ACTIVITY_RANKED_TYPES>) THEN al.duration_sec ELSE 0 END) AS voice_sec,   -- = 'voice'만(D232)
        COUNT(DISTINCT (al.started_at AT TIME ZONE 'Asia/Seoul')::date)::int AS active_days          -- voice·chat만(D240)
     FROM activity_logs al JOIN users u ON u.id = al.user_id AND <rankableUserSql>
     WHERE al.started_at >= w.start AND al.started_at < w.end
       AND al.type IN (<ACTIVITY_COUNTED_TYPES>)                                                    -- play 행 제외(D240)
     GROUP BY al.user_id
게임 = SELECT al.user_id, al.game_id, SUM(al.duration_sec) AS sec FROM … 같은 조건 AND al.game_id IS NOT NULL AND al.type IN (<ACTIVITY_RANKED_TYPES>) GROUP BY 1, 2   -- voice만
entries = core buildActivityRanking(행) + 사용자별 core pickMainGames(게임 + games.sort_order) → ActivityGameRef
내전 = SELECT sp.user_id, COUNT(DISTINCT s.id)::int AS scrim_count                                   -- r2 참고 열(D239)
     FROM scrim_players sp
     JOIN scrims s ON s.id = sp.scrim_id AND s.status <> 'cancelled'
     JOIN users u ON u.id = sp.user_id AND <rankableUserSql>
     WHERE sp.status = 'joined'
       AND EXISTS (SELECT 1 FROM scrim_results r WHERE r.scrim_id = s.id AND r.status = 'approved')
       AND COALESCE(s.started_at, s.scheduled_at) >= w.start AND COALESCE(s.started_at, s.scheduled_at) < w.end
       AND sp.user_id IN (순위에 든 user id)                                                        -- 순위 밖 회원은 세지 않는다
     GROUP BY sp.user_id
entry = { rank, user, total_sec: totalSec, voice_sec: voiceSec, active_days, main_games, scrim_count: 내전[user] ?? 0 }   -- play_sec 없음, total_sec === voice_sec(shared refine)
bot_connected = EXISTS(activity_logs) OR EXISTS(bot_presence)
```

- 음성만(D232): play 행은 시간·주 게임에 들어가지 않는다. play만 있는 회원은 voice_sec 0이라 순위에 없다(chat만 있는 회원과 같다). SQL의 type 목록은 문자열을 박지 말고 shared `ACTIVITY_RANKED_TYPES`로 만든다(`Prisma.join`).
- **play 제외(D240, 사용자 결정):** 활동 일수는 `ACTIVITY_COUNTED_TYPES`(voice·chat)만 센다. 합계 SQL은 행 자체를 이 목록으로 거른다 — `ACTIVITY_RANKED_TYPES ⊂ ACTIVITY_COUNTED_TYPES`(shared 계약 테스트)라 voice_sec은 변하지 않고, play만 한 날은 「N일 중 M일 활동」에 들지 않는다. 목록은 `Prisma.join`으로 바인딩한다(문자열 리터럴 금지). 봇 activity `detail` 문구 형식은 그대로이고 숫자만 이 규칙을 따른다.
- **내전 참여 수 `scrim_count`(r2, D239):** 참고 열이다. 정렬·`total_sec`·순위 포함 여부에 쓰지 않는다 — 순위는 `buildActivityRanking`(voice > 0)이 정한 뒤 붙인다. 내전만 있고 음성이 0인 회원은 순위에 없다. 셈: 참가 확정(`scrim_players.status = 'joined'`) + 결과 승인(`scrim_results.status = 'approved'`가 1건 이상) + 취소 아닌 내전. 대기(`waitlist`)·참가 취소(`cancelled`)·노쇼(`no_show`) 행, 결과 대기·반려만 있는 내전은 세지 않는다. `rated` 여부와 게임은 따지지 않는다(친선 내전도 참여). 기간 귀속 = 내전 시작 시각 `COALESCE(started_at, scheduled_at)`(승인 결과가 있으면 `started_at`이 있다. 없는 옛 행만 예정 시각)이 `[w.start, w.end)` 안. 5분 캐시 payload에 들어가므로 승인 직후 최대 5분 늦게 반영된다. 탈퇴 회원은 순위에 없으니 자연히 빠진다.
- `SUM`은 bigint라 `::int` 또는 `Number()` 변환(사용자당 한 달 최대 31 × 86400 × 겹침 수, int 범위 안. 겹친 세션이 많으면 넘을 수 있어 `Number(bigint)` 권장).
- 귀속은 `started_at` 하나로 정한다. 일요일 23:30에 시작한 2시간 세션은 그 주에 전부 들어간다(D212, 봇이 자정에 나누면 생기지 않는다).
- **순위 변동(D216):** `computeAndStore`의 `rollRankBaseline({ stored, previousRanks, weekStart: w.start })` — 함수는 그대로이고 기준 시작값만 기간 시작이다. 기간이 바뀐 첫 계산의 기준 = 이전 payload(직전 기간 마지막 스냅샷)의 순위다. 화면 의미: 「지난주(지난달) 최종 순위 대비」.
- **옛 캐시 행:** S5 최초 계약 모양(`play_sec` 있음, total = voice + play, `scrim_count` 없음)의 payload는 shared refine(`total_sec === voice_sec`)·필수 `scrim_count`에 걸려 parse 실패 → `readValid`가 캐시 없음으로 보고 다시 계산한다. 마이그레이션·수동 삭제 불필요(D232).
- **기간이 바뀐 읽기:** `RankingsReader.activity(period)`는 payload의 `period_start`가 `w.start`와 다르면 **캐시 없음으로 보고** 첫 계산 경로(동기, key별 단일 실행)를 탄다. 월요일 00:00 직후 최대 5분 동안 지난주 순위가 「이번 주」로 보이는 것을 막는다. 이 첫 계산이 실패하면 500이다(지난 기간 값을 이번 기간 값처럼 보이지 않는다).

### 7-2. 플레이타임 entries (`app_id`)

```
SELECT ga.user_id, ga.display_name, sp.minutes_total, sp.minutes_recent, sp.synced_at, sp.app_name
FROM steam_playtime sp JOIN game_accounts ga ON ga.id = sp.game_account_id
JOIN users u ON u.id = ga.user_id AND <rankableUserSql>
JOIN games g ON g.id = ga.game_id AND g.code = 'steam'      -- 코드 문자열은 GAME_PROVIDER_BY_CODE에서 steam 제공자 코드로 얻는다
WHERE sp.app_id = $1 AND ga.is_primary AND ga.verified AND sp.minutes_total > 0
```

(위 SQL은 7절 「보유자」 조각을 쓴다.)

- **행이 0개여도 저장한다(D235).** payload `{ app: {app_id, name: null}, playtime_synced_at: null, entries: [] }`를 다른 결과와 같은 `computeAndStore`로 `ranking_caches`에 쓴다(`build`가 null을 돌려 저장을 건너뛰는 경로는 없앤다). 응답은 `items []`, `total 0`, `me null`, `app {app_id, name: null}`, `synced_at` = computed_at(non-null), `stale` = `isRankingStale`, `playtime_synced_at null`. 이로써 보유자 없는 app_id도 5분 안에서는 캐시를 읽는다(D217과 일치). 대상 밖 키는 다음 주기 `deleteExcept`가 지운다(임의 app_id로 늘어나는 행은 한 주기 안에서만 남는다).
- `app.name` = 행들의 `app_name` 중 null 아닌 첫 값(최신 synced_at 순). `playtime_synced_at` = 행 `synced_at` 최댓값.
- entries = core `buildPlaytimeRanking`. `rank_change` = 티어와 같은 주간 기준(D153).
- 비공개로 바뀐 프로필도 마지막 성공값이 남아 순위에 있다(S1 6-2, Q10).

### 7-3. 응답 조립

S4 4-1과 같다: `items` = entries 앞 200, `next_cursor` null, `total`, `me` = 요청자 entry, `synced_at` = computed_at(활동·플레이타임 모두 항상 값, D235), `stale` = `isRankingStale`. 활동은 payload의 `period`·`period_start`·`period_end`·`period_days`·`bot_connected`를 그대로 내린다.

### 7-4. `GET /steam-apps` 집계(S2 D98 변경, D234)

모양(`SearchSteamAppsResponse`)은 그대로, 집계만 바꾼다.

| 항목 | 규칙 |
| --- | --- |
| q 없음 items | 보유자가 있는 app, 보유자 수 DESC → app_id ASC, 최대 `STEAM_APP_SEARCH_LIMIT`(20). 이름이 없는 app(보유자 행 `app_name`이 모두 null)은 뺀다. 모든 항목 `owner_count ≥ 1` |
| q 있음 보유 게임 | 같은 보유자 조건 + 이름(아래 name)이 q를 포함(대소문자 무시), 같은 순서, 최대 10(기존 `OWNED_WITH_QUERY_MAX`) |
| 상점 결과 `owner_count` | 같은 보유자 조건의 수(없으면 0) |
| name | 보유자 행 `app_name` 중 null·빈 문자열이 아닌 값, `synced_at` 최신 우선(7-2 `app.name`과 같은 규칙) |
| 캐시 | 없음(요청마다 1–2쿼리, 기존과 같음) |

결과: 화면이 q 없음 첫 항목을 고르면 그 게임 플레이타임 순위는 1명 이상이다. 남는 차이는 캐시 주기뿐이다(그 사이 새로 동기화된 보유자는 최대 5분 뒤 순위에 보인다. 하루 1회 05:00 동기화라 거의 생기지 않는다).

---

## 8. 대시보드 `community` (D218, D219, D228, D240)

`DashboardService.summary`에 `community`를 추가한다. 요청마다 읽는다(캐시 없음, 쿼리 3개 이하). 시각은 요청의 `now` 1회.

| 필드 | 계산 |
| --- | --- |
| voice | `bot_presence` source 'default'. 없음 → `not_connected`. `core presenceState({capturedAt, now})`가 live → `{live, member_count, captured_at}`, stale → `{stale, null, captured_at}` |
| active_members | `botConnected` = EXISTS(activity_logs) OR presence 행 있음. false → `not_connected`. true → `{ready, count}`, count = `SELECT COUNT(DISTINCT al.user_id) FROM activity_logs al JOIN users u ON u.id = al.user_id AND <rankableUserSql> WHERE al.started_at >= kstWeekWindow(now).start AND al.started_at < end AND al.type IN (<ACTIVITY_COUNTED_TYPES>)`(voice·chat만, play만 한 회원은 세지 않는다, D240). `botConnected` 판정은 type과 무관(play만 와도 봇 연결됨) |
| now_playing | voice가 live이고 `playing`(parse 실패 → [])이 1행 이상이면 `{captured_at, items: core nowPlayingItems(playing)}`, 아니면 null |

- 이 블록의 조회가 실패하면 요약 전체 500이다(통계·모집과 같음). 부분 실패 규칙(S4 21절)은 `top_rankers`에만 있다.
- 응답 전체를 캐시하지 않는 규칙(D156) 그대로.

---

## 9. core 함수 (`packages/core`, domain-logic)

I/O 없음, 시각은 인자, 상수는 shared에서 import. `index.ts` export 추가. 전부 단위 테스트.

### 9-1. `src/time.ts` 추가

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| kstMonthWindow | `(now: Date) => { start: Date; end: Date }` | now의 KST 달 1일 00:00(+09:00) ~ 다음 달 1일 00:00 |
| activityPeriodWindow | `(period: ActivityPeriod, now: Date) => { start: Date; end: Date; days: number }` | week = `kstWeekWindow`, days 7. month = `kstMonthWindow`, days = 그 달 날짜 수 |
| kstDateKey | `(instant: Date) => string` | instant의 KST 날짜 `YYYY-MM-DD` |

### 9-2. `src/activity.ts` (새 파일)

| 함수 | 시그니처 | 규칙 |
| --- | --- | --- |
| checkActivityEventTime | `(input: { startedAt: Date; durationSec: number; now: Date }) => BotActivityRejectReason \| null` | 6-2 표. `startedAt < now − BOT_ACTIVITY_MAX_AGE_DAYS일` → TOO_OLD 먼저, `startedAt + durationSec초 > now + BOT_ACTIVITY_FUTURE_TOLERANCE_SEC` → ENDS_IN_FUTURE. 경계 같으면 허용 |
| planActivityBatch | `(input: { events: readonly { idempotencyKey: string; discordId: string; startedAt: Date; durationSec: number }[]; storedKeys: ReadonlySet<string>; userIdByDiscordId: ReadonlyMap<string, string>; now: Date }) => ActivityPlan[]` | `ActivityPlan = { status: 'insert'; userId: string } \| { status: 'duplicate' \| 'unlinked' } \| { status: 'rejected'; reason: BotActivityRejectReason }`. 입력 순서, 6-2 판정 순서. rejected·unlinked 키는 「이 요청 안 중복」 판정에 쓰지 않는다(뒤의 같은 키가 정상이면 insert) |
| buildActivityRanking | `<T extends { userId: string; voiceSec: number; activeDays: number }>(rows: readonly T[]) => (T & { rank: number; totalSec: number })[]` | **r1 변경(D232):** totalSec = voiceSec(play 입력 없음, `playSec` 파라미터 제거), 0 제외, totalSec DESC → activeDays DESC → userId ASC, rank 1.. 입력에 다른 필드가 있어도 합에 넣지 않는다 |
| pickMainGames | `<G extends { gameId: string; sortOrder: number; sec: number }>(rows: readonly G[], max?: number) => G[]` | sec > 0, sec DESC → sortOrder ASC → gameId ASC, 앞 `max`(기본 `ACTIVITY_MAIN_GAMES_MAX`) |
| buildPlaytimeRanking | `<T extends { userId: string; minutesTotal: number; minutesRecent: number }>(rows: readonly T[]) => (T & { rank: number })[]` | minutesTotal 0 제외, minutesTotal DESC → minutesRecent DESC → userId ASC |
| planMemberEvents | `(input: { events: readonly { discordId: string; type: BotMemberEventType; occurredAt: Date }[]; users: ReadonlyMap<string, { userId: string; guildMembershipAt: Date \| null }>; now: Date }) => { results: ('applied' \| 'stale' \| 'unlinked' \| 'rejected')[]; finals: { userId: string; leftAt: Date \| null; guildMembershipAt: Date; revokeTokens: boolean; eventIndexes: number[] }[] }` | 6-6. results는 입력 순서. finals는 applied가 있는 사용자만, userId ASC. revokeTokens = 최종 type이 leave. eventIndexes = 그 사용자의 applied 이벤트 위치(조건부 update가 0행이면 backend가 stale로 바꾼다) |
| presenceState | `(input: { capturedAt: Date \| null; now: Date }) => 'live' \| 'stale' \| 'not_connected'` | null → not_connected, `now − capturedAt ≤ BOT_PRESENCE_STALE_AFTER_SEC초` → live(미래 시각도 live), 아니면 stale |
| checkPresenceCapture | `(input: { capturedAt: Date; storedCapturedAt: Date \| null; now: Date }) => 'IN_FUTURE' \| 'TOO_OLD' \| 'OLDER_THAN_STORED' \| null` | 순서: `> now + 300초` IN_FUTURE, `< now − 300초` TOO_OLD, `≤ stored` OLDER_THAN_STORED |
| nowPlayingItems | `(playing: readonly BotPresencePlaying[], max?: number) => DashboardNowPlayingItem[]` | count DESC → name ASC(`localeCompare` 아닌 코드 단위 비교) → 앞 `max`(기본 `DASHBOARD_NOW_PLAYING_MAX`). 같은 name이 여럿이면 합치지 않는다(봇 책임) |

**core 신규 합계 12개**(9-1 3개 + 9-2 9개, r2에서 `discordLinkCodeState` 삭제 — shared `DiscordLinkCodeState`가 없어졌다). 9-2의 `ActivityPlan` 타입도 export.

테스트 필수: 월 경계(1월 31일 23:59 KST ↔ 2월 1일 00:00, UTC 1월 31일 15:00), 윤년 2월 29일 days, 주 경계(S4와 같은 일요일↔월요일), 시각 한도 경계 ±1ms(과거 7일, 미래 300초), 배치 안 같은 키 3번(첫째 insert·둘째·셋째 duplicate), rejected 뒤 같은 키 정상 → insert, stored 키 + 시각 초과 → duplicate(판정 순서), 동점 3단계, 입력 순서를 섞어도 결과 동일, 0초 제외(voiceSec 0이면 activeDays가 커도 제외 — play·chat만 있는 회원), 행에 `playSec` 같은 추가 필드가 있어도 totalSec = voiceSec(r1), 입퇴장 순서 뒤바뀜 3경우(6-6 표), 같은 사용자 leave→join 최종 join·revokeTokens false, 미래 이벤트 rejected, presence 경계(정확히 300초 live, 300초+1ms stale).

---

## 10. 화면 (frontend)

공통: 시각 KST, 숫자 없는 값에 가짜 숫자 금지, 색은 토큰(D53), env 값 직접 사용 금지(shared 상수는 사용 가능).

### `/rankings` 활동·플레이타임 탭 (목업 Rankings)

탭 4개 모두 활성. 쿼리: `tab=activity&period=week|month`, `tab=playtime&app_id=`. 잘못된 값은 없는 것으로 친다(S4 규칙).

| 영역 | 활동 | 플레이타임 |
| --- | --- | --- |
| 탭 설명 | 「디스코드 음성 채널 접속 시간 합계예요.」(D232, 목업 「디스코드 음성 채널 접속 시간 합계」) | 「스팀 게임별 누적 플레이타임이에요. 프로필이 공개된 멤버만 집계돼요.」 |
| 필터 | 기간 select: 「이번 주 (MM.DD – MM.DD)」/「이번 달 (M월)」. 날짜는 응답 `period_start`~`period_end − 1ms` | 게임 select: `GET /steam-apps`(q 없음) items 순서(보유자 수 순, 7-4). 기본 = shared `pickDefaultPlaytimeAppId(items)`(owner_count ≥ 1인 첫 항목, D234). 기본값이 null(목록 빔)이면 select 비활성 + 빈 상태. 주소 `app_id` 생략 판단(「기본값과 같으면 주소에 쓰지 않음」)도 이 함수 값과 비교한다 |
| 머리 | `synced_at`·`stale` S4 문구 그대로 | 같음 + 「스팀 동기화 MM.DD HH:mm」(`playtime_synced_at`) |
| 표 | RANK · PLAYER(보조 「{period_days}일 중 {active_days}일 활동」) · MAIN GAME(`main_games` 이름 「 · 」 연결, 없으면 「—」) · **SCRIMS**(r2 참고 열 `scrim_count`, 「3회」, 0이면 「0회」 — 실제 값이라 가짜 숫자가 아니다, 머리 툴팁 「결과가 승인된 내전 참가 수」) · **VOICE TIME**(`total_sec`, 「31h 20m」, 분 내림, 목업 문구, 정렬 기준) · +/− | RANK · PLAYER(보조 `account_name`) · LAST 2 WEEKS(「18시간」 = floor(minutes_recent/60)) · TOTAL(「2,140h」 = floor(minutes_total/60), 천 단위 쉼표) · +/− |
| 상위 3명 | S4와 같은 배치, 값은 시간 | 같음 |
| 규칙 문구 | 「한국 시간 기준 · 주는 월요일 시작 · 기간에 시작한 음성 접속만 집계」 | 「하루 1회 새벽 5시 동기화 · 프로필이 공개된 멤버만」 |
| 빈 상태 | `bot_connected` false: 「디스코드 봇이 아직 연결되지 않았어요」. true: 「이번 주(이번 달) 음성 접속 기록이 아직 없어요」 | 게임 목록 빔: 「스팀 계정을 연동한 멤버가 아직 없어요」. 선택한 게임 빔: 「이 게임 플레이 기록이 있는 멤버가 없어요」 |
| +/− 의미 | 「지난주 대비」(month면 「지난달 대비」)를 표 머리 툴팁/보조 문구로 | 티어와 같음 |

모바일: MAIN GAME·SCRIMS·LAST 2 WEEKS 열 숨김, 값을 PLAYER 보조 줄에 합친다(S4 방식). 활동 보조 줄 = 「{period_days}일 중 {active_days}일 활동 · 내전 {scrim_count}회」(0회면 생략) + 주 게임(있을 때만, 「—」 한 줄 금지 — QA s5_web #3). 상위 3명 카드에는 scrim_count를 넣지 않는다(정렬 값만).

### `/settings` 디스코드 영역 (목업 Settings DISCORD)

`discord-section.tsx`를 바꾼다. 「봇 연동 후」 칩은 지운다. **r2: 연동 코드 발급 UI는 없다(D237).** 데이터는 기존 `useMe()`(`GET /me`)뿐이다(D238). 별도 조회·폴링 없음.

| 상태(`isLinkedDiscordId(me.discord_id)`) | 표시 |
| --- | --- |
| 연동됨 | 기존 계정 표시 그대로(아바타·`discord_username`) + 칩 「연동됨」. 설명 「음성 접속 시간이 활동 랭킹에 쌓이고, 내전 시작 알림을 디스코드로 받아요.」 |
| 미연동(`discord_id` null·`dev-…`) | 칩 「미연동」 + 설명 「디스코드로 로그인하면 자동으로 연동돼요.」 버튼 없음(개발 전용 로그인에서만 보이는 상태) |

목업의 코드 칸(`RS-4F7K-92`)·「/연동」 안내·만료 타이머는 쓰지 않는다.

### `/` 홈 (목업 Main·MobileHome)

| 영역 | 데이터 | 동작 |
| --- | --- | --- |
| 「음성 채널 접속」 카드 | `community.voice` | live: 「{member_count}명」 + `LIVE` 칩. stale: 「—」 + 「마지막 HH:mm」. not_connected: 카드 숨김 |
| 「이번 주 활동 멤버」 카드 | `community.active_members` | ready: 「{count}명」(증감 칩 없음, 자료 없음). not_connected: 숨김 |
| 「지금 플레이 중」 | `community.now_playing` | null이면 영역 없음. 있으면 이름 · 「{count}명」 목록(최대 5) |
| 통계 줄 | - | 카드 수가 2–4개로 바뀌어도 격자가 깨지지 않게. 순서는 목업(음성 · 모집 중 · 이번 주 내전 · 활동 멤버) |
| 모바일 2칸 | - | voice live/stale이면 「음성 접속」 + 「모집 중 내전」, not_connected면 지금처럼 「모집 중 내전」 + 「이번 주 내전」 |

스파크라인·증감 칩은 여전히 없다(자료 없음).

### 훅·목

- 훅: `useActivityRanking(period)`, `usePlaytimeRanking(appId | null)`(`refetchInterval` 5분, S4와 같음). 경로는 `ApiPath`만. (r2: `useMyDiscordLink`·`useIssueDiscordLinkCode` 삭제, 설정은 `useMe`)
- 목 r2(D239): 활동 목 행에 `scrim_count`(목 내전 자료에서 7-1 규칙대로 계산 — 승인 결과·joined·기간). 음성 0 회원은 내전이 있어도 순위에 없다.
- 목 r1(D232–D235): 활동 목은 voice만 합산하고 `play_sec`을 내리지 않는다(play 이벤트 생성은 남겨 「play는 랭킹에 없음」을 보인다), 주 게임도 voice 기준. 스팀 게임 목(`/steam-apps`)의 `owner_count`와 플레이타임 목의 순위 인원이 같은 조건이어야 한다(q 없음 목록의 모든 항목이 순위 1명 이상). 보유자 없는 app 응답은 `synced_at`에 값. `SEED_VERSION` 다시 올림.
- 목(`NEXT_PUBLIC_API_MOCK`): 2개 웹 엔드포인트(활동·플레이타임) + 요약 `community`(architect가 넣은 임시 not_connected를 목 상태로 교체). 활동·플레이타임 계산은 `@gcd/core` import. 목 시나리오 localStorage `gcd-mock-bot` = `none`(not_connected) | `live` | `stale` | `no_playing` | `empty_period`, 기본 `live`. (r2: 디스코드 연동 목·`gcd-mock-discord`·연동 코드 목 삭제. 연동 상태는 목 `GET /me`의 `discord_id`로 본다.) `SEED_VERSION` 올림.

---

## 11. 구현 경계 (backend 모듈)

| 위치 | 내용 |
| --- | --- |
| `common/api-key.ts`(새) | `generateApiKey`, `hashApiKey`(6-1) |
| `common/guards/api-key.guard.ts`(새), `common/decorators/bot-scope.decorator.ts`(새) | 6-1. `request.apiKey` 타입 선언 |
| `common/advisory-lock.ts` | `membershipLockKey(userId)` = `membership:{userId}`(r2: `discordLinkLockKey` 삭제) |
| `modules/bot/`(새) | `BotController`(6개, 가드 + scope), `BotActivityService`, `BotMembersService`, `BotPresenceService`, `BotQueryService`(lookup·upcoming·rankings 조립). RankingsModule·티어 조회 모듈 import(r2: DiscordLinkModule 없음) |
| `modules/rankings/rankable-users.ts` | `rankableUserWhere = { leftAt: null }`, `rankableUserSql = Prisma.sql\`u.left_at IS NULL\``(별칭 `u` 고정, 주석으로 명시) |
| `modules/rankings/ranking-calculator.service.ts` | 티어는 변경 불필요(계정 조회가 Prisma `user: rankableUserWhere`라 left_at이 자동 적용, 스냅샷 SQL은 그 계정과 합칠 때 걸러진다). `activityTarget(period)`, `playtimeTarget(appId)` 계산(7-1, 7-2, 원시 SQL은 `rankableUserSql`). r1: 활동 voice만·`play_sec` 제거, 플레이타임 0행도 저장, 보유자 조각 사용 |
| `modules/rankings/playtime-holders.ts`(새, r1) | 7절 「보유자」 SQL 조각. calculator(랭킹 행·상위 50)와 `games/steam-apps.service.ts`가 import |
| `modules/games/steam-apps.service.ts`(r1) | 7-4. `owned`·`ownerCounts`를 보유자 조각 원시 SQL로(Prisma groupBy로는 join 조건을 걸 수 없다). GamesModule이 RankingsModule을 import하지 않도록 조각은 의존성 없는 순수 파일로 둔다 |
| `modules/rankings/ranking-keys.ts` | `activityRankingKey(period)`, `playtimeRankingKey(appId)` |
| `modules/rankings/ranking-refresher.ts` | targets에 활동 2개 + playtime 상위 50 |
| `modules/rankings/rankings-reader.service.ts` | `activity(period, viewerId \| null)`, `playtime(appId, viewerId \| null)`, 기간 불일치 = 캐시 없음(7-1). 봇은 viewer null |
| `modules/rankings/rankings.controller.ts` | 웹 2개 |
| `modules/dashboard/dashboard.service.ts` | `community`(8절). architect 임시값 교체 |
| `modules/auth/auth.service.ts` | 6-6 마지막 문단(로그인 left_at 복구) |
| `modules/profile/profile.service.ts` | `discord_linked` = `isLinkedDiscordId`(값 변화 없음) |
| `app.module.ts` | BotModule(r2: DiscordLinkModule 없음) |
| `scripts/api-key.ts`(새, integration) | 6-1 CLI. `package.json` `"api-key": "tsx scripts/api-key.ts"`(tsx가 없으면 devDependency 고정 버전 추가) |
| `test/support/fake-prisma.ts` | `botPresence`, `apiKey`, `activityLog` 표와 쓰는 원시 SQL(ON CONFLICT RETURNING 2종, 집계 3종 — r2 내전 수 추가, r2: `discordLinkCode` 표·FOR UPDATE 삭제). architect가 user 행에 `leftAt`·`guildMembershipAt`만 넣었다 |

---

## 12. 상태 전이

`scrims`·`scrim_players`·`scrim_results` 변경 없음(r2 `scrim_count`는 읽기만). `discord_link_codes`는 없다(r2, D237).

```
users 서버 멤버십(값 = left_at, 판단 시각 = guild_membership_at)
  member(left_at null) ──leave(occurred_at > guild_membership_at)──> left(left_at = occurred_at, 리프레시 토큰 폐기)
  left ──join(occurred_at > guild_membership_at) 또는 길드 검사 통과 로그인──> member
  left ──leave(더 늦은 시각)──> left(left_at 갱신)
  같거나 이른 시각의 이벤트: 상태 그대로(stale)

bot_presence(판정): 행 없음 → not_connected
  captured_at ≥ now − 300초 → live ; 그보다 오래됨 → stale ; 새 스냅샷 → live
  (한 번 생긴 행은 지우지 않으므로 not_connected로 돌아가지 않는다)
```

---

## 13. 환경 변수

**신규 없음(D226).** `.env.example`에 「디스코드 봇 API (S5)」 주석 절만 추가했다(키 발급 CLI 안내).

S5가 쓰는 기존 변수:

| 변수 | 사용처 | 비고 |
| --- | --- | --- |
| WEB_ORIGIN | api | 봇 응답 `profile_url`·`url`·`web_url` |
| DISCORD_GUILD_ID | api | 비어 있으면 로그인이 `left_at`을 건드리지 않는다(6-6) |
| STEAM_API_KEY, SYNC_JOBS_ENABLED, SYNC_DAILY_LIMIT | api | S1 스팀 배치·수동 새로고침 그대로(D225) |
| RANKING_JOBS_ENABLED | api | 활동·플레이타임 키도 같은 5분 작업 |
| DATABASE_URL | api, CLI | `api-key` 스크립트 |

설정값이 아닌 상수(shared): `BOT_ACTIVITY_BATCH_MAX`(100), `BOT_ACTIVITY_MAX_DURATION_SEC`(86400), `BOT_ACTIVITY_MAX_AGE_DAYS`(7), `BOT_ACTIVITY_FUTURE_TOLERANCE_SEC`(300), `BOT_MEMBER_EVENTS_BATCH_MAX`(100), `BOT_PRESENCE_STALE_AFTER_SEC`(300), `BOT_PRESENCE_PLAYING_MAX`(20), `BOT_UPCOMING_*`, `BOT_RANKING_LIMIT_*`, `RANKING_PLAYTIME_APPS_MAX`(50), `DASHBOARD_NOW_PLAYING_MAX`(5), `API_KEY_LAST_USED_WRITE_INTERVAL_SEC`(60). 바꿀 일이 생기면 env로 올린다(Q5 답에 따라). r2: `DISCORD_LINK_CODE_*` 상수 삭제.

---

## 14. 담당 배정과 실행 순서

S5 실행 구현자: **logic**, **integration**, **backend**, **frontend** (+ qa).

```
architect(완료)
  ├─ logic(9절) ─────────────────────────┐
  ├─ integration(CLI·스팀 확인) ─────────┤
  ├─ backend(9절 시그니처로 시작) ───────┼─ 전체 테스트 → qa
  └─ frontend(목 백엔드로 시작) ─────────┘
```

넷 다 바로 시작한다. backend는 core 함수가 나오기 전까지 9절 시그니처로 import하고 테스트는 core 완료 뒤 돌린다.

### logic (domain-logic-dev) — `packages/core/src/**`

1. 9-1 `time.ts` 3개, 9-2 `activity.ts` 10개 + `ActivityPlan` 타입, `index.ts` export.
2. 9절 「테스트 필수」 전부.
3. dist 재빌드. 보고서 `_workspace/02_domain-logic-dev_report.md`.

### integration (integration-dev) — `apps/api/scripts/**`, `apps/api/src/jobs/**`, `apps/api/test/integrations/**`

1. `scripts/api-key.ts` CLI(6-1): create·list·revoke, scope parse, 원문 1회 출력, 종료 코드. `common/api-key.ts`는 backend가 만든다(시그니처 6-1) — 먼저 필요하면 integration이 만들고 보고서에 적는다(파일 하나, 충돌 시 backend 쪽을 남긴다).
2. CLI 인자 파싱·출력 형식은 순수 함수로 분리해 단위 테스트(DB 없이). DB 쓰기는 작성만.
3. 스팀 하루 1회 배치 확인(D225): `sync-scheduler.ts`의 `0 5 * * *` KST → 모든 스팀 행 → `steam_playtime` upsert, 비공개 = `STEAM_PROFILE_PRIVATE` + 값 유지. 코드 변경 없음이 기대값. 플레이타임 랭킹이 쓰는 컬럼(`minutes_total`, `minutes_recent`, `app_name`, `synced_at`)이 작업자에서 채워지는지 fixture 테스트 한 건(이미 있으면 그 테스트 이름을 보고서에 적는다). 실제 키 연동은 「키 필요」.
4. 보고서 `_workspace/02_integration-dev_report.md`.

### backend (backend-dev) — `apps/api/src/**`, `apps/api/test/**`

1. 11절 모듈·파일, 4절 엔드포인트 8개(r2), 5–8절 흐름.
2. `rankableUserWhere` 변경과 `rankableUserSql`, 티어·ELO·시즌 종료·활동·플레이타임·요약 활동 멤버에 적용. 프로필 `discord_linked`.
3. 로그인 `left_at` 복구(6-6), 퇴장 시 리프레시 토큰 폐기.
4. `fake-prisma` 확장, `test/support/memory-*` 필요한 것.
5. 테스트(DB 없이):
   - 가드: 헤더 없음·형식 틀림·모르는 키·폐기 키 401, scope 없음 403, `last_used_at` 60초 안 재요청은 쓰지 않음, JWT 쿠키만 있는 요청 401, 봇 엔드포인트가 OriginGuard 없이 동작.
   - (r2) 연동 코드 테스트 없음. `/bot/link`·`/me/discord-link*`가 404(라우트 없음)인지 한 건.
   - 활동: 문서 예시 그대로 created, 재전송 duplicate, 배치 안 중복, 미연동 unlinked(행 없음), 7일 경계·미래 경계, chat 0초, 101건 400, 모르는 필드 400, 탈퇴 회원 저장, 경합 duplicate(ON CONFLICT 경로), api_key_id 기록.
   - 입퇴장: 6-6 표 5줄, leave 후 리프레시 토큰 전부 revoked, 로그인 복구, 탈퇴 회원 티어·ELO·활동·플레이타임 랭킹 제외, 시즌 종료 standings 제외.
   - 접속 현황: 3 reason, 조건부 덮어쓰기, 요약 live/stale/not_connected 경계, now_playing null 조건.
   - 랭킹: 활동 주·월 경계, 기간 바뀐 읽기 = 재계산(지난주 payload 미노출), 지난주 대비 rank_change, bot_connected false/true 빈 목록, main_games 2개·동점 sort_order, 플레이타임 대표 계정만·부계정 없음(스팀 1개)·minutes 0 제외·비공개 후 값 유지·보유자 없음 응답, 대상 밖 app 캐시 삭제 후 재계산, 봇 랭킹 4종이 웹과 같은 캐시 값·limit·discord_id 포함, 웹 랭킹 응답에 discord_id 없음.
   - lookup 404·탈퇴 회원 left_at, upcoming 범위 경계·notify_discord_ids 필터(미연동·알림 끔·탈퇴·waitlist 제외).
   - 요약: `community` 3칸, 활동 멤버 수 chat 포함·탈퇴 제외·주 경계.
6. **DB 필요(작성만)** `test/db/bot.db.e2e.spec.ts`: 같은 키 동시 2요청 → 1행, presence 조건부 upsert 순서 역전, 집계 SQL bigint 변환, `AT TIME ZONE` 날짜 수.
7. 보고서 `_workspace/02_backend-dev_s5.md`.

### frontend (frontend-dev) — `apps/web/**`

1. 10절 화면 3곳, 훅 2개(r2), `lib/api/*`.
2. 목 백엔드(10절 훅·목), architect 임시 `community` 교체.
3. 검증: `corepack pnpm --filter web typecheck && test && build`, 목 모드 데스크톱·모바일 × 라이트·다크(활동 빈 상태 2종, 플레이타임 빈 상태 2종, stale, 연동 2상태(r2), 홈 not_connected·stale·live).
4. 보고서 `_workspace/02_frontend-dev_s5.md`.

### 14-1. S5 수정 r1 작업 목록 (D232–D236)

architect가 shared를 고쳤다(15절 r1 표). **아래 사용처는 아직 고치지 않았다** — 담당자가 고친다. 기준선: `corepack pnpm --filter @gcd/shared typecheck` 통과·shared 테스트 140개 통과, shared `dist` 재빌드 완료. `corepack pnpm -r typecheck`는 api·web에서 실패한다(아래 「typecheck 오류」). 타입 오류가 없는 곳도 런타임 parse가 실패하는 곳이 있다(`*.parse(unknown)`라 tsc가 못 잡는다) — 목록 전부가 대상이다.

실행 순서: logic(core) → backend 테스트 실행, frontend는 바로 시작(core는 목에서만 쓴다, core 완료 뒤 목 테스트 재실행). qa는 넷 다 끝난 뒤.

#### logic (domain-logic-dev)

| 파일 | 작업 |
| --- | --- |
| `packages/core/src/activity.ts` | `buildActivityRanking` 시그니처에서 `playSec` 제거, `totalSec = voiceSec`(9-2 r1). 머리 주석(「totalSec = voiceSec + playSec」) 수정. `assertNonNegativeInt(row.playSec)` 제거 |
| `packages/core/src/activity.test.ts` | 173–214줄 픽스처의 `playSec` 제거·기대값 재계산. 추가: play·chat만 있는 회원(voiceSec 0) 제외, 추가 필드 `playSec`가 있어도 합에 안 들어감 |
| `packages/core/dist` | 재빌드 |
| 보고서 | `_workspace/02_domain-logic-dev_report.md`에 r1 절 |

`pickMainGames`·`activityPeriodWindow`·`nowPlayingItems` 등 나머지는 변경 없음.

#### backend (backend-dev)

| 파일 | 작업 | 근거 |
| --- | --- | --- |
| `apps/api/src/modules/rankings/ranking-calculator.service.ts` | `activityEntries`: totals SQL에서 `play_sec` 열 제거, voice 합은 `ACTIVITY_RANKED_TYPES`로(7-1), map·entry에서 `playSec`/`play_sec` 제거. 주 게임 SQL은 이미 `ACTIVITY_RANKED_TYPES`라 자동으로 voice만(확인만). 머리 주석 「voice + play」 수정. **지금 그대로면** core가 voice+play를 total로 줘 shared refine이 실패해 활동 계산이 500이 된다 | D232 |
| 같은 파일 | `playtimeEntries`: 0행이면 `null` 대신 `{ entries: [], meta: { app: {app_id, name: null}, playtime_synced_at: null } }`. `build`의 `if (built === null) return null` 경로와 `computeAndStore`의 「저장 안 함」 분기 제거(다른 kind가 null을 쓰지 않으면 반환 타입에서 null 제거). 주석 「보유자가 없으면 null(저장하지 않는다)」 수정. `playtimeEntries`·`topPlaytimeApps`의 보유자 조건을 새 조각으로 | D235, D234 |
| `apps/api/src/modules/rankings/playtime-holders.ts`(새) | 7절 「보유자」 조각(`Prisma.sql`, 별칭 `sp`·`ga`·`g`·`u` 고정, 주석 명시). `rankableUserSql`·steam 제공자 코드 사용 | D234 |
| `apps/api/src/modules/rankings/rankings-reader.service.ts` | `playtimeView`: `cached: null` 반환 제거(캐시 없음 = 첫 계산 실패 → `readOrComputeRow`처럼 INTERNAL_ERROR). `PlaytimeRankingView.cached` non-null로. `playtime()`의 보유자 없음 분기(`synced_at: null`) 제거 — 지금 그대로면 shared parse 실패. `readOrCompute`의 「플레이타임 보유자 없음이면 null」 주석·반환 타입 정리 | D235 |
| `apps/api/src/modules/bot/bot-query.service.ts` | 253–269줄 playtime: `cached` null 분기 제거, `synced_at`은 항상 값, `context.app` = payload.app | D235 |
| `apps/api/src/modules/games/steam-apps.service.ts` | 7-4: `owned()`·`ownerCounts()`를 보유자 조각 원시 SQL로. name 규칙(최신 synced_at의 null 아닌 app_name). q 있음은 name ILIKE(`%`·`_` 이스케이프) | D234 |
| `apps/api/src/modules/games/games.module.ts` | 필요하면 import 정리(조각은 순수 파일이라 모듈 import 불필요) | D234 |
| `apps/api/test/activity-rankings.e2e.spec.ts` | 106줄 `i.play_sec` 제거(**typecheck 오류**), 95·143줄 play 시드 기대값: play는 total에 안 들어가고 active_days에는 들어간다, play만 있는 회원 순위 없음, play의 game이 main_games에 안 들어감. 229–240줄 「보유자 없음 → synced_at null, 캐시 만들지 않음」을 「빈 결과 캐시 저장, synced_at = NOW, 5분 안 두 번째 요청은 SQL 실행 없음」으로. 286줄 근처 대상 밖 app 삭제 → 재계산 시나리오에 보유자 0 app 포함 | D232, D233, D235 |
| `apps/api/test/support/fake-prisma.ts` | 501–505줄 `gcd:activity-totals`의 play 합산·`play_sec` 반환 제거(voice만). 새 `/steam-apps` 원시 SQL 태그(보유자 집계·이름) 지원. 플레이타임 0행 저장 경로 | D232, D234 |
| `apps/api/test/support/fake-table.ts` | `steamPlaytime.groupBy`를 더 쓰지 않으면 남겨도 됨(다른 사용처 확인) | D234 |
| `apps/api/test/steam-apps.e2e.spec.ts` | 보유자 조건 테스트: 부계정(is_primary false)·미확인·minutes_total 0·탈퇴 회원 행은 세지 않음, q 없음 모든 항목 owner_count ≥ 1, q 있음 상점 결과 owner_count 같은 조건, 이름 규칙. 기존 기대값 중 위 조건에 걸리는 픽스처 갱신 | D234 |
| `apps/api/test/scrims*.e2e.spec.ts`, `test/db/scrims.db.e2e.spec.ts` | 내전 작성 스팀 게임 선택이 `/steam-apps`·`resolve`를 쓰는 테스트 중 보유자 조건에 걸리는 픽스처가 있으면 갱신(`resolve`는 이름 결정이라 조건 변경 없음 — 바꾸지 않는다) | D234 |
| `apps/api/test/bot-*.e2e.spec.ts`(봇 랭킹) | activity value = voice 초, playtime 보유자 없음 `synced_at` 값 | D232, D235 |
| `apps/api/test/db/bot.db.e2e.spec.ts` | 127–132줄 bigint 검사: `'play'` 대량 행 → `'voice'`로 바꾸고 기대값 `{ voice_sec: …, total_sec: … }`에서 `play_sec` 제거(작성만, DB 미실행) | D232 |
| `apps/api/test/db/ranking-cache.db.e2e.spec.ts` | 플레이타임 0행 저장이 다루는 곳 있으면 갱신 | D235 |
| 보고서 | `_workspace/02_backend-dev_s5.md`에 r1 절 | |

바꾸지 않는 것: `bot-activity.service.ts`·`/bot/activity` 검증(play 계속 저장), `dashboard.service.ts` `active_members`(r1 당시 voice·chat·play — D240에서 voice·chat으로 바뀜)와 `now_playing`(Q14). (r1 당시 「Prisma 스키마·마이그레이션 변경 없음」은 r2 D237로 바뀌었다 — 14-2)

#### frontend (frontend-dev)

| 파일 | 작업 | 근거 |
| --- | --- | --- |
| `apps/web/src/lib/rankings.ts` | 44줄 탭 설명 「디스코드 음성 채널 접속 시간 합계예요.」, 190줄 규칙 문구 「… 기간에 시작한 음성 접속만 집계」, 216줄 빈 상태 「{기간} 음성 접속 기록이 아직 없어요」. `resolvePlaytimeApp`: 기본값을 `pickDefaultPlaytimeAppId(apps)`로, 목록 빔 판단도 그 값이 null인지로 | D232, D234 |
| `apps/web/src/components/rankings/rankings-view.tsx` | 473줄 `mainHead="ACTIVITY TIME"` → `"VOICE TIME"`. 280줄 onChange의 「첫 항목과 같으면 주소에서 생략」 비교를 `pickDefaultPlaytimeAppId(appItems)`로. 기본값 null이면 select 비활성·빈 상태(279·300줄). 활동 행(122줄)이 `play_sec`를 쓰면 제거 | D232, D234 |
| `apps/web/src/lib/rankings.s5.test.ts` | 56–57줄 빈 상태 문구, resolvePlaytimeApp 기본값(owner_count 0 항목을 건너뜀) 테스트 | D232, D234 |
| `apps/web/src/lib/api/mock/community.ts` | 148–185줄: 순위 시간은 voice만, `playSec`·`play_sec` 제거(**지금 그대로면 shared parse 실패**), 주 게임 voice 기준, active_days는 모든 type. 127줄 play 이벤트 생성은 남김. 258–268줄 보유자 없음 응답 `synced_at`에 값(`input.cache`). 48줄 주석 문구 | D232, D233, D235 |
| `apps/web/src/lib/api/mock/community.test.ts` | 67줄 `e.total_sec === e.voice_sec + e.play_sec` → `e.total_sec === e.voice_sec`(**typecheck 오류**). 122줄 보유자 없음 `synced_at: null` 기대값 변경 | D232, D235 |
| `apps/web/src/lib/api/mock/scrims.ts` | 124–136줄 스팀 게임 목: q 없음 목록의 모든 `owner_count ≥ 1` 항목이 플레이타임 목에서 같은 인원의 순위를 갖도록 두 목의 출처를 맞춘다(한쪽에서 계산해 다른 쪽이 읽기 권장). `SEED_VERSION` 올림 | D234 |
| `apps/web/src/lib/api/mock/scrims.test.ts`, `mock/rankings.ts` | 위 변경에 따른 기대값 | D234 |
| `apps/web/src/components/scrims/steam-app-picker.tsx` | 코드 변경 없음이 기대값(목록이 보유자 기준으로 좁아질 뿐). 확인만 | D234, Q16 |
| `apps/web/src/components/settings/discord-section.tsx` | 변경 없음(연동 설명이 이미 「음성 접속 시간이 활동 랭킹에 쌓이고」) | - |
| 보고서 | `_workspace/02_frontend-dev_s5.md`에 r1 절, 목 모드 활동·플레이타임 탭 스크린샷 재확인 | |

#### integration

작업 없음(스팀 배치·CLI 무관).

#### qa (r1 재검증)

- `ACTIVITY_RANKED_TYPES` 사용처가 SQL·목에서 문자열 `'play'`·`'voice'`를 따로 박지 않았는지. 활동 응답·봇 activity value에 play 시간이 섞이지 않는지(play 시드 → total 불변).
- `/steam-apps`(q 없음) 각 항목 app_id로 `/rankings/playtime`을 부르면 `total ≥ 1`(목·api 둘 다). 부계정·0분·탈퇴 행이 owner_count에 없는지.
- 보유자 없는 app_id 연속 2회 요청 → 두 번째는 SQL 없음(캐시), `synced_at` non-null.
- typecheck 오류 2건(아래)이 사라졌는지 + `corepack pnpm -r typecheck` 전체 통과.

#### typecheck 오류(architect 확인, 2026-10-31, r1 시점 — r2 이후 전체 목록은 14-2)

```
apps/api  test/activity-rankings.e2e.spec.ts(106,85): Property 'play_sec' does not exist …
apps/web  src/lib/api/mock/community.test.ts(67,48): Property 'play_sec' does not exist …
```

런타임만 깨지는 곳(tsc 통과): `ranking-calculator.service.ts`(활동 entry parse, refine 실패), `rankings-reader.service.ts`·`bot-query.service.ts`·`mock/community.ts`(플레이타임 `synced_at: null` parse 실패), `mock/community.ts`(활동 `play_sec`/total 불일치).

### 14-2. S5 수정 r2 작업 목록 (D237–D239)

architect가 shared·Prisma 스키마·마이그레이션·`.env.example`을 고쳤다(15절 r2 표). 기준선: shared typecheck 통과, shared 테스트 134개 통과, shared `dist` 재빌드, `prisma validate`·`generate` 통과, migrate diff 일치(stdout, 주석 줄 제외 비교 동일). **사용처는 고치지 않았다.** 14-1(r1)과 14-2(r2)를 같은 차례에 함께 처리한다.

실행 순서: logic → backend 테스트 실행. frontend·integration은 바로 시작. qa는 넷 다 끝난 뒤(r1+r2 한 번에).

#### logic (domain-logic-dev) — core

| 파일 | 작업 | 근거 |
| --- | --- | --- |
| `packages/core/src/activity.ts` | `discordLinkCodeState` 삭제, 11줄 `DiscordLinkCodeState` import 삭제(**typecheck 오류**). r1 `buildActivityRanking` 변경과 함께 | D237 |
| `packages/core/src/activity.test.ts` | `discordLinkCodeState` 테스트 삭제. `buildActivityRanking` 입력에 `scrimCount` 같은 추가 필드가 있어도 순위·totalSec에 영향 없음(제네릭 통과) 1건 | D237, D239 |
| `packages/core/src/index.ts` | export `discordLinkCodeState` 삭제(121줄), 11줄 머리 주석 「연동 코드」 삭제. 신규 합계 12개 | D237 |
| `packages/core/dist` | 재빌드 | |

`scrim_count`는 core 함수가 필요 없다(SQL 집계 + 순위 뒤에 붙임). 새 core 함수를 만들지 않는다.

#### backend (backend-dev) — api

| 파일 | 작업 | 근거 |
| --- | --- | --- |
| `apps/api/src/modules/discord-link/`(`discord-link.module.ts`, `discord-link.controller.ts`, `discord-link.service.ts`) | **디렉터리 삭제**(**typecheck 오류 다수**) | D237, D238 |
| `apps/api/src/app.module.ts` | `DiscordLinkModule` import 삭제 | D237 |
| `apps/api/src/modules/bot/bot.controller.ts` | `POST /bot/link` 핸들러, `DiscordLinkService` 주입, `PostBotLink*`·`ApiPath.botLink`·`BOT_ENDPOINT_SCOPE.link` 사용 삭제(**typecheck 오류**). 엔드포인트 6개 | D237 |
| `apps/api/src/modules/bot/bot.module.ts` | `DiscordLinkModule` import·주석 삭제 | D237 |
| `apps/api/src/common/advisory-lock.ts` | `discordLinkLockKey` 삭제 | D237 |
| `apps/api/src/common/app-error.ts` | 52줄 근처 오류 문구 4개 삭제(**typecheck 오류**) | D237 |
| `apps/api/src/modules/rankings/ranking-calculator.service.ts` | `activityEntries`에 7-1 「내전」 쿼리(태그 예 `/* gcd:activity-scrims */`, `rankableUserSql`, 순위에 든 user id만) → entry `scrim_count`(없으면 0). **지금 그대로면 shared 필수 필드라 활동 계산 parse 실패 → 500** | D239 |
| `apps/api/src/modules/bot/bot-query.service.ts` | activity `detail` = `{period_days}일 중 {active_days}일 활동 · 내전 {scrim_count}회`(0회면 뒷부분 생략) | D239 |
| `apps/api/test/discord-link.e2e.spec.ts` | **삭제**. 대신 `/bot/link`·`/me/discord-link`·`/me/discord-link/code` 404 한 건(아무 봇·웹 테스트 파일에) | D237 |
| `apps/api/test/support/fake-prisma.ts` | `DiscordLinkCode` import·`discordLinkCode` 표·`$transaction` 목록(359줄)·`FOR UPDATE` 원시 SQL 분기(468줄) 삭제(**typecheck 오류**), 머리 주석. `gcd:activity-scrims` 태그 지원(scrims·scrim_players·scrim_results 표 읽기) | D237, D239 |
| `apps/api/test/activity-rankings.e2e.spec.ts` | 337줄 scope `'bot:link'` 교체(**typecheck 오류**). `scrim_count` 테스트: joined+approved만, waitlist·cancelled·no_show 참가 제외, 결과 pending·rejected 제외, 취소 내전 제외, 기간 경계(started_at 기준 일요일 23:59 ↔ 월요일 00:00 KST, started_at null이면 scheduled_at), 내전만 있고 음성 0인 회원은 순위 없음, scrim_count가 정렬에 영향 없음(내전 많은 회원이 음성 적으면 아래) | D237, D239 |
| `apps/api/test/bot-query.e2e.spec.ts` | 43줄 `'bot:link'` 교체(**typecheck 오류**, scope 없는 키 테스트면 다른 scope로). activity detail 문구 | D237, D239 |
| `apps/api/test/db/bot.db.e2e.spec.ts` | 87–94줄 연동 코드 동시성 테스트(같은 코드 동시 연결, 발급 동시, 발급·연결 교착) 삭제(**typecheck 오류**). 내전 수 SQL 한 건 추가(작성만) | D237, D239 |
| `apps/api/test/profile.e2e.spec.ts` | 변경 없음 기대(`discord_linked`는 그대로) — 확인만 | - |
| 보고서 | `_workspace/02_backend-dev_s5.md`에 r2 절 | |

남는 것: `profile.service.ts`(`isLinkedDiscordId` 사용, 그대로), 활동·입퇴장 `unlinked` 판정(그대로).

#### frontend (frontend-dev) — web

| 파일 | 작업 | 근거 |
| --- | --- | --- |
| `apps/web/src/lib/api/discord-link.ts`, `apps/web/src/lib/hooks/discord-link.ts` | **삭제**(**typecheck 오류**) | D237, D238 |
| `apps/web/src/lib/discord-link.ts`, `apps/web/src/lib/discord-link.test.ts` | 코드 타이머·발급 상태 함수 삭제. 남길 순수 함수가 있으면(예: 설정 2상태 판정) `isLinkedDiscordId(me.discord_id)`만 쓰게 | D237, D238 |
| `apps/web/src/components/settings/discord-section.tsx` | 10절 2상태(연동됨 / 미연동 「디스코드로 로그인하면 자동으로 연동돼요.」), 데이터는 `useMe()`만. 발급 버튼·코드 칸·폴링·토스트 삭제(**typecheck 오류**) | D237, D238 |
| `apps/web/src/lib/api/mock/backend.ts` | 193–198줄 `myDiscordLink`·`myDiscordLinkCode` 목 라우트 삭제(**typecheck 오류**) | D237 |
| `apps/web/src/lib/api/mock/community.ts` | 14–24줄 연동 코드 import, 연동 목 상태(`gcd-mock-discord`, 20초 자동 linked), 399줄 `DISCORD_ACCOUNT_ALREADY_LINKED` 삭제(**typecheck 오류**). 활동 목 행에 `scrim_count`(목 내전 자료에서 7-1 규칙) | D237, D239 |
| `apps/web/src/lib/api/mock/community.test.ts` | 5–12·48–49·182–217줄 연동 코드 테스트 삭제(**typecheck 오류**), `scrim_count` 규칙 테스트(승인·joined만, 음성 0이면 순위 없음) | D237, D239 |
| `apps/web/src/lib/errors.ts` | 64줄 근처 연동 코드 오류 문구 4개 삭제(**typecheck 오류**) | D237 |
| `apps/web/src/lib/api/mock/game-accounts.ts` | 620줄 `discord_linked` 옛 판정식(`!startsWith('dev-')`) → `isLinkedDiscordId`(QA s5_backend 참고 메모) | D203 |
| `apps/web/src/components/rankings/rankings-view.tsx`, `apps/web/src/lib/rankings.ts` | 활동 표 SCRIMS 열(「{n}회」, 머리 툴팁), 모바일 보조 줄 「… · 내전 {n}회」(0회 생략), 주 게임 없으면 「—」 줄을 만들지 않음(QA s5_web #3). 행 모델(`RankRow`)에 열이 하나 더 필요하면 활동 전용 필드로 | D239 |
| `apps/web/src/lib/rankings.s5.test.ts` | SCRIMS 문구·모바일 보조 줄 테스트 | D239 |
| 보고서 | `_workspace/02_frontend-dev_s5.md`에 r2 절. 설정 2상태·활동 SCRIMS 열 스크린샷(데스크톱·모바일 × 라이트·다크) | |

#### integration (integration-dev)

CLI 코드(`apps/api/scripts/api-key.ts`)는 `ApiKeyScope`를 parse하므로 코드 변경은 없다. 단 **테스트 픽스처가 런타임에 깨진다**:

| 파일 | 작업 | 근거 |
| --- | --- | --- |
| `apps/api/test/integrations/api-key-cli.spec.ts` | 39–108줄 `'bot:link'` 픽스처를 `'bot:activity'`·`'bot:members'` 등으로 교체(`parseScopes('bot:link,…')`가 이제 「모르는 scope」). 「모르는 scope: bot:link」 거부 1건 추가 | D237 |
| `apps/api/scripts/api-key.ts` | 도움말·예시에 `bot:link`가 있으면 삭제(현재 grep 0건, 확인만) | D237 |
| 보고서 | `_workspace/02_integration-dev_report.md`에 r2 절 | |

#### qa (r2 재검증, r1과 함께)

- 저장소 전체 grep `bot:link|/bot/link|discord-link|discord_link|DISCORD_LINK|DiscordLink|DISCORD_ID_ALREADY_LINKED|DISCORD_ACCOUNT_ALREADY_LINKED` → 계약·결정 문서·이 마이그레이션 머리 주석 말고 0건.
- 마이그레이션 migrate diff 재확인(stdout, `discord_link_codes` 없음, DROP 없음).
- `scrim_count`: 7-1 셈 규칙 대조(SQL·목), 정렬 무관, 음성 0 회원 미포함, 봇 detail 문구.
- 설정 화면 2상태, 목 모드에서 연동 코드 UI 흔적 없음.
- `corepack pnpm -r typecheck` 전체 통과.

#### typecheck 오류 전체(architect 확인, r1+r2 반영 후, 2026-10-31)

```
packages/core  src/activity.ts(11)            DiscordLinkCodeState 없음
apps/api       src/common/app-error.ts(52)    DISCORD_LINK_CODE_INVALID 등 모르는 키
apps/api       src/modules/bot/bot.controller.ts(14,15,47,49)   PostBotLink*, ApiPath.botLink, BOT_ENDPOINT_SCOPE.link
apps/api       src/modules/discord-link/*.ts(다수)               연동 코드 export·prisma.discordLinkCode·오류 코드
apps/api       test/activity-rankings.e2e.spec.ts(106)  play_sec / (337) 'bot:link'
apps/api       test/bot-query.e2e.spec.ts(43)            'bot:link'
apps/api       test/db/bot.db.e2e.spec.ts(87,93,94)      prisma.discordLinkCode
apps/api       test/discord-link.e2e.spec.ts(다수)
apps/api       test/support/fake-prisma.ts(11)           DiscordLinkCode
apps/web       src/components/settings/discord-section.tsx, src/lib/api/discord-link.ts, src/lib/hooks/discord-link.ts,
               src/lib/discord-link.ts, src/lib/discord-link.test.ts, src/lib/api/mock/backend.ts(193,198),
               src/lib/api/mock/community.ts(14–24,399), src/lib/api/mock/community.test.ts(5–12,48,49,67,182–217),
               src/lib/errors.ts(64)
```

런타임만 깨지는 곳(tsc 통과): 14-1 목록 + `ranking-calculator.service.ts`·`mock/community.ts`(활동 entry에 `scrim_count` 없음 → parse 실패), `test/integrations/api-key-cli.spec.ts`(`bot:link` 픽스처).

### qa (qa-verifier)

- 교차 대조: 4절 표 8개(r2) ↔ 컨트롤러 데코레이터(경로·가드·scope) ↔ 웹 훅·봇 예시, 2절 오류 표 ↔ `ErrorCode` ↔ 두 문구 표, 9절 시그니처 ↔ core export ↔ backend 호출.
- 보안 경계: 봇 경로에 JWT·쿠키로 접근 불가, 웹 경로에 API 키로 접근 불가, 키 원문이 응답·로그에 없음, 웹 응답 스키마에 discord_id 없음, 퇴장 → 토큰 폐기.
- 멱등: 같은 요청을 두 번 보내 결과 행 수 불변(활동·입퇴장·접속 현황).
- `rankableUserWhere`·`rankableUserSql`을 우회하는 순위 쿼리가 없는지(grep `rank_snapshots`, `ratings`, `activity_logs`, `steam_playtime` 원시 SQL).
- 마이그레이션 `DROP` 문장 없음, migrate diff 일치 재확인(stdout만).
- 화면 코드에 300 같은 상수 리터럴 없음(shared 상수 또는 응답 값).

---

## 15. 영향받는 파일·배포

architect가 S5 최초 작성 때 바꾼 것(r1·r2로 일부 바뀌었다 — 아래 r2·r1 표가 우선):

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/bot.ts`(새) | 봇 API 스키마·상수 |
| `packages/shared/src/discord-link.ts`(새) | 연동 코드 상수·정규화·응답·상태 전이 |
| `packages/shared/src/rankings.ts` | 끝에 S5 절(활동·플레이타임), `SteamAppId` import |
| `packages/shared/src/dashboard.ts` | `community` 블록(필수), 머리 주석 |
| `packages/shared/src/common/errors.ts` | 오류 6개 + 상태 표 |
| `packages/shared/src/constants/enums.ts` | `ApiKeyScope` 2개 |
| `packages/shared/src/paths.ts`, `index.ts` | 경로 11개, export 2줄 |
| `packages/shared/src/contract.s5.test.ts`(새) | 계약 테스트 |
| `packages/shared/src/contract.s3.test.ts`, `contract.s4.test.ts` | 오류 개수 단언을 「43 이상」으로(S5 개수는 s5 테스트), S4 요약 픽스처에 `community` |
| `apps/api/prisma/schema.prisma` + `migrations/20261031120000_s5/` | 3절 |
| `apps/api/src/common/app-error.ts`, `apps/web/src/lib/errors.ts` | 새 오류 코드 문구(Record 타입이라 필수) |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | 임시 `community`(not_connected 고정, backend가 교체) |
| `apps/web/src/lib/api/mock/rankings.ts` | 임시 `community`(frontend가 교체) |
| `apps/api/test/dashboard.e2e.spec.ts` | 빈 DB 기대값에 `community`(구현 후에도 같은 값) |
| `apps/api/test/support/fake-prisma.ts` | user 행 `leftAt`·`guildMembershipAt` |
| `.env.example` | 13절 주석 |

**r2(D237–D239)에서 architect가 바꾼 것:**

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/discord-link.ts` | `isLinkedDiscordId`와 머리 주석만 남김. 연동 코드 상수 5개(`DISCORD_LINK_CODE_TTL_SEC`·`_DAILY_MAX`·`_PREFIX`·`_LENGTH`·`_ALPHABET`), `normalizeDiscordLinkCode`, `formatDiscordLinkCode`, `DiscordLinkCodeInput`, `GetMyDiscordLinkResponse`, `IssueDiscordLinkCodeResponse`, `DiscordLinkCodeState`, `DISCORD_LINK_CODE_TRANSITIONS` 삭제 |
| `packages/shared/src/bot.ts` | `POST /bot/link` 절(`PostBotLinkRequest`·`PostBotLinkResponse`), `BOT_ENDPOINT_SCOPE.link`, `DiscordLinkCodeInput` import 삭제. activity detail 주석(내전 수) |
| `packages/shared/src/constants/enums.ts` | `ApiKeyScope`에서 `bot:link` 삭제(6개) |
| `packages/shared/src/common/errors.ts` | 연동 코드 오류 4개와 상태 표 삭제(전체 45개) |
| `packages/shared/src/paths.ts` | `myDiscordLink`, `myDiscordLinkCode`, `botLink` 삭제 |
| `packages/shared/src/rankings.ts` | `ActivityRankingEntry.scrim_count`(필수, int ≥ 0)와 주석 |
| `packages/shared/src/contract.s5.test.ts` | 연동 코드 테스트를 「없음」 단언으로 교체, 오류 45·scope 6·scope = 엔드포인트 1:1, `scrim_count` 테스트 |
| `packages/shared/dist` | 재빌드 |
| `apps/api/prisma/schema.prisma` | `DiscordLinkCode` 모델과 `User.discordLinkCodes` 관계 삭제 |
| `apps/api/prisma/migrations/20261031120000_s5/migration.sql` | migrate diff로 다시 생성(`discord_link_codes` CREATE·인덱스·FK 없음). 머리 주석 갱신 |
| `.env.example` | 키 발급 예시 scope에서 `bot:link` 삭제 |
| 이 문서 | 변경 이력, 1-1·1-2·1-3, 2, 3, 4, 5(전면 축소), 6-1·6-5·6-8, 7-1, 9-2, 10, 11, 12, 13, 14·14-2, 15, 16(D237–D239, 철회 표시), 17(Q1·Q2·Q11·Q13 닫음, Q17) |

r2 영향: 웹 엔드포인트 2개·봇 엔드포인트 1개가 사라지고 활동 응답 행에 필드가 늘어난다. 배포 규칙은 r1과 같다(api·web 같은 커밋). 마이그레이션은 아직 어디에도 적용되지 않았으므로 같은 이름으로 고쳐 썼다 — **이미 로컬 DB에 옛 `20261031120000_s5`를 적용한 개발자는 `prisma migrate reset`(개발 DB) 또는 `DROP TABLE discord_link_codes` 후 `_prisma_migrations`의 해당 행 checksum 불일치를 정리해야 한다**(Docker 없는 이 PC에서는 적용 기록 없음).

**r1(D232–D236)에서 architect가 바꾼 것:**

| 파일 | 변경 |
| --- | --- |
| `packages/shared/src/rankings.ts` | `ACTIVITY_RANKED_TYPES = ['voice']`(`satisfies readonly ActivityType[]`), `ActivityRankingEntry`에서 `play_sec` 제거·`voice_sec` min 1·refine `total_sec === voice_sec`, `GetPlaytimeRankingResponse.synced_at` non-null, 주석(D232–D235), `ActivityType` type import |
| `packages/shared/src/steam-apps.ts` | 머리 주석 「보유자」 정의(D234), `owner_count` 주석, 새 함수 `pickDefaultPlaytimeAppId(items)` |
| `packages/shared/src/bot.ts` | 주석만: play 저장·랭킹 미사용, unit seconds = 음성 초, playtime `synced_at` 항상 값 |
| `packages/shared/src/contract.s5.test.ts` | voice만·play 이벤트 수락, total = voice refine·옛 payload 거부, 플레이타임 보유자 없음 `synced_at` 값·null 거부·빈 payload, `pickDefaultPlaytimeAppId` |
| `packages/shared/dist` | 재빌드 |
| 이 문서 | 변경 이력, 1-3, 2, 5-4, 5-5, 6-2, 6-5, 7(보유자 정의, 7-1, 7-2, 7-3, 새 7-4), 9-2, 10, 11, 14-1, 15, 16(D232–D236), 17(Q3 닫음, Q14–Q16), 명세 갱신 |

r1 영향: 마이그레이션·DB enum·`ActivityType`·봇 요청 스키마·오류 코드·엔드포인트·환경 변수 변경 없음. 웹 응답 모양만 바뀐다(활동 `play_sec` 삭제, 플레이타임 `synced_at` non-null) → 아래 배포 규칙대로 api·web 같은 커밋. 옛 웹 + 새 api: `play_sec` 없음 → 옛 웹 parse 실패(활동 탭 오류). 새 웹 + 옛 api: `synced_at null`·total ≠ voice → parse 실패. S5가 아직 배포 전이라 실제 영향 없음.

**배포 영향:** `community`가 필수라 api와 web을 같은 커밋으로 배포한다(S4 D200과 같음). 새 웹 + 옛 api → 요약 parse 실패(홈·사이드바 시즌 카드 숨김). 옛 웹 + 새 api → 모르는 필드를 버려 영향 없음. 마이그레이션은 추가만이라 옛 api가 새 스키마에서 돈다(Prisma가 모르는 컬럼은 무시). 봇은 키 발급 전까지 모든 요청이 401이다.

**기준선(architect, 2026-10-31, 구현 전):** `corepack pnpm -r typecheck` 4개 패키지 Done. 테스트 shared 138(s5 33개 포함)·core 355·web 256·api 501 passed / 42 skipped(DB e2e). `prisma validate`·`generate` 통과, migrate diff 일치. 이 PC는 Node 20.11이라 `vitest.config.ts`를 읽지 못해 같은 내용의 임시 `.mjs` 설정으로 실행하고 지웠다(S4와 같음).

---

## 16. 결정 사항 (S5, D202부터)

| # | 결정 | 이유 |
| --- | --- | --- |
| D202 | ~~S0 D23을 뒤집어 연동 코드 표·흐름을 만든다~~ **r2에서 철회(D237)** — 연동 코드 표·흐름을 만들지 않는다 | 슬라이스 포함 범위, 문서 6장 흐름. 로그인 방식과 무관한 봇 연동 경로가 남는다. 실제 사용 대상이 적은 점은 Q1 |
| D203 | 「연동됨」 = `discord_id`가 snowflake. (r2: 「발급은 미연동 회원만, 연동 회원은 409」 부분은 D237로 소멸, 판정 정의만 유지) | 디스코드 로그인 회원은 이미 같은 값이다. 다른 snowflake로 덮으면 로그인 계정이 바뀐다 |
| D204 | 연동 해제 엔드포인트 없음 | `discord_id`가 로그인 식별자라 해제하면 로그인할 수 없다 |
| D205 | ~~코드는 SHA-256 해시만 저장, 원문은 발급 응답에서 한 번만. `active_code`는 만료 시각만~~ **r2에서 철회(D237)** | `api_keys`·`refresh_tokens`와 같은 원칙. 새로고침 후 코드가 안 보이는 대신 재발급이 1클릭 |
| D206 | ~~유효 15분(메인 기본값 3). 목업 「10분」 문구는 응답 `ttl_sec`으로 만든다~~ **r2에서 철회(D237)** | 문구와 값이 어긋나지 않게. Q2 |
| D207 | ~~코드 = `RS-` + 31자 알파벳 6자. 봇 연결 시도 횟수 제한 없음~~ **r2에서 철회(D237)** | 유효 코드가 회원 수만큼, 15분만 존재해 무작위 성공 확률 ≈ 회원 수 ÷ 8.9억. 봇이 명령 쿨다운을 둔다(Q11) |
| D208 | ~~코드 형식 오류도 `DISCORD_LINK_CODE_INVALID`(404)~~ **r2에서 철회(D237)** | 봇이 사용자에게 보여 줄 문구가 하나다. VALIDATION_FAILED는 봇 프로그램 오류에만 남긴다 |
| D209 | 봇 요청 본문 `.strict()`, 봇 응답에는 discord_id 포함(`BotUserRef`) | 봇 쪽 필드 오타가 조용히 버려지지 않는다. 봇은 멘션·DM에 snowflake가 필요하고 키 소유자는 운영자다. 웹 D38은 그대로 |
| D210 | chat은 duration 0만 받고 시간 랭킹에 넣지 않는다. 활동 일수·「이번 주 활동 멤버」에만 쓴다. 회원·날짜당 1건 권장 | 메인 기본값 2. 문서 7-3 기준이 `duration_sec` 합계라 채팅 시간은 정의가 없다. 메시지 수 컬럼이 없어 스키마를 늘리지 않는다 |
| D211 | 한 요청 100건, 과거 7일, 끝 시각 미래 5분, 길이 24시간 | 메인 기본값 4. 봇이 며칠 꺼져도 복구할 수 있고, 월간 랭킹을 오래 흔들지 않는다. 진행 중 세션을 받지 않아 같은 세션이 두 번 쌓이지 않는다 |
| D212 | 기간 귀속은 `started_at` 하나, 세션을 서버가 나누지 않는다. 봇이 KST 자정에서 나눈다 | 집계 SQL이 단순하고 결과가 결정적이다. 자정 분할이면 주·월 경계도 자동으로 맞는다 |
| D213 | 건별 결과 4종, 요청은 200. 판정 순서 고정. rejected·unlinked는 키를 쓰지 않는다 | 일괄 전송 한 건 때문에 나머지를 잃지 않는다. 봇이 재전송 여부를 결과만 보고 정한다 |
| D214 | 문서에 없는 봇 엔드포인트 2개(`member-events`, `presence`)와 `bot_presence` 표 추가. scope 2개 추가 | 퇴장(S4 Q4)과 「지금 접속 인원」은 끝난 세션 이벤트(activity)로 알 수 없다. 접속 현황은 이력이 필요 없어 1행 덮어쓰기 |
| D215 | 활동·플레이타임도 `ranking_caches` 한 경로, 봇 랭킹은 웹과 같은 캐시 행을 읽는다 | D146·D148 그대로. 웹과 디스코드 숫자가 같아야 한다 |
| D216 | 활동 키는 기간 종류별 고정 키, payload에 기간. 기간이 바뀐 payload는 캐시 없음으로 본다. 순위 변동 = 직전 기간 마지막 순위 대비 | 기간마다 키를 만들면 기준(직전 기간)을 찾을 수 없다. `rollRankBaseline`을 그대로 쓴다. 지난주 값을 이번 주로 보이지 않는다 |
| D217 | 플레이타임 미리 갱신은 보유 상위 50개 게임, 나머지는 요청 때 계산 후 다음 주기에 삭제 | 보유 게임 수가 수천일 수 있다. 어떤 게임이든 5분에 최대 1번 계산이라 「요청마다 계산하지 않는다」를 지킨다 |
| D218 | 홈 봇 자료는 `stats`가 아니라 새 블록 `community`(필수). 각 칸이 state를 가진다 | 칸마다 「봇 없음」「오래됨」이 다르다. 기존 `stats` 모양을 바꾸지 않는다. S4 주석의 「stats에 추가」를 대체 |
| D219 | 「지금 플레이 중」은 접속 현황이 live이고 playing이 1행 이상일 때만 | 슬라이스 「데이터가 충분할 때만」. 오래된 목록을 「지금」이라고 보이지 않는다 |
| D220 | `left_at`·`guild_membership_at`, `rankableUserWhere = {leftAt: null}` + SQL 판, 퇴장은 토큰 폐기, 재입장·길드 검사 로그인은 복구, 순서는 occurred_at 비교 | S4 Q4·S0 D24 결정. 봇 이벤트는 재전송·순서 뒤바뀜이 생긴다. 로그인 길드 검사가 가장 확실한 「지금 멤버」 증거다 |
| D221 | 키 = `gcd_` + 32바이트, SHA-256, `last_used_at` 60초 간격 기록, 발급은 CLI(시드 아님) | 고엔트로피 키라 느린 해시가 필요 없다. 요청마다 쓰지 않는다. 시드는 원문이 저장소·로그에 남는다. 관리자 화면은 S6 |
| D222 | 곧 시작 내전에 알림 대상 discord_id 목록을 담고, 보낸 기록은 봇이 관리한다 | 목업 Settings 「시작 30분 전 · 디스코드 DM」 설정을 지킨다. 서버에 알림 상태 표를 만들지 않는다 |
| D223 | `activity_logs.api_key_id` 추가(SET NULL) | 키 유출 시 그 키가 넣은 행을 찾을 방법이 필요하다. 추가 컬럼 하나로 끝난다 |
| D224 | lookup은 미연동 404, 탈퇴 회원은 찾는다(left_at 포함) | REST 의미 그대로. 봇이 재입장 회원을 알아본다 |
| D225 | 스팀 배치는 S1 05:00 KST 작업 그대로, S5 코드 추가 없음. 랭킹은 대표·verified 스팀 계정만 | 슬라이스 요구(하루 1회 새벽, 비공개 사유, 횟수 제한)가 S1에 이미 있다 |
| D226 | 새 환경 변수 없음, 정책 값은 shared 상수 | 운영 중 바꿀 근거가 아직 없다. 사용자 답(Q2·Q5)에 따라 env로 올린다 |
| D227 | ~~개발 회원이 코드로 연결하면 `discord_id`를 snowflake로 바꾼다(개발 로그인으로 다시 못 찾음)~~ **r2에서 철회(D237)** — 코드 연결이 없으므로 개발 회원의 discord_id는 바뀌지 않는다 | 운영 회원에는 영향이 없다. 별도 컬럼을 두면 문서 「discord_id는 봇 연동 시 채움」과 어긋난다. Q13 |
| D228 | `bot_connected`(랭킹)·`not_connected`(홈) = activity_logs 행 또는 접속 현황 행이 하나라도 있는가 | 빈 목록이 「봇 없음」인지 「기록 없음」인지 구분한다. 키 사용 기록이 아니라 자료 존재로 판단해 화면이 실제 자료와 맞는다 |
| D229 | 활동 랭킹·활동 멤버는 연동 + 탈퇴 아닌 회원만. 미연동 이벤트는 저장되지 않아 자연히 빠진다 | D213, D220과 같은 기준 |
| D230 | 입퇴장 일괄은 사용자별 잠금 + 조건부 update, 결과는 요청 순서 | 같은 회원을 다룬 두 요청이 겹쳐도 더 새 판단만 남는다 |
| D231 | 봇 랭킹 `detail`은 서버가 만든 한국어 문구, `value`·`unit`은 숫자 | 봇마다 같은 문구를 다시 만들 필요가 없고, 숫자는 봇이 다른 형식으로 쓸 수 있다 |
| D232 | **(사용자 결정, Q3 답)** 활동 랭킹 시간은 음성(voice)만. `ACTIVITY_RANKED_TYPES = ['voice']`, 응답 `play_sec` 제거, `total_sec = voice_sec`(두 필드 유지 + refine), 표 머리 「VOICE TIME」. `/bot/activity`는 play를 그대로 받아 저장한다(DB enum·`ActivityType`·마이그레이션 변경 없음). 옛 모양 캐시는 refine 실패로 자동 재계산 | 목업 「VOICE TIME · 디스코드 음성 채널 접속 시간 합계」와 맞춘다. play를 계속 받으면 나중에 다시 넣을 때 봇·스키마를 바꾸지 않는다. `total_sec`을 남겨 봇 value·화면 정렬 이름이 바뀌지 않게 하고, refine으로 play가 다시 섞이는 실수를 parse에서 막는다 |
| D233 | ~~활동 일수(`active_days`)는 voice·chat·play 모두 센다(변경 없음).~~ **일수 부분은 D240으로 철회(voice·chat만).** 주 게임(`main_games`)은 voice 시간 기준 | 「N일 중 M일 활동」은 「그날 무언가 했음」 뜻이고 D210이 chat을 이미 넣었다. 주 게임은 순위 시간과 같은 기준이어야 「이 시간이 어느 게임에서 왔나」가 맞는다. 일수도 voice만으로 할지는 Q15 |
| D234 | 플레이타임 「보유자」 = 대표·verified 스팀 계정, `minutes_total > 0`, 탈퇴 제외. 랭킹 행·미리 갱신 상위 50·`GET /steam-apps`(q 없음·q 있음·`owner_count` 전부)가 이 정의 하나를 쓴다. 화면 기본 게임 = `pickDefaultPlaytimeAppId`(owner_count ≥ 1 첫 항목) | QA s5_web: `/steam-apps`가 모든 `steam_playtime` 행을 세어 select 기본값이 빈 순위 게임일 수 있었다. 사용자 지시는 q 없음이지만 `owner_count`가 모드마다 뜻이 다르면 같은 결함이 검색 결과에서 다시 생긴다. 내전 「스팀 게임 선택」 목록도 같은 정의로 좁아진다(Q16) |
| D235 | 플레이타임 보유자 0명 app도 빈 결과(`entries []`)를 캐시에 저장한다. 응답 `synced_at`은 항상 계산 시각(shared non-null) | QA s5_backend #6: 저장하지 않으면 그 app_id는 요청마다 SQL이 돌아 D217 「어떤 게임이든 5분에 최대 1번」과 어긋난다. 대상 밖 키는 다음 주기 `deleteExcept`가 지우므로 임의 app_id로 행이 쌓이지 않는다 |
| D236 | 2절 NOT_FOUND는 lookup 하나뿐, 경로 `:type` 오류는 VALIDATION_FAILED 행으로 옮긴다. (r1 당시 함께 정한 「연동 코드 발급·연결 모두 advisory lock 먼저」 정정은 r2 D237로 대상이 없어졌다) | 계약 문서 결함 정정(QA s5_backend #5) |
| D237 | **(사용자 결정 2026-10-31)** 디스코드 연동 코드 기능을 만들지 않는다. `POST /me/discord-link/code`, `POST /bot/link`, `discord_link_codes` 표, scope `bot:link`, 오류 코드 4개, shared 코드 상수·함수·스키마, core `discordLinkCodeState` 삭제. 마이그레이션 `20261031120000_s5`를 migrate diff로 다시 만든다(미배포·미커밋). 미연동 discord_id 이벤트는 그대로 `unlinked`(저장 안 함, D213). 철회: D202, D205–D208, D227, D236의 잠금 부분. Q1·Q2·Q11(연동 코드 시도 부분)·Q13 닫음 | 로그인이 디스코드 OAuth라 가입 시점에 `discord_id`가 자동으로 채워진다(S0 D23). 코드가 필요한 회원은 개발 전용 로그인뿐이었다(Q1). 운영에 쓰이지 않는 쓰기 경로·표·오류를 남기지 않는다 |
| D238 | `GET /me/discord-link`도 없앤다. 설정 화면 「연동됨 / 미연동」은 기존 `GET /me`의 `discord_id`(`isLinkedDiscordId`)·`discord_username`으로 그린다. 프로필 `discord_linked`(S1)는 그대로 | 코드 상태(`active_code`)가 사라지면 남는 값 `linked`·`discord_username`은 `GET /me`에 이미 있다(본인 화면이라 `discord_id` 노출 범위도 기존과 같다). 같은 사실을 두 엔드포인트가 주면 캐시 무효화가 두 군데가 된다. 프로필 `discord_linked`는 다른 회원 화면용이라 대체 대상이 아니다 |
| D239 | **(사용자 결정 2026-10-31)** 활동 랭킹 행에 참고 열 `scrim_count`. 셈 = 그 기간에 시작한(`COALESCE(started_at, scheduled_at)` KST, `[period_start, period_end)`) 취소 아닌 내전 중 그 회원이 `joined`이고 결과가 `approved`인 내전 수. 대기·참가 취소·노쇼·결과 대기·반려 제외, rated 여부·게임 무관. 정렬·`total_sec`·순위 포함에 쓰지 않고(음성 0이면 순위 없음) 5분 캐시 payload에 넣는다. 화면 SCRIMS 열·모바일 보조 줄, 봇 detail 「· 내전 N회」 | 사용자 추천안 그대로. 시작 시각 기준이라 음성 귀속(started_at, D212)과 같은 「기간에 시작한 것」 규칙이다. `scheduled_at`은 승인 결과가 있는데 `started_at`이 빈 옛 행 대비. 결과 승인만 세면 실제로 치러진 내전만 남고 노쇼 판정(S2)과도 어긋나지 않는다. 봇 detail에 넣어 웹과 디스코드가 같은 정보를 보인다(Q17) |
| D240 | **(사용자 결정 2026-10-31)** play는 모든 활동 집계에서 제외한다(수신·저장만). shared `ACTIVITY_COUNTED_TYPES = ['voice', 'chat']`: 활동 일수(`active_days`, 봇 detail 「N일 중 M일 활동」 포함)와 홈 `community.active_members`가 이 목록만 센다. 시간·주 게임은 계속 `ACTIVITY_RANKED_TYPES`(voice). `/bot/activity` 수신 검증·저장, `now_playing`(봇 presence), 응답 모양, 마이그레이션 변경 없음. D233의 일수 부분 철회, Q14·Q15 닫음 | play 이벤트는 「우리 채팅방 사람들과 같이 한 게임」이라는 보장이 없다(혼자 한 게임도 온다). chat은 서버 안 활동이 확실해 남긴다. 저장은 계속해 나중에 규칙을 바꿔도 봇·스키마를 건드리지 않는다 |

---

## 17. 확인 필요 (사용자 판단)

메인 기본값 1–4 반영: 1 → D213, 2 → D210(채팅 정책 포함), 3 → D206·5-3, 4 → D211. 아래는 답이 오기 전 「현재 계약(추천안)」대로 구현한다.

| # | 질문 | 현재 계약 · 추천 | 다른 선택지 |
| --- | --- | --- | --- |
| Q1 | ~~로그인이 디스코드라 실제 회원은 처음부터 `discord_id`가 있다(S0 D23). 연동 코드는 개발 회원 등 `discord_id`가 없는 회원만 쓸 수 있다. 그래도 만들까?~~ | **닫음(2026-10-31 사용자 결정): 연동 코드 기능을 만들지 않는다 → D237, D238** | - |
| Q2 | ~~연동 코드 유효 시간: 슬라이스 15분, 목업 「10분 뒤 만료」~~ | **닫음(2026-10-31 사용자 결정): 연동 코드가 없어 해당 없음 → D237** | - |
| Q3 | ~~활동 랭킹 시간: voice + play 합계 vs voice만~~ | **닫음(2026-10-31 사용자 결정): voice만 → D232, D233** | - |
| Q4 | 미연동 이벤트는 저장하지 않고 연동 후에도 소급하지 않는다(메인 기본값 1). 연동 전 활동이 랭킹에 안 남는다 | 유지(추천). 디스코드 로그인 회원은 처음부터 연동이라 영향이 거의 없다 | 미연동 이벤트를 discord_id로 보관했다가 연동 때 붙이기(표 추가, 개인정보 보관 늘어남) |
| Q5 | 이벤트 한도: 100건/요청, 과거 7일, 끝 시각 미래 5분, 24시간/건 | 이 값(추천, D211) | 과거 한도를 35일로(지난달 랭킹 늦은 반영 허용) |
| Q6 | 활동 랭킹은 「이번 주」「이번 달」만 본다. 지난주·지난달 최종 순위 조회 없음 | 유지(추천). 목업 필터도 이번 주 | `offset=-1` 파라미터로 지난 기간 조회(캐시 키 2개 추가) |
| Q7 | 문서에 없는 봇 엔드포인트 2개(`member-events`, `presence`)와 표 `bot_presence`를 추가했다. 명세 6장 표에 넣을까? | 추가 유지, 명세 6장·5장 갱신(추천, D214) | presence를 빼고 홈 「음성 채널 접속」「지금 플레이 중」을 계속 숨긴다 |
| Q8 | 서버를 나간 회원은 순위·뱃지 대상에서만 빠진다. 로그인(길드 검사 켜져 있으면 이미 막힘)·내전 참가·프로필은 그대로다. 종료 전 시즌에서 나간 회원은 최종 순위에서 빠져 아래 순위가 당겨진다 | 유지(추천, S4 Q4 결정 범위) | 퇴장 회원 내전 참가 제한, 프로필 「서버를 나간 멤버」 표시 |
| Q9 | 디스코드 서버는 하나라고 가정한다(`bot_presence.source = 'default'`) | 유지(추천) | 서버 여러 개(요청에 guild_id, 홈 합산 규칙 필요) |
| Q10 | 스팀 프로필이 비공개로 바뀌어도 마지막 성공 플레이타임으로 순위에 남는다. 목업은 「프로필이 공개된 멤버만」 | 유지(추천, 문서 9장 「마지막 성공값」) | 마지막 동기화가 `STEAM_PROFILE_PRIVATE`면 제외 |
| Q11 | ~~봇 API 요청 횟수 제한과 연동 코드 시도 제한이 없다. 키를 가진 봇만 부를 수 있다~~ | **닫음(2026-10-31 사용자 결정): 연동 코드 시도 제한은 기능 제거로 해당 없음(D237). 봇 API 요청 횟수 제한은 계속 없다(키를 가진 봇만 부를 수 있다) — 필요해지면 새 질문으로** | - |
| Q12 | 디스코드 DM은 「내전 시작 알림」만 계약했다. 결과 승인·대기 승격 알림(설정 `notify_result`·`notify_waitlist`)은 봇이 받을 엔드포인트가 없다 | S5는 시작 알림만(추천) | S6에 봇 알림 피드(`GET /bot/notifications?since=`) |
| Q13 | ~~개발 회원(`dev-…`)이 코드로 연동하면 개발 로그인으로 그 계정을 다시 찾지 못한다(새 회원이 생긴다)~~ | **닫음(2026-10-31 사용자 결정): 코드 연결이 없어 개발 회원 discord_id가 바뀌지 않는다 → D237** | - |
| Q14 | ~~홈 「이번 주 활동 멤버」(`active_members`)가 play만 한 회원도 센다~~ | **닫음(2026-10-31 사용자 결정): voice·chat만 → D240.** `now_playing`은 변경 없음 | - |
| Q15 | ~~활동 일수에 play·chat만 한 날도 들어간다(D233)~~ | **닫음(2026-10-31 사용자 결정): play만 한 날은 빼고 chat은 센다 → D240** | - |
| Q16 | `/steam-apps` 보유자 조건을 랭킹과 맞추면서(D234) 내전 작성 「스팀 게임 선택」의 기본 목록에서 0분 게임·부계정·탈퇴 회원만 가진 게임이 빠진다(검색하면 상점 결과로는 나온다) | 같은 조건(추천, `owner_count` 뜻 하나) | 내전 선택용은 기존 넓은 조건 유지, 랭킹용으로 `?purpose=ranking` 파라미터나 별도 엔드포인트 |
| Q17 | 활동 랭킹 `scrim_count`(D239)를 봇 `/bot/rankings/activity`의 `detail` 문구에도 넣었다(「7일 중 6일 활동 · 내전 3회」). 친선(rated=false) 내전도 센다 | 넣음·친선 포함(추천) | 봇 detail에는 넣지 않음 / rated 내전만 |

### 명세 문서 갱신 필요(사용자 확인 후)

- 6장 봇 API 표: `POST /bot/member-events`, `PUT /bot/presence` 추가(Q7). `POST /bot/link`와 「연동 흐름은 세 단계」 삭제 → 「디스코드 로그인 때 discord_id 자동 연동」(D237).
- 5장 표: `bot_presence`, `users.left_at` 추가(`discord_link_codes`는 없음, D237). `discord_id` 설명 「봇 연동 시 채움」 → 「디스코드 로그인 때 채움」.
- 7-3·8장 `/rankings` 활동: 참고 열 「내전 참여 횟수」(승인된 내전, 정렬 무관, D239).
- 7-3 활동 행: 「voice(디스코드 음성 채널 접속) `duration_sec` 합계, 기간 귀속은 시작 시각. play는 저장하지만 랭킹에 쓰지 않음」(Q3 답 = 음성만, D232).
- 7-3 활동 일수·8장 홈 「이번 주 활동 멤버」: 「voice·chat만 센다. play(게임 실행)는 저장만 하고 어떤 활동 집계에도 쓰지 않음」(D240).
- 6장 `/steam-apps`(S2 D98) 설명: 「멤버 보유 = 대표·확인된 스팀 계정, 플레이 0분·탈퇴 제외」(D234).

## S2·S3 후속 (2026-10-31)

S5 범위를 바꾸지 않는다. 입력은 `_workspace/00_input/slice.md` 「S2·S3 후속」.

- `DELETE /scrims/:id` → 204. `@Roles('admin')`. 비운영진은 없는 내전도 403. 승인된 결과가 있으면 409 `SCRIM_DELETE_NOT_ALLOWED`(레이팅 기록 유지). 그 외 모집 중·마감·진행 중·취소는 참가자·결과와 함께 행 삭제. 응답 `can_delete`가 true일 때만 목록 카드와 상세에 삭제 버튼을 그린다.
- 롤체 작성은 `tft_mode` 필수: `double_up` | `normal` | `ranked`. 다른 게임은 보내면 400. 작성 후 변경 없음. 정원은 더블업 2–8 짝수(기본 8), 일반 2–8(기본 8), 랭크 2–3(기본 3).
- `auto_balance` 저장값: 롤은 기존(요청 && 팀 게임). 더블업만 요청값. 롤체 일반·랭크·스팀은 항상 false. 작성 화면 토글은 롤과 더블업만.
- 더블업 페어는 `POST /scrims/:id/duos` → ScrimDetail. 방장·운영진, 마감 또는 진행 중, 활성 결과 없음, 참가 확정 짝수 2–8. 실력은 롤과 같은 `computeSkill`(티어 중심, 이번 시즌 경기 수에 따라 ELO 비중 0%→10경기 최대 20%). 그 값의 내림차순으로 강한 사람과 약한 사람을 짝 짓고 `scrim_players.duo_index`(1부터)에 저장. 롤 2팀 `POST /scrims/:id/balance`는 그대로(저장 안 함).
- 스팀 모집(같은 날 추가). `games.has_teams`와 `games.has_results`는 false. 수동 팀 지정·승패 입력·시즌 ELO 반영을 받지 않는다. `POST /scrims/:id/result`는 `has_results`가 false면 400. 메뉴·목록 제목과 카드·레이팅 문구는 「내전/모집」. 링크 복사는 게임 아이콘(롤 ⚔️, 롤체 ♟️, 스팀 🕹️)과 날짜·시간·인원·상태·참여 링크를 줄로 나눈다. 이미 저장된 `winner_team` 결과는 게임 플래그와 상관없이 그대로 보여 준다.
- 스키마: enum `tft_mode`, `scrims.tft_mode` nullable, `scrim_players.duo_index` nullable. 마이그레이션 `20261031200000_scrim_delete_tft_mode`. `games.has_results` boolean NOT NULL DEFAULT true, 스팀 행은 `has_teams=false`, `has_results=false`. 마이그레이션 `20261031210000_steam_recruit_no_results`. DROP 없음. 기존 롤체 행의 `tft_mode` null은 허용하고, 새 작성만 모드가 필수다.
