import type { SteamAppOption } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_BOT_NOT_CONNECTED_TEXT,
  ACTIVITY_RULE_TEXT,
  ACTIVITY_SCRIMS_HINT,
  RANKING_TABS,
  activeDaysText,
  activityMobileSubText,
  activityChangeHint,
  activityEmptyText,
  activityPeriodLabel,
  activityTimeText,
  defaultPlaytimeApp,
  mainGamesLine,
  mainGamesText,
  parseRankingsQuery,
  playtimeAppFallbackLabel,
  playtimeAppParam,
  playtimeRecentText,
  playtimeSyncedText,
  playtimeTotalText,
  resolvePlaytimeApp,
  scrimCountText,
} from './rankings';
import { routes } from './routes';

const q = (s: string) => new URLSearchParams(s);
const app = (app_id: number, owner_count = 1, name = `G${app_id}`): SteamAppOption => ({ app_id, name, owner_count });

describe('S5 랭킹 URL 쿼리', () => {
  it('탭 4개 모두 활성', () => {
    expect(RANKING_TABS.map((t) => t.value)).toEqual(['tier', 'elo', 'activity', 'playtime']);
  });
  it('period·app_id: 잘못된 값은 없는 것으로', () => {
    expect(parseRankingsQuery(q('tab=activity&period=month'))).toMatchObject({ tab: 'activity', period: 'month' });
    expect(parseRankingsQuery(q('tab=activity&period=year')).period).toBeNull();
    expect(parseRankingsQuery(q('tab=playtime&app_id=578080')).appId).toBe(578080);
    for (const bad of ['0', '-1', '1.5', '1e3', '12abc', ' 12', '', '9999999999']) {
      expect(parseRankingsQuery(q(`tab=playtime&app_id=${encodeURIComponent(bad)}`)).appId).toBeNull();
    }
  });
  it('routes.rankings: 기본 기간 week는 쓰지 않는다', () => {
    expect(routes.rankings({ tab: 'activity' })).toBe('/rankings?tab=activity');
    expect(routes.rankings({ tab: 'activity', period: 'week' })).toBe('/rankings?tab=activity');
    expect(routes.rankings({ tab: 'activity', period: 'month' })).toBe('/rankings?tab=activity&period=month');
    expect(routes.rankings({ tab: 'playtime', app_id: 730 })).toBe('/rankings?tab=playtime&app_id=730');
  });
});

describe('S5 활동 표시', () => {
  it('기간 select 글자: 응답 날짜(end − 1ms), 다른 기간이면 이름만', () => {
    const week = { period: 'week' as const, period_start: '2026-10-26T00:00:00.000+09:00', period_end: '2026-11-02T00:00:00.000+09:00' };
    expect(activityPeriodLabel('week', week)).toBe('이번 주 (10.26 – 11.01)');
    expect(activityPeriodLabel('month', week)).toBe('이번 달');
    expect(activityPeriodLabel('week', undefined)).toBe('이번 주');
    const month = { period: 'month' as const, period_start: '2026-09-30T15:00:00.000Z', period_end: '2026-10-31T15:00:00.000Z' };
    expect(activityPeriodLabel('month', month)).toBe('이번 달 (10월)');
    expect(activityPeriodLabel('month', { ...month, period_start: '2026-01-01T00:00:00.000+09:00' })).toBe('이번 달 (1월)');
  });
  it('빈 상태: 봇 미연결과 기록 없음 구분', () => {
    expect(activityEmptyText({ bot_connected: false, period: 'week' })).toBe(ACTIVITY_BOT_NOT_CONNECTED_TEXT);
    expect(activityEmptyText({ bot_connected: true, period: 'week' })).toBe('이번 주 음성 접속 기록이 아직 없어요');
    expect(activityEmptyText({ bot_connected: true, period: 'month' })).toBe('이번 달 음성 접속 기록이 아직 없어요');
    expect(activityChangeHint('week')).toBe('지난주 대비');
    expect(activityChangeHint('month')).toBe('지난달 대비');
  });
  it('음성만 센다는 문구(D232)', () => {
    expect(RANKING_TABS.find((t) => t.value === 'activity')!.description).toBe('디스코드 음성 채널 접속 시간 합계예요.');
    expect(ACTIVITY_RULE_TEXT).toBe('한국 시간 기준 · 주는 월요일 시작 · 기간에 시작한 음성 접속만 집계');
  });
  it('SCRIMS 열: 「3회」, 0도 「0회」, 머리 툴팁', () => {
    expect(scrimCountText(3)).toBe('3회');
    expect(scrimCountText(0)).toBe('0회');
    expect(ACTIVITY_SCRIMS_HINT).toBe('결과가 승인된 내전 참가 수');
  });
  it('모바일 보조 줄: 내전 0회면 생략, 주 게임 없으면 줄 없음(「—」 금지)', () => {
    expect(activityMobileSubText(7, { active_days: 6, scrim_count: 3 })).toBe('7일 중 6일 활동 · 내전 3회');
    expect(activityMobileSubText(7, { active_days: 6, scrim_count: 0 })).toBe('7일 중 6일 활동');
    expect(mainGamesLine({ main_games: [] })).toBe('');
    expect(mainGamesLine({ main_games: [{ code: 'lol', name: '리그 오브 레전드' }] })).toBe('롤 협곡');
  });
  it('시간 「31h 20m」: 분 내림, 두 자리', () => {
    expect(activityTimeText(31 * 3600 + 20 * 60 + 59)).toBe('31h 20m');
    expect(activityTimeText(27 * 3600 + 5 * 60)).toBe('27h 05m');
    expect(activityTimeText(59)).toBe('0h 00m');
    expect(activityTimeText(100 * 3600)).toBe('100h 00m');
  });
  it('보조 문구·주 게임', () => {
    expect(activeDaysText(7, 6)).toBe('7일 중 6일 활동');
    expect(mainGamesText({ main_games: [] })).toBe('—');
    expect(
      mainGamesText({
        main_games: [
          { code: 'lol', name: '리그 오브 레전드' },
          { code: 'tft', name: '전략적 팀 전투' },
        ],
      }),
    ).toBe('롤 협곡 · 롤체');
  });
});

