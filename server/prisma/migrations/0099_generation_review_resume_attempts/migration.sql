DROP INDEX "creative_generation_executions_generation_id_key";

CREATE INDEX "creative_generation_executions_generation_id_created_at_idx"
ON "creative_generation_executions"("generation_id", "created_at");
