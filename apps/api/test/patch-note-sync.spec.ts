import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/integrations/http';
import { PatchNoteSyncService } from '../src/modules/news/patch-note-sync.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const NOW = new Date('2026-11-01T00:00:00+09:00');

function response(status: number, body: string) {
  return {
    status,
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

function harness(opts: {
  html?: Partial<Record<'lol' | 'tft', string>>;
  status?: Partial<Record<'lol' | 'tft', number>>;
  fail?: Partial<Record<'lol' | 'tft', boolean>>;
  versions?: Partial<Record<'lol' | 'tft', (string | null)[]>>;
  lock?: boolean;
}) {
  const created: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: async () => [{ ok: opts.lock !== false }],
    game: {
      findUnique: async ({ where }: { where: { code: 'lol' | 'tft' } }) => ({ id: `game-${where.code}` }),
    },
    patchNote: {
      findMany: async ({ where }: { where: { gameId: string } }) => {
        const code = where.gameId === 'game-tft' ? 'tft' : 'lol';
        return (opts.versions?.[code] ?? []).map((version) => ({ version }));
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `id-${created.length}` };
      },
    },
    adminAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
      },
    },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<void>) => fn(tx),
  };
  const fetchFn: FetchLike = async (url) => {
    const game = String(url).includes('teamfighttactics') ? 'tft' : 'lol';
    if (opts.fail?.[game]) throw new Error('network');
    const body = opts.html?.[game] ?? '';
    return response(opts.status?.[game] ?? (opts.html?.[game] == null ? 404 : 200), body);
  };
  const svc = new PatchNoteSyncService(prisma as unknown as PrismaService, { now: () => NOW }, fetchFn);
  return { svc, created, audits };
}

describe('패치노트 자동 등록', () => {
  it('저장된 글이 없으면 현재 패치를 알림 없이 한 건씩 올린다', async () => {
    const { svc, created, audits } = harness({
      html: {
        lol: 'league-of-legends-patch-26-21-notes/',
        tft: 'teamfight-tactics-patch-18-5/',
      },
    });
    await svc.sync();
    expect(created).toEqual([
      expect.objectContaining({
        gameId: 'game-lol',
        version: '26.21',
        title: '패치노트',
        summary: '공식 패치노트가 올라왔습니다.',
        url: 'https://www.leagueoflegends.com/ko-kr/news/game-updates/league-of-legends-patch-26-21-notes/',
        notifyDiscord: false,
        autoRegistered: true,
        createdById: null,
      }),
      expect.objectContaining({
        gameId: 'game-tft',
        version: '18.5',
        url: 'https://teamfighttactics.leagueoflegends.com/ko-kr/news/game-updates/teamfight-tactics-patch-18-5/',
        notifyDiscord: false,
        autoRegistered: true,
      }),
    ]);
    expect(audits.map((a) => a.actorId)).toEqual([null, null]);
    expect(created[0]).toMatchObject({ publishedOn: new Date('2026-11-01T00:00:00.000Z') });
  });

  it('더 새 패치만 알림을 켜고, 같은 버전과 실패한 목록은 건너뛴다', async () => {
    const { svc, created } = harness({
      html: {
        lol: 'league-of-legends-patch-26-22-notes/ league-of-legends-patch-26-21-notes/',
      },
      fail: { tft: true },
      versions: { lol: ['26.21'] },
    });
    await svc.sync();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ version: '26.22', notifyDiscord: true, title: '패치노트' });
  });

  it('이미 같은 버전이 있거나 잠금을 못 얻으면 넣지 않는다', async () => {
    const same = harness({
      html: { lol: 'league-of-legends-patch-26-21-notes/' },
      versions: { lol: ['26.21'] },
    });
    await same.svc.sync();
    expect(same.created).toHaveLength(0);

    const locked = harness({
      html: { lol: 'league-of-legends-patch-26-22-notes/' },
      lock: false,
    });
    await locked.svc.sync();
    expect(locked.created).toHaveLength(0);
  });

  it('너무 큰 목록은 버린다', async () => {
    const { svc, created } = harness({
      html: { lol: `${'x'.repeat(1_000_001)} league-of-legends-patch-26-22-notes/` },
    });
    await svc.sync();
    expect(created).toHaveLength(0);
  });
});
