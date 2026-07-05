# Phase 3 Track B Multi-Instance Runbook

This runbook is the operator entry point for running NewChat beyond a single API process. It ties together the shared rate-limit store, independent worker process, durable job leases, external metrics exporter, smoke checks, and rollback boundaries implemented during Phase 3 Track B.

## Deployment Shape

Recommended managed topology:

| Process | Command | Count | Required State | Main Responsibility |
| --- | --- | --- | --- | --- |
| API | `npm --prefix server run start` | 2+ for HA | Postgres, Redis when rate limits are shared | HTTP API, auth, task/media/admin routes, OpenAPI, `/metrics` |
| Worker | `npm --prefix server run worker` | 1+ per region or environment | Postgres | Recurring media scan and stale submission maintenance |
| Frontend | Vite/static deployment | CDN or web runtime dependent | API origin | Browser app |
| Scanner | External service | Deployment dependent | Callback reachability | Media scanning callbacks |
| Redis | Managed Redis-compatible store | HA provider preferred | TLS URL recommended | Shared rate-limit counters |
| Object Storage | S3-compatible bucket | Managed | Bucket policy and credentials | Media uploads and scan archive manifests |

Single-instance local and demo deployments can keep `RATE_LIMIT_STORE=memory`, omit worker process flags, and run without external scanner/object-storage integrations. Production-like multi-instance deployments should use the managed topology above.

## Environment Profiles

API instances:

- `NODE_ENV=production`
- `DATABASE_URL=<postgres-url>`
- `API_EMBEDDED_WORKERS_ENABLED=false`
- `RATE_LIMIT_ENABLED=true`
- `RATE_LIMIT_STORE=redis`
- `RATE_LIMIT_REDIS_URL=<redis-or-rediss-url>`
- `RATE_LIMIT_REDIS_FAILURE_MODE=fail_closed` unless an upstream gateway owns equivalent abuse limits
- `REQUEST_BODY_SIZE_GUARD_ENABLED=true`
- `AUTH_FAILURE_MONITOR_ENABLED=true`
- `METRICS_EXPORTER_ENABLED=true` when external scraping is required
- `METRICS_EXPORTER_FORMAT=prometheus`
- `METRICS_EXPORTER_TOKEN=<secret>` unless `/metrics` is private-network or gateway protected

Worker instances:

- `NODE_ENV=production`
- `DATABASE_URL=<postgres-url>`
- `MEDIA_SCAN_WORKER_ENABLED=true` when scan timeout sweeps should run automatically
- `TASK_STALE_SUBMISSION_WORKER_ENABLED=true` when stale-review sweeps should run automatically
- `WORKER_LEASE_TTL_SECONDS=300`
- `WORKER_LEASE_RENEW_INTERVAL_SECONDS=60`
- `MEDIA_SCAN_WORKER_INTERVAL_SECONDS=30` or deployment-specific
- `TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS=300` or deployment-specific

Shared deployment configuration:

- Auth signing secrets and key ids are shared across all API instances.
- `AUTH_TRUSTED_ORIGINS` or `CORS_ALLOWED_ORIGINS` includes every browser frontend origin.
- `AUTH_COOKIE_SAMESITE=None` and `AUTH_COOKIE_SECURE=true` are recommended for split frontend/API domains.
- Object storage and scanner settings are identical across API and worker packages when both process types need the same media governance behavior.
- Alert-channel settings are configured before relying on external incident fan-out.

## Startup Order

1. Back up the database.
2. Apply Prisma migrations.
3. Deploy API instances with embedded workers disabled.
4. Confirm `GET /health`.
5. Confirm `GET /api/openapi.json`.
6. Deploy worker instances with explicit job flags.
7. Confirm worker logs show enabled jobs and lease attempts.
8. Deploy frontend or shift traffic to the new frontend package.
9. Confirm cookie auth from the browser origin when split-domain auth is enabled.
10. Confirm `/metrics` scrape access from the monitoring system when enabled.

## Validation Checklist

Local and PR validation:

```bash
npm run check:quick
npm run check:pr
npm run check:deploy
```

Real environment validation:

```bash
npm run check:deploy:env
```

Run the real environment check through the GitHub Actions `Quality Gates` workflow with `smoke_profile=env` and the selected GitHub Environment. The environment profile prints only safe metadata: booleans, counts, provider modes, and non-secret operational summaries.

Before marking a deployment ready, verify:

- `RATE_LIMIT_STORE=redis` and `RATE_LIMIT_REDIS_URL` are configured for multi-instance API deployments.
- `API_EMBEDDED_WORKERS_ENABLED=false` on API instances.
- Worker job flags are explicit and match the desired automation scope.
- `WORKER_LEASE_RENEW_INTERVAL_SECONDS` is lower than `WORKER_LEASE_TTL_SECONDS`.
- `METRICS_EXPORTER_TOKEN` is configured or `/metrics` is protected by private networking/gateway controls.
- At least one media alert channel and one security alert channel are configured.
- OAuth redirect URIs match the deployed API callback URLs.
- `GET /api/admin/operations/metrics?windowMinutes=60` works for an audit-authorized operator.

