CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
  'queued',
  'processing',
  'retry_scheduled',
  'sent',
  'suppressed',
  'dead_lettered',
  'cancelled'
);

CREATE TYPE "NotificationDeliveryAttemptStatus" AS ENUM (
  'processing',
  'sent',
  'failed',
  'timed_out'
);

CREATE TABLE "notification_deliveries" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'queued',
  "idempotency_key" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "provider_receipt_hash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "sent_at" TIMESTAMP(3),
  "suppressed_at" TIMESTAMP(3),
  "dead_lettered_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_bounds_check" CHECK (
    "attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "version" >= 1
  ),
  CONSTRAINT "notification_deliveries_terminal_check" CHECK (
    ("status" = 'sent' AND "sent_at" IS NOT NULL)
    OR ("status" = 'suppressed' AND "suppressed_at" IS NOT NULL)
    OR ("status" = 'dead_lettered' AND "dead_lettered_at" IS NOT NULL)
    OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL)
    OR "status" IN ('queued', 'processing', 'retry_scheduled')
  )
);

CREATE TABLE "notification_delivery_attempts" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "NotificationDeliveryAttemptStatus" NOT NULL DEFAULT 'processing',
  "worker_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "response_class" TEXT,
  "status_code" INTEGER,
  "error_code" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_delivery_attempts_bounds_check" CHECK (
    "attempt_number" >= 1 AND ("status_code" IS NULL OR "status_code" BETWEEN 100 AND 599)
  )
);

CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key" ON "notification_deliveries"("idempotency_key");
CREATE UNIQUE INDEX "notification_deliveries_lease_token_key" ON "notification_deliveries"("lease_token");
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");
CREATE INDEX "notification_deliveries_status_available_at_idx" ON "notification_deliveries"("status", "available_at");
CREATE INDEX "notification_deliveries_channel_created_at_idx" ON "notification_deliveries"("channel", "created_at");
CREATE INDEX "notification_deliveries_lease_expires_at_idx" ON "notification_deliveries"("lease_expires_at");
CREATE UNIQUE INDEX "notification_delivery_attempts_lease_token_key" ON "notification_delivery_attempts"("lease_token");
CREATE UNIQUE INDEX "notification_delivery_attempts_delivery_id_attempt_number_key" ON "notification_delivery_attempts"("delivery_id", "attempt_number");
CREATE INDEX "notification_delivery_attempts_status_started_at_idx" ON "notification_delivery_attempts"("status", "started_at");

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_delivery_attempts"
  ADD CONSTRAINT "notification_delivery_attempts_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "notification_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
