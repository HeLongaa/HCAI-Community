# Data Operation Policy Matrix

`config/entity-operation-policies.json` assigns every Prisma model to one owning domain and one primary mutation policy.
Run `npm run test:data-operation-policies` after any Prisma model or policy change.

## Policy Meanings

| Policy | Allowed behavior | Forbidden behavior |
| --- | --- | --- |
| Mutable CRUD | Validated owner-controlled field changes; explicit deletion where listed | Bypassing ownership, audit, or field allowlists |
| State transition | Declared transitions, compare-and-set, bounded metadata updates | Arbitrary replacement or reopening terminal history |
| Soft delete | Lifecycle state or tombstone followed by retention cleanup | Immediate user-triggered physical deletion |
| Append-only | Create a new fact or linked correction; retention-only hard deletion where the model explicitly allows it | Updating a fact or deleting it outside the owning retention policy |
| Immutable evidence | Create, expire, or supersede with another record | Editing evidence content after creation |
| Retention-minimizable evidence | Preserve structural evidence while an allowlisted maintenance transaction irreversibly removes expired payload and identity fields | Ordinary mutation, hard deletion, malformed summaries, or restoring minimized data |

## Domain Summary

- Identity and profile: credentials and role assignments are controlled CRUD; email verification/password-reset actions,
  OAuth authorization requests, and sessions are bounded state transitions; users are soft deleted. Email actions may
  only be created, consumed once, revoked, or hard-deleted by the credential-retention path after expiry.
- Marketplace and media: business aggregates use state machines; user removal is soft deletion; asset lineage is
  immutable evidence. The dedicated `marketplace_close_plus_730d` transaction deletes untouched 30-day drafts and,
  after terminal task/dispute and accounting closeout, clears mutable participant links, private task/proposal/submission
  text, denormalized asset IDs, dispute-review text, notifications, and search projections while preserving bounded status, reward,
  currency, reason, time, hash, and count evidence. Scoped `tasks` legal holds block the transaction. Database triggers
  serialize all task-family writes on `task:<id>` and reject re-identification after redaction. Immutable lifecycle mutations,
  append-only Domain Events, ledger/accounting facts, and normalized immutable submission-asset links remain outside that maintenance authority; the
  full policy is blocked until their anonymized evidence projection is approved.
- AI runtime: generations, turns, messages, mutations, ingestion, and Provider replay use explicit lifecycle transitions;
  deletion evidence remains append-only. The dedicated generation-retention transaction may clear previews at 30 days and
  subject/asset/Provider identifiers plus non-allowlisted JSON at 365 days only after review, appeal, legal-hold,
  Provider lifecycle, ingestion, mutation, quota, credit and cost closeout. A database trigger shares the
  `creative-generation:<id>` advisory lock across all writes and prevents re-identification after terminal redaction.
  A second default-disabled transaction minimizes terminal Provider operation, mutation, replay, ingestion, and retry
  identifiers/free-form evidence after 180 days while retaining status, reason, timing, count, and digest evidence;
  open review, legal hold, reconciliation, or unsettled accounting fails closed.
- Entitlements and accounting: balance snapshots and reservation aggregates may transition atomically, while ledger
  facts, accounting operations, and movements are append-only. Corrections are linked compensation records.
- Provider control and risk: mutable state is separated from immutable cap evidence and append-only circuit events.
- Account risk cases use compare-and-set transitions. Signals, appeals, and disposition evidence remain append-only during
  their active retention window; the dedicated 365-day maintenance path may clear subject, actor, preview, and dedupe
  links without deleting the normalized decision evidence, and active `audit/safety` legal holds block that redaction.
- Audit and security: audit-chain facts are append-only protected evidence; audit archive manifests are immutable.
  Security events are append-only while retained but may be deleted only by the 365/730-day maintenance policy;
  security incidents use compare-and-set state transitions and remain non-deletable evidence.
- Observability: sanitized logs and Trace spans are append-only and may be hard-deleted only by retention maintenance;
  SLO alerts use compare-and-set state transitions and preserve their versioned disposition evidence.
- Configuration: the current setting projection is mutable only through a published change; change requests use an
  explicit state machine and optimistic versions. Superseded revisions remain immutable structural evidence, while the
  dedicated 365-day maintenance transaction may irreversibly remove full values, titles/descriptions, actor references,
  diffs, and notes. It retains only version/event/hash/linkage fields and a bounded database-validated SHA-256 shape
  summary; current revisions and pending/approved rollback targets are excluded, and publication shares the same scope lock.
- Notifications: templates are soft-deleted lifecycle aggregates, published template versions are immutable evidence,
  personal delivery preferences are owner-controlled mutable records with optimistic versions, delivery queues use
  compare-and-set state transitions, and attempt rows preserve a bounded processing-to-terminal lifecycle. The shared
  notification retention Worker hard-deletes user notification families 180 days after creation and Provider Alert
  Delivery/Attempt/Replay families 180 days after a succeeded, dead-lettered, or cancelled terminal update; queued,
  processing, and retry-scheduled Provider alerts are excluded.
- Trust and Safety: reports, cases, hash-addressed evidence, original decisions, appeals, rule transitions, and bulk-operation outcomes are append-only facts. Only the dedicated `moderation_close_plus_730d` maintenance transactions may redact subject and free-text/target details after terminal-state and legal-hold checks. Retention-redacted rule versions are permanently retired; completed bulk operations retain only hashes, counts, action, and aggregate outcome evidence while their idempotency hash continues to prevent duplicate execution.
  Case status and optimistic version are derived from that fact chain; database triggers reject update and delete.
- Search and discovery: documents and authorization grants are disposable derived projections; synchronization queue
  rows use bounded pending, processing, failed, and completion transitions and are removed only after compare-and-set success.

## Enforcement Boundary

This task freezes the policy contract and proves complete schema coverage. `ADMIN-01`, `AUDIT-01`, and the owning domain
tasks must enforce policies at API and repository boundaries. A `state_transition` label does not permit arbitrary
updates; it requires a declared transition and idempotent or compare-and-set protection where concurrency matters.

The product remains personal-account scoped and this matrix adds no shared account container or membership model.
