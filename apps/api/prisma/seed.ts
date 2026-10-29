/**
 * games 시드. 기준값은 @gcd/shared GAME_SEED 한 곳이다.
 * 실행: corepack pnpm --filter api prisma:seed  (DATABASE_URL 필요)
 * code 기준 upsert라 여러 번 실행해도 안전하다.
 */
import { PrismaClient } from '@prisma/client';
import { GAME_SEED } from '@gcd/shared';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const g of GAME_SEED) {
    const data = {
      name: g.name,
      hasPositions: g.has_positions,
      hasTeams: g.has_teams,
      positions: g.positions,
      sortOrder: g.sort_order,
      capacityMin: g.capacity_min,
      capacityMax: g.capacity_max,
      capacityDefault: g.capacity_default,
      capacityStep: g.capacity_step,
      startRequiresFull: g.start_requires_full,
      requiresSteamApp: g.requires_steam_app,
    };
    await prisma.game.upsert({
      where: { code: g.code },
      create: { code: g.code, ...data },
      update: data,
    });
  }
  console.log(`seeded games: ${GAME_SEED.map((g) => g.code).join(', ')}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
