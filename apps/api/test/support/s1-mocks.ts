import { type Mock, vi } from 'vitest';
import type { Clock } from '../../src/common/clock';
import {
  type DataDragon,
  ExternalApiError,
  type RiotApi,
  type SteamApi,
  type SyncJob,
  type SyncQueue,
} from '../../src/integrations/contracts';

/** 가짜 PUUID·스팀 ID(실제 값 아님) */
export const PUUID_A = 'FAKE-PUUID-A-000000000000000000000000000000000000000000000000000000000000';
export const PUUID_B = 'FAKE-PUUID-B-000000000000000000000000000000000000000000000000000000000000';
export const PUUID_C = 'FAKE-PUUID-C-000000000000000000000000000000000000000000000000000000000000';
export const PUUID_D = 'FAKE-PUUID-D-000000000000000000000000000000000000000000000000000000000000';
export const STEAM_ID_A = '76561190000000001';
export const STEAM_ID_B = '76561190000000002';

// biome-ignore lint: 목 타입
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn<T extends (...args: any[]) => any> = Mock<T>;

export type MockRiot = { [K in keyof RiotApi]: Fn<RiotApi[K]> } & {
  /** gameName → PUUID, PUUID → 현재 아이콘 */
  accounts: Map<string, string>;
  icons: Map<string, number>;
};

/**
 * 라이엇 목: `accounts`에 등록한 게임 이름(대소문자 무시)만 찾고, `icons`의 아이콘을 돌려준다.
 * 등록 안 된 이름 → not_found, 아이콘 없는 PUUID → not_found(소환사 없음).
 */
export function mockRiot(): MockRiot {
  const accounts = new Map<string, string>([
    ['alpha', PUUID_A],
    ['bravo', PUUID_B],
    ['charlie', PUUID_C],
    ['delta', PUUID_D],
  ]);
  const icons = new Map<string, number>([
    [PUUID_A, 7],
    [PUUID_B, 7],
    [PUUID_C, 7],
    [PUUID_D, 7],
  ]);
  const display = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
  const m = {
    accounts,
    icons,
    getAccountByRiotId: vi.fn<RiotApi['getAccountByRiotId']>(async (gameName, tagLine) => {
      const puuid = accounts.get(gameName.toLowerCase());
      if (!puuid) throw new ExternalApiError('not_found');
      return { puuid, gameName: display(gameName.toLowerCase()), tagLine: tagLine.toUpperCase() };
    }),
    getAccountByPuuid: vi.fn<RiotApi['getAccountByPuuid']>(async () => {
      throw new ExternalApiError('not_found');
    }),
    getSummonerByPuuid: vi.fn<RiotApi['getSummonerByPuuid']>(async (puuid) => {
      const icon = icons.get(puuid);
      if (icon === undefined) throw new ExternalApiError('not_found');
      return { profileIconId: icon };
    }),
    getLolLeagueEntries: vi.fn<RiotApi['getLolLeagueEntries']>(async () => []),
    getTftLeagueEntries: vi.fn<RiotApi['getTftLeagueEntries']>(async () => []),
    getLolMatchIds: vi.fn<RiotApi['getLolMatchIds']>(async () => []),
    getLolMatch: vi.fn<RiotApi['getLolMatch']>(async () => {
      throw new ExternalApiError('not_found');
    }),
  };
  return m as MockRiot;
}

export type MockSteam = { [K in keyof SteamApi]: Fn<SteamApi[K]> };

/** 스팀 목: verifyOpenIdAssertion은 claimed_id에서 ID를 꺼내 ok(형식 검증은 실제 클라이언트 테스트가 담당) */
export function mockSteam(): MockSteam {
  return {
    getOwnedGames: vi.fn<SteamApi['getOwnedGames']>(async () => ({ visibility: 'public', games: [] })),
    getPlayerSummary: vi.fn<SteamApi['getPlayerSummary']>(async () => ({ personaName: '스팀닉' })),
    verifyOpenIdAssertion: vi.fn<SteamApi['verifyOpenIdAssertion']>(async (query, expectedReturnTo) => {
      if (query['openid.return_to'] !== expectedReturnTo) return { ok: false };
      const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/.exec(query['openid.claimed_id'] ?? '');
      if (!m || query['openid.identity'] !== query['openid.claimed_id']) return { ok: false };
      return { ok: true, steamId: m[1] as string };
    }),
    searchStoreApps: vi.fn<SteamApi['searchStoreApps']>(async () => []),
    getStoreApp: vi.fn<SteamApi['getStoreApp']>(async () => null),
  };
}

export type MockDataDragon = { [K in keyof DataDragon]: Fn<DataDragon[K]> };

export function mockDataDragon(): MockDataDragon {
  return {
    profileIconUrl: vi.fn<DataDragon['profileIconUrl']>(
      async (id) => `https://ddragon.leagueoflegends.com/cdn/16.21.1/img/profileicon/${id}.png`,
    ),
    champion: vi.fn<DataDragon['champion']>(async (id) =>
      id === 266
        ? { key: 'Aatrox', nameKo: '아트록스', imageUrl: 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img/champion/Aatrox.png' }
        : null,
    ),
  };
}

export type MockQueue = SyncQueue & { jobs: SyncJob[]; enqueue: Fn<SyncQueue['enqueue']> };

export function mockQueue(): MockQueue {
  const jobs: SyncJob[] = [];
  return {
    jobs,
    enqueue: vi.fn<SyncQueue['enqueue']>(async (job) => {
      jobs.push(job);
    }),
  };
}

/** 이동 가능한 시계. 기본 2026-10-28T12:00:00+09:00 */
export type TestClock = Clock & { t: Date; set(iso: string | Date): void; advance(ms: number): void };

export function testClock(start = '2026-10-28T03:00:00.000Z'): TestClock {
  const c: TestClock = {
    t: new Date(start),
    now: () => new Date(c.t.getTime()),
    set: (iso) => {
      c.t = new Date(iso);
    },
    advance: (ms) => {
      c.t = new Date(c.t.getTime() + ms);
    },
  };
  return c;
}
