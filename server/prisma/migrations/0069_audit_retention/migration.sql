CREATE TABLE "audit_retention_dispositions" (
  "id" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "cutoff_at" TIMESTAMP(3) NOT NULL,
  "from_sequence" BIGINT NOT NULL,
  "to_sequence" BIGINT NOT NULL,
  "event_count" INTEGER NOT NULL,
  "root_hash" TEXT NOT NULL,
  "archive_object_ref" TEXT NOT NULL,
  "archive_checksum_sha256" TEXT NOT NULL,
  "archive_bytes" INTEGER NOT NULL,
  "archive_provider" TEXT NOT NULL,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_retention_dispositions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_retention_dispositions_range_check" CHECK ("from_sequence" > 0 AND "to_sequence" >= "from_sequence"),
  CONSTRAINT "audit_retention_dispositions_count_check" CHECK ("event_count" = "to_sequence" - "from_sequence" + 1),
  CONSTRAINT "audit_retention_dispositions_checksum_check" CHECK ("archive_checksum_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "audit_retention_dispositions_bytes_check" CHECK ("archive_bytes" > 0)
);

CREATE INDEX "audit_retention_dispositions_created_at_idx" ON "audit_retention_dispositions"("created_at");

CREATE TRIGGER audit_retention_dispositions_immutable
  BEFORE UPDATE OR DELETE ON "audit_retention_dispositions"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_evidence_change();

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:audit:retention', 'audit-evidence', 'audit_retention_disposition', 'execute', 'critical', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('admin'::"UserRole", 'admin:audit:retention')
ON CONFLICT DO NOTHING;
