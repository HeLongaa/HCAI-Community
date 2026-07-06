CREATE TYPE "CreativeProviderReplayAction" AS ENUM ('applied', 'ignored', 'rejected', 'noop');

CREATE TABLE "creative_provider_replay_ledger" (
    "id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_mode" TEXT,
    "provider_job_id" TEXT,
    "provider_event_id" TEXT,
    "source_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT,
    "previous_status" "CreativeGenerationStatus",
    "normalized_status" "CreativeGenerationStatus",
    "action" "CreativeProviderReplayAction" NOT NULL,
    "reason_code" TEXT,
    "side_effect_plan" JSONB,
    "side_effect_result" JSONB,
    "error_preview" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_provider_replay_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_provider_replay_ledger_idempotency_key_key" ON "creative_provider_replay_ledger"("idempotency_key");

CREATE UNIQUE INDEX "creative_provider_replay_ledger_provider_id_provider_event_id_key" ON "creative_provider_replay_ledger"("provider_id", "provider_event_id");

CREATE INDEX "creative_provider_replay_ledger_generation_id_received_at_idx" ON "creative_provider_replay_ledger"("generation_id", "received_at");

CREATE INDEX "creative_provider_replay_ledger_provider_id_provider_job_id_normalized_status_idx" ON "creative_provider_replay_ledger"("provider_id", "provider_job_id", "normalized_status");

CREATE INDEX "creative_provider_replay_ledger_source_type_action_received_at_idx" ON "creative_provider_replay_ledger"("source_type", "action", "received_at");

ALTER TABLE "creative_provider_replay_ledger" ADD CONSTRAINT "creative_provider_replay_ledger_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
