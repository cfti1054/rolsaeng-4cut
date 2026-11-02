# 디스코드 봇 작업 진행 및 Railway 구동 가이드

> Written for: 디스코드 봇을 구현하고 Railway에 배포·운영할 개발자(본인 포함).

이 문서는 디스코드 봇을 **어떤 순서로 만들고**, **Railway에서 어떻게 24시간 구동하는지** 정리합니다. 계약(요청·응답 형식)의 원본은 [_workspace/S5/01_architect_contract.md](../_workspace/S5/01_architect_contract.md)의 6~8절이며, 이 문서와 계약이 다르면 계약이 우선합니다.

---

## 1. 현재 상태

| 영역 | 상태 | 위치 |
| --- | --- | --- |
| 봇용 API 엔드포인트 | 구현됨 (S5) | [apps/api/src/modules/bot/](../apps/api/src/modules/bot/) |
| API 키 인증 가드 | 구현됨 | [apps/api/src/common/guards/api-key.guard.ts](../apps/api/src/common/guards/api-key.guard.ts) |
| API 키 발급 CLI | 구현됨 | [apps/api/scripts/api-key.ts](../apps/api/scripts/api-key.ts) |
| 디스코드 봇 프로세스 | 구현됨 | [apps/bot/](../apps/bot/) |
| 봇 세션 테이블 | 마이그레이션만 추가됨. DB 적용은 배포 시 `prisma migrate deploy` | [20261102190000_bot_voice_sessions](../apps/api/prisma/migrations/20261102190000_bot_voice_sessions/migration.sql) |
| Railway 봇 서비스 | **미생성** | — |

봇은 API와 **별도 프로세스**입니다. 이 저장소의 API는 봇의 요청을 받기만 하고, 디스코드에 직접 붙지 않습니다.

---

## 2. 전체 구조

```
[디스코드 서버]
     ▲  웹소켓 (봇 토큰)          │
     │                            ▼
[Railway: bot 서비스] ──HTTPS (X-API-Key)──▶ [Railway: api 서비스] ──▶ [PostgreSQL]
  apps/bot (discord.js)                       apps/api (NestJS)
                                                    ▲
                                                    │ HTTPS (JWT, 웹 로그인)
                                              [웹 대시보드 apps/web]
```

- **봇 → API:** 음성 활동, 접속 상태, 입퇴장 이벤트를 보냅니다. 인증은 `X-API-Key` 헤더입니다.
- **API → 봇:** 봇이 주기적으로 `pending` 목록을 조회해 공지·패치노트를 디스코드에 보냅니다. API가 먼저 요청을 보내지는 않습니다.
- **웹 로그인(OAuth2)** 은 봇과 별개입니다. 자세한 구분은 5절을 보세요.

---

## 3. 작업 진행 순서

아래 순서대로 진행하면 됩니다. 앞 단계가 끝나야 다음 단계가 의미가 있습니다.

### 단계 1. 계약 확인
- S5 계약 6~8절에서 봇 엔드포인트 목록, 요청·응답 스키마, 오류 코드를 확인합니다.
- 봇이 쓸 zod 스키마는 `packages/shared`에서 가져옵니다. 응답 필드 이름은 snake_case입니다.

### 단계 2. 디스코드 앱 준비
- 디스코드 개발자 포털에서 앱을 만들고 **Bot 토큰**을 발급받습니다.
- Privileged Gateway Intents에서 **Server Members**, **Presence**를 켭니다.
- **Message Content**는 켜지 않습니다. 채팅 활동은 모으지 않습니다(12절).
- OAuth2 URL Generator에서 `bot`, `applications.commands` 스코프로 초대 URL을 만들고 커뮤니티 서버에 초대합니다. 권한 세부 내용은 5절을 보세요.

### 단계 3. API 키 발급
```
corepack pnpm --filter api api-key create --name "디스코드 봇" --scopes bot:activity,bot:scrims:read,bot:rankings:read,bot:members,bot:presence,bot:notices,bot:patch-notes
```
- 원문 키는 **한 번만** 출력됩니다. 바로 Railway 환경 변수 `BOT_API_KEY`에 넣습니다.
- 키는 DB에 해시로만 저장됩니다. 원문을 잃어버리면 새로 발급하고 이전 키는 폐기합니다.

### 단계 4. 봇 로컬 실행
1. `apps/bot/.env.example`을 `apps/bot/.env`로 복사하고 값을 채웁니다(6절).
2. 세션 테이블을 적용합니다(`corepack pnpm --filter api prisma:deploy`). API는 `corepack pnpm --filter api build` 후 `corepack pnpm --filter api start`로 띄웁니다.
3. `corepack pnpm --filter @gcd/bot dev` 로 봇을 실행하고, 음성 입장·퇴장이 API에 들어가는지 확인합니다.
4. 패키지 구조는 아래와 같습니다.

