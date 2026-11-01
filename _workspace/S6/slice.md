# 슬라이스 S6 (P1) — 관리자 도구, 패치노트·이벤트

명세: `게임 커뮤니티 대시보드 개발 문서.md` (이하 "문서"). 2장 정보·운영 행, 5장 데이터 모델, 6장 `/patch-notes`·`/events`, 8장 `/news`·`/admin`, 9장.
선행: S0–S5 완료(qa 브랜치 775507c까지). 기존 계약 `_workspace/S0..S5/01_architect_contract.md`(D1–D240). 기존 결정을 깨지 않는다. 깨야 하면 이유를 적는다.
목업: `_workspace/00_input/mockup/Admin.dc.html`(승인 대기, 노쇼 표시, 공지 작성, 멤버 관리). 패치노트·이벤트 목업은 없다 → 기존 화면 토큰·카드 패턴으로 설계하고 보고서에 「목업 없음」을 적는다.

## 이미 있는 것 (다시 만들지 않는다)

- 결과 승인·반려 API: `POST /scrims/:id/result/approve|reject`(S3, 운영진, 자기 제출 제외), 노쇼 표시 `POST /scrims/:id/players/:userId/no-show`(S2)
- `users.role`(member|admin), `RolesGuard`, `@Roles`, `ADMIN_DISCORD_IDS` 환경 변수로 운영진 지정
- `notices` 표(S0 전체 스키마: title, body, author_id, notify_discord, discord_notified_at) — 엔드포인트·화면 없음
- `api_keys`와 CLI(`pnpm --filter api api-key`, S5), 활동 랭킹·봇 API(S5)
- 사이드바 admin 링크와 `/admin` 자리표시 화면(`PlaceholderPage`), 시즌 자동 생성·종료 처리(S3·S4)

## 포함

| 영역 | 내용 | 근거 |
| --- | --- | --- |
| 관리자 화면 | `/admin`: 통계 카드(회원 수, 이번 주 내전, 승인 대기 건수, 랭킹 캐시 갱신 시각 등 목업 기준), 결과 승인 대기 목록(승인·반려, 이의 제기 표시), 노쇼 표시(내전 선택 → 참가자 체크 → 저장, 30일 3회면 제한 안내), 공지 작성, 멤버 관리 표 | 문서 2장 운영, 목업 Admin |
| 승인 큐 API | 승인 대기 결과 목록(운영진 전용, 페이지네이션), 이의 제기(분쟁) 처리 흐름이 S3에 있으면 연결, 없으면 계약에 「S3 상태 전이 기준 처리」를 적는다 | 문서 2장 「결과 분쟁 처리」 |
| 승인 되돌리기 | 승인된 결과를 되돌려 rating_history를 역반영(S4 계약이 S6로 미룸). ELO 정합성(이후 경기 순서, 시즌 경계, 뱃지·standings)이 복잡하면 architect가 안전한 범위(예: 직후 마지막 승인만, 시즌 안에서만)를 정해 계약에 적고, 불가하면 「제외」로 이유와 함께 확정 | S4 계약 |
| 공지 | `notices` CRUD(운영진 작성·수정·삭제), 공개 조회 `GET /notices`(홈·`/news`에 최신 노출), `notify_discord` 표시 시 봇이 가져가 전송하도록 봇 엔드포인트 추가(예: `GET /bot/notices/pending`, `POST /bot/notices/:id/delivered`, scope 추가, 멱등) | 목업 NOTICE, 문서 6장 |
| 멤버 관리 | 회원 목록(검색·정렬·페이지네이션): 닉네임, 역할, 디스코드 연동, 내전 수, 최근 30일 노쇼, 상태(서버 잔류/나감, 참가 제한 중). 역할 변경(member↔admin)은 운영진만, 마지막 admin 강등 방지, 자기 자신 강등 정책은 architect가 정함. 기록 변경은 감사 로그 | 목업 MEMBERS |
| 패치노트·이벤트 | 새 표 `patch_notes`(게임, 버전/제목, 요약, 원문 링크, 게시일), `events`(게임, 제목, 시작·종료일, 링크, 설명). 데이터는 운영진이 직접 입력(외부 자동 수집 없음, 출처·약관 이슈). `GET /patch-notes`, `GET /events`(기간·게임 필터, 페이지네이션), 운영진 CRUD | 문서 2장 정보, 6장 |
| 정보 화면 | `/news`(문서 8장): 패치노트 목록, 이벤트 캘린더(월 이동, 게임 필터), 공지. 홈 「패치 소식」 카드에 최신 패치·공지·다가오는 이벤트. 사이드바·모바일 탭에 정보 링크. 패치 알림 설정 `users.notify_patch`가 이미 있으면 설정 화면과 연결 | 문서 8장 |
| API 키 관리 | 운영진이 웹에서 봇 API 키 발급·목록·폐기(S5가 CLI로만 둔 것). 원문은 발급 응답에서 1회만 표시, 목록에는 prefix·scope·마지막 사용·폐기 여부 | S5 계약 D221 |
| 시즌 관리 | 현재·다가오는 시즌 조회와 수동 생성·수정(S4가 S6으로 미룸). 진행 중 시즌 종료 시각 변경은 standings·종료 작업과 충돌하므로 architect가 허용 범위를 정한다(예: 아직 시작 안 한 시즌만 수정) | S4 계약 |
| 감사 | 운영진 행위(역할 변경, 공지 삭제, 키 폐기, 시즌 수정, 승인 되돌리기)를 `admin_audit_logs`에 기록하고 `/admin`에서 최근 목록 조회 | 운영 안전 |

