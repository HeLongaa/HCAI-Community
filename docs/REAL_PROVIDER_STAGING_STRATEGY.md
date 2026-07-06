# Real Provider Staging Strategy

This document closes the second real-provider preflight task: choose the first staging-only image provider candidate and define the secrets, feature flags, smoke checks, and rollback boundary required before any paid provider call is implemented.

The repository remains mock-provider only. This strategy does not add a real provider adapter, external API call, webhook route, polling worker, production enablement path, or Admin retry/cancel/refund control.

## Candidate Decision

First candidate: Replicate image generation through its Predictions API.

Selection rationale:

- Replicate exposes prediction lifecycle concepts that map cleanly onto the repository's durable generation states. Replicate prediction statuses such as starting, processing, succeeded, failed, and canceled can later be mapped into queued, running, completed, failed, and cancellation/deferred states without changing the generation record contract. See Replicate's prediction lifecycle docs: https://replicate.com/docs/topics/predictions/lifecycle.
- Replicate supports asynchronous prediction creation and can return a queued/running prediction when work exceeds a synchronous wait window. See the create-prediction docs: https://replicate.com/docs/topics/predictions/create-a-prediction.
- Replicate webhooks can report prediction lifecycle updates to an endpoint controlled by the app. This fits the planned async polling/webhook phase, but it is intentionally not implemented in this task. See Replicate webhooks: https://replicate.com/docs/topics/webhooks and https://replicate.com/docs/topics/webhooks/receive-webhook.
- Replicate official models advertise actively maintained models and predictable pricing metrics, which helps the later cost metadata and budget alarm task. See Replicate official models: https://replicate.com/docs/topics/models/official-models.

Secondary candidates kept for later comparison:

- fal.ai has a queue API, webhook support, analytics, usage, and pricing APIs that may be valuable for production operations, but it introduces a broader platform API surface before the first adapter is proven. See fal async inference and webhooks: https://fal.ai/docs/documentation/model-apis/inference/queue and https://fal.ai/docs/documentation/model-apis/inference/webhooks.
- OpenAI Images can remain a future candidate when the product direction needs OpenAI-native image generation, but this staging preflight favors a provider with an explicit prediction lifecycle and webhook-shaped adapter boundary.

## Feature Flag Strategy

Current executable provider flag:

- `CREATIVE_PROVIDER_MODE=mock`: default local/CI fixture behavior. Only the deterministic mock provider executes.
- `CREATIVE_PROVIDER_MODE=disabled`: generation routes report provider unavailability. Use this for staging provider preflight so real credentials can be validated as present without enabling generation calls.
- `CREATIVE_PROVIDER_MODE=replicate_staging`: guarded staging-only adapter shell. It requires `CREATIVE_PROVIDER_RUNTIME_ENV=staging`, `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`, `CREATIVE_STAGING_PROVIDER_API_TOKEN`, and `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`. The provider catalog may expose `replicate-staging` as safe metadata, but it remains unavailable on the default route path and `networkCallsEnabled=false` unless a test explicitly injects a fixture adapter.

The Replicate staging client contract is tested with an injected mocked client only. It maps image request payloads, Replicate-like prediction statuses, output URLs, and provider failures into the internal generation contract without providing a default network client. A route-level fixture test can inject the mocked adapter to exercise policy, quota, credit, generation record, and media persistence boundaries, but production/default route registration does not wire Replicate execution.

The mocked contract also requires provider cost estimate and daily budget cap metadata before any injected client dispatch. Missing estimate, missing cap, or projected spend above the cap fails closed before the mocked client is called. Budget metadata remains staging-scoped and low-cardinality: `CREATIVE_STAGING_PROVIDER_BUDGET_SCOPE=staging:replicate:image`, `CREATIVE_STAGING_PROVIDER_ESTIMATE_USD`, `CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD`, `CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD`, and `CREATIVE_STAGING_PROVIDER_BUDGET_THRESHOLD_PERCENT`.

Async lifecycle replay is also contract-tested without route wiring. Replicate-like `starting`, `processing`, `succeeded`, `failed`, and `canceled` events map to internal `queued`, `running`, `completed`, `failed`, and `cancelled` states. Duplicate terminal replays, duplicate running replays, and stale queued replays return no-op action signals so later webhook or polling wiring can avoid duplicate output persistence, credit settlement, or refunds.

Preflight-only metadata:

- `CREATIVE_PROVIDER_RUNTIME_ENV`: one of `development`, `test`, `ci`, `staging`, or `production`. This can differ from `NODE_ENV`; staging deployments can still run optimized `NODE_ENV=production` while setting this value to `staging`.
- `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true`: validates that staging provider secrets are present and intentionally scoped.
- `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`: records the selected provider candidate.
- `CREATIVE_STAGING_PROVIDER_API_TOKEN`: secret presence check only. The value is never printed by smoke summaries.
- `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`: explicit human-readable confirmation to prevent accidental secret activation.

