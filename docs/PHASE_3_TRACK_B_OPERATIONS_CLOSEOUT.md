# Phase 3 Track B Operations Closeout

This closeout captures the completed Phase 3 Track B production-operations baseline. Track B is considered complete for repository, fixture CI, and PR-ready handoff purposes after the shared rate-limit store, independent worker topology, distributed job leases, external metrics exporter, and multi-instance runbook slices.

## Closeout Decision

Track B can be closed as a Phase 3 implementation track.

Completed scope:

- Stateless API instances can share abuse-guard counters through Redis-compatible rate-limit storage.
- Background maintenance can run outside API processes through an explicit worker entrypoint.
- Multiple worker instances can run safely because mutating jobs use durable operation leases.
- Operators can inspect Admin JSON operations metrics and scrape a safe Prometheus-compatible `/metrics` endpoint.
- Release, GitHub Environment, quality-gate, and multi-instance runbook docs now describe the deployment and rollback path.

Still not claimed:

- Real deployment secrets and managed services have not been validated in this local environment.
- `npm run check:deploy:env` still requires a configured GitHub Environment or equivalent deployment shell.
- The first real multi-instance rollout still needs the staging rehearsal in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md`.
- OpenTelemetry/OTLP export and vendor-specific dashboard templates remain deferred follow-up work.
- Track C creative provider productization remains out of scope.

## Delivery Map

| Slice | Outcome | Primary Docs |
| --- | --- | --- |
| Shared rate-limit store | Redis-compatible shared counters, failure policy, smoke metadata | `docs/GITHUB_ENVIRONMENT.md`, `docs/QUALITY_GATES.md` |
| Worker process topology | `npm --prefix server run worker`, explicit worker flags, API embedded-worker opt-out | `README.md`, `docs/OPERATIONS_RUNBOOK.md` |
| Distributed job leases | Durable operation leases for mutating worker jobs, skip/renew/release signals | `docs/OPERATIONS_RUNBOOK.md` |
| External metrics exporter | Default-off Prometheus-compatible `/metrics`, token guard, safe label folding | `docs/OPERATIONS_RUNBOOK.md`, `docs/RELEASE_CHECKLIST.md` |
| Multi-instance runbook | End-to-end topology, environment profile, staging rehearsal, incident triage, rollback boundary | `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` |

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
- External monitoring scrapes `/metrics` when `METRICS_EXPORTER_ENABLED=true`.

This topology supports multiple API instances and multiple worker instances. Mutating recurring jobs are protected by durable operation leases, so only one worker should execute a given shared-state job at a time.

## Operator Workflows

Deploy and validate:

1. Configure the GitHub Environment variables and secrets from `docs/GITHUB_ENVIRONMENT.md`.
2. Run `npm run check:deploy` for fixture validation.
3. Run `npm run check:deploy:env` in the real deployment environment.
4. Deploy API instances with embedded workers disabled.
5. Deploy worker instances with explicit job flags.
6. Confirm `GET /health`, `GET /api/openapi.json`, Admin operations metrics, worker logs, and `/metrics` when enabled.
7. Complete the staging rehearsal in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` before the first production multi-instance rollout.

Monitor and triage:

1. Use the Admin Center Security tab or `GET /api/admin/operations/metrics?windowMinutes=60`.
2. Watch lease signals:
  - `operations.leases.skippedRuns.total`
  - `operations.leases.skippedRuns.byKey`
  - `operations.leases.renewFailures.total`
  - `operations.leases.renewFailures.byKey`
3. Watch delivery and scanner health:
  - `security.deliveryFailures`
  - `mediaScan.alertDeliveryFailures`
  - `mediaScan.archiveCandidates`
  - `mediaScan.historyPruned`
4. Use `GET /api/admin/operations/metrics/export` for handoff snapshots.
5. Use `/metrics` for external Prometheus-compatible scraping when enabled.

Rollback:

1. Stop new traffic shift.
2. Scale workers down to one instance or disable mutating worker job flags.
3. Restore the previous backend package.
4. Restore the previous frontend package when needed.
5. Revert risky environment changes, especially token key ids, cookie settings, scanner secrets, storage endpoints, Redis settings, worker flags, and metrics exporter exposure.
6. Keep additive operational tables such as `operation_leases` unless a database rollback plan explicitly removes them.
7. Re-run `npm run smoke:production:env`.
8. Confirm login, media upload signing, Admin operations metrics, worker logs, and manual sweep endpoints are healthy.

## Runtime Responsibilities

API process:

- Serves HTTP routes.
- Handles auth, task, media, notification, admin, OpenAPI, and `/metrics` requests.
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
- External monitoring scrapes `/metrics` when the exporter is enabled and protected.

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

## Metrics Boundary

Admin/API metrics:

- `GET /api/admin/operations/metrics?windowMinutes=60` returns JSON aggregates for authorized operators.
- `GET /api/admin/operations/metrics/export` returns an auditable handoff artifact and records `admin.operations.metrics_exported`.

External scrape:

- `GET /metrics` is default-off through `METRICS_EXPORTER_ENABLED`.
- `METRICS_EXPORTER_FORMAT=prometheus` is the supported format.
- `METRICS_EXPORTER_TOKEN` enables Bearer or `x-metrics-token` protection.
- If no token is configured, `/metrics` must be protected by private networking or an upstream gateway.
- Labels are intentionally narrow; unsafe values are folded into `other` or `unknown`.

Current Prometheus-compatible families include:

- `newchat_security_events_window_total`
- `newchat_rate_limit_exceeded_total`
- `newchat_security_alerts_total`
- `newchat_security_alert_delivery_failures_total`
- `newchat_media_scan_archive_candidates_total`
- `newchat_media_scan_history_pruned_jobs_total`
- `newchat_operation_lease_skipped_runs_total`
- `newchat_operation_lease_renew_failures_total`

## Closeout Validation

Every Track B implementation PR has used the repository deployment gate. The final closeout package should pass:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

Real environment validation remains separate:

```bash
npm run check:deploy:env
```

The environment profile is intentionally blocked until real secrets, Redis, object storage, scanner, OAuth providers, alert channels, and trusted origins are configured.

## Follow-Up Options

Recommended next product track:

- Start Track C Creative Tool Productization if the goal is to replace simulated creative outputs with provider-backed generation and persisted assets.

Recommended operations follow-ups only if needed:

- Add OpenTelemetry/OTLP export.
- Add managed dashboard templates for the chosen monitoring vendor.
- Run and document the first real staging rehearsal after deployment infrastructure exists.
- Add vendor-specific infrastructure examples if the deployment target is chosen.

These follow-ups should be tracked as separate tasks and should not block Track B closeout.
