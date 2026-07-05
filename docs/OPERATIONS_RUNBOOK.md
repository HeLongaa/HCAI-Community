# Operations Runbook

This runbook covers the current operational flows:

- production smoke checks
- API and worker process topology
- shared rate-limit state
- distributed worker job leases
- security alert disposition
- security alert delivery failure triage
- scan history archive before prune

## Production Smoke Checks

Use the quality gate tiers in `docs/QUALITY_GATES.md`:

- `npm run check:quick` for local handoff.
- `npm run check:pr` before merge.
- `npm run check:deploy` before deployment with a safe fixture smoke profile.
- `npm run check:deploy:env` in the deployment environment.

Run `npm run smoke:production` in CI to validate the managed production checklist against the safe fixture profile. Run `npm run smoke:production:env` in a deployment environment to validate the real environment without printing secrets.

The smoke profile verifies managed auth secrets, S3 storage, webhook media scanning, scanner request/callback signing, media and security alert channels, secure cross-site cookie settings, trusted frontend origins, rate-limit/body-size/auth-failure guards, worker lease settings, and external OAuth provider metadata.

For multi-instance deployments, configure `RATE_LIMIT_STORE=redis` with `RATE_LIMIT_REDIS_URL`. Use `RATE_LIMIT_REDIS_FAILURE_MODE=fail_closed` when the app owns the primary abuse boundary; use `fail_open` only when an external gateway or WAF is enforcing equivalent limits. Redis store failures emit `rate_limit.store_unavailable` security events with warning severity for fail-open and critical severity for fail-closed.

## API And Worker Processes

Run the HTTP API and recurring background work as separate process types in multi-instance deployments.

API process:

```bash
npm --prefix server run start
```

Worker process:

```bash
npm --prefix server run worker
```

Recommended production settings:

- `API_EMBEDDED_WORKERS_ENABLED=false` on API instances.
- `MEDIA_SCAN_WORKER_ENABLED=true` on worker instances when scanner timeout sweeps should run automatically.
- `TASK_STALE_SUBMISSION_WORKER_ENABLED=true` on worker instances when overdue task-review submissions should be marked stale automatically.
- `WORKER_LEASE_TTL_SECONDS=300` unless a deployment needs a longer stale-worker recovery window.
- `WORKER_LEASE_RENEW_INTERVAL_SECONDS=60`; this must stay below the lease TTL.
- Keep manual sweep endpoints available for operator-triggered recovery and one-off maintenance.

Operational notes:

1. Scale API instances for request traffic.
2. Scale worker instances separately from API instances.
3. Keep worker intervals long enough for normal job duration; each process also skips a job if the previous local run is still active.
4. Mutating jobs use durable operation leases when `DATABASE_URL` is configured, so multiple worker instances can be deployed safely.
5. Review `rate_limit.store_unavailable`, `operations.lease.skipped`, `operations.lease.renew_failed`, `media.scan.timeout`, and `task.submission.stale` audit/security events during worker incident triage.

## Distributed Worker Leases

Worker jobs that mutate shared state acquire operation leases before running.

Protected jobs:

- `media-scan-sweep`
- `task-stale-submission-sweep`

Lease lifecycle:

1. Acquire the lease by key.
2. Skip the run if another active worker owns the lease.
3. Renew while the job is running.
4. Release after the job finishes or fails.
5. Recover after `WORKER_LEASE_TTL_SECONDS` if a worker crashes.

Audit and metrics signals:

- `operations.lease.acquired`
- `operations.lease.recovered`
- `operations.lease.skipped`
- `operations.lease.renewed`
- `operations.lease.renew_failed`
- `operations.lease.released`

Triage flow for high skipped-run volume:

1. Confirm whether multiple worker instances are intentionally running.
2. Check `operations.leases.skippedRuns.byKey` in operations metrics.
3. Confirm the holder worker is healthy and completing runs.
4. If skipped runs persist without job progress, inspect the `operation_leases` row for the key and compare `expires_at` with current time.
5. If the holder has crashed, wait for TTL expiry or temporarily disable all but one worker process.

Triage flow for lease renewal failures:

