# V1 Unified Generation Center

## Scope

V1-35 provides one owner-scoped history and operations surface for Image, Chat, Video, and Music generation tasks. It aggregates application-owned `CreativeGeneration` records only. It does not call a Provider, enable a credential, or change production Provider routing.

## Data Contract

`GET /api/creative/generation-center` returns a newest-first cursor page with optional `workspace`, `status`, `dateFrom`, and `dateTo` filters. `GET /api/creative/generation-center/{id}` returns the same projection for one owned task.

The projection includes:

- application generation id, workspace, mode, normalized status, attempt lineage, and timestamps;
- estimated creative credits and whether usage is metered;
- review-required state, safe error code/message preview, and governed output metadata;
- server-derived view, cancel, retry, download, and reuse eligibility;
- an application workspace deep link.

The projection excludes raw prompts for Chat, Provider ids/modes/jobs/requests, input asset ids, parameter keys, private URLs, storage keys, actual Provider cost evidence, moderation evidence, and audit metadata. Chat turns already reference a `CreativeGeneration`; the center does not copy encrypted message content into another store.

## Ownership And Pagination

Both list and detail routes require an authenticated user. List queries apply the actor id/handle scope inside the repository, and detail reads return `404` for another user's record. Ordering is stable on `createdAt DESC, id DESC`; the returned id is the opaque cursor. Date filters are parsed as ISO timestamps and reject inverted ranges.

## Action Matrix

- `view` is available for every returned record.
- `cancel` follows durable generation state for Image, Video, and Music. Chat cancellation remains unavailable in this projection because active Chat turns must be stopped through the Chat lifecycle.
- `retry` reflects server eligibility and declares that the original request is required. The unified UI sends users to the originating workspace to resubmit; it never reconstructs a raw prompt from history.
- `download` and `reuse` depend on clean, uploaded governed outputs.

The browser never invents action availability. Mutation conflicts and permission failures remain authoritative server responses.

## Product Surface

The `Generations` primary page provides workspace/status/date filters, refresh, background polling while active records exist, cursor pagination, safe task details, governed asset downloads, cancel, retry/workspace recovery, offline/error/empty/loading states, and responsive keyboard-accessible controls. No local fixture rows appear in the product page.

## Validation

- request parser tests cover cross-workspace filters, ISO date normalization, invalid dates, inverted ranges, and limits;
- API tests cover authentication, owner isolation, cross-workspace results, stable pagination, date bounds, safe Chat projection, and detail lookup;
- Playwright covers product navigation, pagination, filtering, date query parameters, protected Chat content, detail, cancellation, action state, and 390x844 responsive behavior;
- `lint`, production build, API contracts, full server tests, full E2E, and production smoke are required before closeout.
