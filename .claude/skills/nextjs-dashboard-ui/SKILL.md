---
name: nextjs-dashboard-ui
description: "apps/web Next.js 대시보드의 라우트 구조, 레이아웃(데스크톱 사이드바/모바일 하단 탭), 다크 테마, shadcn/ui 컴포넌트, Recharts 차트, API 클라이언트·데이터 훅, 로딩·빈 상태·오류·갱신 시각 표시 규칙을 정한다. 홈·내전·랭킹·프로필·설정·정보·관리자 화면을 만들거나 고칠 때 사용한다. API 서버 코드나 계약 정의에는 쓰지 않는다."
---

# Next.js 대시보드 화면 규칙

## 1. 라우트 (문서 8장)

```
apps/web/src/app/
  (auth)/login, (auth)/signup
  (main)/layout.tsx           사이드바 + 하단 탭
  (main)/page.tsx             /            홈 대시보드
  (main)/scrims/page.tsx      /scrims
  (main)/scrims/new/page.tsx  /scrims/new
  (main)/scrims/[id]/page.tsx /scrims/[id]
  (main)/rankings/page.tsx    /rankings     탭: tier | elo | activity | playtime (searchParams)
  (main)/members/[id]/page.tsx
  (main)/settings/page.tsx
  (main)/news, (main)/admin, (main)/highlights   ← P1/P2
```

링크는 `lib/routes.ts`의 함수(`routes.scrim(id)`)로만 만든다. 문자열 경로를 흩어 쓰면 라우트와 링크가 어긋난다.

## 2. 데이터 계층

```ts
// lib/api/client.ts
export async function api<S extends z.ZodTypeAny>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, credentials: 'include' });
  const body = await res.json();
  if (!res.ok) throw new ApiError(ErrorBody.parse(body));
  return schema.parse(body);           // 계약 위반은 여기서 드러난다
}
```

- 데이터 훅은 TanStack Query를 쓴다(`useScrims`, `useScrim(id)`, `useJoinScrim` …). 엔드포인트 하나당 훅 하나, 이름은 shared 스키마 이름과 맞춘다.
- 목록 응답은 `{ items, next_cursor }` 객체다. 배열로 받지 않는다 — `useInfiniteQuery`로 처리한다.
- 서버 컴포넌트에서 첫 데이터를 받을 때도 같은 `api()`를 쓴다.
- `ApiError.code`로 사용자 문구를 분기한다(`SCRIM_FULL` → "정원이 찼어요. 대기열에 등록됐습니다" 등). 문구 표는 `lib/errors.ts` 한 곳에 둔다.

## 3. 시각 규칙

- 다크 테마 기본. 색은 CSS 변수 토큰(shadcn 테마)으로만 지정한다.
- 게임별 색·아이콘은 하드코딩하지 않고 게임 코드 → 메타 매핑(`lib/games.ts`)에서 가져온다. 새 게임이 행 추가만으로 표시되게 하기 위해서다(설계 원칙 3).
- 티어 표기는 아이콘 + 텍스트를 함께 쓴다. 색만으로 구분하지 않는다.
- 데스크톱 우선, `md` 미만에서 사이드바를 하단 탭 5개(홈, 내전, 랭킹, 프로필, 더보기)로 바꾼다.
- 차트(Recharts): 레이팅 추이(선), 티어 분포(막대), 활동량(막대/히트맵). 차트를 만들기 전에 `dataviz` 스킬을 참고한다.

## 4. 화면별 필수 상태

| 화면 | 반드시 다룰 상태 |
| --- | --- |
| 내전 상세 | recruiting / full(대기열 안내) / playing / finished / cancelled, 내가 방장인지, 내가 참가·대기·미참가인지, 결과 승인 대기 |
| 팀 밸런스 | 상위 3안 비교(팀 합계, 차이, 포지션 충족) → 선택 → 수동 조정 |
| 랭킹 | 탭·기간 전환, ELO는 5경기 미만 미노출 안내, 내 순위 고정 표시 |
| 프로필·설정 | 연동 안 됨 / 확인 대기 / 스팀 비공개(설정 안내) / 동기화 실패(마지막 갱신 시각) |
| 공통 | 로딩 스켈레톤, 빈 상태 문구, 오류 재시도 |

외부 데이터 옆에는 항상 "N분 전 갱신"을 표시한다(`synced_at`).

## 5. 검증

- `pnpm --filter web typecheck && pnpm --filter web build`
- 화면을 마치면 `run` 스킬이나 브라우저로 실제 렌더링을 확인하고, 데스크톱·모바일 폭 스크린샷을 보고서에 첨부할 수 있으면 첨부한다.
