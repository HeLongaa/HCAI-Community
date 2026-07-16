ALTER TABLE "media_assets"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_handle" TEXT,
  ADD COLUMN "deletion_reason" TEXT;

DROP INDEX IF EXISTS "media_assets_owner_id_archived_at_created_at_idx";
CREATE INDEX "media_assets_owner_id_deleted_at_archived_at_created_at_idx"
  ON "media_assets"("owner_id", "deleted_at", "archived_at", "created_at");
