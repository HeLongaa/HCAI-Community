# Phase 3 Track B Operations Closeout

This closeout captures the current production-operations boundary after the shared rate-limit store, independent worker topology, and distributed job lease slices.

## Current Usable Topology

Recommended multi-instance deployment:

- API processes run `npm --prefix server run start`.
- Worker processes run `npm --prefix server run worker`.
- API instances keep `API_EMBEDDED_WORKERS_ENABLED=false`.
- Worker instances enable only the jobs they should own:
  - `MEDIA_SCAN_WORKER_ENABLED=true`
  - `TASK_STALE_SUBMISSION_WORKER_ENABLED=true`
- Prisma-backed deployments set `DATABASE_URL` so operation leases are durable.
- Horizontally scaled API deployments use `RATE_LIMIT_STORE=redis` and `RATE_LIMIT_REDIS_URL` so abuse-guard counters are shared.

This topology supports multiple API instances and multiple worker instances. Mutating recurring jobs are protected by durable operation leases, so only one worker should execute a given shared-state job at a time.

## Runtime Responsibilities

API process:

- Serves HTTP routes.
- Handles auth, task, media, notification, admin, and OpenAPI requests.
- Applies rate limits for auth, media upload signing, and admin mutations.
- Exposes Admin/API JSON operations metrics.
- Keeps manual sweep endpoints available for operator recovery.

Worker process:

- Runs recurring operational jobs through `server/src/worker.js`.
- Owns media scan timeout sweeps when `MEDIA_SCAN_WORKER_ENABLED=true`.
- Owns stale submission sweeps when `TASK_STALE_SUBMISSION_WORKER_ENABLED=true`.
- Acquires, renews, and releases operation leases around mutating jobs.
- Logs skipped runs when another worker holds the lease.

Shared infrastructure:

- Postgres stores Prisma data, audit events, security events, media scan jobs, and `operation_leases`.
- Redis stores shared rate-limit counters when `RATE_LIMIT_STORE=redis`.
- Object storage stores media assets and scan archive manifests when `STORAGE_DRIVER=s3`.

## Lease Behavior

Worker job definitions declare a lease key. The current protected keys are:

- `media-scan-sweep`
- `task-stale-submission-sweep`

Lease lifecycle:

1. Worker attempts to acquire the lease before running the job.
2. If another active lease exists, the run is skipped and an `operations.lease.skipped` audit event is recorded.
3. If the lease is acquired, the worker runs the job and renews the lease on `WORKER_LEASE_RENEW_INTERVAL_SECONDS`.
4. On completion or failure, the worker releases the lease.
5. If a worker crashes, the lease expires after `WORKER_LEASE_TTL_SECONDS` and a later worker can recover it.

Defaults:

- `WORKER_LEASE_TTL_SECONDS=300`
- `WORKER_LEASE_RENEW_INTERVAL_SECONDS=60`

The renewal interval must be lower than the TTL.

## Operator Signals

Use the Admin Center Security tab or `GET /api/admin/operations/metrics?windowMinutes=60`.

Important signals:

- `operations.leases.skippedRuns.total`
- `operations.leases.skippedRuns.byKey`
- `operations.leases.renewFailures.total`
- `operations.leases.renewFailures.byKey`
- `mediaScan.historyPruned`
- `mediaScan.archiveCandidates`
- `security.deliveryFailures`
- `mediaScan.alertDeliveryFailures`

Audit filters:

- `action=operations.lease.skipped&resourceType=operation_lease`
- `action=operations.lease.renew_failed&resourceType=operation_lease`
- `action=media.scan.history_pruned&resourceType=media_scan_jobs`
- `action=media.scan.history_archived&resourceType=media_scan_jobs`

## Staging Rehearsal

Before production rollout, rehearse:

1. Run two API processes against the same database and Redis store.
2. Run two worker processes against the same database.
3. Confirm rate limits are shared across API instances.
4. Confirm only one worker executes `media-scan-sweep` while the other records skipped lease runs.
5. Stop one worker during a run and confirm the lease expires and can be recovered.
6. Run `npm run smoke:production:env` in the deployment environment.
7. Export an operations metrics snapshot and attach it to release notes.

## Rollback Boundary

Rollback is straightforward for API/worker package changes, but the `operation_leases` table is additive.

Rollback steps:

1. Stop new traffic shift.
2. Scale workers down to one instance or disable worker job flags.
3. Restore the previous backend package.
4. Keep the additive `operation_leases` table unless a database rollback plan explicitly drops it.
5. Re-run `npm run smoke:production:env`.
6. Confirm login, media upload signing, Admin operations metrics, and manual sweep endpoints are healthy.

## Still Pending

External Metrics Exporter is not complete yet.

Current observability is available through Admin/API JSON operations metrics and audit/security events. Prometheus/OpenTelemetry scrape/export support remains the next Track B runtime enhancement. Until that lands, external monitoring can poll the Admin metrics/export endpoints with an authorized operator token or use platform log/audit ingestion.

Track C creative provider work is out of scope for this closeout.
