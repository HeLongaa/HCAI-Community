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

- `npm run test:production-release-evidence` passes and the production request/deploy binding has not drifted.
- The six-role production evidence bundle verifies against the exact source commit, candidate artifact SHA-256, and rollback artifact SHA-256 selected for this release.
- Six different evidence owners, key ids, and Ed25519 public keys are present; no attestation is expired or older than seven days.
- Admin Release Control request and deployment both use the same verified bundle receipt. A fixture bundle is never accepted as production approval.

- `npm run test:v1-scope` passes and the scope manifest matches `docs/V1_SCOPE_AND_DEFINITION_OF_DONE.md`.
- `npm run test:v1-surfaces`, `npm run test:v1-production-fallbacks`, and the post-build `npm run test:v1-production-bundle` pass; every inventoried fallback blocker is closed and `fallbackDispositionComplete=true` remains evidence-backed. Do not interpret this scoped status as global production approval.
- `npm run test:v1-compliance` passes, the final legal entity/jurisdiction are recorded, qualified legal review is approved, and the published versions match the consent gate. The current engineering draft intentionally does not satisfy this release condition.
- No RMB payment, withdrawal/payout, KYC, invoice, tax-settlement, or merchant-settlement route or schema is present.
- Internal points, creative credits, quota, escrow, compensation, and refunds are not represented as withdrawable money.
- GitHub Actions `Quality Gates` workflow is passing for the target commit.
- `npm run check:production-containers` passes for the exact candidate source.
- `npm run rehearse:production-containers` passes, including migrations, no-demo production seed, Worker jobs, read-only runtime, and SIGTERM drain.
- GitHub Actions `Container Supply Chain` passes for the exact candidate commit and publishes four GHCR images by digest.
- The aggregate `production-image-digest-manifest-v1` has `registryReady=true`, the approved `sourceRevision`, frontend/API/Worker/migration OCI index digests, and exact `linux/amd64` plus `linux/arm64` platform manifest digests for every image.
- Each image has matching SPDX and CycloneDX SBOM evidence, zero unexcepted fixable `HIGH/CRITICAL` findings, and a non-EOL operating system.
- OCI index provenance and both platform-specific SPDX SBOM attestations pass `gh attestation verify` through the GitHub API and OCI registry for every exact digest.
- Any active vulnerability exception identifies the exact CVE/package/image/version, has release approval, and expires within 30 days; expired or blanket ignores are prohibited.
- The multi-instance deployment profile in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` has been reviewed for the target environment.
- `docs/GITHUB_ENVIRONMENT.md` required secrets and variables are configured for the selected GitHub Environment.
- `ACCESS_TOKEN_KEY_ID` matches the active signing secret rotation plan.
- `ACCESS_TOKEN_PREVIOUS_SECRETS` and `ACCESS_TOKEN_PREVIOUS_KEY_IDS` are set when rotating keys.
- `docs/PRODUCTION_SECRET_LIFECYCLE.md` is complete for the target: external HA/managed Vault, KMS/HSM auto-unseal, audited restore evidence, certificate workload identity, renewable Agent token, and least-privilege policy receipts are attached. A confirmation variable without those receipts is not sufficient.
- `npm run test:secret-lifecycle-dr` passes and the latest Staging isolated-Raft restore receipt is attached as engineering evidence. Its production-control flags must remain `false`; it cannot replace the target HA/KMS/off-host backup and audit receipts required above.
- `AUTH_TRUSTED_ORIGINS` includes all browser frontend origins that will use cookie refresh.
- `STORAGE_DRIVER=s3` and storage bucket/region/endpoint match the deployment.
- Upload/download/scanner TTLs are bounded, and private CDN URL/secret/key ID are configured together when CDN delivery is enabled.
- Media ingestion is fail-closed: `MEDIA_SCAN_PROVIDER=webhook` has request URL, signing, callback, and alert settings, or `MEDIA_SCAN_PROVIDER=manual` deliberately keeps every unreviewed asset quarantined and unavailable.
- `MEDIA_STORAGE_CLEANUP_WORKER_ENABLED=true` is set on workers with the approved retention days and bounded batch size.
- `RATE_LIMIT_STORE=redis` and `RATE_LIMIT_REDIS_URL` are configured for multi-instance API deployments.
- `METRICS_EXPORTER_ENABLED` and `METRICS_EXPORTER_TOKEN` match the monitoring deployment plan.
- `API_EMBEDDED_WORKERS_ENABLED=false` is set on API instances.
- Worker processes have explicit job flags and lease settings.
- At least one media scanner alert channel is configured in webhook mode, and at least one security alert channel is always configured.
- `OAUTH_CALLBACK_ORIGIN` matches the deployed API, every OAuth redirect uses that origin, and
  `OAUTH_BROWSER_RETURN_ORIGIN` is the product frontend origin included in `AUTH_TRUSTED_ORIGINS`.
- Durable notification email uses a real HTTPS relay, a dedicated HMAC secret of at least 32 characters, an approved
  sender, required Provider message receipts, and a successful target-environment canary receipt.
- `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=false`; no production release may register the staging Provider HTTP client.
- `CREATIVE_PROVIDER_CALLBACK_ENABLED=false`; no production release may expose the staging Provider callback intake.
- `CREATIVE_PROVIDER_POLLING_ENABLED=false` and `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED=false`; no production release may perform staging Provider status reads.

## Database And Migration

Before the first target-environment release, complete the isolated infrastructure rehearsal described in `docs/RELEASE_INFRASTRUCTURE_REHEARSAL.md`:

```bash
npm run release:infrastructure:preflight
npm run release:infrastructure:rehearse:env
```

Both database names must contain `rehearsal` and must differ. Attach the sanitized SHA-256-bound evidence receipt to the release change. Local Docker evidence is useful engineering proof but does not replace this target-environment receipt.

Before the first target-environment application release, complete the protected staging candidate/rollback rehearsal:

```bash
npm run release:application:preflight
npm run release:application:rehearse:env
```

Attach the `RELEASE-02` receipt proving the exact candidate artifact was served, the previous artifact was restored, and
both phases passed the same liveness, dependency-readiness, OpenAPI, public policy, and authentication-rejection smoke. The local fixture
rehearsal is not a deployment receipt.

Before switching traffic:

1. Back up the target database.
2. Run Prisma migration in the deployment pipeline.
3. Run `npx prisma validate --schema ./prisma/schema.prisma` against the deployed code package.
4. Confirm seed/demo fallback is not accidentally being used when `DATABASE_URL` is expected.
5. Confirm `permissions` and `role_permissions` seed data are present for Prisma-backed role grants.

## Release Execution

Deploy order:

1. Resolve no tags. Load the approved four-image digest manifest and verify its signed attestations.
2. Apply database migrations using the approved migration digest.
3. Deploy backend API with embedded workers disabled using the approved API digest.
4. Run backend liveness check: `GET /health`.
5. Run dependency readiness check: `GET /ready`; require `data.status=ready` before traffic.
6. Run OpenAPI check: `GET /api/openapi.json`.
7. Deploy the approved Worker digest with explicit job flags.
8. Deploy the approved frontend digest.
9. Confirm frontend can reach the API origin with credentialed requests when cookie auth is enabled.

Critical API smoke checks:

- `GET /api/auth/oauth/providers`
- Confirm every unconfigured OAuth provider is reported as `mode=unavailable`, `available=false`, with no authorization URL.
- Do not invoke a real OAuth start/callback flow without the separately recorded Provider approval and staging run window.
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
8. Confirm `GET /health`, `GET /ready`, login/refresh, worker logs, and Admin operations metrics are healthy.
9. Record the incident and attach relevant audit exports or operations snapshot artifacts.
