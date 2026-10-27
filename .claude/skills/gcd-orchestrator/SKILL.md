---
name: gcd-orchestrator
description: "게임 커뮤니티 대시보드(롤·롤체·스팀 내전/랭킹 웹) 개발을 조율한다. '기능 구현해줘', '{슬라이스} 개발 시작', '다음 단계 진행', '내전/랭킹/프로필/계정 연동/봇 API 만들어줘', '프로젝트 세팅' 같은 개발 요청에 사용하며, 결과 수정, QA 지적 반영, 특정 모듈만 다시, 재실행, 업데이트, 보완, 이전 결과 개선 같은 후속 요청에도 사용한다. 단순 질문이나 한 파일 수준의 작은 수정은 직접 처리한다."
---

# 게임 커뮤니티 대시보드 개발 오케스트레이터

명세: 저장소 루트의 `게임 커뮤니티 대시보드 개발 문서.md` (이하 "문서"). 모든 에이전트는 이 문서를 유일한 요구사항 출처로 쓴다.

## 실행 모드: 혼합

| 단계 | 실행 모드 | 이유 |
| --- | --- | --- |
| 1. 슬라이스 확정 | 메인 직접 | 범위 판단은 사용자와 대화하며 정한다 |
| 2. 계약 설계 | 서브에이전트 위임 (`architect`) | 결과(계약)만 한 번 받으면 된다 |
| 3. 구현·QA | 지속형 에이전트 협업 | QA 지적을 같은 구현자에게 돌려보내 맥락을 유지한 채 고치게 한다 |
| 4. 통합 검증·보고 | 메인 직접 + `qa-verifier` | 전체 빌드·교차 대조 |

## 에이전트 구성

| 이름 | `subagent_type` | 스킬 | 산출물 |
| --- | --- | --- | --- |
| architect | architect | api-contract | `packages/shared`, `schema.prisma`, `_workspace/01_architect_contract.md` |
| backend | backend-dev | nestjs-backend, api-contract | `apps/api/src/modules/**`, `_workspace/02_backend-dev_{module}.md` |
| logic | domain-logic-dev | domain-logic | `packages/core/**`, `_workspace/02_domain-logic-dev_report.md` |
| integration | integration-dev | external-api-integration | `apps/api/src/{integrations,jobs}/**`, `_workspace/02_integration-dev_report.md` |
| frontend | frontend-dev | nextjs-dashboard-ui, api-contract | `apps/web/**`, `_workspace/02_frontend-dev_{screen}.md` |
| qa | qa-verifier | qa-boundary-check | `_workspace/03_qa-verifier_{target}.md` |

슬라이스에 필요한 구현자만 실행한다. 기본 동시 실행은 구현자 최대 3명 + qa 1명.

## 슬라이스 목록 (기본 순서)

문서 10장 로드맵의 단계별 상세는 문서에 그림으로만 있어 읽을 수 없다. 아래는 문서 2장 우선순위와 의존 관계로 정한 기본 순서이며, 사용자가 다른 순서를 정하면 따른다.

| ID | 슬라이스 | 문서 근거 | 구현자 |
| --- | --- | --- | --- |
| S0 | 골격: 모노레포, docker compose, **전체** Prisma 스키마(봇용 테이블 포함), 게임 시드, 가입·로그인, 공통 레이아웃 | 4·5장, 10장 지침 | architect → backend, frontend |
| S1 | 게임 계정 연동·소유 확인, 티어 동기화, 프로필·설정 화면 | 2장 계정·프로필, 9장 | integration, backend, frontend |
| S2 | 내전 모집·참가·대기열·노쇼 제한, 목록·작성·상세 화면 | 2장 내전, 7-4 | logic, backend, frontend |
| S3 | 팀 자동 밸런스, 결과 입력·승인, ELO 반영, 레이팅 그래프 | 7-1, 7-2 | logic, backend, frontend |
| S4 | 티어·ELO 랭킹, 랭킹 캐시 작업, 홈 대시보드 요약 | 7-3, 8장 | logic, integration, backend, frontend |
| S5 (P1) | 봇 API(연동 코드, 활동 수신), 활동·플레이타임 랭킹, 스팀 플레이타임 | 6장 봇, 9장 | integration, backend, frontend |
| S6 (P1) | 관리자 도구, 패치노트·이벤트 | 2장 운영·정보 | backend, frontend |

