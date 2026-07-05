-- Add an idempotency boundary for task escrow and settlement ledger events.
-- PostgreSQL allows multiple NULL values, so legacy community rows with no source id remain valid.
CREATE UNIQUE INDEX "point_ledger_user_id_source_type_source_id_key" ON "point_ledger"("user_id", "source_type", "source_id");
