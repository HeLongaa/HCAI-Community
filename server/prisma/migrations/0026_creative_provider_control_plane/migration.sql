CREATE TYPE "CreativeProviderControlScopeType" AS ENUM (
  'global',
  'provider',
  'workspace',
  'model_family'
);

CREATE TYPE "CreativeProviderCircuitStatus" AS ENUM (
  'closed',
  'open',
  'half_open'
);

CREATE TYPE "CreativeProviderCircuitOutcome" AS ENUM (
  'success',
  'retryable_failure',
  'ignored_failure'
);

CREATE TABLE "creative_provider_control_states" (
  "id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "scope_type" "CreativeProviderControlScopeType" NOT NULL,
  "provider_id" TEXT,
  "provider_account_ref" TEXT,
  "workspace" TEXT,
  "model_family" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "changed_by_ref" TEXT,
  "enabled_at" TIMESTAMP(3),
  "disabled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "creative_provider_control_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "creative_provider_cap_evidence" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "provider_account_ref" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "cap_micros" BIGINT NOT NULL,
  "remaining_micros" BIGINT,
  "source_type" TEXT NOT NULL,
  "source_ref_hash" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_provider_cap_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "creative_provider_circuit_states" (
  "id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "provider_account_ref" TEXT NOT NULL,
  "workspace" TEXT NOT NULL,
  "model_family" TEXT,
  "status" "CreativeProviderCircuitStatus" NOT NULL DEFAULT 'closed',
  "version" INTEGER NOT NULL DEFAULT 1,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "window_started_at" TIMESTAMP(3),
  "last_failure_at" TIMESTAMP(3),
  "opened_at" TIMESTAMP(3),
  "cooldown_until" TIMESTAMP(3),
  "probe_lease_token_hash" TEXT,
  "probe_lease_expires_at" TIMESTAMP(3),
  "reason_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "creative_provider_circuit_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "creative_provider_circuit_events" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "circuit_state_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "outcome" "CreativeProviderCircuitOutcome" NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_provider_circuit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_provider_control_states_scope_key_key" ON "creative_provider_control_states"("scope_key");
CREATE INDEX "creative_provider_control_states_provider_id_workspace_idx" ON "creative_provider_control_states"("provider_id", "workspace");
CREATE UNIQUE INDEX "creative_provider_cap_evidence_source_key_key" ON "creative_provider_cap_evidence"("source_key");
CREATE INDEX "creative_provider_cap_evidence_scope_key_active_verified_at_idx" ON "creative_provider_cap_evidence"("scope_key", "active", "verified_at");
CREATE INDEX "creative_provider_cap_evidence_provider_id_expires_at_idx" ON "creative_provider_cap_evidence"("provider_id", "expires_at");
CREATE UNIQUE INDEX "creative_provider_circuit_states_scope_key_key" ON "creative_provider_circuit_states"("scope_key");
CREATE INDEX "creative_provider_circuit_states_provider_id_workspace_status_idx" ON "creative_provider_circuit_states"("provider_id", "workspace", "status");
CREATE INDEX "creative_provider_circuit_states_status_cooldown_until_idx" ON "creative_provider_circuit_states"("status", "cooldown_until");
CREATE UNIQUE INDEX "creative_provider_circuit_events_source_key_key" ON "creative_provider_circuit_events"("source_key");
CREATE INDEX "creative_provider_circuit_events_circuit_state_id_occurred_at_idx" ON "creative_provider_circuit_events"("circuit_state_id", "occurred_at");

ALTER TABLE "creative_provider_circuit_events"
  ADD CONSTRAINT "creative_provider_circuit_events_circuit_state_id_fkey"
  FOREIGN KEY ("circuit_state_id") REFERENCES "creative_provider_circuit_states"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
