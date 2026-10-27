---
name: external-api-integration
description: "Riot API(Account-V1, League-V4, TFT League, Match-V5)와 Steam Web API(GetOwnedGames) 연동, 지역/플랫폼 라우팅, 호출 한도와 429 대기, 결과 캐시, 게임 계정 소유 확인, BullMQ 주기 동기화 작업 구현 규칙을 정한다. 라이엇·스팀 계정 연동, 티어·전적·플레이타임 동기화, 랭킹 캐시 작업을 만들거나 고칠 때 사용한다."
---

# 외부 API 연동 규칙

설계 원칙 4: 외부 API는 서버가 대신 호출하고 결과를 DB에 저장한다. 화면은 DB 값만 읽는다.

## 1. 구조

```
apps/api/src/integrations/
  riot/   riot.client.ts (HTTP + 한도)  riot.account.ts  riot.league.ts  riot.tft.ts  riot.match.ts
  steam/  steam.client.ts  steam.owned-games.ts
  rate-limiter.ts
apps/api/src/jobs/
  queues.ts   sync-tier.job.ts  sync-matches.job.ts  sync-playtime.job.ts  refresh-rankings.job.ts
test/fixtures/{riot,steam}/*.json
```

## 2. Riot

- **구현 전에 공식 문서(developer.riotgames.com/apis)에서 경로를 확인**하고 보고서에 URL과 확인 날짜를 적는다.
- 라우팅: Account-V1·Match-V5는 지역 라우팅(`asia.api.riotgames.com`), League-V4·TFT League는 플랫폼 라우팅(`kr.api.riotgames.com`). 롤과 롤체 엔드포인트는 분리되어 있다.
- 라이엇 ID(`게임이름#태그`) → Account-V1로 PUUID 조회 → `game_accounts.external_id`에 PUUID 저장. 표시 이름이 바뀌어도 PUUID는 유지된다.
- 키: `RIOT_API_KEY` 환경 변수. 개발 키는 24시간 만료 — 401/403이면 재시도하지 않고 "키 만료/권한" 오류로 기록한다(재시도해도 결과가 같다).
- 소유 확인: 서버가 무작위 프로필 아이콘 ID를 지정 → 사용자가 바꾼 뒤 "확인" → Summoner 정보의 아이콘 ID 비교 → `verified = true`. 대안으로 운영진 수동 승인 경로를 둔다.

## 3. Steam

- `IPlayerService/GetOwnedGames` (`include_appinfo=1`, `include_played_free_games=1`). `STEAM_API_KEY` 환경 변수.
- 프로필·게임 세부 정보가 비공개면 빈 응답이 온다. 이를 오류 `STEAM_PROFILE_PRIVATE`로 구분해 연동 화면이 공개 설정 방법을 안내하게 한다.
- `minutes_total` ← `playtime_forever`, `minutes_recent` ← `playtime_2weeks`(없으면 0).
- 할인 정보(P1)는 공식 API 지원이 제한적이므로 이 스킬 범위 밖이다. 출처를 정한 뒤 별도로 다룬다.

## 4. 호출 한도

- 지역/플랫폼 호스트별 토큰 버킷 두 개(초당·2분당). 기본값은 개발 키 수준(20/1s, 100/120s)이고 환경 변수로 바꾼다.
- 429 응답: `Retry-After` 초만큼 해당 큐를 일시정지(`queue.pause` → 타이머 → `resume`)하고 작업을 다시 넣는다. 즉시 재시도는 금지.
- 5xx: 지수 백오프 최대 3회.

## 5. 갱신 주기 (문서 9장)

| 작업 | 주기 | 대상 우선순위 |
| --- | --- | --- |
| sync-tier | 1시간 | 최근 7일 활동·내전 참가 멤버 먼저 |
| sync-matches | 요청 시 (프로필 조회에 6시간 이내 값이 없으면 큐에 등록) | — |
| sync-playtime | 하루 1회 새벽(KST 05:00) | 전체 |
| refresh-rankings | 5분 | 티어·ELO·활동·플레이타임 |
| 수동 sync | 사용자 요청, 하루 5회 제한(백엔드가 검사) | 최우선 |

- 결과 저장: 티어는 변화가 있을 때만 `rank_snapshots`에 새 행(그래프용), `last_synced_at`은 매번 갱신.
- 실패 시 기존 값을 지우지 않는다. 화면은 마지막 성공값 + `synced_at`을 보여준다.
- Redis가 없으면 큐 대신 `@nestjs/schedule` cron + DB 잠금으로 같은 작업을 실행하는 대체 경로를 쓴다(문서 4장 "Redis 없이 시작 가능").

## 6. 테스트

- 외부 호출은 fixture로 대체한다(`nock` 또는 클라이언트 인터페이스 목). 429·401·비공개 프로필 fixture를 반드시 포함한다.
- 키나 실제 PUUID를 fixture에 넣지 않는다.
