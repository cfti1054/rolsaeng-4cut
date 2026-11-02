import { randomUUID } from 'node:crypto';
import type { GameCode } from '@gcd/shared';
import { GameCode as GameCodeSchema } from '@gcd/shared';
import { Pool } from 'pg';
import { parseDatabaseUrl } from './database-url';
import type { VoiceSession } from './voice-session';

/** 패치노트 DM에는 시작 시각이 없다. 유일 키를 맞추려고 이 시각을 넣는다. */
export const PATCH_DM_SCHEDULED_AT = new Date(0);

export type NewVoiceSession = {
  guildId: string;
  discordId: string;
  channelId: string;
  startedAt: Date;
  game: GameCode | null;
};

export type DirectKind = 'scrim' | 'patch';
export type OutboundKind = 'notice' | 'patch';

export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export type BotStore = {
  insertOpen(input: NewVoiceSession): Promise<VoiceSession>;
  findOpen(guildId: string, discordId: string): Promise<VoiceSession | null>;
  listOpen(guildId: string): Promise<VoiceSession[]>;
  touch(id: string, patch: { channelId: string; lastSeenAt: Date }): Promise<void>;
  setGame(id: string, game: GameCode | null): Promise<void>;
  close(id: string, closedAt: Date): Promise<void>;
  listPending(guildId: string, limit: number): Promise<VoiceSession[]>;
  markDelivered(id: string): Promise<void>;
  wasDirectMessage(kind: DirectKind, resourceId: string, scheduledAt: Date, discordId: string): Promise<boolean>;
  markDirectMessage(kind: DirectKind, resourceId: string, scheduledAt: Date, discordId: string): Promise<void>;
  hasOutbound(kind: OutboundKind, resourceId: string): Promise<boolean>;
  markOutbound(kind: OutboundKind, resourceId: string): Promise<void>;
};

type SessionRow = {
  id: string;
  guild_id: string;
  discord_id: string;
  channel_id: string;
  started_at: Date | string;
  last_seen_at: Date | string;
  game: string | null;
  closed_at: Date | string | null;
};

const SESSION_COLUMNS = 'id, guild_id, discord_id, channel_id, started_at, last_seen_at, game, closed_at';

function asDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${field}: 시각이 아님`);
  return date;
}

function asGame(value: unknown): GameCode | null {
  if (typeof value !== 'string') return null;
  const parsed = GameCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function mapSession(row: SessionRow): VoiceSession {
  return {
    id: row.id,
    guildId: row.guild_id,
    discordId: row.discord_id,
    channelId: row.channel_id,
    startedAt: asDate(row.started_at, 'started_at'),
    lastSeenAt: asDate(row.last_seen_at, 'last_seen_at'),
    game: asGame(row.game),
    closedAt: row.closed_at == null ? null : asDate(row.closed_at, 'closed_at'),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

export function createBotStore(db: SqlClient): BotStore {
  async function rows(sql: string, params: unknown[] = []): Promise<unknown[]> {
    const result = await db.query(sql, params);
    return result.rows;
  }

  async function findOpen(guildId: string, discordId: string): Promise<VoiceSession | null> {
    const found = await rows(
      `SELECT ${SESSION_COLUMNS} FROM bot_voice_sessions
       WHERE guild_id = $1 AND discord_id = $2 AND closed_at IS NULL`,
      [guildId, discordId],
    );
    const row = found[0] as SessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  async function listOpen(guildId: string): Promise<VoiceSession[]> {
    const found = await rows(
      `SELECT ${SESSION_COLUMNS} FROM bot_voice_sessions
       WHERE guild_id = $1 AND closed_at IS NULL
       ORDER BY started_at ASC, id ASC`,
      [guildId],
    );
    return found.map((row) => mapSession(row as SessionRow));
  }

  async function touch(id: string, patch: { channelId: string; lastSeenAt: Date }): Promise<void> {
    await rows(
      `UPDATE bot_voice_sessions
       SET channel_id = $2, last_seen_at = $3, updated_at = now()
       WHERE id = $1 AND closed_at IS NULL`,
      [id, patch.channelId, patch.lastSeenAt],
    );
  }

  async function insertOpen(input: NewVoiceSession): Promise<VoiceSession> {
    const id = randomUUID();
    try {
      const inserted = await rows(
        `INSERT INTO bot_voice_sessions
           (id, guild_id, discord_id, channel_id, started_at, last_seen_at, game, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, now(), now())
         RETURNING ${SESSION_COLUMNS}`,
        [id, input.guildId, input.discordId, input.channelId, input.startedAt, input.game],
      );
      const row = inserted[0] as SessionRow | undefined;
      if (!row) throw new Error('insert voice session: no row');
      return mapSession(row);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await findOpen(input.guildId, input.discordId);
      if (!existing) throw err;
      await touch(existing.id, { channelId: input.channelId, lastSeenAt: input.startedAt });
      return { ...existing, channelId: input.channelId, lastSeenAt: input.startedAt };
    }
  }

  async function setGame(id: string, game: GameCode | null): Promise<void> {
    await rows(
      `UPDATE bot_voice_sessions SET game = $2, updated_at = now() WHERE id = $1 AND closed_at IS NULL`,
      [id, game],
    );
  }

  async function close(id: string, closedAt: Date): Promise<void> {
    await rows(
      `UPDATE bot_voice_sessions SET closed_at = $2, updated_at = now() WHERE id = $1 AND closed_at IS NULL`,
      [id, closedAt],
    );
  }

  async function listPending(guildId: string, limit: number): Promise<VoiceSession[]> {
    const found = await rows(
      `SELECT ${SESSION_COLUMNS} FROM bot_voice_sessions
       WHERE guild_id = $1 AND closed_at IS NOT NULL AND delivered_at IS NULL
       ORDER BY closed_at ASC, id ASC
       LIMIT $2`,
      [guildId, limit],
    );
    return found.map((row) => mapSession(row as SessionRow));
  }

  async function markDelivered(id: string): Promise<void> {
    await rows(
      `UPDATE bot_voice_sessions SET delivered_at = now(), updated_at = now() WHERE id = $1 AND delivered_at IS NULL`,
      [id],
    );
  }

  async function wasDirectMessage(
    kind: DirectKind,
    resourceId: string,
    scheduledAt: Date,
    discordId: string,
  ): Promise<boolean> {
    const found = await rows(
      `SELECT id FROM bot_direct_messages
       WHERE kind = $1 AND resource_id = $2 AND scheduled_at = $3 AND discord_id = $4
       LIMIT 1`,
      [kind, resourceId, scheduledAt, discordId],
    );
    return found.length > 0;
  }

  async function markDirectMessage(
    kind: DirectKind,
    resourceId: string,
    scheduledAt: Date,
    discordId: string,
  ): Promise<void> {
    await rows(
      `INSERT INTO bot_direct_messages (id, kind, resource_id, scheduled_at, discord_id, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (kind, resource_id, scheduled_at, discord_id) DO NOTHING`,
      [randomUUID(), kind, resourceId, scheduledAt, discordId],
    );
  }

  async function hasOutbound(kind: OutboundKind, resourceId: string): Promise<boolean> {
    const found = await rows(
      `SELECT id FROM bot_outbound_deliveries WHERE kind = $1 AND resource_id = $2 LIMIT 1`,
      [kind, resourceId],
    );
    return found.length > 0;
  }

  async function markOutbound(kind: OutboundKind, resourceId: string): Promise<void> {
    await rows(
      `INSERT INTO bot_outbound_deliveries (id, kind, resource_id, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (kind, resource_id) DO NOTHING`,
      [randomUUID(), kind, resourceId],
    );
  }

  return {
    insertOpen,
    findOpen,
    listOpen,
    touch,
    setGame,
    close,
    listPending,
    markDelivered,
    wasDirectMessage,
    markDirectMessage,
    hasOutbound,
    markOutbound,
  };
}

export function createPool(databaseUrl: string): Pool {
  const { connectionString, ssl } = parseDatabaseUrl(databaseUrl);
  return new Pool({ connectionString, max: 4, ...(ssl ? { ssl } : {}) });
}

export function poolClient(pool: Pool): SqlClient {
  return {
    query: async (sql, params) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows as unknown[] };
    },
  };
}
