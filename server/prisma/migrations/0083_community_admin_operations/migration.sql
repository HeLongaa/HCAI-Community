ALTER TABLE "comments"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deletion_reason_code" TEXT;

CREATE INDEX "comments_post_id_deleted_at_moderation_state_created_at_id_idx" ON "comments"("post_id", "deleted_at", "moderation_state", "created_at", "id");
CREATE INDEX "comments_author_id_deleted_at_updated_at_id_idx" ON "comments"("author_id", "deleted_at", "updated_at", "id");

CREATE TABLE "community_admin_bulk_operations" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
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
  CONSTRAINT "community_admin_bulk_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "community_admin_bulk_operations_target_type_check" CHECK ("target_type" IN ('post', 'comment')),
  CONSTRAINT "community_admin_bulk_operations_action_check" CHECK ("action" IN ('delete', 'restore')),
  CONSTRAINT "community_admin_bulk_operations_status_check" CHECK ("status" IN ('completed')),
  CONSTRAINT "community_admin_bulk_operations_counts_check" CHECK ("target_count" >= 1 AND "eligible_count" >= 0 AND "skipped_count" >= 0),
  CONSTRAINT "community_admin_bulk_operations_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT "community_admin_bulk_operations_result_schema_check" CHECK ("result_schema_version" = 1)
);

CREATE UNIQUE INDEX "community_admin_bulk_operations_idempotency_key_key" ON "community_admin_bulk_operations"("idempotency_key");
CREATE INDEX "community_admin_bulk_operations_target_type_created_at_id_idx" ON "community_admin_bulk_operations"("target_type", "created_at", "id");
CREATE INDEX "community_admin_bulk_operations_requested_by_id_created_at_id_idx" ON "community_admin_bulk_operations"("requested_by_id", "created_at", "id");
ALTER TABLE "community_admin_bulk_operations" ADD CONSTRAINT "community_admin_bulk_operations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at") VALUES
  ('admin:community:read', 'community', 'community_content', 'read', 'high', false, false, 'Read bounded community content administration projections and metrics', CURRENT_TIMESTAMP),
  ('admin:community:manage', 'community', 'community_content', 'manage', 'critical', false, true, 'Edit and soft-delete or restore community posts and comments', CURRENT_TIMESTAMP),
  ('admin:community:export', 'community', 'community_metrics', 'export', 'critical', false, false, 'Export aggregate community health metrics without raw content', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action", "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected", "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:community:read'), ('admin', 'admin:community:read'),
  ('admin', 'admin:community:manage'), ('admin', 'admin:community:export')
ON CONFLICT ("role", "permission_id") DO NOTHING;
