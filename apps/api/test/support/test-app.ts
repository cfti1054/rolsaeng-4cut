import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { API_PREFIX } from '@gcd/shared';
import { vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG, type AppConfig, loadConfig } from '../../src/config/env';
import {
  DISCORD_OAUTH_CLIENT,
  type DiscordGuildMember,
  type DiscordOAuthClient,
  type DiscordUser,
} from '../../src/modules/auth/discord-oauth.client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { APP_CLOCK } from '../../src/common/clock';
import { DATA_DRAGON, RIOT_API, STEAM_API, SYNC_QUEUE } from '../../src/integrations/contracts';
import { RANDOM } from '../../src/modules/game-accounts/riot-link.service';
import {
  type MockDataDragon,
  type MockQueue,
  type MockRiot,
  type MockSteam,
  type TestClock,
  mockDataDragon,
  mockQueue,
  mockRiot,
  mockSteam,
  testClock,
} from './s1-mocks';

export const TEST_WEB_ORIGIN = 'http://localhost:3000';

export const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  WEB_ORIGIN: TEST_WEB_ORIGIN,
  DATABASE_URL: 'postgresql://gcd:gcd@localhost:5432/gcd?schema=test',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123',
  COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef0123',
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/discord/callback',
  DISCORD_GUILD_ID: '111111111111111111',
  ADMIN_DISCORD_IDS: '900000000000000001',
  AUTH_DEV_LOGIN: 'true',
  // S1: 키가 있어야 연동·동기화가 동작(값은 가짜. 외부 호출은 목)
  RIOT_API_KEY: 'test-riot-key',
  STEAM_API_KEY: 'test-steam-key',
};

export function testConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return loadConfig({ ...BASE_ENV, ...overrides });
}

export const DEFAULT_DISCORD_USER: DiscordUser = {
  id: '123456789012345678',
  username: 'gamer_kim',
  global_name: '김게이머',
  avatar: 'abc123hash',
  email: 'kim@example.com',
  verified: true,
};

export function mockDiscord(
  opts: { user?: DiscordUser; member?: DiscordGuildMember | null } = {},
): DiscordOAuthClient & {
  exchangeCode: ReturnType<typeof vi.fn>;
  getCurrentUser: ReturnType<typeof vi.fn>;
  getGuildMember: ReturnType<typeof vi.fn>;
} {
  return {
    exchangeCode: vi.fn(async () => 'discord-access-token'),
    getCurrentUser: vi.fn(async () => opts.user ?? DEFAULT_DISCORD_USER),
    getGuildMember: vi.fn(async () =>
      opts.member === undefined ? { nick: '서버닉', pending: false } : opts.member,
    ),
  };
}

export interface TestApp {
  app: INestApplication;
  base: string;
  prisma: FakePrisma;
  config: AppConfig;
  discord: ReturnType<typeof mockDiscord>;
  riot: MockRiot;
  steam: MockSteam;
  ddragon: MockDataDragon;
  queue: MockQueue;
  clock: TestClock;
  close: () => Promise<void>;
}

export async function createTestApp(
  opts: {
    env?: Record<string, string | undefined>;
    discord?: ReturnType<typeof mockDiscord>;
    prisma?: FakePrisma;
    /** 소유 확인 아이콘 선택 난수(기본 0 → 후보 중 첫 번째) */
    random?: () => number;
    /** 시계를 고정할지(기본 false = 실제 시각 사용, S0 테스트 호환) */
    fixedClock?: boolean | string;
  } = {},
): Promise<TestApp> {
  const riot = mockRiot();
  const steam = mockSteam();
  const ddragon = mockDataDragon();
  const queue = mockQueue();
  const clock = testClock(typeof opts.fixedClock === 'string' ? opts.fixedClock : undefined);
  const clockProvider = opts.fixedClock ? clock : { now: () => new Date() };
  const config = testConfig(opts.env);
  const prisma = opts.prisma ?? new FakePrisma();
  const discord = opts.discord ?? mockDiscord();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(DISCORD_OAUTH_CLIENT)
    .useValue(discord)
    .overrideProvider(RIOT_API)
    .useValue(riot)
    .overrideProvider(STEAM_API)
    .useValue(steam)
    .overrideProvider(DATA_DRAGON)
    .useValue(ddragon)
    .overrideProvider(SYNC_QUEUE)
    .useValue(queue)
    .overrideProvider(APP_CLOCK)
    .useValue(clockProvider)
    .overrideProvider(RANDOM)
    .useValue(opts.random ?? (() => 0))
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return {
    app,
    base: `http://127.0.0.1:${address.port}${API_PREFIX}`,
    prisma,
    config,
    discord,
    riot,
    steam,
    ddragon,
    queue,
    clock,
    close: () => app.close(),
  };
}

/** Set-Cookie 헤더에서 name=value 를 찾는다. 없으면 undefined */
export function findSetCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

export function cookieValue(setCookie: string | undefined): string | undefined {
  if (!setCookie) return undefined;
  const first = setCookie.split(';')[0] ?? '';
  return decodeURIComponent(first.slice(first.indexOf('=') + 1));
}
