# Quality Gates

This document defines the productization quality gates used before local handoff, pull request review, and deployment.

## Local Quick Check

Run:

```bash
npm run check:quick
```

Includes:

- `npm run lint`
- `npm run test:sim`
- API contract drift check through `scripts/verify-api-contracts.mjs`

Use this before handing off small frontend, contract, or documentation changes.

## Pull Request Check

Run:

```bash
npm run check:pr
```

Includes:

- Local quick check
- production frontend build
- backend Node test suite
- Prisma schema validation
- Playwright E2E workflow checks

Use this before merging productization work into the main branch.

## Deployment Check

Run the safe fixture profile in CI:

```bash
npm run check:deploy
```

Run the real environment profile in the deployment environment:

```bash
npm run check:deploy:env
```

Includes:

- Pull request check
- production smoke profile
- managed auth secret validation
- S3 object storage configuration validation
- webhook media scanner request/callback validation
- media/security alert channel validation
- secure cookie and trusted origin validation
- guard rail validation for rate limits, request body limits, and auth failure monitoring
- worker topology and lease renewal sanity checks
- external OAuth provider metadata validation

The environment profile does not print secrets. It reports booleans, counts, provider modes, and safe operational metadata only.

Use `docs/RELEASE_CHECKLIST.md` after the deployment gate passes to run the release execution, post-release operations, alert verification, and rollback checks.

## GitHub Actions

`.github/workflows/quality-gates.yml` wires these gates into CI:

- Pull requests and pushes to `main` / `master` run `npm run check:deploy` with the safe fixture smoke profile.
- Manual `workflow_dispatch` with `smoke_profile=fixture` runs the same fixture gate.
- Manual `workflow_dispatch` with `smoke_profile=env` runs `npm run smoke:production:env` against a selected GitHub Environment.

For the real environment smoke, configure GitHub Environment variables and secrets by category. The detailed checklist lives in `docs/GITHUB_ENVIRONMENT.md`.

- Auth secrets: `ACCESS_TOKEN_SECRET` or `SESSION_SECRET`, plus optional `ACCESS_TOKEN_KEY_ID`.
- Browser auth variables: `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN`, `AUTH_TRUSTED_ORIGINS` or `CORS_ALLOWED_ORIGINS`.
- Object storage: `STORAGE_DRIVER`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, optional `STORAGE_SESSION_TOKEN`.
- Media scanner: `MEDIA_SCAN_PROVIDER`, `MEDIA_SCAN_WEBHOOK_SECRET`, `MEDIA_SCAN_REQUEST_ADAPTER`, `MEDIA_SCAN_REQUEST_URL`, `MEDIA_SCAN_REQUEST_SECRET`, `MEDIA_SCAN_CALLBACK_BASE_URL`, `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET`.
- Media alert channels: `MEDIA_SCAN_ALERT_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_WEBHOOK_SECRET`, `MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET`, `MEDIA_SCAN_ALERT_EMAIL_TO`, `MEDIA_SCAN_ALERT_EMAIL_FROM`.
- Security alert channels: `SECURITY_ALERT_WEBHOOK_URL`, `SECURITY_ALERT_WEBHOOK_SECRET`, `SECURITY_ALERT_SLACK_WEBHOOK_URL`, `SECURITY_ALERT_EMAIL_WEBHOOK_URL`, `SECURITY_ALERT_EMAIL_WEBHOOK_SECRET`, `SECURITY_ALERT_EMAIL_TO`, `SECURITY_ALERT_EMAIL_FROM`.
- Guard rails: `RATE_LIMIT_*`, `REQUEST_BODY_*`, `AUTH_FAILURE_*`, `SECURITY_EVENT_MAX_ITEMS`.
- Worker topology: `API_EMBEDDED_WORKERS_ENABLED`, `MEDIA_SCAN_WORKER_*`, `TASK_STALE_SUBMISSION_WORKER_*`, `WORKER_LEASE_*`.
- OAuth providers: `OAUTH_GOOGLE_*`, `OAUTH_DISCORD_*`, and/or `OAUTH_APPLE_*`.

Use GitHub Secrets for credentials, shared secrets, tokens, webhook secrets, Slack webhook URLs, and private keys. Use GitHub Variables for non-secret URLs, ids, domains, counts, feature flags, and recipient lists unless your deployment policy treats them as sensitive.

## Failure Handling

- Contract drift failures mean a route, OpenAPI path, or protected-route permission row is out of sync.
- Production smoke failures usually mean an environment variable is missing, invalid, or not aligned with the managed deployment profile.
- E2E failures should be checked after confirming the local dev server ports are free and Playwright artifacts have not been left from a previous interrupted run.
- After E2E, remove generated reports with `rm -rf test-results playwright-report` when running manually.
