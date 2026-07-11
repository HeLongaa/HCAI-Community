CREATE TYPE "CreativeProviderCostLedgerStatus" AS ENUM (
  'reserved',
  'settled',
  'released',
  'reconciliation_required'
);

CREATE TABLE "creative_provider_budget_windows" (
  "id" TEXT NOT NULL,
  "budget_scope" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "provider_account_ref" TEXT NOT NULL,
  "workspace" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "cap_micros" BIGINT NOT NULL,
  "reserved_micros" BIGINT NOT NULL DEFAULT 0,
  "spent_micros" BIGINT NOT NULL DEFAULT 0,
  "released_micros" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "creative_provider_budget_windows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "creative_provider_cost_ledgers" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "generation_id" TEXT NOT NULL,
  "budget_window_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "provider_account_ref" TEXT NOT NULL,
  "provider_model_id" TEXT NOT NULL,
  "provider_job_id" TEXT,
  "workspace" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "pricing_snapshot" JSONB NOT NULL,
  "pricing_snapshot_hash" TEXT NOT NULL,
  "estimate_micros" BIGINT NOT NULL,
  "reserved_micros" BIGINT NOT NULL,
  "actual_micros" BIGINT,
  "status" "CreativeProviderCostLedgerStatus" NOT NULL,
  "usage" JSONB,
  "risk" JSONB,
  "reason_code" TEXT,
  "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settled_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "reconciliation_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "creative_provider_cost_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creative_provider_budget_windows_budget_scope_currency_window_start_window_end_key"
  ON "creative_provider_budget_windows"("budget_scope", "currency", "window_start", "window_end");
CREATE INDEX "creative_provider_budget_windows_provider_id_workspace_window_start_idx"
  ON "creative_provider_budget_windows"("provider_id", "workspace", "window_start");
CREATE UNIQUE INDEX "creative_provider_cost_ledgers_source_key_key"
  ON "creative_provider_cost_ledgers"("source_key");
CREATE INDEX "creative_provider_cost_ledgers_generation_id_created_at_idx"
  ON "creative_provider_cost_ledgers"("generation_id", "created_at");
CREATE INDEX "creative_provider_cost_ledgers_budget_window_id_status_idx"
  ON "creative_provider_cost_ledgers"("budget_window_id", "status");
CREATE INDEX "creative_provider_cost_ledgers_provider_id_workspace_status_created_at_idx"
  ON "creative_provider_cost_ledgers"("provider_id", "workspace", "status", "created_at");

ALTER TABLE "creative_provider_cost_ledgers"
  ADD CONSTRAINT "creative_provider_cost_ledgers_budget_window_id_fkey"
  FOREIGN KEY ("budget_window_id") REFERENCES "creative_provider_budget_windows"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
