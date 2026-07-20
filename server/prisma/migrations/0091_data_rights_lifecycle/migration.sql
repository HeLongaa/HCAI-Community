CREATE TABLE "data_rights_requests" (
  "id" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "subject_ref" TEXT NOT NULL,
  "request_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'identity_verified',
  "reason_code" TEXT NOT NULL,
  "identity_method" TEXT NOT NULL,
  "identity_verified_at" TIMESTAMP(3) NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "primary_completed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "blocked_reason_code" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_rights_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_requests_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_requests_type_check" CHECK ("request_type" IN ('data_export', 'account_deletion')),
  CONSTRAINT "data_rights_requests_status_check" CHECK ("status" IN ('identity_verified', 'processing', 'primary_completed', 'completed', 'cancelled', 'blocked')),
  CONSTRAINT "data_rights_requests_version_check" CHECK ("version" >= 1),
  CONSTRAINT "data_rights_requests_subject_ref_check" CHECK ("subject_ref" ~ '^subject_[a-f0-9]{24}$'),
  CONSTRAINT "data_rights_requests_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{2,63}$'),
  CONSTRAINT "data_rights_requests_timestamps_check" CHECK (
    ("status" = 'completed' AND "completed_at" IS NOT NULL)
    OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL)
    OR ("status" NOT IN ('completed', 'cancelled'))
  )
);

CREATE TABLE "data_rights_events" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "evidence_hash" TEXT NOT NULL,
  "metadata" JSONB,
  "metadata_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_rights_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "data_rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_events_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "data_rights_events_hash_check" CHECK ("evidence_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "data_rights_export_artifacts" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "checksum_sha256" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_rights_export_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_export_artifacts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "data_rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_export_artifacts_hash_check" CHECK ("checksum_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "data_rights_export_artifacts_size_check" CHECK ("size_bytes" BETWEEN 1 AND 5242880)
);

CREATE TABLE "data_rights_deletion_receipts" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "record_count" INTEGER NOT NULL,
  "legal_basis_code" TEXT NOT NULL,
  "retention_expires_at" TIMESTAMP(3),
  "evidence_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_rights_deletion_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_deletion_receipts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "data_rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_deletion_receipts_disposition_check" CHECK ("disposition" IN ('erased', 'anonymized', 'retained_minimal')),
  CONSTRAINT "data_rights_deletion_receipts_count_check" CHECK ("record_count" >= 0),
  CONSTRAINT "data_rights_deletion_receipts_hash_check" CHECK ("evidence_hash" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "data_rights_backup_expiry_receipts" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "backup_class" TEXT NOT NULL,
  "object_ref_hash" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "expired_at" TIMESTAMP(3) NOT NULL,
  "verified_by_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_rights_backup_expiry_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_backup_expiry_receipts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "data_rights_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_backup_expiry_receipts_object_hash_check" CHECK ("object_ref_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "data_rights_backup_expiry_receipts_evidence_hash_check" CHECK ("evidence_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "data_rights_events_request_id_sequence_key" ON "data_rights_events"("request_id", "sequence");
CREATE INDEX "data_rights_events_event_type_created_at_id_idx" ON "data_rights_events"("event_type", "created_at", "id");
CREATE UNIQUE INDEX "data_rights_export_artifacts_request_id_key" ON "data_rights_export_artifacts"("request_id");
CREATE INDEX "data_rights_export_artifacts_expires_at_idx" ON "data_rights_export_artifacts"("expires_at");
CREATE UNIQUE INDEX "data_rights_deletion_receipts_request_id_domain_key" ON "data_rights_deletion_receipts"("request_id", "domain");
CREATE INDEX "data_rights_deletion_receipts_disposition_created_at_id_idx" ON "data_rights_deletion_receipts"("disposition", "created_at", "id");
CREATE UNIQUE INDEX "data_rights_backup_expiry_receipts_request_id_backup_class_key" ON "data_rights_backup_expiry_receipts"("request_id", "backup_class");
CREATE INDEX "data_rights_backup_expiry_receipts_expired_at_id_idx" ON "data_rights_backup_expiry_receipts"("expired_at", "id");
CREATE INDEX "data_rights_requests_subject_id_created_at_id_idx" ON "data_rights_requests"("subject_id", "created_at", "id");
CREATE INDEX "data_rights_requests_request_type_status_due_at_id_idx" ON "data_rights_requests"("request_type", "status", "due_at", "id");
CREATE INDEX "data_rights_requests_status_updated_at_id_idx" ON "data_rights_requests"("status", "updated_at", "id");

CREATE OR REPLACE FUNCTION reject_data_rights_evidence_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.data_rights_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is immutable evidence', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "data_rights_events_immutable" BEFORE UPDATE OR DELETE ON "data_rights_events" FOR EACH ROW EXECUTE FUNCTION reject_data_rights_evidence_mutation();
CREATE TRIGGER "data_rights_export_artifacts_immutable" BEFORE UPDATE OR DELETE ON "data_rights_export_artifacts" FOR EACH ROW EXECUTE FUNCTION reject_data_rights_evidence_mutation();
CREATE TRIGGER "data_rights_deletion_receipts_immutable" BEFORE UPDATE OR DELETE ON "data_rights_deletion_receipts" FOR EACH ROW EXECUTE FUNCTION reject_data_rights_evidence_mutation();
CREATE TRIGGER "data_rights_backup_expiry_receipts_immutable" BEFORE UPDATE OR DELETE ON "data_rights_backup_expiry_receipts" FOR EACH ROW EXECUTE FUNCTION reject_data_rights_evidence_mutation();
