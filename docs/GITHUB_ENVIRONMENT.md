# GitHub Environment Configuration

This checklist is for the `deployment-env-smoke` job in `.github/workflows/quality-gates.yml`.

Use GitHub **Secrets** for credentials, signing secrets, tokens, private keys, and webhook URLs that grant access. Use GitHub **Variables** for non-secret ids, domains, public URLs, feature flags, thresholds, and counts.

For the deployment sequence, process topology, staging rehearsal, and rollback boundary that use these values, see `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md`.

## Required Secrets

At least one auth secret is required:

| Name | Required | Notes |
| --- | --- | --- |
| `ACCESS_TOKEN_SECRET` | Yes, unless `SESSION_SECRET` is set | Must be at least 32 characters in production |
| `SESSION_SECRET` | Alternative | Backward-compatible fallback for access token signing |

Chat message encryption secret:

| Name | Required | Notes |
| --- | --- | --- |
| `CHAT_MESSAGE_ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte AES-256-GCM key. Keep the previous key in `CHAT_MESSAGE_ENCRYPTION_KEYS` during rotation until all retained messages have been re-encrypted or expired. |

Object storage secrets for managed S3 mode:

| Name | Required | Notes |
| --- | --- | --- |
| `STORAGE_ACCESS_KEY_ID` | Yes | S3-compatible access key |
| `STORAGE_SECRET_ACCESS_KEY` | Yes | S3-compatible secret |
| `STORAGE_SESSION_TOKEN` | Optional | Only for temporary credentials |
| `STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET` | Required for private CDN | HMAC signing secret paired with `STORAGE_PRIVATE_DOWNLOAD_BASE_URL` |

Media scanner secrets:

| Name | Required | Notes |
| --- | --- | --- |
| `MEDIA_SCAN_WEBHOOK_SECRET` | Yes | Required when `MEDIA_SCAN_PROVIDER=webhook` |
| `MEDIA_SCAN_REQUEST_SECRET` | Yes for managed smoke | Signs outbound scanner requests |
| `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET` | Recommended | Dedicated callback HMAC secret; request secret can satisfy the smoke fallback |

Creative provider staging preflight secret:

| Name | Required When | Notes |
| --- | --- | --- |
| `CREATIVE_STAGING_PROVIDER_API_TOKEN` | Staging preflight or guarded HTTP client | Store only in a dedicated staging environment. Presence alone never enables a Provider call. |
| `CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET` | Staging callback API or callback-api smoke | Minimum 32 characters; shared only with the approved staging ingress. Never store it as a variable. |

OAuth provider secrets. Configure at least one external provider:

| Name | Required When | Notes |
| --- | --- | --- |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth enabled | Paired with Google client id/redirect variables |
| `OAUTH_DISCORD_CLIENT_SECRET` | Discord OAuth enabled | Paired with Discord client id/redirect variables |
| `OAUTH_APPLE_PRIVATE_KEY` | Apple OAuth enabled | PEM private key, escaped as needed by GitHub Secrets |

## Required Variables

Production/browser auth:

| Name | Required | Example |
| --- | --- | --- |
| `AUTH_COOKIE_SAMESITE` | Recommended | `None` for split frontend/API deployments |
| `AUTH_COOKIE_SECURE` | Recommended | `true` |
| `AUTH_COOKIE_DOMAIN` | Optional | `.example.com` |
| `AUTH_TRUSTED_ORIGINS` | Yes | `https://app.example.com,https://admin.example.com` |
| `CORS_ALLOWED_ORIGINS` | Alternative | Used when `AUTH_TRUSTED_ORIGINS` is omitted |

Object storage:

| Name | Required | Example |
| --- | --- | --- |
| `STORAGE_DRIVER` | Yes | `s3` |
| `STORAGE_ENDPOINT` | Yes | `https://s3.amazonaws.com` |
| `STORAGE_REGION` | Yes | `us-east-1` |
| `STORAGE_BUCKET` | Yes | `hcai-media-prod` |
| `STORAGE_UPLOAD_TTL_SECONDS` | Yes | `900` |
| `STORAGE_DOWNLOAD_TTL_SECONDS` | Yes | `300` |
| `STORAGE_SCANNER_READ_TTL_SECONDS` | Yes | `600` |
| `STORAGE_PRIVATE_DOWNLOAD_BASE_URL` | Optional | `https://media.example.com` |
| `STORAGE_PRIVATE_DOWNLOAD_KEY_ID` | Optional | `2026-07` |

