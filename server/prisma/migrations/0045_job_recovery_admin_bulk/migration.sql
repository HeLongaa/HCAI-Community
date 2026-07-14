ALTER TYPE "JobRunStatus" ADD VALUE IF NOT EXISTS 'retry_scheduled';
ALTER TYPE "JobRunStatus" ADD VALUE IF NOT EXISTS 'dead_lettered';

ALTER TABLE "job_definitions"
  ADD COLUMN IF NOT EXISTS "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "retry_backoff_seconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "cron_schedule" TEXT,
  ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMP(3);

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description")
VALUES
  ('admin:jobs:recover', 'jobs-automation', 'job_run', 'recover', 'critical', false, true, 'Retry dead-lettered job runs and request safe manual reruns'),
  ('admin:jobs:schedule', 'jobs-automation', 'job_definition', 'schedule', 'critical', false, true, 'Pause and resume registered scheduled job definitions'),
  ('admin:bulk-actions:manage', 'admin-console', 'admin_bulk_action', 'manage', 'critical', false, true, 'Preview and confirm registered JobRun-backed admin bulk actions')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id")
VALUES
  ('admin', 'admin:jobs:recover'),
  ('admin', 'admin:jobs:schedule'),
  ('admin', 'admin:bulk-actions:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
