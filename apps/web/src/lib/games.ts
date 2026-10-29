import type { GameCode, GameProvider, LolPosition } from '@gcd/shared';

/**
 * 게임·제공자 코드 → 표시 메타(nextjs-dashboard-ui 3절). 색은 토큰 유틸리티 클래스로만.
 * 새 게임은 여기 한 줄을 더하면 화면에 나온다(설계 원칙 3).
 */
export const GAME_META: Record<GameCode, { short: string; name: string }> = {
  lol: { short: '롤', name: '리그 오브 레전드' },
  tft: { short: '롤체', name: '전략적 팀 전투' },
  steam: { short: '스팀', name: '스팀 게임' },
};

export const PROVIDER_META: Record<
  GameProvider,
  { label: string; mark: string; tile: string; chip: string; dot: string }
> = {
  riot: {
    label: '라이엇',
    mark: 'RIOT',
    tile: 'bg-cyan/14 text-cyan-ink',
    chip: 'border-cyan/25 bg-cyan/8 text-cyan-ink-2',
    dot: 'bg-cyan',
  },
  steam: {
    label: '스팀',
    mark: 'STEAM',
    tile: 'bg-orange/14 text-orange-ink',
    chip: 'border-cyan/25 bg-cyan/8 text-cyan-ink-2',
    dot: 'bg-cyan',
  },
};

/** 롤 포지션 표기. 순서는 shared LolPosition과 같다 */
export const POSITION_META: Record<LolPosition, { ko: string; banner: string }> = {
  top: { ko: '탑', banner: 'TOP LANER' },
  jungle: { ko: '정글', banner: 'JUNGLER' },
  mid: { ko: '미드', banner: 'MID LANER' },
  bot: { ko: '원딜', banner: 'BOT LANER' },
  support: { ko: '서포터', banner: 'SUPPORT' },
};
