---
name: api-contract
description: "게임 커뮤니티 대시보드의 모노레포 구조, Prisma 스키마, packages/shared의 zod 요청·응답 스키마, 오류 형식, 페이징 규칙, 슬라이스 계약 문서 작성법을 정한다. 엔드포인트 추가·응답 구조 변경·테이블 추가 등 계약을 정의하거나 바꿀 때, 또는 백엔드·프런트엔드가 공유 타입을 참조할 때 사용한다. 개별 화면 스타일이나 계산식 구현에는 쓰지 않는다."
---

# API 계약 규칙

계약은 웹 화면, API 서버, 나중에 붙을 디스코드 봇이 함께 따르는 약속이다(개발 문서 설계 원칙 2 "API 우선"). 계약이 코드(`packages/shared`)로 존재해야 세 소비자가 같은 정의를 쓴다.

## 1. 모노레포 구조 (기본값)

```
apps/
  web/        Next.js App Router (frontend-dev)
  api/        NestJS + Prisma + BullMQ 워커 (backend-dev, integration-dev)
    prisma/schema.prisma
packages/
  shared/     zod 스키마, 타입, 오류 코드, 상수 (architect)
  core/       순수 도메인 로직 (domain-logic-dev)
docker-compose.yml   postgres, redis
```

- 패키지 매니저 pnpm workspaces, Node LTS, TypeScript strict.
- 테스트 러너는 vitest로 통일한다(Nest는 `unplugin-swc`). 러너가 둘이면 QA가 명령을 헷갈린다.
- `core`는 `shared`만 의존하고, `shared`는 zod 외 의존성이 없다. 봇이 나중에 `shared`만 가져다 써도 되게 하기 위해서다.
- Redis는 문서 4장 지침대로 선택 사항이다. 외부 API 동기화 슬라이스 전까지는 없어도 동작하게 만든다.

## 2. 와이어 형식

| 항목 | 규칙 | 이유 |
| --- | --- | --- |
| 기본 경로 | `/api/v1` | 문서 6장 |
| JSON 필드 표기 | **snake_case** (`discord_id`, `scheduled_at`) | 문서의 봇 요청 예시·쿼리 파라미터가 snake_case다. 웹과 봇이 같은 형식을 쓴다 |
| TS 내부 표기 | Prisma 모델은 camelCase + `@map`으로 DB snake_case | 변환은 API 직렬화 계층 한 곳에서만 한다 |
| 시각 | ISO 8601 문자열, 오프셋 포함 | 활동 집계가 KST 기준이라 오프셋이 빠지면 주 경계가 틀린다 |
| ID | UUID 문자열 | 문서 5장 |
| 목록 | `{ "items": [...], "next_cursor": string \| null }`, 요청은 `cursor`, `limit`(기본 20, 최대 100) | 응답이 배열인지 객체인지 매번 헷갈리지 않게 형태를 하나로 고정 |
| 오류 | `{ "code": "SCRIM_FULL", "message": "..." }` + 적절한 HTTP 상태 | 문서 6장. `code`는 shared의 `ErrorCode` enum에서만 고른다 |
| 외부 데이터 | 동기화된 값에는 `synced_at`을 함께 반환 | 문서 9장 "갱신 시각 표시" |

## 3. shared 작성법

```ts
// packages/shared/src/scrims.ts
export const ScrimStatus = z.enum(['recruiting','full','playing','finished','cancelled']);
export const ScrimSummary = z.object({ id: z.string().uuid(), game: GameCode, title: z.string(), /* ... */ });
export const ListScrimsQuery = z.object({ game: GameCode.optional(), status: ScrimStatus.optional(), cursor: z.string().optional(), limit: z.coerce.number().max(100).optional() });
export const ListScrimsResponse = paginated(ScrimSummary);
export type ScrimSummary = z.infer<typeof ScrimSummary>;
```

- 엔드포인트마다 `{Verb}{Resource}Request`/`Query`/`Response` 이름을 쓴다. QA가 이름으로 생산자·소비자를 찾는다.
- 상태값·게임 코드·역할은 `z.enum`으로 정의하고 문자열 리터럴을 코드 곳곳에 쓰지 않는다.
- 게임은 데이터다(설계 원칙 3). `GameCode`는 시드된 `games.code`와 맞추되, 화면 분기를 게임 코드 하드코딩 대신 `has_positions` 같은 속성으로 하게 한다.

## 4. 상태 전이 (계약에 포함)

내전 `scrims.status`와 `scrim_players.status`의 허용 전이를 shared에 맵으로 정의한다. QA가 이 맵과 실제 갱신 코드를 대조한다.

```
scrims: recruiting → full → playing → finished
        recruiting|full → cancelled ; full → recruiting (취소로 자리 생김)
scrim_players: joined ↔ waitlist(승격) ; joined|waitlist → cancelled ; joined → no_show (종료 후 운영진)
```

## 5. Prisma 규칙

- 모든 테이블 `id uuid @default(uuid())`, `created_at`. 문서 5장 인덱스 3개를 반드시 선언한다.
- `activity_logs.idempotency_key`는 unique. 봇 재전송 시 중복 저장을 막는 유일한 장치다.
- `api_keys`에는 해시만 저장한다. 원문 컬럼을 만들지 않는다.
- 마이그레이션 이름은 슬라이스 이름을 쓴다: `pnpm --filter api prisma migrate dev --name {slice}`.

## 6. 계약 문서 형식 (`_workspace/01_architect_contract.md`)

```markdown
# 계약: {슬라이스}
## 변경 이력
## 범위            — 포함 기능(문서 2장 행), 제외 기능
## 스키마 변경     — 테이블/컬럼/인덱스
## 엔드포인트      — 메서드 | 경로 | 인증(JWT/API키/admin) | Request | Response | 오류 코드
## core 함수       — 시그니처와 담당 문서 절(7-1 등)
## 상태 전이       — 해당 시
## 담당 배정       — backend-dev / domain-logic-dev / integration-dev / frontend-dev 별 작업 목록
## 결정 사항       — 문서에 없어 새로 정한 것과 이유
## 확인 필요       — 문서 모순, 사용자 판단이 필요한 것
```
