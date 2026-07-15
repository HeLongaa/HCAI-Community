CREATE TYPE "ReleaseChangeType" AS ENUM ('promotion', 'secret_rotation', 'configuration');
CREATE TYPE "ReleaseChangeStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'deployed', 'failed', 'rolled_back');

CREATE TABLE "release_changes" (
  "id" TEXT NOT NULL,
  "change_type" "ReleaseChangeType" NOT NULL,
  "status" "ReleaseChangeStatus" NOT NULL DEFAULT 'pending_approval',
  "source_environment" TEXT,
  "target_environment" TEXT NOT NULL,
  "artifact_version" TEXT NOT NULL,
  "rollback_version" TEXT NOT NULL,
  "secret_ref" TEXT,
  "secret_version" TEXT,
  "summary" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "requested_by_ref" TEXT NOT NULL,
  "approved_by_ref" TEXT,
  "applied_by_ref" TEXT,
  "rolled_back_by_ref" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "applied_at" TIMESTAMP(3),
  "rolled_back_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "release_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "release_evidence" (
  "id" TEXT NOT NULL,
  "release_change_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "evidence_schema_version" INTEGER NOT NULL DEFAULT 1,
  "evidence_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "release_changes_status_created_at_idx" ON "release_changes"("status", "created_at");
CREATE INDEX "release_changes_target_environment_created_at_idx" ON "release_changes"("target_environment", "created_at");
CREATE INDEX "release_changes_change_type_created_at_idx" ON "release_changes"("change_type", "created_at");
CREATE INDEX "release_evidence_release_change_id_created_at_idx" ON "release_evidence"("release_change_id", "created_at");
CREATE INDEX "release_evidence_event_type_created_at_idx" ON "release_evidence"("event_type", "created_at");

ALTER TABLE "release_evidence" ADD CONSTRAINT "release_evidence_release_change_id_fkey"
  FOREIGN KEY ("release_change_id") REFERENCES "release_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:releases:read', 'platform-release', 'release_change', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:releases:manage', 'platform-release', 'release_change', 'manage', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:releases:approve', 'platform-release', 'release_change', 'approve', 'critical', true, true, CURRENT_TIMESTAMP),
  ('admin:releases:deploy', 'platform-release', 'release_change', 'deploy', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('admin'::"UserRole", 'admin:releases:read'),
  ('admin'::"UserRole", 'admin:releases:manage'),
  ('admin'::"UserRole", 'admin:releases:approve'),
  ('admin'::"UserRole", 'admin:releases:deploy')
ON CONFLICT DO NOTHING;
