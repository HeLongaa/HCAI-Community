# Real Provider Staging Smoke Runbook

This runbook defines the safe staging rehearsal that must pass before any real-provider adapter PR can move from mocked fixture coverage toward an external-call staging test. For the short readiness and closeout checklist, start with `docs/REAL_PROVIDER_STAGING_SMOKE_READINESS.md`, then use this runbook for execution details.

Current status: staging smoke is metadata-only. It validates environment gates, secret presence, provider catalog safety metadata, default-disabled execution, and safe-summary self-redaction. It does not call OpenAI or Replicate, download provider outputs, create generation records, run webhook or polling workers, or enable production paid-provider traffic.

V1-19 adds `openai-image-client` as the primary Image metadata preflight. The earlier Replicate modes remain useful for
the asynchronous backup foundation, but they are not evidence that the selected OpenAI primary has passed staging.

The smoke fails before closeout if its safe summary values contain the configured staging token value, raw provider markers, provider URLs, callback URLs, Bearer values, or API-key-like material.

## When To Use This Runbook

Use this runbook after the mocked adapter contract and route fixture path pass, and before any task enables the
default-disabled Provider HTTP/status clients, adds another Provider SDK or endpoint, or starts an external-call staging
run.

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
| `CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET` | Callback-api mode only | Dedicated staging ingress HMAC secret, minimum 32 characters. |

Variables:

| Name | Preflight | Adapter-shell | Callback-api | Polling-worker | Notes |
| --- | --- | --- | --- | --- | --- |
| `CREATIVE_PROVIDER_RUNTIME_ENV` | `staging` | `staging` | `staging` | `staging` | Required for any staging provider boundary. |
| `CREATIVE_PROVIDER_MODE` | `disabled` | `replicate_staging` | `disabled` | `replicate_staging` | Callback intake remains independent from outbound clients. |
| `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED` | `true` | `false` | `true` | `false` | Preflight proves secret wiring without provider dispatch. |
| `CREATIVE_STAGING_IMAGE_PROVIDER` | `replicate` | `replicate` | `replicate` | `replicate` | First candidate only. |
| `CREATIVE_STAGING_PROVIDER_CONFIRMATION` | `staging-only` | `staging-only` | `staging-only` | `staging-only` | Explicit human confirmation string. |
| `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED` | `false` | `false` | `false` | `true` | Polling fixture validates construction metadata and makes no request. |
| `CREATIVE_PROVIDER_CALLBACK_ENABLED` | `false` | `false` | `true` | `false` | Independent V1-06 callback kill switch. |
| `CREATIVE_PROVIDER_POLLING_ENABLED` | `false` | `false` | `false` | `true` | Independent V1-07 lifecycle polling switch. |
| `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED` | `false` | `false` | `false` | `true` | Dedicated worker switch. |
| `CREATIVE_STAGING_SMOKE_MODE` | `preflight` | `adapter-shell` | `callback-api` | `polling-worker` | Selects the smoke assertion set. |

Provider account setup:

- Use a dedicated staging provider account or token.
- Set a low provider-side spending cap before any later external-call test.
- Keep Provider webhook targets disabled until a named staging delivery is explicitly approved; V1-06 app-side idempotency tests alone are not traffic approval.
- Rotate the token before moving from metadata smoke to any external-call staging adapter.

### OpenAI Image primary preflight

For `CREATIVE_STAGING_SMOKE_MODE=openai-image-client`, store `CREATIVE_OPENAI_IMAGE_API_TOKEN` as a dedicated staging
Environment secret and use the variables in `docs/V1_IMAGE_STAGING_RELEASE_GATE.md`. Keep
`CREATIVE_PROVIDER_MODE=disabled` and `CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED=false`. The mode requires bounded
Provider/app cap metadata and `CREATIVE_OPENAI_IMAGE_PRODUCTION_NO_GO=true`; it fails if network calls are enabled.

## Local Fixture Smoke

Run the fixture-only creative staging smoke:

```bash
npm run smoke:creative-staging
```

Expected result:

- `preflight` fixture passes with `CREATIVE_PROVIDER_MODE=disabled`.
- `adapter-shell` fixture passes with `CREATIVE_PROVIDER_MODE=replicate_staging`.
- `callback-api` fixture passes with Provider dispatch disabled and callback configuration explicitly enabled.
- `polling-worker` fixture passes with the read-only status client and worker configuration enabled but uncalled.
- `openai-image-client` passes with the OpenAI adapter/client boundary present, product dispatch disabled, bounded cap
  metadata, and Provider network calls disabled.