## 제외

- 스팀 할인 정보·공통 게임 추천(문서가 데이터 출처 미정이라 명시, P1 후반)
- 외부 자동 수집(라이엇 패치노트 크롤링 등), 업적·포인트·토너먼트·하이라이트(P2)
- 디스코드 봇 프로세스 자체 구현(공지 전송은 봇이 가져가는 API까지)
- 회원 삭제·차단(필요하면 「확인 필요」에 적기만 한다)

## 메인이 정한 기본값 (사용자 확인 전, 보고서에 명시)

1. 패치노트·이벤트는 운영진 수기 입력. 링크는 외부 URL로 열고 서버가 내용을 가져가지 않는다.
2. 공지는 삭제 시 영구 삭제하고 감사 로그에 남긴다(소프트 삭제 없음).
3. 관리자 지정은 기존 `ADMIN_DISCORD_IDS`(로그인 시 부여)와 웹의 역할 변경을 함께 쓴다. 환경 변수로 지정된 admin을 웹에서 강등하면 다음 로그인에 다시 부여되는지 architect가 정책을 정하고 화면에 안내한다.
4. 승인 되돌리기는 가능한 가장 좁은 안전 범위로 시작한다(architect 결정).
5. 모든 `/admin` API는 `RolesGuard`로 막고, 비관리자는 403이다. 화면 권한 검사는 보조일 뿐이다.

## 환경 제약 (이전과 동일)

- Node: 이 PC 기본은 20.11이라 vitest 5가 안 돈다. 임시로 받은 Node 24를 쓴다: `export PATH=/private/tmp/claude-501/-Users-cfti1054-Documents-GitHub-rolsaeng-4cut/ecf7f0de-031c-49ed-9801-f3ea7a17127a/scratchpad/nodes/v24.22.2/bin:$PATH` 후 `corepack pnpm exec vitest run`(저장소 설정 그대로). npm 캐시 권한 문제로 `pnpm view`는 쓰지 않는다(레지스트리는 curl).
- Docker·PostgreSQL·Redis 없음 → DB 통합 테스트는 작성만 하고 미실행. 마이그레이션은 prisma migrate diff로 일치 확인(stdout만 비교, shadow DB 없음).
- 커밋은 사용자가 직접 한다. 에이전트는 커밋하지 않는다.
- 배포는 Railway(Dockerfile, Node 22.23.4 고정). 새 환경 변수가 생기면 `.env.example`과 계약 환경 변수 표에 반영. api와 web은 같은 커밋으로 배포.
- zod 4.6.7 사용(`z.record`는 키 스키마 명시, deprecated API는 기존 방식 유지).
