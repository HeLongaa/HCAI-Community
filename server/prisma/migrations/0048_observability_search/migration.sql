CREATE TABLE "observability_logs" (
  "id" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "level" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "trace_id" TEXT NOT NULL,
  "span_id" TEXT NOT NULL,
  "parent_span_id" TEXT,
  "module" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "duration_ms" INTEGER,
  "error_code" TEXT,
  "method" TEXT,
  "route_template" TEXT,
  "status_code" INTEGER,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "attributes" JSONB,
  "attributes_schema_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "observability_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trace_spans" (
  "id" TEXT NOT NULL,
  "trace_id" TEXT NOT NULL,
  "span_id" TEXT NOT NULL,
  "parent_span_id" TEXT,
  "request_id" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3) NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "error_code" TEXT,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "job_id" TEXT,
  "event_id" TEXT,
  CONSTRAINT "trace_spans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "observability_alerts" (
  "id" TEXT NOT NULL,
  "alert_key" TEXT NOT NULL,
  "slo_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "short_window_burn" DOUBLE PRECISION NOT NULL,
  "long_window_burn" DOUBLE PRECISION NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "owner" TEXT NOT NULL,
  "runbook" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "started_at" TIMESTAMP(3) NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by" TEXT,
  "silenced_until" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "observability_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "observability_logs_timestamp_idx" ON "observability_logs"("timestamp");
CREATE INDEX "observability_logs_trace_id_timestamp_idx" ON "observability_logs"("trace_id", "timestamp");
CREATE INDEX "observability_logs_request_id_timestamp_idx" ON "observability_logs"("request_id", "timestamp");
CREATE INDEX "observability_logs_module_timestamp_idx" ON "observability_logs"("module", "timestamp");
CREATE INDEX "observability_logs_level_timestamp_idx" ON "observability_logs"("level", "timestamp");
CREATE INDEX "observability_logs_resource_type_resource_id_timestamp_idx" ON "observability_logs"("resource_type", "resource_id", "timestamp");
CREATE UNIQUE INDEX "trace_spans_span_id_key" ON "trace_spans"("span_id");
CREATE INDEX "trace_spans_trace_id_started_at_idx" ON "trace_spans"("trace_id", "started_at");
CREATE INDEX "trace_spans_request_id_started_at_idx" ON "trace_spans"("request_id", "started_at");
CREATE INDEX "trace_spans_job_id_started_at_idx" ON "trace_spans"("job_id", "started_at");
CREATE INDEX "trace_spans_event_id_started_at_idx" ON "trace_spans"("event_id", "started_at");
CREATE INDEX "trace_spans_started_at_idx" ON "trace_spans"("started_at");
CREATE UNIQUE INDEX "observability_alerts_alert_key_key" ON "observability_alerts"("alert_key");
CREATE INDEX "observability_alerts_state_updated_at_idx" ON "observability_alerts"("state", "updated_at");
CREATE INDEX "observability_alerts_slo_id_updated_at_idx" ON "observability_alerts"("slo_id", "updated_at");

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:observability:read', 'observability-incident-response', 'observability_log', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:observability:export', 'observability-incident-response', 'observability_log', 'export', 'critical', false, false, CURRENT_TIMESTAMP),
  ('admin:observability:manage', 'observability-incident-response', 'observability_alert', 'manage', 'critical', false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator'::"UserRole", 'admin:observability:read'),
  ('admin'::"UserRole", 'admin:observability:read'),
  ('admin'::"UserRole", 'admin:observability:export'),
  ('admin'::"UserRole", 'admin:observability:manage')
ON CONFLICT DO NOTHING;