## Staging Rehearsal

Run this before the first production multi-instance rollout:

1. Start two API instances against the same database and Redis store.
2. Confirm rate-limit counters are shared by driving the same auth/upload/admin bucket through both API instances.
3. Start two worker instances against the same database.
4. Confirm one worker acquires the `media-scan-sweep` lease and the other records skipped runs when both are eligible.
5. Stop a worker during a run and confirm a later worker can recover the lease after `WORKER_LEASE_TTL_SECONDS`.
6. Confirm `/metrics` returns Prometheus text and does not expose client keys, emails, tokens, raw paths, or secrets in labels.
7. Export an Admin operations metrics snapshot and attach it to the release notes.
8. Run `npm run smoke:production:env` with the same environment variables used by the deployment.

## Operator Signals

Primary checks:

- `GET /health`
- `GET /api/openapi.json`
- `GET /api/admin/operations/metrics?windowMinutes=60`
- `GET /api/admin/security/alerts`
- `GET /api/media/governance-config`
- `GET /api/media/scan-jobs/archive`
- `GET /metrics` when enabled

Important operations metrics:

- `security.eventsTotal`
- `security.rateLimit.exceeded.total`
- `security.deliveryFailures.total`
- `mediaScan.alertDeliveryFailures.total`
- `mediaScan.archiveCandidates.total`
- `mediaScan.historyPruned.jobs`
- `operations.leases.skippedRuns.total`
- `operations.leases.renewFailures.total`

Prometheus scrape families:

- `newchat_security_events_window_total`
- `newchat_rate_limit_exceeded_total`
- `newchat_security_alert_delivery_failures_total`
- `newchat_media_scan_archive_candidates_total`
- `newchat_media_scan_history_pruned_jobs_total`
- `newchat_operation_lease_skipped_runs_total`
- `newchat_operation_lease_renew_failures_total`

## Incident Triage

Shared rate-limit store unavailable:

1. Check Redis provider health, network routing, TLS settings, and `RATE_LIMIT_REDIS_URL`.
2. Confirm whether the selected failure mode is `fail_closed` or `fail_open`.
3. Inspect `rate_limit.store_unavailable` security events.
4. If the gateway is enforcing equivalent limits, temporarily use `fail_open` only with an explicit incident note.
5. Re-run the production smoke after restoring the store.

Worker lease contention:

1. Confirm multiple workers are intentionally running.
2. Check `operations.leases.skippedRuns.byKey`.
3. Confirm the holder worker is progressing and releasing leases.
4. Inspect `operation_leases` for stale holders when skips continue without job progress.
5. Scale down to one worker or disable the affected job flag while recovering.

Worker lease renew failures:

1. Check database connectivity and Prisma errors.
2. Confirm worker clocks are reasonably synchronized.
3. Compare job duration with the lease TTL.
4. Increase TTL only when normal duration consistently exceeds the current window.
5. Capture an operations metrics export before and after mitigation.

Metrics scrape failure:

1. Confirm `METRICS_EXPORTER_ENABLED=true`.
2. Confirm `METRICS_EXPORTER_FORMAT=prometheus`.
3. Confirm the scraper sends `Authorization: Bearer <token>` when `METRICS_EXPORTER_TOKEN` is set.
4. Confirm network or gateway policy allows the scraper.
5. Verify the Admin operations metrics endpoint still works; `/metrics` reuses that source.

## Rollback Boundary

Rollback triggers:

- Login, refresh, or OAuth callback failures affect normal users.
- Redis outage blocks requests and the failure policy is not appropriate for the deployment.
- Worker leases show persistent renew failures or stale holders that stop maintenance jobs.
- Scanner callbacks, object storage, or alert channels fail across all configured paths.
- `/metrics` is publicly exposed without token or network protection in an environment that requires authenticated scraping.
- Admin operations metrics or handoff export cannot be generated.

Rollback steps:

1. Stop traffic shift to the new release.
2. Scale worker processes down to one instance or disable mutating job flags.
3. Restore the previous backend package.
4. Restore the previous frontend package.
5. Revert risky environment changes, especially token key ids, cookie settings, scanner secrets, storage endpoints, Redis settings, worker flags, and metrics exporter exposure.
6. Keep additive operational tables such as `operation_leases` unless the database rollback plan explicitly removes them.
7. Run `npm run smoke:production:env` against the restored environment.
8. Confirm `GET /health`, login/refresh, worker logs, Admin operations metrics, and alert channels are healthy.
9. Attach operations metrics exports and relevant audit events to the incident notes.

## Related Docs

- `docs/OPERATIONS_RUNBOOK.md` for detailed alert, lease, delivery failure, and archive triage flows.
- `docs/GITHUB_ENVIRONMENT.md` for GitHub Environment variables and secrets.
- `docs/QUALITY_GATES.md` for local, PR, fixture, and real environment validation gates.
- `docs/RELEASE_CHECKLIST.md` for release execution and post-release checks.
- `docs/PHASE_3_TRACK_B_OPERATIONS_CLOSEOUT.md` for Track B completion boundaries.
