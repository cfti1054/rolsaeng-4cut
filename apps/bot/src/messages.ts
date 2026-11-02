import type {
  BotPendingNotice,
  BotPendingPatchNote,
  BotRankingUnit,
  BotUpcomingScrim,
  GetBotRankingResponse,
  GetBotUpcomingScrimsResponse,
} from '@gcd/shared';
import { formatKstClock } from './time';

export type OutboundEmbed = {
  title: string;
  description: string;
  url?: string;
};

const EMBED_DESCRIPTION_MAX = 4000;
const EMBED_TITLE_MAX = 256;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatDuration(sec: number): string {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (hours <= 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

function formatValue(unit: BotRankingUnit, value: number): string {
  if (unit === 'tier_score') return `${value}점`;
  if (unit === 'seconds') return formatDuration(value);
  if (unit === 'minutes') return `${value}분`;
  return String(value);
}

function gameLabel(code: string | null): string {
  if (code === 'lol') return '롤';
  if (code === 'tft') return '롤체';
  if (code === 'steam') return '스팀';
  if (code === 'other') return '기타';
  return '게임';
}

export function formatRanking(res: GetBotRankingResponse): OutboundEmbed {
  let title = '랭킹';
  if (res.type === 'tier') title = `티어 랭킹 · ${gameLabel(res.context.game)}`;
  else if (res.type === 'elo') title = `내전 ELO · ${gameLabel(res.context.game)}`;
  else if (res.type === 'activity') title = `활동 랭킹 · ${res.context.period === 'month' ? '이번 달' : '이번 주'}`;
  else {
    const app = res.context.app?.name ?? (res.context.app ? String(res.context.app.app_id) : '스팀');
    title = `플레이타임 · ${app}`;
  }
  const lines = res.items.map((item) => {
    const who = item.user.discord_id ? `<@${item.user.discord_id}>` : item.user.nickname;
    const detail = item.detail ? ` · ${item.detail}` : '';
    return `${item.rank}. ${who} — ${formatValue(res.unit, item.value)}${detail}`;
  });
  let description = lines.length > 0 ? lines.join('\n') : '표시할 랭킹이 없습니다.';
  if (res.stale) description += '\n\n집계 시각이 오래되었습니다.';
  return { title: truncate(title, EMBED_TITLE_MAX), description: truncate(description, EMBED_DESCRIPTION_MAX), url: res.web_url };
}

export function formatUpcoming(res: GetBotUpcomingScrimsResponse, withinMin: number): OutboundEmbed {
  const title = `곧 시작하는 내전 (${withinMin}분 이내)`;
  if (res.items.length === 0) {
    return { title, description: `${withinMin}분 안에 시작하는 내전이 없습니다.` };
  }
  const description = res.items
    .map((scrim) => {
      const wait = scrim.waitlist_count > 0 ? ` · 대기 ${scrim.waitlist_count}` : '';
      return (
        `• ${scrim.title}\n` +
        `  ${scrim.game.name} · ${formatKstClock(new Date(scrim.scheduled_at))} · ${scrim.joined_count}/${scrim.capacity}${wait}\n` +
        `  ${scrim.url}`
      );
    })
    .join('\n');
  return { title, description: truncate(description, EMBED_DESCRIPTION_MAX) };
}

export function formatScrimDm(scrim: BotUpcomingScrim): OutboundEmbed {
  const wait = scrim.waitlist_count > 0 ? ` · 대기 ${scrim.waitlist_count}` : '';
  return {
    title: '참가한 내전이 곧 시작해요',
    description: truncate(
      `${scrim.title}\n${scrim.game.name} · ${formatKstClock(new Date(scrim.scheduled_at))} · ${scrim.joined_count}/${scrim.capacity}${wait}\n${scrim.url}`,
      EMBED_DESCRIPTION_MAX,
    ),
    url: scrim.url,
  };
}

export function formatNotice(notice: BotPendingNotice): OutboundEmbed {
  return {
    title: truncate(notice.title, EMBED_TITLE_MAX),
    description: truncate(notice.body, EMBED_DESCRIPTION_MAX),
    url: notice.web_url,
  };
}

export function formatPatchNote(note: BotPendingPatchNote): OutboundEmbed {
  const head = note.version ? `${note.game.name} ${note.version}` : note.game.name;
  const lines = [head, note.summary];
  if (note.url) lines.push(note.url);
  return {
    title: truncate(note.title, EMBED_TITLE_MAX),
    description: truncate(lines.join('\n'), EMBED_DESCRIPTION_MAX),
    url: note.web_url,
  };
}
