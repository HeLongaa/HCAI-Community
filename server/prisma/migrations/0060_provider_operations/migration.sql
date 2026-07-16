CREATE TABLE "provider_operational_policies" (
  "id" TEXT NOT NULL, "provider_id" TEXT NOT NULL, "scope_key" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL, "provider_account_ref" TEXT NOT NULL, "secret_purpose" TEXT NOT NULL,
  "workspace" "ModelCapabilityModality" NOT NULL, "model_family" TEXT, "currency" TEXT NOT NULL,
  "per_request_budget_micros" BIGINT NOT NULL, "max_requests_per_minute" INTEGER NOT NULL,
  "max_concurrent_requests" INTEGER NOT NULL, "health_ttl_seconds" INTEGER NOT NULL,
  "status" "ModelControlStatus" NOT NULL DEFAULT 'draft', "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL, "created_by_ref" TEXT NOT NULL, "updated_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_operational_policies_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "provider_health_evidence" (
  "id" TEXT NOT NULL, "policy_id" TEXT NOT NULL, "source_key" TEXT NOT NULL, "status" TEXT NOT NULL,
  "checked_at" TIMESTAMP(3) NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "latency_ms" INTEGER,
  "success_rate_bps" INTEGER, "source_type" TEXT NOT NULL, "source_ref_hash" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL, "details" JSONB, "details_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_health_evidence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "provider_rate_limit_windows" (
  "id" TEXT NOT NULL, "policy_id" TEXT NOT NULL, "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL, "request_count" INTEGER NOT NULL DEFAULT 0,
  "in_flight_count" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "provider_rate_limit_windows_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "provider_dispatch_leases" (
  "id" TEXT NOT NULL, "source_key" TEXT NOT NULL, "policy_id" TEXT NOT NULL, "rate_window_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active', "estimate_micros" BIGINT NOT NULL,
  "lease_expires_at" TIMESTAMP(3) NOT NULL, "released_at" TIMESTAMP(3), "reason_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_dispatch_leases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_operational_policies_scope_key_key" ON "provider_operational_policies"("scope_key");
CREATE INDEX "provider_operational_policies_provider_id_environment_status_idx" ON "provider_operational_policies"("provider_id", "environment", "status");
CREATE INDEX "provider_operational_policies_workspace_environment_status_idx" ON "provider_operational_policies"("workspace", "environment", "status");
CREATE UNIQUE INDEX "provider_health_evidence_source_key_key" ON "provider_health_evidence"("source_key");
CREATE INDEX "provider_health_evidence_policy_id_checked_at_idx" ON "provider_health_evidence"("policy_id", "checked_at");
CREATE INDEX "provider_health_evidence_status_expires_at_idx" ON "provider_health_evidence"("status", "expires_at");
CREATE UNIQUE INDEX "provider_rate_limit_windows_policy_id_window_start_key" ON "provider_rate_limit_windows"("policy_id", "window_start");
CREATE INDEX "provider_rate_limit_windows_window_end_idx" ON "provider_rate_limit_windows"("window_end");
CREATE UNIQUE INDEX "provider_dispatch_leases_source_key_key" ON "provider_dispatch_leases"("source_key");
CREATE INDEX "provider_dispatch_leases_policy_id_status_lease_expires_at_idx" ON "provider_dispatch_leases"("policy_id", "status", "lease_expires_at");
CREATE INDEX "provider_dispatch_leases_rate_window_id_status_idx" ON "provider_dispatch_leases"("rate_window_id", "status");
ALTER TABLE "provider_operational_policies" ADD CONSTRAINT "provider_operational_policies_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_health_evidence" ADD CONSTRAINT "provider_health_evidence_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "provider_operational_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_rate_limit_windows" ADD CONSTRAINT "provider_rate_limit_windows_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "provider_operational_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_dispatch_leases" ADD CONSTRAINT "provider_dispatch_leases_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "provider_operational_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_dispatch_leases" ADD CONSTRAINT "provider_dispatch_leases_rate_window_id_fkey" FOREIGN KEY ("rate_window_id") REFERENCES "provider_rate_limit_windows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_operational_policies" ADD CONSTRAINT "provider_operational_policies_limits_check" CHECK ("currency" ~ '^[A-Z]{3}$' AND "per_request_budget_micros" >= 0 AND "max_requests_per_minute" > 0 AND "max_concurrent_requests" > 0 AND "health_ttl_seconds" BETWEEN 30 AND 86400);
ALTER TABLE "provider_health_evidence" ADD CONSTRAINT "provider_health_evidence_status_check" CHECK ("status" IN ('healthy', 'degraded', 'unavailable'));
ALTER TABLE "provider_health_evidence" ADD CONSTRAINT "provider_health_evidence_time_check" CHECK ("expires_at" > "checked_at");
ALTER TABLE "provider_health_evidence" ADD CONSTRAINT "provider_health_evidence_metrics_check" CHECK (("latency_ms" IS NULL OR "latency_ms" >= 0) AND ("success_rate_bps" IS NULL OR "success_rate_bps" BETWEEN 0 AND 10000));
ALTER TABLE "provider_dispatch_leases" ADD CONSTRAINT "provider_dispatch_leases_status_check" CHECK ("status" IN ('active', 'released', 'expired'));
ALTER TABLE "provider_dispatch_leases" ADD CONSTRAINT "provider_dispatch_leases_estimate_check" CHECK ("estimate_micros" >= 0);
CREATE FUNCTION prevent_provider_health_evidence_mutation() RETURNS trigger AS $$ BEGIN IF current_setting('app.model_control_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF; RAISE EXCEPTION 'provider_health_evidence is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER provider_health_evidence_no_update BEFORE UPDATE OR DELETE ON "provider_health_evidence" FOR EACH ROW EXECUTE FUNCTION prevent_provider_health_evidence_mutation();
