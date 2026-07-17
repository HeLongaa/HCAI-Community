CREATE TABLE "user_tags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT NOT NULL DEFAULT 'gray',
  "version" INTEGER NOT NULL DEFAULT 1,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_tags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_tags_key_format_check" CHECK ("key" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  CONSTRAINT "user_tags_label_length_check" CHECK (char_length("label") BETWEEN 1 AND 80),
  CONSTRAINT "user_tags_description_length_check" CHECK ("description" IS NULL OR char_length("description") <= 240),
  CONSTRAINT "user_tags_color_check" CHECK ("color" IN ('gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink')),
  CONSTRAINT "user_tags_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "user_tags_key_key" ON "user_tags"("key");
CREATE INDEX "user_tags_archived_at_label_id_idx" ON "user_tags"("archived_at", "label", "id");

CREATE TABLE "user_tag_assignments" (
  "user_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "assigned_by_id" TEXT NOT NULL,
  "assign_reason_code" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_by_id" TEXT,
  "remove_reason_code" TEXT,
  "removed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "user_tag_assignments_pkey" PRIMARY KEY ("user_id", "tag_id"),
  CONSTRAINT "user_tag_assignments_reason_check" CHECK (
    "assign_reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    AND (
      ("removed_at" IS NULL AND "removed_by_id" IS NULL AND "remove_reason_code" IS NULL)
      OR
      ("removed_at" IS NOT NULL AND "removed_by_id" IS NOT NULL AND "remove_reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$')
    )
  ),
  CONSTRAINT "user_tag_assignments_version_check" CHECK ("version" >= 1),
  CONSTRAINT "user_tag_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_tag_assignments_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "user_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_tag_assignments_tag_id_removed_at_user_id_idx" ON "user_tag_assignments"("tag_id", "removed_at", "user_id");
CREATE INDEX "user_tag_assignments_user_id_removed_at_tag_id_idx" ON "user_tag_assignments"("user_id", "removed_at", "tag_id");
