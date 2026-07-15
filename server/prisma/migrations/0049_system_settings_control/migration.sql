CREATE TYPE "SystemSettingChangeKind" AS ENUM ('update', 'rollback');
CREATE TYPE "SystemSettingChangeStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'published');

ALTER TABLE "system_settings"
  ADD COLUMN "published_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "current_revision_id" TEXT;

CREATE TABLE "system_setting_changes" (
  "id" TEXT NOT NULL,
  "setting_key" TEXT NOT NULL,
  "kind" "SystemSettingChangeKind" NOT NULL,
  "status" "SystemSettingChangeStatus" NOT NULL DEFAULT 'pending_approval',
  "base_version" INTEGER NOT NULL,
  "candidate_value" JSONB NOT NULL,
  "candidate_value_schema_version" INTEGER NOT NULL DEFAULT 1,
  "diff" JSONB NOT NULL,
  "diff_schema_version" INTEGER NOT NULL DEFAULT 1,
  "target_revision_id" TEXT,
  "requested_by_ref" TEXT NOT NULL,
  "approved_by_ref" TEXT,
  "rejected_by_ref" TEXT,
  "published_by_ref" TEXT,
  "reason_code" TEXT NOT NULL,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_setting_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_setting_revisions" (
  "id" TEXT NOT NULL,
  "setting_key" TEXT NOT NULL,
  "setting_version" INTEGER NOT NULL,
  "value" JSONB NOT NULL,
  "value_schema_version" INTEGER NOT NULL DEFAULT 1,
  "previous_revision_id" TEXT,
  "source_change_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_setting_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_setting_changes_setting_key_created_at_idx" ON "system_setting_changes"("setting_key", "created_at");
CREATE INDEX "system_setting_changes_status_created_at_idx" ON "system_setting_changes"("status", "created_at");
CREATE INDEX "system_setting_changes_requested_by_ref_created_at_idx" ON "system_setting_changes"("requested_by_ref", "created_at");
CREATE INDEX "system_setting_changes_target_revision_id_idx" ON "system_setting_changes"("target_revision_id");
CREATE UNIQUE INDEX "system_setting_revisions_setting_key_setting_version_key" ON "system_setting_revisions"("setting_key", "setting_version");
CREATE INDEX "system_setting_revisions_setting_key_created_at_idx" ON "system_setting_revisions"("setting_key", "created_at");
CREATE INDEX "system_setting_revisions_source_change_id_idx" ON "system_setting_revisions"("source_change_id");
CREATE INDEX "system_setting_revisions_previous_revision_id_idx" ON "system_setting_revisions"("previous_revision_id");

ALTER TABLE "system_setting_revisions" ADD CONSTRAINT "system_setting_revisions_source_change_id_fkey"
  FOREIGN KEY ("source_change_id") REFERENCES "system_setting_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "system_setting_revisions" ADD CONSTRAINT "system_setting_revisions_previous_revision_id_fkey"
  FOREIGN KEY ("previous_revision_id") REFERENCES "system_setting_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "system_setting_changes" ADD CONSTRAINT "system_setting_changes_target_revision_id_fkey"
  FOREIGN KEY ("target_revision_id") REFERENCES "system_setting_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_current_revision_id_fkey"
  FOREIGN KEY ("current_revision_id") REFERENCES "system_setting_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_system_setting_revision_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.system_setting_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'immutable system setting revision cannot be %', lower(TG_OP);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_setting_revisions_reject_update
  BEFORE UPDATE ON "system_setting_revisions"
  FOR EACH ROW EXECUTE FUNCTION reject_system_setting_revision_mutation();

CREATE TRIGGER system_setting_revisions_reject_delete
  BEFORE DELETE ON "system_setting_revisions"
  FOR EACH ROW EXECUTE FUNCTION reject_system_setting_revision_mutation();

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:settings:read', 'config-feature-flags', 'system_setting', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:settings:manage', 'config-feature-flags', 'system_setting_change', 'manage', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:settings:approve', 'config-feature-flags', 'system_setting_change', 'approve', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:settings:publish', 'config-feature-flags', 'system_setting', 'publish', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator'::"UserRole", 'admin:settings:read'),
  ('admin'::"UserRole", 'admin:settings:read'),
  ('admin'::"UserRole", 'admin:settings:manage'),
  ('admin'::"UserRole", 'admin:settings:approve'),
  ('admin'::"UserRole", 'admin:settings:publish')
ON CONFLICT DO NOTHING;
