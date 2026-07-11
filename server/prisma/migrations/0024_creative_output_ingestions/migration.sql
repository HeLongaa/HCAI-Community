CREATE TYPE "CreativeOutputIngestionStatus" AS ENUM (
  'pending',
  'claimed',
  'stored',
  'scanning',
  'completed',
  'failed'
);

CREATE TABLE "creative_output_ingestions" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "provider_job_id" TEXT,
  "output_digest" TEXT NOT NULL,
  "output_index" INTEGER NOT NULL,
  "status" "CreativeOutputIngestionStatus" NOT NULL DEFAULT 'pending',
  "media_asset_id" TEXT,
  "storage_key" TEXT,
  "detected_content_type" TEXT,
  "size_bytes" INTEGER,
  "sha256" TEXT,
  "error_code" TEXT,
  "claim_token" TEXT,
  "claimed_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "creative_output_ingestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_output_ingestions_source_key_key"
  ON "creative_output_ingestions"("source_key");
CREATE INDEX "creative_output_ingestions_generation_id_output_index_idx"
  ON "creative_output_ingestions"("generation_id", "output_index");
CREATE INDEX "creative_output_ingestions_status_lease_expires_at_idx"
  ON "creative_output_ingestions"("status", "lease_expires_at");
CREATE INDEX "creative_output_ingestions_provider_id_provider_job_id_idx"
  ON "creative_output_ingestions"("provider_id", "provider_job_id");

ALTER TABLE "creative_output_ingestions"
  ADD CONSTRAINT "creative_output_ingestions_generation_id_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
