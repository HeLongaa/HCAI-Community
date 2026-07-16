CREATE TYPE "ModelRouteFallbackMode" AS ENUM ('fail_closed', 'ordered');
CREATE TYPE "ModelRouteTargetRole" AS ENUM ('primary', 'backup');

CREATE TABLE "model_route_policies" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "modality" "ModelCapabilityModality" NOT NULL,
  "operation" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL,
  "region" TEXT,
  "audience_roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rollout_percentage" INTEGER NOT NULL DEFAULT 100,
  "rollout_seed" TEXT NOT NULL DEFAULT 'v1',
  "fallback_mode" "ModelRouteFallbackMode" NOT NULL DEFAULT 'fail_closed',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "archived_by_ref" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_route_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "model_route_policies_rollout_percentage_check" CHECK ("rollout_percentage" BETWEEN 0 AND 100),
  CONSTRAINT "model_route_policies_priority_check" CHECK ("priority" BETWEEN 0 AND 100000)
);

CREATE TABLE "model_route_targets" (
  "id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "model_deployment_id" TEXT NOT NULL,
  "role" "ModelRouteTargetRole" NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_route_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "model_route_targets_priority_check" CHECK ("priority" BETWEEN 0 AND 100000)
);

CREATE TABLE "model_route_policy_revisions" (
  "id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_schema_version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_route_policy_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "model_route_policies_key_key" ON "model_route_policies"("key");
CREATE INDEX "model_route_policies_status_modality_operation_environment_priority_idx" ON "model_route_policies"("status", "modality", "operation", "environment", "priority");
CREATE INDEX "model_route_policies_status_updated_at_idx" ON "model_route_policies"("status", "updated_at");
CREATE UNIQUE INDEX "model_route_targets_policy_id_model_deployment_id_key" ON "model_route_targets"("policy_id", "model_deployment_id");
CREATE UNIQUE INDEX "model_route_targets_policy_id_role_priority_key" ON "model_route_targets"("policy_id", "role", "priority");
CREATE INDEX "model_route_targets_model_deployment_id_enabled_idx" ON "model_route_targets"("model_deployment_id", "enabled");
CREATE UNIQUE INDEX "model_route_policy_revisions_policy_id_revision_number_key" ON "model_route_policy_revisions"("policy_id", "revision_number");
CREATE INDEX "model_route_policy_revisions_policy_id_created_at_idx" ON "model_route_policy_revisions"("policy_id", "created_at");

ALTER TABLE "model_route_targets" ADD CONSTRAINT "model_route_targets_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "model_route_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_route_targets" ADD CONSTRAINT "model_route_targets_model_deployment_id_fkey" FOREIGN KEY ("model_deployment_id") REFERENCES "model_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_route_policy_revisions" ADD CONSTRAINT "model_route_policy_revisions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "model_route_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER model_route_policies_transition_guard BEFORE UPDATE ON model_route_policies FOR EACH ROW EXECUTE FUNCTION enforce_model_control_transition();
CREATE TRIGGER model_route_policies_no_delete BEFORE DELETE ON model_route_policies FOR EACH ROW EXECUTE FUNCTION prevent_model_control_delete();

CREATE OR REPLACE FUNCTION preserve_model_route_revision() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'model route policy revisions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_route_policy_revisions_immutable_guard BEFORE UPDATE OR DELETE ON model_route_policy_revisions FOR EACH ROW EXECUTE FUNCTION preserve_model_route_revision();

CREATE OR REPLACE FUNCTION preserve_active_route_policy() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status = 'active' AND (
    OLD.key IS DISTINCT FROM NEW.key OR OLD.name IS DISTINCT FROM NEW.name OR
    OLD.modality IS DISTINCT FROM NEW.modality OR OLD.operation IS DISTINCT FROM NEW.operation OR
    OLD.environment IS DISTINCT FROM NEW.environment OR OLD.region IS DISTINCT FROM NEW.region OR
    OLD.audience_roles IS DISTINCT FROM NEW.audience_roles OR
    OLD.rollout_percentage IS DISTINCT FROM NEW.rollout_percentage OR OLD.rollout_seed IS DISTINCT FROM NEW.rollout_seed OR
    OLD.fallback_mode IS DISTINCT FROM NEW.fallback_mode OR OLD.priority IS DISTINCT FROM NEW.priority
  ) THEN RAISE EXCEPTION 'active route policies are immutable; disable before editing'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION preserve_active_route_targets() RETURNS trigger AS $$
DECLARE policy_status "ModelControlStatus";
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO policy_status FROM model_route_policies WHERE id = COALESCE(NEW.policy_id, OLD.policy_id);
  IF policy_status = 'active' THEN RAISE EXCEPTION 'targets for active route policies are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_route_policies_immutable_guard BEFORE UPDATE ON model_route_policies FOR EACH ROW EXECUTE FUNCTION preserve_active_route_policy();
CREATE TRIGGER model_route_targets_immutable_guard BEFORE INSERT OR UPDATE OR DELETE ON model_route_targets FOR EACH ROW EXECUTE FUNCTION preserve_active_route_targets();
