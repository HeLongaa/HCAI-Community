# Operations Runbook

This runbook covers the current operational flows:

- production smoke checks
- API and worker process topology
- shared rate-limit state
- distributed worker job leases
- security alert disposition
- security alert delivery failure triage
- scan history archive before prune

For the complete multi-instance deployment sequence, environment profile, staging rehearsal, and rollback boundary, start with `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md`.

## Production Smoke Checks

Use the quality gate tiers in `docs/QUALITY_GATES.md`:

- `npm run check:quick` for local handoff.
- `npm run check:pr` before merge.
- `npm run test:observability-search` after changes to HTTP telemetry, Trace propagation, Admin observability, SLOs, alerts, redaction, or observability persistence.

## Logs, Traces, And SLO Alerts

Use the Admin **Observability** tab for bounded sanitized log search, request and Trace drill-down, verifiable export, SLO evaluation, and alert disposition. Follow `docs/OBSERVABILITY_SEARCH_AND_TRACE.md`; an `unverifiable` SLO result is an operational failure requiring telemetry recovery, never a healthy state.
- `npm run check:deploy` before deployment with a safe fixture smoke profile.
- `npm run check:deploy:env` in the deployment environment.

Run `npm run smoke:production` in CI to validate the managed production checklist against the safe fixture profile. Run `npm run smoke:production:env` in a deployment environment to validate the real environment without printing secrets.

The smoke profile verifies managed auth secrets, S3 storage, webhook media scanning, scanner request/callback signing, media and security alert channels, secure cross-site cookie settings, trusted frontend origins, rate-limit/body-size/auth-failure guards, worker lease settings, and external OAuth provider metadata.
It also verifies the Prometheus-compatible metrics exporter when `METRICS_EXPORTER_ENABLED=true`.

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
- `MEDIA_STORAGE_CLEANUP_WORKER_ENABLED=true` on worker instances so due `cleanup_pending` objects are physically deleted.
- `MEDIA_STORAGE_CLEANUP_WORKER_INTERVAL_SECONDS=300`, `MEDIA_STORAGE_CLEANUP_BATCH_SIZE=25`, and `MEDIA_STORAGE_CLEANUP_RETENTION_DAYS=30` unless the approved retention policy says otherwise.
- `TASK_STALE_SUBMISSION_WORKER_ENABLED=true` on worker instances when overdue task-review submissions should be marked stale automatically.
- `WORKER_LEASE_TTL_SECONDS=300` unless a deployment needs a longer stale-worker recovery window.
- `WORKER_LEASE_RENEW_INTERVAL_SECONDS=60`; this must stay below the lease TTL.
- Keep manual sweep endpoints available for operator-triggered recovery and one-off maintenance.

Operational notes:

1. Scale API instances for request traffic.
2. Scale worker instances separately from API instances.
3. Keep worker intervals long enough for normal job duration; each process also skips a job if the previous local run is still active.
4. Mutating jobs use durable operation leases when `DATABASE_URL` is configured, so multiple worker instances can be deployed safely.
5. Review `rate_limit.store_unavailable`, `operations.lease.skipped`, `operations.lease.renew_failed`, `media.scan.timeout`, `media.storage.cleanup_failed`, and `task.submission.stale` audit/security events during worker incident triage.
6. Use `POST /api/admin/media/storage/cleanup` for a bounded operator rerun after fixing storage access; never bypass retention by deleting bucket objects directly.

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
Use `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` as the deployment topology entry point before scaling API or worker process counts.

## Domain Event Publication Triage

Use `GET /api/admin/domain-events` with `status=failed` or `status=claimed` to inspect safe publication evidence. Never edit `domain_event_outbox`: it is the immutable fact. A stale `claimed` row becomes claimable after `claim_expires_at`; do not clear tokens manually while a worker may still be active.

For a confirmed recoverable `published` or `failed` event, an operator with `admin:events:replay` may call `POST /api/admin/domain-events/:id/replay` with a stable reason code. Replay moves only the publication row to `pending` and writes audit evidence. EVENT-01 has no consumer Inbox, automatic retry policy, DLQ, ordering, or compensation; if downstream side effects are uncertain, stop and escalate instead of replaying repeatedly.

Triage order:

1. Inspect event type/version, aggregate, correlation, attempts, claim expiry, and bounded last error code.
2. Confirm the registered publisher/consumer deployment understands that exact version.
3. Confirm the original aggregate state and whether any downstream side effect already occurred.
4. Replay once with an incident or operator reason code, then observe publication state.
5. Preserve event, publication, and audit identifiers in the incident record.

## Unified Job Runtime Triage

