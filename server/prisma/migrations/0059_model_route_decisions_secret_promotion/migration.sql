CREATE TABLE "model_route_decisions" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "modality" "ModelCapabilityModality" NOT NULL,
  "operation" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL,
  "region" TEXT,
  "actor_ref" TEXT NOT NULL,
  "subject_hash" TEXT NOT NULL,
  "policy_id" TEXT,
  "policy_version" INTEGER,
  "selected_deployment_id" TEXT,
  "considered_policies" JSONB NOT NULL,
  "considered_policies_schema_version" INTEGER NOT NULL DEFAULT 1,
  "attempts" JSONB NOT NULL,
  "attempts_schema_version" INTEGER NOT NULL DEFAULT 1,
  "decision_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_route_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "model_route_decisions_source_check" CHECK ("source" IN ('preview', 'dispatch')),
  CONSTRAINT "model_route_decisions_status_check" CHECK ("status" IN ('selected', 'unavailable')),
  CONSTRAINT "model_route_decisions_subject_hash_check" CHECK ("subject_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "model_route_decisions_policy_version_check" CHECK ("policy_version" IS NULL OR "policy_version" > 0)
);

CREATE TABLE "provider_secret_refs" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL,
  "purpose" TEXT NOT NULL,
  "secret_ref" TEXT NOT NULL,
  "external_version" TEXT NOT NULL,
  "owner_ref" TEXT NOT NULL,
  "checksum_sha256" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "rotated_from_id" TEXT,
  "reason_code" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_secret_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_secret_refs_reference_check" CHECK ("secret_ref" ~ '^secret://[a-zA-Z0-9][a-zA-Z0-9/_.:-]{2,180}$'),
  CONSTRAINT "provider_secret_refs_checksum_check" CHECK ("checksum_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "provider_secret_refs_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at")
);

CREATE TABLE "model_promotions" (
  "id" TEXT NOT NULL,
  "release_change_id" TEXT NOT NULL,
  "model_deployment_id" TEXT NOT NULL,
  "route_policy_id" TEXT NOT NULL,
  "route_policy_revision_id" TEXT NOT NULL,
  "provider_secret_ref_id" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "model_route_decisions_created_at_idx" ON "model_route_decisions"("created_at");
CREATE INDEX "model_route_decisions_source_status_created_at_idx" ON "model_route_decisions"("source", "status", "created_at");
CREATE INDEX "model_route_decisions_modality_environment_created_at_idx" ON "model_route_decisions"("modality", "environment", "created_at");
CREATE INDEX "model_route_decisions_policy_id_created_at_idx" ON "model_route_decisions"("policy_id", "created_at");
CREATE UNIQUE INDEX "provider_secret_refs_secret_ref_external_version_key" ON "provider_secret_refs"("secret_ref", "external_version");
CREATE UNIQUE INDEX "provider_secret_refs_rotated_from_id_key" ON "provider_secret_refs"("rotated_from_id");
CREATE INDEX "provider_secret_refs_provider_id_environment_purpose_created_at_idx" ON "provider_secret_refs"("provider_id", "environment", "purpose", "created_at");
CREATE INDEX "provider_secret_refs_expires_at_idx" ON "provider_secret_refs"("expires_at");
CREATE UNIQUE INDEX "model_promotions_release_change_id_key" ON "model_promotions"("release_change_id");
CREATE INDEX "model_promotions_model_deployment_id_created_at_idx" ON "model_promotions"("model_deployment_id", "created_at");
CREATE INDEX "model_promotions_route_policy_id_created_at_idx" ON "model_promotions"("route_policy_id", "created_at");
CREATE INDEX "model_promotions_provider_secret_ref_id_created_at_idx" ON "model_promotions"("provider_secret_ref_id", "created_at");

ALTER TABLE "model_route_decisions" ADD CONSTRAINT "model_route_decisions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "model_route_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_route_decisions" ADD CONSTRAINT "model_route_decisions_selected_deployment_id_fkey" FOREIGN KEY ("selected_deployment_id") REFERENCES "model_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_secret_refs" ADD CONSTRAINT "provider_secret_refs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_secret_refs" ADD CONSTRAINT "provider_secret_refs_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "provider_secret_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_release_change_id_fkey" FOREIGN KEY ("release_change_id") REFERENCES "release_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_model_deployment_id_fkey" FOREIGN KEY ("model_deployment_id") REFERENCES "model_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_route_policy_id_fkey" FOREIGN KEY ("route_policy_id") REFERENCES "model_route_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_route_policy_revision_id_fkey" FOREIGN KEY ("route_policy_revision_id") REFERENCES "model_route_policy_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_provider_secret_ref_id_fkey" FOREIGN KEY ("provider_secret_ref_id") REFERENCES "provider_secret_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION preserve_model_governance_fact() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.model_control_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'model governance facts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_route_decisions_immutable_guard BEFORE UPDATE OR DELETE ON "model_route_decisions" FOR EACH ROW EXECUTE FUNCTION preserve_model_governance_fact();
CREATE TRIGGER provider_secret_refs_immutable_guard BEFORE UPDATE OR DELETE ON "provider_secret_refs" FOR EACH ROW EXECUTE FUNCTION preserve_model_governance_fact();
CREATE TRIGGER model_promotions_immutable_guard BEFORE UPDATE OR DELETE ON "model_promotions" FOR EACH ROW EXECUTE FUNCTION preserve_model_governance_fact();
