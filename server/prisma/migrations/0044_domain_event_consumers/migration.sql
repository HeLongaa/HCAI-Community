CREATE TYPE "DomainEventConsumptionStatus" AS ENUM ('pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'compensation_pending', 'compensated', 'compensation_failed');
CREATE TYPE "DomainEventAttemptStatus" AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE "DomainEventCompensationStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed');

ALTER TABLE "domain_event_outbox" ADD COLUMN "aggregate_sequence" INTEGER;
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "aggregate_type", "aggregate_id" ORDER BY "occurred_at", "id") AS sequence
  FROM "domain_event_outbox"
)
UPDATE "domain_event_outbox" AS target
SET "aggregate_sequence" = ranked.sequence
FROM ranked
WHERE target."id" = ranked."id";
ALTER TABLE "domain_event_outbox" ALTER COLUMN "aggregate_sequence" SET NOT NULL;
CREATE UNIQUE INDEX "domain_event_outbox_aggregate_type_aggregate_id_aggregate_sequence_key" ON "domain_event_outbox"("aggregate_type", "aggregate_id", "aggregate_sequence");

CREATE TABLE "domain_event_aggregate_sequences" (
  "id" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "current_sequence" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domain_event_aggregate_sequences_pkey" PRIMARY KEY ("id")
);
INSERT INTO "domain_event_aggregate_sequences" ("id", "aggregate_type", "aggregate_id", "current_sequence", "updated_at")
SELECT 'sequence:' || "aggregate_type" || ':' || "aggregate_id", "aggregate_type", "aggregate_id", MAX("aggregate_sequence"), CURRENT_TIMESTAMP
FROM "domain_event_outbox"
GROUP BY "aggregate_type", "aggregate_id";
CREATE UNIQUE INDEX "domain_event_aggregate_sequences_aggregate_type_aggregate_id_key" ON "domain_event_aggregate_sequences"("aggregate_type", "aggregate_id");

