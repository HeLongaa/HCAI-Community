-- CreateEnum
CREATE TYPE "CreativeGenerationStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled', 'review_required');

-- CreateTable
CREATE TABLE "creative_generations" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_handle" TEXT,
    "workspace" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_mode" TEXT,
    "status" "CreativeGenerationStatus" NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "prompt_preview" TEXT,
    "input_asset_ids" TEXT[] NOT NULL,
    "parameter_keys" TEXT[] NOT NULL,
    "output_asset_ids" TEXT[] NOT NULL,
    "usage" JSONB,
    "quota" JSONB,
    "safety" JSONB,
    "policy" JSONB,
    "provider_request_id" TEXT,
    "provider_job_id" TEXT,
    "error_code" TEXT,
    "error_message_preview" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creative_generations_actor_id_created_at_idx" ON "creative_generations"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "creative_generations_actor_handle_created_at_idx" ON "creative_generations"("actor_handle", "created_at");

-- CreateIndex
CREATE INDEX "creative_generations_workspace_created_at_idx" ON "creative_generations"("workspace", "created_at");

-- CreateIndex
CREATE INDEX "creative_generations_provider_id_created_at_idx" ON "creative_generations"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "creative_generations_status_created_at_idx" ON "creative_generations"("status", "created_at");

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
