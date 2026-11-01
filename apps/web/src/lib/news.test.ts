import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EventView } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { eventDateText, eventScheduleText, eventTimeText, gameFilterOptions, kstToday, monthGrid, newsDateBlock, parseMonth, patchNoteGameOptions, shiftMonth, weekBars } from './news';
import { routes } from './routes';

const ev = (id: string, starts_on: string, ends_on: string): EventView => ({
  id,
  game: null,
  title: id,
  description: null,
  url: null,
  starts_on,
  ends_on,
  start_time: null,
  end_time: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
});

describe('캘린더 월 격자(KST, 월요일 시작)', () => {
  it('2026-11: 10-26(월)부터 12-06(일)까지 6주', () => {
    const g = monthGrid('2026-11');
    expect(g.from).toBe('2026-10-26');
    expect(g.to).toBe('2026-12-06');
    expect(g.weeks).toHaveLength(6);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  });
  it('2027-02(28일, 월요일 시작): 4주', () => {
    expect(monthGrid('2027-02').weeks).toHaveLength(4);
  });
  it('오늘 = KST 날짜(UTC 15시 = 다음날)', () => {
    expect(kstToday(Date.parse('2026-10-31T15:00:00.000Z'))).toBe('2026-11-01');
    expect(kstToday(Date.parse('2026-10-31T14:59:59.999Z'))).toBe('2026-10-31');
  });
  it('달 이동·검사', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-11')).toBe('2026-11');
  });
  it('여러 날 이벤트는 주마다 잘라 막대로, 겹치면 다음 줄', () => {
    const week = monthGrid('2026-11').weeks[1]!; // 11-02 ~ 11-08
    const bars = weekBars(week, [ev('a', '2026-10-30', '2026-11-04'), ev('b', '2026-11-03', '2026-11-03'), ev('c', '2026-11-06', '2026-11-12'), ev('d', '2026-12-01', '2026-12-01')]);
    expect(bars.map((b) => [b.event.id, b.col, b.span, b.lane, b.fromPrev, b.toNext])).toEqual([
      ['a', 0, 3, 0, true, false],
      ['b', 1, 1, 1, false, false],
      ['c', 4, 3, 0, false, true],
    ]);
  });
  it('날짜 표기', () => {
    expect(eventDateText('2026-11-02', '2026-11-02')).toBe('11.02');
    expect(eventDateText('2026-11-02', '2026-11-06')).toBe('11.02 – 11.06');
    expect(newsDateBlock('2026-10-29')).toEqual({ mon: 'OCT', day: '29' });
  });
});

describe('일정 시각 표기(23-8-5, D298)', () => {
  const s = (starts_on: string, ends_on: string, start_time: string | null, end_time: string | null) => ({ starts_on, ends_on, start_time, end_time });
  it('eventScheduleText 6가지', () => {
    expect(eventScheduleText(s('2026-11-08', '2026-11-08', null, null))).toBe('11.08');
    expect(eventScheduleText(s('2026-11-08', '2026-11-10', null, null))).toBe('11.08 – 11.10');
    expect(eventScheduleText(s('2026-11-08', '2026-11-08', '21:00', null))).toBe('11.08 21:00');
    expect(eventScheduleText(s('2026-11-08', '2026-11-08', '21:00', '23:00'))).toBe('11.08 21:00–23:00');
    expect(eventScheduleText(s('2026-11-08', '2026-11-10', '21:00', '18:00'))).toBe('11.08 21:00 – 11.10 18:00');
    expect(eventScheduleText(s('2026-11-08', '2026-11-10', '21:00', null))).toBe('11.08 21:00 – 11.10');
  });
  it('시각 필드가 없는 옛 응답(1단계) = 종일', () => {
    expect(eventScheduleText({ starts_on: '2026-11-08', ends_on: '2026-11-08' })).toBe('11.08');
    expect(eventTimeText({ starts_on: '2026-11-08', ends_on: '2026-11-08' })).toBe('종일');
  });
  it('eventTimeText: 종일 | 시작 | 시작–끝(하루만)', () => {
    expect(eventTimeText(s('2026-11-08', '2026-11-08', null, null))).toBe('종일');
    expect(eventTimeText(s('2026-11-08', '2026-11-08', '21:00', null))).toBe('21:00');
    expect(eventTimeText(s('2026-11-08', '2026-11-08', '21:00', '23:00'))).toBe('21:00–23:00');
    expect(eventTimeText(s('2026-11-08', '2026-11-10', '21:00', '18:00'))).toBe('21:00');
  });
});

describe('게임 필터 칩', () => {
  const games = [{ code: 'lol' as const }, { code: 'tft' as const }, { code: 'steam' as const }];
  it('이벤트는 스팀을 포함하고, 패치노트는 뺀다', () => {
    expect(gameFilterOptions(games)).toEqual([null, 'lol', 'tft', 'steam']);
    expect(patchNoteGameOptions(games)).toEqual([null, 'lol', 'tft']);
  });
});

describe('라우트(S6)', () => {
  it('news·admin 쿼리', () => {
    expect(routes.news()).toBe('/news');
    expect(routes.news({ tab: 'events', game: 'lol', month: '2026-11' })).toBe('/news?tab=events&game=lol&month=2026-11');
    expect(routes.admin()).toBe('/admin');
    expect(routes.admin('results')).toBe('/admin');
    expect(routes.admin('api-keys')).toBe('/admin?tab=api-keys');
  });
});

describe('화면 소스 규칙(렌더 테스트 도구가 없어 소스로 확인)', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('외부 링크는 새 창 + rel=noopener noreferrer', () => {
    for (const f of ['../components/news/news-view.tsx']) {
      const src = read(f);
      const blanks = src.match(/target="_blank"[^>]*/g) ?? [];
      expect(blanks.length).toBeGreaterThan(0);
      for (const b of blanks) expect(b).toContain('rel="noopener noreferrer"');
    }
  });
  it('STAFF·관리자 링크는 admin일 때만 렌더(사이드바·모바일 머리)', () => {
    const shell = read('../components/shell/app-shell.tsx');
    expect(shell.match(/me\?\.role === 'admin' && \(/g)).toHaveLength(2);
    expect(read('../components/shell/nav-items.ts')).not.toContain('routes.admin');
  });
  it('관리자 화면은 비운영진이면 FORBIDDEN 상태', () => {
    expect(read('../components/admin/admin-view.tsx')).toContain("if (!isAdmin || isForbidden(overview.error))");
  });
  it('S6 화면 파일에 직접 만든 <button>이 없다(공용 Button)', () => {
    for (const f of [
      '../components/admin/admin-view.tsx',
      '../components/admin/admin-results.tsx',
      '../components/admin/admin-members.tsx',
      '../components/admin/admin-news.tsx',
      '../components/admin/admin-seasons.tsx',
      '../components/admin/admin-api-keys.tsx',
      '../components/admin/admin-audit.tsx',
      '../components/news/news-view.tsx',
      '../components/settings/notification-section.tsx',
      '../components/ui/form.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/<button[\s>]/);
    }
  });
});
