ALTER TABLE "provider_alert_deliveries"
ADD COLUMN "payload_schema_version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "provider_alert_deliveries_status_updated_at_id_idx"
ON "provider_alert_deliveries"("status", "updated_at", "id");
