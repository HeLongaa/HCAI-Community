CREATE TYPE "ModelControlStatus" AS ENUM ('draft', 'active', 'disabled', 'deprecated', 'archived');
CREATE TYPE "ModelDeploymentEnvironment" AS ENUM ('development', 'staging', 'production');
CREATE TYPE "ModelCapabilityModality" AS ENUM ('image', 'chat', 'video', 'music');

CREATE TABLE "model_providers" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft',
  "website_url" TEXT,
  "regions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "data_processing_regions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "archived_by_ref" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "models" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "family" TEXT,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "archived_by_ref" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_versions" (
  "id" TEXT NOT NULL,
  "model_id" TEXT NOT NULL,
  "version_key" TEXT NOT NULL,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft',
  "release_date" TIMESTAMP(3),
  "deprecation_date" TIMESTAMP(3),
  "context_window" INTEGER,
  "max_output_units" INTEGER,
  "parameter_schema" JSONB,
  "parameter_schema_schema_version" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "archived_by_ref" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_capabilities" (
  "id" TEXT NOT NULL,
  "model_version_id" TEXT NOT NULL,
  "modality" "ModelCapabilityModality" NOT NULL,
  "operations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "input_mime_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "output_mime_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "constraints" JSONB,
  "constraints_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_deployments" (
  "id" TEXT NOT NULL,
  "model_version_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL,
  "region" TEXT NOT NULL,
  "deployment_ref" TEXT NOT NULL,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft',
  "traffic_eligible" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_deployments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_versions" (
  "id" TEXT NOT NULL,
  "model_version_id" TEXT NOT NULL,
  "model_deployment_id" TEXT,
  "version_key" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "unit_price_micros" INTEGER NOT NULL,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "creative_generations"
  ADD COLUMN "model_version_id" TEXT,
  ADD COLUMN "model_deployment_id" TEXT,
  ADD COLUMN "pricing_version_id" TEXT;

CREATE UNIQUE INDEX "model_providers_key_key" ON "model_providers"("key");
CREATE INDEX "model_providers_status_updated_at_idx" ON "model_providers"("status", "updated_at");
CREATE UNIQUE INDEX "models_provider_id_key_key" ON "models"("provider_id", "key");
CREATE INDEX "models_status_updated_at_idx" ON "models"("status", "updated_at");
CREATE UNIQUE INDEX "model_versions_model_id_version_key_key" ON "model_versions"("model_id", "version_key");
CREATE INDEX "model_versions_status_updated_at_idx" ON "model_versions"("status", "updated_at");
CREATE UNIQUE INDEX "model_capabilities_model_version_id_modality_key" ON "model_capabilities"("model_version_id", "modality");
CREATE INDEX "model_capabilities_modality_updated_at_idx" ON "model_capabilities"("modality", "updated_at");
CREATE UNIQUE INDEX "model_deployments_environment_key_key" ON "model_deployments"("environment", "key");
CREATE INDEX "model_deployments_model_version_id_environment_status_idx" ON "model_deployments"("model_version_id", "environment", "status");
CREATE UNIQUE INDEX "pricing_versions_model_version_id_version_key_key" ON "pricing_versions"("model_version_id", "version_key");
CREATE INDEX "pricing_versions_model_deployment_id_status_effective_from_idx" ON "pricing_versions"("model_deployment_id", "status", "effective_from");
CREATE INDEX "pricing_versions_status_effective_from_effective_to_idx" ON "pricing_versions"("status", "effective_from", "effective_to");
CREATE INDEX "creative_generations_model_version_id_created_at_idx" ON "creative_generations"("model_version_id", "created_at");
CREATE INDEX "creative_generations_model_deployment_id_created_at_idx" ON "creative_generations"("model_deployment_id", "created_at");
CREATE INDEX "creative_generations_pricing_version_id_created_at_idx" ON "creative_generations"("pricing_version_id", "created_at");

ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_capabilities" ADD CONSTRAINT "model_capabilities_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_deployments" ADD CONSTRAINT "model_deployments_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_model_deployment_id_fkey" FOREIGN KEY ("model_deployment_id") REFERENCES "model_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_model_deployment_id_fkey" FOREIGN KEY ("model_deployment_id") REFERENCES "model_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_pricing_version_id_fkey" FOREIGN KEY ("pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:model-control:read', 'model-control-plane', 'model_catalog', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:model-control:manage', 'model-control-plane', 'model_catalog', 'manage', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:model-control:transition', 'model-control-plane', 'model_catalog', 'transition', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator'::"UserRole", 'admin:model-control:read'),
  ('admin'::"UserRole", 'admin:model-control:read'),
  ('admin'::"UserRole", 'admin:model-control:manage'),
  ('admin'::"UserRole", 'admin:model-control:transition')
