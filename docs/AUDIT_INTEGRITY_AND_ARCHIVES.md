# Audit Integrity And Archives

`AUDIT-02` keeps the product scoped to personal accounts and adds verifiable, immutable evidence to the existing Admin audit read side.

## Evidence Layers

- PostgreSQL assigns every `AuditEvent` a monotonic sequence, previous hash, SHA-256 content hash, and chain version. An advisory transaction lock serializes concurrent appends.
- Existing events are deterministically backfilled by `created_at` and `id` during migration `0047_audit_integrity`.
- Database triggers reject updates and deletes to audit events and archive manifests. Maintenance requires an explicit transaction-local `app.audit_maintenance=on` override.
- Portable exports create a second SHA-256 chain over sanitized API events. This keeps raw Provider or internal metadata out of downloadable artifacts.

## Access And Permissions

`admin:audit:read` covers list, detail, and archive-manifest reads. Export, online verification, and archive creation use `admin:audit:export`, `admin:audit:verify`, and `admin:audit:archive`. Every successful query, detail read, export, verification, archive listing, and archive creation appends a separate audit event after the requested snapshot is captured.

## Verification States

- `complete`: sequence, previous links, event hashes, count, and root hash are consistent.
- `broken`: at least one stored or portable link, hash, sequence, count, or root does not match.
- `unverifiable`: no event range exists to archive or required evidence is unavailable.

Run offline verification with:

```sh
node scripts/verify-audit-export.mjs audit-export.json
```

## Archive Semantics

Archive creation writes an append-only manifest containing the sequence range, event count, root hash, object reference, actor, and timestamp. It never removes or rewrites original audit facts. The object reference is evidence metadata and can point at the retention system selected by deployment operations.
