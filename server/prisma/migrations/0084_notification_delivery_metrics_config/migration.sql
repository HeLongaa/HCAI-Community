CREATE TABLE "notification_channel_configs" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "delivery_rate_target_bps" INTEGER NOT NULL,
  "failure_rate_alert_threshold_bps" INTEGER NOT NULL,
  "latency_target_ms" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL,
  "retry_backoff_seconds" INTEGER NOT NULL,
  "active_revision_number" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_channel_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_channel_configs_channel_check" CHECK ("channel" IN ('in_app', 'email')),
  CONSTRAINT "notification_channel_configs_core_check" CHECK ("channel" <> 'in_app' OR ("enabled" = true AND "max_attempts" = 1)),
  CONSTRAINT "notification_channel_configs_threshold_check" CHECK (
    "delivery_rate_target_bps" BETWEEN 0 AND 10000 AND
    "failure_rate_alert_threshold_bps" BETWEEN 0 AND 10000 AND
    "latency_target_ms" BETWEEN 1 AND 86400000 AND
    "max_attempts" BETWEEN 1 AND 20 AND
    "retry_backoff_seconds" BETWEEN 1 AND 86400 AND
    "active_revision_number" >= 1 AND "version" >= 1 AND
    "reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
  )
);

CREATE UNIQUE INDEX "notification_channel_configs_channel_key" ON "notification_channel_configs"("channel");

CREATE TABLE "notification_channel_config_revisions" (
  "id" TEXT NOT NULL,
  "config_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "delivery_rate_target_bps" INTEGER NOT NULL,
  "failure_rate_alert_threshold_bps" INTEGER NOT NULL,
  "latency_target_ms" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL,
  "retry_backoff_seconds" INTEGER NOT NULL,
  "reason_code" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_channel_config_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_channel_config_revisions_config_fkey" FOREIGN KEY ("config_id") REFERENCES "notification_channel_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notification_channel_config_revisions_channel_check" CHECK ("channel" IN ('in_app', 'email')),
  CONSTRAINT "notification_channel_config_revisions_core_check" CHECK ("channel" <> 'in_app' OR ("enabled" = true AND "max_attempts" = 1)),
  CONSTRAINT "notification_channel_config_revisions_values_check" CHECK (
    "revision_number" >= 1 AND
    "delivery_rate_target_bps" BETWEEN 0 AND 10000 AND
    "failure_rate_alert_threshold_bps" BETWEEN 0 AND 10000 AND
    "latency_target_ms" BETWEEN 1 AND 86400000 AND
    "max_attempts" BETWEEN 1 AND 20 AND
    "retry_backoff_seconds" BETWEEN 1 AND 86400 AND
    "reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
  )
);

CREATE UNIQUE INDEX "notification_channel_config_revisions_config_id_revision_number_key" ON "notification_channel_config_revisions"("config_id", "revision_number");
CREATE INDEX "notification_channel_config_revisions_channel_revision_number_idx" ON "notification_channel_config_revisions"("channel", "revision_number");

CREATE OR REPLACE FUNCTION reject_notification_channel_config_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'notification channel configuration revisions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notification_channel_config_revisions_immutable_update"
BEFORE UPDATE ON "notification_channel_config_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_notification_channel_config_revision_mutation();

CREATE TRIGGER "notification_channel_config_revisions_immutable_delete"
BEFORE DELETE ON "notification_channel_config_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_notification_channel_config_revision_mutation();

INSERT INTO "notification_channel_configs" (
  "id", "channel", "enabled", "delivery_rate_target_bps", "failure_rate_alert_threshold_bps",
  "latency_target_ms", "max_attempts", "retry_backoff_seconds", "reason_code", "updated_by_ref"
) VALUES
  ('notification-channel-in-app', 'in_app', true, 9950, 50, 60000, 1, 60, 'migration_default', 'system'),
  ('notification-channel-email', 'email', true, 9500, 500, 300000, 3, 60, 'migration_default', 'system');

INSERT INTO "notification_channel_config_revisions" (
  "id", "config_id", "channel", "revision_number", "enabled", "delivery_rate_target_bps",
  "failure_rate_alert_threshold_bps", "latency_target_ms", "max_attempts", "retry_backoff_seconds",
  "reason_code", "actor_ref"
) SELECT
  'notification-channel-revision-' || "channel", "id", "channel", 1, "enabled", "delivery_rate_target_bps",
  "failure_rate_alert_threshold_bps", "latency_target_ms", "max_attempts", "retry_backoff_seconds",
  "reason_code", "updated_by_ref"
FROM "notification_channel_configs";
