-- S6 후속: 운영진 일정(events) 선택 시각(계약 _workspace/01_architect_contract.md 23-8절, D298–D301).
-- prisma migrate diff --from-schema-datamodel <20261031230000_s6 적용 후 schema> --to-schema-datamodel prisma/schema.prisma --script 출력 그대로(수동 블록 없음).
-- nullable 컬럼 추가만(삭제·변경 문장 없음). 기존 행 start_time·end_time NULL = 종일 일정. KST 벽시계 시각을 time(0)에 그대로 저장(시간대 변환 없음).
-- 20261031230000_s6는 QA 확인을 마친 파일이라 고치지 않고 별도 마이그레이션으로 둔다(D301).
-- AlterTable
ALTER TABLE "events" ADD COLUMN     "end_time" TIME(0),
ADD COLUMN     "start_time" TIME(0);

