ALTER TABLE "media_assets"
  ADD COLUMN "subject_ref" TEXT,
  ADD COLUMN "retention_summary" JSONB,
  ADD COLUMN "retention_summary_schema_version" INTEGER,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3),
  ALTER COLUMN "owner_id" DROP NOT NULL;

UPDATE "media_assets"
SET "subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "owner_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "owner_id" IS NOT NULL;

ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_owner_id_fkey";
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_submission_assets" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "task_submission_assets" DROP CONSTRAINT "task_submission_assets_owner_id_fkey";
ALTER TABLE "task_submission_assets" ADD CONSTRAINT "task_submission_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "creative_generation_assets" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "creative_generation_assets" DROP CONSTRAINT "creative_generation_assets_owner_id_fkey";
ALTER TABLE "creative_generation_assets" ADD CONSTRAINT "creative_generation_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_turn_input_assets" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "chat_turn_input_assets" DROP CONSTRAINT "chat_turn_input_assets_owner_id_fkey";
ALTER TABLE "chat_turn_input_assets" ADD CONSTRAINT "chat_turn_input_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "media_asset_relations" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "media_asset_relations" DROP CONSTRAINT "media_asset_relations_owner_id_fkey";
ALTER TABLE "media_asset_relations" ADD CONSTRAINT "media_asset_relations_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "profile_portfolio_assets" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "profile_portfolio_assets" DROP CONSTRAINT "profile_portfolio_assets_owner_id_fkey";
ALTER TABLE "profile_portfolio_assets" ADD CONSTRAINT "profile_portfolio_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "media_assets_subject_ref_retention_redacted_at_idx"
  ON "media_assets"("subject_ref", "retention_redacted_at");
CREATE INDEX "media_assets_deleted_at_status_retention_redacted_at_updated_at_idx"
  ON "media_assets"("deleted_at", "status", "retention_redacted_at", "updated_at");

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_retention_tombstone_valid" CHECK (
    "retention_redacted_at" IS NULL OR (
      "owner_id" IS NULL
      AND "subject_ref" IS NULL
      AND "file_name" = '[deleted]'
      AND "storage_key" ~ '^retained/[a-f0-9]{64}$'
      AND "content_type" = 'application/octet-stream'
      AND "size_bytes" = 0
      AND "metadata" IS NULL
      AND "deleted_by_handle" IS NULL
      AND "deletion_reason" = 'retention_expired'
      AND jsonb_typeof("retention_summary") = 'object'
      AND "retention_summary_schema_version" = 1
      AND ("retention_summary" - ARRAY['policyId', 'schemaVersion', 'objectDeletionVerified', 'objectNeverPersisted', 'relatedRecordsMinimized']::text[]) = '{}'::jsonb
      AND "retention_summary"->>'policyId' = 'media_asset_delete_plus_30d'
      AND "retention_summary"->>'schemaVersion' = '1'
      AND jsonb_typeof("retention_summary"->'objectDeletionVerified') = 'boolean'
      AND jsonb_typeof("retention_summary"->'objectNeverPersisted') = 'boolean'
      AND ("retention_summary"->>'objectDeletionVerified')::boolean IS DISTINCT FROM ("retention_summary"->>'objectNeverPersisted')::boolean
      AND jsonb_typeof("retention_summary"->'relatedRecordsMinimized') = 'number'
      AND "retention_summary"->>'relatedRecordsMinimized' ~ '^(0|[1-9][0-9]*)$'
      AND ("retention_summary"->>'relatedRecordsMinimized')::integer >= 0
    )
  );

