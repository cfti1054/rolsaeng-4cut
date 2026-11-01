/**
 * SYNC·SCRIM·RANKING 작업이 모두 켜져도 ScheduleModule 인스턴스가 1개이고 cron이 중복 등록되지 않는지 확인한다
 * (계약 S2 D96, S4 D164). Nest 11은 동적 모듈을 참조로 구분해 ScheduleModule.forRoot()를 부를 때마다 인스턴스가 생기고,
 * 인스턴스마다 모든 @Cron을 따로 등록한다. 세 모듈은 sharedScheduleModule 객체 하나를 공유해야 한다.
 */
import { type INestApplication, Injectable, Module } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsModule } from '../src/jobs/jobs.module';
import { RankingJobsModule } from '../src/modules/rankings/ranking-jobs.module';
import { RankingJobsScheduler } from '../src/modules/rankings/ranking-jobs.scheduler';
import type { RankingRefresher } from '../src/modules/rankings/ranking-refresher';
import type { SeasonCloser } from '../src/modules/rankings/season-closer';
import { RankingsModule } from '../src/modules/rankings/rankings.module';
import { ScrimsModule } from '../src/modules/scrims/scrims.module';
import { type TestApp, createTestApp } from './support/test-app';

@Injectable()
class SyncLikeJob {
  @Cron('0 * * * *', { name: 'sync-like' })
  run(): void {}
}

@Injectable()
class ScrimLikeJob {
  @Cron('*/5 * * * *', { name: 'scrim-like' })
  run(): void {}
}

