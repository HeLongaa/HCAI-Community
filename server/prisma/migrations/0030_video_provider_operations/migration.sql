CREATE TYPE "CreativeProviderOperationStatus" AS ENUM (
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out'
);

CREATE TABLE "creative_provider_operations" (
  "id" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "provider_mode" TEXT NOT NULL,
  "provider_job_id" TEXT NOT NULL,
  "status" "CreativeProviderOperationStatus" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "poll_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_poll_at" TIMESTAMP(3),
  "timeout_at" TIMESTAMP(3) NOT NULL,
  "last_payload_hash" TEXT,
  "output_digest" TEXT,
  "last_error_code" TEXT,
  "side_effects_complete" BOOLEAN NOT NULL DEFAULT false,
  "safe_metadata" JSONB,
  "terminal_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "creative_provider_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_provider_operations_generation_id_key"
  ON "creative_provider_operations"("generation_id");
CREATE UNIQUE INDEX "creative_provider_operations_provider_id_provider_job_id_key"
  ON "creative_provider_operations"("provider_id", "provider_job_id");
CREATE INDEX "creative_provider_operations_status_next_poll_at_idx"
  ON "creative_provider_operations"("status", "next_poll_at");
CREATE INDEX "creative_provider_operations_side_effects_complete_updated_at_idx"
  ON "creative_provider_operations"("side_effects_complete", "updated_at");

ALTER TABLE "creative_provider_operations"
  ADD CONSTRAINT "creative_provider_operations_generation_id_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
