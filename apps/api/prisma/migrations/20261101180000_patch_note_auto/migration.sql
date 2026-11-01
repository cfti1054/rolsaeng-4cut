-- 패치노트 자동 등록 표시. 기존 수기 글은 false.
-- ADD COLUMN NOT NULL DEFAULT. 삭제·데이터 변경 없음.
ALTER TABLE "patch_notes" ADD COLUMN "auto_registered" BOOLEAN NOT NULL DEFAULT false;
