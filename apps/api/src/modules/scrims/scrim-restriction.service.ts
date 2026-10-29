import { Inject, Injectable } from '@nestjs/common';
import {
  type NoShowPolicy,
  type ScrimRestrictionState,
  computeScrimRestriction,
  noShowLookbackStart,
} from '@gcd/core';
import { GetMyScrimRestrictionResponse } from '@gcd/shared';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

type Reader = Pick<Prisma.TransactionClient, 'scrimPlayer'>;

/**
 * 노쇼 제한 판정(계약 S2 5-6, 문서 7-4, D83). 캐시 컬럼 없이 요청마다 계산한다.
 * 조회: 그 사용자의 no_show 행 중 no_show_marked_at > noShowLookbackStart(now) (인덱스 (user_id, status, no_show_marked_at)).
 * 판정: core computeScrimRestriction. lastNoShowAt은 조회 범위(window + restriction일) 안의 값만 본다
 * — 그보다 오래된 노쇼는 판정에 영향이 없어 별도 조회하지 않는다(null일 수 있음).
 */
@Injectable()
export class ScrimRestrictionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  get policy(): NoShowPolicy {
    return this.config.scrim.noShow;
  }

  async compute(userId: string, now: Date, client: Reader = this.prisma): Promise<ScrimRestrictionState> {
    const rows = await client.scrimPlayer.findMany({
      where: { userId, status: 'no_show', noShowMarkedAt: { gt: noShowLookbackStart(now, this.policy) } },
      select: { noShowMarkedAt: true },
    });
    const marks = rows.map((r) => r.noShowMarkedAt).filter((d): d is Date => d instanceof Date);
    return computeScrimRestriction(marks, now, this.policy);
  }

  /** 새 참가·새 대기 등록·작성 전에 호출. 제한 중이면 SCRIM_BANNED + Retry-After(해제까지 초, 올림) */
  async assertNotRestricted(userId: string, now: Date, client: Reader = this.prisma): Promise<void> {
    const state = await this.compute(userId, now, client);
    if (state.restricted && state.until) {
      throw new AppError('SCRIM_BANNED', undefined, {
        retryAfterSec: Math.ceil((state.until.getTime() - now.getTime()) / 1000),
      });
    }
  }

  /** GET /me/scrim-restriction */
  async getMine(userId: string): Promise<GetMyScrimRestrictionResponse> {
    const now = this.clock.now();
    const s = await this.compute(userId, now);
    return GetMyScrimRestrictionResponse.parse({
      restricted: s.restricted,
      until: s.restricted && s.until ? s.until.toISOString() : null,
      recent_no_show_count: s.recentCount,
      last_no_show_at: s.lastNoShowAt ? s.lastNoShowAt.toISOString() : null,
      policy: {
        threshold: this.policy.threshold,
        window_days: this.policy.windowDays,
        restriction_days: this.policy.restrictionDays,
      },
    });
  }
}
