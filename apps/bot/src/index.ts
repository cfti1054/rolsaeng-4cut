import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { BotApiClient } from './api-client';
import { slashCommandBody } from './commands/definitions';
import { handleInteraction } from './commands/handle';
import { discordErrorCode, isPermanentDiscordCode } from './discord-error';
import { loadLocalEnvFile, readBotEnv } from './env';
import { collectSnapshot, liveMembers } from './events/collect';
import { mapActivityName } from './game-map';
import {
  applyVoiceRecovery,
  deliverNotices,
  deliverPatchNotes,
  DmError,
  flushActivities,
  notifyUpcomingScrims,
} from './jobs';
import { log } from './log';
import { createMemberBuffer } from './member-buffer';
import { createBotStore, createPool, poolClient } from './session-store';
import { formatIsoWithKstOffset } from './time';
import { handleVoiceState, notePlayingGame } from './voice-handler';
import { planVoiceRecovery } from './voice-session';

/**
 * 디스코드 봇 프로세스.
 * 채팅 활동은 정책이 정해지기 전까지 모으지 않는다(Message Content 인텐트 없음).
 * 결과·대기 승격 DM은 계약 Q12가 정해지기 전까지 없다. 내전 시작 DM은 계약 D222.
 * 개발자 포털에서 Server Members, Presence 인텐트를 켜야 입퇴장과 플레이 상태가 온다.
 */

const PRESENCE_DEBOUNCE_MS = 5_000;
const TICK_MS = 60_000;
const SCRIM_WITHIN_MIN = 30;
const SHUTDOWN_MS = 8_000;

