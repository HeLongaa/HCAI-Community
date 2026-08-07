ALTER TABLE "library_items"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "deleted_at" TIMESTAMP(3),
ADD COLUMN "deletion_reason_code" TEXT,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "library_items_user_id_deleted_at_created_at_idx"
ON "library_items"("user_id", "deleted_at", "created_at");

CREATE INDEX "library_items_deleted_at_id_idx"
ON "library_items"("deleted_at", "id");
