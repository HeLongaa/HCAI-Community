ALTER TABLE "support_tickets"
  ADD COLUMN "requester_subject_ref" TEXT,
  ADD COLUMN "retention_message_redacted_at" TIMESTAMP(3),
  ADD COLUMN "retention_redacted_at" TIMESTAMP(3);

ALTER TABLE "support_ticket_messages"
  ADD COLUMN "author_subject_ref" TEXT;

ALTER TABLE "support_ticket_case_links"
  ADD COLUMN "created_by_subject_ref" TEXT;

UPDATE "support_tickets"
SET "requester_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "requester_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "requester_id" IS NOT NULL;

UPDATE "support_ticket_messages"
SET "author_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "author_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "author_id" IS NOT NULL;

UPDATE "support_ticket_case_links"
SET "created_by_subject_ref" = 'subject_' || substring(encode(digest('data-rights:' || "created_by_id", 'sha256'), 'hex') FROM 1 FOR 24)
WHERE "created_by_id" IS NOT NULL;

ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_requester_id_fkey";
ALTER TABLE "support_tickets" ALTER COLUMN "requester_id" DROP NOT NULL;
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_requester_id_fkey"
  FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_ticket_case_links" DROP CONSTRAINT "support_ticket_case_links_created_by_id_fkey";
ALTER TABLE "support_ticket_case_links" ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "support_ticket_case_links"
  ADD CONSTRAINT "support_ticket_case_links_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "support_tickets_requester_subject_ref_retention_redacted_at_idx"
  ON "support_tickets"("requester_subject_ref", "retention_redacted_at");
CREATE INDEX "support_tickets_closed_at_retention_message_redacted_at_retention_redacted_at_id_idx"
  ON "support_tickets"("closed_at", "retention_message_redacted_at", "retention_redacted_at", "id");
