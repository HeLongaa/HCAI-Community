# Operations Runbook

This runbook covers the current phase 2 operational flows:

- production smoke checks
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

The smoke profile verifies managed auth secrets, S3 storage, webhook media scanning, scanner request/callback signing, media and security alert channels, secure cross-site cookie settings, trusted frontend origins, rate-limit/body-size/auth-failure guards, and external OAuth provider metadata.

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
- Keep manual sweep endpoints available for operator-triggered recovery and one-off maintenance.

Operational notes:

1. Scale API instances for request traffic.
2. Scale worker instances conservatively until distributed job leases are implemented.
3. Keep worker intervals long enough to avoid overlapping runs; each process also skips a job if the previous local run is still active.
4. If multiple workers are deployed before distributed leases are implemented, keep only one instance with mutating sweep jobs enabled.
5. Review `rate_limit.store_unavailable`, `media.scan.timeout`, and `task.submission.stale` audit/security events during worker incident triage.

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

Admin workflow:

- `admin_security_alert_ack_latency_ms`
- `admin_security_alert_silence_count`
- `admin_security_alert_unsilence_count`
- `admin_scan_archive_export_count`

The current API returns these as JSON aggregates for Admin dashboards or external polling. Dedicated Prometheus/OpenTelemetry emitters can be layered on later without changing the underlying audit/security event sources.
