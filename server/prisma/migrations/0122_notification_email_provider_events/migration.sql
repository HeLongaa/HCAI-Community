CREATE TABLE "notification_email_provider_events" (
  "id" TEXT NOT NULL,
  "provider_event_hash" TEXT NOT NULL,
  "provider_receipt_hash" TEXT NOT NULL,
  "recipient_fingerprint" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "bounce_class" TEXT,
  "reason_code" TEXT,
  "status_evidence" TEXT,
  "payload_hash" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_email_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_email_suppressions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "recipient_fingerprint" TEXT NOT NULL,
  "source_event_hash" TEXT NOT NULL,
  "reason_type" TEXT NOT NULL,
  "reason_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_email_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_email_provider_events_provider_event_hash_key"
  ON "notification_email_provider_events"("provider_event_hash");
CREATE INDEX "notification_email_provider_events_provider_receipt_hash_received_at_idx"
  ON "notification_email_provider_events"("provider_receipt_hash", "received_at");
CREATE INDEX "notification_email_provider_events_recipient_fingerprint_received_at_idx"
  ON "notification_email_provider_events"("recipient_fingerprint", "received_at");
CREATE INDEX "notification_email_provider_events_event_type_received_at_idx"
  ON "notification_email_provider_events"("event_type", "received_at");
CREATE INDEX "notification_deliveries_provider_receipt_hash_idx"
  ON "notification_deliveries"("provider_receipt_hash");

CREATE UNIQUE INDEX "notification_email_suppressions_recipient_fingerprint_key"
  ON "notification_email_suppressions"("recipient_fingerprint");
CREATE INDEX "notification_email_suppressions_user_id_created_at_idx"
  ON "notification_email_suppressions"("user_id", "created_at");
CREATE INDEX "notification_email_suppressions_created_at_id_idx"
  ON "notification_email_suppressions"("created_at", "id");

ALTER TABLE "notification_email_provider_events"
  ADD CONSTRAINT "notification_email_provider_events_hashes_check" CHECK (
    "provider_event_hash" ~ '^[a-f0-9]{64}$'
    AND "provider_receipt_hash" ~ '^[a-f0-9]{64}$'
    AND "recipient_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "payload_hash" ~ '^[a-f0-9]{64}$'
  );
ALTER TABLE "notification_email_provider_events"
  ADD CONSTRAINT "notification_email_provider_events_type_check" CHECK (
    ("event_type" = 'complaint' AND "bounce_class" IS NULL)
    OR ("event_type" = 'bounce' AND "bounce_class" IN ('permanent', 'transient'))
  );
ALTER TABLE "notification_email_provider_events"
  ADD CONSTRAINT "notification_email_provider_events_bounds_check" CHECK (
    ("reason_code" IS NULL OR char_length("reason_code") BETWEEN 1 AND 80)
    AND ("status_evidence" IS NULL OR char_length("status_evidence") BETWEEN 1 AND 160)
  );
ALTER TABLE "notification_email_suppressions"
  ADD CONSTRAINT "notification_email_suppressions_fingerprint_check" CHECK (
    "recipient_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "source_event_hash" ~ '^[a-f0-9]{64}$'
  );
ALTER TABLE "notification_email_suppressions"
  ADD CONSTRAINT "notification_email_suppressions_reason_check" CHECK (
    "reason_type" IN ('complaint', 'permanent_bounce')
    AND ("reason_code" IS NULL OR char_length("reason_code") BETWEEN 1 AND 80)
  );
ALTER TABLE "notification_email_suppressions"
  ADD CONSTRAINT "notification_email_suppressions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
