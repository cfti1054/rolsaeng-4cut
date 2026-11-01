import { Inject, Injectable } from '@nestjs/common';
import {
  type SeasonWriteIssue,
  resolveSeasonAt,
  seasonEditable,
  seasonPhase,
  validateSeasonDelete,
  validateSeasonWrite,
} from '@gcd/core';
import {
  AdminSeasonItem,
  type CreateSeasonRequest,
  ListAdminSeasonsResponse,
  SEASON_EDIT_MIN_LEAD_SEC,
  SEASON_LENGTH_MAX_DAYS,
  SEASON_LENGTH_MIN_DAYS,
  type UpdateSeasonRequest,
} from '@gcd/shared';
import { Prisma, type Season } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { auditDiff, auditQuote, writeAudit } from '../../common/audit';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { SCRIM_TX_MAX_WAIT_MS, SCRIM_TX_TIMEOUT_MS } from '../../common/scrim-tx';
import { PrismaService } from '../../prisma/prisma.service';
import { lockSeasonAutoCreate } from '../ratings/rating-locks';
import { seasonRef } from '../ratings/seasons.service';

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, 'season' | 'ratingHistory'>;

const DAY_MS = 86_400_000;

export const SEASON_WRITE_POLICY = {
  minLeadMs: SEASON_EDIT_MIN_LEAD_SEC * 1000,
  minLengthMs: SEASON_LENGTH_MIN_DAYS * DAY_MS,
  maxLengthMs: SEASON_LENGTH_MAX_DAYS * DAY_MS,
} as const;

/**
 * 시즌 쓰기 트랜잭션 상한(QA minor 1). 대상 행 FOR NO KEY UPDATE는 진행 중 승인·되돌리기의 시즌 FOR SHARE(상한 SCRIM_TX_TIMEOUT_MS 15초)가
 * 끝나기를 기다릴 수 있으므로 그보다 길게 잡는다. maxWait는 내전 쓰기와 같다. season-closer.ts처럼 명시한다.
 */