describe('ScheduleModule 중복 import (SYNC_JOBS_ENABLED=true + SCRIM_JOBS_ENABLED=true)', () => {
  it('두 모듈의 실제 import를 함께 써도 ScheduleModule은 1개, cron은 각 1번만 등록된다', async () => {
    const jobsImports = JobsModule.forRoot({ SYNC_JOBS_ENABLED: 'true' }).imports ?? [];
    const scrimImports = ScrimsModule.forRoot({ SCRIM_JOBS_ENABLED: 'true' }).imports ?? [];
    expect(jobsImports).toHaveLength(1);
    expect(scrimImports).toHaveLength(1);

    @Module({ imports: jobsImports, providers: [SyncLikeJob] })
    class JobsLike {}
    @Module({ imports: scrimImports, providers: [ScrimLikeJob] })
    class ScrimsLike {}

    const moduleRef = await Test.createTestingModule({ imports: [JobsLike, ScrimsLike] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      const jobs = app.get(SchedulerRegistry).getCronJobs();
      expect([...jobs.keys()].sort()).toEqual(['scrim-like', 'sync-like']);
      // 레지스트리 하나만 보면 다른 인스턴스의 중복 등록을 놓친다
      const names = [...app.get(ModulesContainer).values()].map((m) => m.metatype?.name);
      expect(names.filter((n) => n === 'ScheduleModule')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('RankingJobsModule.forRoot (S4 D164)', () => {
  it('RANKING_JOBS_ENABLED=false면 스케줄러·ScheduleModule 미등록, true면 등록', () => {
    const off = RankingJobsModule.forRoot({ RANKING_JOBS_ENABLED: 'false' });
    expect(off.imports).toEqual([]);
    expect(off.providers).toEqual([]);
    const on = RankingJobsModule.forRoot({});
    expect(on.providers).toEqual([RankingJobsScheduler]);
    expect(on.imports).toContain(RankingsModule);
  });

  it('RankingsModule 자체에는 스케줄러가 없어 다른 모듈의 import로 cron이 늘지 않는다', () => {
    const providers = (Reflect.getMetadata('providers', RankingsModule) ?? []) as unknown[];
    expect(providers).not.toContain(RankingJobsScheduler);
  });

  it('ScheduleModule 세 번 import(Jobs·Scrims·Ranking)해도 cron은 각 1번', async () => {
    const schedule = (m: { imports?: unknown[] }) => (m.imports ?? []).filter((x) => x !== RankingsModule);
    const rankingImports = schedule(RankingJobsModule.forRoot({ RANKING_JOBS_ENABLED: 'true' }));
    expect(rankingImports).toHaveLength(1);

    @Module({ imports: JobsModule.forRoot({ SYNC_JOBS_ENABLED: 'true' }).imports ?? [], providers: [SyncLikeJob] })
    class JobsLike {}
    @Module({ imports: ScrimsModule.forRoot({ SCRIM_JOBS_ENABLED: 'true' }).imports ?? [], providers: [ScrimLikeJob] })
    class ScrimsLike {}
    @Module({ imports: rankingImports as never[] })
    class RankingLike {}

    const moduleRef = await Test.createTestingModule({ imports: [JobsLike, ScrimsLike, RankingLike] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      expect([...app.get(SchedulerRegistry).getCronJobs().keys()].sort()).toEqual(['scrim-like', 'sync-like']);
      const names = [...app.get(ModulesContainer).values()].map((m) => m.metatype?.name);
      expect(names.filter((n) => n === 'ScheduleModule')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('한 tick = 종료 → 캐시 갱신. 종료 실패가 캐시 갱신을 막지 않는다', async () => {
    const order: string[] = [];
    const closer = { runOnce: vi.fn(async () => void order.push('close')) };
    const refresher = { runOnce: vi.fn(async () => void order.push('refresh')) };
    const s = new RankingJobsScheduler(closer as unknown as SeasonCloser, refresher as unknown as RankingRefresher);
    await s.tick();
    expect(order).toEqual(['close', 'refresh']);

    closer.runOnce.mockRejectedValueOnce(new Error('boom'));
    await expect(s.tick()).resolves.toBeUndefined();
    expect(refresher.runOnce).toHaveBeenCalledTimes(2);
  });
});

describe('AppModule 모듈 인스턴스', () => {
  it('ScrimsModule은 1개다. Nest 11은 동적 모듈을 참조로 구분해 forRoot()를 두 번 부르면 인스턴스(와 자동 마감 cron)가 둘이 된다', async () => {
    const t = await createTestApp();
    try {
      const names = [...t.app.get(ModulesContainer).values()].map((m) => m.metatype?.name);
      expect(names.filter((n) => n === 'ScrimsModule')).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it('forRoot()는 같은 구성이면 같은 객체를 돌려준다(중복 등록 방지)', () => {
    expect(ScrimsModule.forRoot({ SCRIM_JOBS_ENABLED: 'true' })).toBe(ScrimsModule.forRoot({}));
    expect(ScrimsModule.forRoot({ SCRIM_JOBS_ENABLED: 'false' })).not.toBe(ScrimsModule.forRoot({}));
  });
});

/**
 * 실제 AppModule을 플래그 조합마다 새로 띄운다. forRoot는 모듈 로드 시점의 process.env를 읽으므로
 * env를 먼저 정하고 vi.resetModules 뒤 test-app(→ AppModule)을 동적 import해야 한다.
 * vitest.config.ts가 세 플래그를 끄기 때문에 이 행렬이 없으면 RankingJobsScheduler DI가 저장소 테스트에서 생성되지 않는다.
 */
describe('AppModule 작업 플래그 8조합 (D96, D164)', () => {
  const SYNC_CRONS = ['*/5 * * * *', '0 * * * *', '0 5 * * *'];
  const SCRIM_CRONS = ['*/5 * * * *'];
  const RANKING_CRONS = ['*/5 * * * *'];
  const bools = [true, false];
  const combos = bools.flatMap((sync) => bools.flatMap((scrim) => bools.map((ranking) => ({ sync, scrim, ranking }))));

  /** 모듈 이름별 인스턴스 수 */
  const moduleCount = (app: INestApplication, name: string) =>
    [...app.get(ModulesContainer).values()].filter((m) => m.metatype?.name === name).length;
  /** 앱 전체에서 그 이름의 provider가 만들어진 인스턴스 수 */
  const providerCount = (app: INestApplication, name: string) =>
    [...app.get(ModulesContainer).values()]
      .flatMap((m) => [...m.providers.values()])
      .filter((p) => p.metatype?.name === name && p.instance).length;
  /** 모든 ScheduleModule 인스턴스의 cron 식(레지스트리 하나만 보면 다른 인스턴스의 중복을 놓친다) */
  const cronSources = (app: INestApplication) =>
    [...app.get(ModulesContainer).values()]
      .filter((m) => m.metatype?.name === 'ScheduleModule')
      .flatMap((m) => [...(m.providers.get(SchedulerRegistry)?.instance as SchedulerRegistry).getCronJobs().values()])
      .map((job) => String(job.cronTime.source))
      .sort();

  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
    vi.unstubAllEnvs();
  });

  it.each(combos)('SYNC=$sync SCRIM=$scrim RANKING=$ranking', async ({ sync, scrim, ranking }) => {
    const flags = {
      SYNC_JOBS_ENABLED: String(sync),
      SCRIM_JOBS_ENABLED: String(scrim),
      RANKING_JOBS_ENABLED: String(ranking),
    };
    for (const [k, v] of Object.entries(flags)) vi.stubEnv(k, v);
    vi.resetModules();
    const { createTestApp: freshApp } = await import('./support/test-app');
    t = await freshApp({ env: flags });

    const expected = [...(sync ? SYNC_CRONS : []), ...(scrim ? SCRIM_CRONS : []), ...(ranking ? RANKING_CRONS : [])].sort();
    expect(cronSources(t.app)).toEqual(expected);
    expect(moduleCount(t.app, 'ScheduleModule')).toBe(expected.length === 0 ? 0 : 1);
    expect(moduleCount(t.app, 'ScrimsModule')).toBe(1);
    expect(moduleCount(t.app, 'RankingsModule')).toBe(1);
    expect(providerCount(t.app, 'RankingJobsScheduler')).toBe(ranking ? 1 : 0);
    expect(providerCount(t.app, 'ScrimAutoCloseScheduler')).toBe(scrim ? 1 : 0);
    expect(providerCount(t.app, 'SyncScheduler')).toBe(sync ? 1 : 0);
  });
});