CREATE TABLE "domain_event_consumer_inbox" (
  "id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "consumer_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "aggregate_sequence" INTEGER NOT NULL,
  "owner_id" TEXT,
  "correlation_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_consumer_inbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_consumptions" (
  "inbox_id" TEXT NOT NULL,
  "status" "DomainEventConsumptionStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" TEXT,
  "claimed_by" TEXT,
  "claim_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "last_attempt_at" TIMESTAMP(3),
  "succeeded_at" TIMESTAMP(3),
  "dead_lettered_at" TIMESTAMP(3),
  "compensation_requested_at" TIMESTAMP(3),
  "compensated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domain_event_consumptions_pkey" PRIMARY KEY ("inbox_id")
);

CREATE TABLE "domain_event_consumption_attempts" (
  "id" TEXT NOT NULL,
  "inbox_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "DomainEventAttemptStatus" NOT NULL DEFAULT 'running',
  "worker_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_consumption_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_consumer_cursors" (
  "id" TEXT NOT NULL,
  "consumer_key" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "last_sequence" INTEGER NOT NULL DEFAULT 0,
  "last_inbox_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domain_event_consumer_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_compensations" (
  "id" TEXT NOT NULL,
  "inbox_id" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "reason_code" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_compensations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_compensation_states" (
  "compensation_id" TEXT NOT NULL,
  "status" "DomainEventCompensationStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" TEXT,
  "claimed_by" TEXT,
  "claim_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "succeeded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domain_event_compensation_states_pkey" PRIMARY KEY ("compensation_id")
);

CREATE TABLE "domain_event_compensation_attempts" (
  "id" TEXT NOT NULL,
  "compensation_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "DomainEventAttemptStatus" NOT NULL DEFAULT 'running',
  "worker_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_compensation_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "domain_event_consumer_inbox_idempotency_key_key" ON "domain_event_consumer_inbox"("idempotency_key");
CREATE UNIQUE INDEX "domain_event_consumer_inbox_event_id_consumer_key_key" ON "domain_event_consumer_inbox"("event_id", "consumer_key");
CREATE INDEX "domain_event_consumer_inbox_consumer_key_received_at_idx" ON "domain_event_consumer_inbox"("consumer_key", "received_at");
CREATE INDEX "domain_event_consumer_inbox_ordering_idx" ON "domain_event_consumer_inbox"("consumer_key", "aggregate_type", "aggregate_id", "aggregate_sequence");
CREATE UNIQUE INDEX "domain_event_consumptions_lease_token_key" ON "domain_event_consumptions"("lease_token");
CREATE INDEX "domain_event_consumptions_status_available_at_idx" ON "domain_event_consumptions"("status", "available_at");
CREATE INDEX "domain_event_consumptions_claim_expires_at_idx" ON "domain_event_consumptions"("claim_expires_at");
CREATE UNIQUE INDEX "domain_event_consumption_attempts_lease_token_key" ON "domain_event_consumption_attempts"("lease_token");
CREATE UNIQUE INDEX "domain_event_consumption_attempts_inbox_id_attempt_number_key" ON "domain_event_consumption_attempts"("inbox_id", "attempt_number");
CREATE INDEX "domain_event_consumption_attempts_status_started_at_idx" ON "domain_event_consumption_attempts"("status", "started_at");
CREATE UNIQUE INDEX "domain_event_consumer_cursors_stream_key" ON "domain_event_consumer_cursors"("consumer_key", "aggregate_type", "aggregate_id");
CREATE UNIQUE INDEX "domain_event_compensations_inbox_id_key" ON "domain_event_compensations"("inbox_id");
CREATE UNIQUE INDEX "domain_event_compensations_idempotency_key_key" ON "domain_event_compensations"("idempotency_key");
CREATE INDEX "domain_event_compensations_requested_by_id_requested_at_idx" ON "domain_event_compensations"("requested_by_id", "requested_at");
CREATE UNIQUE INDEX "domain_event_compensation_states_lease_token_key" ON "domain_event_compensation_states"("lease_token");
CREATE INDEX "domain_event_compensation_states_status_available_at_idx" ON "domain_event_compensation_states"("status", "available_at");
CREATE INDEX "domain_event_compensation_states_claim_expires_at_idx" ON "domain_event_compensation_states"("claim_expires_at");
CREATE UNIQUE INDEX "domain_event_compensation_attempts_lease_token_key" ON "domain_event_compensation_attempts"("lease_token");
CREATE UNIQUE INDEX "domain_event_compensation_attempts_compensation_id_attempt_number_key" ON "domain_event_compensation_attempts"("compensation_id", "attempt_number");
CREATE INDEX "domain_event_compensation_attempts_status_started_at_idx" ON "domain_event_compensation_attempts"("status", "started_at");

ALTER TABLE "domain_event_consumer_inbox" ADD CONSTRAINT "domain_event_consumer_inbox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "domain_event_consumptions" ADD CONSTRAINT "domain_event_consumptions_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "domain_event_consumer_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "domain_event_consumption_attempts" ADD CONSTRAINT "domain_event_consumption_attempts_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "domain_event_consumer_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "domain_event_compensations" ADD CONSTRAINT "domain_event_compensations_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "domain_event_consumer_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "domain_event_compensation_states" ADD CONSTRAINT "domain_event_compensation_states_compensation_id_fkey" FOREIGN KEY ("compensation_id") REFERENCES "domain_event_compensations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "domain_event_compensation_attempts" ADD CONSTRAINT "domain_event_compensation_attempts_compensation_id_fkey" FOREIGN KEY ("compensation_id") REFERENCES "domain_event_compensations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description") VALUES
  ('admin:events:recover', 'platform-architecture', 'domain_event_consumption', 'recover', 'critical', false, true, 'Retry dead-lettered event consumption or request compensation')
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES ('admin', 'admin:events:recover')
ON CONFLICT ("role", "permission_id") DO NOTHING;