CREATE FUNCTION lock_media_asset_write() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('media-asset:' || NEW.id));
  IF TG_OP = 'INSERT' AND NEW.subject_ref IS NULL AND NEW.owner_id IS NOT NULL THEN
    NEW.subject_ref := 'subject_' || substring(encode(digest('data-rights:' || NEW.owner_id, 'sha256'), 'hex') FROM 1 FOR 24);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.retention_redacted_at IS NOT NULL
    AND current_setting('app.media_asset_retention_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'MEDIA_ASSET_RETENTION_REDACTED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_assets_write_lock
BEFORE INSERT OR UPDATE ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION lock_media_asset_write();

CREATE FUNCTION guard_media_asset_reference_write() RETURNS trigger AS $$
DECLARE
  asset_ids TEXT[];
  asset_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'media_asset_relations' THEN
    asset_ids := ARRAY[NEW.source_asset_id, NEW.target_asset_id];
  ELSE
    asset_ids := ARRAY[NEW.asset_id];
  END IF;

  FOREACH asset_id IN ARRAY asset_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext('media-asset:' || asset_id));
    IF EXISTS (
      SELECT 1 FROM "media_assets"
      WHERE id = asset_id AND retention_redacted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'MEDIA_ASSET_RETENTION_REDACTED';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profile_portfolio_assets_media_guard
BEFORE INSERT OR UPDATE ON "profile_portfolio_assets"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();
CREATE TRIGGER task_submission_assets_media_guard
BEFORE INSERT OR UPDATE ON "task_submission_assets"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();
CREATE TRIGGER creative_generation_assets_media_guard
BEFORE INSERT OR UPDATE ON "creative_generation_assets"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();
CREATE TRIGGER chat_turn_input_assets_media_guard
BEFORE INSERT OR UPDATE ON "chat_turn_input_assets"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();
CREATE TRIGGER media_asset_relations_media_guard
BEFORE INSERT OR UPDATE ON "media_asset_relations"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();
CREATE TRIGGER media_storage_objects_media_guard
BEFORE INSERT OR UPDATE ON "media_storage_objects"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();
CREATE TRIGGER media_scan_jobs_media_guard
BEFORE INSERT OR UPDATE ON "media_scan_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_reference_write();

CREATE FUNCTION guard_library_media_reference_write() RETURNS trigger AS $$
BEGIN
  IF NEW.source_type = 'asset' AND NEW.source_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('media-asset:' || NEW.source_id));
    IF EXISTS (
      SELECT 1 FROM "media_assets"
      WHERE id = NEW.source_id AND retention_redacted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'MEDIA_ASSET_RETENTION_REDACTED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER library_items_media_guard
BEFORE INSERT OR UPDATE ON "library_items"
FOR EACH ROW EXECUTE FUNCTION guard_library_media_reference_write();

CREATE FUNCTION guard_media_asset_array_reference_write() RETURNS trigger AS $$
DECLARE
  asset_ids TEXT[];
  asset_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'task_submissions' THEN
    asset_ids := NEW.asset_ids;
  ELSIF TG_TABLE_NAME = 'creative_generations' THEN
    asset_ids := NEW.input_asset_ids || NEW.output_asset_ids;
  ELSE
    asset_ids := NEW.input_asset_ids;
  END IF;

  SELECT array_agg(DISTINCT value ORDER BY value) INTO asset_ids
  FROM unnest(asset_ids) AS asset_values(value);
  FOREACH asset_id IN ARRAY COALESCE(asset_ids, ARRAY[]::TEXT[]) LOOP
    PERFORM pg_advisory_xact_lock(hashtext('media-asset:' || asset_id));
    IF EXISTS (
      SELECT 1 FROM "media_assets"
      WHERE id = asset_id AND retention_redacted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'MEDIA_ASSET_RETENTION_REDACTED';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_submissions_media_array_guard
BEFORE INSERT OR UPDATE ON "task_submissions"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_array_reference_write();
CREATE TRIGGER creative_generations_media_array_guard
BEFORE INSERT OR UPDATE ON "creative_generations"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_array_reference_write();
CREATE TRIGGER chat_turns_media_array_guard
BEFORE INSERT OR UPDATE ON "chat_turns"
FOR EACH ROW EXECUTE FUNCTION guard_media_asset_array_reference_write();
