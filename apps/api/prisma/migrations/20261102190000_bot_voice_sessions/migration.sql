-- 봇 프로세스(apps/bot)가 재시작 후에도 음성 세션과 보낸 알림을 잇기 위한 표.
-- API는 이 표를 읽지 않는다. 스키마는 여기서만 만든다.
-- 부분 고유 인덱스 bot_voice_sessions_one_open_per_member 는 Prisma 모델 밖에 있다(S1 대표 계정 인덱스와 같은 방식).

CREATE TABLE "bot_voice_sessions" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "game" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bot_voice_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bot_voice_sessions_guild_id_closed_at_idx" ON "bot_voice_sessions"("guild_id", "closed_at");

CREATE UNIQUE INDEX "bot_voice_sessions_one_open_per_member" ON "bot_voice_sessions"("guild_id", "discord_id") WHERE "closed_at" IS NULL;

CREATE TABLE "bot_direct_messages" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_direct_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_dms_recipient_key" ON "bot_direct_messages"("kind", "resource_id", "scheduled_at", "discord_id");

CREATE TABLE "bot_outbound_deliveries" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_outbound_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_outbound_deliveries_kind_resource_id_key" ON "bot_outbound_deliveries"("kind", "resource_id");
