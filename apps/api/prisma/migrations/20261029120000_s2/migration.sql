-- S2 내전 모집·참가·대기열·노쇼 제한 (계약 _workspace/01_architect_contract.md 3절)
-- 생성: prisma migrate diff --from-schema-datamodel <7016593의 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script
-- 주의: S1의 부분 고유 인덱스 game_accounts_one_primary_per_user_game(20261028120000_s1 수동 블록)는 건드리지 않는다.
--       이후 diff에 DROP INDEX "game_accounts_one_primary_per_user_game" 줄이 생기면 지운다.


-- CreateEnum
CREATE TYPE "scrim_cancel_reason" AS ENUM ('host', 'admin', 'not_started');

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "capacity_default" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "capacity_max" INTEGER NOT NULL DEFAULT 16,
ADD COLUMN     "capacity_min" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "scrims" ADD COLUMN     "auto_balance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cancel_reason" "scrim_cancel_reason",
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "rated" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "started_at" TIMESTAMPTZ(3),
ADD COLUMN     "use_positions" BOOLEAN NOT NULL DEFAULT true;


-- ---------------------------------------------------------------------------
-- 수동 추가: 이미 시드된 games 행의 정원 범위(shared GAME_SEED와 같은 값).
-- 시드(prisma:seed)를 다시 돌리지 않는 배포에서도 롤 10 고정·롤체 2–8이 바로 적용되게 한다. 스팀은 기본값(2–16, 8).
-- ---------------------------------------------------------------------------
UPDATE "games" SET "capacity_min" = 10, "capacity_max" = 10, "capacity_default" = 10 WHERE "code" = 'lol';
UPDATE "games" SET "capacity_min" = 2, "capacity_max" = 8, "capacity_default" = 8 WHERE "code" = 'tft';
