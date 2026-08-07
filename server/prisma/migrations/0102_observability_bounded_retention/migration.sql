CREATE TABLE "observability_retention_aggregates" (
  "id" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "service" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "status_class" TEXT NOT NULL,
  "request_count" INTEGER NOT NULL,
  "duration_total_ms" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "observability_retention_aggregates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "observability_retention_aggregate_dimensions_key"
ON "observability_retention_aggregates"("bucket_start", "service", "module", "event", "outcome", "status_class");

CREATE INDEX "observability_retention_aggregate_bucket_idx"
ON "observability_retention_aggregates"("bucket_start");