export const SEASON_WRITE_TX_OPTIONS = {
  timeout: SCRIM_TX_TIMEOUT_MS * 2,
  maxWait: SCRIM_TX_MAX_WAIT_MS,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

/** core 판정 결과 → 오류(11-2 판정 순서: not_editable → invalid → overlap, 첫 종류만 응답. invalid는 details에 전부) */
function throwIssues(issues: readonly SeasonWriteIssue[]): void {
  const first = issues[0];
  if (!first) return;
  if (first.kind === 'not_editable') {
    throw new AppError('SEASON_NOT_EDITABLE', undefined, {
      message: `이 시즌 단계에서는 바꿀 수 없습니다(${issues
        .filter((i) => i.kind === 'not_editable')
        .map((i) => (i.kind === 'not_editable' ? i.field : ''))
        .join(', ')}).`,
    });
  }
  if (first.kind === 'invalid') {
    throw new AppError('VALIDATION_FAILED', undefined, {
      details: issues.flatMap((i) => (i.kind === 'invalid' ? [{ path: i.path, message: i.message }] : [])),
    });
  }
  throw new AppError('SEASON_OVERLAP');
}

/** 수정·삭제 대상 행 잠금(11-3 2단계). 진행 중 승인(FOR SHARE)·종료 작업(FOR NO KEY UPDATE)과 직렬화 */
async function lockSeasonRow(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id, closed_at FROM seasons WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  return rows.length > 0;
}

/**
 * S6 시즌 관리(계약 S6 11절, D268–D271). 쓰기는 scrimWriteTx가 아닌 별도 $transaction READ COMMITTED:
 * season-auto-create advisory → (수정·삭제) 대상 행 FOR NO KEY UPDATE → now 확정 → season.findMany → core 판정 → 쓰기 + 감사.
 */
@Injectable()
export class AdminSeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  private async items(db: Db, rows: readonly Season[], all: readonly Season[], now: Date): Promise<AdminSeasonItem[]> {
    if (rows.length === 0) return [];
    const current = resolveSeasonAt(all, now);
    const pairs = await db.ratingHistory.groupBy({
      by: ['seasonId', 'scrimId'],
      where: { seasonId: { in: rows.map((r) => r.id) } },
    });
    const rated = new Map<string, number>();
    for (const p of pairs) rated.set(p.seasonId, (rated.get(p.seasonId) ?? 0) + 1);
    return rows.map((s) => {
      const phase = seasonPhase(s, now);
      const e = seasonEditable(phase);
      return AdminSeasonItem.parse({
        ...seasonRef(s),
        is_current: current !== null && current.id === s.id,
        phase,
        closed_at: s.closedAt?.toISOString() ?? null,
        rated_games: rated.get(s.id) ?? 0,
        editable: { name: e.name, starts_at: e.startsAt, ends_at: e.endsAt, delete: e.delete },
      });
    });
  }

  private all(db: Db): Promise<Season[]> {
    return db.season.findMany({ orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] });
  }

  /** GET /admin/seasons — starts_at DESC, id ASC, 페이징 없음 */
  async list(): Promise<ListAdminSeasonsResponse> {
    const now = this.clock.now();
    const rows = await this.all(this.prisma);
    return ListAdminSeasonsResponse.parse({ items: await this.items(this.prisma, rows, rows, now), next_cursor: null });
  }

  async create(admin: AuthUser, body: CreateSeasonRequest): Promise<AdminSeasonItem> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockSeasonAutoCreate(tx);
        const now = this.clock.now();
        const seasons = await this.all(tx);
        const next = { startsAt: new Date(body.starts_at), endsAt: new Date(body.ends_at) };
        throwIssues(
          validateSeasonWrite({ seasons, target: null, next, changed: { startsAt: true, endsAt: true }, now, policy: SEASON_WRITE_POLICY }),
        );
        const created = await tx.season.create({ data: { name: body.name, startsAt: next.startsAt, endsAt: next.endsAt, createdAt: now } });
        await writeAudit(tx, {
          actorId: admin.id,
          action: 'season.create',
          targetId: created.id,
          summary: `시즌 ${auditQuote(created.name)} 생성`,
          details: { name: created.name, starts_at: created.startsAt, ends_at: created.endsAt },
          at: now,
        });
        const [item] = await this.items(tx, [created], [...seasons, created], now);
        return item as AdminSeasonItem;
      },
      SEASON_WRITE_TX_OPTIONS,
    );
  }

  async update(admin: AuthUser, id: string, body: UpdateSeasonRequest): Promise<AdminSeasonItem> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockSeasonAutoCreate(tx);
        if (!(await lockSeasonRow(tx, id))) throw new AppError('NOT_FOUND');
        const now = this.clock.now();
        const seasons = await this.all(tx);
        const target = seasons.find((s) => s.id === id);
        if (!target) throw new AppError('NOT_FOUND');
        const startsAt = body.starts_at === undefined ? target.startsAt : new Date(body.starts_at);
        const endsAt = body.ends_at === undefined ? target.endsAt : new Date(body.ends_at);
        const changed = {
          startsAt: body.starts_at !== undefined && startsAt.getTime() !== target.startsAt.getTime(),
          endsAt: body.ends_at !== undefined && endsAt.getTime() !== target.endsAt.getTime(),
        };
        throwIssues(
          validateSeasonWrite({ seasons, target, next: { startsAt, endsAt }, changed, now, policy: SEASON_WRITE_POLICY }),
        );
        const diff = auditDiff(
          { name: target.name, starts_at: target.startsAt, ends_at: target.endsAt } as Record<string, unknown>,
          {
            name: body.name,
            starts_at: changed.startsAt ? startsAt : undefined,
            ends_at: changed.endsAt ? endsAt : undefined,
          },
        );
        let row = target;
        if (diff) {
          row = await tx.season.update({
            where: { id },
            data: {
              name: body.name,
              startsAt: changed.startsAt ? startsAt : undefined,
              endsAt: changed.endsAt ? endsAt : undefined,
            },
          });
          await writeAudit(tx, {
            actorId: admin.id,
            action: 'season.update',
            targetId: id,
            summary: `시즌 ${auditQuote(row.name)} 수정`,
            details: diff,
            at: now,
          });
        }
        const all = seasons.map((s) => (s.id === id ? row : s));
        const [item] = await this.items(tx, [row], all, now);
        return item as AdminSeasonItem;
      },
      SEASON_WRITE_TX_OPTIONS,
    );
  }

  async remove(admin: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await lockSeasonAutoCreate(tx);
        if (!(await lockSeasonRow(tx, id))) throw new AppError('NOT_FOUND');
        const now = this.clock.now();
        const target = await tx.season.findUnique({ where: { id } });
        if (!target) throw new AppError('NOT_FOUND');
        throwIssues(validateSeasonDelete(target, now));
        await tx.season.delete({ where: { id } });
        await writeAudit(tx, {
          actorId: admin.id,
          action: 'season.delete',
          targetId: id,
          summary: `시즌 ${auditQuote(target.name)} 삭제`,
          details: {
            id: target.id,
            name: target.name,
            starts_at: target.startsAt,
            ends_at: target.endsAt,
            closed_at: target.closedAt,
            created_at: target.createdAt,
          },
          at: now,
        });
      },
      SEASON_WRITE_TX_OPTIONS,
    );
  }
}
