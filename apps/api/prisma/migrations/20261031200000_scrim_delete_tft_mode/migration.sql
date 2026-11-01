-- CreateEnum
CREATE TYPE "tft_mode" AS ENUM ('double_up', 'normal', 'ranked');

-- AlterTable
ALTER TABLE "scrims" ADD COLUMN "tft_mode" "tft_mode";

-- AlterTable
ALTER TABLE "scrim_players" ADD COLUMN "duo_index" INTEGER;
