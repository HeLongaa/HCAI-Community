CREATE TYPE "MediaAssetPurpose" AS ENUM ('task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset');

CREATE TYPE "MediaAssetStatus" AS ENUM ('pending', 'uploaded', 'rejected');

CREATE TABLE "media_assets" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "purpose" "MediaAssetPurpose" NOT NULL,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'pending',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");
CREATE INDEX "media_assets_owner_id_idx" ON "media_assets"("owner_id");
CREATE INDEX "media_assets_purpose_idx" ON "media_assets"("purpose");
CREATE INDEX "media_assets_status_idx" ON "media_assets"("status");

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