Fail-closed rules:

- Staging provider preflight requires `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- Staging provider preflight requires `CREATIVE_PROVIDER_MODE=disabled`.
- Staging provider preflight requires `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`.
- Replicate staging adapter shell requires `CREATIVE_PROVIDER_MODE=replicate_staging` and rejects every runtime except `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- Production smoke allows only `CREATIVE_PROVIDER_MODE=mock` or `disabled`; `replicate_staging` is production-denied.
- Replicate staging client contract blocks dispatch when provider cost estimate or daily budget cap metadata is missing.
- Replicate staging client contract blocks dispatch when projected daily spend exceeds the configured cap.
- Replicate staging lifecycle replay rejects provider job id mismatches and suppresses duplicate/stale events before side-effect actions.
- Staging provider preflight requires `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- The staging token is rejected unless preflight is enabled or the guarded `replicate_staging` shell is selected.
- The staging token is rejected outside `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- Production smoke requires staging preflight to be disabled.

These rules intentionally mean a staging environment can prove secret wiring while all user-facing creative generation remains unavailable rather than paid-provider-backed.

## Secrets Strategy

GitHub Environment:

- Store `CREATIVE_STAGING_PROVIDER_API_TOKEN` as a GitHub Secret only in a dedicated staging environment.
- Store `CREATIVE_PROVIDER_RUNTIME_ENV`, `CREATIVE_PROVIDER_MODE`, `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED`, `CREATIVE_STAGING_IMAGE_PROVIDER`, and `CREATIVE_STAGING_PROVIDER_CONFIRMATION` as GitHub Variables unless deployment policy treats them as sensitive.
- Do not copy the token into repository files, CI fixture profiles, local `.env` files, screenshots, Notion pages, or logs.

Provider account:

- Create a dedicated staging provider token, separate from any future production token.
- Scope the token to the minimum available permissions for prediction creation/status reads once the adapter phase begins.
- Set a low provider-side spending limit before the first adapter PR is tested.
- Rotate the token before moving from preflight-only validation to any external-call staging adapter.

Disable and rollback:

- Remove or rotate `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false`.
- Keep or set `CREATIVE_PROVIDER_MODE=disabled` until the adapter is intentionally enabled in a separate phase.
- Re-run `npm run smoke:production:env` or the staging equivalent after env changes.

## CI, Local, And Production Protections

CI fixture:

- Keeps `CREATIVE_PROVIDER_MODE` omitted or `mock`.
- Does not include `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Runs `npm run check:deploy` without any paid provider path.

Local development:

- Defaults to `CREATIVE_PROVIDER_MODE=mock`.
- Developers may use `CREATIVE_PROVIDER_MODE=disabled` to test unavailable-provider UX.
- Developers should not place real provider tokens in local `.env` files during preflight.

Production:

- Must not enable `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED`.
- Must not include `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Must pass production smoke with creative staging preflight disabled.

Staging:

- May set `NODE_ENV=production` for optimized runtime.
- Must set `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- Must set `CREATIVE_PROVIDER_MODE=disabled` for this preflight task.
- May set the staging provider token only after the provider account has budget limits.
- Must not run user-facing external calls until a separate adapter PR exists and passes the readiness closeout gate.

## Staging Smoke Requirements

Before any real adapter PR:

1. Configure a dedicated staging GitHub Environment.
2. Set `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
3. Set `CREATIVE_PROVIDER_MODE=disabled`.
4. Set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true`.
5. Set `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`.
6. Set `CREATIVE_STAGING_PROVIDER_API_TOKEN` as a secret.
7. Set `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`.
8. Run the environment smoke profile and confirm the summary reports only safe booleans/provider ids.
   Use `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` for the dedicated creative staging smoke command and GitHub Actions workflow inputs.
9. Confirm `POST /api/creative/generations` still reports provider unavailable rather than calling the provider.
10. Record the result in Notion before starting the real adapter implementation task.

## Handoff To Later Tasks

The next preflight tasks should use this boundary as input:

- Admin mutation requirements should keep retry/cancel/refund controls deferred until provider idempotency and audit semantics are written.
- Provider cost metadata should start with Replicate official model pricing units and map them into internal cost estimate, settled cost, currency, and provider usage metadata.
- Callback/polling enablement should satisfy `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` before any webhook route, polling worker, or manual replay path is enabled.
- Real-provider closeout should require staging preflight to pass before allowing an adapter branch to make any external API call.