```
apps/bot/
  src/
    index.ts          클라이언트 로그인, 이벤트 등록, 60초 루프, SIGTERM 처리
    events/           음성 인원·플레이 스냅샷
    commands/         슬래시 명령어 (랭킹, 곧 시작하는 내전)
    jobs.ts           활동 전송, 공지·패치노트, 내전 시작 DM
    api-client.ts     X-API-Key 헤더, 재시도·백오프, 응답 검증
    session-store.ts  음성 세션·보낸 DM·공지 발송 기록
  Dockerfile
  package.json
```

### 단계 5. 배포 전 점검
- 봇을 로컬에서 실행해 음성 채널 입장·퇴장이 `POST /bot/activity`로 한 번씩만 들어가는지 확인합니다.
- 같은 세션을 두 번 보내도 API가 `duplicate`로 응답하는지 확인합니다.
- 봇 토큰이 코드나 Git에 들어가지 않았는지 확인합니다.

### 단계 6. Railway 배포
9절 절차를 따릅니다.

### 단계 7. 배포 후 검증
- Railway 로그에 `ready` 같은 기동 메시지가 나오는지 확인합니다.
- 디스코드에서 음성 채널에 들어갔다 나와 보고, API 쪽 활동 기록이 생기는지 확인합니다.
- 슬래시 명령어가 응답하는지 확인합니다.
- 재배포 후에도 음성 세션이 유실되지 않는지 확인합니다.

---

## 4. 봇 동작 명세 (이벤트 → API)

| 디스코드 이벤트 / 트리거 | 봇 동작 | 호출 엔드포인트 | 비고 |
| --- | --- | --- | --- |
| 음성 채널 입장·퇴장 | 세션 시작·종료 시각 기록, 종료 시 전송 | `POST /bot/activity` | `idempotency_key` 필수. 같은 세션이면 같은 키 |
| 게임 플레이 상태 변경 | 현재 플레이 중인 게임 전송 | `PUT /bot/presence` | 가장 최근 상태만 덮어씀 |
| 서버 입장·퇴장 | 멤버 이벤트 전송 | `POST /bot/member-events` | 재입장 처리는 API가 담당 |
| `/랭킹` 명령어 | 랭킹 요약 조회 후 임베드로 응답 | `GET /bot/rankings/{type}` | 계산하지 않고 읽기만 |
| `/내전` 명령어 | 곧 시작하는 내전 조회 | `GET /bot/scrims/upcoming` | `within_min` 쿼리 사용 |
| 주기 타이머(예: 1분) | 대기 중인 공지 조회 후 발송, 발송 완료 보고 | `GET /bot/notices/pending` → `POST /bot/notices/{id}/delivered` | 발송 후 보고는 멱등 |
| 주기 타이머(예: 1분) | 대기 중인 패치노트 조회 후 발송 | `GET /bot/patch-notes/pending` → `POST /bot/patch-notes/{id}/delivered` | 같은 방식 |

### 활동 전송 예시
```json
POST /api/v1/bot/activity
{
  "events": [
    {
      "idempotency_key": "voice-123456789012345678-20261027T2010",
      "discord_id": "123456789012345678",
      "type": "voice",
      "game": "lol",
      "started_at": "2026-10-27T20:10:00+09:00",
      "duration_sec": 3600
    }
  ]
}
```
- `idempotency_key`는 같은 세션에 대해 항상 같은 값이어야 합니다. 봇이 재시작해서 같은 세션을 다시 보내도 중복 저장되지 않습니다.
- 미연동 `discord_id`는 저장되지 않고 응답의 `unlinked` 개수로만 돌아옵니다.

---

## 5. 디스코드 설정: 두 가지 OAuth 구분

| 용도 | 어디서 얻나 | 환경 변수 | 사용처 |
| --- | --- | --- | --- |
| 웹 로그인 (OAuth2) | OAuth2 탭의 Client ID / Client Secret, Redirect URI 등록 | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | API의 디스코드 로그인 |
| 봇 실행 | Bot 탭의 Token | `DISCORD_BOT_TOKEN` | Railway 봇 서비스 |

- 봇 토큰과 Client Secret은 **다른 값**입니다. 섞어 쓰지 않습니다.
- 봇을 서버에 초대할 때 필요한 OAuth2 설정:
  - Scopes: `bot`, `applications.commands`
  - Bot Permissions (최소 권장): View Channels, Connect, Send Messages, Embed Links
