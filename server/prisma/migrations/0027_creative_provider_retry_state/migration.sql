CREATE TYPE "CreativeProviderRetryStatus" AS ENUM (
  'scheduled',
  'exhausted',
  'cleared'
);

CREATE TABLE "creative_provider_retry_states" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "workspace" TEXT NOT NULL,
  "operation_type" TEXT NOT NULL,
  "status" "CreativeProviderRetryStatus" NOT NULL,
  "attempt" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL,
  "first_attempt_at" TIMESTAMP(3) NOT NULL,
  "last_attempt_at" TIMESTAMP(3) NOT NULL,
  "next_attempt_at" TIMESTAMP(3),
  "last_failure_key_hash" TEXT NOT NULL,
  "last_error_code" TEXT NOT NULL,
  "last_error_category" TEXT NOT NULL,
  "delay_source" TEXT,
  "policy_hash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "creative_provider_retry_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_provider_retry_states_source_key_key"
  ON "creative_provider_retry_states"("source_key");

CREATE UNIQUE INDEX "creative_provider_retry_states_generation_id_operation_type_key"
  ON "creative_provider_retry_states"("generation_id", "operation_type");

CREATE INDEX "creative_provider_retry_states_status_next_attempt_at_idx"
  ON "creative_provider_retry_states"("status", "next_attempt_at");

CREATE INDEX "creative_provider_retry_states_provider_id_workspace_status_idx"
  ON "creative_provider_retry_states"("provider_id", "workspace", "status");

ALTER TABLE "creative_provider_retry_states"
  ADD CONSTRAINT "creative_provider_retry_states_generation_id_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
