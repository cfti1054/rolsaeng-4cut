import { Logger } from '@nestjs/common';
import { ScrimResultPlacementsJson, type ScrimResultStatus } from '@gcd/shared';
import type { Prisma } from '@prisma/client';

const logger = new Logger('ScrimResultJson');

/** 활성 결과 = pending 또는 approved(내전당 최대 1개, D113) */
export function isActiveResultStatus(s: ScrimResultStatus): boolean {
  return s === 'pending' || s === 'approved';
}

/**
 * scrim_results.placements(JSON) 읽기. 팀 게임 행(null)은 null. 형식이 깨졌으면 로그 후 null
 * (쓰기는 항상 ScrimResultPlacementsJson 모양으로 한다 — 깨진 행은 수동 수정 흔적).
 */
export function readPlacements(json: Prisma.JsonValue | null): ScrimResultPlacementsJson | null {
  if (json === null || json === undefined) return null;
  const r = ScrimResultPlacementsJson.safeParse(json);
  if (!r.success) {
    logger.error(`scrim_results.placements 형식 오류: ${JSON.stringify(r.error.issues)}`);
    return null;
  }
  return r.data;
}
