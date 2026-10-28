import { z } from 'zod';

/**
 * 시드된 games.code. 문서 설계 원칙 3: 게임은 데이터다.
 * 화면·서버 분기는 코드 문자열 비교 대신 games 행의 속성(has_positions, has_teams, positions)으로 한다.
 * 새 게임 추가 = GAME_SEED에 행 1개 + 이 enum에 코드 1개 추가(+ 시드 재실행).
 */
export const GameCode = z.enum(['lol', 'tft', 'steam']);
export type GameCode = z.infer<typeof GameCode>;

export type GameSeed = {
  code: GameCode;
  name: string;
  /** 내전 참가 시 포지션 선택이 있는가(문서 5장 games.has_positions) */
  has_positions: boolean;
  /** 두 팀으로 나누는가. false면 개인 순위로 레이팅 갱신(문서 7-2 마지막 문단, 롤체) */
  has_teams: boolean;
  /** 선택 가능한 포지션 코드(순서 = 화면 표시 순서). has_positions=false면 빈 배열 */
  positions: string[];
  /** 필터·탭 표시 순서 */
  sort_order: number;
};

/** games 테이블 시드. apps/api/prisma/seed.ts가 이 값으로 upsert(code 기준)한다. */
export const GAME_SEED: readonly GameSeed[] = [
  {
    code: 'lol',
    name: '리그 오브 레전드',
    has_positions: true,
    has_teams: true,
    positions: ['top', 'jungle', 'mid', 'bot', 'support'],
    sort_order: 1,
  },
  {
    code: 'tft',
    name: '전략적 팀 전투',
    has_positions: false,
    has_teams: false,
    positions: [],
    sort_order: 2,
  },
  {
    code: 'steam',
    name: '스팀 게임',
    has_positions: false,
    has_teams: true,
    positions: [],
    sort_order: 3,
  },
];
