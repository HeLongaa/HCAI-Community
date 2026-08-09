ALTER TABLE "creative_generations"
  ADD COLUMN "subject_ref" TEXT,
  ADD COLUMN "retention_preview_redacted_at" TIMESTAMP(3),
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

UPDATE "creative_generations"
SET "subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "actor_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "actor_id" IS NOT NULL;

CREATE INDEX "creative_generations_subject_ref_retention_redacted_at_idx"
  ON "creative_generations"("subject_ref", "retention_redacted_at");
CREATE INDEX "creative_generations_status_retention_preview_redacted_at_retention_redacted_at_idx"
  ON "creative_generations"("status", "retention_preview_redacted_at", "retention_redacted_at");

CREATE FUNCTION lock_creative_generation_write() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('creative-generation:' || NEW.id));
  IF TG_OP = 'UPDATE' AND OLD.retention_redacted_at IS NOT NULL AND current_setting('app.generation_retention_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'GENERATION_RETENTION_REDACTED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER creative_generations_write_lock
BEFORE INSERT OR UPDATE ON "creative_generations"
FOR EACH ROW EXECUTE FUNCTION lock_creative_generation_write();
