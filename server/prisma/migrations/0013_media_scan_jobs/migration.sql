CREATE TYPE "MediaScanJobStatus" AS ENUM ('queued', 'retrying', 'completed', 'failed');

CREATE TABLE "media_scan_jobs" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "MediaScanJobStatus" NOT NULL,
    "scan_status" TEXT NOT NULL,
    "external_scan_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "requested_at" TIMESTAMP(3),
    "timeout_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "callback_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "note" TEXT,
    "rejection_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_scan_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_scan_jobs_asset_id_created_at_idx" ON "media_scan_jobs"("asset_id", "created_at");
CREATE INDEX "media_scan_jobs_status_timeout_at_idx" ON "media_scan_jobs"("status", "timeout_at");
CREATE INDEX "media_scan_jobs_scan_status_idx" ON "media_scan_jobs"("scan_status");
CREATE INDEX "media_scan_jobs_external_scan_id_idx" ON "media_scan_jobs"("external_scan_id");

ALTER TABLE "media_scan_jobs" ADD CONSTRAINT "media_scan_jobs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_scan_jobs" ADD CONSTRAINT "media_scan_jobs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "media_scan_jobs" (
    "id",
    "asset_id",
    "provider",
    "status",
    "scan_status",
    "external_scan_id",
    "attempts",
    "requested_at",
    "timeout_at",
    "next_retry_at",
    "callback_at",
    "failed_at",
    "note",
    "rejection_reason",
    "metadata",
    "created_at",
    "updated_at"
)
SELECT
    'media-scan-job-backfill-' || "id",
    "id",
    COALESCE(NULLIF("metadata" #>> '{security,scanProvider}', ''), 'manual'),
    CASE "metadata" #>> '{security,scanJobStatus}'
        WHEN 'queued' THEN 'queued'::"MediaScanJobStatus"
        WHEN 'retrying' THEN 'retrying'::"MediaScanJobStatus"
        WHEN 'failed' THEN 'failed'::"MediaScanJobStatus"
        ELSE 'completed'::"MediaScanJobStatus"
    END,
    COALESCE(NULLIF("metadata" #>> '{security,scanStatus}', ''), 'pending'),
    NULLIF("metadata" #>> '{security,externalScanId}', ''),
    COALESCE(NULLIF("metadata" #>> '{security,scanAttempts}', '')::INTEGER, 1),
    NULLIF("metadata" #>> '{security,scanRequestedAt}', '')::TIMESTAMP(3),
    NULLIF("metadata" #>> '{security,scanTimeoutAt}', '')::TIMESTAMP(3),
    NULLIF("metadata" #>> '{security,nextRetryAt}', '')::TIMESTAMP(3),
    NULLIF("metadata" #>> '{security,callbackReceivedAt}', '')::TIMESTAMP(3),
    NULLIF("metadata" #>> '{security,failedAt}', '')::TIMESTAMP(3),
    NULLIF("metadata" #>> '{security,scanNote}', ''),
    NULLIF("metadata" #>> '{security,rejectionReason}', ''),
    "metadata" -> 'security',
    COALESCE(NULLIF("metadata" #>> '{security,scanRequestedAt}', '')::TIMESTAMP(3), "created_at"),
    "updated_at"
FROM "media_assets"
WHERE "metadata" -> 'security' ? 'scanJobStatus';
