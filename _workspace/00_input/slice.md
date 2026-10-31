# 슬라이스 S5 (P1) — 봇 API, 활동·플레이타임 랭킹, 스팀 플레이타임

명세: `게임 커뮤니티 대시보드 개발 문서.md` (이하 "문서"). 6장 봇 API, 7-3 랭킹 집계, 9장 캐싱.
선행: S0–S4 완료(qa 브랜치 92370dd까지). 기존 계약은 `_workspace/S0..S4/01_architect_contract.md`(D1–D201). 기존 결정을 깨지 않는다. 깨야 하면 이유를 적는다.
목업: `_workspace/00_input/mockup/Rankings.dc.html`(활동·플레이타임 탭), `Main.dc.html`·`MobileHome.dc.html`(음성 접속 인원·이번 주 활동 멤버), `Settings.dc.html`(디스코드 연동), `Admin.dc.html`(API 키가 있으면).

## 포함

| 영역 | 내용 | 근거 |
| --- | --- | --- |
| 봇 인증 | `X-API-Key` 가드. `api_keys`는 해시만 보관, scope 검사, `last_used_at` 갱신. 키 발급 수단(시드 또는 CLI 스크립트, 관리자 화면은 S6)은 architect가 정함 | 문서 4·6장 |
| 연동 | 웹에서 일회용 디스코드 연동 코드 발급(만료·재발급·1회용), `POST /bot/link`로 `users.discord_id` 채움. 중복 연결·이미 연결된 ID·만료 코드 오류 처리. 설정 화면에 연동 상태·코드 표시 | 문서 6장 |
| 봇 API | `POST /bot/activity`(일괄, `idempotency_key` 필수, 중복은 무시하고 건별 결과 반환, 미연동 discord_id 처리 정책), `GET /bot/users/lookup`, `GET /bot/scrims/upcoming`, `GET /bot/rankings/{type}` | 문서 6장 |
| 탈퇴 | 봇 탈퇴(서버 퇴장) 이벤트 수신 → `users.left_at` 추가, `rankableUserWhere`만 변경(S4 Q4 결정). 재입장 처리 | S4 계약 Q4 |
| 랭킹 | `GET /rankings/activity?period=`(주간·월간, KST 월요일 시작·월 단위, `duration_sec` 합계), `GET /rankings/playtime?app_id=`(스팀 게임별 누적 분). 기존 5분 랭킹 캐시와 같은 경로 재사용 | 문서 7-3, 6장 |
| 스팀 | S1의 스팀 클라이언트로 하루 1회 새벽 배치 플레이타임 동기화(`steam_playtime`). 비공개 프로필 실패 사유 표시. 수동 새로고침 횟수 제한은 기존 규칙 재사용 | 문서 9장 |
| 홈 | 음성 채널 접속 인원, 이번 주 활동 멤버 카드를 요약 응답에 추가(봇 데이터 없으면 필드 상태로 구분, 가짜 숫자 금지). 「지금 플레이 중」은 데이터가 충분할 때만 | 문서 2장 정보, 목업 Main |
| 화면 | `/rankings` 활동·플레이타임 탭 활성화(기간·게임 선택, 갱신 시각, 빈·오류 상태), 설정의 디스코드 연동 영역 | 문서 8장 |

## 제외

- 관리자 화면에서 API 키 관리, 패치노트·이벤트 → S6
- 실제 디스코드 봇 프로세스 구현(이 저장소는 API까지. 봇 호출 예시는 계약 문서에 둔다)
- 스팀 할인 정보(데이터 출처 미정), 업적·포인트(P2)

## 메인이 정한 기본값 (사용자 확인 전, 보고서에 명시)

1. 미연동 `discord_id` 이벤트는 저장하지 않고 건별 결과로 `unlinked`를 돌려준다(나중에 연동해도 소급 안 함).
2. 활동 `type`은 문서 예시의 voice 외에 chat·play를 받고, 랭킹 집계는 voice+play의 `duration_sec`만 쓴다. 채팅 정책은 architect가 정해 계약에 적는다.
3. 연동 코드는 15분 만료, 사용자당 유효 코드 1개(재발급 시 이전 코드 무효).
4. 이벤트 한 요청 최대 건수와 `started_at` 허용 범위(미래·과거 한도)는 architect가 정한다.

## 환경 제약 (이전과 동일)

- `corepack pnpm`, Node 20.11. 이 PC에는 Docker·PostgreSQL·Redis 없음 → DB 통합 테스트는 작성만 하고 미실행. 마이그레이션은 prisma migrate diff로 일치 확인.
- 커밋은 사용자가 직접 한다. 에이전트는 커밋하지 않는다.
- Riot/Steam 키 없음 → fixture 테스트, 실연동은 「키 필요」로 보고.
- 새 환경 변수는 `.env.example`과 계약 환경 변수 표에 반영.
- api와 web은 같은 커밋으로 배포(요약 응답 필드 추가 시 web이 필수로 읽으면 순서 주의).
