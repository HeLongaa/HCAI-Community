ALTER TABLE "observability_alerts"
  ADD COLUMN "escalation_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "escalated_by" TEXT,
  ADD COLUMN "escalation_target" TEXT;

CREATE TABLE "observability_slo_controls" (
  "id" TEXT NOT NULL,
  "slo_id" TEXT NOT NULL,
  "target" DOUBLE PRECISION NOT NULL,
  "short_window_burn_threshold" DOUBLE PRECISION NOT NULL,
  "long_window_burn_threshold" DOUBLE PRECISION NOT NULL,
  "latency_threshold_ms" INTEGER NOT NULL,
  "severity" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "runbook" TEXT NOT NULL,
  "primary_on_call_handle" TEXT NOT NULL,
  "secondary_on_call_handle" TEXT,
  "escalation_minutes" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "observability_slo_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observability_slo_controls_values_check" CHECK (
    "target" > 0 AND "target" < 1 AND
    "short_window_burn_threshold" > 0 AND "short_window_burn_threshold" <= 1000 AND
    "long_window_burn_threshold" > 0 AND "long_window_burn_threshold" <= 1000 AND
    "latency_threshold_ms" BETWEEN 1 AND 60000 AND
    "escalation_minutes" BETWEEN 1 AND 1440 AND
    "version" > 0
  ),
  CONSTRAINT "observability_slo_controls_identifiers_check" CHECK (
    "slo_id" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND
    "severity" IN ('warning', 'high', 'critical') AND
    "owner" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' AND
    "primary_on_call_handle" ~ '^[a-z0-9][a-z0-9_-]{1,31}$' AND
    ("secondary_on_call_handle" IS NULL OR "secondary_on_call_handle" ~ '^[a-z0-9][a-z0-9_-]{1,31}$') AND
    "reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
  )
);

CREATE TABLE "observability_alert_events" (
  "id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "from_state" TEXT,
  "to_state" TEXT,
  "reason_code" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "metadata" JSONB,
  "metadata_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "observability_alert_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observability_alert_events_values_check" CHECK (
    "event_type" IN ('fired', 'recovered', 'acknowledged', 'silenced', 'escalated', 'resolved', 'reviewed') AND
    ("from_state" IS NULL OR "from_state" IN ('firing', 'acknowledged', 'silenced', 'resolved')) AND
    ("to_state" IS NULL OR "to_state" IN ('firing', 'acknowledged', 'silenced', 'resolved')) AND
    "reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$' AND
    "metadata_schema_version" = 1
  )
);

CREATE TABLE "observability_incident_reviews" (
  "id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "root_cause" TEXT NOT NULL,
  "impact" TEXT NOT NULL,
  "corrective_actions" JSONB NOT NULL,
  "corrective_actions_schema_version" INTEGER NOT NULL DEFAULT 1,
  "corrective_actions_hash" TEXT NOT NULL,
  "reviewer_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "observability_incident_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observability_incident_reviews_hash_check" CHECK (
    "corrective_actions_schema_version" = 1 AND
    "corrective_actions_hash" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "observability_slo_controls_slo_id_key" ON "observability_slo_controls"("slo_id");
CREATE INDEX "observability_slo_controls_enabled_updated_at_idx" ON "observability_slo_controls"("enabled", "updated_at");
CREATE INDEX "observability_alert_events_alert_id_created_at_id_idx" ON "observability_alert_events"("alert_id", "created_at", "id");
CREATE INDEX "observability_alert_events_event_type_created_at_idx" ON "observability_alert_events"("event_type", "created_at");
CREATE UNIQUE INDEX "observability_incident_reviews_alert_id_key" ON "observability_incident_reviews"("alert_id");
CREATE INDEX "observability_incident_reviews_created_at_idx" ON "observability_incident_reviews"("created_at");

ALTER TABLE "observability_alert_events" ADD CONSTRAINT "observability_alert_events_alert_id_fkey"
  FOREIGN KEY ("alert_id") REFERENCES "observability_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "observability_incident_reviews" ADD CONSTRAINT "observability_incident_reviews_alert_id_fkey"
  FOREIGN KEY ("alert_id") REFERENCES "observability_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_observability_incident_fact_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'observability incident facts are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "observability_alert_events_immutable"
  BEFORE UPDATE OR DELETE ON "observability_alert_events"
  FOR EACH ROW EXECUTE FUNCTION reject_observability_incident_fact_mutation();
CREATE TRIGGER "observability_incident_reviews_immutable"
  BEFORE UPDATE OR DELETE ON "observability_incident_reviews"
  FOR EACH ROW EXECUTE FUNCTION reject_observability_incident_fact_mutation();
