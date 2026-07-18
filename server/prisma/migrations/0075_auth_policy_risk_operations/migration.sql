CREATE TABLE "auth_risk_policies" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "window_seconds" INTEGER NOT NULL DEFAULT 300,
  "ip_account_threshold" INTEGER NOT NULL DEFAULT 5,
  "account_ip_threshold" INTEGER NOT NULL DEFAULT 5,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_risk_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_login_attempts" (
  "id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "identity_hash" TEXT,
  "identity_hint" TEXT,
  "network_hash" TEXT,
  "client_label" TEXT NOT NULL DEFAULT 'Unknown client',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidence_schema_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "auth_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_login_attempts_outcome_occurred_at_idx" ON "auth_login_attempts"("outcome", "occurred_at");
CREATE INDEX "auth_login_attempts_method_occurred_at_idx" ON "auth_login_attempts"("method", "occurred_at");
CREATE INDEX "auth_login_attempts_reason_code_occurred_at_idx" ON "auth_login_attempts"("reason_code", "occurred_at");
CREATE INDEX "auth_login_attempts_identity_hash_occurred_at_idx" ON "auth_login_attempts"("identity_hash", "occurred_at");
