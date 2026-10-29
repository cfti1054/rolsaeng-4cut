# S1 integration (apps/api integrations·jobs) 보고

> integration-dev 에이전트가 실행 환경 제약으로 보고서 파일을 쓰지 못해, 리더가 최종 보고(영문)를 한국어로 옮겨 적었다(2026-10-28). 수치는 에이전트 보고 기준.

## 결과

- `typecheck`, `api test` 197 passed / 5 skipped(S0 DB e2e), `api build` 통과
- 새 테스트 62건(fixture 기반, 모든 ID·값은 가짜)
- 미실행: 실제 라이엇·스팀 호출(키 필요), BullMQ·Redis, `PrismaSyncStore`와 생산자 SQL(55분 티어 선택·잠금 포함, DB 필요)

## contracts.ts (`apps/api/src/integrations/contracts.ts`)

계약 9절과 같음. 추가 4가지: `RiotAccount`·`RiotMatch` 타입(`gameDuration`은 초로 정규화), `SteamOwnedGame` 타입, `SteamApi.getPlayerSummary(steamId, mode?)`(기본 `'interactive'`, 작업자는 `'background'`), `ExternalApiError(kind, message?, {retryAfterSec?, cause?})`.

## 구현

- 설정: `integrations/options.ts`가 env를 직접 읽음(`INTEGRATION_OPTIONS`). 기본 asia·kr·20/초·100/2분·5000ms. API 키는 오류·로그에 넣지 않음
- HTTP·한도: `http.ts`(타임아웃·상태 분류), `rate-limiter.ts`(호스트별 초당·2분 버킷), 429 → 해당 호스트 `Retry-After`(없으면 60초) 정지, interactive 모드에서 3초 넘는 대기는 `rate_limited` + `retryAfterSec`로 즉시 실패. `retry.ts`: 5xx·타임아웃 재시도 interactive 1회, background 3회(1·2·4초)
- 라이엇: `riot/riot-client.ts`, 라우팅은 설정값
- 스팀: `steam/steam-client.ts`. `{"response":{}}` = 비공개, `game_count: 0` = 공개·게임 없음. OpenID는 형식 검사 후 `check_authentication` POST, 정확히 `is_valid:true` 줄만 인정
- Data Dragon: `ddragon.ts` 버전 하루 캐시, 버전별 챔피언 표 캐시, 실패 후 60초 대기
- DI: `IntegrationsModule`(전역, `RIOT_API`·`STEAM_API`·`DATA_DRAGON`), `JobsModule.forRoot()`(`SYNC_QUEUE`·`SYNC_STORE`·`SyncWorker`; `REDIS_URL` 있으면 BullMQ, 없으면 in-process; `SYNC_JOBS_ENABLED=false`면 스케줄러·소비자 생략). **둘 다 `app.module.ts`에 아직 연결 안 함 — backend 담당**
- 큐: `InProcessSyncQueue` 우선순위 → FIFO, 제공자별 동시 1개, 대기·실행 중 중복 제거, 429는 해당 제공자 레인만 정지 후 재등록. `BullMqSyncQueue` 작성(미실행)
- 작업자 `jobs/sync-worker.ts`(계약 6-2): `isSameRank`가 false일 때만 스냅샷, 큐 없음 = UNRANKED, 매치는 대표 계정 lol 행만, 실패해도 기존 데이터 삭제 안 함·성공한 부분만 시각 갱신, 스팀 비공개는 `STEAM_PROFILE_PRIVATE` 기록 + 기존 플레이타임 유지, 429 재등록·세 번째 429는 `PROVIDER_RATE_LIMITED`, lol·tft 어느 행 id로 와도 같은 쌍 처리
- 생산자·정리 `jobs/sync-scheduler.ts`(D59): 티어 매시 정각 KST, 스팀 매일 05:00 KST, 멈춘 작업 정리 5분마다. 정리는 `sync_state_at < now-10분` 단일 update. 작업자 잠금은 `idle|queued OR stale`

## 계약과 다르게 한 것 → 리더 결정

| # | 내용 | 결정 |
| --- | --- | --- |
| 1 | `pg_try_advisory_xact_lock`(트랜잭션 잠금) 사용 | D62 승인 |
| 2 | BullMQ 큐 하나, 429가 스팀 작업도 잠시 정지 | D63 허용 |
| 3 | 시작 시 갓 `running`인 행은 10분 뒤에만 회수 | D64 승인 |

## 공식 문서 확인 (2026-10-28)

`developer.riotgames.com/apis`는 JS 렌더라 내용 확인 불가, Valve wiki는 403.

| # | 결과 | 출처 |
| --- | --- | --- |
| I1 | **부분 확인**(2차 출처: Riot 공식 swagger로 생성된 `mingweisamuel/riotapi-schema`). Account-V1·Match-V5 = 지역(asia), Summoner-V4·League-V4·TFT-League = 플랫폼(kr). 경로: `/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`, `/by-puuid/{puuid}`, `/lol/summoner/v4/summoners/by-puuid/{puuid}`, `/lol/league/v4/entries/by-puuid/{puuid}`, **`/tft/league/v1/by-puuid/{puuid}`**(entries 없음), `/lol/match/v5/matches/by-puuid/{puuid}/ids?queue&type&count`, `/lol/match/v5/matches/{matchId}` | 스키마 파일 |
| I2 | **미확인.** 아이콘 0–28이 모든 계정에서 선택 가능하다는 공식 문구 없음(Data Dragon `profileicon.json`에는 0–28 존재) | D65 |
| I3 | TFT `wins` = 1위 횟수, `losses` = 2–8위 → 「순방 %」 아님 | D66 |
| I4 | 공식 확인: Steam OpenID 엔드포인트 `https://steamcommunity.com/openid`, `GetOwnedGames` 파라미터. 미확인: 응답 필드, 비공개 응답 형태, `is_valid:true` 줄, `GetPlayerSummaries` 필드 → 관대하게 파싱 | steamcommunity.com/dev, partner.steamgames.com |
| I5 | 실제 응답으로 확인: `/api/versions.json` 첫 값이 최신(16.21.1), 아이콘 `/cdn/{v}/img/profileicon/{id}.png` 200, `ko_KR/champion.json`의 `data[name].key`는 숫자 문자열 | live fetch |

기타: 개발 키 24시간 만료, 429 시 `Retry-After` 동안 반드시 정지, Match-V5 `gameDuration`은 `gameEndTimestamp`가 없으면 밀리초(클라이언트가 변환).

## 다른 구현자 참고

- backend: `AppModule`에 `IntegrationsModule`, `JobsModule.forRoot()` 연결. 등록은 `jobs/in-process-queue.ts`의 `jobPriority(kind, reason, active?)`. 수동 sync `dedupeKey` = `manual-{id}`, 예약 = `riot-tier-{id}`. 스팀 콜백에서는 `getPlayerSummary`를 두 번째 인자 없이 호출
- frontend: 롤체 「순방 %」 표시 금지(D66)

## 파일

- 의존성: `@nestjs/schedule` 12.0.2, `bullmq` 6.5.0(고정), lockfile 변경
- `apps/api/src/integrations/`: contracts, options, http, retry, rate-limiter, ddragon, integrations.module, riot/riot-client, steam/steam-client
- `apps/api/src/jobs/`: sync-store, sync-worker, in-process-queue, bullmq-queue, sync-scheduler, jobs.module
- 테스트: `apps/api/test/integrations/*.spec.ts`, `test/support/{integration-helpers,memory-sync-store}.ts`, `test/fixtures/{riot,steam}/*`
