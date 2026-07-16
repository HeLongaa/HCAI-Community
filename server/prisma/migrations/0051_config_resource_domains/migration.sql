CREATE TYPE "ConfigResourceKind" AS ENUM ('feature_flag', 'reference_data', 'announcement');

CREATE TABLE "config_resources" (
    "id" TEXT NOT NULL,
    "kind" "ConfigResourceKind" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "draft_value" JSONB NOT NULL,
    "draft_value_schema_version" INTEGER NOT NULL DEFAULT 1,
    "published_value" JSONB,
    "published_value_schema_version" INTEGER NOT NULL DEFAULT 1,
    "published_version" INTEGER NOT NULL DEFAULT 0,
    "current_revision_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_ref" TEXT NOT NULL,
    "updated_by_ref" TEXT NOT NULL,
    "deleted_by_ref" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "config_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "config_resource_revisions" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "value" JSONB NOT NULL,
    "value_schema_version" INTEGER NOT NULL DEFAULT 1,
    "previous_revision_id" TEXT,
    "event_type" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "actor_ref" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "config_resource_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feature_flags" (
    "resource_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_schema_version" INTEGER NOT NULL DEFAULT 1,
    "published_version" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("resource_id")
);

CREATE TABLE "reference_data_entries" (
    "resource_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "value_schema_version" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "published_version" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reference_data_entries_pkey" PRIMARY KEY ("resource_id")
);

CREATE TABLE "announcements" (
    "resource_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "published_version" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("resource_id")
);

CREATE UNIQUE INDEX "config_resources_kind_key_key" ON "config_resources"("kind", "key");
CREATE INDEX "config_resources_kind_deleted_at_updated_at_idx" ON "config_resources"("kind", "deleted_at", "updated_at");
CREATE INDEX "config_resources_current_revision_id_idx" ON "config_resources"("current_revision_id");
CREATE UNIQUE INDEX "config_resource_revisions_resource_id_resource_version_key" ON "config_resource_revisions"("resource_id", "resource_version");
CREATE INDEX "config_resource_revisions_resource_id_created_at_idx" ON "config_resource_revisions"("resource_id", "created_at");
CREATE INDEX "config_resource_revisions_previous_revision_id_idx" ON "config_resource_revisions"("previous_revision_id");
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");
CREATE UNIQUE INDEX "reference_data_entries_key_key" ON "reference_data_entries"("key");
CREATE INDEX "reference_data_entries_deleted_at_active_sort_order_idx" ON "reference_data_entries"("deleted_at", "active", "sort_order");
CREATE UNIQUE INDEX "announcements_key_key" ON "announcements"("key");
CREATE INDEX "announcements_deleted_at_active_starts_at_ends_at_idx" ON "announcements"("deleted_at", "active", "starts_at", "ends_at");

ALTER TABLE "config_resource_revisions" ADD CONSTRAINT "config_resource_revisions_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "config_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "config_resource_revisions" ADD CONSTRAINT "config_resource_revisions_previous_revision_id_fkey" FOREIGN KEY ("previous_revision_id") REFERENCES "config_resource_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "config_resources" ADD CONSTRAINT "config_resources_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "config_resource_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "config_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reference_data_entries" ADD CONSTRAINT "reference_data_entries_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "config_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "config_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_config_resource_revision_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.config_resource_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'immutable config resource revision cannot be %', lower(TG_OP);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER config_resource_revisions_reject_update
  BEFORE UPDATE ON "config_resource_revisions"
  FOR EACH ROW EXECUTE FUNCTION reject_config_resource_revision_mutation();

CREATE TRIGGER config_resource_revisions_reject_delete
  BEFORE DELETE ON "config_resource_revisions"
  FOR EACH ROW EXECUTE FUNCTION reject_config_resource_revision_mutation();

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:feature-flags:read', 'config-feature-flags', 'feature_flag', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:feature-flags:manage', 'config-feature-flags', 'feature_flag', 'manage', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:feature-flags:publish', 'config-feature-flags', 'feature_flag', 'publish', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:reference-data:read', 'config-feature-flags', 'reference_data', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:reference-data:manage', 'config-feature-flags', 'reference_data', 'manage', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:reference-data:publish', 'config-feature-flags', 'reference_data', 'publish', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:announcements:read', 'config-feature-flags', 'announcement', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:announcements:manage', 'config-feature-flags', 'announcement', 'manage', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:announcements:publish', 'config-feature-flags', 'announcement', 'publish', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator'::"UserRole", 'admin:feature-flags:read'),
  ('moderator'::"UserRole", 'admin:reference-data:read'),
  ('moderator'::"UserRole", 'admin:announcements:read'),
  ('admin'::"UserRole", 'admin:feature-flags:read'),
  ('admin'::"UserRole", 'admin:feature-flags:manage'),
  ('admin'::"UserRole", 'admin:feature-flags:publish'),
  ('admin'::"UserRole", 'admin:reference-data:read'),
  ('admin'::"UserRole", 'admin:reference-data:manage'),
  ('admin'::"UserRole", 'admin:reference-data:publish'),
  ('admin'::"UserRole", 'admin:announcements:read'),
  ('admin'::"UserRole", 'admin:announcements:manage'),
  ('admin'::"UserRole", 'admin:announcements:publish')
ON CONFLICT DO NOTHING;
