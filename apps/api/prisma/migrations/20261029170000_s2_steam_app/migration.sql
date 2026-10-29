-- AlterTable
ALTER TABLE "games" ADD COLUMN     "requires_steam_app" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "scrims" ADD COLUMN     "steam_app_id" INTEGER,
ADD COLUMN     "steam_app_name" TEXT;

-- 수동 추가(D98): 스팀 내전은 게임 선택 필수. 이미 있는 스팀 내전은 steam_app_id null로 둔다(응답 steam_app = null).
UPDATE "games" SET "requires_steam_app" = true WHERE "code" = 'steam';
