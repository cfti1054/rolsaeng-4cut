# 닉네임 수정 · 기타 모집 계약

작성: 리더 (architect 사용량 한도로 서브에이전트 미실행). 결정 원문: `_workspace/00_input/slice-nickname-other.md`. 코드가 이 문서보다 우선한다.

## 닉네임

- 대상은 `users.nickname`. 라이엇 게임 이름·디스코드 사용자명은 바꾸지 않는다.
- 엔드포인트는 기존 `PATCH /me`. 확인 이후에도 닉네임을 바꾼다.
- 정규화(앞뒤·연속 공백), 2–50자, 한글·영문·숫자·밑줄·공백. 중복은 `NICKNAME_TAKEN`.
- 쿨다운·변경 이력·운영진 강제 개명 없음.
- 화면은 본인 프로필(`is_self`)만. 저장 후 본인 정보와 그 프로필을 다시 읽는다.

## 기타 게임

- `GameCode`에 `other`. 표시 이름 `기타`.
- `has_positions` `has_teams` `has_results` `requires_steam_app` `start_requires_full` 모두 false.
- 정원 2–16, 간격 1, 기본 8. 2명 이상이면 시작 가능.
- 계정 연동 대상 아님. `gameProvider('other')`는 null. 티어·ELO·플레이타임 랭킹·뱃지 점수·봇 티어 조회는 `other`를 거부한다.
- 모집글 필드 `custom_game_name`. 앞뒤 공백 제거, 1–40자. `other`에서만 필수. 다른 게임이 보내면 `VALIDATION_FAILED`.
- 모집 중 수정은 게임 코드를 바꾸지 않고 이름만 바꾼다.
- `appliedAutoBalance` false, `appliedRated` false. 포지션·팀·승패·자동 밸런스·ELO 없음.
- 목록 필터, 카드, 상세, 공유 문구, 캘린더에 「기타」와 입력한 이름이 나온다.

## 저장

- `scrims.custom_game_name` VARCHAR(40) nullable. 마이그레이션 `20261102120000_scrim_other_game`이 컬럼과 `games` 행 `other`를 넣는다.
