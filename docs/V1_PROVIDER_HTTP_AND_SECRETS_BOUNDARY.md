# V1 Provider HTTP and Secrets Boundary

Task: V1-05

This baseline introduces a real HTTP client factory for the existing `replicate-staging` shell without registering it
on the default creative generation route or performing a real Provider call. The factory is fail-closed and remains
disabled in local development, tests, CI, production smoke, and ordinary staging work.

## Delivered Boundary

- `server/src/creative/providerHttpClient.js` owns the network-capable client and reads the API token directly from the
  runtime environment. Callers cannot pass a token argument, and returned client/config objects never contain it.
- Only `replicate-staging` is recognized. Unknown Provider ids fail before environment parsing or network setup.
- The Provider base URL and FLUX 1.1 Pro endpoint are fixed in code. User input cannot select a host, URL, path, or model.
- The outbound JSON body contains only `prompt`, `aspect_ratio`, `seed`, and `style_preset` under `input`. Adapter
  metadata, callback URLs, raw payload fields, credentials, and unknown input fields are rejected or omitted.
- Secret-like keys and values fail before the injected fetch implementation is called.
- Provider failure bodies and network exceptions are converted to bounded internal errors without raw payloads, URLs,
  credentials, or Provider messages.
- Provider responses exist only in adapter memory and must be normalized through the existing adapter contract before
  any durable record, Admin view, notification, audit event, or log is written.

## Enablement Contract

The client can be constructed only when all of these conditions are true:

| Setting | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `CREATIVE_PROVIDER_RUNTIME_ENV` | `staging` |
| `CREATIVE_PROVIDER_MODE` | `replicate_staging` |
| `CREATIVE_STAGING_IMAGE_PROVIDER` | `replicate` |
| `CREATIVE_STAGING_PROVIDER_CONFIRMATION` | `staging-only` |
| `CREATIVE_STAGING_PROVIDER_API_TOKEN` | Present in deployment secrets |
| `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED` | Exact string `true` |

`CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED` defaults to `false` and accepts only `true` or `false`. It is a construction
guard, not an approval record. The production smoke profile allows only `mock` or `disabled` Provider mode and requires
the HTTP client flag to remain false.

## Route and Approval Boundary

- `POST /api/creative/generations` still executes only the mock provider or an explicitly injected fixture adapter.
- `replicate-staging` remains `enabled=false`, `default=false`, and `adapterImplemented=false` in the public catalog.
- `httpClientImplemented=true` reports engineering capability; `networkCallsEnabled` reports only the guarded env state.
- No Provider callback route, default polling client, cancellation client, or manual replay endpoint is added by V1-05.
- No real external call may run until V1-14 records the exact Provider, environment, call count, budget cap, expiry,
  token owner, kill-switch owner, rollback owner, current Chinese Notion evidence, and explicit user approval.

## Verification

```bash
node --test server/src/config/env.test.js server/src/creative/providerHttpClient.test.js server/src/creative/generationService.test.js
npm run smoke:creative-staging
npm run smoke:production
npm run check:deploy
```

All automated client tests inject `fetch`; they do not use the network or a real Provider credential.
