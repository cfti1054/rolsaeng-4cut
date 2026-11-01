-- S6 관리자 도구·결과 되돌리기·패치노트·이벤트·감사 로그(계약 _workspace/01_architect_contract.md 3절).
-- prisma migrate diff --from-schema-datamodel <HEAD 775507c schema> --to-schema-datamodel prisma/schema.prisma --script 출력 그대로(수동 블록 없음).
-- 추가만 한다(삭제 문장 없음). 기존 행: scrim_results.reverted_* NULL. scrim_result_status 'reverted'는 이 마이그레이션 안에서 쓰지 않는다
-- (PostgreSQL은 같은 트랜잭션에서 새 enum 값을 쓸 수 없다). 부분 고유 인덱스 scrim_results_one_active_per_scrim(pending·approved)은 그대로.
-- AlterEnum
ALTER TYPE "scrim_result_status" ADD VALUE 'reverted';

-- AlterTable
ALTER TABLE "scrim_results" ADD COLUMN     "revert_reason" TEXT,
ADD COLUMN     "reverted_at" TIMESTAMPTZ(3),
ADD COLUMN     "reverted_by" UUID;

-- CreateTable
CREATE TABLE "patch_notes" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "version" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT,
    "published_on" DATE NOT NULL,
    "notify_discord" BOOLEAN NOT NULL DEFAULT false,
    "discord_notified_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patch_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "game_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patch_notes_published_on_idx" ON "patch_notes"("published_on" DESC);

-- CreateIndex
CREATE INDEX "patch_notes_game_id_published_on_idx" ON "patch_notes"("game_id", "published_on" DESC);

-- CreateIndex
CREATE INDEX "events_starts_on_ends_on_idx" ON "events"("starts_on", "ends_on");

-- CreateIndex
CREATE INDEX "events_ends_on_idx" ON "events"("ends_on");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "scrim_results" ADD CONSTRAINT "scrim_results_reverted_by_fkey" FOREIGN KEY ("reverted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patch_notes" ADD CONSTRAINT "patch_notes_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patch_notes" ADD CONSTRAINT "patch_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

