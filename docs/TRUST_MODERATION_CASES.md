# Trust Moderation Cases

TRUST-01 replaces report and appeal use of the generic `AdminReview` queue with five append-only facts: `Report`, `ModerationCase`, `ModerationEvidence`, `ModerationDecision`, and `ModerationAppeal`. The product remains personal-account scoped.

## Lifecycle

Creating a report atomically validates the target, creates a case, stores the report, and records a SHA-256 target snapshot. A case has no mutable status column. Its projection is derived as `open`, `resolved`, `appealed`, or `closed` from original-decision, appeal, and appeal-decision facts. Version is derived from the fact count and guards concurrent decisions and appeals.

Each case permits one original decision and one appeal. Appeals are accepted only from the affected account within 30 days. An appeal reviewer must differ from the original reviewer. Database triggers reject updates and deletes for every Trust fact outside an explicit transaction-local maintenance override.

## Data Boundary

Reports and appeal statements are restricted and appear only in owner-scoped or permission-protected detail responses. Admin exports omit both statements. Evidence stores a stable type, bounded reference, reason code, and lowercase SHA-256 digest; it never stores raw files, URLs, Provider payloads, credentials, or detection internals. Audit metadata contains only case/report/decision IDs, target type, category, priority, stage, outcome, and reason code.

`POST /api/support/requests` rejects `content_report` and `moderation_appeal` with `DEDICATED_TRUST_ROUTE_REQUIRED`. Generic support, privacy, export, and deletion entry requests remain on the support repository until their owning tasks replace them.

## Operations

`admin:trust:read` permits case list, metrics, and detail reads. `admin:trust:review` permits append-only evidence and decisions. `admin:trust:export` permits a bounded sanitized JSON export. High-risk decisions have no bulk endpoint.

Run `npm run test:trust-moderation-cases`, deploy migration `0079_trust_moderation_cases` to a fresh PostgreSQL database, run `npm run test:trust-moderation-cases:integration`, and complete `CI=1 npm run check:pr` before release.
