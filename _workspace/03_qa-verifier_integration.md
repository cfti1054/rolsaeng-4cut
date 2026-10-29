# QA: integration (apps/api integrations·jobs) — 판정: pass (minor 3)

작성: qa-verifier, 2026-10-29
대상: `apps/api/src/integrations/**`, `apps/api/src/jobs/**`, `apps/api/test/integrations/*.spec.ts`, `apps/api/test/support/{integration-helpers,memory-sync-store}.ts`, `apps/api/test/fixtures/{riot,steam}/*`
구현자 보고서: `_workspace/02_integration-dev_report.md`(리더가 옮겨 적음)
기준: 계약 6·9절, 13절 integration, D59, D62–D66(리더 결정 — 결함으로 보지 않음). 체크리스트 `_workspace/03_qa-verifier_plan.md` C절.
제외: `AppModule` 연결(`IntegrationsModule`, `JobsModule.forRoot()` — backend 담당). 현재 `apps/api/src/app.module.ts`에 연결 없음을 확인만 함.

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm --filter api test` | 15 files passed, 1 skipped / **197 passed, 5 skipped**(S0 DB e2e) — 보고서 수치와 같음. integration 스펙 6개: riot-client 15, steam-client 11, rate-limiter 5, in-process-queue 9, sync-worker 19, ddragon 3 |
| `corepack pnpm -r typecheck` | shared·core·web·api Done |
| `corepack pnpm --filter api build` | 성공 |
| `corepack pnpm install --frozen-lockfile` | Done(lockfile 일치). `@nestjs/schedule` 12.0.2, `bullmq` 6.5.0 고정 표기(apps/api/package.json:27,29) |
| `grep -rnE "RGAPI-\|key=[A-Za-z0-9]{20,}"`(node_modules·dist·.next 제외) | 문서 속 예시 문자열만, 코드·fixture 0건 |
| `git ls-files .env` | 추적 안 됨 |
| `grep -rn "riotgames\|steampowered\|steamcommunity.com/openid\|ddragon" apps/web/src` | 0건 — 브라우저 외부 호출 없음 |
| integrations·jobs 로그 호출 전수(`log.*`, `console.*` 9곳) | PUUID·스팀 ID·키·URL 없음. 계정은 `gameAccountId`로만 기록 |
| `node_modules/bullmq/dist/cjs/classes/job.js:916-918` | `Custom Id cannot contain :` — 중복 제거 키 구분자로 `:` 대신 `-`를 쓴 이유 확인(아래 참고 2) |
| 실제 라이엇·스팀·OpenID 호출 | **키 필요** |
| BullMQ·Redis, `PrismaSyncStore`·생산자 SQL·advisory lock | **미실행**(Redis·DB 없음) — 정적 검토만 |

## 체크리스트 대조

### C1 계약 인터페이스
- `contracts.ts`의 메서드, `CallMode`, `ExternalErrorKind` 6종, `SyncJobKind` 4종, `SyncJobReason` 5종, DI 심벌 4개가 계약 9절과 같음.
- 추가된 것은 `RiotAccount`·`RiotMatch`·`SteamOwnedGame` 타입과 `getPlayerSummary(steamId, mode?)`, 생성자 옵션뿐. 모두 기존 시그니처를 넓히기만 한 하위 호환 확장.
- 외부 응답은 zod로 필요한 필드만 파싱하고, 형식이 다르면 `bad_response`(riot-client.ts:162-163, steam-client.ts getJson).

### C2 클라이언트·라우팅
- 호스트는 설정값에서 만듦: regional = Account-V1·Match-V5, platform = Summoner·League·TFT-League(riot-client.ts:68-73). europe/jp1 설정 테스트 있음.
- 라이엇 키는 `X-Riot-Token` 헤더로 보냄(riot-client.ts:152). 스팀 키는 쿼리에 들어가지만 오류 메시지·로그에 URL을 싣지 않음. 테스트 「오류 메시지에 키가 들어가지 않는다」, 「메시지에 키·URL이 없다」 있음.
- Match ids는 `queue=420&type=ranked&count=20`, League 큐는 `RANKED_SOLO_5x5`·`RANKED_TFT`(worker는 `RANKED_QUEUE_BY_GAME` 사용). TFT 경로 `/tft/league/v1/by-puuid`는 I1 확인 결과와 같음.
- GetOwnedGames: `include_appinfo=1&include_played_free_games=1`. `{"response":{}}`는 비공개, `game_count:0`은 공개(테스트 있음). `playtime_2weeks`가 없으면 0.
- 타임아웃은 `AbortController`로 처리하고, 본문 읽기까지 타이머 안에 들어감(http.ts rawRequest). Data Dragon·OpenID도 같은 함수를 씀.
- I1–I5 확인 결과가 보고서에 있음. 실제 호출은 「키 필요」. I2(D65), I3(D66)는 리더 결정으로 처리됨.

### C3 429·재시도·분류
- **429**
  - `Retry-After`(없으면 60초)만큼 그 호스트만 멈추고 즉시 재시도하지 않음(http.ts classifyStatus, riot-client.ts:158). `withRetry`는 `unavailable`만 재시도함(retry.ts).
  - 테스트: 「429 → 호스트를 멈추고 즉시 재시도하지 않는다」, 「Retry-After가 없으면 60초」.
- **401/403**: 재시도 없이 `auth`로 분류하고 「키 만료/권한」 로그를 남김. 테스트 「401·403 → auth, 재시도 없음」.
- **토큰 버킷**
  - 호스트별 초당·2분 버킷 2개.
  - interactive는 3초 넘게 기다려야 하면 `rate_limited`와 예상 대기 초를 돌려줌(rate-limiter.ts acquire).
  - 테스트 5개 있음.
- **5xx·타임아웃**: background는 1·2·4초 백오프 후 3회 재시도, interactive는 1회 재시도. 테스트 있음.
- **404**: `not_found`(계정 조회 → ACCOUNT_NOT_FOUND). 리그 기록이 없을 때는 200 `[]`을 받고 UNRANKED로 저장(테스트 「큐 기록이 없으면 UNRANKED 스냅샷」).
- **스팀**: 버킷 없이 429 일시정지만 둠(`MAX_SAFE_INTEGER` 한도의 limiter, integrations.module.ts).

### C4 Steam OpenID
- ns, op_endpoint, return_to(정확히 일치), claimed_id 패턴, identity = claimed_id를 모두 외부 호출 전에 검사. 변조 테스트 5종이 네트워크 호출 없이 `ok:false`를 반환함.
- check_authentication은 받은 `openid.*`를 그대로 두고 mode만 바꿔 form POST로 보냄. `is_valid:true` 줄이 정확히 있을 때만 인정(steam-client.ts의 split/trim 비교). 섞인 줄 테스트 있음. 5xx·타임아웃은 `ExternalApiError`.

### C5 큐·작업자
- **in-process 큐**
  - 우선순위가 먼저, 같으면 등록 순. 제공자 레인별 동시 실행 1개. 대기·실행 중 작업 모두 중복 제거하고 manual은 별도 키. 429는 해당 레인만 멈춘 뒤 `rateLimitedCount+1`로 다시 넣음.
  - 각각 테스트 있음.
- **REDIS_URL**: 빈 값이면 `InProcessSyncQueue`를 씀(jobs.module.ts factory, options.ts `emptyToUndefined`). BullMQ 구현은 작성만 됐고 실행은 미확인(D63).
- **상태 전이 전수**(D59 반영 맵 `transitions.ts:89-93` 대조) — 맵 밖 전이 없음:
  - `claim`(sync-store.ts:104-114): idle·queued → running, 10분 지난 running → running(D59)
  - `release`(116-133): running → idle
  - `requeue`(135-144): running → idle → queued, 두 단계
  - `requeueStuck`(284-305): 10분 지난 queued·running → queued(D59)
  - 맵에 있는 queued → idle 「작업 버림」은 integration 쪽 코드에 없음. 계정 해제가 행을 지우므로 필요하지 않음(backend 범위).
- **결과 저장**
  - `toRankValue`와 `isSameRank` 결과가 다를 때만 스냅샷을 저장하고, 언랭도 저장함.
  - 성공한 부분만 시각을 갱신하고, 실패는 두 행 모두에 기록. 전부 성공하면 null.
  - 실패해도 기존 데이터를 지우지 않음. 스팀 비공개면 기존 플레이타임을 유지(sync-worker.ts:229-233).
  - `toRankValue`의 `RangeError`는 INTERNAL_ERROR로 기록(테스트 「알 수 없는 tier → INTERNAL_ERROR」).
- **작업 종류별 동작**
  - `riot-full`: 이름 → lol 티어 → tft 티어 → 대표일 때만 전적.
  - `riot-tier`: 이름·전적 없음, 부계정 포함.
  - 생산자 SQL은 계약 6-2와 같은 조건·정렬(sync-store.ts:232-253).
- **riot-matches**
  - 이미 있는 매치는 다시 상세 조회하지 않음.
  - `played_at` = gameEndTimestamp, 없으면 Start. `summary`는 `LolMatchSummary.parse`를 거쳐 저장. 최신 20개만 남김(trimMatches).
- **기타**
  - 해제된 계정은 아무것도 하지 않음(sync-worker.ts:87). 실행 중에 해제되면 release가 0행을 갱신하고 끝남.
  - 429 처리: 1·2번째는 queued로 되돌리고 `retryAfterSec`를 돌려줌. 3번째는 PROVIDER_RATE_LIMITED로 기록(sync-worker.ts:118-124, 테스트 있음).
  - cron: `0 * * * *`, `0 5 * * *`, `*/5 * * * *`, 모두 `timeZone: 'Asia/Seoul'`. `pg_try_advisory_xact_lock`(D62)을 얻었을 때만 실행. `SYNC_JOBS_ENABLED=false`면 등록하지 않음.
  - 시작 시 갓 running이 된 행은 건드리지 않음(D64).

### C6 fixture
- 계약에 나온 9종이 모두 있음: 정상, 언랭(`league-empty`), MASTER(`rank:"I"`를 무시해 division null), 429, 401·403, 5xx(테스트 안에서 생성), 스팀 비공개 `{"response":{}}`, 0개 공개, OpenID `is_valid:false`.
- 식별자는 모두 가짜:
  - PUUID: `FAKE-PUUID-0001-aaaa…`, `FAKE-OTHER`
  - 매치 ID: `KR_9000000001/2`
  - 스팀 ID: `76561190000000001` — 실제 계정 ID가 시작하는 76561197960265728보다 작은 값
  - 키: `test-riot-key`, `test-steam-key`
- 실제 키·PUUID는 없음.

## 결함

| # | 심각도 | 위치(파일:줄) | 기대 | 실제 | 재현 |
| --- | --- | --- | --- | --- | --- |
| m1 | minor | `apps/api/src/jobs/sync-store.ts:276-282`, `apps/api/src/jobs/sync-scheduler.ts:36,58,68` | 계약 6-2 「멈춘 작업 정리」: **같은 종류** 작업을 다시 등록. D49: 라이엇 표시 이름은 연동·수동 새로고침 때만 갱신 | 멈춘 행과 시작 시 queued 행은 원래 작업 종류와 상관없이 라이엇이면 항상 `riot-full`로 다시 등록됨(DB에 종류가 없어서). 멈춘 `riot-tier`·`riot-matches`도 회수되면 Account-V1 호출과 대표 계정 전적 조회가 붙어 호출이 늘고, 주기 작업 경로에서 이름이 갱신됨 | `findPrimaryRows`가 lol 행을 `'riot-full'`로 고정해 돌려줌. 시간당 호출량 영향은 작지만 계약 문구와 다름. 계약을 「라이엇은 riot-full로 회수」로 고치거나 종류를 보존해야 함 |
| m2 | minor | `apps/api/src/jobs/jobs.module.ts:49-50` | 계약 11절·6-3: `SYNC_JOBS_ENABLED=false`면 **cron 등록만** 하지 않음 | 소비자(큐 작업자)도 시작하지 않음. 이 값이 false인 프로세스에서는 수동 새로고침이 202로 횟수를 차감한 뒤 in-process 큐에서 영원히 실행되지 않음. 정리 cron도 꺼져 있어 행이 `queued`로 남고, 웹은 60초 폴링 후 멈춤 | 코드 경로를 정적으로 확인함. `.env.example` 주석 「테스트·로컬에서 끄려면 false」대로 로컬에서 끄면 수동 새로고침이 동작하지 않음. 리더가 계약을 넓힐지, 소비자는 유지할지 결정 필요 |
| m3 | minor | `apps/api/test/db/`(`auth.db.e2e.spec.ts`만 있음) | 계약 13절 integration 6: 「작업자 결과 저장(DB 필요분은 **작성만**)」 | `PrismaSyncStore`(claim·requeueStuck 조건부 update, 생산자 raw SQL, `pg_try_advisory_xact_lock`, upsert·trim·replaceSteamPlaytime)를 대상으로 한 DB 테스트가 작성되지 않음. 작업자 테스트는 전부 `memory-sync-store` 기준 | `ls apps/api/test/db`. Docker가 생기면 바로 돌릴 테스트가 없음. 정적 검토에서는 SQL·조건에 이상을 찾지 못함 |

## 참고 (결함 아님)

1. D62–D66은 리더 결정으로 계약에 추가돼 있어 결함으로 보지 않았다. 현재 코드와 결정 내용이 일치한다(xact 잠금 sync-store.ts:217-230, BullMQ 단일 큐 bullmq-queue.ts, 시작 시 queued만 재등록 sync-scheduler.ts:36).
2. 중복 제거 키가 계약 6-3의 `{kind}:{id}` / `manual:{id}`가 아니라 `{kind}-{id}` / `manual-{id}`다(in-process-queue.ts:15). BullMQ 6.5가 `:` 들어간 커스텀 jobId를 거부하므로(job.js:916-918) 구현이 맞다. 계약 문구만 고치면 된다. backend는 키 형식에 의존하지 않고 `enqueue`만 호출하면 된다.
3. BullMQ 소비자는 `concurrency: 2`다. 계약의 「제공자별 동시 1」은 in-process 쪽 규칙이고, 호출 한도는 limiter가 지키므로 문제는 아니다. 실행은 미확인이다.
4. 「4xx 중 404를 제외한 나머지는 bad_response로 분류해 INTERNAL_ERROR로 기록」하는 동작은 계약 2절 「응답 형식 불일치 포함」과 일치한다.
5. `in-process-queue.ts:119`는 핸들러 예외 메시지를 그대로 로그에 남긴다. 작업자가 잡지 못한 Prisma 예외의 메시지에 쿼리 값이 들어갈 수 있으니 backend 연결 후 로그 정책을 볼 때 함께 확인하길 권한다.
6. 보고서는 리더가 옮겨 적은 것이라, 수치(197 passed / 5 skipped)는 직접 다시 실행해서 확인했다.
