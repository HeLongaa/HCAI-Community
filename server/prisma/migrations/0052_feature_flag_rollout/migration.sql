ALTER TABLE "feature_flags"
  ADD COLUMN "rules" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "rules_schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rollout_percentage" INTEGER,
  ADD COLUMN "rollout_seed" TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN "emergency_off" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergency_off_by_ref" TEXT,
  ADD COLUMN "emergency_off_reason_code" TEXT,
  ADD COLUMN "emergency_off_at" TIMESTAMP(3);

ALTER TABLE "feature_flags"
  ADD CONSTRAINT "feature_flags_rollout_percentage_check"
  CHECK ("rollout_percentage" IS NULL OR ("rollout_percentage" >= 0 AND "rollout_percentage" <= 100));

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:feature-flags:emergency', 'config-feature-flags', 'feature_flag', 'emergency', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('admin'::"UserRole", 'admin:feature-flags:emergency')
ON CONFLICT ("role", "permission_id") DO NOTHING;