Media scanner:

| Name | Required | Example |
| --- | --- | --- |
| `MEDIA_SCAN_PROVIDER` | Yes | `webhook` |
| `MEDIA_SCAN_REQUEST_ADAPTER` | Yes | `generic-webhook` or `clamav-http` |
| `MEDIA_SCAN_REQUEST_URL` | Yes for managed smoke | `https://scanner.example.com/jobs` |
| `MEDIA_SCAN_CALLBACK_BASE_URL` | Yes | `https://api.example.com` |

OAuth provider variables. Configure at least one provider:

| Provider | Variables |
| --- | --- |
| Google | `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_REDIRECT_URI` |
| Discord | `OAUTH_DISCORD_CLIENT_ID`, `OAUTH_DISCORD_REDIRECT_URI` |
| Apple | `OAUTH_APPLE_CLIENT_ID`, `OAUTH_APPLE_TEAM_ID`, `OAUTH_APPLE_KEY_ID`, `OAUTH_APPLE_REDIRECT_URI` |

Every redirect URI must use HTTPS and exactly end at `/api/auth/oauth/{provider}/callback`. Production never falls back
to a dev callback when a provider is missing or invalid. Set `OAUTH_DEV_MODE=disabled` as defense in depth and optionally
set `OAUTH_PROVIDER_TIMEOUT_MS` between `1000` and `15000` (default `8000`). Real credentials and staging callbacks still
require explicit Provider approval; configuring GitHub variables alone is not approval.

Creative provider preflight variables:

| Name | Required When | Example |
| --- | --- | --- |
| `CREATIVE_PROVIDER_MODE` | Recommended | `mock` for CI/local; `disabled` for staging preflight |
| `CREATIVE_PROVIDER_RUNTIME_ENV` | Staging provider preflight | `staging` |
| `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED` | Staging provider preflight | `true` |
| `CREATIVE_STAGING_IMAGE_PROVIDER` | Staging provider preflight | `replicate` |
| `CREATIVE_STAGING_PROVIDER_CONFIRMATION` | Staging provider preflight | `staging-only` |
| `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED` | Guarded V1-05 client construction | `false` by default; exact `true` is accepted only with production-parity staging and `replicate_staging` mode |
| `CREATIVE_PROVIDER_CALLBACK_ENABLED` | Guarded V1-06 callback intake | `false` by default; exact `true` is accepted only with production-parity staging, Replicate, and `staging-only` confirmation |
| `CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS` | Optional callback bound | `300` |
| `CREATIVE_PROVIDER_CALLBACK_MAX_BYTES` | Optional callback bound | `262144` |
| `CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_LEASE_SECONDS` | Optional callback concurrency bound | `60` |
| `CREATIVE_PROVIDER_POLLING_ENABLED` | Guarded V1-07 lifecycle polling | `false` by default; requires the guarded HTTP client and production-parity staging |
| `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED` | Dedicated V1-07 worker startup | `false` by default; requires lifecycle polling to be enabled |
| `CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS` | Optional timeout bound | `3600` |
| `CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS` | Optional polling lease bound | `300` |
| `CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS` | Optional status-read cadence | `60`, and lower than maximum age |
| `CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT` | Optional oldest-first sweep cap | `10` |
| `CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION` | Optional accounting prerequisite | `false` |

Chat encryption and retention variables:

| Name | Required | Example |
| --- | --- | --- |
| `CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID` | Yes | `v1`; identifies the key used for new ciphertext |
| `CHAT_MESSAGE_ENCRYPTION_KEYS` | During key rotation | `v1:<base64-key>,v2:<base64-key>`; store this value as a secret when used |
| `CHAT_RETENTION_WORKER_ENABLED` | Yes for the worker process | `true` |
| `CHAT_RETENTION_WORKER_INTERVAL_SECONDS` | Recommended | `3600` |
| `CHAT_RETENTION_SWEEP_LIMIT` | Recommended | `100` |

