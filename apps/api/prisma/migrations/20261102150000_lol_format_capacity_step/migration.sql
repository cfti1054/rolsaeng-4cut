-- 롤·롤체 모집이 내전인지 인원 모집인지. 스팀·기타는 null.
-- 롤체 랭크는 인원 모집이라 밸런스·ELO를 끈다.
-- 협곡·칼바람 정원을 2–10명, 한 명 단위로 바꾼다.

CREATE TYPE "lol_format" AS ENUM ('scrim', 'party');

ALTER TABLE "scrims" ADD COLUMN "lol_format" "lol_format";

UPDATE "games" SET "capacity_step" = 1 WHERE "code" = 'lol';

UPDATE "scrims" AS s
SET "lol_format" = 'party', "rated" = false, "auto_balance" = false
FROM "games" AS g
WHERE s."game_id" = g."id" AND g."code" = 'tft' AND s."tft_mode" = 'ranked';
