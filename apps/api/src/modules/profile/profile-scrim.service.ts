import { Injectable } from '@nestjs/common';
import { isPlacementWin, selectRatedParticipants } from '@gcd/core';
import {
  GameCode,
  PROFILE_RECENT_SCRIMS_LIMIT,
  PROFILE_RECENT_SCRIMS_SCAN_LIMIT,
  type ProfileGameRating,
  type ProfileRecentScrim,
  ProfileScrim,
} from '@gcd/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RankingsReader } from '../rankings/rankings-reader.service';
import { ratingSummary } from '../ratings/rating-history.service';
import { SeasonsService, seasonRef } from '../ratings/seasons.service';
import { readPlacements } from '../scrims/scrim-result-json';

/**
 * 프로필 내전 블록(계약 S3 4-1 ProfileScrim, D119). S3부터 항상 객체. 조회는 시즌을 만들지 않는다.
 * 쿼리: 시즌 1 + ratings 1 + 게임 1 + 내 참가 행 1 + 승인 결과 1 + 내전 1 + 이력 1(N+1 없음). rank는 게임별 랭킹 캐시 읽기(계산 없음, S4 4-4).
 * 승인 결과·내전·이력·명단 조회는 최신 승인 결과 PROFILE_RECENT_SCRIMS_SCAN_LIMIT(10)개로 묶는다. 내 참가 행(가벼운 행)만 전체를 읽는다.
 */
