SELECT set_config('app.audit_maintenance', 'on', false);

ALTER TABLE "safety_rule_versions"
  ADD COLUMN "created_by_subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

ALTER TABLE "safety_rule_transitions"
  ADD COLUMN "actor_subject_ref" TEXT;

ALTER TABLE "moderation_bulk_operations"
  ADD COLUMN "idempotency_hash" TEXT,
  ADD COLUMN "actor_subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

UPDATE "safety_rule_versions"
SET "created_by_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "created_by_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "created_by_id" IS NOT NULL;

UPDATE "safety_rule_transitions"
SET "actor_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "actor_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "actor_id" IS NOT NULL;

UPDATE "moderation_bulk_operations"
SET "idempotency_hash" = encode(digest("idempotency_key", 'sha256'), 'hex'),
    "actor_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "actor_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "actor_id" IS NOT NULL;

ALTER TABLE "moderation_bulk_operations" ALTER COLUMN "idempotency_hash" SET NOT NULL;
ALTER TABLE "moderation_bulk_operations"
  ADD CONSTRAINT "moderation_bulk_operations_idempotency_hash_check"
  CHECK ("idempotency_hash" ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX "moderation_bulk_operations_idempotency_hash_key"
  ON "moderation_bulk_operations"("idempotency_hash");

ALTER TABLE "safety_rule_versions" DROP CONSTRAINT "safety_rule_versions_created_by_id_fkey";
ALTER TABLE "safety_rule_versions" ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "safety_rule_versions"
  ADD CONSTRAINT "safety_rule_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "safety_rule_transitions" DROP CONSTRAINT "safety_rule_transitions_actor_id_fkey";
ALTER TABLE "safety_rule_transitions" ALTER COLUMN "actor_id" DROP NOT NULL;
ALTER TABLE "safety_rule_transitions"
  ADD CONSTRAINT "safety_rule_transitions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_bulk_operations" DROP CONSTRAINT "moderation_bulk_operations_actor_id_fkey";
ALTER TABLE "moderation_bulk_operations" ALTER COLUMN "actor_id" DROP NOT NULL;
ALTER TABLE "moderation_bulk_operations"
  ADD CONSTRAINT "moderation_bulk_operations_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "safety_rule_versions_created_by_subject_ref_retention_redacted_at_idx"
  ON "safety_rule_versions"("created_by_subject_ref", "retention_redacted_at");
CREATE INDEX "moderation_bulk_operations_actor_subject_ref_retention_redacted_at_idx"
  ON "moderation_bulk_operations"("actor_subject_ref", "retention_redacted_at");

SELECT set_config('app.audit_maintenance', 'off', false);
