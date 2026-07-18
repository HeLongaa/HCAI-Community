CREATE TYPE "ModerationTargetType" AS ENUM ('user', 'post', 'comment', 'media_asset', 'creative_generation');
CREATE TYPE "ModerationReportCategory" AS ENUM ('harassment', 'hate', 'sexual', 'violence', 'self_harm', 'child_safety', 'impersonation', 'spam', 'fraud', 'privacy', 'copyright', 'other');
CREATE TYPE "ModerationCasePriority" AS ENUM ('normal', 'high', 'critical');
CREATE TYPE "ModerationDecisionStage" AS ENUM ('original', 'appeal');
CREATE TYPE "ModerationDecisionOutcome" AS ENUM ('no_action', 'warn', 'restrict_content', 'remove_content', 'suspend_account', 'uphold', 'overturn', 'partially_overturn');

CREATE TABLE "moderation_cases" (
  "id" TEXT NOT NULL,
  "target_type" "ModerationTargetType" NOT NULL,
  "target_id" TEXT NOT NULL,
  "affected_user_id" TEXT,
  "priority" "ModerationCasePriority" NOT NULL DEFAULT 'normal',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_cases_target_id_check" CHECK (char_length("target_id") BETWEEN 1 AND 128)
);

CREATE TABLE "trust_reports" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "reporter_id" TEXT NOT NULL,
  "category" "ModerationReportCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "source_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trust_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trust_reports_text_check" CHECK (char_length("subject") BETWEEN 5 AND 120 AND char_length("statement") BETWEEN 10 AND 4000),
  CONSTRAINT "trust_reports_locale_check" CHECK ("locale" IN ('en', 'zh')),
  CONSTRAINT "trust_reports_source_key_check" CHECK (char_length("source_key") BETWEEN 16 AND 128)
);

CREATE TABLE "moderation_evidence" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "submitted_by_id" TEXT,
  "evidence_type" TEXT NOT NULL,
  "reference_type" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_evidence_type_check" CHECK ("evidence_type" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "moderation_evidence_reference_type_check" CHECK ("reference_type" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "moderation_evidence_reference_id_check" CHECK (char_length("reference_id") BETWEEN 1 AND 128),
  CONSTRAINT "moderation_evidence_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "moderation_evidence_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$')
);

CREATE TABLE "moderation_decisions" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "appeal_id" TEXT,
  "reviewer_id" TEXT NOT NULL,
  "stage" "ModerationDecisionStage" NOT NULL,
  "outcome" "ModerationDecisionOutcome" NOT NULL,
  "reason_code" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_decisions_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "moderation_decisions_note_check" CHECK (char_length("note") BETWEEN 1 AND 1000),
  CONSTRAINT "moderation_decisions_stage_outcome_check" CHECK (
    ("stage" = 'original' AND "appeal_id" IS NULL AND "outcome" IN ('no_action', 'warn', 'restrict_content', 'remove_content', 'suspend_account'))
    OR
    ("stage" = 'appeal' AND "appeal_id" IS NOT NULL AND "outcome" IN ('uphold', 'overturn', 'partially_overturn'))
  )
);

CREATE TABLE "moderation_appeals" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL,
  "appellant_id" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_appeals_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "moderation_appeals_statement_check" CHECK (char_length("statement") BETWEEN 10 AND 4000)
);

CREATE UNIQUE INDEX "trust_reports_case_id_key" ON "trust_reports"("case_id");
CREATE UNIQUE INDEX "trust_reports_source_key_key" ON "trust_reports"("source_key");
CREATE INDEX "trust_reports_reporter_id_created_at_id_idx" ON "trust_reports"("reporter_id", "created_at", "id");
CREATE INDEX "trust_reports_category_created_at_id_idx" ON "trust_reports"("category", "created_at", "id");
CREATE INDEX "moderation_cases_target_type_target_id_created_at_idx" ON "moderation_cases"("target_type", "target_id", "created_at");
CREATE INDEX "moderation_cases_affected_user_id_created_at_id_idx" ON "moderation_cases"("affected_user_id", "created_at", "id");
CREATE INDEX "moderation_cases_priority_created_at_id_idx" ON "moderation_cases"("priority", "created_at", "id");
CREATE UNIQUE INDEX "moderation_evidence_case_id_evidence_type_reference_type_reference_id_content_hash_key" ON "moderation_evidence"("case_id", "evidence_type", "reference_type", "reference_id", "content_hash");
CREATE INDEX "moderation_evidence_case_id_created_at_id_idx" ON "moderation_evidence"("case_id", "created_at", "id");
CREATE UNIQUE INDEX "moderation_decisions_appeal_id_key" ON "moderation_decisions"("appeal_id");
CREATE UNIQUE INDEX "moderation_decisions_case_id_stage_key" ON "moderation_decisions"("case_id", "stage");
CREATE INDEX "moderation_decisions_reviewer_id_created_at_id_idx" ON "moderation_decisions"("reviewer_id", "created_at", "id");
CREATE UNIQUE INDEX "moderation_appeals_case_id_key" ON "moderation_appeals"("case_id");
CREATE UNIQUE INDEX "moderation_appeals_decision_id_key" ON "moderation_appeals"("decision_id");
CREATE INDEX "moderation_appeals_appellant_id_created_at_id_idx" ON "moderation_appeals"("appellant_id", "created_at", "id");

ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_affected_user_id_fkey" FOREIGN KEY ("affected_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_reports" ADD CONSTRAINT "trust_reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_reports" ADD CONSTRAINT "trust_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_evidence" ADD CONSTRAINT "moderation_evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_evidence" ADD CONSTRAINT "moderation_evidence_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_appellant_id_fkey" FOREIGN KEY ("appellant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_appeal_id_fkey" FOREIGN KEY ("appeal_id") REFERENCES "moderation_appeals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_moderation_fact_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'moderation facts are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trust_reports_immutable BEFORE UPDATE OR DELETE ON "trust_reports" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER moderation_cases_immutable BEFORE UPDATE OR DELETE ON "moderation_cases" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER moderation_evidence_immutable BEFORE UPDATE OR DELETE ON "moderation_evidence" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER moderation_decisions_immutable BEFORE UPDATE OR DELETE ON "moderation_decisions" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER moderation_appeals_immutable BEFORE UPDATE OR DELETE ON "moderation_appeals" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:trust:read', 'trust-safety', 'moderation_case', 'read', 'high', false, false, 'Read moderation cases and append-only evidence', CURRENT_TIMESTAMP),
  ('admin:trust:review', 'trust-safety', 'moderation_decision', 'create', 'critical', false, true, 'Create moderation and appeal decisions', CURRENT_TIMESTAMP),
  ('admin:trust:export', 'trust-safety', 'moderation_case', 'export', 'critical', false, false, 'Export sanitized moderation case evidence', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:trust:read'),
  ('moderator', 'admin:trust:review'),
  ('admin', 'admin:trust:read'),
  ('admin', 'admin:trust:review'),
  ('admin', 'admin:trust:export')
ON CONFLICT ("role", "permission_id") DO NOTHING;