ON CONFLICT ("role", "permission_id") DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_model_control_transition() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('active', 'archived')) OR
    (OLD.status = 'active' AND NEW.status IN ('disabled', 'deprecated')) OR
    (OLD.status = 'disabled' AND NEW.status IN ('active', 'archived')) OR
    (OLD.status = 'deprecated' AND NEW.status IN ('disabled', 'archived'))
  ) THEN
    RAISE EXCEPTION 'invalid model control transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_model_control_delete() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'model control records cannot be hard deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION preserve_activated_model_version() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' AND (
    OLD.model_id IS DISTINCT FROM NEW.model_id OR
    OLD.version_key IS DISTINCT FROM NEW.version_key OR
    OLD.release_date IS DISTINCT FROM NEW.release_date OR
    OLD.context_window IS DISTINCT FROM NEW.context_window OR
    OLD.max_output_units IS DISTINCT FROM NEW.max_output_units OR
    OLD.parameter_schema IS DISTINCT FROM NEW.parameter_schema
  ) THEN
    RAISE EXCEPTION 'activated model versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION preserve_model_capability() RETURNS trigger AS $$
DECLARE parent_status "ModelControlStatus";
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO parent_status FROM model_versions WHERE id = COALESCE(NEW.model_version_id, OLD.model_version_id);
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'capabilities for activated model versions are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION preserve_pricing_version() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.model_version_id IS DISTINCT FROM NEW.model_version_id OR
     OLD.model_deployment_id IS DISTINCT FROM NEW.model_deployment_id OR
     OLD.version_key IS DISTINCT FROM NEW.version_key OR
     OLD.currency IS DISTINCT FROM NEW.currency OR
     OLD.unit IS DISTINCT FROM NEW.unit OR
     OLD.unit_price_micros IS DISTINCT FROM NEW.unit_price_micros OR
     OLD.effective_from IS DISTINCT FROM NEW.effective_from OR
     OLD.effective_to IS DISTINCT FROM NEW.effective_to THEN
    RAISE EXCEPTION 'pricing versions are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_providers_transition_guard BEFORE UPDATE ON model_providers FOR EACH ROW EXECUTE FUNCTION enforce_model_control_transition();
CREATE TRIGGER models_transition_guard BEFORE UPDATE ON models FOR EACH ROW EXECUTE FUNCTION enforce_model_control_transition();
CREATE TRIGGER model_versions_transition_guard BEFORE UPDATE ON model_versions FOR EACH ROW EXECUTE FUNCTION enforce_model_control_transition();
CREATE TRIGGER model_deployments_transition_guard BEFORE UPDATE ON model_deployments FOR EACH ROW EXECUTE FUNCTION enforce_model_control_transition();
CREATE TRIGGER pricing_versions_transition_guard BEFORE UPDATE ON pricing_versions FOR EACH ROW EXECUTE FUNCTION enforce_model_control_transition();
CREATE TRIGGER model_versions_immutable_guard BEFORE UPDATE ON model_versions FOR EACH ROW EXECUTE FUNCTION preserve_activated_model_version();
CREATE TRIGGER model_capabilities_immutable_guard BEFORE UPDATE OR DELETE ON model_capabilities FOR EACH ROW EXECUTE FUNCTION preserve_model_capability();
CREATE TRIGGER pricing_versions_immutable_guard BEFORE UPDATE ON pricing_versions FOR EACH ROW EXECUTE FUNCTION preserve_pricing_version();
CREATE TRIGGER model_providers_no_delete BEFORE DELETE ON model_providers FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();
CREATE TRIGGER models_no_delete BEFORE DELETE ON models FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();
CREATE TRIGGER model_versions_no_delete BEFORE DELETE ON model_versions FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();
CREATE TRIGGER model_capabilities_no_delete BEFORE DELETE ON model_capabilities FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();
CREATE TRIGGER model_deployments_no_delete BEFORE DELETE ON model_deployments FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();
CREATE TRIGGER pricing_versions_no_delete BEFORE DELETE ON pricing_versions FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();