1. Check database connectivity and Prisma error logs.
2. Confirm worker clocks are reasonably synchronized.
3. Compare job duration with `WORKER_LEASE_TTL_SECONDS`.
4. Increase TTL only if normal job duration is consistently longer than the current lease window.
5. Export an operations metrics snapshot before and after the mitigation.

Use `docs/GITHUB_ENVIRONMENT.md` when configuring the GitHub Environment variables and secrets for real deployment smoke.
Use `docs/RELEASE_CHECKLIST.md` for release execution, post-release verification, and rollback criteria.

## Security Alerts

Use `GET /api/admin/security/alerts` to inspect active alert summaries.
Use `GET /api/admin/security/events` to inspect the underlying event stream.

Disposition actions:

- `POST /api/admin/security/alerts/:id/acknowledge`
- `POST /api/admin/security/alerts/:id/silence`
- `POST /api/admin/security/alerts/:id/unsilence`

Recommended flow:

1. Confirm the alert source and severity.
2. Review recent samples and audit events.
3. Acknowledge when investigation has started.
4. Silence only when the signal is known/noisy and the silence window is bounded.
5. Unsilence when the condition is resolved or the window expires.

## Delivery Failure Triage

External security alert delivery failures surface as `security.alert.delivery_failed.spike`.

Check:

- `security.alert.dispatch` audit events
- `channel`
- `status`
- `statusCode`
- `error`

Triage order:

1. Confirm whether the alert is one channel or all channels.
2. Verify the configured webhook/email/slack environment variables.
3. Check whether failures are transient HTTP errors or request-time failures.
4. If the pipeline is noisy but healthy, acknowledge or silence the alert.
5. If the pipeline is broken, escalate to platform operations and keep the alert active.

## Scan History Archive Before Prune

Use `GET /api/media/scan-jobs/archive` to preview a cold-archive candidate manifest.
Use `POST /api/media/scan-jobs/archive` to write that manifest through the configured storage backend.
Use `POST /api/media/scan-jobs/sweep` only after the manifest has been persisted or reviewed.

Deletion boundary:

- keep `queued`
- keep `retrying`
- keep derived `timed_out`
- archive/prune inactive `completed` and `failed` jobs that exceed retention or per-asset limits

Recommended flow:

1. Preview the archive manifest.
2. Write the archive manifest to storage.
3. Confirm the candidate count and retention window.
4. Run the sweep.
5. Verify `media.scan.history_archived` and `media.scan.history_pruned` audit events.
6. Compare the archived candidate count with the `pruned` count.

## Suggested Metrics

Use the Admin Center Security tab operations overview or `GET /api/admin/operations/metrics?windowMinutes=60` for the current backend aggregate snapshot. The overview can show recent dispatch/archive/prune samples in place, generate handoff notes with remediation hints, export a server-generated JSON handoff snapshot through `GET /api/admin/operations/metrics/export`, jump to filtered dispatch/prune audit records, and write the scan history archive manifest when the operator has review permission. Snapshot exports record `admin.operations.metrics_exported` audit events so handoff packages are traceable; expanding that audit event shows the exported window, sample counts, hint count, and a shortcut back to the matching Security metrics window. The endpoints are intentionally lightweight and use the existing security event stream, audit events, and scan history archive manifest as sources of truth.

Security:

- `security_events_total{source,severity}`
- `security_alerts_total{type,state}`
- `security_alert_disposition_total{action}`
- `security_alert_delivery_failures_total{channel,status}`

Media scan:

- `media_scan_jobs_total{status,scanStatus}`
- `media_scan_archive_candidates_total`
- `media_scan_history_pruned_total`
- `media_scan_sweep_duration_ms`

Worker leases:

- `operation_lease_skipped_runs_total{key}`
- `operation_lease_renew_failures_total{key}`

Admin workflow:

- `admin_security_alert_ack_latency_ms`
- `admin_security_alert_silence_count`
- `admin_security_alert_unsilence_count`
- `admin_scan_archive_export_count`

The current API returns these as JSON aggregates for Admin dashboards or external polling. Dedicated Prometheus/OpenTelemetry emitters are still pending and can be layered on later without changing the underlying audit/security event sources.
