-- S4 티어·ELO 랭킹, 랭킹 캐시, 시즌 종료 처리. 계약: _workspace/01_architect_contract.md 3절
-- 아래 문장은 `prisma migrate diff --from-schema-datamodel <S3 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`
-- 출력 그대로다(수동 블록 없음). DROP INDEX 줄 없음: 부분 고유 인덱스 game_accounts_one_primary_per_user_game,
-- scrim_results_one_active_per_scrim은 그대로 둔다.
-- 기존 행: seasons.closed_at = NULL(이미 끝난 시즌은 첫 종료 작업이 처리), ratings.carried_from_season_id = NULL(시드로 시작한 행).

-- AlterTable
ALTER TABLE "seasons" ADD COLUMN     "closed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN     "carried_from_season_id" UUID;

-- CreateTable
CREATE TABLE "ranking_caches" (
    "id" UUID NOT NULL,
    "cache_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "last_failed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "baseline_period_start" TIMESTAMPTZ(3) NOT NULL,
    "baseline_ranks" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ranking_caches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_caches_cache_key_key" ON "ranking_caches"("cache_key");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_carried_from_season_id_fkey" FOREIGN KEY ("carried_from_season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

