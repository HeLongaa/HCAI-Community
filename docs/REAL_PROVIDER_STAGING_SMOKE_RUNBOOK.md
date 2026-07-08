# Real Provider Staging Smoke Runbook

This runbook defines the safe staging rehearsal that must pass before any real-provider adapter PR can move from mocked fixture coverage toward an external-call staging test. For the short readiness and closeout checklist, start with `docs/REAL_PROVIDER_STAGING_SMOKE_READINESS.md`, then use this runbook for execution details.

Current status: staging smoke is metadata-only. It validates environment gates, secret presence, provider catalog safety metadata, and default-disabled execution. It does not call Replicate, download provider outputs, create generation records, run webhook or polling workers, or enable production paid-provider traffic.

## When To Use This Runbook

Use this runbook after the mocked adapter contract and route fixture path pass, and before any PR proposes a real provider SDK, provider HTTP client, webhook endpoint, polling worker, or external-call staging run.

Do not use this runbook as production approval. Production paid-provider enablement remains no-go until a later explicit phase.

## Required Boundaries

Allowed:

- Dedicated staging GitHub Environment only.
- `NODE_ENV=production` for runtime parity.
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- `CREATIVE_PROVIDER_MODE=disabled` for preflight mode.
- `CREATIVE_PROVIDER_MODE=replicate_staging` only for adapter-shell metadata smoke.
- `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`.
- `CREATIVE_STAGING_PROVIDER_API_TOKEN` stored as a GitHub Environment secret.
- `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`.
- Safe summary output with booleans, provider modes, provider ids, and counts only.

Forbidden:

