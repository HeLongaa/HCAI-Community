CREATE TABLE "risk_policies" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "generation_window_seconds" INTEGER NOT NULL DEFAULT 300,
  "generation_count_threshold" INTEGER NOT NULL DEFAULT 20,
  "safety_rejection_threshold" INTEGER NOT NULL DEFAULT 3,
  "generation_cost_micros_threshold" INTEGER NOT NULL DEFAULT 5000000,
  "restriction_seconds" INTEGER NOT NULL DEFAULT 3600,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "risk_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_policies_window_check" CHECK ("generation_window_seconds" BETWEEN 60 AND 86400),
  CONSTRAINT "risk_policies_count_check" CHECK ("generation_count_threshold" BETWEEN 2 AND 10000),
  CONSTRAINT "risk_policies_safety_check" CHECK ("safety_rejection_threshold" BETWEEN 1 AND 1000),
  CONSTRAINT "risk_policies_cost_check" CHECK ("generation_cost_micros_threshold" BETWEEN 1 AND 2147483647),
  CONSTRAINT "risk_policies_restriction_check" CHECK ("restriction_seconds" BETWEEN 60 AND 2592000),
  CONSTRAINT "risk_policies_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "risk_signals" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "signal_type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reason_code" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_ref_hash" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "evidence_schema_version" INTEGER NOT NULL DEFAULT 1,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_signals_type_check" CHECK ("signal_type" IN ('auth_spray', 'account_takeover', 'generation_burst', 'safety_rejection_burst', 'generation_cost_spike')),
  CONSTRAINT "risk_signals_severity_check" CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT "risk_signals_score_check" CHECK ("score" BETWEEN 0 AND 100),
  CONSTRAINT "risk_signals_source_check" CHECK ("source_type" IN ('auth_attempts', 'creative_generations', 'creative_cost_ledger', 'safety_decisions')),
  CONSTRAINT "risk_signals_hash_check" CHECK ("source_ref_hash" IS NULL OR "source_ref_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "risk_cases" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "recovered_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "risk_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_cases_status_check" CHECK ("status" IN ('open', 'restricted', 'appealed', 'recovered', 'closed')),
  CONSTRAINT "risk_cases_disposition_check" CHECK ("disposition" IN ('monitor', 'generation_throttled', 'generation_blocked', 'account_restricted', 'cleared')),
  CONSTRAINT "risk_cases_level_check" CHECK ("risk_level" IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT "risk_cases_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "risk_case_signals" (
  "case_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_case_signals_pkey" PRIMARY KEY ("case_id", "signal_id")
);

CREATE TABLE "risk_disposition_events" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "evidence" JSONB,
  "evidence_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_disposition_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_events_status_check" CHECK ("to_status" IN ('open', 'restricted', 'appealed', 'recovered', 'closed')),
  CONSTRAINT "risk_events_disposition_check" CHECK ("disposition" IN ('monitor', 'generation_throttled', 'generation_blocked', 'account_restricted', 'cleared')),
  CONSTRAINT "risk_events_actor_check" CHECK ("actor_type" IN ('system', 'user', 'admin'))
);

CREATE TABLE "risk_appeals" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "appellant_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason_code" TEXT NOT NULL,
  "statement_hash" TEXT NOT NULL,
  "statement_preview" TEXT,
  "decision_reason_code" TEXT,
  "decided_by_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_appeals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_appeals_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "risk_appeals_hash_check" CHECK ("statement_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "risk_signals_dedupe_key_key" ON "risk_signals"("dedupe_key");
CREATE INDEX "risk_signals_user_id_occurred_at_idx" ON "risk_signals"("user_id", "occurred_at");
CREATE INDEX "risk_signals_signal_type_severity_occurred_at_idx" ON "risk_signals"("signal_type", "severity", "occurred_at");
CREATE INDEX "risk_signals_reason_code_occurred_at_idx" ON "risk_signals"("reason_code", "occurred_at");
CREATE INDEX "risk_cases_user_id_status_updated_at_idx" ON "risk_cases"("user_id", "status", "updated_at");
CREATE INDEX "risk_cases_status_disposition_risk_level_updated_at_idx" ON "risk_cases"("status", "disposition", "risk_level", "updated_at");
CREATE INDEX "risk_cases_expires_at_idx" ON "risk_cases"("expires_at");
CREATE INDEX "risk_case_signals_signal_id_idx" ON "risk_case_signals"("signal_id");
CREATE INDEX "risk_disposition_events_case_id_created_at_idx" ON "risk_disposition_events"("case_id", "created_at");
CREATE INDEX "risk_disposition_events_to_status_disposition_created_at_idx" ON "risk_disposition_events"("to_status", "disposition", "created_at");
CREATE INDEX "risk_appeals_case_id_status_created_at_idx" ON "risk_appeals"("case_id", "status", "created_at");
CREATE INDEX "risk_appeals_appellant_id_created_at_idx" ON "risk_appeals"("appellant_id", "created_at");

ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_case_signals" ADD CONSTRAINT "risk_case_signals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "risk_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_case_signals" ADD CONSTRAINT "risk_case_signals_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "risk_signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_disposition_events" ADD CONSTRAINT "risk_disposition_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "risk_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_disposition_events" ADD CONSTRAINT "risk_disposition_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "risk_appeals" ADD CONSTRAINT "risk_appeals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "risk_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_appeals" ADD CONSTRAINT "risk_appeals_appellant_id_fkey" FOREIGN KEY ("appellant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "risk_appeals" ADD CONSTRAINT "risk_appeals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "risk_policies" (
  "id", "enabled", "generation_window_seconds", "generation_count_threshold",
  "safety_rejection_threshold", "generation_cost_micros_threshold", "restriction_seconds",
  "version", "reason_code", "updated_by_ref", "updated_at"
) VALUES ('default', true, 300, 20, 3, 5000000, 3600, 1, 'risk_01_default', 'system', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:risk:read', 'trust-safety-risk', 'risk_case', 'read', 'high', false, false, 'Read normalized account and generation risk cases, signals, appeals, and metrics', CURRENT_TIMESTAMP),
  ('admin:risk:manage', 'trust-safety-risk', 'risk_case', 'transition', 'critical', false, true, 'Apply audited account and generation risk dispositions and appeal decisions', CURRENT_TIMESTAMP),
  ('admin:risk:export', 'trust-safety-risk', 'risk_case', 'export', 'critical', false, false, 'Export bounded normalized risk evidence without credentials, prompts, or Provider payloads', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:risk:read'),
  ('admin', 'admin:risk:read'),
  ('admin', 'admin:risk:manage'),
  ('admin', 'admin:risk:export')
ON CONFLICT ("role", "permission_id") DO NOTHING;