- 초대는 "서버 관리" 권한이 있는 계정이 한 번만 하면 됩니다.

---

## 6. 환경 변수

| 변수 | 서비스 | 설명 | 예시 |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | bot | 봇 토큰. 비밀 | (Bot 탭에서 발급) |
| `DISCORD_GUILD_ID` | bot | 커뮤니티 서버 ID | `123…` |
| `DISCORD_NOTICE_CHANNEL_ID` | bot | 공지를 올릴 텍스트 채널 ID | `123…` |
| `BOT_API_KEY` | bot | API 키 CLI로 발급한 원문 | `…` |
| `API_BASE_URL` | bot | API 기본 주소 | `https://<api-domain>/api/v1` |
| `DATABASE_URL` | bot | 음성 세션·발송 기록용 PostgreSQL. API와 같은 데이터베이스 | 플러그인이 자동 주입 |
| `NODE_ENV` | bot | 운영 환경 표시 | `production` |

- `.env.example`에는 **값 없이 키 이름만** 적어 둡니다. 실제 값은 로컬 `.env`와 Railway Variables에만 넣습니다.

---

## 7. 세션 저장

음성 세션은 **A. PostgreSQL**에 둡니다. 봇이 `DATABASE_URL`로 직접 읽고 쓰며, 테이블은 API Prisma 마이그레이션으로만 만듭니다.

| 테이블 | 용도 |
| --- | --- |
| `bot_voice_sessions` | 열린 음성 세션. 회원당 하나만 열려 있다. 재시작 때 아직 채널에 있으면 잇고, 없으면 `last_seen_at`까지로 닫는다 |
| `bot_direct_messages` | 내전 시작 DM·패치노트 DM을 받은 회원. 내전은 시작 시각이 바뀌면 다시 보낸다 |
| `bot_outbound_deliveries` | 공지·패치노트를 채널이나 DM으로 올린 뒤, API `delivered` 호출이 실패해도 같은 글을 다시 올리지 않기 위한 기록 |

SIGTERM이면 열린 세션을 그 시각에 닫아 API로 보낸 다음 디스코드 연결을 끊습니다.

---

## 8. Railway 구동 방법

### 8-1. 구조
- 같은 Railway 프로젝트 안에 서비스를 둘 둡니다.
  - `api`: NestJS API (기존)
  - `bot`: 디스코드 봇 (신규)
- 두 서비스 모두 같은 GitHub 저장소를 봅니다.
- 봇은 **공개 도메인이 필요 없습니다.** 디스코드로 나가는 연결만 있으면 됩니다.

### 8-2. 봇 서비스 생성
1. Railway 프로젝트에서 **New → GitHub Repo**로 같은 저장소를 연결합니다.
2. 서비스 이름을 `bot`으로 바꿉니다.
3. **Settings → Source**에서 Root Directory를 설정합니다. pnpm 워크스페이스라서 `packages/shared`도 필요하므로, **Dockerfile 방식**을 권장합니다. 빌드 컨텍스트는 저장소 루트입니다.
4. **Settings → Deploy**에서 Restart Policy를 **On Failure**로 둡니다.
5. **Settings → Scaling**에서 레플리카를 **1**로 둡니다. 2 이상이면 같은 음성 이벤트가 중복으로 발생하고 공지가 두 번 나갈 수 있습니다.
6. **Settings → Networking**에서 공개 도메인을 만들지 **않습니다**.
7. **Variables**에 6절 표의 `bot` 변수를 넣습니다.

### 8-3. Dockerfile

실제 파일은 [apps/bot/Dockerfile](../apps/bot/Dockerfile)입니다. 패키지 이름은 `@gcd/bot`이고, 빌드 컨텍스트는 저장소 루트입니다.

```
docker build -f apps/bot/Dockerfile -t gcd-bot .
```

Railway 서비스 변수 `RAILWAY_DOCKERFILE_PATH=apps/bot/Dockerfile`. 루트 디렉터리는 비워 둡니다.

pnpm 잠금 파일이 워크스페이스 전체 매니페스트를 보므로, API·웹 이미지의 Dockerfile도 `apps/bot/package.json`을 복사합니다. 그 이미지에 봇 코드를 넣지는 않습니다.

### 8-4. 재배포와 종료 처리
- Railway는 재배포할 때 기존 컨테이너에 **SIGTERM**을 보냅니다. 봇은 이 신호를 받으면 다음을 해야 합니다.
  1. 진행 중인 음성 세션을 종료 처리해서 API나 DB에 보냅니다.
  2. 디스코드 클라이언트를 정상 종료합니다(`client.destroy()`).
  3. 종료합니다.
