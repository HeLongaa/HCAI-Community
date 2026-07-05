# GitHub Environment Configuration

This checklist is for the `deployment-env-smoke` job in `.github/workflows/quality-gates.yml`.

Use GitHub **Secrets** for credentials, signing secrets, tokens, private keys, and webhook URLs that grant access. Use GitHub **Variables** for non-secret ids, domains, public URLs, feature flags, thresholds, and counts.

## Required Secrets

At least one auth secret is required:

| Name | Required | Notes |
| --- | --- | --- |
| `ACCESS_TOKEN_SECRET` | Yes, unless `SESSION_SECRET` is set | Must be at least 32 characters in production |
| `SESSION_SECRET` | Alternative | Backward-compatible fallback for access token signing |

Object storage secrets for managed S3 mode:

| Name | Required | Notes |
| --- | --- | --- |
| `STORAGE_ACCESS_KEY_ID` | Yes | S3-compatible access key |
| `STORAGE_SECRET_ACCESS_KEY` | Yes | S3-compatible secret |
| `STORAGE_SESSION_TOKEN` | Optional | Only for temporary credentials |

Media scanner secrets:

| Name | Required | Notes |
| --- | --- | --- |
| `MEDIA_SCAN_WEBHOOK_SECRET` | Yes | Required when `MEDIA_SCAN_PROVIDER=webhook` |
| `MEDIA_SCAN_REQUEST_SECRET` | Yes for managed smoke | Signs outbound scanner requests |
| `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET` | Recommended | Dedicated callback HMAC secret; request secret can satisfy the smoke fallback |

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
| `TASK_STALE_SUBMISSION_WORKER_ENABLED` | `true` when stale task review sweeps should run automatically |
| `TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS` | `300` or deployment-specific |
| `TASK_STALE_SUBMISSION_OLDER_THAN_HOURS` | Review SLA threshold, e.g. `72` |
| `TASK_STALE_SUBMISSION_SWEEP_LIMIT` | Per-run cap, e.g. `25` |

Rate-limit shared store secret:

| Secret | Notes |
| --- | --- |
| `RATE_LIMIT_REDIS_URL` | Redis-compatible URL. Use `rediss://` when the provider supports TLS. |

## Validation Flow

1. Configure the GitHub Environment, for example `production`.
2. Run the `Quality Gates` workflow manually.
3. Select `smoke_profile=env`.
4. Set `environment=production`.
5. Confirm the `Deployment Environment Smoke` job prints only safe summary metadata and all checks pass.
