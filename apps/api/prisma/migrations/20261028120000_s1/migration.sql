-- S1 게임 계정 연동·동기화 (계약: _workspace/01_architect_contract.md 3절)
-- 생성: prisma migrate diff --from-schema-datamodel <450b091 schema> --to-schema-datamodel prisma/schema.prisma --script
--       + 맨 끝 「수동 추가」 블록(Prisma 스키마로 표현할 수 없는 부분 고유 인덱스)
-- 참고: game_accounts의 verification_challenge·verification_expires_at 삭제는 S0까지 쓰는 코드가 없어 데이터 손실 없음

-- CreateEnum
CREATE TYPE "game_account_sync_state" AS ENUM ('idle', 'queued', 'running');

-- CreateEnum
CREATE TYPE "riot_link_verification_status" AS ENUM ('pending', 'verified', 'expired', 'cancelled');

-- DropForeignKey
ALTER TABLE "game_account_sync_requests" DROP CONSTRAINT "game_account_sync_requests_game_account_id_fkey";

-- DropIndex
DROP INDEX "game_accounts_user_id_idx";

-- AlterTable
ALTER TABLE "game_accounts" DROP COLUMN "verification_challenge",
DROP COLUMN "verification_expires_at",
ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matches_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "sync_state" "game_account_sync_state" NOT NULL DEFAULT 'idle',
ADD COLUMN     "sync_state_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "game_account_sync_requests" ALTER COLUMN "game_account_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "riot_link_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "puuid" TEXT NOT NULL,
    "game_name" TEXT NOT NULL,
    "tag_line" TEXT NOT NULL,
    "icon_id" INTEGER NOT NULL,
    "status" "riot_link_verification_status" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "check_count" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "riot_link_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "riot_link_verifications_user_id_status_idx" ON "riot_link_verifications"("user_id", "status");

-- CreateIndex
CREATE INDEX "riot_link_verifications_user_id_created_at_idx" ON "riot_link_verifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "game_accounts_user_id_game_id_idx" ON "game_accounts"("user_id", "game_id");

-- AddForeignKey
ALTER TABLE "game_account_sync_requests" ADD CONSTRAINT "game_account_sync_requests_game_account_id_fkey" FOREIGN KEY ("game_account_id") REFERENCES "game_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riot_link_verifications" ADD CONSTRAINT "riot_link_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===== 수동 추가 (prisma migrate diff가 만들지 않음) =====
-- 대표 계정: 사용자·게임별 is_primary=true 행은 최대 1개(D56). 라이엇은 lol·tft 각각에 걸려 같은 라이엇 ID 쌍이 함께 대표가 된다.
-- 주의: 이후 슬라이스에서 prisma migrate dev/diff가 이 인덱스를 DROP하는 SQL을 만들면 지우고 유지할 것.
CREATE UNIQUE INDEX "game_accounts_one_primary_per_user_game" ON "game_accounts"("user_id", "game_id") WHERE "is_primary";
