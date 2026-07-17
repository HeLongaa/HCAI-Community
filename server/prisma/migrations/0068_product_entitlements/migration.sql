CREATE TYPE "EntitlementPlanStatus" AS ENUM ('draft', 'active', 'retired');
CREATE TYPE "PersonalEntitlementGrantStatus" AS ENUM ('scheduled', 'active', 'revoked', 'expired');

CREATE TABLE "entitlement_plans" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "EntitlementPlanStatus" NOT NULL DEFAULT 'draft',
  "active_version_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_ref" TEXT NOT NULL,
  "updated_by_ref" TEXT NOT NULL,
  "activated_at" TIMESTAMP(3),
  "retired_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entitlement_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entitlement_plans_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "entitlement_plan_versions" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "capabilities" JSONB NOT NULL,
  "capabilities_schema_version" INTEGER NOT NULL DEFAULT 1,
  "quotas" JSONB NOT NULL,
  "quotas_schema_version" INTEGER NOT NULL DEFAULT 1,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3),
  "content_hash" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entitlement_plan_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entitlement_plan_versions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "entitlement_plan_versions_window_check" CHECK ("expires_at" IS NULL OR "expires_at" > "effective_at")
);

CREATE TABLE "personal_entitlement_grants" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "plan_version_id" TEXT NOT NULL,
  "status" "PersonalEntitlementGrantStatus" NOT NULL DEFAULT 'scheduled',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_code" TEXT NOT NULL,
  "source_type" TEXT NOT NULL DEFAULT 'admin',
  "source_id" TEXT,
  "granted_by_ref" TEXT NOT NULL,
  "revoked_by_ref" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_entitlement_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personal_entitlement_grants_version_check" CHECK ("version" >= 1),
  CONSTRAINT "personal_entitlement_grants_window_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "personal_entitlement_grants_revocation_check" CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL))
);

CREATE TABLE "entitlement_grant_events" (
  "id" TEXT NOT NULL,
  "grant_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "from_status" "PersonalEntitlementGrantStatus",
  "to_status" "PersonalEntitlementGrantStatus" NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "evidence_schema_version" INTEGER NOT NULL DEFAULT 1,
  "content_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entitlement_grant_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entitlement_plans_key_key" ON "entitlement_plans"("key");
CREATE INDEX "entitlement_plans_status_updated_at_idx" ON "entitlement_plans"("status", "updated_at");
CREATE INDEX "entitlement_plans_active_version_id_idx" ON "entitlement_plans"("active_version_id");
CREATE UNIQUE INDEX "entitlement_plan_versions_plan_id_version_key" ON "entitlement_plan_versions"("plan_id", "version");
CREATE INDEX "entitlement_plan_versions_plan_id_effective_at_idx" ON "entitlement_plan_versions"("plan_id", "effective_at");
CREATE INDEX "entitlement_plan_versions_expires_at_idx" ON "entitlement_plan_versions"("expires_at");
CREATE INDEX "personal_entitlement_grants_user_id_status_starts_at_idx" ON "personal_entitlement_grants"("user_id", "status", "starts_at");
CREATE INDEX "personal_entitlement_grants_plan_version_id_status_idx" ON "personal_entitlement_grants"("plan_version_id", "status");
CREATE INDEX "personal_entitlement_grants_ends_at_status_idx" ON "personal_entitlement_grants"("ends_at", "status");
CREATE UNIQUE INDEX "personal_entitlement_grants_one_active_per_user" ON "personal_entitlement_grants"("user_id") WHERE "status" = 'active';
CREATE UNIQUE INDEX "personal_entitlement_grants_one_scheduled_per_user" ON "personal_entitlement_grants"("user_id") WHERE "status" = 'scheduled';
CREATE INDEX "entitlement_grant_events_grant_id_created_at_idx" ON "entitlement_grant_events"("grant_id", "created_at");
CREATE INDEX "entitlement_grant_events_event_type_created_at_idx" ON "entitlement_grant_events"("event_type", "created_at");

ALTER TABLE "entitlement_plan_versions" ADD CONSTRAINT "entitlement_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "entitlement_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entitlement_plans" ADD CONSTRAINT "entitlement_plans_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "entitlement_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personal_entitlement_grants" ADD CONSTRAINT "personal_entitlement_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personal_entitlement_grants" ADD CONSTRAINT "personal_entitlement_grants_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "entitlement_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entitlement_grant_events" ADD CONSTRAINT "entitlement_grant_events_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "personal_entitlement_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_entitlement_immutable_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.entitlement_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "entitlement_plan_versions_immutable_update" BEFORE UPDATE ON "entitlement_plan_versions" FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_change();
CREATE TRIGGER "entitlement_plan_versions_immutable_delete" BEFORE DELETE ON "entitlement_plan_versions" FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_change();
CREATE TRIGGER "entitlement_grant_events_immutable_update" BEFORE UPDATE ON "entitlement_grant_events" FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_change();
CREATE TRIGGER "entitlement_grant_events_immutable_delete" BEFORE DELETE ON "entitlement_grant_events" FOR EACH ROW EXECUTE FUNCTION reject_entitlement_immutable_change();

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description") VALUES
  ('entitlements:read', 'entitlements-accounting', 'personal_entitlement', 'read', 'medium', false, true, 'Read the actor effective personal entitlement'),
  ('admin:entitlements:read', 'entitlements-accounting', 'personal_entitlement', 'read', 'high', false, false, 'Read personal entitlement plans, versions, grants, and safe decision evidence'),
  ('admin:entitlements:manage', 'entitlements-accounting', 'personal_entitlement', 'manage', 'critical', true, true, 'Create versioned personal entitlement plans and grants'),
  ('admin:entitlements:transition', 'entitlements-accounting', 'personal_entitlement', 'transition', 'critical', true, true, 'Activate, retire, revoke, expire, and recover personal entitlements')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id")
SELECT role_value::"UserRole", permission_id
FROM (VALUES
  ('member', 'entitlements:read'), ('creator', 'entitlements:read'), ('publisher', 'entitlements:read'), ('moderator', 'entitlements:read'), ('admin', 'entitlements:read'),
  ('moderator', 'admin:entitlements:read'), ('admin', 'admin:entitlements:read'),
  ('admin', 'admin:entitlements:manage'), ('admin', 'admin:entitlements:transition')
) AS grants(role_value, permission_id)
ON CONFLICT DO NOTHING;
