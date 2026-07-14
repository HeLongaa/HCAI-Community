CREATE TYPE "InternalAccountingUnit" AS ENUM ('points', 'creative_credit', 'quota_unit');
CREATE TYPE "InternalAccountingOperationStatus" AS ENUM ('pending', 'applied', 'compensated', 'failed');
CREATE TYPE "AccountingReconciliationStatus" AS ENUM ('open', 'repair_pending', 'resolved', 'ignored');

ALTER TABLE "creative_quota_reservations"
  ADD COLUMN "idempotency_payload_hash" TEXT;

INSERT INTO "permissions" ("id", "description") VALUES
  ('admin:accounting:read', 'Read internal accounting reconciliation evidence'),
  ('admin:accounting:scan', 'Run internal accounting reconciliation scans'),
  ('admin:accounting:repair', 'Request and approve internal accounting compensation')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:accounting:read'),
  ('admin', 'admin:accounting:read'),
  ('admin', 'admin:accounting:scan'),
  ('admin', 'admin:accounting:repair')
ON CONFLICT ("role", "permission_id") DO NOTHING;

CREATE TABLE "internal_point_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "balance" INTEGER NOT NULL,
  "opening_balance" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "internal_point_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "internal_accounting_operations" (
  "id" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "unit" "InternalAccountingUnit" NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "InternalAccountingOperationStatus" NOT NULL DEFAULT 'pending',
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "original_operation_key" TEXT,
  "reconciliation_issue_id" TEXT,
  "actor_ref" TEXT,
  "metadata" JSONB,
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "internal_accounting_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "internal_accounting_movements" (
  "id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "unit" "InternalAccountingUnit" NOT NULL,
  "account_ref" TEXT NOT NULL,
  "account_type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER,
  "sequence" INTEGER NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_accounting_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_reconciliation_issues" (
  "id" TEXT NOT NULL,
  "issue_key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "unit" "InternalAccountingUnit" NOT NULL,
  "status" "AccountingReconciliationStatus" NOT NULL DEFAULT 'open',
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "expected_amount" INTEGER,
  "actual_amount" INTEGER,
  "difference_amount" INTEGER,
  "operation_key" TEXT,
  "repair_operation_key" TEXT,
  "evidence" JSONB,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_reconciliation_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "internal_point_accounts_user_id_key" ON "internal_point_accounts"("user_id");
CREATE INDEX "internal_point_accounts_updated_at_idx" ON "internal_point_accounts"("updated_at");
CREATE UNIQUE INDEX "internal_accounting_operations_operation_key_unit_key" ON "internal_accounting_operations"("operation_key", "unit");
CREATE INDEX "internal_accounting_operations_source_type_source_id_created_at_idx" ON "internal_accounting_operations"("source_type", "source_id", "created_at");
CREATE INDEX "internal_accounting_operations_unit_status_created_at_idx" ON "internal_accounting_operations"("unit", "status", "created_at");
CREATE INDEX "internal_accounting_operations_reconciliation_issue_id_idx" ON "internal_accounting_operations"("reconciliation_issue_id");
CREATE UNIQUE INDEX "internal_accounting_movements_operation_id_sequence_key" ON "internal_accounting_movements"("operation_id", "sequence");
CREATE INDEX "internal_accounting_movements_account_ref_created_at_idx" ON "internal_accounting_movements"("account_ref", "created_at");
CREATE INDEX "internal_accounting_movements_unit_account_type_created_at_idx" ON "internal_accounting_movements"("unit", "account_type", "created_at");
CREATE UNIQUE INDEX "accounting_reconciliation_issues_issue_key_key" ON "accounting_reconciliation_issues"("issue_key");
CREATE INDEX "accounting_reconciliation_issues_status_detected_at_idx" ON "accounting_reconciliation_issues"("status", "detected_at");
CREATE INDEX "accounting_reconciliation_issues_unit_type_detected_at_idx" ON "accounting_reconciliation_issues"("unit", "type", "detected_at");
CREATE INDEX "accounting_reconciliation_issues_source_type_source_id_idx" ON "accounting_reconciliation_issues"("source_type", "source_id");

