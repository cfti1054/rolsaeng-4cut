# Railway 디스코드 봇 배포 설정 절차

> Written for: 커밋 이후 Railway에 디스코드 봇 서비스를 처음 띄우는 운영자(본인 포함).

이 문서는 **처음 한 번 하는 설정**을 순서대로 적습니다. 봇의 동작 원리와 장애 대응 전체는 [discord-bot-guide.md](discord-bot-guide.md)를 보세요.

커밋을 푸시하면 기존 `api`·`web` 서비스만 다시 배포됩니다. **`bot` 서비스는 아래 3단계에서 직접 만들어야** 돌기 시작합니다.

| 단계 | 할 일 | 어디서 |
| --- | --- | --- |
| 0 | 배포 브랜치 확인, 마이그레이션 적용 확인 | Railway `api` 서비스 |
| 1 | 봇 토큰·인텐트·초대, 서버·채널 ID 복사 | 디스코드 개발자 포털, 디스코드 앱 |
| 2 | 봇용 API 키 발급 | 웹 관리자 화면 또는 CLI |
| 3 | `bot` 서비스 생성과 변수 입력 | Railway |
| 4 | 배포 후 확인 | Railway 로그, 디스코드 |

---

## 0단계. 푸시 전후 확인

1. Railway `api` 서비스 **Settings → Source → Branch**에서 배포 브랜치를 확인합니다.
   - `main`이면 `qa`에 푸시만 해서는 배포되지 않습니다. PR을 머지해야 배포됩니다.
2. DB 마이그레이션은 직접 실행하지 않아도 됩니다. `api` 컨테이너가 시작할 때 `prisma migrate deploy`를 자동으로 실행합니다([apps/api/Dockerfile](../apps/api/Dockerfile)).
3. `api` 재배포가 끝나면 **api 로그**에서 마이그레이션 `20261102190000_bot_voice_sessions`가 적용됐는지 확인합니다.
   - 이 마이그레이션이 봇 테이블 3개(`bot_voice_sessions`, `bot_direct_messages`, `bot_outbound_deliveries`)를 만듭니다.
   - **이 단계가 끝나기 전에 봇을 띄우면** 봇 로그에 `startup step failed`(`step: reconcile`)가 나옵니다. 봇이 죽지는 않고, 테이블이 생기면 60초 주기에서 정상으로 돌아옵니다.

- [ ] 배포 브랜치 확인
- [ ] api 로그에서 마이그레이션 적용 확인

---

## 1단계. 디스코드 개발자 포털

1. https://discord.com/developers/applications 에서 웹 로그인에 쓰는 앱을 엽니다(새 앱을 만들어도 됩니다).
2. **Bot** 탭
   1. **Reset Token**으로 토큰을 받아 둡니다. → `DISCORD_BOT_TOKEN`
      - OAuth2 탭의 Client Secret과 **다른 값**입니다. 섞어 쓰지 않습니다.
   2. **Privileged Gateway Intents**
      - **Server Members Intent**: 켬 (입퇴장 이벤트)
      - **Presence Intent**: 켬 (플레이 중인 게임)
      - **Message Content Intent**: 끔 (채팅은 모으지 않음)
3. **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: View Channels, Connect, Send Messages, Embed Links
   - 만들어진 URL을 열고, **서버 관리** 권한이 있는 계정으로 커뮤니티 서버에 초대합니다.
4. 디스코드 앱에서 ID 복사
   1. **사용자 설정 → 고급 → 개발자 모드**를 켭니다.
   2. 서버 아이콘 우클릭 → **서버 ID 복사** → `DISCORD_GUILD_ID`
   3. 공지를 올릴 텍스트 채널 우클릭 → **채널 ID 복사** → `DISCORD_NOTICE_CHANNEL_ID`
5. 공지 채널이 비공개라면 채널 설정 → 권한에서 봇 역할에 **채널 보기, 메시지 보내기, 링크 첨부**를 허용합니다.

- [ ] 봇 토큰 보관
- [ ] 인텐트 2개 켬, Message Content 끔
- [ ] 서버에 봇 초대
- [ ] 서버 ID, 공지 채널 ID 복사

---

## 2단계. 봇용 API 키 발급

원문 키는 **발급할 때 한 번만** 보입니다. 바로 복사해 두고, 잃어버리면 새로 발급한 뒤 이전 키는 폐기합니다.

scope는 아래 7개입니다. `bot:users:read`는 넣지 않습니다.

```
bot:activity, bot:scrims:read, bot:rankings:read, bot:members, bot:presence, bot:notices, bot:patch-notes
```

**방법 A (권장): 관리자 화면**
- 운영 웹 `/admin` → **API 키** → 이름 `디스코드 봇`, 위 scope로 발급합니다.

**방법 B: 로컬 CLI**
- 운영 DB에 붙어야 하므로 Railway Postgres의 **공개 접속 URL**을 `DATABASE_URL`로 넣고 실행합니다.
  ```
  corepack pnpm --filter api api-key create --name "디스코드 봇" --scopes bot:activity,bot:scrims:read,bot:rankings:read,bot:members,bot:presence,bot:notices,bot:patch-notes
  ```

