CREATE TYPE "PostStatus" AS ENUM ('draft', 'published', 'deleted');

ALTER TABLE "posts"
  ADD COLUMN "status" "PostStatus" NOT NULL DEFAULT 'published',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "published_at" TIMESTAMP(3),
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deletion_reason_code" TEXT;

UPDATE "posts"
SET "published_at" = "created_at"
WHERE "published_at" IS NULL;

CREATE INDEX "posts_status_created_at_id_idx" ON "posts"("status", "created_at", "id");
CREATE INDEX "posts_author_id_status_updated_at_id_idx" ON "posts"("author_id", "status", "updated_at", "id");
