CREATE TYPE "ProviderAlertDeliveryStatus" AS ENUM ('queued', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'cancelled');
CREATE TYPE "ProviderAlertDeliveryAttemptStatus" AS ENUM ('processing', 'succeeded', 'failed');

CREATE TABLE "provider_alert_deliveries" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "audit_event_id" TEXT,
  "channel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "ProviderAlertDeliveryStatus" NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "replay_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "last_status_code" INTEGER,
  "receipt_hash" TEXT,
  "delivered_at" TIMESTAMP(3),
  "dead_lettered_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_alert_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_alert_delivery_attempts" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "ProviderAlertDeliveryAttemptStatus" NOT NULL DEFAULT 'processing',
  "worker_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "response_class" TEXT,
  "status_code" INTEGER,
  "error_code" TEXT,
  "duration_ms" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_alert_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_alert_delivery_replays" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_alert_delivery_replays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_alert_deliveries_source_key_channel_key" ON "provider_alert_deliveries"("source_key", "channel");
CREATE UNIQUE INDEX "provider_alert_deliveries_lease_token_key" ON "provider_alert_deliveries"("lease_token");
CREATE INDEX "provider_alert_deliveries_status_available_at_id_idx" ON "provider_alert_deliveries"("status", "available_at", "id");
CREATE INDEX "provider_alert_deliveries_lease_expires_at_idx" ON "provider_alert_deliveries"("lease_expires_at");
CREATE UNIQUE INDEX "provider_alert_delivery_attempts_lease_token_key" ON "provider_alert_delivery_attempts"("lease_token");
CREATE UNIQUE INDEX "provider_alert_delivery_attempts_delivery_id_attempt_number_key" ON "provider_alert_delivery_attempts"("delivery_id", "attempt_number");
CREATE INDEX "provider_alert_delivery_attempts_status_started_at_idx" ON "provider_alert_delivery_attempts"("status", "started_at");
CREATE UNIQUE INDEX "provider_alert_delivery_replays_idempotency_key_key" ON "provider_alert_delivery_replays"("idempotency_key");
CREATE INDEX "provider_alert_delivery_replays_delivery_id_requested_at_idx" ON "provider_alert_delivery_replays"("delivery_id", "requested_at");
CREATE INDEX "provider_alert_delivery_replays_requested_by_id_requested_at_idx" ON "provider_alert_delivery_replays"("requested_by_id", "requested_at");

ALTER TABLE "provider_alert_delivery_attempts" ADD CONSTRAINT "provider_alert_delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "provider_alert_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_alert_delivery_replays" ADD CONSTRAINT "provider_alert_delivery_replays_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "provider_alert_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_alert_deliveries" ADD CONSTRAINT "provider_alert_deliveries_channel_check" CHECK ("channel" IN ('webhook', 'slack', 'email'));
ALTER TABLE "provider_alert_deliveries" ADD CONSTRAINT "provider_alert_deliveries_bounds_check" CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 12 AND "replay_count" >= 0 AND "version" >= 1);
ALTER TABLE "provider_alert_deliveries" ADD CONSTRAINT "provider_alert_deliveries_lease_check" CHECK (("status" = 'processing' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("status" <> 'processing' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL));
ALTER TABLE "provider_alert_deliveries" ADD CONSTRAINT "provider_alert_deliveries_receipt_hash_check" CHECK ("receipt_hash" IS NULL OR "receipt_hash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "provider_alert_delivery_attempts" ADD CONSTRAINT "provider_alert_delivery_attempts_bounds_check" CHECK ("attempt_number" BETWEEN 1 AND 12 AND ("duration_ms" IS NULL OR "duration_ms" >= 0));
ALTER TABLE "provider_alert_delivery_replays" ADD CONSTRAINT "provider_alert_delivery_replays_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{2,63}$');
