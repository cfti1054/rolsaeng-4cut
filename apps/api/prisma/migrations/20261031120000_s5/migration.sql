-- S5 봇 API, 서버 퇴장, 접속 현황. 계약: _workspace/01_architect_contract.md 3절(r2: 연동 코드 표 discord_link_codes 제거, D237)
-- 아래 문장은 `prisma migrate diff --from-schema-datamodel <S4 schema.prisma(HEAD 92370dd)> --to-schema-datamodel prisma/schema.prisma --script`
-- stdout 그대로다(수동 블록 없음, DROP 문장 없음). 부분 고유 인덱스 2개(S1·S3)는 건드리지 않는다.
-- 기존 행: users.left_at·guild_membership_at = NULL(모두 서버 멤버로 본다), activity_logs.api_key_id = NULL.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "guild_membership_at" TIMESTAMPTZ(3),
ADD COLUMN     "left_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "api_key_id" UUID;

-- CreateTable
CREATE TABLE "bot_presence" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "voice_member_count" INTEGER NOT NULL,
    "playing" JSONB NOT NULL DEFAULT '[]',
    "api_key_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bot_presence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_presence_source_key" ON "bot_presence"("source");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_presence" ADD CONSTRAINT "bot_presence_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

