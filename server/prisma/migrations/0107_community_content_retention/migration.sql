CREATE INDEX IF NOT EXISTS "posts_deleted_at_id_idx"
  ON "posts"("deleted_at", "id")
  WHERE "deleted_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "comments_deleted_at_id_idx"
  ON "comments"("deleted_at", "id")
  WHERE "deleted_at" IS NOT NULL;
