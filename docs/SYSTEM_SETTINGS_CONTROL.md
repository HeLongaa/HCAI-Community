# System Settings Control

SET-01 exposes registered runtime configuration through a permission-protected Admin workflow. It does not enable a real Provider, execute OAuth changes, or introduce shared-account models.

## Data Model

- `SystemSetting` is the current published projection and carries a monotonically increasing `publishedVersion`.
- `SystemSettingChange` is a compare-and-set state machine for update and rollback requests.
- `SystemSettingRevision` is immutable publication evidence with a canonical SHA-256 content hash and links to its source change and previous revision.

Rollback never edits historical evidence. It creates a pending change from the selected revision and follows the same approval and publication path.

## Retention

After a revision has been superseded for 365 days, the default-disabled leased retention worker may clear its full value and actor reference while retaining version, event, content hash, predecessor/source links, timestamps, and a bounded SHA-256-only shape summary. Current revisions and revisions targeted by pending or approved rollback requests are excluded. Terminal change candidates, diffs, actor references, and notes are minimized on the same schedule. PostgreSQL validates the summary shape and permanently rejects restoration; a minimized rollback target returns `REVISION_REDACTED`.

## Controls

- Only keys registered in `config/runtime-config-registry.json` are visible or editable.
- Candidate objects reject missing or unknown fields, invalid types, ranges, enums, patterns, cross-field constraints, and plaintext secret material.
- Preview and publication use the same validated candidate, deterministic diff, schema version, and content hash.
- Requesters cannot approve or reject their own changes.
- Approval and publication use optimistic versions; publication also compares the setting base version.
- Projection update, revision creation, change publication, and final audit evidence share one PostgreSQL transaction.
- Every read, preview, request, approval, rejection, publication, and rollback operation emits audit evidence. Failed POST attempts are covered by the Admin mutation audit hook.

## Verification

Run `npm run test:system-settings` for machine-contract, runtime, route, and Prisma checks. The PostgreSQL integration tests prove migrations, persistence, concurrency conflicts, audit rollback, reviewed rollback, shared publication/retention locks, exclusions, and irreversible minimization.
