CREATE TYPE "CreativeGenerationMutationType" AS ENUM ('cancel', 'retry', 'manual_replay');

CREATE TYPE "CreativeGenerationMutationStatus" AS ENUM (
  'requested',
  'pending_review',
  'approved',
  'processing',
  'succeeded',
  'failed',
  'rejected'
);

ALTER TABLE "creative_generations"
  ADD COLUMN "retry_of_id" TEXT,
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "creative_generation_mutations" (
  "id" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL,
  "type" "CreativeGenerationMutationType" NOT NULL,
  "status" "CreativeGenerationMutationStatus" NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "requested_by_handle" TEXT,
  "reason_code" TEXT NOT NULL,
  "note_preview" TEXT,
  "review_id" TEXT,
  "target_generation_id" TEXT,
  "safe_metadata" JSONB,
  "result" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "creative_generation_mutations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_generation_mutations_idempotency_key_key"
  ON "creative_generation_mutations"("idempotency_key");
CREATE UNIQUE INDEX "creative_generation_mutations_review_id_key"
  ON "creative_generation_mutations"("review_id");
CREATE INDEX "creative_generation_mutations_generation_id_created_at_idx"
  ON "creative_generation_mutations"("generation_id", "created_at");
CREATE INDEX "creative_generation_mutations_type_status_created_at_idx"
  ON "creative_generation_mutations"("type", "status", "created_at");
CREATE INDEX "creative_generations_retry_of_id_attempt_number_idx"
  ON "creative_generations"("retry_of_id", "attempt_number");

ALTER TABLE "creative_generations"
  ADD CONSTRAINT "creative_generations_retry_of_id_fkey"
  FOREIGN KEY ("retry_of_id") REFERENCES "creative_generations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "creative_generation_mutations"
  ADD CONSTRAINT "creative_generation_mutations_generation_id_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "description") VALUES
  ('admin:creative:cancel', 'Cancel eligible creative generations'),
  ('admin:creative:retry', 'Authorize retries for eligible creative generations'),
  ('admin:creative:replay', 'Request and approve safe manual Provider replay')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('admin', 'admin:creative:cancel'),
  ('admin', 'admin:creative:retry'),
  ('admin', 'admin:creative:replay')
ON CONFLICT ("role", "permission_id") DO NOTHING;
