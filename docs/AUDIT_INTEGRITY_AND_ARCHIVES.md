# Audit Integrity And Archives

`AUDIT-02` and `OBS-04` keep the product scoped to personal accounts and add verifiable, immutable evidence, multidimensional discovery, safe differences, compliance export, and controlled retention to the Admin audit read side.

## Evidence Layers

- PostgreSQL assigns every `AuditEvent` a monotonic sequence, previous hash, SHA-256 content hash, and chain version. An advisory transaction lock serializes concurrent appends.
- Existing events are deterministically backfilled by `created_at` and `id` during migration `0047_audit_integrity`.
- Database triggers reject updates and deletes to audit events and archive manifests. Maintenance requires an explicit transaction-local `app.audit_maintenance=on` override.
- Portable exports create a second SHA-256 chain over sanitized API events. This keeps raw Provider or internal metadata out of downloadable artifacts.
- API projections derive bounded generic changes from `previous`/`next`, `before`/`after`, or explicit `diff` metadata. Sensitive keys, URLs, prompts, Provider identifiers, credentials, and storage keys are redacted before list, detail, or export responses.

## Access And Permissions

`admin:audit:read` covers list, detail, retention preview, and archive-manifest reads. Export, online verification, archive creation, and retention execution use `admin:audit:export`, `admin:audit:verify`, `admin:audit:archive`, and protected `admin:audit:retention`. Every successful query, detail read, export, verification, archive operation, retention status read, preview, and execution appends separate evidence.

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

## Retention Semantics

Retention is a distinct archive-before-prune workflow. It only selects a bounded contiguous expired prefix, preserves at least the configured number of recent events, and returns a snapshot-bound preview with an exact confirmation phrase. Execution writes the complete original chained rows to durable archive storage before acquiring the audit-chain lock and revalidating the preview. A stale snapshot, mock storage, failed upload, legal hold, disabled policy, empty prefix, or invalid confirmation causes no deletion.

Successful execution creates immutable `AuditRetentionDisposition` evidence with the policy version, cutoff, sequence range, root hash, archive checksum, byte count, storage provider, actor, and timestamp. The storage key remains server-side. The online verifier uses the newest disposition root as the previous-hash anchor for the first retained row.

Defaults remain fail-closed:

- `AUDIT_RETENTION_DAYS=730`
- `AUDIT_RETENTION_BATCH_SIZE=100`
- `AUDIT_RETENTION_MIN_RETAINED=1000`
- `AUDIT_RETENTION_LEGAL_HOLD=true`
- `AUDIT_RETENTION_PRUNE_ENABLED=false`

Production execution additionally requires durable non-mock archive storage. Ordinary application code cannot update or delete audit facts, archive manifests, or retention dispositions.
