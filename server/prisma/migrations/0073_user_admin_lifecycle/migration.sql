ALTER TABLE "users"
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspension_reason_code" TEXT;

UPDATE "users"
SET
  "suspended_at" = COALESCE("updated_at", CURRENT_TIMESTAMP),
  "suspension_reason_code" = 'legacy_suspension'
WHERE "status" = 'suspended';

ALTER TABLE "users"
  ADD CONSTRAINT "users_suspension_consistency_check"
  CHECK (
    ("status" = 'suspended' AND "suspended_at" IS NOT NULL AND "suspension_reason_code" IS NOT NULL)
    OR
    ("status" <> 'suspended' AND "suspended_at" IS NULL AND "suspension_reason_code" IS NULL)
  );

CREATE INDEX "users_status_role_updated_at_id_idx"
  ON "users"("status", "role", "updated_at", "id");

INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:users:read', 'user-profile', 'user', 'read', 'high', false, false, 'Read bounded personal user lifecycle projections', CURRENT_TIMESTAMP),
  ('admin:users:manage', 'user-profile', 'user', 'manage', 'critical', true, true, 'Suspend and restore personal users with lifecycle safeguards', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:users:read'),
  ('admin', 'admin:users:read'),
  ('admin', 'admin:users:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
