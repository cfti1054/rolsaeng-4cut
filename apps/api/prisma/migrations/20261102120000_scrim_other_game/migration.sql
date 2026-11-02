-- 기타 모집: 스팀에 없는 게임 이름을 모집글에 저장한다.
ALTER TABLE "scrims" ADD COLUMN "custom_game_name" VARCHAR(40);

-- 시드를 다시 돌리지 않은 환경에서도 games.code = other 행이 있게 한다.
INSERT INTO "games" (
    "id",
    "code",
    "name",
    "has_positions",
    "has_teams",
    "has_results",
    "positions",
    "sort_order",
    "capacity_min",
    "capacity_max",
    "capacity_default",
    "capacity_step",
    "start_requires_full",
    "requires_steam_app",
    "created_at"
)
SELECT
    gen_random_uuid(),
    'other',
    '기타',
    false,
    false,
    false,
    ARRAY[]::TEXT[],
    4,
    2,
    16,
    8,
    1,
    false,
    false,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "games" WHERE "code" = 'other');
