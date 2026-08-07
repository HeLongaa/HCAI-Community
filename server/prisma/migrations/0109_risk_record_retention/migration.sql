ALTER TABLE "risk_cases"
  ADD COLUMN "subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

UPDATE "risk_cases"
SET "subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "user_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "user_id" IS NOT NULL;

ALTER TABLE "risk_cases" DROP CONSTRAINT "risk_cases_user_id_fkey";
ALTER TABLE "risk_cases" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "risk_cases"
  ADD CONSTRAINT "risk_cases_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "risk_appeals" DROP CONSTRAINT "risk_appeals_appellant_id_fkey";
ALTER TABLE "risk_appeals" ALTER COLUMN "appellant_id" DROP NOT NULL;
ALTER TABLE "risk_appeals"
  ADD CONSTRAINT "risk_appeals_appellant_id_fkey"
  FOREIGN KEY ("appellant_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "risk_cases_subject_ref_retention_redacted_at_idx"
  ON "risk_cases"("subject_ref", "retention_redacted_at");
CREATE INDEX "risk_cases_status_recovered_at_closed_at_retention_redacted_at_idx"
  ON "risk_cases"("status", "recovered_at", "closed_at", "retention_redacted_at");
