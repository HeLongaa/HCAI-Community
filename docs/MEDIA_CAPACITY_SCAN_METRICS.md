# Media Capacity And Scan Metrics

MEDIA-04 adds an operational read model over existing media lifecycle facts. It does not add a second source of truth and does not make external Provider calls.

## Sources And Window

`MediaAsset` supplies logical bytes, purpose, type, and lifecycle. `MediaStorageObject` supplies safe object-state aggregates. `MediaScanJob` supplies durable scan attempts, terminal failures, retry state, timeouts, and latency timestamps.

The optional `dateFrom` and `dateTo` window is limited to 366 days. Capacity filters use asset creation time. Scan filters use job creation time. `purpose` and `mediaType` apply to both datasets through the owning asset.

## Metrics

- Capacity: total and active bytes/assets, archived/deleted counts, available bytes, and cleanup-pending bytes.
- Distribution: count and bytes by media type, purpose, and storage state.
- Scan health: completed, failed, queued, retrying, and effective timed-out jobs; terminal failure percentage; average and P95 terminal latency.
- Backlog: current queued, retrying, and timed-out work plus oldest age.

Queued or retrying jobs whose durable timeout is in the past are counted as timed out. Failure percentage uses completed plus failed terminal jobs as its denominator. Missing latency evidence is represented as `null`, never as zero.

## API And Evidence

`GET /api/admin/media/business-metrics` requires `admin:media:read`. `GET /api/admin/media/business-metrics/export` requires `admin:media:export` and returns `kind=media.business-metrics.snapshot`.

Both operations record bounded audits containing filter presence and aggregate counts. Responses never include owners, storage keys, checksums, ETags, external scanner identifiers, signed URLs, secrets, or raw scanner payloads.

The Admin media lifecycle panel exposes the same filters, explicit unavailable latency state, responsive summary metrics, safe breakdowns, and JSON evidence export.

## Verification

Run `npm run test:media-capacity-scan-metrics`, the PostgreSQL integration test with `FOUNDATION_DATABASE_URL`, focused Playwright, and the full `CI=1 npm run check:pr` gate. Real infrastructure evidence is limited to the already-approved MEDIA-03 storage/scanner lifecycle; MEDIA-04 does not claim a real Provider or staging execution.
