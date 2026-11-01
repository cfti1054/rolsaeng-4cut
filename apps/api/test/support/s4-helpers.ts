import { randomUUID } from 'node:crypto';
import type { UserRole } from '@gcd/shared';
import { RankingRefresher } from '../../src/modules/rankings/ranking-refresher';
import { SeasonCloser } from '../../src/modules/rankings/season-closer';
import { call } from './s1-helpers';
import type { TestApp } from './test-app';

/** S4 테스트 공통 준비(DB 없이 FakePrisma에 행을 직접 심는다). 계약: _workspace/01_architect_contract.md 14절 6번 */

export type Who = { token: string; userId: string };

export async function login(app: TestApp, username: string, role?: UserRole): Promise<Who> {
  const res = await fetch(`${app.base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(role ? { username, role } : { username }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

/** 토큰이 필요 없는 멤버 */
export async function member(app: TestApp, nickname: string): Promise<string> {
  return (await app.prisma.user.create({ data: { nickname } })).id;
}

export function seedSeason(app: TestApp, name: string, startsAt: string, endsAt: string, closedAt: string | null = null) {
  return app.prisma.season.insert({
    name,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    closedAt: closedAt ? new Date(closedAt) : null,
  });
}

export function seedRating(
  app: TestApp,
  userId: string,
  seasonId: string,
  o: { game?: 'lol' | 'tft' | 'steam'; elo?: number; wins?: number; losses?: number } = {},
) {
  return app.prisma.rating.insert({
    userId,
    gameId: app.prisma.gameId(o.game ?? 'lol'),
    seasonId,
    elo: o.elo ?? 1000,
    wins: o.wins ?? 0,
    losses: o.losses ?? 0,
  });
}

/** 계정 + 스냅샷. tier가 null이면 계정만(스냅샷 없음) */
export function seedAccount(
  app: TestApp,
  userId: string,
  o: {
    game?: 'lol' | 'tft';
    name?: string;
    primary?: boolean;
    verified?: boolean;
    tier?: string | null;
    division?: string | null;
    lp?: number;
    wins?: number;
    losses?: number;
    queue?: string;
    capturedAt?: Date;
  } = {},
) {
  const game = o.game ?? 'lol';
  const acc = app.prisma.gameAccount.insert({
    userId,
    gameId: app.prisma.gameId(game),
    externalId: `FAKE-PUUID-${randomUUID()}`,
    displayName: o.name ?? 'user#KR1',
    verified: o.verified ?? true,
    isPrimary: o.primary ?? true,
  });
  if (o.tier !== null) {
    seedSnapshot(app, acc.id, { game, ...o, tier: o.tier ?? 'GOLD', division: o.division === undefined ? 'I' : o.division });
  }
  return acc;
}

export function seedSnapshot(
  app: TestApp,
  accountId: string,
  o: {
    game?: 'lol' | 'tft';
    tier: string;
    division: string | null;
    lp?: number;
    wins?: number;
    losses?: number;
    queue?: string;
    capturedAt?: Date;
  },
) {
  return app.prisma.rankSnapshot.insert({
    gameAccountId: accountId,
    queue: o.queue ?? ((o.game ?? 'lol') === 'lol' ? 'RANKED_SOLO_5x5' : 'RANKED_TFT'),
    tier: o.tier,
    division: o.division,
    lp: o.lp ?? 0,
    wins: o.wins ?? 0,
    losses: o.losses ?? 0,
    capturedAt: o.capturedAt ?? app.clock.now(),
  });
}

/** playing 내전 + 팀 배정 + pending 결과. 반환: 내전·결과 id. 방장 = blue[0] */
export function seedPendingTeamResult(
  app: TestApp,
  blue: string[],
  orange: string[],
  o: { winner?: 'blue' | 'orange'; rated?: boolean; title?: string; game?: 'lol' } = {},
): { scrimId: string; resultId: string } {
  const now = app.clock.now();
  const host = blue[0] as string;
  const s = app.prisma.scrim.insert({
    gameId: app.prisma.gameId(o.game ?? 'lol'),
    hostId: host,
    title: o.title ?? '테스트 내전',
    scheduledAt: new Date(now.getTime() - 3_600_000),
    capacity: blue.length + orange.length,
    status: 'playing',
    rated: o.rated ?? true,
    startedAt: new Date(now.getTime() - 1_800_000),
  });
  const add = (userId: string, team: 'blue' | 'orange', i: number) =>
    app.prisma.scrimPlayer.insert({ scrimId: s.id, userId, status: 'joined', team, joinedAt: new Date(now.getTime() - 7_200_000 + i) });
  blue.forEach((u, i) => add(u, 'blue', i));
  orange.forEach((u, i) => add(u, 'orange', blue.length + i));
  const r = app.prisma.scrimResult.insert({
    scrimId: s.id,
    status: 'pending',
    winnerTeam: o.winner ?? 'blue',
    submittedById: host,
    createdAt: now,
  });
  return { scrimId: s.id, resultId: r.id };
}

export const approve = (app: TestApp, admin: Who, ids: { scrimId: string; resultId: string }) =>
  call(app, 'POST', `/scrims/${ids.scrimId}/result/approve`, admin.token, { result_id: ids.resultId });

export const closer = (app: TestApp): SeasonCloser => app.app.get(SeasonCloser);
export const refresher = (app: TestApp): RankingRefresher => app.app.get(RankingRefresher);

/** 사용자의 그 시즌 ratings 행 */
export function ratingOf(app: TestApp, userId: string, seasonId: string, game: 'lol' | 'tft' = 'lol') {
  return app.prisma.rating.rows.find((r) => r.userId === userId && r.seasonId === seasonId && r.gameId === app.prisma.gameId(game));
}