Production environments must not set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true`,
`CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=true`, `CREATIVE_PROVIDER_CALLBACK_ENABLED=true`,
`CREATIVE_PROVIDER_POLLING_ENABLED=true`, `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED=true`, or
`CREATIVE_STAGING_PROVIDER_API_TOKEN`.

## Alert Channel Configuration

The managed smoke requires at least one media alert channel and one security alert channel.

Media alert channel variables/secrets:

| Channel | Variables | Secrets |
| --- | --- | --- |
| Webhook | `MEDIA_SCAN_ALERT_WEBHOOK_URL` | `MEDIA_SCAN_ALERT_WEBHOOK_SECRET` optional/recommended |
| Slack | none | `MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL` |
| Email webhook | `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_EMAIL_TO`, `MEDIA_SCAN_ALERT_EMAIL_FROM` optional | `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET` optional/recommended |

Security alert channel variables/secrets:

| Channel | Variables | Secrets |
| --- | --- | --- |
| Webhook | `SECURITY_ALERT_WEBHOOK_URL` | `SECURITY_ALERT_WEBHOOK_SECRET` optional/recommended |
| Slack | none | `SECURITY_ALERT_SLACK_WEBHOOK_URL` |
| Email webhook | `SECURITY_ALERT_EMAIL_WEBHOOK_URL`, `SECURITY_ALERT_EMAIL_TO`, `SECURITY_ALERT_EMAIL_FROM` optional | `SECURITY_ALERT_EMAIL_WEBHOOK_SECRET` optional/recommended |

Creative provider budget alert variables/secrets:

These are parsed and exposed only through safe config summaries for provider budget alert readiness. Production smoke gates channel presence only when `CREATIVE_PROVIDER_ALERTS_ENABLED=true`. External provider budget alert delivery is still inactive: no Slack, webhook, or email message is sent until a later explicitly approved delivery implementation wires dispatch audit events and outbound clients.

| Channel | Variables | Secrets |
| --- | --- | --- |
| Master switch | `CREATIVE_PROVIDER_ALERTS_ENABLED=false`, `CREATIVE_PROVIDER_ALERT_CHANNELS`, `CREATIVE_PROVIDER_ALERT_WINDOW_MINUTES`, `CREATIVE_PROVIDER_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD` | none |
| Webhook | `CREATIVE_PROVIDER_ALERT_WEBHOOK_URL`, `CREATIVE_PROVIDER_ALERT_WEBHOOK_TIMEOUT_SECONDS` | `CREATIVE_PROVIDER_ALERT_WEBHOOK_SECRET` optional/recommended |
| Slack | `CREATIVE_PROVIDER_ALERT_SLACK_TIMEOUT_SECONDS` | `CREATIVE_PROVIDER_ALERT_SLACK_WEBHOOK_URL` |
| Email webhook | `CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL`, `CREATIVE_PROVIDER_ALERT_EMAIL_TO`, `CREATIVE_PROVIDER_ALERT_EMAIL_FROM`, `CREATIVE_PROVIDER_ALERT_EMAIL_TIMEOUT_SECONDS` | `CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_SECRET` optional/recommended |

Do not reuse `MEDIA_SCAN_ALERT_*` or `SECURITY_ALERT_*` secrets for creative provider budget alerts.

## Guard Rail Variables

These have code defaults, but setting them explicitly makes production behavior reviewable:

| Name | Suggested Value |
| --- | --- |
| `RATE_LIMIT_ENABLED` | `true` |
| `RATE_LIMIT_STORE` | `redis` for multi-instance deployments; `memory` only for single-instance/local deployments |
| `RATE_LIMIT_REDIS_PREFIX` | Key prefix such as `newchat:prod:limits` |
| `RATE_LIMIT_REDIS_TIMEOUT_MS` | `500` or deployment-specific |
| `RATE_LIMIT_REDIS_FAILURE_MODE` | `fail_closed` for stricter managed deployments; `fail_open` only with external gateway protection |
| `RATE_LIMIT_WINDOW_MS` | `60000` |
| `RATE_LIMIT_AUTH_MAX` | deployment-specific |
| `RATE_LIMIT_UPLOAD_MAX` | deployment-specific |
| `RATE_LIMIT_ADMIN_MUTATION_MAX` | deployment-specific |
| `METRICS_EXPORTER_ENABLED` | `true` when Prometheus-compatible scrape is required |
| `METRICS_EXPORTER_FORMAT` | `prometheus` |
| `REQUEST_BODY_SIZE_GUARD_ENABLED` | `true` |
| `REQUEST_BODY_MAX_BYTES` | deployment-specific |
| `AUTH_FAILURE_MONITOR_ENABLED` | `true` |
| `AUTH_FAILURE_WINDOW_MS` | `300000` |
| `AUTH_FAILURE_IP_ACCOUNT_THRESHOLD` | deployment-specific |
| `AUTH_FAILURE_ACCOUNT_IP_THRESHOLD` | deployment-specific |
| `SECURITY_EVENT_MAX_ITEMS` | `1000` or higher for active operations teams |
| `API_EMBEDDED_WORKERS_ENABLED` | `false` for multi-instance API deployments |
| `MEDIA_SCAN_WORKER_ENABLED` | `true` for the worker process |
| `MEDIA_SCAN_WORKER_INTERVAL_SECONDS` | `30` or deployment-specific |
| `MEDIA_STORAGE_CLEANUP_WORKER_ENABLED` | `true` for the worker process |
| `MEDIA_STORAGE_CLEANUP_WORKER_INTERVAL_SECONDS` | Bounded cadence, e.g. `300` |
| `MEDIA_STORAGE_CLEANUP_BATCH_SIZE` | Per-run cap, e.g. `25` |
| `MEDIA_STORAGE_CLEANUP_RETENTION_DAYS` | Approved retention window, default `30` |
| `TASK_STALE_SUBMISSION_WORKER_ENABLED` | `true` when stale task review sweeps should run automatically |
| `TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS` | `300` or deployment-specific |
| `TASK_STALE_SUBMISSION_OLDER_THAN_HOURS` | Review SLA threshold, e.g. `72` |
| `TASK_STALE_SUBMISSION_SWEEP_LIMIT` | Per-run cap, e.g. `25` |
| `CHAT_RETENTION_WORKER_ENABLED` | `true` for the worker process so inactive Chat records are deleted on schedule |
| `CHAT_RETENTION_WORKER_INTERVAL_SECONDS` | Sweep cadence, e.g. `3600` |
| `CHAT_RETENTION_SWEEP_LIMIT` | Per-run oldest-first cap, e.g. `100` |
| `CREATIVE_PROVIDER_POLLING_ENABLED` | `false` unless a named staging status-read approval is active |
| `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED` | `false` unless the same approval authorizes the dedicated worker |
| `CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS` | Bounded staging timeout, e.g. `3600` |
| `CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS` | Bounded cadence lower than max age, e.g. `60` |
| `CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT` | Per-run oldest-first cap, e.g. `10` |
| `WORKER_LEASE_TTL_SECONDS` | Lease expiry window, e.g. `300` |
| `WORKER_LEASE_RENEW_INTERVAL_SECONDS` | Renewal cadence lower than TTL, e.g. `60` |

Rate-limit shared store secret:

| Secret | Notes |
| --- | --- |
| `RATE_LIMIT_REDIS_URL` | Redis-compatible URL. Use `rediss://` when the provider supports TLS. |

