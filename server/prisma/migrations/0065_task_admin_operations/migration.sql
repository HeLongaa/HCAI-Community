ALTER TABLE "tasks"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" TEXT,
  ADD COLUMN "archive_reason_code" TEXT,
  ADD COLUMN "archive_note" TEXT;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_archived_by_id_fkey"
  FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_status_updated_at_id_idx" ON "tasks"("status", "updated_at", "id");
CREATE INDEX "tasks_category_updated_at_id_idx" ON "tasks"("category", "updated_at", "id");
CREATE INDEX "tasks_archived_at_status_updated_at_idx" ON "tasks"("archived_at", "status", "updated_at");

CREATE TABLE "task_admin_bulk_actions" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_hash" TEXT NOT NULL,
  "target_count" INTEGER NOT NULL,
  "eligible_count" INTEGER NOT NULL,
  "skipped_count" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "note" TEXT,
  "requested_by_id" TEXT,
  "result" JSONB NOT NULL,
  "result_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "task_admin_bulk_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_admin_bulk_actions_idempotency_key_key" ON "task_admin_bulk_actions"("idempotency_key");
CREATE INDEX "task_admin_bulk_actions_created_at_id_idx" ON "task_admin_bulk_actions"("created_at", "id");
CREATE INDEX "task_admin_bulk_actions_requested_by_id_created_at_idx" ON "task_admin_bulk_actions"("requested_by_id", "created_at");

ALTER TABLE "task_admin_bulk_actions"
  ADD CONSTRAINT "task_admin_bulk_actions_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:tasks:read', 'task-marketplace', 'task', 'read', 'high', false, false, 'Read task operations projections and lifecycle evidence', CURRENT_TIMESTAMP),
  ('admin:tasks:manage', 'task-marketplace', 'task', 'manage', 'critical', false, true, 'Edit eligible tasks and apply audited archive or status operations', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:tasks:read'),
  ('admin', 'admin:tasks:read'),
  ('admin', 'admin:tasks:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
