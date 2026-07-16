CREATE TABLE "provider_legal_reviews" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "provider_id" TEXT NOT NULL,
  "model_version_id" TEXT NOT NULL,
  "environment" "ModelDeploymentEnvironment" NOT NULL,
  "decision" TEXT NOT NULL,
  "allowed_regions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "geography_status" TEXT NOT NULL,
  "dpa_status" TEXT NOT NULL,
  "retention_status" TEXT NOT NULL,
  "retention_days" INTEGER NOT NULL,
  "training_status" TEXT NOT NULL,
  "copyright_status" TEXT NOT NULL,
  "sla_status" TEXT NOT NULL,
  "source_evidence_hash" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "counsel_ref" TEXT NOT NULL,
  "product_owner_ref" TEXT NOT NULL,
  "reviewed_at" TIMESTAMP(3) NOT NULL,
  "valid_from" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "reason_code" TEXT NOT NULL,
  "created_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_legal_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_legal_reviews_version_check" CHECK ("version" > 0),
  CONSTRAINT "provider_legal_reviews_decision_check" CHECK ("decision" IN ('approved', 'blocked')),
  CONSTRAINT "provider_legal_reviews_regions_check" CHECK (cardinality("allowed_regions") BETWEEN 1 AND 50),
  CONSTRAINT "provider_legal_reviews_geography_check" CHECK ("geography_status" IN ('approved', 'blocked')),
  CONSTRAINT "provider_legal_reviews_dpa_check" CHECK ("dpa_status" IN ('executed', 'not_required', 'blocked')),
  CONSTRAINT "provider_legal_reviews_retention_check" CHECK ("retention_status" IN ('approved', 'blocked') AND "retention_days" BETWEEN 0 AND 3650),
  CONSTRAINT "provider_legal_reviews_training_check" CHECK ("training_status" IN ('opt_out', 'contractual_no_training', 'blocked')),
  CONSTRAINT "provider_legal_reviews_copyright_check" CHECK ("copyright_status" IN ('approved', 'blocked')),
  CONSTRAINT "provider_legal_reviews_sla_check" CHECK ("sla_status" IN ('approved', 'blocked')),
  CONSTRAINT "provider_legal_reviews_hash_check" CHECK ("source_evidence_hash" ~ '^[a-f0-9]{64}$' AND "evidence_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "provider_legal_reviews_reviewers_check" CHECK ("counsel_ref" <> "product_owner_ref"),
  CONSTRAINT "provider_legal_reviews_time_check" CHECK ("reviewed_at" <= "valid_from" AND "expires_at" > "valid_from" AND "expires_at" <= "valid_from" + INTERVAL '366 days'),
  CONSTRAINT "provider_legal_reviews_approved_check" CHECK ("decision" <> 'approved' OR ("geography_status" = 'approved' AND "dpa_status" IN ('executed', 'not_required') AND "retention_status" = 'approved' AND "training_status" IN ('opt_out', 'contractual_no_training') AND "copyright_status" = 'approved' AND "sla_status" = 'approved'))
);

ALTER TABLE "model_promotions" ADD COLUMN "legal_review_id" TEXT;

CREATE UNIQUE INDEX "provider_legal_reviews_source_key_key" ON "provider_legal_reviews"("source_key");
CREATE UNIQUE INDEX "provider_legal_reviews_scope_key_version_key" ON "provider_legal_reviews"("scope_key", "version");
CREATE INDEX "provider_legal_reviews_provider_id_environment_created_at_idx" ON "provider_legal_reviews"("provider_id", "environment", "created_at");
CREATE INDEX "provider_legal_reviews_model_version_id_environment_created_at_idx" ON "provider_legal_reviews"("model_version_id", "environment", "created_at");
CREATE INDEX "provider_legal_reviews_decision_expires_at_idx" ON "provider_legal_reviews"("decision", "expires_at");
CREATE INDEX "model_promotions_legal_review_id_created_at_idx" ON "model_promotions"("legal_review_id", "created_at");

ALTER TABLE "provider_legal_reviews" ADD CONSTRAINT "provider_legal_reviews_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_legal_reviews" ADD CONSTRAINT "provider_legal_reviews_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_promotions" ADD CONSTRAINT "model_promotions_legal_review_id_fkey" FOREIGN KEY ("legal_review_id") REFERENCES "provider_legal_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION preserve_provider_legal_review() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.provider_legal_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'Provider legal review evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_legal_reviews_immutable_guard BEFORE UPDATE OR DELETE ON "provider_legal_reviews" FOR EACH ROW EXECUTE FUNCTION preserve_provider_legal_review();
