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

/**
 * 내전 화면용 게임 표시(목업 Scrims·ScrimNew·ScrimDetail). 색은 토큰 클래스만(hex 금지, D53).
 * - tag: 카드 배너 왼쪽 위 「LEAGUE · 5V5」, abbr: 작성 폼 게임 타일 글자, label: 필터·카드 이름
 * - dot: 필터 점·인원 칸 채움, ink: 배너 글자, banner: 카드 배너 배경, tile: 타일 배경 + 글자, fill: 배너 다각형(SVG fill)
 */
export const GAME_SCRIM_META: Record<
  GameCode,
  { label: string; tag: string; abbr: string; dot: string; ink: string; banner: string; tile: string; fill: string; stroke: string }
> = {
  lol: {
    label: '롤 협곡',
    tag: 'LEAGUE · 5V5',
    abbr: 'LoL',
    dot: 'bg-cyan',
    ink: 'text-cyan-ink',
    banner: 'bg-banner-lol',
    tile: 'bg-cyan/14 text-cyan-ink',
    fill: 'fill-cyan',
    stroke: 'stroke-cyan',
  },
  tft: {
    label: '롤체',
    tag: 'TFT · LOBBY',
    abbr: 'TFT',
    dot: 'bg-violet',
    ink: 'text-violet-ink',
    banner: 'bg-banner-tft',
    tile: 'bg-violet/14 text-violet-ink',
    fill: 'fill-violet',
    stroke: 'stroke-violet',
  },
  steam: {
    label: '스팀',
    tag: 'STEAM · SQUAD',
    abbr: 'STM',
    dot: 'bg-orange',
    ink: 'text-orange-ink',
    banner: 'bg-banner-steam',
    tile: 'bg-orange/14 text-orange-ink',
    fill: 'fill-orange',
    stroke: 'stroke-orange',
  },
};

/** 포지션 코드 → 한글(games.positions는 데이터라 모르는 코드는 그대로 보여 준다) */
export function positionLabel(code: string): string {
  return (POSITION_META as Record<string, { ko: string } | undefined>)[code]?.ko ?? code;
}

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
