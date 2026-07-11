# Real Provider Staging Smoke Readiness

This closeout records the current metadata-only creative staging smoke readiness. It is a maintenance handoff for operators and future adapter PR authors; it is not approval for a real provider call.

Current decision: **ready for metadata-only staging smoke, no-go for external provider calls**.

The smoke validates environment gates, secret presence as a boolean, safe provider catalog metadata, default-disabled execution, the independent callback configuration gate, and a self-redaction guard over the emitted safe summary. It does not call Replicate, create provider jobs, send a callback request, register a Provider webhook target, poll Provider status, deliver external budget alerts, expose Admin mutation controls, or enable production paid-provider traffic.

## What Is Ready

| Surface | Ready State | Evidence |
| --- | --- | --- |
| Local fixture smoke | Ready | `npm run smoke:creative-staging` runs preflight, adapter-shell, and callback-api fixtures. |
| GitHub manual smoke | Ready | `Quality Gates` supports `workflow_dispatch` with `smoke_profile=creative-staging`. |
| Staging environment inputs | Documented | `docs/GITHUB_ENVIRONMENT.md` lists the required variables and secrets. |
| Runbook | Documented | `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` defines setup, expected checks, evidence, and rollback. |
| External-call approval boundary | Documented | `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` remains required before any provider call. |
| Current status handoff | Documented | `docs/REAL_PROVIDER_CURRENT_STATUS.md` is the first decision page before provider work. |

## Supported Smoke Modes

### Fixture preflight

Command:

```bash
node scripts/smoke-creative-staging.mjs --profile=fixture --mode=preflight
```

Package alias:

```bash
npm run smoke:creative-staging
```

Expected meaning:

- `NODE_ENV=production` proves production-runtime parsing parity.
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging` is required.
- `CREATIVE_PROVIDER_MODE=disabled` is required.
- `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true` is required.
- Provider token presence is validated only as a boolean.
- Safe summary values are checked before output so the configured token value, raw provider markers, provider URLs, callback URLs, Bearer values, and API-key-like material cannot be printed.
- Creative generation remains globally disabled.

### Fixture adapter-shell

Command:

```bash
node scripts/smoke-creative-staging.mjs --profile=fixture --mode=adapter-shell
```

Expected meaning:

- `CREATIVE_PROVIDER_MODE=replicate_staging` is selected only for safe shell metadata.
- `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false` is accepted.
- `replicate-staging` remains unavailable/default-disabled.
- `httpClientImplemented=true` and `httpClientEnabled=false`.
- `networkCallsEnabled=false`.
- `adapterImplemented=false`.
- Safe summary values pass the self-redaction guard before they are printed.

### Fixture callback-api

Command:

```bash
node scripts/smoke-creative-staging.mjs --profile=fixture --mode=callback-api
```

Expected meaning:

- Provider dispatch remains disabled and `networkCallsEnabled=false`.
- `CREATIVE_PROVIDER_CALLBACK_ENABLED=true` is accepted only in the production-parity staging runtime.
- Callback signing-secret presence is exposed only as a boolean.
- No HTTP server, callback request, Provider webhook target, or external network request is created by the smoke.
- The safe summary self-redaction guard checks the callback secret along with the existing Provider token boundary.

### Environment smoke

Command used by GitHub Actions:

```bash
npm run smoke:creative-staging:env
```

Expected GitHub inputs:

- `smoke_profile=creative-staging`.
- `environment` points to a dedicated staging GitHub Environment, for example `creative-staging`.
- `CREATIVE_STAGING_SMOKE_MODE=preflight`, `adapter-shell`, or `callback-api` is set in that environment.

## Readiness Checklist

Before recording metadata-only staging smoke as complete, all items below should be true:

- Local `npm run smoke:creative-staging` passes without real provider credentials.
- Manual GitHub `creative-staging` smoke can be run against a dedicated staging environment.
- Smoke output contains no token values, raw prompts, raw provider payloads, raw response bodies, output URLs, or secrets.
- Smoke output has passed the built-in safe summary self-redaction guard.
- Smoke output reports only safe booleans, provider modes, provider ids, and default-disabled metadata.
- `replicate-staging` reports `networkCallsEnabled=false`.
- The safe summary reports the V1-05 HTTP boundary as implemented but disabled.
- The safe summary reports the V1-06 callback boundary as implemented and only enables its configuration in callback-api mode.
- `replicate-staging` reports `adapterImplemented=false` unless a later explicitly approved adapter PR changes the shell contract.
- Production smoke still rejects staging preflight, the Provider HTTP client flag, the callback flag, and staging provider token presence.
- The Notion task for the smoke or adapter step is current and written in Chinese.
- The run result is recorded with the smoke mode, GitHub workflow URL if applicable, safe summary fields, and a statement that no real provider call was made.

## No-Go Boundaries

This readiness state does not allow:

- Real provider SDKs or default HTTP clients.
- Real provider network calls or provider job creation.
- Provider output download or media persistence from external provider URLs.
- Real Provider webhook target registration or callback delivery.
- Enabled real provider polling.
- Manual replay endpoints.
- Admin retry, cancel, refund, force-review, replay, recovery, or settlement mutation controls.
- Real external Slack, webhook, or email delivery for creative provider budget alerts.
- Production paid-provider enablement.

Ordinary continuation language such as "continue", "next", "looks good", or "ship it" is not approval for any item above.

## Closeout Evidence Template

Record the following in Notion and the PR closeout when this readiness package or a future smoke run is completed:

```text
Decision: Metadata-only staging smoke ready / No-go for external provider calls
Branch or PR:
Local fixture smoke:
GitHub creative-staging smoke URL:
Smoke mode: preflight / adapter-shell / callback-api
Safe summary fields recorded:
networkCallsEnabled:
adapterImplemented:
Production smoke result:
No real provider call made: yes
No raw provider data, token, prompt, output URL, or secret recorded: yes
Next recommended step:
```

## Validation

For documentation-only updates to this readiness package:

```bash
git diff --check
npm run check:quick
```

If a change touches smoke scripts, package scripts, GitHub Actions, runtime config, README runtime behavior, or provider route behavior, also run:

```bash
npm run smoke:creative-staging
npm run check:deploy
```

No validation command in this readiness package should require real provider credentials or real outbound provider alert channels.
