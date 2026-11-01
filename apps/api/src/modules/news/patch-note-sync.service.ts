import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PATCH_NOTE_AUTO_SUMMARY,
  PATCH_NOTE_AUTO_TITLE,
  firstPatchSlug,
  kstDateKey,
  patchNoteUrl,
  planPatchNoteInsert,
} from '@gcd/core';
import { writeAudit } from '../../common/audit';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { toDbDate } from '../../common/db-date';
import { type FetchLike, rawRequest, systemClock as httpClock } from '../../integrations/http';
import { PrismaService } from '../../prisma/prisma.service';

/** 여러 인스턴스가 같은 패치를 두 번 넣지 않게 하는 생산자 잠금(710_001–710_003 다음) */
export const LOCK_KEY_PATCH_NOTES = 710_004;
/** 목록 HTML이 이보다 크면 본문이 섞인 것으로 보고 버린다 */
export const PATCH_LISTING_MAX_BYTES = 1_000_000;
const LISTING_TIMEOUT_MS = 10_000;

const LISTINGS = {
  lol: 'https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/',
  tft: 'https://teamfighttactics.leagueoflegends.com/ko-kr/news/tags/patch-notes/',
} as const;

const GAME_LABEL = { lol: '롤', tft: '롤체' } as const;

type PatchGame = keyof typeof LISTINGS;

export const PATCH_LISTING_FETCH = Symbol('PATCH_LISTING_FETCH');

export const defaultPatchListingFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * 롤·롤체 패치노트 목록에서 최신 슬러그만 읽어 글을 하나 만든다.
 * Data Dragon 버전은 공개 패치 번호와 달라 쓰지 않는다. 글 페이지는 열지 않는다.
 */
@Injectable()
export class PatchNoteSyncService {
  private readonly log = new Logger('PatchNoteSync');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
    @Inject(PATCH_LISTING_FETCH) private readonly fetchFn: FetchLike,
  ) {}

  async sync(): Promise<void> {
    const listings = await Promise.all(
      (Object.keys(LISTINGS) as PatchGame[]).map(async (game) => ({ game, html: await this.listing(game) })),
    );
    const now = this.clock.now();
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY_PATCH_NOTES}) AS ok`;
        if (!locked[0]?.ok) {
          this.log.log('패치노트 동기화를 다른 인스턴스가 진행 중이라 건너뛰었어요.');
          return;
        }
        for (const { game, html } of listings) {
          if (!html) continue;
          const latest = firstPatchSlug(html, game);
          if (!latest) {
            this.log.warn(`${GAME_LABEL[game]} 패치노트 목록에서 버전을 찾지 못했어요.`);
            continue;
          }
          const gameRow = await tx.game.findUnique({ where: { code: game }, select: { id: true } });
          if (!gameRow) {
            this.log.warn(`${GAME_LABEL[game]} 게임 행이 없어 패치노트를 올리지 않았어요.`);
            continue;
          }
          const stored = await tx.patchNote.findMany({ where: { gameId: gameRow.id }, select: { version: true } });
          const plan = planPatchNoteInsert(latest, stored.map((row) => row.version));
          if (!plan) continue;
          const url = patchNoteUrl(game, latest);
          const publishedOn = kstDateKey(now);
          const created = await tx.patchNote.create({
            data: {
              gameId: gameRow.id,
              version: plan.version,
              title: PATCH_NOTE_AUTO_TITLE,
              summary: PATCH_NOTE_AUTO_SUMMARY,
              url,
              publishedOn: toDbDate(publishedOn),
              notifyDiscord: plan.notifyDiscord,
              autoRegistered: true,
              createdById: null,
              createdAt: now,
              updatedAt: now,
            },
          });
          await writeAudit(tx, {
            actorId: null,
            action: 'patch_note.create',
            targetId: created.id,
            summary: `${GAME_LABEL[game]} ${plan.version} 패치노트 자동 등록`,
            details: {
              game,
              version: plan.version,
              title: PATCH_NOTE_AUTO_TITLE,
              summary: PATCH_NOTE_AUTO_SUMMARY,
              url,
              published_on: publishedOn,
              notify_discord: plan.notifyDiscord,
              auto_registered: true,
            },
            at: now,
          });
          this.log.log(`${GAME_LABEL[game]} ${plan.version} 패치노트를 올렸어요.`);
        }
      },
      { timeout: 30_000 },
    );
  }

  private async listing(game: PatchGame): Promise<string | null> {
    try {
      const res = await rawRequest(this.fetchFn, LISTINGS[game], { method: 'GET' }, LISTING_TIMEOUT_MS, httpClock);
      if (res.status < 200 || res.status >= 300) {
        this.log.warn(`${GAME_LABEL[game]} 패치노트 목록을 읽지 못했어요.`);
        return null;
      }
      if (res.text.length > PATCH_LISTING_MAX_BYTES) {
        this.log.warn(`${GAME_LABEL[game]} 패치노트 목록이 너무 커서 건너뛰었어요.`);
        return null;
      }
      return res.text;
    } catch {
      this.log.warn(`${GAME_LABEL[game]} 패치노트 목록을 읽지 못했어요.`);
      return null;
    }
  }
}
