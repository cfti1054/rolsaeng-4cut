-- 롤 모집 맵(협곡·칼바람). 다른 게임은 null. 기존 행은 바꾸지 않는다(롤은 화면에서 협곡으로 본다).

CREATE TYPE "lol_map" AS ENUM ('rift', 'aram');

ALTER TABLE "scrims" ADD COLUMN "lol_map" "lol_map";