- Real provider token in local `.env`, repository files, CI fixture profiles, logs, screenshots, Notion pages, or PR descriptions.
- Production environment containing `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Production `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true`.
- Default route registration that dispatches to Replicate.
- Admin retry, cancel, refund, or manual settlement mutation controls.
- Provider output download or media bypass before media governance is explicitly implemented and tested.

## GitHub Environment Setup

Create or select a dedicated staging environment, for example `creative-staging`.

Secrets:

| Name | Required | Notes |
| --- | --- | --- |
| `ACCESS_TOKEN_SECRET` | Yes | Minimum 32 characters because `NODE_ENV=production` is used for parity. |
| `CREATIVE_STAGING_PROVIDER_API_TOKEN` | Yes | Dedicated staging provider token only. Do not reuse future production credentials. |

Variables:

| Name | Preflight value | Adapter-shell value | Notes |
| --- | --- | --- | --- |
| `CREATIVE_PROVIDER_RUNTIME_ENV` | `staging` | `staging` | Required for any staging provider token. |
| `CREATIVE_PROVIDER_MODE` | `disabled` | `replicate_staging` | Adapter shell remains unavailable on the default route path. |
| `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED` | `true` | `false` | Preflight proves secret wiring without provider dispatch. |
| `CREATIVE_STAGING_IMAGE_PROVIDER` | `replicate` | `replicate` | First candidate only. |
| `CREATIVE_STAGING_PROVIDER_CONFIRMATION` | `staging-only` | `staging-only` | Explicit human confirmation string. |
| `CREATIVE_STAGING_SMOKE_MODE` | `preflight` | `adapter-shell` | Selects the smoke assertion set. |

Provider account setup:

- Use a dedicated staging provider account or token.
- Set a low provider-side spending cap before any later external-call test.
- Keep provider webhook targets disabled until webhook idempotency tests exist.
- Rotate the token before moving from metadata smoke to any external-call staging adapter.

## Local Fixture Smoke

Run the fixture-only creative staging smoke:

```bash
npm run smoke:creative-staging
```

Expected result:

- `preflight` fixture passes with `CREATIVE_PROVIDER_MODE=disabled`.
- `adapter-shell` fixture passes with `CREATIVE_PROVIDER_MODE=replicate_staging`.
- Safe summary reports `networkCallsEnabled=false`.
- Safe summary reports `adapterImplemented=false`.
- No token value is printed.

This local fixture uses a fake token string and does not call a provider.

## Manual GitHub Smoke

Run the GitHub Actions workflow manually:

1. Open `Quality Gates`.
2. Select `workflow_dispatch`.
3. Set `smoke_profile=creative-staging`.
4. Set `environment=creative-staging` or the approved staging environment name.
5. For preflight, set `CREATIVE_STAGING_SMOKE_MODE=preflight` in the environment variables.
6. For adapter-shell metadata smoke, set `CREATIVE_STAGING_SMOKE_MODE=adapter-shell`.
7. Confirm the `Deployment Environment Smoke` job runs `npm run smoke:creative-staging:env`.

Expected preflight checks:

- `production runtime parity` passes.
- `creative runtime is staging` passes.
- `preflight uses disabled provider mode` passes.
- `staging preflight flag enabled` passes.
- `creative generation remains globally disabled` passes.
- `replicate staging provider network calls disabled` passes.

Expected adapter-shell checks:

- `adapter shell uses explicit replicate_staging mode` passes.
- `adapter shell does not require preflight flag` passes.
- `adapter shell remains default-disabled` passes.
- `replicate staging provider network calls disabled` passes.

## Post-Smoke Manual API Check

After the metadata smoke passes in a real staging deployment, verify the user-facing generation path is still blocked from paid dispatch.

1. Call `GET /api/creative/providers` with a staging auth token.
2. Confirm `replicate-staging` is unavailable/default-disabled or safe metadata only.
3. Call `POST /api/creative/generations` with `providerId=replicate-staging`.
4. Confirm the route returns provider unavailable or unsupported adapter behavior rather than creating a provider job.
5. Confirm no provider job id appears in provider console.
6. Confirm logs, audit events, smoke output, and Notion notes contain no token value.

## Closeout Evidence

Record the following in Notion before starting any external-call adapter task:

- GitHub workflow run URL.
- Smoke mode used: `preflight` or `adapter-shell`.
- Safe summary fields for provider mode, runtime env, token configured boolean, `networkCallsEnabled`, and `adapterImplemented`.
- Manual API check result.
- Provider-side spending cap confirmation.
- Kill switch owner and rollback owner.
- Explicit statement that no real provider call was made.

## Kill Switch Procedure

Immediate environment rollback:

1. Set `CREATIVE_PROVIDER_MODE=disabled`.
2. Set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false`.
3. Remove or rotate `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
4. Set provider-side spending cap to `0`.
5. Disable provider webhook targets.
6. Disable any future provider polling or callback workers.

Verification:

1. Re-run `npm run smoke:creative-staging:env` only after the environment is expected to fail or report no token, depending on the rollback goal.
2. Re-run production smoke for production environments with `npm run smoke:production:env`.
3. Confirm `GET /api/creative/providers` exposes no enabled real provider.
4. Confirm `POST /api/creative/generations` cannot dispatch to Replicate.

## Adapter PR Closeout Gate

Before merging any future staging adapter PR that introduces real SDK or HTTP client code:

- `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` has a completed approval record for any external-call rehearsal.
- Notion task exists and is updated in Chinese.
- Local fixture smoke passes.
- GitHub `creative-staging` smoke passes in preflight mode.
- GitHub `creative-staging` smoke passes in adapter-shell mode.
- Provider-side spending cap exists and is recorded.
- App-side budget guard fails closed before dispatch.
- Provider request and response redaction tests pass.
- `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` is satisfied before provider callbacks, polling workers, or manual lifecycle replay are enabled.
- Lifecycle replay idempotency tests pass for queued, running, completed, failed, and cancelled states.
- Media persistence and scan governance tests pass before outputs are user-downloadable.
- Admin generation history remains read-only unless a separate mutation permission phase is approved.
- User explicitly approves the first external-call staging run with the scope and maximum provider call count recorded.

No-go if any item above is missing, if CI needs real provider credentials, or if production would contain staging provider secrets.
