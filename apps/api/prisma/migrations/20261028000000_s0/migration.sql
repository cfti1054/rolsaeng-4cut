-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('member', 'admin');

-- CreateEnum
CREATE TYPE "scrim_status" AS ENUM ('recruiting', 'full', 'playing', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "scrim_player_status" AS ENUM ('joined', 'waitlist', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "scrim_team" AS ENUM ('blue', 'orange');

-- CreateEnum
CREATE TYPE "scrim_result_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('voice', 'chat', 'play');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "nickname" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'member',
    "discord_id" TEXT,
    "discord_username" TEXT,
    "discord_global_name" TEXT,
    "discord_avatar" TEXT,
    "discord_guild_verified_at" TIMESTAMPTZ(3),
    "nickname_confirmed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "notify_scrim_start" BOOLEAN NOT NULL DEFAULT true,
    "notify_result" BOOLEAN NOT NULL DEFAULT true,
    "notify_waitlist" BOOLEAN NOT NULL DEFAULT true,
    "notify_patch" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "has_positions" BOOLEAN NOT NULL DEFAULT false,
    "has_teams" BOOLEAN NOT NULL DEFAULT true,
    "positions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3),
    "verification_challenge" TEXT,
    "verification_expires_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3),
    "last_sync_error" TEXT,
    "last_sync_error_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_account_sync_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_account_sync_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_snapshots" (
    "id" UUID NOT NULL,
    "game_account_id" UUID NOT NULL,
    "queue" TEXT,
    "tier" TEXT NOT NULL,
    "division" TEXT,
    "lp" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recent_matches" (
    "id" UUID NOT NULL,
    "game_account_id" UUID NOT NULL,
    "external_match_id" TEXT NOT NULL,
    "played_at" TIMESTAMPTZ(3) NOT NULL,
    "win" BOOLEAN,
    "placement" INTEGER,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steam_playtime" (
    "id" UUID NOT NULL,
    "game_account_id" UUID NOT NULL,
    "app_id" INTEGER NOT NULL,
    "app_name" TEXT,
    "minutes_total" INTEGER NOT NULL DEFAULT 0,
    "minutes_recent" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steam_playtime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "elo" INTEGER NOT NULL DEFAULT 1000,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scrim_id" UUID NOT NULL,
    "scrim_result_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "elo_before" INTEGER NOT NULL,
    "elo_after" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_standings" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "elo" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrims" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "scrim_status" NOT NULL DEFAULT 'recruiting',
    "rules" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scrims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrim_players" (
    "id" UUID NOT NULL,
    "scrim_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "scrim_player_status" NOT NULL DEFAULT 'joined',
    "position" TEXT,
    "preferred_positions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "team" "scrim_team",
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "no_show_marked_at" TIMESTAMPTZ(3),
    "no_show_marked_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scrim_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrim_results" (
    "id" UUID NOT NULL,
    "scrim_id" UUID NOT NULL,
    "status" "scrim_result_status" NOT NULL DEFAULT 'pending',
    "winner_team" "scrim_team",
    "placements" JSONB,
    "submitted_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,
    "rejected_by" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scrim_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrim_result_disputes" (
    "id" UUID NOT NULL,
    "scrim_result_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrim_result_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "game_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "season_id" UUID,
    "earned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "notify_discord" BOOLEAN NOT NULL DEFAULT false,
    "discord_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_nickname_key" ON "users"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_id_key" ON "users"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "games_code_key" ON "games"("code");

-- CreateIndex
CREATE INDEX "game_accounts_user_id_idx" ON "game_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_accounts_game_id_external_id_key" ON "game_accounts"("game_id", "external_id");

-- CreateIndex
CREATE INDEX "game_account_sync_requests_user_id_created_at_idx" ON "game_account_sync_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "rank_snapshots_game_account_id_captured_at_idx" ON "rank_snapshots"("game_account_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "recent_matches_game_account_id_played_at_idx" ON "recent_matches"("game_account_id", "played_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "recent_matches_game_account_id_external_match_id_key" ON "recent_matches"("game_account_id", "external_match_id");

-- CreateIndex
CREATE INDEX "steam_playtime_app_id_minutes_total_idx" ON "steam_playtime"("app_id", "minutes_total" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "steam_playtime_game_account_id_app_id_key" ON "steam_playtime"("game_account_id", "app_id");

-- CreateIndex
CREATE INDEX "seasons_starts_at_ends_at_idx" ON "seasons"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "ratings_game_id_season_id_elo_idx" ON "ratings"("game_id", "season_id", "elo" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ratings_user_id_game_id_season_id_key" ON "ratings"("user_id", "game_id", "season_id");

-- CreateIndex
CREATE INDEX "rating_history_user_id_created_at_idx" ON "rating_history"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rating_history_scrim_id_user_id_key" ON "rating_history"("scrim_id", "user_id");

-- CreateIndex
CREATE INDEX "season_standings_season_id_game_id_rank_idx" ON "season_standings"("season_id", "game_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "season_standings_season_id_game_id_user_id_key" ON "season_standings"("season_id", "game_id", "user_id");

-- CreateIndex
CREATE INDEX "scrims_status_scheduled_at_idx" ON "scrims"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "scrims_game_id_status_scheduled_at_idx" ON "scrims"("game_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "scrims_host_id_idx" ON "scrims"("host_id");

-- CreateIndex
CREATE INDEX "scrim_players_scrim_id_status_idx" ON "scrim_players"("scrim_id", "status");

-- CreateIndex
CREATE INDEX "scrim_players_user_id_status_no_show_marked_at_idx" ON "scrim_players"("user_id", "status", "no_show_marked_at");

-- CreateIndex
CREATE UNIQUE INDEX "scrim_players_scrim_id_user_id_key" ON "scrim_players"("scrim_id", "user_id");

-- CreateIndex
CREATE INDEX "scrim_results_scrim_id_status_idx" ON "scrim_results"("scrim_id", "status");

-- CreateIndex
CREATE INDEX "scrim_results_status_created_at_idx" ON "scrim_results"("status", "created_at");

-- CreateIndex
CREATE INDEX "scrim_result_disputes_scrim_result_id_status_idx" ON "scrim_result_disputes"("scrim_result_id", "status");

-- CreateIndex
CREATE INDEX "scrim_result_disputes_status_created_at_idx" ON "scrim_result_disputes"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_logs_idempotency_key_key" ON "activity_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_started_at_idx" ON "activity_logs"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "activity_logs_started_at_idx" ON "activity_logs"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "badges_code_key" ON "badges"("code");

-- CreateIndex
CREATE INDEX "user_badges_user_id_idx" ON "user_badges"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_user_id_badge_id_season_id_key" ON "user_badges"("user_id", "badge_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "notices_created_at_idx" ON "notices"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_account_sync_requests" ADD CONSTRAINT "game_account_sync_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_account_sync_requests" ADD CONSTRAINT "game_account_sync_requests_game_account_id_fkey" FOREIGN KEY ("game_account_id") REFERENCES "game_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_snapshots" ADD CONSTRAINT "rank_snapshots_game_account_id_fkey" FOREIGN KEY ("game_account_id") REFERENCES "game_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_matches" ADD CONSTRAINT "recent_matches_game_account_id_fkey" FOREIGN KEY ("game_account_id") REFERENCES "game_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steam_playtime" ADD CONSTRAINT "steam_playtime_game_account_id_fkey" FOREIGN KEY ("game_account_id") REFERENCES "game_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_scrim_id_fkey" FOREIGN KEY ("scrim_id") REFERENCES "scrims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_scrim_result_id_fkey" FOREIGN KEY ("scrim_result_id") REFERENCES "scrim_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrims" ADD CONSTRAINT "scrims_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrims" ADD CONSTRAINT "scrims_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_players" ADD CONSTRAINT "scrim_players_scrim_id_fkey" FOREIGN KEY ("scrim_id") REFERENCES "scrims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_players" ADD CONSTRAINT "scrim_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_players" ADD CONSTRAINT "scrim_players_no_show_marked_by_fkey" FOREIGN KEY ("no_show_marked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_results" ADD CONSTRAINT "scrim_results_scrim_id_fkey" FOREIGN KEY ("scrim_id") REFERENCES "scrims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_results" ADD CONSTRAINT "scrim_results_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_results" ADD CONSTRAINT "scrim_results_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_results" ADD CONSTRAINT "scrim_results_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_result_disputes" ADD CONSTRAINT "scrim_result_disputes_scrim_result_id_fkey" FOREIGN KEY ("scrim_result_id") REFERENCES "scrim_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_result_disputes" ADD CONSTRAINT "scrim_result_disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrim_result_disputes" ADD CONSTRAINT "scrim_result_disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
