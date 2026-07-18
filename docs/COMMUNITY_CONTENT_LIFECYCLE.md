# Community Content Lifecycle

COMM-01 adds owner-scoped post creation, drafts, editing, publication, and soft deletion for personal accounts. Existing published posts remain compatible, while drafts and deleted posts are excluded from every public list and anonymous detail response.

## Lifecycle

- New posts may be created as `draft` or `published`; omitted status remains `published` for API compatibility.
- Owners read all of their posts through `GET /api/posts/mine`, optionally filtered by lifecycle status.
- Edits, publication, and deletion require the current `expectedVersion`. Stale writes return `409 STATE_CONFLICT`.
- Only drafts can transition to published. Deletion records `deletedAt` and a bounded reason code and never performs a hard delete.
- Draft and deleted posts cannot receive comments, likes, or task conversion. Other users receive `404` for private lifecycle states and ownership failures.

## UI

The Community page contains an owner workspace for creating a post, saving a draft, editing, publishing, and deleting. The public topic list continues to use only published API results. Mutation failures remain visible and do not fabricate local success.

## Verification

- `npm run test:community-content-lifecycle`
- `FOUNDATION_DATABASE_URL=postgresql://... npm run test:community-content-lifecycle:integration`
- `npx playwright test e2e/community-content-lifecycle.spec.ts`
- `CI=1 npm run check:pr`
