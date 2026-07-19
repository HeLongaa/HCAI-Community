# Permission-Aware Search Index And Synchronization

## Scope

SEARCH-01 indexes tasks, community posts, public or owner-visible user profiles, and media assets for personal accounts. It does not introduce tenant, team, organization, membership, workspace, or invitation models. Discovery UI, query suggestions, ranking iteration, and richer Admin diagnostics remain SEARCH-02.

## Authorization Boundary

`GET /api/search` supports anonymous and personal-account callers. Every indexed document has a public flag plus zero or more grants for an authenticated personal account, a specific user ID, or a registered permission. PostgreSQL applies those grants in the same `WHERE` clause as the full-text match, before ranking, ordering, cursor pagination, or response projection. Inaccessible documents therefore do not affect returned rows or cursors.

- Tasks are public only when active and explicitly public. Community-visible tasks require authentication. Publishers, assignees, proposers, submitters, and `admin:tasks:read` retain bounded access.
- Community posts are public only while published and moderation-visible. Authors and `admin:community:read` can locate non-public lifecycle states.
- User profiles are public only while the account is active and the profile is public and discoverable. The owner and `admin:users:read` retain access.
- Assets are public only through a published portfolio on a public, discoverable profile with portfolio display enabled, and only while uploaded, clean, active, and not deleted. The owner and `admin:media:read` retain access.

Search documents contain bounded display projections and navigation targets. Owner-visible private sources may contribute a bounded title and summary, so the index is classified as restricted and is never queried without SQL grant filtering. Documents never contain email addresses, storage keys, authorization tokens, credentials, or raw Provider payloads.

## Synchronization

Migration `0088_permission_aware_search_index` creates the document, grant, and mutable synchronization queue tables. PostgreSQL triggers enqueue changes atomically with task, post, profile, user, media asset, portfolio, proposal, and submission writes. The production worker claims queue rows with compare-and-set state, retries failures, recovers stale claims, and upserts the full-text document and grants transactionally.

Default worker controls:

```text
SEARCH_INDEX_WORKER_ENABLED=true
SEARCH_INDEX_WORKER_INTERVAL_SECONDS=5
SEARCH_INDEX_WORKER_BATCH_SIZE=100
```

The target steady-state indexing lag is at most 30 seconds. Each document records its latest queue-to-index latency; `GET /api/admin/search/index/status` reports per-type average/maximum latency and target compliance together with document counts, queue state, and oldest-source lag, without returning indexed private content.

## Recovery And Rebuild

Admins with `admin:search:manage` can drain pending/failed work with `POST /api/admin/search/index/sync` or enqueue a bounded rebuild with `POST /api/admin/search/index/rebuild`. Rebuilds enqueue both current source rows and existing documents so deleted or orphaned projections are repaired. Each request is bounded to 500 processed rows and records sanitized audit evidence with resource types, reason code, counts, and outcomes.

Run focused verification with:

```bash
npm run test:search-index
FOUNDATION_DATABASE_URL=postgresql://... npm run test:search-index:integration
npm run test:search-index:e2e
```
