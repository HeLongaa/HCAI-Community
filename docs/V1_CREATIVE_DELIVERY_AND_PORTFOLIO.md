# V1 Creative Delivery and Portfolio Contract

V1-37 connects completed creative outputs to task delivery, a private library, and a public portfolio without copying media bytes or weakening media governance.

## Source of truth

`MediaAsset` remains the only file record. A usable output must belong to the actor, be uploaded, have a clean scan, be active, use a compatible creative purpose, and appear in the output ids of the actor's completed `CreativeGeneration`. Every mutation repeats these checks on the server; client action state is never authorization evidence.

Chat message text is not a portfolio asset. It can participate only if a separate governed `MediaAsset` exists and passes the same checks.

## Targets

| Target | Persistence | Public |
| --- | --- | --- |
| Task submission | Existing `TaskSubmission.assetIds` plus immutable allowlisted `metadata.assetEvidence` | Participant scoped |
| Private library | Idempotent `LibraryItem` with `sourceType=asset` and `sourceId=MediaAsset.id` | No |
| Profile portfolio | Unique `ProfilePortfolioAsset(ownerId, assetId)` relation | Only while explicitly `published` and the source asset remains clean, uploaded, and active |

Task evidence contains only asset id, safe filename, content type, purpose, source generation id/workspace/mode/status, governance state, and capture time. The rights note remains a first-class submission field. Storage keys, Provider payloads, prompts, credentials, and scan internals are excluded. Archiving an asset does not rewrite or delete prior submission evidence.

## Portfolio lifecycle

New records default to `draft`. The owner must explicitly transition them:

- `draft` or `withdrawn` → `published`, after current governance is revalidated.
- `published` → `withdrawn`.
- `draft`, `published`, or `withdrawn` → `archived`.
- `archived` → `draft` through restore.

Archiving a published source `MediaAsset` atomically withdraws its portfolio record. Restoring the source asset does not republish it. Public profile queries independently reapply clean/uploaded/active checks so a governance change hides the item immediately.

## Authorization and negative boundaries

- Delivery-target discovery requires `task:submit` and returns only tasks assigned to the actor in a submit-ready or revision-ready state.
- Library and portfolio mutations require authentication and asset ownership.
- Portfolio management is owner-only; public profile reads expose only the safe published projection.
- V1-37 does not add a real Provider, credentials, paid traffic, RMB payment, withdrawal, KYC, invoice, or merchant settlement behavior.

## Verification

`server/src/modules/creative/delivery.routes.test.js` proves the full governed flow, idempotency, immutable evidence, public redaction, archive withdrawal, and no automatic republish. `server/src/creative/deliveryAssets.test.js` proves the shared eligibility and evidence allowlist.
