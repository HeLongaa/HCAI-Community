CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "audit_events"
  ADD COLUMN "sequence" BIGINT,
  ADD COLUMN "previous_hash" TEXT,
  ADD COLUMN "content_hash" TEXT,
  ADD COLUMN "chain_version" INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION audit_event_canonical_payload(event_row "audit_events") RETURNS TEXT AS $$
  SELECT jsonb_build_object(
    'chainVersion', event_row.chain_version,
    'sequence', event_row.sequence,
    'previousHash', event_row.previous_hash,
    'event', jsonb_build_object(
      'id', event_row.id,
      'actorType', event_row.actor_type,
      'actorId', event_row.actor_id,
      'action', event_row.action,
      'resourceType', event_row.resource_type,
      'resourceId', event_row.resource_id,
      'metadata', event_row.metadata,
      'metadataSchemaVersion', event_row.metadata_schema_version,
      'createdAt', to_char(event_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  )::TEXT
$$ LANGUAGE SQL IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION audit_event_content_hash(event_row "audit_events") RETURNS TEXT AS $$
  SELECT encode(digest(audit_event_canonical_payload(event_row), 'sha256'), 'hex')
$$ LANGUAGE SQL IMMUTABLE STRICT;

DO $$
DECLARE
  current_row "audit_events"%ROWTYPE;
  current_sequence BIGINT := 0;
  current_previous_hash TEXT := NULL;
  current_hash TEXT;
BEGIN
  FOR current_row IN SELECT * FROM "audit_events" ORDER BY "created_at", "id" LOOP
    current_sequence := current_sequence + 1;
    current_row.sequence := current_sequence;
    current_row.previous_hash := current_previous_hash;
    current_hash := audit_event_content_hash(current_row);
    UPDATE "audit_events" SET
      "sequence" = current_sequence,
      "previous_hash" = current_previous_hash,
      "content_hash" = current_hash
    WHERE "id" = current_row.id;
    current_previous_hash := current_hash;
  END LOOP;
END $$;

ALTER TABLE "audit_events"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "content_hash" SET NOT NULL;

CREATE UNIQUE INDEX "audit_events_sequence_key" ON "audit_events"("sequence");
CREATE UNIQUE INDEX "audit_events_content_hash_key" ON "audit_events"("content_hash");

CREATE OR REPLACE FUNCTION append_audit_event_chain() RETURNS TRIGGER AS $$
DECLARE
  previous_event "audit_events"%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_event_chain_v1'));
  SELECT * INTO previous_event FROM "audit_events" ORDER BY "sequence" DESC LIMIT 1;
  NEW.sequence := COALESCE(previous_event.sequence, 0) + 1;
  NEW.previous_hash := previous_event.content_hash;
  NEW.chain_version := 1;
  NEW.content_hash := audit_event_content_hash(NEW);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_chain
  BEFORE INSERT ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION append_audit_event_chain();

CREATE OR REPLACE FUNCTION reject_immutable_evidence_change() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'immutable audit evidence cannot be %', lower(TG_OP)
    USING ERRCODE = '55000';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_evidence_change();

CREATE TABLE "audit_archive_manifests" (
  "id" TEXT NOT NULL,
  "from_sequence" BIGINT NOT NULL,
  "to_sequence" BIGINT NOT NULL,
  "event_count" INTEGER NOT NULL,
  "root_hash" TEXT NOT NULL,
  "object_ref" TEXT NOT NULL,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_archive_manifests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_archive_manifests_range_check" CHECK ("from_sequence" > 0 AND "to_sequence" >= "from_sequence"),
  CONSTRAINT "audit_archive_manifests_count_check" CHECK ("event_count" = "to_sequence" - "from_sequence" + 1)
);

CREATE INDEX "audit_archive_manifests_created_at_idx" ON "audit_archive_manifests"("created_at");
CREATE TRIGGER audit_archive_manifests_immutable
  BEFORE UPDATE OR DELETE ON "audit_archive_manifests"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_evidence_change();

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:audit:export', 'audit-evidence', 'audit_event', 'export', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:audit:verify', 'audit-evidence', 'audit_event', 'verify', 'critical', false, false, CURRENT_TIMESTAMP),
  ('admin:audit:archive', 'audit-evidence', 'audit_archive_manifest', 'create', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('admin'::"UserRole", 'admin:audit:export'),
  ('admin'::"UserRole", 'admin:audit:verify'),
  ('admin'::"UserRole", 'admin:audit:archive')
ON CONFLICT DO NOTHING;
