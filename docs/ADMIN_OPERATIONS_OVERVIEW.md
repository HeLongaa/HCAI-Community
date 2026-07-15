# Admin Operations Overview and Global Search

`ADMIN-03` closes the Phase 1 Admin console foundation with a read-only operations home and a bounded, permission-aware search projection.

## Boundaries

- The overview reuses existing operations metrics, Admin reviews, security alerts, event Inbox, domain event, and JobRun repositories. It is not a source of truth.
- Search is limited to the allowlisted resource types in `config/admin-operations-overview-contract.json`.
- Every resource family is omitted unless the actor has its existing read permission. Counts and empty sections must not reveal omitted families.
- Results expose only `type`, `id`, display text, status, timestamp, and an Admin deep link. Raw metadata, prompts, payloads, credentials, network identifiers, and storage references are never projected.
- Queries are 2-80 characters, results are capped at 20, and repository reads are capped at 100 candidates per permitted type.
- The feature is read-only. It adds no database model, tenant/team concept, external search service, or real Provider call.

## API

- `GET /api/admin/overview?windowMinutes=60` returns low-cardinality operations metrics plus bounded pending-review, alert, and recovery queues.
- `GET /api/admin/search?q=<query>&types=<csv>&limit=20&cursor=<cursor>` returns safe cross-module search projections with a stable next cursor. Unknown types and invalid bounds fail with `VALIDATION_FAILED`.

Both routes require `admin:access`. Resource families inside each response are additionally gated by their established permissions such as `admin:audit:read`, `admin:queue:read`, `admin:events:read`, `admin:jobs:read`, and `admin:accounting:read`.

## Frontend

The Admin `Overview` tab presents compact operational counters, queues, and global search. Every result targets `#admin?tab=Overview&overviewResourceType=...&overviewResourceId=...`, so a shared or reloaded URL can resolve and highlight the same safe projection.
