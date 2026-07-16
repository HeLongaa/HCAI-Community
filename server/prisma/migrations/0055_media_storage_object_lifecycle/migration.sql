CREATE TYPE "MediaStorageObjectState" AS ENUM (
  'pending_upload',
  'verifying',
  'quarantined',
  'available',
  'cleanup_pending',
  'deleting',
  'deleted',
  'verification_failed'
);

CREATE TABLE "media_storage_objects" (
  "asset_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "state" "MediaStorageObjectState" NOT NULL DEFAULT 'pending_upload',
  "etag" TEXT,
  "checksum_sha256" TEXT,
  "verified_size_bytes" INTEGER,
  "verified_content_type" TEXT,
  "verified_at" TIMESTAMP(3),
  "quarantined_at" TIMESTAMP(3),
  "cleanup_after" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "media_storage_objects_pkey" PRIMARY KEY ("asset_id"),
  CONSTRAINT "media_storage_objects_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "media_storage_objects_state_cleanup_after_idx"
  ON "media_storage_objects"("state", "cleanup_after");
CREATE INDEX "media_storage_objects_provider_state_idx"
  ON "media_storage_objects"("provider", "state");

INSERT INTO "media_storage_objects" (
  "asset_id",
  "provider",
  "state",
  "checksum_sha256",
  "verified_size_bytes",
  "verified_content_type",
  "verified_at",
  "quarantined_at",
  "cleanup_after",
  "created_at",
  "updated_at"
)
SELECT
  asset."id",
  COALESCE(asset."metadata"->'storage'->>'provider', 'legacy'),
  CASE
    WHEN asset."deleted_at" IS NOT NULL THEN 'cleanup_pending'::"MediaStorageObjectState"
    WHEN asset."status" = 'pending' THEN 'pending_upload'::"MediaStorageObjectState"
    WHEN asset."status" = 'uploaded'
      AND asset."archived_at" IS NULL
      AND asset."metadata"->'security'->>'scanStatus' = 'clean'
      THEN 'available'::"MediaStorageObjectState"
    ELSE 'quarantined'::"MediaStorageObjectState"
  END,
  COALESCE(asset."metadata"->'security'->>'checksum', asset."metadata"->>'checksum'),
  CASE WHEN asset."status" <> 'pending' THEN asset."size_bytes" ELSE NULL END,
  CASE WHEN asset."status" <> 'pending' THEN asset."content_type" ELSE NULL END,
  CASE WHEN asset."status" <> 'pending' THEN asset."updated_at" ELSE NULL END,
  CASE
    WHEN asset."status" = 'rejected' OR asset."archived_at" IS NOT NULL OR asset."deleted_at" IS NOT NULL
      THEN asset."updated_at"
    ELSE NULL
  END,
  CASE WHEN asset."deleted_at" IS NOT NULL THEN asset."deleted_at" + INTERVAL '30 days' ELSE NULL END,
  asset."created_at",
  asset."updated_at"
FROM "media_assets" asset
ON CONFLICT ("asset_id") DO NOTHING;
