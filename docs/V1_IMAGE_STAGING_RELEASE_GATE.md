# V1 Image Staging Release Gate

This document is the V1-19 execution contract for Image staging acceptance. The machine-readable companion is
`config/v1-image-staging-gate.json`.

Current decision: **fixture readiness is complete; real staging external calls and production enablement are no-go**.

The primary staging target is OpenAI GPT Image 2. Replicate FLUX 1.1 Pro remains a separately approved backup and is
not an automatic fallback. Ordinary continuation language is not approval for either Provider.

## What Can Run Now

- `npm run test:v1-image-staging` verifies the scenario, approval, budget, and evidence contract.
- `npm run smoke:creative-staging` runs Replicate foundation fixtures and the OpenAI Image client metadata preflight.
- `openai-image-client` proves the OpenAI adapter and client boundary are implemented, the deployment credential is
  present as a boolean, Provider/app caps are bounded, the product route remains disabled, and network calls remain off.
- Existing unit, route, repository, and browser tests cover fixture success, failure, timeout, review, cancel,
  over-budget, provider-cap block, kill-switch, and rollback behavior.

No command above constructs a real OpenAI request, calls a Provider, fetches Provider output, sends a callback, starts
polling, or enables a production Provider.

## Required Scenario Evidence

| Scenario | Fixture evidence | Real staging evidence |
| --- | --- | --- |
| Success and governed output | Covered | Pending explicit approval |
| Safe Provider failure | Covered | Pending explicit approval |
| Timeout and retry classification | Covered | Pending explicit approval |
| Policy review and download gate | Covered | Pending explicit approval |
| Cancellation and accounting closeout | Covered | Pending explicit approval |
| App budget rejection | Covered | Pending explicit approval |
| Provider-side cap rejection | Covered | Pending explicit approval |
| App/provider kill switch | Covered | Pending rehearsal |
| Rollback to disabled product route | Covered | Pending rehearsal |

V1-19 cannot be marked Done from fixture evidence alone.

## OpenAI Metadata Preflight

Use a dedicated staging GitHub Environment and select `CREATIVE_STAGING_SMOKE_MODE=openai-image-client`.

Required secret:

- `CREATIVE_OPENAI_IMAGE_API_TOKEN`: dedicated staging token; never print or store its value in Git, Notion, logs, or
  screenshots.

Required variables:

- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`
- `CREATIVE_PROVIDER_MODE=disabled`
- `CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED=true`
- `CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED=false`
- `CREATIVE_OPENAI_IMAGE_CONFIRMATION=staging-only`
- `CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD`: greater than zero and no more than `8`
- `CREATIVE_OPENAI_IMAGE_DAILY_SPEND_USD`: zero or a reconciled value no greater than the app cap
- `CREATIVE_OPENAI_IMAGE_PROVIDER_CAP_CONFIRMED=true`
- `CREATIVE_OPENAI_IMAGE_PROVIDER_CAP_USD`: greater than zero and no more than `8`
- `CREATIVE_OPENAI_IMAGE_PRODUCTION_NO_GO=true`

The metadata preflight must fail if the network flag is true. It is not the external-call rehearsal.

## External-Call Approval

Before one real staging call, the Chinese Notion record and explicit user approval must name:

- approver, timestamp, and expiry of no more than 24 hours;
- OpenAI GPT Image 2, dedicated staging environment, branch or PR, and exactly one maximum Provider call;
- Provider-side cap, app-side per-job cap of no more than USD `0.25`, and app daily cap of no more than USD `8`;
- token rotation owner, kill-switch owner, rollback owner, and production no-go;
- successful metadata preflight workflow URL and current deployment gate evidence.

The first approved request should use one text-to-image output at medium quality. Image edit modes require their own
input-rights and staging-asset evidence. Replicate backup testing requires a separate approval record.

## Closeout

After an approved rehearsal, record only safe evidence: generation id, media asset id, status, timestamps, dimensions,
byte count, checksum presence, scan/review state, estimated/actual cost, cap result, workflow URL, and rollback result.
Do not record the token, raw prompt, raw request/response, base64 bytes, Provider error body, or private download URL.

V1-19 is Done only after the required real staging scenarios, cost/cap reconciliation, kill-switch rehearsal, rollback
rehearsal, production go/no-go decision, complete quality gate, and Notion evidence all pass.