- 종료 처리가 끝나기 전에 강제 종료되면 세션이 남을 수 있습니다. 재시작 때 복구 로직으로 보완하세요.

### 8-5. 재시작 시 세션 복구
- 봇이 뜨면 `GUILD_ID` 서버의 현재 음성 채널 접속자를 읽습니다.
- 세션 저장소(7절)에 남아 있던 열린 세션과 대조해 이어 가거나 닫습니다.

### 8-6. 로그와 상태 확인
- Railway 서비스의 **Deployments → View Logs**에서 로그를 봅니다.
- 봇 로그에는 기동 메시지, API 호출 결과(건수, 오류 코드), 재시도 횟수를 남깁니다.
- **토큰과 API 키는 로그에 찍지 않습니다.**

### 8-7. 비용
- Railway는 무료 체험 이후 사용량 기반 요금입니다. 봇은 상시 실행 서비스라서 월 비용이 계속 발생합니다.
- 플랜과 한도는 Railway 대시보드나 공식 문서에서 최신 정보를 확인하세요.

---

## 9. 운영 점검 체크리스트

배포 후 주기적으로 확인합니다.

- [ ] 봇이 디스코드 서버에서 온라인으로 보인다
- [ ] 음성 활동이 API 기록에 들어온다
- [ ] `unlinked` 개수가 과도하게 늘지 않는다(연동 안내 필요 신호)
- [ ] 공지 발송 후 `delivered`가 호출되고 같은 공지가 반복 발송되지 않는다
- [ ] 재배포 후 열린 세션이 유실되지 않는다
- [ ] API 키 `last_used_at`이 갱신된다(관리자 화면, S6)
- [ ] 봇 토큰 노출 의심 시 Reset Token → Railway 변수 갱신 → 재배포

---

## 10. 장애 대응

| 증상 | 원인 후보 | 조치 |
| --- | --- | --- |
| 봇이 오프라인 | 토큰 오류, 재배포 실패 | Railway 로그 확인, `DISCORD_BOT_TOKEN` 재확인 |
| API 호출 401 | `BOT_API_KEY` 오류, 키 폐기됨 | 키 재발급 후 변수 갱신 |
| API 호출 403 | 키의 scope 부족 | 발급 시 `--scopes` 목록 확인 |
| API 호출 429 또는 5xx | 요청 과다, API 일시 장애 | 백오프 재시도 확인, 배치 크기 줄이기 |
| 활동이 기록 안 됨 | 미연동 `discord_id` | 응답의 `unlinked` 확인, 사용자 디스코드 로그인 여부 확인 |
| 같은 공지가 여러 번 나감 | 레플리카 2개 이상 | 레플리카를 1로 줄임 |
| 재배포 후 세션 유실 | SIGTERM 처리 누락 | 8-4 절차 구현 여부 확인 |

---

## 11. 보안 원칙

- 봇 토큰, Client Secret, API 키는 **Railway Variables에만** 둡니다. 저장소에 올리지 않습니다.
- 봇 서비스에 공개 도메인을 만들지 않습니다.
- API 키 scope는 필요한 것만 줍니다. 봇이 쓰지 않는 scope는 빼세요.
- 공개 채널에 개인 정보(디스코드 ID 전체 목록 등)를 출력하지 않습니다.

---

## 12. 구현하면서 정한 것

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 세션 저장 (7절) | PostgreSQL. 봇이 `pg`로 접근 | 가이드의 기본안. API 계약은 바꾸지 않음 |
| 채팅 활동 | 모으지 않음 | 정책이 없어서 Message Content 인텐트를 켜지 않음. 음성만 `POST /bot/activity` |
| 요청 주기 | 활동·접속·공지·내전 알림 60초. 음성·플레이 변화는 5초 뒤 접속 현황. 배치는 계약의 100건 | 계약 Q11이 없어서 계약의 권장 간격(presence 60초, 내전 알림 1–5분)을 따름 |
| 결과·대기 승격 DM | 없음 | 계약 Q12. 내전 시작 30분 전 DM(D222)과 패치노트 DM은 구현함 |
| 공지 채널 | `DISCORD_NOTICE_CHANNEL_ID` 필수 | 공지는 개인 DM이 아니라 채널에 올린다 |
| API 키 scope | `bot:users:read`는 빼 둠 | 지금 봇은 회원 조회를 부르지 않음 |

채팅 수집이나 결과·대기 승격 DM을 넣으려면 이 문서와 봇을 같이 고칩니다.
