ALTER TABLE "model_deployments"
  ADD COLUMN "adapter_type" TEXT,
  ADD COLUMN "provider_model_id" TEXT,
  ADD COLUMN "endpoint_url" TEXT,
  ADD COLUMN "secret_purpose" TEXT,
  ADD COLUMN "runtime_config" JSONB,
  ADD COLUMN "runtime_config_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "runtime_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "model_deployments_environment_runtime_enabled_status_idx"
  ON "model_deployments"("environment", "runtime_enabled", "status");
