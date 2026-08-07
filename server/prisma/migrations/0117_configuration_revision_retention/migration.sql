ALTER TABLE "system_setting_changes"
  ALTER COLUMN "candidate_value" DROP NOT NULL,
  ALTER COLUMN "diff" DROP NOT NULL,
  ALTER COLUMN "requested_by_ref" DROP NOT NULL,
  ADD COLUMN "retention_summary" JSONB,
  ADD COLUMN "retention_summary_schema_version" INTEGER,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

ALTER TABLE "system_setting_revisions"
  ALTER COLUMN "value" DROP NOT NULL,
  ALTER COLUMN "actor_ref" DROP NOT NULL,
  ADD COLUMN "retention_summary" JSONB,
  ADD COLUMN "retention_summary_schema_version" INTEGER,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

ALTER TABLE "config_resource_revisions"
  ALTER COLUMN "title" DROP NOT NULL,
  ALTER COLUMN "value" DROP NOT NULL,
  ALTER COLUMN "actor_ref" DROP NOT NULL,
  ADD COLUMN "retention_summary" JSONB,
  ADD COLUMN "retention_summary_schema_version" INTEGER,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

CREATE INDEX "system_setting_changes_retention_redacted_at_published_at_rejected_at_idx"
  ON "system_setting_changes"("retention_redacted_at", "published_at", "rejected_at");
CREATE INDEX "system_setting_revisions_retention_redacted_at_created_at_idx"
  ON "system_setting_revisions"("retention_redacted_at", "created_at");
CREATE INDEX "config_resource_revisions_retention_redacted_at_created_at_idx"
  ON "config_resource_revisions"("retention_redacted_at", "created_at");

CREATE OR REPLACE FUNCTION configuration_retention_summary_valid(summary JSONB)
RETURNS boolean AS $$
  SELECT COALESCE(jsonb_typeof(summary) = 'object'
    AND (summary - ARRAY['schemaVersion', 'valueDigest', 'previousValueDigest', 'pathHashes', 'typeCounts', 'operations', 'truncated']) = '{}'::jsonb
    AND summary->>'schemaVersion' = '1'
    AND summary->>'valueDigest' ~ '^[a-f0-9]{64}$'
    AND (summary->'previousValueDigest' = 'null'::jsonb OR summary->>'previousValueDigest' ~ '^[a-f0-9]{64}$')
    AND jsonb_typeof(summary->'pathHashes') = 'array'
    AND jsonb_array_length(summary->'pathHashes') <= 128
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(summary->'pathHashes') item
      WHERE jsonb_typeof(item) <> 'object'
        OR (item - ARRAY['pathHash', 'type']) <> '{}'::jsonb
        OR NOT (item ?& ARRAY['pathHash', 'type'])
        OR item->>'pathHash' !~ '^[a-f0-9]{64}$'
        OR item->>'type' NOT IN ('null', 'array', 'object', 'string', 'number', 'boolean', 'undefined', 'bigint')
    )
    AND jsonb_typeof(summary->'typeCounts') = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(summary->'typeCounts') item
      WHERE item.key NOT IN ('null', 'array', 'object', 'string', 'number', 'boolean', 'undefined', 'bigint')
        OR jsonb_typeof(item.value) <> 'number'
        OR item.value::text !~ '^[0-9]+$'
    )
    AND jsonb_typeof(summary->'operations') = 'object'
    AND ((summary->'operations') - ARRAY['added', 'removed', 'changed', 'unchanged']) = '{}'::jsonb
    AND (summary->'operations') ?& ARRAY['added', 'removed', 'changed', 'unchanged']
    AND jsonb_typeof(summary->'operations'->'added') = 'number'
    AND jsonb_typeof(summary->'operations'->'removed') = 'number'
    AND jsonb_typeof(summary->'operations'->'changed') = 'number'
    AND jsonb_typeof(summary->'operations'->'unchanged') = 'number'
    AND (summary->'operations'->>'added') ~ '^\d+$'
    AND (summary->'operations'->>'removed') ~ '^\d+$'
    AND (summary->'operations'->>'changed') ~ '^\d+$'
    AND (summary->'operations'->>'unchanged') ~ '^\d+$'
    AND jsonb_typeof(summary->'truncated') = 'boolean', false);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION reject_system_setting_change_retention_restore()
