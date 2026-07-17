ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE "tasks"
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "expired_at" TIMESTAMP(3),
  ADD COLUMN "terminal_reason_code" TEXT;

CREATE INDEX "tasks_status_deadline_at_archived_at_idx"
  ON "tasks"("status", "deadline_at", "archived_at");

CREATE TABLE "task_lifecycle_mutations" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "previous_status" TEXT NOT NULL,
  "next_status" TEXT,
  "expected_version" INTEGER,
  "reason_code" TEXT NOT NULL,
  "note" TEXT,
  "requested_by_id" TEXT,
  "result" JSONB NOT NULL,
  "result_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "task_lifecycle_mutations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_lifecycle_mutations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_lifecycle_mutations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "task_lifecycle_mutations_idempotency_key_key"
  ON "task_lifecycle_mutations"("idempotency_key");
CREATE INDEX "task_lifecycle_mutations_task_id_created_at_id_idx"
  ON "task_lifecycle_mutations"("task_id", "created_at", "id");
CREATE INDEX "task_lifecycle_mutations_action_created_at_idx"
  ON "task_lifecycle_mutations"("action", "created_at");

CREATE OR REPLACE FUNCTION preserve_task_lifecycle_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'task lifecycle mutation evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_lifecycle_mutations_immutable_guard
  BEFORE UPDATE OR DELETE ON "task_lifecycle_mutations"
  FOR EACH ROW EXECUTE FUNCTION preserve_task_lifecycle_mutation();

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('task:cancel', 'task-marketplace', 'task', 'cancel', 'high', false, true, 'Cancel an owned task before fulfillment starts', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('member', 'task:cancel'),
  ('publisher', 'task:cancel'),
  ('admin', 'task:cancel')
ON CONFLICT ("role", "permission_id") DO NOTHING;
