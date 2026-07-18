CREATE TYPE "SafetyRuleState" AS ENUM ('draft', 'canary', 'active', 'retired');
CREATE TYPE "ModerationQueueAction" AS ENUM ('enqueue', 'assign', 'release', 'set_priority', 'escalate');

CREATE TABLE "safety_rule_versions" (
  "id" TEXT NOT NULL,
  "rule_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "signal_type" TEXT NOT NULL,
  "target_type" "ModerationTargetType",
  "category" "ModerationReportCategory",
  "minimum_score" INTEGER NOT NULL,
  "priority" "ModerationCasePriority" NOT NULL,
  "config_hash" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safety_rule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_rule_versions_key_check" CHECK ("rule_key" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$' AND "signal_type" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "safety_rule_versions_text_check" CHECK (char_length("name") BETWEEN 3 AND 120),
  CONSTRAINT "safety_rule_versions_score_check" CHECK ("minimum_score" BETWEEN 0 AND 100),
  CONSTRAINT "safety_rule_versions_hash_check" CHECK ("config_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "safety_rule_versions_version_check" CHECK ("version" > 0)
);

CREATE TABLE "safety_rule_transitions" (
  "id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "from_state" "SafetyRuleState" NOT NULL,
  "to_state" "SafetyRuleState" NOT NULL,
  "rollout_percent" INTEGER NOT NULL,
  "reason_code" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safety_rule_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_rule_transitions_rollout_check" CHECK ("rollout_percent" BETWEEN 0 AND 100),
  CONSTRAINT "safety_rule_transitions_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$')
);

CREATE TABLE "safety_signals" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "rule_version_id" TEXT,
  "case_id" TEXT NOT NULL,
  "signal_type" TEXT NOT NULL,
  "severity" "ModerationCasePriority" NOT NULL,
  "score" INTEGER NOT NULL,
  "content_hash" TEXT NOT NULL,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safety_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_signals_source_check" CHECK (char_length("source_key") BETWEEN 16 AND 128),
  CONSTRAINT "safety_signals_type_check" CHECK ("signal_type" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "safety_signals_score_check" CHECK ("score" BETWEEN 0 AND 100),
  CONSTRAINT "safety_signals_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "moderation_queue_events" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "action" "ModerationQueueAction" NOT NULL,
  "assignee_id" TEXT,
  "priority" "ModerationCasePriority",
  "due_at" TIMESTAMP(3) NOT NULL,
  "reason_code" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_queue_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_queue_events_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "moderation_queue_events_shape_check" CHECK (
    ("action" = 'assign' AND "assignee_id" IS NOT NULL) OR
    ("action" IN ('set_priority', 'escalate') AND "priority" IS NOT NULL) OR
    ("action" IN ('enqueue', 'release'))
  )
);

CREATE TABLE "moderation_bulk_operations" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "target_hash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_count" INTEGER NOT NULL,
  "result" JSONB NOT NULL,
  "result_schema_version" INTEGER NOT NULL DEFAULT 1,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_bulk_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_bulk_operations_key_check" CHECK (char_length("idempotency_key") BETWEEN 16 AND 128),
  CONSTRAINT "moderation_bulk_operations_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$' AND "target_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "moderation_bulk_operations_action_check" CHECK ("action" IN ('assign', 'release', 'set_priority')),
  CONSTRAINT "moderation_bulk_operations_count_check" CHECK ("target_count" BETWEEN 1 AND 50)
);

CREATE UNIQUE INDEX "safety_rule_versions_rule_key_version_key" ON "safety_rule_versions"("rule_key", "version");
CREATE INDEX "safety_rule_versions_rule_key_created_at_id_idx" ON "safety_rule_versions"("rule_key", "created_at", "id");
CREATE INDEX "safety_rule_transitions_rule_version_id_created_at_id_idx" ON "safety_rule_transitions"("rule_version_id", "created_at", "id");
CREATE INDEX "safety_rule_transitions_created_at_id_idx" ON "safety_rule_transitions"("created_at", "id");
CREATE UNIQUE INDEX "safety_signals_source_key_key" ON "safety_signals"("source_key");
CREATE INDEX "safety_signals_case_id_created_at_id_idx" ON "safety_signals"("case_id", "created_at", "id");
CREATE INDEX "safety_signals_signal_type_observed_at_id_idx" ON "safety_signals"("signal_type", "observed_at", "id");
CREATE INDEX "moderation_queue_events_case_id_created_at_id_idx" ON "moderation_queue_events"("case_id", "created_at", "id");
CREATE INDEX "moderation_queue_events_assignee_id_due_at_id_idx" ON "moderation_queue_events"("assignee_id", "due_at", "id");
CREATE INDEX "moderation_queue_events_due_at_id_idx" ON "moderation_queue_events"("due_at", "id");
CREATE UNIQUE INDEX "moderation_bulk_operations_idempotency_key_key" ON "moderation_bulk_operations"("idempotency_key");
CREATE INDEX "moderation_bulk_operations_actor_id_created_at_id_idx" ON "moderation_bulk_operations"("actor_id", "created_at", "id");

ALTER TABLE "safety_rule_versions" ADD CONSTRAINT "safety_rule_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_rule_transitions" ADD CONSTRAINT "safety_rule_transitions_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "safety_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_rule_transitions" ADD CONSTRAINT "safety_rule_transitions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_signals" ADD CONSTRAINT "safety_signals_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "safety_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_signals" ADD CONSTRAINT "safety_signals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_signals" ADD CONSTRAINT "safety_signals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_queue_events" ADD CONSTRAINT "moderation_queue_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_queue_events" ADD CONSTRAINT "moderation_queue_events_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_queue_events" ADD CONSTRAINT "moderation_queue_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_bulk_operations" ADD CONSTRAINT "moderation_bulk_operations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER safety_rule_versions_immutable BEFORE UPDATE OR DELETE ON "safety_rule_versions" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER safety_rule_transitions_immutable BEFORE UPDATE OR DELETE ON "safety_rule_transitions" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER safety_signals_immutable BEFORE UPDATE OR DELETE ON "safety_signals" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER moderation_queue_events_immutable BEFORE UPDATE OR DELETE ON "moderation_queue_events" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();
CREATE TRIGGER moderation_bulk_operations_immutable BEFORE UPDATE OR DELETE ON "moderation_bulk_operations" FOR EACH ROW EXECUTE FUNCTION reject_moderation_fact_mutation();

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at") VALUES
  ('admin:trust:operate', 'trust-safety', 'moderation_queue', 'manage', 'critical', false, true, 'Assign and prioritize moderation queue cases without bulk decisions', CURRENT_TIMESTAMP),
  ('admin:trust:rules', 'trust-safety', 'safety_rule', 'manage', 'critical', false, true, 'Create, canary, activate, retire, and roll back versioned safety rules', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action", "risk_level" = EXCLUDED."risk_level", "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:trust:operate'),
  ('admin', 'admin:trust:operate'),
  ('admin', 'admin:trust:rules')
ON CONFLICT ("role", "permission_id") DO NOTHING;
