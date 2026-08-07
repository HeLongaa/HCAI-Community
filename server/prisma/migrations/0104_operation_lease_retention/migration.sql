CREATE INDEX "operation_leases_released_retention_idx"
ON "operation_leases"("released_at", "key");