describe('S5 플레이타임 표시', () => {
  it('시간 내림·쉼표', () => {
    expect(playtimeRecentText({ minutes_recent: 18 * 60 + 59 })).toBe('18시간');
    expect(playtimeRecentText({ minutes_recent: 59 })).toBe('0시간');
    expect(playtimeTotalText({ minutes_total: 2140 * 60 + 59 })).toBe('2,140h');
    expect(playtimeTotalText({ minutes_total: 999 * 60 })).toBe('999h');
    expect(playtimeTotalText({ minutes_total: 1_234_567 * 60 })).toBe('1,234,567h');
  });
  it('스팀 동기화 시각(KST)', () => {
    expect(playtimeSyncedText('2026-10-30T20:02:00.000Z')).toBe('스팀 동기화 10.31 05:02');
    expect(playtimeSyncedText(null)).toBeNull();
  });
  it('게임 선택: 주소 값 우선, 없으면 pickDefaultPlaytimeAppId, 기본값 null이면 null', () => {
    const apps = [app(578080), app(730)];
    expect(resolvePlaytimeApp(null, apps)).toBe(578080);
    expect(resolvePlaytimeApp(730, apps)).toBe(730);
    expect(resolvePlaytimeApp(999, apps)).toBe(999);
    expect(resolvePlaytimeApp(730, [])).toBeNull();
    // 목록을 모르거나 받지 못했으면 주소 값을 유지한다(QA s5_web #2)
    expect(resolvePlaytimeApp(null, undefined)).toBeNull();
    expect(resolvePlaytimeApp(730, undefined)).toBe(730);
  });
  it('기본 게임: owner_count 0 항목을 건너뛴다(D234)', () => {
    const apps = [app(1, 0), app(578080, 3), app(730, 2)];
    expect(defaultPlaytimeApp(apps)).toBe(578080);
    expect(resolvePlaytimeApp(null, apps)).toBe(578080);
    expect(defaultPlaytimeApp([app(1, 0)])).toBeNull();
    expect(resolvePlaytimeApp(null, [app(1, 0)])).toBeNull();
    expect(resolvePlaytimeApp(730, [app(1, 0)])).toBeNull();
    expect(defaultPlaytimeApp(undefined)).toBeUndefined();
  });
  it('주소 app_id 생략: 기본 게임과 같을 때만', () => {
    const apps = [app(1, 0), app(578080, 3), app(730, 2)];
    expect(playtimeAppParam(578080, apps)).toBeNull();
    expect(playtimeAppParam(1, apps)).toBe(1);
    expect(playtimeAppParam(730, apps)).toBe(730);
    expect(playtimeAppParam(730, undefined)).toBe(730);
  });
  it('목록에 없는 게임 옵션 글자', () => {
    const apps = [app(578080)];
    expect(playtimeAppFallbackLabel(apps, 578080, undefined)).toBeNull();
    expect(playtimeAppFallbackLabel(apps, 999, { app_id: 999, name: 'Old Game' })).toBe('Old Game');
    expect(playtimeAppFallbackLabel(apps, 999, { app_id: 999, name: null })).toBe('App 999');
    expect(playtimeAppFallbackLabel(apps, 999, { app_id: 1, name: 'X' })).toBe('App 999');
  });
});