- [ ] API 키 원문 보관 → `BOT_API_KEY`

---

## 3단계. Railway에 bot 서비스 만들기

1. 같은 Railway 프로젝트에서 **New → GitHub Repo** → 같은 저장소를 고릅니다.
2. 새 서비스 이름을 `bot`으로 바꿉니다.
3. **Settings → Source**
   - Root Directory: **비워 둠** (빌드 컨텍스트가 저장소 루트여야 `packages/shared`를 함께 빌드합니다)
   - Branch: `api` 서비스와 같은 브랜치
4. **Settings → Deploy**
   - Restart Policy: **On Failure**
5. **Settings → Scaling**
   - Replicas: **1** (2 이상이면 공지·DM이 두 번 나갑니다)
6. **Settings → Networking**
   - **Generate Domain을 누르지 않습니다.** 봇은 공개 주소가 필요 없습니다.
7. **Variables**

| 변수 | 값 | 비고 |
| --- | --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `apps/bot/Dockerfile` | |
| `DISCORD_BOT_TOKEN` | 1단계의 봇 토큰 | 비밀 |
| `DISCORD_GUILD_ID` | 1단계의 서버 ID | |
| `DISCORD_NOTICE_CHANNEL_ID` | 1단계의 채널 ID | |
| `BOT_API_KEY` | 2단계의 원문 키 | 비밀 |
| `API_BASE_URL` | `https://<api 공개 도메인>/api/v1` | 끝의 `/api/v1`까지 |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | 참조 변수. `Postgres`는 실제 DB 서비스 이름 |
| `NODE_ENV` | `production` | |

   - `API_BASE_URL`은 처음에는 api 공개 도메인으로 넣어 동작을 확인합니다.
   - 내부 주소(`http://<api 내부 도메인>:<포트>/api/v1`)로 바꾸면 외부를 거치지 않지만, `api` 서비스에 `PORT` 변수가 명시돼 있어야 합니다.
8. (선택) **Settings → Watch Paths** — 웹만 바뀌었을 때 봇이 다시 배포되지 않게 합니다.
   ```
   apps/bot/**
   packages/shared/**
   pnpm-lock.yaml
   ```
9. **Deploy**를 누릅니다.

- [ ] 서비스 생성, Root Directory 비움
- [ ] Restart On Failure, Replicas 1, 공개 도메인 없음
- [ ] 변수 8개 입력
- [ ] 배포

---

## 4단계. 배포 후 확인

순서대로 확인합니다.

1. **bot 로그** (Deployments → View Logs)
   - `commands registered`, `ready`가 보인다.
   - `presence`가 `accepted: true`로 찍힌다.
   - `startup step failed`가 보이면 `step`으로 원인을 좁힌다.
     - `reconcile` → DB. 0단계 마이그레이션 확인
     - `presence`, `notices`, `patch-notes`, `scrims` → API. `API_BASE_URL`, API 키 확인
     - `commands` → 봇 초대 때 `applications.commands` scope 확인
   - `환경 변수가 올바르지 않습니다: …`가 보이면 적힌 변수 이름의 값을 고친다.
2. **디스코드**
   - 봇이 온라인으로 보인다.
   - `/랭킹`, `/내전`이 자동완성에 뜨고 응답한다. 안 뜨면 디스코드 앱을 재시작한다.
3. **음성 활동**
   - **웹에 디스코드로 로그인한 계정**으로 음성 채널에 들어갔다 나온다.
   - 봇 로그에 `activity sent`, `created: 1`이 찍힌다.
   - `unlinked: 1`이면 그 디스코드 계정이 웹에 연동되지 않은 것이다.
4. **공지**
   - 관리자 화면에서 디스코드 알림을 켠 공지를 하나 쓴다.
   - 1분 안에 공지 채널에 올라오고, 로그에 `notice delivered`가 찍힌다.
5. **재배포**
   - bot 서비스를 **Redeploy**한다.
   - 로그에 `shutdown` → `ready`가 이어지고, 같은 공지가 다시 올라오지 않는다.

- [ ] 로그 `ready`
- [ ] 슬래시 명령어 응답
- [ ] 음성 활동 `created`
- [ ] 공지 발송
- [ ] 재배포 후 중복 없음

---

## 자주 나는 문제

| 증상 | 확인할 것 |
| --- | --- |
| 봇이 오프라인, 로그인 오류 | `DISCORD_BOT_TOKEN` 값, 인텐트 2개가 켜져 있는지 |
| 로그에 `status: 401` | `BOT_API_KEY` 오타, 폐기된 키 |
| 로그에 `status: 403` | 2단계 scope 7개를 모두 넣었는지 |
| `notice failed` | `DISCORD_NOTICE_CHANNEL_ID`, 그 채널에서 봇 권한 |
| 빌드 실패 | `RAILWAY_DOCKERFILE_PATH`, Root Directory가 비어 있는지 |
| 공지·DM이 두 번 나감 | Replicas가 1인지 |
| 봇 토큰 노출 의심 | Bot 탭 Reset Token → Railway 변수 갱신 → 재배포 |