Metrics exporter secret:

| Secret | Notes |
| --- | --- |
| `METRICS_EXPORTER_TOKEN` | Bearer token for `/metrics` scrape access. If omitted, protect `/metrics` with private networking or an upstream gateway. |

## Validation Flow

1. Configure the GitHub Environment, for example `production`.
2. Run the `Quality Gates` workflow manually.
3. Select `smoke_profile=env`.
4. Set `environment=production`.
5. Confirm the `Deployment Environment Smoke` job prints only safe summary metadata, reports Chat encryption as configured, and all checks pass.
6. Complete the multi-instance rehearsal in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` before the first production rollout with more than one API or worker process.

For staging-only creative provider preflight, use a dedicated staging environment and follow `docs/REAL_PROVIDER_STAGING_STRATEGY.md` and `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md`. Keep `CREATIVE_PROVIDER_MODE=disabled` so the creative staging smoke can validate secret presence without allowing paid provider calls. Use `CREATIVE_STAGING_SMOKE_MODE=preflight` for the legacy Replicate preflight, `adapter-shell` for its default-disabled adapter metadata, `callback-api` for V1-06 callback configuration, `polling-worker` for V1-07 status-client/worker configuration, and `openai-image-client` for the V1-19 OpenAI Image client, cap, and budget metadata preflight. The OpenAI mode requires `CREATIVE_OPENAI_IMAGE_API_TOKEN` as an Environment secret plus the variables listed in `docs/V1_IMAGE_STAGING_RELEASE_GATE.md`; it requires `CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED=false`. These smoke modes parse safe metadata only and make no callback or Provider request. Before any real integration, also review the go/no-go, rollback, and kill-switch gate in `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md`.
