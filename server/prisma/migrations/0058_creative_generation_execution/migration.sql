CREATE TYPE "CreativeGenerationExecutionStatus" AS ENUM ('claimed', 'succeeded', 'failed', 'recovery_required');

CREATE TABLE "creative_generation_executions" (
  "id" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "actor_handle" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "workspace" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "CreativeGenerationExecutionStatus" NOT NULL DEFAULT 'claimed',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "error_code" TEXT,
  "lease_expires_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_generation_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creative_generation_executions_attempt_check" CHECK ("attempt" >= 1)
);

CREATE UNIQUE INDEX "creative_generation_executions_generation_id_key" ON "creative_generation_executions"("generation_id");
CREATE UNIQUE INDEX "creative_generation_executions_actor_id_idempotency_key_key" ON "creative_generation_executions"("actor_id", "idempotency_key");
CREATE INDEX "creative_generation_executions_status_lease_expires_at_idx" ON "creative_generation_executions"("status", "lease_expires_at");
CREATE INDEX "creative_generation_executions_workspace_status_created_at_idx" ON "creative_generation_executions"("workspace", "status", "created_at");

ALTER TABLE "creative_generation_executions" ADD CONSTRAINT "creative_generation_executions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