## 작업 절차

### 0단계: 기존 작업 확인

1. `_workspace/`와 `_workspace/progress.md`(완료 슬라이스 기록)를 확인한다.
   - 없음 → S0부터 시작(사용자가 지정한 슬라이스가 있으면 그 슬라이스의 선행 슬라이스 완료 여부부터 확인).
   - 있고 "QA 지적 반영", "{모듈}만 다시" 같은 부분 요청 → 해당 구현자만 이전 보고서·QA 보고서 경로와 함께 실행하고 3단계의 수정 루프로 들어간다.
   - 있고 새 슬라이스 요청 → 직전 슬라이스 작업 파일을 `_workspace/{슬라이스ID}/`로 옮기고 새로 시작한다. `progress.md`는 그대로 둔다.
2. 코드 상태를 확인한다: `git status`, `pnpm -r typecheck` 가능 여부.

### 1단계: 슬라이스 확정 (메인)

1. 위 표에서 대상 슬라이스를 고르고, 문서 2장에서 해당 행을 뽑아 `_workspace/00_input/slice.md`에 적는다(포함/제외 기능, 선행 조건).
2. 범위가 모호하거나 문서에 없는 결정(예: 소셜 로그인 제공자)이 필요하면 사용자에게 묻는다. 기본값으로 진행할 수 있으면 진행하고 보고서에 기본값을 적는다.

### 2단계: 계약 설계 (서브에이전트)

`Agent(subagent_type: "architect", prompt: "slice.md 경로 + 문서 경로 + 기존 계약 경로(있으면)")`

완료 후 메인이 계약 문서를 읽고 확인한다:
- 「확인 필요」 항목이 있으면 사용자에게 묻고 결정을 계약 문서에 반영시킨 뒤 진행한다.
- 「담당 배정」에서 3단계에 실행할 구현자를 정한다.

### 3단계: 구현·QA (지속형 에이전트)

1. 한 메시지에서 필요한 구현자와 qa를 이름을 붙여 병렬 실행한다.
   - `Agent(name: "logic", subagent_type: "domain-logic-dev", prompt: "계약 경로, 담당 작업, 산출 경로, 모듈 완료마다 리더에게 보고")`
   - 같은 방식으로 backend / integration / frontend / qa
2. 작업을 등록하고 의존 관계를 건다. 일반적인 순서: `logic`(core 함수) → `backend`(core 호출) ; `integration` → `backend`(서비스 주입) ; `frontend`는 계약만으로 목 데이터로 먼저 시작 → backend 완료 후 실제 API 연결.
3. **모듈 단위 QA**: 구현자가 모듈·화면 완료를 보고하면 즉시 `SendMessage({to: "qa"}, "{target} 검증. 보고서: {경로}")`. 전체 완료까지 기다리지 않는다.
4. **수정 루프**: qa 판정이 `fail`이면 결함 목록을 해당 구현자에게 `SendMessage`로 전달 → 수정 보고 → qa 재검증(`_r2`). **대상당 최대 3회.** 3회 후에도 `fail`이면 남은 결함을 보고서에 남기고 사용자에게 알린다.
5. 계약 변경 요청이 오면 메인이 판단해 architect를 다시 호출(서브에이전트)하고, 변경된 계약 경로를 관련 구현자 모두에게 알린다.

### 4단계: 동결과 통합 검증

1. 모든 작업 완료 확인 후 구현자들에게 "슬라이스 산출물 동결. 이후 수정은 리더 지시로만" 알린다.
2. `qa`에게 슬라이스 전체 교차 대조(qa-boundary-check 2절 「교차 대조」 「명세 대조」)를 요청한다.
3. 메인이 직접 `pnpm -r typecheck && pnpm -r test`를 실행해 결과를 확인한다. qa 보고만 믿고 통과라고 쓰지 않는다.

