ALTER TABLE "inspiration_entries"
ADD COLUMN "content_schema_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "inspiration_revisions"
ADD COLUMN "snapshot_schema_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "inspiration_usage"
ADD COLUMN "context_schema_version" INTEGER NOT NULL DEFAULT 1;
