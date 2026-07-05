CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "client_key" TEXT,
    "identity" TEXT,
    "method" TEXT,
    "pathname" TEXT,
    "details" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_events_occurred_at_idx" ON "security_events"("occurred_at");
CREATE INDEX "security_events_source_occurred_at_idx" ON "security_events"("source", "occurred_at");
CREATE INDEX "security_events_severity_occurred_at_idx" ON "security_events"("severity", "occurred_at");
CREATE INDEX "security_events_type_occurred_at_idx" ON "security_events"("type", "occurred_at");
