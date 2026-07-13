# V1 Unified Asset Library, Versions, and Reuse

V1-36 adds an owner-scoped asset library over the existing governed `media_assets` store. It does not create a second file store, expose Provider evidence, or enable real Provider traffic.

## Ownership and safe projection

`GET /api/media/assets` and `GET /api/media/assets/:id` resolve the authenticated owner in the repository. The safe response contains file display metadata, application asset ids, scan/lifecycle summaries, archive state, application generation summary, lineage, reference status, and server-derived actions. It excludes storage keys, signed/private URLs, raw metadata, Provider ids/jobs/payloads, moderation evidence, and other users' assets.

The list supports stable cursor pagination plus filename, media type, purpose, target workspace eligibility, and archive-state filters. Archived assets are hidden by default.

## Lineage and immutable versions

`media_asset_relations` records application-id-only `parent`, `variant`, and `reused_as_input` edges. The repository:

- requires ownership of both endpoints;
- rejects self-links and cycles across parent/variant edges;
- writes repeated requests idempotently;
- records the source generation, target workspace, and fixed role without private Provider or storage identifiers.

When a generation with governed inputs links output assets, the application automatically writes reuse lineage. Image edit, image-to-image, and variation outputs also receive an immutable variant edge. A new version is a new asset; existing asset bytes and evidence are never overwritten.

## Governance and archive semantics

Reuse is allowed only when the server confirms owner visibility, `uploaded` lifecycle, clean scanner state, active archive state, allowed purpose, MIME type, size, and target capability. The UI displays the returned action and reason; it does not infer permission.

V1 exposes reversible archive/restore, not hard deletion. Archive hides an asset from default lists and disables download/reuse while retaining generation, task-submission, lineage, cost, and audit references. No endpoint can hard-delete delivery evidence.

## Product surface

The `Assets` primary page provides search, media/purpose/source grouping, filters, compact cards, safe detail, source generation, version/reuse lineage, governed download, archive/restore, pagination, loading/empty/error states, and responsive behavior. Sending an eligible asset to Image, Video, or Chat stores an application asset id handoff; the target studio restores it only after its own eligible-input API includes the asset, including after a browser refresh.

## Verification

- media route tests: safe projection, owner isolation, filters, archive/restore, idempotency, foreign-target denial, and cycle rejection;
- repository and Prisma schema generation/validation;
- Playwright: filters, detail/lineage, archive, handoff, and mobile overflow;
- full lint, build, server tests, API/OpenAPI/permission matrix verification, E2E, and fixture production smoke.

Real Provider HTTP clients, credentials, paid traffic, hard deletion, and public sharing remain outside V1-36.