export async function main(): Promise<void> {
  loadLocalEnvFile();
  const env = readBotEnv();
  const pool = createPool(env.DATABASE_URL);
  const store = createBotStore(poolClient(pool));
  const api = new BotApiClient({ baseUrl: env.API_BASE_URL, apiKey: env.BOT_API_KEY });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildPresences,
    ],
    allowedMentions: { parse: [] },
  });

  let stopping = false;
  let chain: Promise<void> = Promise.resolve();
  const timers: NodeJS.Timeout[] = [];
  let presenceTimer: NodeJS.Timeout | null = null;
  let lastCaptureMs = 0;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const members = createMemberBuffer(async (events) => {
    const res = await api.postMemberEvents({ events });
    const applied = res.results.filter((row) => row.status === 'applied').length;
    log.info('member events sent', { count: res.results.length, applied });
  }, log);

  async function publishPresence(): Promise<void> {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    let ms = Date.now();
    if (ms <= lastCaptureMs) ms = lastCaptureMs + 1;
    lastCaptureMs = ms;
    const body = collectSnapshot(guild, client.user?.id ?? null, new Date(ms));
    const res = await api.putPresence(body);
    log.info('presence', {
      accepted: res.accepted,
      voice: body.voice_member_count,
      playing: body.playing.length,
      reason: res.reason,
    });
  }

  async function reconcile(): Promise<void> {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const open = await store.listOpen(env.DISCORD_GUILD_ID);
    const plan = planVoiceRecovery(open, liveMembers(guild, client.user?.id ?? null), new Date());
    await applyVoiceRecovery(store, env.DISCORD_GUILD_ID, plan);
    await flushActivities(store, api, env.DISCORD_GUILD_ID, log);
  }

  function schedulePresence(): void {
    if (presenceTimer || stopping) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      if (stopping) return;
      void enqueue(() => publishPresence()).catch((err: unknown) => {
        log.error('presence failed', { reason: err instanceof Error ? err.name : 'error' });
      });
    }, PRESENCE_DEBOUNCE_MS);
  }

  async function sendDm(discordId: string, embed: { title: string; description: string; url?: string }): Promise<void> {
    try {
      const user = await client.users.fetch(discordId);
      await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      throw new DmError(isPermanentDiscordCode(discordErrorCode(err)));
    }
  }

  async function postNotice(embed: { title: string; description: string; url?: string }): Promise<void> {
    const channel = await client.channels.fetch(env.DISCORD_NOTICE_CHANNEL_ID);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      throw new Error('notice channel');
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (stopping) return;
    const user = newState.member?.user ?? oldState.member?.user;
    void enqueue(async () => {
      if (stopping) return;
      await handleVoiceState(
        store,
        env.DISCORD_GUILD_ID,
        {
          guildId: newState.guild.id,
          discordId: newState.id,
          bot: user?.bot === true,
          beforeChannelId: oldState.channelId,
          afterChannelId: newState.channelId,
          at: new Date(),
        },
        () => flushActivities(store, api, env.DISCORD_GUILD_ID, log),
      );
      schedulePresence();
    }).catch((err: unknown) => {
      log.error('voice failed', { reason: err instanceof Error ? err.name : 'error' });
    });
  });

  client.on(Events.PresenceUpdate, (_oldPresence, presence) => {
    if (stopping || presence.guild?.id !== env.DISCORD_GUILD_ID) return;
    const activity = presence.activities.find((item) => item.type === ActivityType.Playing && item.name.trim().length > 0);
    const game = activity ? mapActivityName(activity.name).game : null;
    void enqueue(async () => {
      if (stopping || !presence.userId) return;
      await notePlayingGame(store, env.DISCORD_GUILD_ID, presence.userId, presence.user?.bot === true, game);
      schedulePresence();
    }).catch((err: unknown) => {
      log.error('presence update failed', { reason: err instanceof Error ? err.name : 'error' });
    });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    if (stopping || member.guild.id !== env.DISCORD_GUILD_ID || member.user.bot) return;
    members.push({
      discord_id: member.id,
      type: 'join',
      occurred_at: formatIsoWithKstOffset(member.joinedAt ?? new Date()),
    });
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (stopping || member.guild.id !== env.DISCORD_GUILD_ID || member.user?.bot) return;
    members.push({
      discord_id: member.id,
      type: 'leave',
      occurred_at: formatIsoWithKstOffset(new Date()),
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, { guildId: env.DISCORD_GUILD_ID, api }).catch((err: unknown) => {
      log.error('command failed', { reason: err instanceof Error ? err.name : 'error' });
    });
  });

  async function registerCommands(): Promise<void> {
    if (!client.user) return;
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, env.DISCORD_GUILD_ID), { body: slashCommandBody() });
    log.info('commands registered', {});
  }

  function startTimers(): void {
    timers.push(
      setInterval(() => {
        if (stopping) return;
        void enqueue(async () => {
          if (stopping) return;
          await reconcile();
          await publishPresence();
        }).catch((err: unknown) => log.error('voice tick failed', { reason: err instanceof Error ? err.name : 'error' }));
      }, TICK_MS),
    );
    timers.push(
      setInterval(() => {
        if (stopping) return;
        void enqueue(async () => {
          if (stopping) return;
          await deliverNotices({
            store,
            pending: () => api.pendingNotices(),
            deliver: (id) => api.deliverNotice(id),
            post: postNotice,
            logger: log,
          });
          await deliverPatchNotes({
            store,
            pending: () => api.pendingPatchNotes(),
            deliver: (id) => api.deliverPatchNote(id),
            send: sendDm,
            logger: log,
          });
          await members.flush();
        }).catch((err: unknown) => log.error('outbox tick failed', { reason: err instanceof Error ? err.name : 'error' }));
      }, TICK_MS),
    );
    timers.push(
      setInterval(() => {
        if (stopping) return;
        void enqueue(async () => {
          if (stopping) return;
          await notifyUpcomingScrims({
            store,
            withinMin: SCRIM_WITHIN_MIN,
            load: (withinMin) => api.upcomingScrims(withinMin),
            send: sendDm,
            logger: log,
          });
        }).catch((err: unknown) => log.error('scrim tick failed', { reason: err instanceof Error ? err.name : 'error' }));
      }, TICK_MS),
    );
  }

  function shutdown(signal: string): void {
    if (stopping) return;
    stopping = true;
    log.info('shutdown', { signal });
    for (const timer of timers) clearInterval(timer);
    if (presenceTimer) clearTimeout(presenceTimer);
    members.stop();
    const force = setTimeout(() => process.exit(1), SHUTDOWN_MS);
    force.unref();
    void enqueue(async () => {
      const now = new Date();
      const open = await store.listOpen(env.DISCORD_GUILD_ID);
      for (const session of open) await store.close(session.id, now);
      await flushActivities(store, api, env.DISCORD_GUILD_ID, log);
      await members.flush();
      client.destroy();
      await pool.end();
    })
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        log.error('shutdown failed', { reason: err instanceof Error ? err.name : 'error' });
        process.exit(1);
      });
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  /** 기동 단계 하나가 실패해도 나머지 단계와 주기 작업은 돈다. 실패한 단계는 다음 주기에 다시 한다. */
  async function startupStep(name: string, task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (err) {
      log.error('startup step failed', { step: name, reason: err instanceof Error ? err.name : 'error' });
    }
  }

  client.once(Events.ClientReady, () => {
    if (stopping) return;
    startTimers();
    void enqueue(async () => {
      if (stopping) return;
      await startupStep('commands', registerCommands);
      await startupStep('reconcile', reconcile);
      await startupStep('presence', publishPresence);
      await startupStep('notices', () =>
        deliverNotices({
          store,
          pending: () => api.pendingNotices(),
          deliver: (id) => api.deliverNotice(id),
          post: postNotice,
          logger: log,
        }),
      );
      await startupStep('patch-notes', () =>
        deliverPatchNotes({
          store,
          pending: () => api.pendingPatchNotes(),
          deliver: (id) => api.deliverPatchNote(id),
          send: sendDm,
          logger: log,
        }),
      );
      await startupStep('scrims', () =>
        notifyUpcomingScrims({
          store,
          withinMin: SCRIM_WITHIN_MIN,
          load: (withinMin) => api.upcomingScrims(withinMin),
          send: sendDm,
          logger: log,
        }),
      );
      log.info('ready', { user: client.user?.username ?? '' });
    });
  });

  await client.login(env.DISCORD_BOT_TOKEN);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'error';
    const safe = message.startsWith('환경 변수') ? message : err instanceof Error ? err.name : 'error';
    log.error('startup failed', { reason: safe });
    process.exit(1);
  });
}
