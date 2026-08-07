# Support Ticket Operations

`SUPPORT-01` and `SUPPORT-02` use a dedicated personal-account support lifecycle. `SupportTicket` owns request state, assignment, priority, optimistic versioning, and first-response/resolution deadlines. `SupportTicketMessage` and `SupportTicketCaseLink` are append-only. `AdminReview` remains reserved for approval and dispute workflows; Trust and Safety reports and appeals remain moderation cases.

Users can create, list, read, and reply to their own tickets through `/api/support/requests`. Credential-like content is rejected before persistence. Ownership is checked on every read and write, and closed tickets cannot accept new messages.

Operators with `admin:support:read` can search and filter by status, category, priority, assignee, requester, and SLA state. `admin:support:manage` is required to assign, prioritize, transition, reply, or append a typed case link. All mutable operations require `expectedVersion`; audit metadata contains stable state, category, reason, assignment, and case identifiers but excludes request and message bodies.

Normal general-support tickets target a first response within 48 hours and resolution within five days. Privacy, export, and deletion requests target a first response within 72 hours and resolution within 30 calendar days. Urgent tickets target four-hour first response and 24-hour resolution. These are operational targets, not contractual guarantees.

Migration `0087_support_ticket_sla_operations` transfers legacy support-queue `AdminReview` rows whose owners resolve to current personal users, then removes those support rows from the generic review table. It also installs the support permissions and default moderator/admin read and admin manage grants.

`support_close_plus_730d` uses a default-disabled leased worker. At 365 days after close it replaces all message bodies with a fixed retained marker. At 730 days it removes the requester, assignee, message-author and case-link-creator identities, stable subject references, subject/details, locale-specific context, and related-resource references. The retained record contains only category, terminal status, priority, SLA timestamps, bounded lifecycle timestamps, and typed case identifiers. `SupportTicketCaseLink` remains immutable evidence and is not deleted.

Active `support` or `audit` legal holds and non-terminal data-rights requests block both stages. Support mutations and the retention worker share `support-ticket:<id>` PostgreSQL transaction locks; a minimized ticket cannot be replied to, reassigned, transitioned, or linked to another case. Migration `0115_support_ticket_retention` backfills stable `subject_<24hex>` references and permits user foreign keys to be set null without deleting retained evidence. Target-environment migration, worker replay, legal-hold concurrency, and access-control acceptance remain required.