ALTER TABLE "internal_point_accounts"
  ADD CONSTRAINT "internal_point_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_accounting_movements"
  ADD CONSTRAINT "internal_accounting_movements_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "internal_accounting_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_reconciliation_issues"
  ADD CONSTRAINT "accounting_reconciliation_issues_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Freeze the latest legacy point balance as the opening balance. Historical
-- rows remain untouched and are reconciled separately below.
WITH latest AS (
  SELECT
    "user_id",
    "balance_after",
    ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at" DESC, "id" DESC) AS "row_number"
  FROM "point_ledger"
)
INSERT INTO "internal_point_accounts" (
  "id", "user_id", "balance", "opening_balance", "version", "updated_at"
)
SELECT
  'point-account-' || "user_id",
  "user_id",
  "balance_after",
  "balance_after",
  0,
  CURRENT_TIMESTAMP
FROM latest
WHERE "row_number" = 1;

INSERT INTO "internal_accounting_operations" (
  "id", "operation_key", "unit", "kind", "status", "source_type", "source_id",
  "payload_hash", "reason_code", "actor_ref", "metadata", "applied_at", "updated_at"
)
SELECT
  'accounting-opening-points-' || account."user_id",
  'opening_snapshot:point_ledger:' || LOWER(account."user_id") || ':apply',
  'points',
  'opening_snapshot',
  'applied',
  'point_ledger',
  account."user_id",
  MD5(account."user_id" || ':' || account."opening_balance"::TEXT),
  'legacy_opening_balance',
  'system',
  JSONB_BUILD_OBJECT('legacy', true, 'openingBalance', account."opening_balance"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "internal_point_accounts" AS account
WHERE account."opening_balance" <> 0;

INSERT INTO "internal_accounting_movements" (
  "id", "operation_id", "unit", "account_ref", "account_type", "amount", "balance_after", "sequence"
)
SELECT
  operation."id" || '-available',
  operation."id",
  'points',
  'user:' || operation."source_id" || ':points:available',
  'available',
  account."opening_balance",
  account."opening_balance",
  1
FROM "internal_accounting_operations" AS operation
JOIN "internal_point_accounts" AS account ON account."user_id" = operation."source_id"
WHERE operation."kind" = 'opening_snapshot';

INSERT INTO "internal_accounting_movements" (
  "id", "operation_id", "unit", "account_ref", "account_type", "amount", "sequence"
)
SELECT
  operation."id" || '-source',
  operation."id",
  'points',
  'system:legacy:points:source',
  'system_source',
  -account."opening_balance",
  2
FROM "internal_accounting_operations" AS operation
JOIN "internal_point_accounts" AS account ON account."user_id" = operation."source_id"
WHERE operation."kind" = 'opening_snapshot';

WITH ledger_totals AS (
  SELECT "user_id", SUM("delta")::INTEGER AS "expected_balance"
  FROM "point_ledger"
  GROUP BY "user_id"
)
INSERT INTO "accounting_reconciliation_issues" (
  "id", "issue_key", "type", "unit", "status", "source_type", "source_id",
  "expected_amount", "actual_amount", "difference_amount", "evidence", "updated_at"
)
SELECT
  'accounting-issue-point-balance-' || account."user_id",
  'point_balance_drift:' || account."user_id",
  'point_balance_drift',
  'points',
  'open',
  'point_ledger',
  account."user_id",
  totals."expected_balance",
  account."opening_balance",
  account."opening_balance" - totals."expected_balance",
  JSONB_BUILD_OBJECT('migration', '0040', 'legacyRowsPreserved', true),
  CURRENT_TIMESTAMP
FROM "internal_point_accounts" AS account
JOIN ledger_totals AS totals ON totals."user_id" = account."user_id"
WHERE account."opening_balance" <> totals."expected_balance";
