SELECT set_config('app.audit_maintenance', 'on', false);

ALTER TABLE "moderation_cases"
  ADD COLUMN "affected_subject_ref" TEXT,
  ADD COLUMN "reporter_subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

UPDATE "moderation_cases"
SET "affected_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "affected_user_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "affected_user_id" IS NOT NULL;

UPDATE "moderation_cases" case_row
SET "reporter_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || report_row."reporter_id", 'sha256'), 'hex') FROM 1 FOR 24)
FROM "trust_reports" report_row
WHERE report_row."case_id" = case_row."id"
  AND report_row."reporter_id" IS NOT NULL;

ALTER TABLE "moderation_cases" DROP CONSTRAINT "moderation_cases_affected_user_id_fkey";
ALTER TABLE "moderation_cases"
  ADD CONSTRAINT "moderation_cases_affected_user_id_fkey"
  FOREIGN KEY ("affected_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trust_reports" DROP CONSTRAINT "trust_reports_reporter_id_fkey";
ALTER TABLE "trust_reports" ALTER COLUMN "reporter_id" DROP NOT NULL;
ALTER TABLE "trust_reports"
  ADD CONSTRAINT "trust_reports_reporter_id_fkey"
  FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_evidence" DROP CONSTRAINT "moderation_evidence_submitted_by_id_fkey";
ALTER TABLE "moderation_evidence"
  ADD CONSTRAINT "moderation_evidence_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_decisions" DROP CONSTRAINT "moderation_decisions_reviewer_id_fkey";
ALTER TABLE "moderation_decisions"
  ADD CONSTRAINT "moderation_decisions_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_appeals" DROP CONSTRAINT "moderation_appeals_appellant_id_fkey";
ALTER TABLE "moderation_appeals" ALTER COLUMN "appellant_id" DROP NOT NULL;
ALTER TABLE "moderation_appeals"
  ADD CONSTRAINT "moderation_appeals_appellant_id_fkey"
  FOREIGN KEY ("appellant_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "community_moderation_actions" DROP CONSTRAINT "community_moderation_actions_actor_id_fkey";
ALTER TABLE "community_moderation_actions" ALTER COLUMN "actor_id" DROP NOT NULL;
ALTER TABLE "community_moderation_actions"
  ADD CONSTRAINT "community_moderation_actions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "safety_signals" DROP CONSTRAINT "safety_signals_created_by_id_fkey";
ALTER TABLE "safety_signals" ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "safety_signals"
  ADD CONSTRAINT "safety_signals_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_queue_events" DROP CONSTRAINT "moderation_queue_events_assignee_id_fkey";
ALTER TABLE "moderation_queue_events"
  ADD CONSTRAINT "moderation_queue_events_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_queue_events" DROP CONSTRAINT "moderation_queue_events_actor_id_fkey";
ALTER TABLE "moderation_queue_events" ALTER COLUMN "actor_id" DROP NOT NULL;
ALTER TABLE "moderation_queue_events"
  ADD CONSTRAINT "moderation_queue_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_queue_events" DROP CONSTRAINT "moderation_queue_events_shape_check";
ALTER TABLE "moderation_queue_events"
  ADD CONSTRAINT "moderation_queue_events_shape_check" CHECK (
    ("action" = 'assign' AND ("assignee_id" IS NOT NULL OR "actor_id" IS NULL)) OR
    ("action" IN ('set_priority', 'escalate') AND "priority" IS NOT NULL) OR
    ("action" IN ('enqueue', 'release'))
  );

CREATE INDEX "moderation_cases_affected_subject_ref_retention_redacted_at_idx"
  ON "moderation_cases"("affected_subject_ref", "retention_redacted_at");
CREATE INDEX "moderation_cases_reporter_subject_ref_retention_redacted_at_idx"
  ON "moderation_cases"("reporter_subject_ref", "retention_redacted_at");

CREATE OR REPLACE FUNCTION reject_moderation_fact_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on'
    OR current_setting('app.moderation_retention_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'moderation facts are append-only';
END;
$$ LANGUAGE plpgsql;

SELECT set_config('app.audit_maintenance', 'off', false);
