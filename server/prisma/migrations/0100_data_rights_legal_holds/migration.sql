CREATE TABLE "data_rights_legal_holds" (
  "id" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "subject_ref" TEXT NOT NULL,
  "scope_domain" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "authority_role" TEXT NOT NULL,
  "authority_reference_hash" TEXT NOT NULL,
  "owner_ref" TEXT NOT NULL,
  "review_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "released_at" TIMESTAMP(3),
  "release_reason_code" TEXT,
  "released_by_ref" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_rights_legal_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_legal_holds_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_legal_holds_scope_check" CHECK ("scope_domain" IN ('identity', 'sessions', 'profile', 'community', 'tasks', 'media', 'creative', 'chat', 'developer_access', 'webhooks', 'notifications', 'support', 'billing', 'audit', 'safety')),
  CONSTRAINT "data_rights_legal_holds_reason_check" CHECK ("reason_code" ~ '^[a-z0-9][a-z0-9._:-]{2,63}$'),
  CONSTRAINT "data_rights_legal_holds_authority_role_check" CHECK ("authority_role" IN ('legal_hold_admin', 'security_legal_incident_owner')),
  CONSTRAINT "data_rights_legal_holds_authority_hash_check" CHECK ("authority_reference_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "data_rights_legal_holds_owner_ref_check" CHECK ("owner_ref" ~ '^actor_[a-f0-9]{24}$'),
  CONSTRAINT "data_rights_legal_holds_window_check" CHECK ("review_at" > "created_at" AND "expires_at" > "review_at"),
  CONSTRAINT "data_rights_legal_holds_release_check" CHECK (("released_at" IS NULL AND "release_reason_code" IS NULL AND "released_by_ref" IS NULL) OR ("released_at" IS NOT NULL AND "release_reason_code" IS NOT NULL AND "released_by_ref" IS NOT NULL))
);

CREATE TABLE "data_rights_legal_hold_events" (
  "id" TEXT NOT NULL,
  "legal_hold_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_rights_legal_hold_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_legal_hold_events_legal_hold_id_fkey" FOREIGN KEY ("legal_hold_id") REFERENCES "data_rights_legal_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_legal_hold_events_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "data_rights_legal_hold_events_hash_check" CHECK ("evidence_hash" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "data_rights_legal_holds_subject_id_released_at_expires_at_id_idx" ON "data_rights_legal_holds"("subject_id", "released_at", "expires_at", "id");
CREATE INDEX "data_rights_legal_holds_review_at_released_at_id_idx" ON "data_rights_legal_holds"("review_at", "released_at", "id");
CREATE UNIQUE INDEX "data_rights_legal_hold_events_legal_hold_id_sequence_key" ON "data_rights_legal_hold_events"("legal_hold_id", "sequence");
CREATE INDEX "data_rights_legal_hold_events_event_type_created_at_id_idx" ON "data_rights_legal_hold_events"("event_type", "created_at", "id");

CREATE TRIGGER "data_rights_legal_hold_events_immutable" BEFORE UPDATE OR DELETE ON "data_rights_legal_hold_events" FOR EACH ROW EXECUTE FUNCTION reject_data_rights_evidence_mutation();

CREATE OR REPLACE FUNCTION protect_data_rights_legal_hold() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.data_rights_maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'data_rights_legal_holds cannot be deleted';
  END IF;
  IF OLD."subject_id" <> NEW."subject_id"
    OR OLD."subject_ref" <> NEW."subject_ref"
    OR OLD."scope_domain" <> NEW."scope_domain"
    OR OLD."reason_code" <> NEW."reason_code"
    OR OLD."authority_role" <> NEW."authority_role"
    OR OLD."authority_reference_hash" <> NEW."authority_reference_hash"
    OR OLD."owner_ref" <> NEW."owner_ref"
    OR OLD."review_at" <> NEW."review_at"
    OR OLD."expires_at" <> NEW."expires_at"
    OR OLD."created_at" <> NEW."created_at"
    OR NEW."version" <> OLD."version" + 1
    OR (OLD."released_at" IS NOT NULL AND (NEW."released_at" IS DISTINCT FROM OLD."released_at" OR NEW."release_reason_code" IS DISTINCT FROM OLD."release_reason_code" OR NEW."released_by_ref" IS DISTINCT FROM OLD."released_by_ref"))
  THEN
    RAISE EXCEPTION 'data_rights_legal_holds permit only one versioned release transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "data_rights_legal_holds_guard" BEFORE UPDATE OR DELETE ON "data_rights_legal_holds" FOR EACH ROW EXECUTE FUNCTION protect_data_rights_legal_hold();