- Safe summary reports `networkCallsEnabled=false` outside polling-worker mode and `true` only for its no-request construction check.
- Safe summary reports `adapterImplemented=false` for Replicate and `adapterImplemented=true` for the fixture-injected
  OpenAI Image adapter; neither is product-route enabled.
- Safe summary self-redaction check passes.
- No token value is printed.

This local fixture uses fake secret strings and does not start a callback server, run a worker interval, or call a provider.

## Manual GitHub Smoke

Run the GitHub Actions workflow manually:

1. Open `Quality Gates`.
2. Select `workflow_dispatch`.
3. Set `smoke_profile=creative-staging`.
4. Set `environment=creative-staging` or the approved staging environment name.
5. For preflight, set `CREATIVE_STAGING_SMOKE_MODE=preflight` in the environment variables.
6. For adapter-shell metadata smoke, set `CREATIVE_STAGING_SMOKE_MODE=adapter-shell`.
7. For callback configuration smoke, set `CREATIVE_STAGING_SMOKE_MODE=callback-api`.
8. For polling worker configuration smoke, set `CREATIVE_STAGING_SMOKE_MODE=polling-worker`.
9. For the selected Image primary metadata smoke, set `CREATIVE_STAGING_SMOKE_MODE=openai-image-client` and configure
   the secret/variables in `docs/V1_IMAGE_STAGING_RELEASE_GATE.md`.
10. Confirm the `Deployment Environment Smoke` job runs `npm run smoke:creative-staging:env`.

Expected OpenAI Image client checks:

- `OpenAI Image remains unavailable on the product route` passes.
- `OpenAI Image client construction gate is enabled` passes.
- `OpenAI Image network calls remain disabled` passes.
- Provider-side cap, app budget, reconciled spend, and production no-go checks pass.

Expected preflight checks:

- `production runtime parity` passes.
- `creative runtime is staging` passes.
- `preflight uses disabled provider mode` passes.
- `staging preflight flag enabled` passes.
- `creative generation remains globally disabled` passes.
- `provider HTTP client remains disabled` passes.

Expected adapter-shell checks:

- `adapter shell uses explicit replicate_staging mode` passes.
- `adapter shell does not require preflight flag` passes.
- `adapter shell remains default-disabled` passes.
- `provider HTTP client remains disabled` passes.

Expected callback-api checks:

- `callback API uses disabled provider dispatch mode` passes.
- `callback API is explicitly enabled` passes.
- `callback signature secret is configured as presence only` passes.
- `callback API keeps provider network dispatch disabled` passes.

Expected polling-worker checks:

- `polling worker uses explicit replicate_staging mode` passes.
- `polling worker requires the guarded HTTP client` passes.
- `polling lifecycle and worker switches are explicitly enabled` passes.
- `polling status client is implemented and enabled` passes.
- `polling worker keeps callback intake independently disabled` passes.

## Post-Smoke Manual API Check

After the metadata smoke passes in a real staging deployment, verify the user-facing generation path is still blocked from paid dispatch.

1. Call `GET /api/creative/providers` with a staging auth token.
2. Confirm `openai-gpt-image-2` and `replicate-staging` are unavailable/default-disabled or safe metadata only.
3. Call `POST /api/creative/generations` with `providerId=openai-gpt-image-2`.
4. Confirm the route returns provider unavailable or unsupported adapter behavior rather than creating a provider job.
5. Confirm no Provider request appears in the Provider console.
6. Confirm logs, audit events, smoke output, and Notion notes contain no token value.

## Closeout Evidence

Record the following in Notion before starting any external-call adapter task:

- GitHub workflow run URL.
- Smoke mode used: `preflight`, `adapter-shell`, `callback-api`, or `polling-worker`.
- Safe summary fields for provider mode, runtime env, token configured boolean, `networkCallsEnabled`, and `adapterImplemented`.
- Confirmation that the safe-summary self-redaction guard passed.
- Manual API check result.
- Provider-side spending cap confirmation.
- Kill switch owner and rollback owner.
- Explicit statement that no real provider call was made.

## Kill Switch Procedure

Immediate environment rollback:

1. Set `CREATIVE_PROVIDER_MODE=disabled`.
2. Set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false`.
3. Set `CREATIVE_PROVIDER_CALLBACK_ENABLED=false`.
4. Remove or rotate `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
5. Set provider-side spending cap to `0`.
6. Disable provider webhook targets.
7. Disable Provider callback intake and both polling switches.

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
