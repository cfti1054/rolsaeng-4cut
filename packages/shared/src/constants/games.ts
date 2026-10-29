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
  /**
   * 내전 정원 범위(S2, D76). 방장 포함 인원. 허용 값 = capacity_min부터 capacity_step 간격으로 capacity_max까지.
   * 작성 폼 기본값은 capacity_default(허용 값 중 하나). 서버는 core isCapacityInRange로 검사한다.
   */
  capacity_min: number;
  capacity_max: number;
  capacity_default: number;
  capacity_step: number;
  /** true면 정원이 꽉 차야 시작(롤), false면 2명 이상이면 시작 */
  start_requires_full: boolean;
  /** true면 내전 작성 때 스팀 게임(app id)을 반드시 고른다(D98) */
  requires_steam_app: boolean;
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
    // 1:1–5:5. 두 팀 인원이 같도록 짝수만, 정한 정원이 꽉 차야 시작(D97)
    capacity_min: 2,
    capacity_max: 10,
    capacity_default: 10,
    capacity_step: 2,
    start_requires_full: true,
    requires_steam_app: false,
  },
  {
    code: 'tft',
    name: '전략적 팀 전투',
    has_positions: false,
    has_teams: false,
    positions: [],
    sort_order: 2,
    // 롤체 로비 최대 8인
    capacity_min: 2,
    capacity_max: 8,
    capacity_default: 8,
    capacity_step: 1,
    start_requires_full: false,
    requires_steam_app: false,
  },
  {
    code: 'steam',
    name: '스팀 게임',
    has_positions: false,
    has_teams: true,
    positions: [],
    sort_order: 3,
    // 스팀 게임은 게임마다 인원이 달라 범위를 넓게(목업 기본 8)
    capacity_min: 2,
    capacity_max: 16,
    capacity_default: 8,
    capacity_step: 1,
    start_requires_full: false,
    requires_steam_app: true,
  },
];

/**
 * 게임 → 연동 계정 제공자(S1, 결정 D36). 라이엇 ID 하나가 lol·tft 두 행이 된다(D25).
 * 연동·해제·동기화·대표 지정은 「같은 사용자 + 같은 external_id(라이엇 ID)」의 lol·tft 두 행을 함께 처리한다.
 */
export const GAME_PROVIDER_BY_CODE = {
  lol: 'riot',
  tft: 'riot',
  steam: 'steam',
} as const satisfies Record<GameCode, 'riot' | 'steam'>;

/** 제공자별로 함께 생성·삭제되는 게임 코드(표시 순서). */
export const GAME_CODES_BY_PROVIDER = {
  riot: ['lol', 'tft'],
  steam: ['steam'],
} as const satisfies Record<'riot' | 'steam', readonly GameCode[]>;
