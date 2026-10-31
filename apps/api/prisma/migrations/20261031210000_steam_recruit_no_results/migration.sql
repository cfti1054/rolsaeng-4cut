-- AlterTable
ALTER TABLE "games" ADD COLUMN "has_results" BOOLEAN NOT NULL DEFAULT true;

-- 스팀은 같이 플레이할 사람 모집. 팀 배정과 승패 입력을 받지 않는다.
UPDATE "games" SET "has_teams" = false, "has_results" = false WHERE "code" = 'steam';
