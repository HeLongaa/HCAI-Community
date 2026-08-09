ALTER TABLE "creative_provider_operations" ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "creative_generation_mutations" ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "creative_provider_replay_ledger" ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "creative_output_ingestions" ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "creative_provider_retry_states" ADD COLUMN "retention_redacted_at" TIMESTAMP(3);
ALTER TABLE "creative_provider_operations" ALTER COLUMN "provider_job_id" DROP NOT NULL;

CREATE INDEX "creative_provider_operations_status_retention_redacted_at_updated_at_id_idx" ON "creative_provider_operations"("status", "retention_redacted_at", "updated_at", "id");
CREATE INDEX "creative_generation_mutations_status_retention_redacted_at_updated_at_id_idx" ON "creative_generation_mutations"("status", "retention_redacted_at", "updated_at", "id");
CREATE INDEX "creative_provider_replay_ledger_action_retention_redacted_at_updated_at_id_idx" ON "creative_provider_replay_ledger"("action", "retention_redacted_at", "updated_at", "id");
CREATE INDEX "creative_output_ingestions_status_retention_redacted_at_updated_at_id_idx" ON "creative_output_ingestions"("status", "retention_redacted_at", "updated_at", "id");
CREATE INDEX "creative_provider_retry_states_status_retention_redacted_at_updated_at_id_idx" ON "creative_provider_retry_states"("status", "retention_redacted_at", "updated_at", "id");

CREATE FUNCTION lock_provider_lifecycle_write() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('creative-generation:' || NEW.generation_id));
  IF TG_OP = 'UPDATE' AND OLD.retention_redacted_at IS NOT NULL
     AND current_setting('app.provider_lifecycle_retention_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PROVIDER_LIFECYCLE_RETENTION_REDACTED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER creative_provider_operations_retention_lock BEFORE INSERT OR UPDATE ON "creative_provider_operations" FOR EACH ROW EXECUTE FUNCTION lock_provider_lifecycle_write();
CREATE TRIGGER creative_generation_mutations_retention_lock BEFORE INSERT OR UPDATE ON "creative_generation_mutations" FOR EACH ROW EXECUTE FUNCTION lock_provider_lifecycle_write();
CREATE TRIGGER creative_provider_replay_ledger_retention_lock BEFORE INSERT OR UPDATE ON "creative_provider_replay_ledger" FOR EACH ROW EXECUTE FUNCTION lock_provider_lifecycle_write();
CREATE TRIGGER creative_output_ingestions_retention_lock BEFORE INSERT OR UPDATE ON "creative_output_ingestions" FOR EACH ROW EXECUTE FUNCTION lock_provider_lifecycle_write();
CREATE TRIGGER creative_provider_retry_states_retention_lock BEFORE INSERT OR UPDATE ON "creative_provider_retry_states" FOR EACH ROW EXECUTE FUNCTION lock_provider_lifecycle_write();
