CREATE TABLE "ai_evaluation_suites" (
  "id" TEXT NOT NULL,
  "suite_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "modality" "ModelCapabilityModality" NOT NULL,
  "operation" TEXT NOT NULL,
  "description" TEXT,
  "content_hash" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_suites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_evaluation_suites_version_check" CHECK ("version" > 0),
  CONSTRAINT "ai_evaluation_suites_content_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ai_evaluation_cases" (
  "id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "case_key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "scoring_type" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "expected_hash" TEXT NOT NULL,
  "weight" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_evaluation_cases_category_check" CHECK ("category" IN ('quality', 'safety')),
  CONSTRAINT "ai_evaluation_cases_scoring_type_check" CHECK ("scoring_type" IN ('exact', 'semantic', 'policy')),
  CONSTRAINT "ai_evaluation_cases_hash_check" CHECK ("input_hash" ~ '^[a-f0-9]{64}$' AND "expected_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ai_evaluation_cases_weight_check" CHECK ("weight" BETWEEN 1 AND 100)
);

CREATE TABLE "ai_evaluation_policies" (
  "id" TEXT NOT NULL,
  "policy_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "suite_id" TEXT NOT NULL,
  "modality" "ModelCapabilityModality" NOT NULL,
  "operation" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL,
  "quality_threshold_bps" INTEGER NOT NULL,
  "safety_threshold_bps" INTEGER NOT NULL,
  "max_regression_bps" INTEGER NOT NULL,
  "minimum_cases" INTEGER NOT NULL,
  "evidence_ttl_seconds" INTEGER NOT NULL,
  "policy_hash" TEXT NOT NULL,
  "reviewed_by_ref" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_evaluation_policies_version_check" CHECK ("version" > 0),
  CONSTRAINT "ai_evaluation_policies_threshold_check" CHECK ("quality_threshold_bps" BETWEEN 0 AND 10000 AND "safety_threshold_bps" BETWEEN 0 AND 10000 AND "max_regression_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "ai_evaluation_policies_cases_check" CHECK ("minimum_cases" BETWEEN 1 AND 500),
  CONSTRAINT "ai_evaluation_policies_ttl_check" CHECK ("evidence_ttl_seconds" BETWEEN 60 AND 2592000),
  CONSTRAINT "ai_evaluation_policies_hash_check" CHECK ("policy_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ai_evaluation_policies_reviewer_check" CHECK ("created_by_ref" <> "reviewed_by_ref")
);

CREATE TABLE "ai_evaluation_runs" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "model_version_id" TEXT NOT NULL,
  "model_deployment_id" TEXT,
  "baseline_run_id" TEXT,
  "status" TEXT NOT NULL,
  "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "total_cases" INTEGER NOT NULL,
  "passed_cases" INTEGER NOT NULL,
  "quality_score_bps" INTEGER NOT NULL,
  "safety_score_bps" INTEGER NOT NULL,
  "regression_delta_bps" INTEGER,
  "report_hash" TEXT NOT NULL,
  "executor_ref" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_evaluation_runs_status_check" CHECK ("status" IN ('passed', 'failed', 'unverifiable')),
  CONSTRAINT "ai_evaluation_runs_scores_check" CHECK ("quality_score_bps" BETWEEN 0 AND 10000 AND "safety_score_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "ai_evaluation_runs_counts_check" CHECK ("total_cases" > 0 AND "passed_cases" BETWEEN 0 AND "total_cases"),
  CONSTRAINT "ai_evaluation_runs_time_check" CHECK ("completed_at" >= "started_at" AND "expires_at" > "completed_at"),
  CONSTRAINT "ai_evaluation_runs_report_hash_check" CHECK ("report_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ai_evaluation_case_results" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "score_bps" INTEGER NOT NULL,
  "safety_passed" BOOLEAN NOT NULL,
  "latency_ms" INTEGER,
  "output_hash" TEXT NOT NULL,
  "result_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_case_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_evaluation_case_results_status_check" CHECK ("status" IN ('passed', 'failed')),
  CONSTRAINT "ai_evaluation_case_results_score_check" CHECK ("score_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "ai_evaluation_case_results_latency_check" CHECK ("latency_ms" IS NULL OR "latency_ms" BETWEEN 0 AND 3600000),
  CONSTRAINT "ai_evaluation_case_results_hash_check" CHECK ("output_hash" ~ '^[a-f0-9]{64}$' AND "result_hash" ~ '^[a-f0-9]{64}$')
);

ALTER TABLE "model_promotions" ADD COLUMN "evaluation_run_id" TEXT;

CREATE UNIQUE INDEX "ai_evaluation_suites_suite_key_version_key" ON "ai_evaluation_suites"("suite_key", "version");
CREATE INDEX "ai_evaluation_suites_modality_operation_created_at_idx" ON "ai_evaluation_suites"("modality", "operation", "created_at");
CREATE UNIQUE INDEX "ai_evaluation_cases_suite_id_case_key_key" ON "ai_evaluation_cases"("suite_id", "case_key");
CREATE INDEX "ai_evaluation_cases_suite_id_category_idx" ON "ai_evaluation_cases"("suite_id", "category");
CREATE UNIQUE INDEX "ai_evaluation_policies_policy_key_version_key" ON "ai_evaluation_policies"("policy_key", "version");
CREATE INDEX "ai_evaluation_policies_suite_id_environment_created_at_idx" ON "ai_evaluation_policies"("suite_id", "environment", "created_at");
CREATE INDEX "ai_evaluation_policies_modality_operation_environment_created_at_idx" ON "ai_evaluation_policies"("modality", "operation", "environment", "created_at");
CREATE UNIQUE INDEX "ai_evaluation_runs_source_key_key" ON "ai_evaluation_runs"("source_key");
CREATE INDEX "ai_evaluation_runs_suite_id_created_at_idx" ON "ai_evaluation_runs"("suite_id", "created_at");
CREATE INDEX "ai_evaluation_runs_policy_id_status_created_at_idx" ON "ai_evaluation_runs"("policy_id", "status", "created_at");
CREATE INDEX "ai_evaluation_runs_model_version_id_created_at_idx" ON "ai_evaluation_runs"("model_version_id", "created_at");
CREATE INDEX "ai_evaluation_runs_model_deployment_id_status_expires_at_idx" ON "ai_evaluation_runs"("model_deployment_id", "status", "expires_at");
CREATE INDEX "ai_evaluation_runs_baseline_run_id_created_at_idx" ON "ai_evaluation_runs"("baseline_run_id", "created_at");
CREATE UNIQUE INDEX "ai_evaluation_case_results_run_id_case_id_key" ON "ai_evaluation_case_results"("run_id", "case_id");
CREATE INDEX "ai_evaluation_case_results_case_id_status_created_at_idx" ON "ai_evaluation_case_results"("case_id", "status", "created_at");
CREATE INDEX "model_promotions_evaluation_run_id_created_at_idx" ON "model_promotions"("evaluation_run_id", "created_at");

ALTER TABLE "ai_evaluation_cases" ADD CONSTRAINT "ai_evaluation_cases_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "ai_evaluation_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_policies" ADD CONSTRAINT "ai_evaluation_policies_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "ai_evaluation_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "ai_evaluation_suites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "ai_evaluation_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_model_deployment_id_fkey" FOREIGN KEY ("model_deployment_id") REFERENCES "model_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_baseline_run_id_fkey" FOREIGN KEY ("baseline_run_id") REFERENCES "ai_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_case_results" ADD CONSTRAINT "ai_evaluation_case_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_evaluation_case_results" ADD CONSTRAINT "ai_evaluation_case_results_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "ai_evaluation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_evaluation_run_id_fkey" FOREIGN KEY ("evaluation_run_id") REFERENCES "ai_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION preserve_ai_evaluation_evidence() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ai_evaluation_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'AI evaluation evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_evaluation_suites_immutable_guard BEFORE UPDATE OR DELETE ON "ai_evaluation_suites" FOR EACH ROW EXECUTE FUNCTION preserve_ai_evaluation_evidence();
CREATE TRIGGER ai_evaluation_cases_immutable_guard BEFORE UPDATE OR DELETE ON "ai_evaluation_cases" FOR EACH ROW EXECUTE FUNCTION preserve_ai_evaluation_evidence();
CREATE TRIGGER ai_evaluation_policies_immutable_guard BEFORE UPDATE OR DELETE ON "ai_evaluation_policies" FOR EACH ROW EXECUTE FUNCTION preserve_ai_evaluation_evidence();
CREATE TRIGGER ai_evaluation_runs_immutable_guard BEFORE UPDATE OR DELETE ON "ai_evaluation_runs" FOR EACH ROW EXECUTE FUNCTION preserve_ai_evaluation_evidence();
CREATE TRIGGER ai_evaluation_case_results_immutable_guard BEFORE UPDATE OR DELETE ON "ai_evaluation_case_results" FOR EACH ROW EXECUTE FUNCTION preserve_ai_evaluation_evidence();
