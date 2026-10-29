-- AlterTable
ALTER TABLE "games" ADD COLUMN     "capacity_step" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "start_requires_full" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 수동 추가(D96): 롤 정원을 10 고정 → 2–10(2명 단위)으로, 꽉 차야 시작.
-- 시드(prisma:seed)를 다시 돌리지 않는 배포에서도 바로 적용되게 한다. 롤체·스팀은 기본값(단위 1, 2명 이상 시작).
-- ---------------------------------------------------------------------------
UPDATE "games" SET "capacity_min" = 2, "capacity_max" = 10, "capacity_default" = 10, "capacity_step" = 2, "start_requires_full" = true WHERE "code" = 'lol';
