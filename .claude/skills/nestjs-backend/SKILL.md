---
name: nestjs-backend
description: "apps/api NestJS 서버의 모듈 구조, 인증 가드(JWT·봇 API 키), 권한, 내전 참가·대기열·결과 승인 트랜잭션, 봇 활동 수신의 멱등 처리, 수동 새로고침 횟수 제한, 테스트 작성법을 정한다. API 엔드포인트를 구현·수정·디버깅할 때 사용한다. 외부 API 클라이언트·큐 작업은 external-api-integration, 계산식은 domain-logic 스킬을 쓴다."
---

# NestJS 백엔드 구현 규칙

## 1. 모듈 배치

```
apps/api/src/
  modules/{auth,users,game-accounts,scrims,rankings,dashboard,admin,bot,news}/
    {name}.controller.ts  {name}.service.ts  {name}.module.ts  {name}.e2e.spec.ts
  common/  guards/ (jwt, api-key, roles)  pipes/zod.pipe.ts  filters/error.filter.ts  serialize.ts
  integrations/  jobs/      ← integration-dev 영역
```

- 요청 검증은 `ZodValidationPipe(shared 스키마)`로 한다. class-validator DTO를 따로 만들면 계약이 두 벌이 된다.
- 응답은 `serialize(Response스키마, data)`를 거쳐 반환한다. 이 함수가 camelCase→snake_case 변환과 스키마 검증을 맡는다. 개발 모드에서 검증 실패는 500으로 터뜨려 계약 위반을 바로 드러낸다.
- 모든 예외는 `error.filter.ts`가 `{ code, message }`로 바꾼다. 서비스에서는 `new AppError('SCRIM_FULL', 409)`처럼 던진다.

## 2. 인증·권한

| 소비자 | 방식 | 비고 |
| --- | --- | --- |
| 웹 | JWT 액세스(짧게) + 리프레시(httpOnly 쿠키) | `/auth/refresh` |
| 봇 | `X-API-Key` → 해시 비교, `scopes` 검사, `last_used_at` 갱신 | `/bot/*`에만 허용 |
| 운영진 | `@Roles('admin')` | 결과 승인, 노쇼 표시, 관리자 API |

방장 전용 동작(`balance`, `result`)은 가드가 아니라 서비스에서 `scrim.host_id === user.id`를 검사한다. 리소스 소유 판단은 데이터를 읽어야 가능하기 때문이다.

## 3. 동시성이 걸린 흐름

- **참가**: 트랜잭션 안에서 `SELECT ... FOR UPDATE`(Prisma `$queryRaw` 또는 serializable)로 정원을 확인한다. 정원이 차면 `waitlist`, 마지막 자리가 차면 scrim을 `full`로. 동시에 두 명이 마지막 자리를 잡는 경쟁을 막는다.
- **취소**: joined가 빠지면 가장 먼저 대기한 waitlist를 승격하고, full이었으면 recruiting으로 되돌린다.
- **노쇼 제한**: 참가 시 `core.isScrimBanned(최근 30일 no_show 기록, now)` 확인.
- **결과 승인**: 한 트랜잭션에서 `scrim_results.approved_*` 기록 → `core`로 새 레이팅 계산 → `ratings` 갱신 + `rating_history` 삽입 → scrim `finished`. 이미 승인된 결과면 `RESULT_ALREADY_APPROVED`로 거절한다. 레이팅 이중 반영은 되돌리기 어려운 데이터 오염이다.
- 상태 갱신은 shared의 전이 맵을 검사하는 헬퍼(`assertTransition`)로만 한다.

## 4. 봇 API

- `/bot/activity`는 `createMany({ skipDuplicates: true })`로 `idempotency_key` 중복을 무시하고, 응답에 `accepted`, `duplicated` 개수를 돌려준다.
- `discord_id`로 사용자를 못 찾은 이벤트는 저장하지 않고 `unlinked` 개수로 알려준다(연동 전 활동은 사용자와 이어질 수 없다).
- 연동 코드는 일회용·짧은 만료(예: 10분)로 만들고 사용 즉시 폐기한다.

## 5. 횟수 제한

`POST /me/game-accounts/{id}/sync`는 사용자당 하루 5회(설정값). Redis가 없으면 DB 카운터로 구현한다. 초과 시 `SYNC_LIMIT_EXCEEDED`(429).

## 6. 랭킹 조회

랭킹 API는 계산하지 않는다. 워커가 5분마다 만든 캐시(또는 materialized 결과)를 읽기만 한다. ELO 랭킹은 해당 시즌 5경기 이상만 노출한다.

## 7. 테스트

- 모듈마다 e2e 테스트: 정상 1건 + 권한 실패 + 주요 오류 코드. 테스트 DB는 docker compose의 postgres에 별도 스키마를 쓴다.
- 동시성 흐름(마지막 자리 경쟁, 승인 중복)은 `Promise.all`로 동시 요청 테스트를 작성한다.
- 응답 검증은 shared `Response` 스키마로 `parse`한다. 필드 하나하나 손으로 비교하지 않는다.
