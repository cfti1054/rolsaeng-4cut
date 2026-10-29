import { z } from 'zod';
import { paginated } from './common/pagination';
import { GameCode } from './constants/games';

// =============================================================================
// GET /games — 게임 목록(S2). 내전 작성 폼(게임 카드·정원 범위·포지션)과 목록 필터 탭이 쓴다.
// 게임은 데이터다(설계 원칙 3): 화면은 code 비교 대신 이 속성으로 분기한다.
// 계약: _workspace/01_architect_contract.md(S2) 4절
// =============================================================================

/**
 * 내전 정원 범위(방장 포함). 허용 값 = min, min+step, …, max(롤 2–10, 2명 단위).
 * min = max면 고정 정원 → 작성 폼은 조절 버튼을 숨긴다.
 */
export const GameCapacityRange = z.object({
  min: z.number().int().min(1),
  max: z.number().int().min(1),
  default: z.number().int().min(1),
  /** 정원 단위. 롤은 2(두 팀 같은 인원) */
  step: z.number().int().min(1),
  /** true면 정원이 꽉 차야 시작, false면 SCRIM_MIN_PLAYERS_TO_START(2)명 이상 */
  start_requires_full: z.boolean(),
});
export type GameCapacityRange = z.infer<typeof GameCapacityRange>;

/** games 1행(id는 노출하지 않는다 — 모든 API는 game code로 주고받는다) */
export const GameView = z.object({
  code: GameCode,
  name: z.string(),
  /** 참가 시 1지망·2지망 포지션을 고르는 게임인가 */
  has_positions: z.boolean(),
  /** 두 팀 대결인가(false = 개인 순위, 롤체) */
  has_teams: z.boolean(),
  /** 포지션 코드(표시 순서). has_positions=false면 [] */
  positions: z.array(z.string()),
  sort_order: z.number().int(),
  capacity: GameCapacityRange,
  /** true면 내전 작성 때 스팀 게임을 반드시 고른다(GET /steam-apps로 검색, D98) */
  requires_steam_app: z.boolean(),
});
export type GameView = z.infer<typeof GameView>;

/**
 * 200. 행이 몇 개뿐이라 커서 없이 전부 준다(next_cursor는 항상 null). sort_order 오름차순.
 * 목록 응답 형태를 하나로 고정하기 위해 paginated 모양을 그대로 쓴다(S0 3절).
 */
export const ListGamesResponse = paginated(GameView);
export type ListGamesResponse = z.infer<typeof ListGamesResponse>;
