CREATE TABLE "security_incidents" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "critical_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "reason_code" TEXT NOT NULL,
  "opened_by_ref" TEXT NOT NULL,
  "resolved_reason_code" TEXT,
  "resolved_by_ref" TEXT,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_incidents_status_check" CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "security_incidents_resolution_check" CHECK (
    ("status" = 'open' AND "resolved_at" IS NULL AND "resolved_reason_code" IS NULL AND "resolved_by_ref" IS NULL)
    OR
    ("status" = 'resolved' AND "resolved_at" IS NOT NULL AND "resolved_reason_code" IS NOT NULL AND "resolved_by_ref" IS NOT NULL)
  )
);

ALTER TABLE "security_events"
  ADD COLUMN "subject_ref" TEXT,
  ADD COLUMN "incident_id" TEXT;

CREATE INDEX "security_incidents_status_opened_at_id_idx" ON "security_incidents"("status", "opened_at", "id");
CREATE INDEX "security_incidents_critical_confirmed_resolved_at_id_idx" ON "security_incidents"("critical_confirmed", "resolved_at", "id");
CREATE INDEX "security_events_subject_ref_occurred_at_idx" ON "security_events"("subject_ref", "occurred_at");
CREATE INDEX "security_events_incident_id_occurred_at_idx" ON "security_events"("incident_id", "occurred_at");

ALTER TABLE "security_events"
  ADD CONSTRAINT "security_events_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "security_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
