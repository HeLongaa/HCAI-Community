CREATE TYPE "WebhookSubscriptionStatus" AS ENUM ('active', 'disabled', 'deleted');
CREATE TYPE "WebhookSigningSecretStatus" AS ENUM ('active', 'retired', 'revoked');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('queued', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'cancelled');
CREATE TYPE "WebhookDeliveryAttemptStatus" AS ENUM ('processing', 'succeeded', 'failed');

CREATE TABLE "webhook_controls" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_subscriptions_per_user" INTEGER NOT NULL DEFAULT 5,
    "max_event_types_per_subscription" INTEGER NOT NULL DEFAULT 1,
    "default_max_attempts" INTEGER NOT NULL DEFAULT 5,
    "base_retry_seconds" INTEGER NOT NULL DEFAULT 30,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 10,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reason_code" TEXT NOT NULL DEFAULT 'default_disabled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_controls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_controls_singleton_check" CHECK ("id" = 'global'),
    CONSTRAINT "webhook_controls_subscription_limit_check" CHECK ("max_subscriptions_per_user" BETWEEN 1 AND 20),
    CONSTRAINT "webhook_controls_event_limit_check" CHECK ("max_event_types_per_subscription" BETWEEN 1 AND 50),
    CONSTRAINT "webhook_controls_attempt_limit_check" CHECK ("default_max_attempts" BETWEEN 1 AND 12),
    CONSTRAINT "webhook_controls_backoff_check" CHECK ("base_retry_seconds" BETWEEN 1 AND 3600),
    CONSTRAINT "webhook_controls_timeout_check" CHECK ("timeout_seconds" BETWEEN 1 AND 30)
);
INSERT INTO "webhook_controls" ("id") VALUES ('global');

CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "event_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "WebhookSubscriptionStatus" NOT NULL DEFAULT 'active',
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "version" INTEGER NOT NULL DEFAULT 1,
    "disabled_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_subscriptions_name_check" CHECK (char_length("name") BETWEEN 2 AND 80),
    CONSTRAINT "webhook_subscriptions_endpoint_check" CHECK (char_length("endpoint_url") BETWEEN 8 AND 2048),
    CONSTRAINT "webhook_subscriptions_event_types_check" CHECK (cardinality("event_types") BETWEEN 1 AND 50),
    CONSTRAINT "webhook_subscriptions_attempts_check" CHECK ("max_attempts" BETWEEN 1 AND 12)
);

CREATE TABLE "webhook_signing_secrets" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "secret_hint" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "encryption_iv" TEXT NOT NULL,
    "encryption_tag" TEXT NOT NULL,
    "status" "WebhookSigningSecretStatus" NOT NULL DEFAULT 'active',
    "retired_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_signing_secrets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_signing_secrets_hash_check" CHECK ("secret_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "signing_secret_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "replay_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_status_code" INTEGER,
    "delivered_at" TIMESTAMP(3),
    "dead_lettered_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_attempt_count_check" CHECK ("attempt_count" >= 0),
    CONSTRAINT "webhook_deliveries_max_attempts_check" CHECK ("max_attempts" >= 1),
    CONSTRAINT "webhook_deliveries_replay_count_check" CHECK ("replay_count" >= 0),
    CONSTRAINT "webhook_deliveries_event_version_check" CHECK ("event_version" >= 1)
);

CREATE TABLE "webhook_delivery_attempts" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "WebhookDeliveryAttemptStatus" NOT NULL DEFAULT 'processing',
    "worker_id" TEXT NOT NULL,
    "lease_token" TEXT NOT NULL,
    "response_class" TEXT,
    "status_code" INTEGER,
    "error_code" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_delivery_attempts_number_check" CHECK ("attempt_number" >= 1),
    CONSTRAINT "webhook_delivery_attempts_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0)
);

