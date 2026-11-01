import { Inject, Injectable, Logger } from '@nestjs/common';
import { planAutoSeason, resolveSeasonAt } from '@gcd/core';
import { ListSeasonsResponse, type SeasonRef } from '@gcd/shared';
import type { Prisma, Season } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { lockSeasonAutoCreate } from './rating-locks';

type Db = Pick<Prisma.TransactionClient, 'season'>;
type Tx = Prisma.TransactionClient;

export function seasonRef(s: Pick<Season, 'id' | 'name' | 'startsAt' | 'endsAt'>): SeasonRef {
  return { id: s.id, name: s.name, starts_at: s.startsAt.toISOString(), ends_at: s.endsAt.toISOString() };
}

/**
 * 시즌(계약 S3 6절, D116). 조회 경로는 시즌을 만들지 않는다. 자동 생성은 결과 승인 트랜잭션(ensureForApproval)에서만.
 */
@Injectable()
export class SeasonsService {
  private readonly log = new Logger('SeasonsService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  all(db: Db = this.prisma): Promise<Season[]> {
    return db.season.findMany({ orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] });
  }

  /** now가 속한 시즌(core resolveSeasonAt). 없으면 null — 만들지 않는다 */
  async currentAt(now: Date, db: Db = this.prisma): Promise<Season | null> {
    return resolveSeasonAt(await this.all(db), now);
  }

  /** GET /seasons — 전체(starts_at DESC, id ASC), is_current = resolveSeasonAt(now)가 고른 행 */
  async list(): Promise<ListSeasonsResponse> {
    const rows = await this.all();
    const current = resolveSeasonAt(rows, this.clock.now());
    return ListSeasonsResponse.parse({
      items: rows.map((s) => ({ ...seasonRef(s), is_current: current !== null && s.id === current.id })),
      next_cursor: null,
    });
  }

  /**
   * 승인 7a단계(내전 행 잠금 뒤, 사용자 잠금 전 — D117 순서). 승인 시각 now는 사용자 잠금을 얻은 뒤에 정해지므로
   * 지금(at) 시점에 판정한다: at에 시즌이 없거나, 있어도 marginMs(= 트랜잭션 timeout) 안에 끝나면
   * now 시점에 자동 생성이 필요할 수 있어 season-auto-create 잠금을 미리 잡는다. 반환: 잠금을 잡았는가.
   * 시즌 구간이 at + marginMs 이후까지 이어지면 트랜잭션 안의 now(< at + timeout)도 그 시즌에 속하므로 생성이 필요 없다.
   */
  async lockIfMayCreate(tx: Tx, at: Date, marginMs: number): Promise<boolean> {
    const cur = resolveSeasonAt(await this.all(tx), at);
    if (cur && cur.endsAt.getTime() - at.getTime() > marginMs) return false;
    await lockSeasonAutoCreate(tx);
    return true;
  }

  /**
   * 승인 7b단계(모든 잠금 뒤, now 확정 후): now가 속한 시즌. 없으면 core planAutoSeason으로 1개 insert.
   * 생성은 season-auto-create 잠금을 쥔 경우에만(lockIfMayCreate의 margin 규칙상 잠금 없이 여기 오면 계산 오류 → 롤백).
   */
  async resolveForApproval(tx: Tx, now: Date, holdsCreateLock: boolean): Promise<Season> {
    const seasons = await this.all(tx);
    const found = resolveSeasonAt(seasons, now);
    if (found) return found;
    if (!holdsCreateLock) {
      this.log.error(`승인 시각 ${now.toISOString()}에 시즌이 없는데 시즌 생성 잠금이 없음(트랜잭션 timeout 초과 의심)`);
      throw new AppError('INTERNAL_ERROR');
    }
    const plan = planAutoSeason({ seasons, at: now, lengthMonths: this.config.seasonAutoLengthMonths });
    const created = await tx.season.create({ data: { name: plan.name, startsAt: plan.startsAt, endsAt: plan.endsAt } });
    this.log.log(`시즌 자동 생성 ${created.name} ${plan.startsAt.toISOString()} ~ ${plan.endsAt.toISOString()}`);
    return created;
  }
}
