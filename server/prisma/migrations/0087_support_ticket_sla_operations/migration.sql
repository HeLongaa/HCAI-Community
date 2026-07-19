CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed');
CREATE TYPE "SupportTicketPriority" AS ENUM ('normal', 'urgent');
CREATE TYPE "SupportMessageAuthorType" AS ENUM ('requester', 'operator', 'system');

CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "requester_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'normal',
  "subject" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "related_resource_type" TEXT NOT NULL DEFAULT 'none',
  "related_resource_id" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "assigned_to_id" TEXT,
  "first_response_due_at" TIMESTAMP(3) NOT NULL,
  "resolution_due_at" TIMESTAMP(3) NOT NULL,
  "first_responded_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_tickets_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_tickets_content_check" CHECK (
    char_length("category") BETWEEN 1 AND 64 AND
    char_length("subject") BETWEEN 5 AND 120 AND
    char_length("details") BETWEEN 10 AND 4000 AND
    char_length("related_resource_type") BETWEEN 1 AND 64 AND
    ("related_resource_id" IS NULL OR char_length("related_resource_id") BETWEEN 1 AND 128) AND
    "locale" IN ('en', 'zh') AND
    "version" >= 1
  ),
  CONSTRAINT "support_tickets_state_timestamps_check" CHECK (
    ("status" NOT IN ('resolved', 'closed') OR "resolved_at" IS NOT NULL) AND
    ("status" <> 'closed' OR "closed_at" IS NOT NULL)
  )
);

CREATE TABLE "support_ticket_messages" (
  "id" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "author_id" TEXT,
  "author_type" "SupportMessageAuthorType" NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_messages_body_check" CHECK (char_length("body") BETWEEN 1 AND 4000)
);

CREATE TABLE "support_ticket_case_links" (
  "id" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "case_type" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_case_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_ticket_case_links_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_case_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_case_links_type_check" CHECK ("case_type" IN ('admin_review', 'moderation_case')),
  CONSTRAINT "support_ticket_case_links_case_id_check" CHECK (char_length("case_id") BETWEEN 1 AND 128)
);

CREATE INDEX "support_tickets_requester_id_created_at_id_idx" ON "support_tickets"("requester_id", "created_at", "id");
CREATE INDEX "support_tickets_status_priority_first_response_due_at_id_idx" ON "support_tickets"("status", "priority", "first_response_due_at", "id");
CREATE INDEX "support_tickets_assigned_to_id_status_updated_at_id_idx" ON "support_tickets"("assigned_to_id", "status", "updated_at", "id");
CREATE INDEX "support_tickets_category_status_created_at_id_idx" ON "support_tickets"("category", "status", "created_at", "id");
CREATE INDEX "support_ticket_messages_ticket_id_created_at_id_idx" ON "support_ticket_messages"("ticket_id", "created_at", "id");
CREATE INDEX "support_ticket_messages_author_id_created_at_id_idx" ON "support_ticket_messages"("author_id", "created_at", "id");
CREATE UNIQUE INDEX "support_ticket_case_links_ticket_id_case_type_case_id_key" ON "support_ticket_case_links"("ticket_id", "case_type", "case_id");
CREATE INDEX "support_ticket_case_links_case_type_case_id_idx" ON "support_ticket_case_links"("case_type", "case_id");
CREATE INDEX "support_ticket_case_links_created_by_id_created_at_id_idx" ON "support_ticket_case_links"("created_by_id", "created_at", "id");

INSERT INTO "support_tickets" (
  "id", "requester_id", "category", "status", "priority", "subject", "details",
  "related_resource_type", "related_resource_id", "locale", "first_response_due_at",
  "resolution_due_at", "first_responded_at", "resolved_at", "closed_at", "created_at", "updated_at"
)
SELECT
  review."id",
  profile."user_id",
  COALESCE(review."metadata"->>'category', 'general_support'),
  CASE
    WHEN review."status" IN ('resolved', 'closed') THEN review."status"::"SupportTicketStatus"
    WHEN review."status" IN ('in_progress', 'waiting_on_user') THEN review."status"::"SupportTicketStatus"
    ELSE 'open'::"SupportTicketStatus"
  END,
  'normal'::"SupportTicketPriority",
  review."title",
  review."note",
  COALESCE(review."metadata"->>'relatedResourceType', 'none'),
  NULLIF(review."metadata"->>'relatedResourceId', ''),
  CASE WHEN review."metadata"->>'locale' = 'zh' THEN 'zh' ELSE 'en' END,
  review."created_at" + CASE
    WHEN review."metadata"->>'category' IN ('privacy_request', 'data_export', 'account_deletion') THEN INTERVAL '30 days'
    ELSE INTERVAL '48 hours'
  END,
  review."created_at" + CASE
    WHEN review."metadata"->>'category' IN ('privacy_request', 'data_export', 'account_deletion') THEN INTERVAL '30 days'
    ELSE INTERVAL '5 days'
  END,
  review."reviewed_at",
  CASE WHEN review."status" IN ('resolved', 'closed') THEN COALESCE(review."reviewed_at", review."updated_at") END,
  CASE WHEN review."status" = 'closed' THEN COALESCE(review."reviewed_at", review."updated_at") END,
  review."created_at",
  review."updated_at"
FROM "admin_reviews" review
JOIN "profiles" profile ON profile."handle" = review."owner"
WHERE review."queue" = 'support' AND review."metadata"->>'kind' = 'support_request'
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "admin_reviews"
WHERE "queue" = 'support' AND "metadata"->>'kind' = 'support_request';

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at") VALUES
  ('admin:support:read', 'support-service', 'support_ticket', 'read', 'high', false, false, 'Read bounded support ticket, SLA, assignment, and message projections', CURRENT_TIMESTAMP),
  ('admin:support:manage', 'support-service', 'support_ticket', 'manage', 'critical', true, true, 'Assign, prioritize, respond to, link, resolve, and close support tickets', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:support:read'),
  ('admin', 'admin:support:read'),
  ('admin', 'admin:support:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