RETURNS trigger AS $$
BEGIN
  IF OLD."retention_redacted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'retention-minimized system setting change is immutable';
  END IF;
  IF NEW."retention_redacted_at" IS NOT NULL THEN
    IF current_setting('app.configuration_retention_maintenance', true) IS DISTINCT FROM 'on'
      OR OLD."status" NOT IN ('published', 'rejected')
      OR NEW."candidate_value" IS NOT NULL OR NEW."diff" IS NOT NULL
      OR NEW."requested_by_ref" IS NOT NULL OR NEW."approved_by_ref" IS NOT NULL
      OR NEW."rejected_by_ref" IS NOT NULL OR NEW."published_by_ref" IS NOT NULL
      OR NEW."note" IS NOT NULL OR NOT configuration_retention_summary_valid(NEW."retention_summary")
      OR NEW."retention_summary_schema_version" IS DISTINCT FROM 1
      OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."setting_key" IS DISTINCT FROM OLD."setting_key"
      OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."base_version" IS DISTINCT FROM OLD."base_version"
      OR NEW."candidate_value_schema_version" IS DISTINCT FROM OLD."candidate_value_schema_version"
      OR NEW."diff_schema_version" IS DISTINCT FROM OLD."diff_schema_version"
      OR NEW."target_revision_id" IS DISTINCT FROM OLD."target_revision_id"
      OR NEW."reason_code" IS DISTINCT FROM OLD."reason_code"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
      OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
      OR NEW."rejected_at" IS DISTINCT FROM OLD."rejected_at"
      OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'invalid system setting change retention minimization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_setting_changes_retention_guard
  BEFORE UPDATE ON "system_setting_changes"
  FOR EACH ROW EXECUTE FUNCTION reject_system_setting_change_retention_restore();

CREATE OR REPLACE FUNCTION reject_system_setting_revision_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.system_setting_maintenance', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'immutable system setting revision cannot be delete';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."retention_redacted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'retention-minimized system setting revision is immutable';
  END IF;
  IF current_setting('app.configuration_retention_maintenance', true) IS DISTINCT FROM 'on'
    OR NEW."retention_redacted_at" IS NULL OR NEW."value" IS NOT NULL OR NEW."actor_ref" IS NOT NULL
    OR NOT configuration_retention_summary_valid(NEW."retention_summary") OR NEW."retention_summary_schema_version" IS DISTINCT FROM 1
    OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."setting_key" IS DISTINCT FROM OLD."setting_key"
    OR NEW."setting_version" IS DISTINCT FROM OLD."setting_version"
    OR NEW."value_schema_version" IS DISTINCT FROM OLD."value_schema_version"
    OR NEW."previous_revision_id" IS DISTINCT FROM OLD."previous_revision_id"
    OR NEW."source_change_id" IS DISTINCT FROM OLD."source_change_id"
    OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'immutable system setting revision cannot be update';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_config_resource_revision_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.config_resource_maintenance', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'immutable config resource revision cannot be delete';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."retention_redacted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'retention-minimized config resource revision is immutable';
  END IF;
  IF current_setting('app.configuration_retention_maintenance', true) IS DISTINCT FROM 'on'
    OR NEW."retention_redacted_at" IS NULL OR NEW."title" IS NOT NULL OR NEW."description" IS NOT NULL
    OR NEW."value" IS NOT NULL OR NEW."actor_ref" IS NOT NULL
    OR NOT configuration_retention_summary_valid(NEW."retention_summary") OR NEW."retention_summary_schema_version" IS DISTINCT FROM 1
    OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
    OR NEW."resource_version" IS DISTINCT FROM OLD."resource_version"
    OR NEW."value_schema_version" IS DISTINCT FROM OLD."value_schema_version"
    OR NEW."previous_revision_id" IS DISTINCT FROM OLD."previous_revision_id"
    OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."reason_code" IS DISTINCT FROM OLD."reason_code"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'immutable config resource revision cannot be update';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
