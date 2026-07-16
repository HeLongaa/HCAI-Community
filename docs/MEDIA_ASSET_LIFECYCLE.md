# Media Asset Lifecycle

MEDIA-01 keeps one owner-scoped `MediaAsset` as the durable metadata record for an upload or generated output. The user lifecycle is `active -> archived -> active` and `active|archived -> deleted -> recovered`; deletion is soft and never removes lineage, submission, generation, audit, or scan evidence.

## Invariants

- `deleted_at` immediately revokes download and workspace reuse.
- Archive and delete both withdraw published portfolio records. Restore and recovery never republish them.
- Public profile projection requires a published portfolio record backed by an uploaded, scan-clean, active, non-deleted asset.
- Owners can list only their assets. Admin readers receive an allowlisted projection without storage keys, signed URLs, Provider payloads, or scanner secrets.
- Admin lifecycle changes require `admin:queue:review` and produce automatic attempt evidence plus domain audit evidence.
- Physical object and metadata deletion remains retention-policy work. Real object storage, CDN invalidation, scanner integration, and private download delivery belong to MEDIA-03.
- Scope is personal accounts only. No tenant, team, organization, membership, or real OAuth/creative Provider behavior is introduced.