Use `GET /api/admin/jobs/runs` to filter by definition, status, owner, or correlation. `GET /api/admin/jobs/runs/:id` shows safe input/result, attempts, worker, heartbeat, timeout, cancellation, and terminal evidence. Secret-like keys, prompts, Provider payloads, URLs, tokens, and credentials are deliberately absent.

Queued jobs may be cancelled immediately with `POST /api/admin/jobs/runs/:id/cancel`. Running cancellation is cooperative: the API records `cancel_requested_at`, and only the worker holding the matching attempt lease may acknowledge the terminal `cancelled` transition. A cancellation request does not forcibly interrupt a handler. Timed-out attempts reject late completion.

JOB-01 exposes no arbitrary execution, retry, DLQ, Cron, pause/resume, or manual rerun action. Do not mutate job rows to simulate those features; they require JOB-02 policy and audit controls.

## External Metrics Exporter

Enable the Prometheus-compatible scrape endpoint with:

- `METRICS_EXPORTER_ENABLED=true`
- `METRICS_EXPORTER_FORMAT=prometheus`
- `METRICS_EXPORTER_TOKEN=<secret>` when the route is exposed beyond private network boundaries

Scrape:

```bash
curl -H "Authorization: Bearer $METRICS_EXPORTER_TOKEN" https://api.example.com/metrics
```

The exporter reuses the Admin operations metrics source and emits a safe subset of labels. Unknown or unsafe label values are folded into `other`, so user input, raw request paths, tokens, emails, and raw metadata are not exported as label values.

Initial metric families include:

- `newchat_security_events_window_total`
- `newchat_security_events_by_source_total`
- `newchat_rate_limit_exceeded_total`
- `newchat_rate_limit_exceeded_by_bucket_total`
- `newchat_security_alerts_total`
- `newchat_security_alert_delivery_failures_total`
- `newchat_media_scan_archive_candidates_total`
- `newchat_media_scan_history_pruned_jobs_total`
- `newchat_operation_lease_skipped_runs_total`
- `newchat_operation_lease_renew_failures_total`

Future creative provider cost metrics are planned in `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md`. They should use low-cardinality labels only and must not expose generation ids, provider job ids, prompt hashes, raw error text, or user ids as labels.

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

Creative provider budget and spend signals:

- `newchat_creative_provider_budget_alerts_total`
- `newchat_creative_provider_budget_alerts_by_severity_total{severity}`
- `newchat_creative_provider_budget_alerts_by_provider_total{provider}`
- `newchat_creative_provider_budget_alerts_by_workspace_total{workspace}`
- `newchat_creative_provider_budget_alerts_by_threshold_total{threshold}`
- `newchat_creative_provider_budget_dispatch_blocked_total`
- `newchat_creative_provider_budget_dispatch_blocked_by_severity_total{severity}`
- `newchat_creative_provider_budget_dispatch_blocked_by_provider_total{provider}`
- `newchat_creative_provider_budget_dispatch_blocked_by_workspace_total{workspace}`
- `newchat_creative_provider_budget_dispatch_blocked_by_reason_total{reason}`
- `newchat_creative_provider_cost_anomalies_total`
- `newchat_creative_provider_cost_anomalies_by_severity_total{severity}`
- `newchat_creative_provider_cost_anomalies_by_provider_total{provider}`
- `newchat_creative_provider_cost_anomalies_by_workspace_total{workspace}`
- `newchat_creative_provider_cost_anomalies_by_reason_total{reason}`
- `newchat_creative_provider_cost_estimated_total{currency,confidence}`
- `newchat_creative_provider_cost_actual_total{currency,confidence}`
- `newchat_creative_provider_cost_projected_total{currency,confidence}`
- `newchat_creative_provider_cost_observations_by_currency_total{currency}`

Creative provider exporter labels are derived from Admin operations metrics, not raw provider payloads. Provider job ids, generation ids, prompt hashes, media asset ids, raw URLs, raw error text, model versions, and tokens must not appear in labels.

V1-13 adds `newchat_creative_provider_lifecycle_*` metrics for bounded event, family, status, source, provider, workspace, severity, and category dimensions. Admin handoff exports include safe drill-down samples and remediation hints for retry exhaustion, polling timeout, output ingestion failure, and cost reconciliation. Do not add generation ids, Provider job ids, source keys, failure hashes, policy hashes, or URLs as labels.

Admin workflow:

- `admin_security_alert_ack_latency_ms`
- `admin_security_alert_silence_count`
- `admin_security_alert_unsilence_count`
- `admin_scan_archive_export_count`

The Admin API returns these as JSON aggregates for Admin dashboards or external polling. The Prometheus-compatible `/metrics` endpoint exposes the safe external subset for scrapers when `METRICS_EXPORTER_ENABLED=true`; OpenTelemetry export remains a later integration layer.
