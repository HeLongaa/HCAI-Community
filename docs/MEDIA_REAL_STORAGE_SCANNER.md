# Real Media Storage, Scanner, And Private Delivery

MEDIA-03 replaces the upload placeholder with a governed physical-object lifecycle while keeping real creative Provider and OAuth calls disabled.

## Object Lifecycle

`MediaAsset` owns product metadata. Its one-to-one `MediaStorageObject` owns physical state:

`pending_upload -> verifying -> quarantined|available -> cleanup_pending -> deleting -> deleted`

`verification_failed` is retryable through upload completion. A business recovery can restore metadata before physical cleanup, but it never recreates an object whose state is `deleted`.

## Upload Protocol

1. The browser computes SHA-256 over the exact file bytes.
2. `POST /api/media/uploads` creates metadata and returns a short-lived PUT contract.
3. S3 contracts bind content length, content type, and `x-amz-checksum-sha256`.
4. The browser checks the PUT response before requesting completion.
5. Completion performs an S3 HEAD and verifies size, MIME type, checksum, and ETag before scanning.
6. Missing or mismatched evidence records `verification_failed`; scanning is not dispatched.

Do not persist, audit, export, or log presigned URLs, storage credentials, raw object keys, checksums, or ETags outside their owning records.

## Scanner Protocol

The scanner receives a bounded request containing a durable external scan ID and a short-lived private read contract. It never receives the long-lived storage key. Generic webhook and ClamAV HTTP adapters share this rule.

Callbacks must identify the active durable scan job. Exact terminal duplicates are idempotent. A mismatched ID or a conflicting terminal result returns HTTP 409 and records `media.scan.callback_conflict`. Configure both the shared callback secret and timestamped HMAC verification in managed environments.

## Private Download

Only owner-accessible, clean, active assets whose object state is `available` can receive a download contract. The default S3 contract is short-lived. When `STORAGE_PRIVATE_DOWNLOAD_BASE_URL` and `STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET` are configured together, the API returns an HMAC-signed private CDN URL with a bounded expiry and key ID.

## Cleanup

Soft deletion immediately revokes download and reuse. The object moves to `cleanup_pending` with `cleanupAfter` derived from `MEDIA_STORAGE_CLEANUP_RETENTION_DAYS`. `media-storage-cleanup` claims due rows with optimistic concurrency, performs idempotent S3 DELETE, and records either `media.storage.deleted` or `media.storage.cleanup_failed`.

Run cleanup on dedicated workers with:

```text
MEDIA_STORAGE_CLEANUP_WORKER_ENABLED=true
MEDIA_STORAGE_CLEANUP_WORKER_INTERVAL_SECONDS=300
MEDIA_STORAGE_CLEANUP_BATCH_SIZE=25
MEDIA_STORAGE_CLEANUP_RETENTION_DAYS=30
```

JOB-02 supplies durable attempts, retry scheduling, DLQ, leases, and manual rerun. Operators may also invoke `POST /api/admin/media/storage/cleanup` with a bounded limit after resolving an incident.

## Release Evidence

Before release, retain evidence for:

- Empty migration and upgrade migration through `0055_media_storage_object_lifecycle`.
- Browser SHA-256, signed PUT, HEAD verification, scanner request, callback, and private download.
- Verification mismatch, duplicate completion, callback conflict, retention gating, DELETE retry, and non-resurrection after physical deletion.
- PostgreSQL integration, S3-compatible real network traffic, full backend tests, browser E2E, and production smoke.
- Safe Admin/list/export projections with no storage key, checksum, ETag, secret, or signed URL leakage.
