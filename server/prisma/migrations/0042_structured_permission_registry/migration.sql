ALTER TABLE "permissions"
  ADD COLUMN "module" TEXT NOT NULL DEFAULT 'unclassified',
  ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'unclassified',
  ADD COLUMN "action" TEXT NOT NULL DEFAULT 'unclassified',
  ADD COLUMN "risk_level" TEXT NOT NULL DEFAULT 'high',
  ADD COLUMN "is_protected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resource_authorization" BOOLEAN NOT NULL DEFAULT false;

-- Runtime seeding upserts the complete structured metadata from the immutable
-- code registry. These updates cover protected grants before the first boot.
UPDATE "permissions" SET "is_protected" = true, "risk_level" = 'critical', "resource_authorization" = true
WHERE "id" IN ('admin:permissions:manage', 'admin:accounting:repair');

CREATE INDEX "permissions_module_resource_action_idx" ON "permissions"("module", "resource", "action");
CREATE INDEX "permissions_risk_level_idx" ON "permissions"("risk_level");
