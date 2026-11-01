# integration-dev 보고서 (S5)

- 공식 문서 확인: 이번 슬라이스는 외부 엔드포인트 경로 변경 없음(라이엇·스팀 호출 코드 미변경) -> 재확인 대상 없음.
- 도구: Read/Write/Edit/Bash(corepack pnpm, Node 20.11)/WebFetch. Docker·DB 없음, 커밋 안 함.

## 구현
- apps/api/src/common/api-key.ts (integration이 만듦. 시작 시점에 없었음. backend가 만들었다면 backend 것을 남긴다): generateApiKey, hashApiKey (시그니처 6-1 그대로)
- apps/api/scripts/api-key-cli.ts: 순수 함수(parseCliArgs, parseScopes, format*, classifyMatches, 종료 코드 상수)
- apps/api/scripts/api-key.ts: Prisma 실행부(create/list/revoke). DB 쓰기는 작성만, 실행 미검증
- apps/api/package.json: "api-key": "tsx --conditions=source scripts/api-key.ts" (tsx 4.23.15 이미 devDependency)
- apps/api/tsconfig.json: include에 scripts/**/*.ts 추가(typecheck 대상)
- 종료 코드: 0 성공, 1 인자 오류(모르는 scope 포함), 2 대상 없음/prefix 모호, 3 DB 실패. 이미 폐기된 키 revoke는 0(revoked_at 유지).

## 테스트 (DB 없음)
- test/integrations/api-key-cli.spec.ts 15건
- test/integrations/steam-daily-batch.spec.ts 2건: 공개 fixture -> app_name·minutes_total·minutes_recent·synced_at(=NOW) 전달, 비공개 fixture -> STEAM_PROFILE_PRIVATE + 쓰기 없음
- 기존 sync-worker.spec.ts 'SyncWorker steam-playtime'(5건)도 같은 경로를 검증(synced_at만 빠져 있어 보강)
- test/integrations 9파일 83건 통과, api typecheck 통과

## D225 확인
sync-scheduler.ts `@Cron('0 5 * * *', KST)` produceSteam -> selectSteamTargets(verified 스팀 전체). 코드 변경 없음. 실제 스팀 키 연동은 「키 필요」.
한도 설정값 변경 없음.
