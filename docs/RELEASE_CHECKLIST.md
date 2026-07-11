# Release Checklist

This checklist covers the current API, auth, permissions, media operations, worker, shared-state, and deployment smoke surface.
Use `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` as the topology-level companion when releasing a multi-instance environment.

## Pre-Release

Run the deployment gate:

```bash
npm run check:deploy
```

For the target deployment environment, run:

```bash
npm run check:deploy:env
```

Confirm:

- `npm run test:v1-scope` passes and the scope manifest matches `docs/V1_SCOPE_AND_DEFINITION_OF_DONE.md`.
- `npm run test:v1-surfaces` passes, every inventoried release blocker is closed, and `productionReady` can be set only by the V1-39 gate.
- `npm run test:v1-compliance` passes, the final legal entity/jurisdiction are recorded, qualified legal review is approved, and the published versions match the consent gate. The current engineering draft intentionally does not satisfy this release condition.
- No RMB payment, withdrawal/payout, KYC, invoice, tax-settlement, or merchant-settlement route or schema is present.
- Internal points, creative credits, quota, escrow, compensation, and refunds are not represented as withdrawable money.
- GitHub Actions `Quality Gates` workflow is passing for the target commit.
- The multi-instance deployment profile in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` has been reviewed for the target environment.
- `docs/GITHUB_ENVIRONMENT.md` required secrets and variables are configured for the selected GitHub Environment.
- `ACCESS_TOKEN_KEY_ID` matches the active signing secret rotation plan.
- `ACCESS_TOKEN_PREVIOUS_SECRETS` and `ACCESS_TOKEN_PREVIOUS_KEY_IDS` are set when rotating keys.
- `AUTH_TRUSTED_ORIGINS` includes all browser frontend origins that will use cookie refresh.
- `STORAGE_DRIVER=s3` and storage bucket/region/endpoint match the deployment.
- `MEDIA_SCAN_PROVIDER=webhook` has request URL, request signing, callback base URL, and callback signature settings.
- `RATE_LIMIT_STORE=redis` and `RATE_LIMIT_REDIS_URL` are configured for multi-instance API deployments.
- `METRICS_EXPORTER_ENABLED` and `METRICS_EXPORTER_TOKEN` match the monitoring deployment plan.
- `API_EMBEDDED_WORKERS_ENABLED=false` is set on API instances.
- Worker processes have explicit job flags and lease settings.
- At least one media alert channel and one security alert channel are configured.
- OAuth redirect URIs match the deployed API callback URLs.
- `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=false`; no production release may register the staging Provider HTTP client.
- `CREATIVE_PROVIDER_CALLBACK_ENABLED=false`; no production release may expose the staging Provider callback intake.
- `CREATIVE_PROVIDER_POLLING_ENABLED=false` and `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED=false`; no production release may perform staging Provider status reads.

## Database And Migration

Before switching traffic:

1. Back up the target database.
2. Run Prisma migration in the deployment pipeline.
3. Run `npx prisma validate --schema ./prisma/schema.prisma` against the deployed code package.
4. Confirm seed/demo fallback is not accidentally being used when `DATABASE_URL` is expected.
5. Confirm `permissions` and `role_permissions` seed data are present for Prisma-backed role grants.

## Release Execution

Deploy order:

1. Apply database migrations.
2. Deploy backend API with embedded workers disabled.
3. Run backend health check: `GET /health`.
4. Run OpenAPI check: `GET /api/openapi.json`.
5. Deploy worker process type with explicit job flags.
6. Deploy frontend.
7. Confirm frontend can reach the API origin with credentialed requests when cookie auth is enabled.

Critical API smoke checks:

- `GET /api/auth/oauth/providers`
- `POST /api/auth/login`
- `POST /api/auth/refresh` with CSRF header and cookie credentials
- `GET /api/me`
- `GET /api/compliance/policies`
- `GET /api/compliance/consent` with an authenticated account
- `POST /api/support/requests` with a non-production rehearsal account, followed by owner-scoped retrieval
- `GET /api/tasks`
- `GET /api/posts`
- `GET /api/notifications`
- `GET /api/admin/permissions` with an audit-authorized operator
- `GET /api/admin/operations/metrics?windowMinutes=60`
- `GET /api/media/governance-config`
- `GET /api/media/scan-jobs/archive`
- `GET /metrics` with the configured metrics exporter token when the exporter is enabled

Worker checks:

- Confirm worker logs show enabled jobs.
- Confirm at least one operation lease can be acquired and released during a worker run.
- Confirm `operations.leases.skippedRuns` is low or explainable when multiple workers are running.
- Confirm the staging rehearsal from `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` has been completed before the first multi-instance production rollout.

## Post-Release Operations

Within the first operator review window:

1. Open Admin Center Security tab.
2. Confirm operations metrics load for 15m and 60m windows.
3. Export an operations metrics snapshot.
4. Confirm `admin.operations.metrics_exported` appears in Audit log.
5. Expand the audit event and reopen the matching metrics window.
6. Review worker lease skipped runs and renewal failures.
7. Review security alert delivery failures.
8. Review media alert delivery failures.
9. Confirm the external monitoring system can scrape `/metrics`.
10. Preview scan history archive candidates.
11. If candidates exist, write the archive before any pruning workflow.

## Alert Channel Verification

Security alerts:

- Trigger or inspect `security.alert.dispatch` audit events.
- Confirm webhook/Slack/email delivery metadata has expected channel names and statuses.
- Confirm repeated failures surface as `security.alert.delivery_failed.spike`.

Media alerts:

- Trigger or inspect `media.scan.alert.dispatch` audit events.
- Confirm webhook/Slack/email delivery metadata has expected channel names and statuses.
- Confirm repeated failures surface as `media.scan.alert_delivery_failed.spike`.

If any channel is intentionally disabled, record that decision in the deployment notes.

## Rollback Triggers

Rollback or pause rollout when any of these occur:

- Login, refresh, or OAuth callback failures affect normal users.
- CSRF or trusted-origin errors block the configured frontend origin.
- Prisma migration fails or role permission seed data is missing.
- Media upload signing fails for clean test uploads.
- Scanner callbacks are rejected because shared secret or HMAC settings are mismatched.
- Security or media alert channels fail across all configured delivery paths.
- Admin operations metrics endpoint fails or audit export cannot be generated.
- Redis rate-limit store is unavailable and the selected failure policy does not match the deployment risk posture.
- `/metrics` is exposed without token or network protection in an environment that requires authenticated scraping.
- Worker leases show persistent renew failures or stale holders that prevent recurring maintenance.
- Error rate, latency, or 5xx responses exceed the deployment threshold.

## Rollback Steps

1. Stop traffic shift to the new release.
2. Restore the previous backend package.
3. Restore the previous frontend package.
4. Revert environment variable changes, especially token key ids, cookie settings, scanner secrets, storage endpoints, Redis settings, and worker flags.
5. If migrations are not backward-compatible, follow the database rollback plan prepared before release.
6. Scale worker processes down to one instance or disable mutating job flags if the incident involves leases.
7. Run `npm run smoke:production:env` against the restored environment.
8. Confirm `GET /health`, login/refresh, worker logs, and Admin operations metrics are healthy.
9. Record the incident and attach relevant audit exports or operations snapshot artifacts.
