ALTER TABLE "support_tickets"
  ADD COLUMN "data_rights_redacted_at" TIMESTAMP(3);

ALTER TABLE "support_ticket_messages"
  ADD COLUMN "data_rights_redacted_at" TIMESTAMP(3);

CREATE INDEX "support_tickets_data_rights_redacted_at_idx"
  ON "support_tickets"("data_rights_redacted_at");

CREATE INDEX "support_ticket_messages_data_rights_redacted_at_idx"
  ON "support_ticket_messages"("data_rights_redacted_at");
