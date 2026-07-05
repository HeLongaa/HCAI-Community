# Release Checklist

This checklist covers the current phase 2 API, auth, permissions, media operations, and deployment smoke surface.

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

- GitHub Actions `Quality Gates` workflow is passing for the target commit.
- `docs/GITHUB_ENVIRONMENT.md` required secrets and variables are configured for the selected GitHub Environment.
- `ACCESS_TOKEN_KEY_ID` matches the active signing secret rotation plan.
- `ACCESS_TOKEN_PREVIOUS_SECRETS` and `ACCESS_TOKEN_PREVIOUS_KEY_IDS` are set when rotating keys.
- `AUTH_TRUSTED_ORIGINS` includes all browser frontend origins that will use cookie refresh.
- `STORAGE_DRIVER=s3` and storage bucket/region/endpoint match the deployment.
- `MEDIA_SCAN_PROVIDER=webhook` has request URL, request signing, callback base URL, and callback signature settings.
- At least one media alert channel and one security alert channel are configured.
- OAuth redirect URIs match the deployed API callback URLs.

## Database And Migration

Before switching traffic:

1. Back up the target database.
2. Run Prisma migration in the deployment pipeline.
3. Run `npx prisma validate --schema ./prisma/schema.prisma` against the deployed code package.
4. Confirm seed/demo fallback is not accidentally being used when `DATABASE_URL` is expected.
5. Confirm `permissions` and `role_permissions` seed data are present for Prisma-backed role grants.

## Release Execution

Deploy order:

1. Deploy backend API.
2. Run backend health check: `GET /health`.
3. Run OpenAPI check: `GET /api/openapi.json`.
4. Deploy frontend.
5. Confirm frontend can reach the API origin with credentialed requests when cookie auth is enabled.

Critical API smoke checks:

- `GET /api/auth/oauth/providers`
- `POST /api/auth/login`
- `POST /api/auth/refresh` with CSRF header and cookie credentials
- `GET /api/me`
- `GET /api/tasks`
- `GET /api/posts`
- `GET /api/notifications`
- `GET /api/admin/permissions` with an audit-authorized operator
- `GET /api/admin/operations/metrics?windowMinutes=60`
- `GET /api/media/governance-config`
- `GET /api/media/scan-jobs/archive`

## Post-Release Operations

Within the first operator review window:

1. Open Admin Center Security tab.
2. Confirm operations metrics load for 15m and 60m windows.
3. Export an operations metrics snapshot.
4. Confirm `admin.operations.metrics_exported` appears in Audit log.
5. Expand the audit event and reopen the matching metrics window.
6. Review security alert delivery failures.
7. Review media alert delivery failures.
8. Preview scan history archive candidates.
9. If candidates exist, write the archive before any pruning workflow.

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
- Error rate, latency, or 5xx responses exceed the deployment threshold.

## Rollback Steps

1. Stop traffic shift to the new release.
2. Restore the previous backend package.
3. Restore the previous frontend package.
4. Revert environment variable changes, especially token key ids, cookie settings, scanner secrets, and storage endpoints.
5. If migrations are not backward-compatible, follow the database rollback plan prepared before release.
6. Run `npm run smoke:production:env` against the restored environment.
7. Confirm `GET /health`, login/refresh, and Admin operations metrics are healthy.
8. Record the incident and attach relevant audit exports or operations snapshot artifacts.