### 5단계: 마무리

1. `_workspace/progress.md`에 슬라이스 ID, 날짜, 판정, 남은 결함, [해석]·기본값 결정 목록을 추가한다.
2. 사용자에게 보고: 구현된 기능(문서 2장 행 기준), 테스트 결과, 남은 결함, 사용자 확인이 필요한 결정, 다음 슬라이스 제안.
3. 커밋은 사용자가 요청할 때만 한다.

## 데이터 전달

| 방법 | 용도 |
| --- | --- |
| 파일 `_workspace/{phase}_{agent}_{artifact}.md` | 계약, 구현 보고서, QA 보고서 (사후 확인용으로 남긴다) |
| 코드 `packages/shared` | 실제 계약 — 문서보다 코드가 우선 |
| SendMessage | 완료 알림, QA 결함 전달, 계약 변경 공지 |
| TaskCreate/TaskUpdate | 모듈별 진행 상태와 의존 관계 |

## 오류 처리

| 상황 | 대응 |
| --- | --- |
| 구현자 무응답 | SendMessage로 상태 확인 → 다시 지시 → 그래도 실패하면 같은 유형을 새 이름(`backend2`)으로 실행하고 이전 보고서 경로를 넘긴다 |
| 사용량 한도·인증 만료·권한 거부 | 재시도하지 않는다. 부분 산출물을 직접 열어 진행 범위를 확인하고 `_workspace/blocked.md`에 기록 후 사용자에게 보고(한도면 풀리는 시각 포함) |
| DB·Docker 미기동 | 구현자가 `docker compose up -d`를 시도. 불가하면 해당 테스트를 "미실행"으로 표시하고 사용자에게 Docker 실행을 요청 |
| Riot/Steam 키 없음 | fixture 기반 테스트로 진행하고, 실제 연동 확인은 "키 필요"로 보고 |
| 구현자 간 계약 충돌 | 코드 수정 전에 architect에게 계약 결정을 맡긴다. 양쪽 주장을 계약 문서 「결정 사항」에 남긴다 |
| QA 3회 실패 | 남은 결함을 지우지 않고 progress.md와 보고서에 남긴다 |
| 절반 이상 에이전트 실패 | 중단하고 사용자에게 계속할지 묻는다 |

멈춘 에이전트의 빈 곳을 메인이 메울 때는 직접 확인한 사실(파일 존재, 테스트 출력)만 반영하고, 에이전트의 판단을 추측해 보고서에 쓰지 않는다.

## 테스트 시나리오

### 정상 흐름 — "내전 모집 기능 만들어줘"
1. 0단계: `progress.md`에 S0 완료 확인 → S2로 확정, `slice.md` 작성.
2. architect가 scrims 엔드포인트 5개, 상태 전이 맵, `isScrimBanned` 시그니처를 계약에 적는다.
3. logic·backend·frontend·qa 실행. logic의 penalty 완료 → qa pass. backend scrims 모듈 완료 → qa가 마지막 자리 동시 참가 테스트 누락 지적(fail) → backend 수정 → `_r2` pass. frontend 상세 화면 → qa pass.
4. 교차 대조 표에서 엔드포인트 5 ↔ 훅 5 일치, 메인이 전체 테스트 통과 확인.
5. progress.md에 S2 기록, 사용자에게 보고하고 S3 제안.

### 오류 흐름 — 외부 키 없음 + 구현자 중단
1. S1 실행 중 `RIOT_API_KEY`가 없어 integration이 실제 호출 확인을 못 한다 → fixture 테스트로 진행, 보고서에 "실연동 미확인".
2. frontend가 응답 없이 멈춤 → SendMessage 재지시 실패 → `frontend2`를 실행해 `_workspace/02_frontend-dev_settings.md`를 넘겨 이어서 작업.
3. 최종 보고에 "라이엇 실연동 미확인(키 필요)", "settings 화면 frontend2가 재작업"을 명시.
