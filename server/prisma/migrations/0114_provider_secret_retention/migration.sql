CREATE TABLE "provider_secret_lifecycle_receipts" (
  "id" TEXT NOT NULL,
  "secret_ref_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_hash" TEXT NOT NULL,
  "receipt_hash" TEXT NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_secret_lifecycle_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_secret_lifecycle_receipts_action_check" CHECK ("action" IN ('disable', 'delete')),
  CONSTRAINT "provider_secret_lifecycle_receipts_target_hash_check" CHECK ("target_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "provider_secret_lifecycle_receipts_receipt_hash_check" CHECK ("receipt_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "provider_secret_lifecycle_receipts_completed_at_check" CHECK ("completed_at" <= "created_at" + INTERVAL '5 minutes')
);

CREATE UNIQUE INDEX "provider_secret_lifecycle_receipts_secret_ref_id_action_key"
  ON "provider_secret_lifecycle_receipts"("secret_ref_id", "action");
CREATE INDEX "provider_secret_lifecycle_receipts_action_completed_at_id_idx"
  ON "provider_secret_lifecycle_receipts"("action", "completed_at", "id");

ALTER TABLE "provider_secret_lifecycle_receipts"
  ADD CONSTRAINT "provider_secret_lifecycle_receipts_secret_ref_id_fkey"
  FOREIGN KEY ("secret_ref_id") REFERENCES "provider_secret_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER provider_secret_lifecycle_receipts_immutable_guard
  BEFORE UPDATE OR DELETE ON "provider_secret_lifecycle_receipts"
  FOR EACH ROW EXECUTE FUNCTION preserve_model_governance_fact();
