ALTER TABLE "tasks"
  ADD COLUMN "publisher_subject_ref" TEXT,
  ADD COLUMN "assignee_subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "task_proposals"
  ADD COLUMN "proposer_subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "task_submissions"
  ADD COLUMN "submitter_subject_ref" TEXT,
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

UPDATE "tasks" SET
  "publisher_subject_ref" = CASE WHEN "publisher_id" IS NULL THEN NULL ELSE 'subject_' || substring(encode(digest('data-rights:' || "publisher_id", 'sha256'), 'hex') FROM 1 FOR 24) END,
  "assignee_subject_ref" = CASE WHEN "assignee_id" IS NULL THEN NULL ELSE 'subject_' || substring(encode(digest('data-rights:' || "assignee_id", 'sha256'), 'hex') FROM 1 FOR 24) END;
UPDATE "task_proposals" SET "proposer_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "proposer_id", 'sha256'), 'hex') FROM 1 FOR 24);
UPDATE "task_submissions" SET "submitter_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "submitter_id", 'sha256'), 'hex') FROM 1 FOR 24);

ALTER TABLE "tasks" DROP CONSTRAINT "tasks_publisher_id_fkey";
ALTER TABLE "tasks" ALTER COLUMN "publisher_id" DROP NOT NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_proposals" DROP CONSTRAINT "task_proposals_proposer_id_fkey";
ALTER TABLE "task_proposals" ALTER COLUMN "proposer_id" DROP NOT NULL;
ALTER TABLE "task_proposals" ADD CONSTRAINT "task_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_submissions" DROP CONSTRAINT "task_submissions_submitter_id_fkey";
ALTER TABLE "task_submissions" ALTER COLUMN "submitter_id" DROP NOT NULL;
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_publisher_subject_ref_retention_redacted_at_idx" ON "tasks"("publisher_subject_ref", "retention_redacted_at");
CREATE INDEX "tasks_assignee_subject_ref_retention_redacted_at_idx" ON "tasks"("assignee_subject_ref", "retention_redacted_at");
CREATE INDEX "task_proposals_proposer_subject_ref_retention_redacted_at_idx" ON "task_proposals"("proposer_subject_ref", "retention_redacted_at");
CREATE INDEX "task_submissions_submitter_subject_ref_retention_redacted_at_idx" ON "task_submissions"("submitter_subject_ref", "retention_redacted_at");

CREATE FUNCTION lock_marketplace_task_write() RETURNS trigger AS $$
DECLARE task_id_value TEXT;
DECLARE redacted_at_value TIMESTAMP(3);
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    task_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME IN ('task_proposals', 'task_submissions', 'task_lifecycle_mutations') THEN
    task_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.task_id ELSE NEW.task_id END;
  ELSIF TG_TABLE_NAME = 'task_submission_assets' THEN
    SELECT task_id INTO task_id_value FROM task_submissions WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  ELSIF TG_TABLE_NAME = 'admin_reviews' THEN
    task_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.metadata->>'taskId' ELSE NEW.metadata->>'taskId' END;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'tasks' THEN
      NEW.publisher_subject_ref := CASE WHEN NEW.publisher_id IS NULL THEN NULL ELSE 'subject_' || substring(encode(digest('data-rights:' || NEW.publisher_id, 'sha256'), 'hex') FROM 1 FOR 24) END;
      NEW.assignee_subject_ref := CASE WHEN NEW.assignee_id IS NULL THEN NULL ELSE 'subject_' || substring(encode(digest('data-rights:' || NEW.assignee_id, 'sha256'), 'hex') FROM 1 FOR 24) END;
    ELSIF TG_TABLE_NAME = 'task_proposals' THEN
      NEW.proposer_subject_ref := CASE WHEN NEW.proposer_id IS NULL THEN NULL ELSE 'subject_' || substring(encode(digest('data-rights:' || NEW.proposer_id, 'sha256'), 'hex') FROM 1 FOR 24) END;
    ELSIF TG_TABLE_NAME = 'task_submissions' THEN
      NEW.submitter_subject_ref := CASE WHEN NEW.submitter_id IS NULL THEN NULL ELSE 'subject_' || substring(encode(digest('data-rights:' || NEW.submitter_id, 'sha256'), 'hex') FROM 1 FOR 24) END;
    END IF;
  END IF;
  IF task_id_value IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('task:' || task_id_value));
  SELECT retention_redacted_at INTO redacted_at_value FROM tasks WHERE id = task_id_value;
  IF redacted_at_value IS NOT NULL AND current_setting('app.marketplace_retention_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'MARKETPLACE_RETENTION_REDACTED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_marketplace_write_lock BEFORE INSERT OR UPDATE OR DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION lock_marketplace_task_write();
CREATE TRIGGER task_proposals_marketplace_write_lock BEFORE INSERT OR UPDATE OR DELETE ON "task_proposals" FOR EACH ROW EXECUTE FUNCTION lock_marketplace_task_write();
CREATE TRIGGER task_submissions_marketplace_write_lock BEFORE INSERT OR UPDATE OR DELETE ON "task_submissions" FOR EACH ROW EXECUTE FUNCTION lock_marketplace_task_write();
CREATE TRIGGER task_submission_assets_marketplace_write_lock BEFORE INSERT OR UPDATE OR DELETE ON "task_submission_assets" FOR EACH ROW EXECUTE FUNCTION lock_marketplace_task_write();
CREATE TRIGGER task_lifecycle_mutations_marketplace_write_lock BEFORE INSERT OR UPDATE OR DELETE ON "task_lifecycle_mutations" FOR EACH ROW EXECUTE FUNCTION lock_marketplace_task_write();
CREATE TRIGGER admin_reviews_marketplace_write_lock BEFORE INSERT OR UPDATE OR DELETE ON "admin_reviews" FOR EACH ROW EXECUTE FUNCTION lock_marketplace_task_write();
