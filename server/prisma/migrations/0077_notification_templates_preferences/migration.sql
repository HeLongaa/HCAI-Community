ALTER TABLE "notifications"
  ADD COLUMN "template_key" TEXT,
  ADD COLUMN "template_version" INTEGER;

CREATE TABLE "notification_templates" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "active_version_number" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_template_versions" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "title_template" TEXT NOT NULL,
  "body_template" TEXT NOT NULL,
  "variable_schema" JSONB NOT NULL,
  "variable_schema_schema_version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by_id" TEXT,
  "reason_code" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "notification_type" TEXT NOT NULL,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_templates_key_key" ON "notification_templates"("key");
CREATE INDEX "notification_templates_status_updated_at_idx" ON "notification_templates"("status", "updated_at");
CREATE INDEX "notification_templates_category_updated_at_idx" ON "notification_templates"("category", "updated_at");
CREATE UNIQUE INDEX "notification_template_versions_template_id_version_number_key" ON "notification_template_versions"("template_id", "version_number");
CREATE INDEX "notification_template_versions_template_id_status_created_at_idx" ON "notification_template_versions"("template_id", "status", "created_at");
CREATE UNIQUE INDEX "notification_preferences_user_id_notification_type_key" ON "notification_preferences"("user_id", "notification_type");
CREATE INDEX "notification_preferences_user_id_updated_at_idx" ON "notification_preferences"("user_id", "updated_at");

ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_status_check"
  CHECK ("status" IN ('draft', 'published', 'archived'));
ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_status_check"
  CHECK ("status" IN ('draft', 'published', 'superseded'));
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_version_check" CHECK ("version" > 0);
ALTER TABLE "notification_template_versions" ADD CONSTRAINT "notification_template_versions_version_number_check" CHECK ("version_number" > 0);
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_version_check" CHECK ("version" > 0);

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:notifications:read', 'notifications-webhooks', 'notification_template', 'read', 'high', false, false, 'Read notification templates, versions, metrics, and exports', CURRENT_TIMESTAMP),
  ('admin:notifications:manage', 'notifications-webhooks', 'notification_template', 'manage', 'critical', true, true, 'Create, edit, archive, and restore notification template drafts', CURRENT_TIMESTAMP),
  ('admin:notifications:publish', 'notifications-webhooks', 'notification_template', 'publish', 'critical', true, true, 'Publish, roll back, and test notification template versions', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:notifications:read'),
  ('admin', 'admin:notifications:read'),
  ('admin', 'admin:notifications:manage'),
  ('admin', 'admin:notifications:publish')
ON CONFLICT ("role", "permission_id") DO NOTHING;
