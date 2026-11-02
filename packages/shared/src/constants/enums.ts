import { z } from 'zod';

/** users.role — 문서 5장 */
export const UserRole = z.enum(['member', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

/** scrims.status — 문서 5장 */
export const ScrimStatus = z.enum(['recruiting', 'full', 'playing', 'finished', 'cancelled']);
export type ScrimStatus = z.infer<typeof ScrimStatus>;

/** scrim_players.status — 문서 5장 */
export const ScrimPlayerStatus = z.enum(['joined', 'waitlist', 'cancelled', 'no_show']);
export type ScrimPlayerStatus = z.infer<typeof ScrimPlayerStatus>;

/**
 * scrims.cancel_reason (S2, 계약 S2 D80) — 모집글이 cancelled가 된 이유.
 * host: 방장 취소, admin: 운영진 취소, not_started: 시작 시각 + SCRIM_AUTO_CLOSE_AFTER_MIN 이 지나도
 * 시작 조건을 채우지 못해 자동 취소.
 */
export const ScrimCancelReason = z.enum(['host', 'admin', 'not_started']);
export type ScrimCancelReason = z.infer<typeof ScrimCancelReason>;

/**
 * scrim_players.team, scrim_results.winner_team. 값 `orange`는 DB enum·API 값으로 유지하고 화면에서만 「레드팀」·`RED`로 부른다(D174).
 */
export const ScrimTeam = z.enum(['blue', 'orange']);
export type ScrimTeam = z.infer<typeof ScrimTeam>;

/**
 * scrims.tft_mode. 롤체 작성 때만 쓴다. 다른 게임은 null.
 * double_up: 2인 팀 밸런스를 켤 수 있다. normal·ranked: 개인전, 밸런스 없음.
 */
export const TftMode = z.enum(['double_up', 'normal', 'ranked']);
export type TftMode = z.infer<typeof TftMode>;

export const TFT_MODE_LABEL: Record<TftMode, string> = {
  double_up: '더블업',
  normal: '일반',
  ranked: '랭크',
};

/** 롤체 모드별 정원(방장 포함). 게임 행 capacity와 별개로 작성·수정 검사가 이 값을 쓴다. */
export const TFT_MODE_CAPACITY: Record<TftMode, { min: number; max: number; step: number; default: number }> = {
  double_up: { min: 2, max: 8, step: 2, default: 8 },
  normal: { min: 2, max: 8, step: 1, default: 8 },
  ranked: { min: 2, max: 3, step: 1, default: 3 },
};

/**
 * scrims.lol_map. 롤 작성 때만 쓴다. 다른 게임은 null.
 * rift: 협곡(포지션). aram: 칼바람(포지션 없음, 팀은 그대로).
 * 이 필드 전에 만든 롤 내전은 null이고 화면은 협곡으로 본다.
 */
export const LolMap = z.enum(['rift', 'aram']);
export type LolMap = z.infer<typeof LolMap>;

export const LOL_MAP_LABEL: Record<LolMap, string> = {
  rift: '협곡',
  aram: '칼바람',
};

/**
 * scrims.lol_format. 롤·롤체 작성 때 쓴다. 스팀·기타는 null.
 * scrim: 내전. 팀 자동 밸런스와 ELO 반영을 켤 수 있다.
 * party: 인원 모집. 둘 다 저장하지 않는다.
 * 롤체 랭크는 항상 party. 이 필드 전에 만든 롤·롤체 글은 null이고, 랭크가 아니면 화면은 내전으로 본다.
 */
export const LolFormat = z.enum(['scrim', 'party']);
export type LolFormat = z.infer<typeof LolFormat>;

export const LOL_FORMAT_LABEL: Record<LolFormat, string> = {
  scrim: '내전',
  party: '인원 모집',
};

/**
 * scrim_results.status — 명세 공백 보완(slice.md 결정).
 * S6: reverted = 운영진이 승인을 되돌린 결과(레이팅 역반영, 계약 S6 6절). 활성 결과가 아니다(부분 고유 인덱스는 pending·approved만).
 */
export const ScrimResultStatus = z.enum(['pending', 'approved', 'rejected', 'reverted']);
export type ScrimResultStatus = z.infer<typeof ScrimResultStatus>;

/**
 * scrim_result_disputes.status — 명세 공백 보완(slice.md 결정).
 * S6 D281: 결과 이의 제기 기능은 제거됐다. DB enum·표는 S0 마이그레이션으로 운영 DB에 있을 수 있어 그대로 두고(DROP 안 함),
 * 앱 코드는 이 값을 읽거나 쓰지 않는다. 값 목록은 DB와 맞추는 기록용이다.
 */
export const DisputeStatus = z.enum(['open', 'resolved']);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

/** activity_logs.type — 문서 6장 봇 API: 음성·채팅·게임 플레이 */
export const ActivityType = z.enum(['voice', 'chat', 'play']);
export type ActivityType = z.infer<typeof ActivityType>;

/**
 * api_keys.scopes 값 — 봇 API(S5)에서 엔드포인트별로 검사(BOT_ENDPOINT_SCOPE, bot.ts).
 * S5에서 bot:members(서버 입장·퇴장), bot:presence(음성 접속·지금 플레이 중)를 추가했다. 컬럼이 text[]라 마이그레이션은 없다.
 * bot:link는 연동 코드 기능 제거로 없앴다(D237).
 * S6: bot:notices(공지 디스코드 전송 2개 엔드포인트), bot:patch-notes(패치노트 DM 2개 엔드포인트). scope는 리소스 단위(D255).
 */
export const ApiKeyScope = z.enum([
  'bot:activity',
  'bot:users:read',
  'bot:scrims:read',
  'bot:rankings:read',
  'bot:members',
  'bot:presence',
  'bot:notices',
  'bot:patch-notes',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

// ---- S1 게임 계정 연동·동기화 ----

/** 연동 계정 제공자. lol·tft는 라이엇 계정 하나를 공유한다(D25). 게임 → 제공자는 GAME_PROVIDER_BY_CODE */
export const GameProvider = z.enum(['riot', 'steam']);
export type GameProvider = z.infer<typeof GameProvider>;

/**
 * game_accounts.sync_state — 수동·연동 직후 동기화 진행 표시(계약 S1 6절).
 * idle: 대기 없음, queued: 수동/연동 직후 요청이 큐에 있음, running: 작업자가 실행 중.
 * 주기 작업(cron)과 프로필 조회로 생긴 전적 갱신은 queued를 거치지 않고 실행할 때만 running으로 바꾼다.
 */
export const GameAccountSyncState = z.enum(['idle', 'queued', 'running']);
export type GameAccountSyncState = z.infer<typeof GameAccountSyncState>;

/**
 * game_accounts.last_sync_error 값. 동기화는 비동기라 HTTP 오류가 아니라 이 코드로 기록·표시한다.
 * - STEAM_PROFILE_PRIVATE: GetOwnedGames 응답에 game_count가 없음(게임 세부 정보 비공개)
 * - ACCOUNT_NOT_FOUND: PUUID·스팀 ID로 더 이상 조회되지 않음(404)
 * - PROVIDER_AUTH_FAILED: 401/403(라이엇 개발 키 만료 등). 재시도하지 않는다
 * - PROVIDER_RATE_LIMITED: 429 대기를 최대 횟수만큼 반복해도 끝나지 않음
 * - PROVIDER_UNAVAILABLE: 5xx·타임아웃이 백오프 3회 후에도 계속됨
 * - PROVIDER_NOT_CONFIGURED: RIOT_API_KEY / STEAM_API_KEY 없음
 * - INTERNAL_ERROR: 그 밖의 예외(응답 형식 불일치 포함)
 */
export const GameAccountSyncError = z.enum([
  'STEAM_PROFILE_PRIVATE',
  'ACCOUNT_NOT_FOUND',
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_NOT_CONFIGURED',
  'INTERNAL_ERROR',
]);
export type GameAccountSyncError = z.infer<typeof GameAccountSyncError>;

/**
 * riot_link_verifications.status — 라이엇 소유 확인(프로필 아이콘 변경).
 * pending → verified(아이콘 일치) | expired(제한 시간 경과) | cancelled(사용자 취소·새 확인 시작으로 대체)
 */
export const RiotLinkVerificationStatus = z.enum(['pending', 'verified', 'expired', 'cancelled']);
export type RiotLinkVerificationStatus = z.infer<typeof RiotLinkVerificationStatus>;

// ---- S6 운영 ----

/**
 * admin_audit_logs.action — 운영진 쓰기 행위(계약 S6 10절). DB 컬럼은 text(값이 늘어도 마이그레이션 없음).
 * 결과 승인·반려·노쇼 표시는 각 표의 *_by·*_at 컬럼에 이미 남으므로 감사 로그에 넣지 않는다(D262).
 */
export const AdminAuditAction = z.enum([
  'member.role_change',
  'notice.create',
  'notice.update',
  'notice.delete',
  'patch_note.create',
  'patch_note.update',
  'patch_note.delete',
  'event.create',
  'event.update',
  'event.delete',
  'api_key.create',
  'api_key.revoke',
  'season.create',
  'season.update',
  'season.delete',
  'result.revert',
]);
export type AdminAuditAction = z.infer<typeof AdminAuditAction>;

/** admin_audit_logs.target_type. action 앞부분과 1:1(result.* → scrim_result, member.* → user) */
export const AdminAuditTargetType = z.enum([
  'user',
  'notice',
  'patch_note',
  'event',
  'api_key',
  'season',
  'scrim_result',
]);
export type AdminAuditTargetType = z.infer<typeof AdminAuditTargetType>;

/** action → target_type. 서버는 감사 행을 쓸 때 이 표로 target_type을 정한다 */
export const ADMIN_AUDIT_TARGET_BY_ACTION: Record<AdminAuditAction, AdminAuditTargetType> = {
  'member.role_change': 'user',
  'notice.create': 'notice',
  'notice.update': 'notice',
  'notice.delete': 'notice',
  'patch_note.create': 'patch_note',
  'patch_note.update': 'patch_note',
  'patch_note.delete': 'patch_note',
  'event.create': 'event',
  'event.update': 'event',
  'event.delete': 'event',
  'api_key.create': 'api_key',
  'api_key.revoke': 'api_key',
  'season.create': 'season',
  'season.update': 'season',
  'season.delete': 'season',
  'result.revert': 'scrim_result',
};
