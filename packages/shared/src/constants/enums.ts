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

/** scrim_players.team, scrim_results.winner_team — 목업의 블루팀/오렌지팀 */
export const ScrimTeam = z.enum(['blue', 'orange']);
export type ScrimTeam = z.infer<typeof ScrimTeam>;

/** scrim_results.status — 명세 공백 보완(slice.md 결정) */
export const ScrimResultStatus = z.enum(['pending', 'approved', 'rejected']);
export type ScrimResultStatus = z.infer<typeof ScrimResultStatus>;

/** scrim_result_disputes.status — 명세 공백 보완(slice.md 결정) */
export const DisputeStatus = z.enum(['open', 'resolved']);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

/** activity_logs.type — 문서 6장 봇 API: 음성·채팅·게임 플레이 */
export const ActivityType = z.enum(['voice', 'chat', 'play']);
export type ActivityType = z.infer<typeof ActivityType>;

/** api_keys.scopes 값 — 봇 API(S5)에서 엔드포인트별로 검사 */
export const ApiKeyScope = z.enum([
  'bot:link',
  'bot:activity',
  'bot:users:read',
  'bot:scrims:read',
  'bot:rankings:read',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;
