-- S3 팀 자동 밸런스·결과 입력·승인·ELO 반영. 계약: _workspace/01_architect_contract.md 3절
-- 위 두 문장은 `prisma migrate diff --from-schema-datamodel <S2 이후 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`
-- 출력 그대로다. 맨 아래 수동 블록은 Prisma 스키마로 표현할 수 없는 부분 고유 인덱스.
-- DROP INDEX 줄 없음: S1 부분 고유 인덱스 game_accounts_one_primary_per_user_game은 그대로 둔다.

-- AlterTable
-- rating_history는 S3 이전에 쓰는 코드가 없어 비어 있다(기본값 없이 NOT NULL 추가 가능)
ALTER TABLE "rating_history" ADD COLUMN     "k_factor" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "rating_history_user_id_game_id_season_id_created_at_idx" ON "rating_history"("user_id", "game_id", "season_id", "created_at");

-- 수동 추가(D113): 한 내전에 승인 대기(pending)·승인(approved) 결과는 합쳐 최대 1개.
-- 서비스는 내전 행 잠금(S2 5-0) 아래에서 먼저 검사하고, 이 인덱스는 마지막 방어선이다(위반 시 P2002 → SCRIM_RESULT_EXISTS).
-- 이후 마이그레이션에서 prisma migrate diff가 이 인덱스를 DROP하려 하면 그 줄을 지운다(S1 인덱스와 같은 규칙).
CREATE UNIQUE INDEX "scrim_results_one_active_per_scrim" ON "scrim_results"("scrim_id") WHERE "status" IN ('pending', 'approved');