@Injectable()
export class ProfileScrimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    private readonly rankings: RankingsReader,
  ) {}

  async forUser(userId: string, now: Date): Promise<ProfileScrim> {
    const season = await this.seasons.currentAt(now);
    const games = await this.prisma.game.findMany({ orderBy: [{ sortOrder: 'asc' }] });
    const gameById = new Map(games.map((g) => [g.id, g]));
    const codeOf = (gameId: string): GameCode | null => {
      const c = GameCode.safeParse(gameById.get(gameId)?.code);
      return c.success ? c.data : null;
    };

    // 현재 시즌 게임별 레이팅(games.sort_order 순)
    let ratings: ProfileGameRating[] = [];
    if (season) {
      const rows = await this.prisma.rating.findMany({ where: { userId, seasonId: season.id } });
      const byGame = new Map(rows.map((r) => [r.gameId, r]));
      const seasonId = season.id;
      const cards = await Promise.all(
        games.map(async (g) => {
          const r = byGame.get(g.id);
          const code = codeOf(g.id);
          if (!r || !code) return null;
          return { game: code, ...ratingSummary(r), rank: await this.rankings.eloRankOf(code, seasonId, userId) };
        }),
      );
      ratings = cards.filter((c) => c !== null);
    }

    // 최근 내전: 내 참가 행(joined·no_show) 중 승인된 결과가 있는(= finished) 내전, approved_at DESC 후보 10개 중 최대 5
    const mine = await this.prisma.scrimPlayer.findMany({
      where: { userId, status: { in: ['joined', 'no_show'] } },
    });
    const myRow = new Map(mine.map((p) => [p.scrimId, p]));
    const results = mine.length
      ? await this.prisma.scrimResult.findMany({
          where: { scrimId: { in: [...myRow.keys()] }, status: 'approved' },
          orderBy: [{ approvedAt: 'desc' }, { id: 'asc' }],
          take: PROFILE_RECENT_SCRIMS_SCAN_LIMIT,
        })
      : [];
    const scrims = results.length
      ? await this.prisma.scrim.findMany({ where: { id: { in: results.map((r) => r.scrimId) }, status: 'finished' } })
      : [];
    const scrimById = new Map(scrims.map((s) => [s.id, s]));
    const picked = results.filter((r) => scrimById.has(r.scrimId) && r.approvedAt !== null).slice(0, PROFILE_RECENT_SCRIMS_LIMIT);
    const history = picked.length
      ? await this.prisma.ratingHistory.findMany({ where: { scrimId: { in: picked.map((r) => r.scrimId) } } })
      : [];
    const deltaByScrim = new Map(history.filter((h) => h.userId === userId).map((h) => [h.scrimId, h.eloAfter - h.eloBefore]));
    // 승인 때 실제로 레이팅이 반영된 참가자(내전별). 승인 뒤 노쇼 표시가 생겨도 승패 기준이 바뀌지 않게 한다
    const ratedIdsByScrim = new Map<string, Set<string>>();
    for (const h of history) ratedIdsByScrim.set(h.scrimId, (ratedIdsByScrim.get(h.scrimId) ?? new Set<string>()).add(h.userId));
    // 개인 순위 게임 승패(D136): 이력이 없는 내전(rated=false·skip)만 그 내전 참가자 전원의 현재 status가 필요하다(1회 조회)
    const placementScrimIds = picked
      .filter((r) => {
        const sc = scrimById.get(r.scrimId);
        return sc !== undefined && gameById.get(sc.gameId)?.hasTeams === false && !ratedIdsByScrim.has(r.scrimId);
      })
      .map((r) => r.scrimId);
    const rosterRows = placementScrimIds.length
      ? await this.prisma.scrimPlayer.findMany({ where: { scrimId: { in: placementScrimIds } } })
      : [];
    const rosterByScrim = new Map<string, typeof rosterRows>();
    for (const p of rosterRows) rosterByScrim.set(p.scrimId, [...(rosterByScrim.get(p.scrimId) ?? []), p]);

    const recent: ProfileRecentScrim[] = [];
    for (const r of picked) {
      const scrim = scrimById.get(r.scrimId);
      const row = myRow.get(r.scrimId);
      const game = scrim ? gameById.get(scrim.gameId) : undefined;
      const code = scrim ? codeOf(scrim.gameId) : null;
      if (!scrim || !row || !game || !code || !r.approvedAt) continue;
      let outcome: ProfileRecentScrim['outcome'];
      let placement: number | null = null;
      if (game.hasTeams) {
        if (row.status === 'no_show') outcome = 'no_show';
        else if (row.team === null) outcome = 'unassigned';
        else outcome = row.team === r.winnerTeam ? 'win' : 'loss';
      } else {
        const placements = readPlacements(r.placements) ?? [];
        const me = placements.find((p) => p.user_id === userId);
        placement = me?.placement ?? null;
        if (row.status === 'no_show') outcome = 'no_show';
        else if (!me) outcome = 'unassigned';
        else {
          // D136/D138: 레이팅 반영과 같은 기준 — core selectRatedParticipants(노쇼·미배정 제외 후 1..M 재순위) +
          // isPlacementWin(재순위, M). 이력(rating_history)이 있으면 승인 때 반영된 참가자 기준(승인 뒤 노쇼 표시 무시),
          // 없으면(rated=false·skip) 현재 status 기준. 반영 대상이 2명 미만(skip)이면 승패 없음 → unassigned
          const ratedIds = ratedIdsByScrim.get(r.scrimId);
          const players = ratedIds
            ? [...ratedIds].map((id) => ({ userId: id, status: 'joined' as const, team: null }))
            : (rosterByScrim.get(r.scrimId) ?? []).map((p) => ({ userId: p.userId, status: p.status, team: p.team }));
          const sel = selectRatedParticipants({
            hasTeams: false,
            players,
            placements: placements.map((p) => ({ userId: p.user_id, placement: p.placement })),
          });
          const ranked = sel.kind === 'placements' ? sel.ranked : [];
          const mine = ranked.find((x) => x.userId === userId);
          outcome = mine ? (isPlacementWin(mine.placement, ranked.length) ? 'win' : 'loss') : 'unassigned';
        }
      }
      recent.push({
        scrim_id: scrim.id,
        title: scrim.title,
        game: code,
        finished_at: r.approvedAt.toISOString(),
        rated: scrim.rated,
        team: game.hasTeams ? row.team : null,
        position: row.position,
        placement,
        outcome,
        elo_delta: deltaByScrim.get(scrim.id) ?? null,
      });
    }

    return ProfileScrim.parse({ season: season ? seasonRef(season) : null, ratings, recent });
  }
}
