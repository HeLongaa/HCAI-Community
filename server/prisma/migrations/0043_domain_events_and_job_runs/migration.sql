CREATE TYPE "DomainEventPublicationStatus" AS ENUM ('pending', 'claimed', 'published', 'failed');
CREATE TYPE "JobRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled');
CREATE TYPE "JobAttemptStatus" AS ENUM ('running', 'succeeded', 'failed', 'timed_out', 'cancelled');

CREATE TABLE "domain_event_outbox" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "owner_id" TEXT,
  "correlation_id" TEXT NOT NULL,
  "causation_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_schema_version" INTEGER NOT NULL DEFAULT 1,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_publications" (
  "event_id" TEXT NOT NULL,
  "status" "DomainEventPublicationStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_token" TEXT,
  "claimed_by" TEXT,
  "claim_expires_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domain_event_publications_pkey" PRIMARY KEY ("event_id")
);

CREATE TABLE "job_definitions" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "default_timeout_seconds" INTEGER NOT NULL DEFAULT 300,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_runs" (
  "id" TEXT NOT NULL,
  "definition_id" TEXT NOT NULL,
  "status" "JobRunStatus" NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT NOT NULL,
  "owner_id" TEXT,
  "requested_by_id" TEXT,
  "correlation_id" TEXT NOT NULL,
  "input" JSONB,
  "input_schema_version" INTEGER NOT NULL DEFAULT 1,
  "result" JSONB,
  "result_schema_version" INTEGER NOT NULL DEFAULT 1,
  "error_code" TEXT,
  "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "timeout_at" TIMESTAMP(3),
  "cancel_requested_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_attempts" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "JobAttemptStatus" NOT NULL DEFAULT 'running',
  "worker_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "timeout_at" TIMESTAMP(3) NOT NULL,
  "result" JSONB,
  "result_schema_version" INTEGER NOT NULL DEFAULT 1,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "domain_event_outbox_idempotency_key_key" ON "domain_event_outbox"("idempotency_key");
CREATE INDEX "domain_event_outbox_event_type_occurred_at_idx" ON "domain_event_outbox"("event_type", "occurred_at");
CREATE INDEX "domain_event_outbox_aggregate_type_aggregate_id_occurred_at_idx" ON "domain_event_outbox"("aggregate_type", "aggregate_id", "occurred_at");
CREATE INDEX "domain_event_outbox_correlation_id_occurred_at_idx" ON "domain_event_outbox"("correlation_id", "occurred_at");
CREATE UNIQUE INDEX "domain_event_publications_claim_token_key" ON "domain_event_publications"("claim_token");
CREATE INDEX "domain_event_publications_status_available_at_idx" ON "domain_event_publications"("status", "available_at");
CREATE INDEX "domain_event_publications_claim_expires_at_idx" ON "domain_event_publications"("claim_expires_at");
CREATE UNIQUE INDEX "job_definitions_type_version_key" ON "job_definitions"("type", "version");
CREATE UNIQUE INDEX "job_runs_idempotency_key_key" ON "job_runs"("idempotency_key");
CREATE INDEX "job_runs_status_scheduled_at_priority_idx" ON "job_runs"("status", "scheduled_at", "priority");
CREATE INDEX "job_runs_definition_id_created_at_idx" ON "job_runs"("definition_id", "created_at");
CREATE INDEX "job_runs_owner_id_created_at_idx" ON "job_runs"("owner_id", "created_at");
CREATE INDEX "job_runs_correlation_id_created_at_idx" ON "job_runs"("correlation_id", "created_at");
CREATE UNIQUE INDEX "job_attempts_lease_token_key" ON "job_attempts"("lease_token");
CREATE UNIQUE INDEX "job_attempts_run_id_attempt_number_key" ON "job_attempts"("run_id", "attempt_number");
CREATE INDEX "job_attempts_status_timeout_at_idx" ON "job_attempts"("status", "timeout_at");
CREATE INDEX "job_attempts_worker_id_started_at_idx" ON "job_attempts"("worker_id", "started_at");

ALTER TABLE "domain_event_publications" ADD CONSTRAINT "domain_event_publications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "job_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "job_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description") VALUES
  ('admin:events:read', 'platform-architecture', 'domain_event', 'read', 'high', false, false, 'Read versioned domain event publication evidence'),
  ('admin:events:replay', 'platform-architecture', 'domain_event', 'replay', 'critical', false, true, 'Request replay of a published or failed domain event'),
  ('admin:jobs:read', 'jobs-automation', 'job_run', 'read', 'high', false, false, 'Read job definitions, runs, attempts, and safe results'),
  ('admin:jobs:manage', 'jobs-automation', 'job_run', 'manage', 'critical', false, true, 'Cancel queued or running job runs')
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('admin', 'admin:events:read'), ('admin', 'admin:events:replay'),
  ('admin', 'admin:jobs:read'), ('admin', 'admin:jobs:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
