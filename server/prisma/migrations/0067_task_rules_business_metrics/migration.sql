ALTER TYPE "ConfigResourceKind" ADD VALUE IF NOT EXISTS 'task_rule';

CREATE TABLE "task_rules" (
  "resource_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "acceptance_templates" JSONB NOT NULL,
  "acceptance_templates_schema_version" INTEGER NOT NULL DEFAULT 1,
  "default_deadline_hours" INTEGER NOT NULL,
  "minimum_deadline_hours" INTEGER NOT NULL,
  "maximum_deadline_hours" INTEGER NOT NULL,
  "deadline_required" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "published_version" INTEGER NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_rules_pkey" PRIMARY KEY ("resource_id"),
  CONSTRAINT "task_rules_deadline_range_check" CHECK (
    "minimum_deadline_hours" >= 1
    AND "default_deadline_hours" >= "minimum_deadline_hours"
    AND "maximum_deadline_hours" >= "default_deadline_hours"
    AND "maximum_deadline_hours" <= 8760
  )
);

CREATE UNIQUE INDEX "task_rules_key_key" ON "task_rules"("key");
CREATE UNIQUE INDEX "task_rules_category_key" ON "task_rules"("category");
CREATE INDEX "task_rules_deleted_at_active_category_idx" ON "task_rules"("deleted_at", "active", "category");

ALTER TABLE "task_rules"
  ADD CONSTRAINT "task_rules_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "config_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:task-rules:read', 'task-marketplace', 'task_rule', 'read', 'high', false, false, 'Read versioned task rule drafts and published projections', CURRENT_TIMESTAMP),
  ('admin:task-rules:manage', 'task-marketplace', 'task_rule', 'manage', 'critical', true, true, 'Create, edit, soft-delete, and restore task rule drafts', CURRENT_TIMESTAMP),
  ('admin:task-rules:publish', 'task-marketplace', 'task_rule', 'publish', 'critical', true, true, 'Publish and roll back task rules used by task creation', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:task-rules:read'),
  ('admin', 'admin:task-rules:read'),
  ('admin', 'admin:task-rules:manage'),
  ('admin', 'admin:task-rules:publish')
ON CONFLICT ("role", "permission_id") DO NOTHING;