CREATE TABLE "webhook_delivery_replays" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_delivery_replays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_subscriptions_owner_user_id_name_key" ON "webhook_subscriptions"("owner_user_id", "name");
CREATE INDEX "webhook_subscriptions_owner_user_id_status_updated_at_id_idx" ON "webhook_subscriptions"("owner_user_id", "status", "updated_at", "id");
CREATE INDEX "webhook_subscriptions_status_updated_at_id_idx" ON "webhook_subscriptions"("status", "updated_at", "id");
CREATE UNIQUE INDEX "webhook_signing_secrets_key_id_key" ON "webhook_signing_secrets"("key_id");
CREATE INDEX "webhook_signing_secrets_subscription_id_status_created_at_idx" ON "webhook_signing_secrets"("subscription_id", "status", "created_at");
CREATE UNIQUE INDEX "webhook_deliveries_lease_token_key" ON "webhook_deliveries"("lease_token");
CREATE UNIQUE INDEX "webhook_deliveries_subscription_id_event_id_key" ON "webhook_deliveries"("subscription_id", "event_id");
CREATE INDEX "webhook_deliveries_status_available_at_id_idx" ON "webhook_deliveries"("status", "available_at", "id");
CREATE INDEX "webhook_deliveries_subscription_id_created_at_id_idx" ON "webhook_deliveries"("subscription_id", "created_at", "id");
CREATE INDEX "webhook_deliveries_event_type_created_at_id_idx" ON "webhook_deliveries"("event_type", "created_at", "id");
CREATE INDEX "webhook_deliveries_lease_expires_at_idx" ON "webhook_deliveries"("lease_expires_at");
CREATE UNIQUE INDEX "webhook_delivery_attempts_lease_token_key" ON "webhook_delivery_attempts"("lease_token");
CREATE UNIQUE INDEX "webhook_delivery_attempts_delivery_id_attempt_number_key" ON "webhook_delivery_attempts"("delivery_id", "attempt_number");
CREATE INDEX "webhook_delivery_attempts_status_started_at_idx" ON "webhook_delivery_attempts"("status", "started_at");
CREATE UNIQUE INDEX "webhook_delivery_replays_idempotency_key_key" ON "webhook_delivery_replays"("idempotency_key");
CREATE INDEX "webhook_delivery_replays_delivery_id_requested_at_idx" ON "webhook_delivery_replays"("delivery_id", "requested_at");
CREATE INDEX "webhook_delivery_replays_requested_by_id_requested_at_idx" ON "webhook_delivery_replays"("requested_by_id", "requested_at");

ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_signing_secrets" ADD CONSTRAINT "webhook_signing_secrets_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_signing_secret_id_fkey" FOREIGN KEY ("signing_secret_id") REFERENCES "webhook_signing_secrets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery_replays" ADD CONSTRAINT "webhook_delivery_replays_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery_replays" ADD CONSTRAINT "webhook_delivery_replays_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at") VALUES
  ('developer:webhooks:manage', 'developer-platform', 'webhook_subscription', 'manage', 'high', false, true, 'Manage actor-owned webhook subscriptions, signing secrets, deliveries, and replay', CURRENT_TIMESTAMP),
  ('admin:webhooks:read', 'developer-platform', 'webhook_operation', 'read', 'high', false, false, 'Read secret-free webhook subscriptions, delivery attempts, DLQ, and metrics', CURRENT_TIMESTAMP),
  ('admin:webhooks:manage', 'developer-platform', 'webhook_operation', 'manage', 'critical', true, true, 'Control webhook availability, disable subscriptions, and replay dead-lettered deliveries', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action", "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected", "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('member', 'developer:webhooks:manage'),
  ('creator', 'developer:webhooks:manage'),
  ('publisher', 'developer:webhooks:manage'),
  ('moderator', 'developer:webhooks:manage'),
  ('admin', 'developer:webhooks:manage'),
  ('moderator', 'admin:webhooks:read'),
  ('admin', 'admin:webhooks:read'),
  ('admin', 'admin:webhooks:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
