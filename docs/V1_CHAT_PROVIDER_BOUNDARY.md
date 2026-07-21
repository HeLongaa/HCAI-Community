# V1 Chat Provider Boundary

V1-24 implements the Chat Provider code boundary without authorizing a real external call. The normal product and
production-smoke path remains `CHAT_PROVIDER_MODE=mock`.

## Implemented

- Database-selected OpenAI-compatible endpoint and model mapping for `gpt-5.6-terra`.
- Deployment-selectable `responses` and `chat_completions` API dialects; HCAI Router staging uses `chat_completions`.
- Streaming SSE projection with an event allowlist, explicit completion, refusal/failure mapping, response MIME checks,
  timeout/abort cleanup, `store=false`, and `background=false`.
- Output safety classification uses the frozen 512-character unclassified buffer instead of one paid classification per
  Provider delta; only complete input, generation, and output usage is settled, while stopped/partial usage reconciles.
- Structured or strict-text JSON safety decisions using closed application policy reason codes. Text mode changes only
  the Provider request format; malformed or unknown decisions still fail closed.
- Bounded signed S3 attachment reads with exact-size, strict UTF-8, and magic-MIME validation.
- In-memory text, image data URL, and PDF data URL Provider inputs; no attachment bytes or raw Provider payloads are
  persisted.
- Provider control-plane preflight and atomic USD budget reservation before the first classifier request.
- Conservative cost estimate covering input classification, buffered output classification, and answer generation.
- Closeout from combined classifier and generation token usage; missing metered usage enters reconciliation.
- Mock, disabled, and OpenAI staging runtime modes with injected-fetch tests.

## Runtime Gates

Every OpenAI Chat gate must be explicit:

- `NODE_ENV=production`
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`
- `CHAT_PROVIDER_MODE=openai_staging`
- `CHAT_OPENAI_HTTP_CLIENT_ENABLED=true`
- `CHAT_OPENAI_NETWORK_CALLS_ENABLED=true`
- `CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED=true`
- `CHAT_OPENAI_CONFIRMATION=staging-only`
- `CHAT_OPENAI_API_DIALECT=responses|chat_completions`
- `CHAT_OPENAI_SAFETY_RESPONSE_FORMAT=json_schema|text`
- `CHAT_OPENAI_API_TOKEN` configured only in the approved staging secret store
- `CHAT_ATTACHMENT_BYTES_ENABLED=true` only when attachment transfer is approved
- Provider global/provider controls, cap evidence, and circuit state allow dispatch

Any partial or inconsistent configuration fails closed. The configured endpoint must be safe HTTPS and redirects are rejected.

## Still Disabled

- Real Chat Provider calls under ordinary development, CI, production smoke, or production product traffic.
- Production Chat Provider enablement.
- Anthropic backup client and automatic failover.
- Tools, user-defined tools, background jobs, and Provider-owned conversation state.
- Raw Provider payload retention, Provider conversation-id persistence, and attachment-byte persistence.

## Validation

Automated tests use local `Response` fixtures or injected `fetch` and require no Provider token. Credentialed staging
acceptance is a separate explicit command and never runs in ordinary CI.

The dedicated readiness commands are:

```bash
npm run test:chat-openai-readiness
npm run test:chat-openai-readiness:integration
npm run chat:openai:preflight
CHAT_OPENAI_LIVE_SMOKE_CONFIRMATION=real-staging-call npm run chat:openai:live-smoke
CHAT_OPENAI_LIVE_SMOKE_CONFIRMATION=real-staging-acceptance npm run chat:openai:acceptance
```

`preflight` parses all staging gates and reports only low-cardinality safe metadata. It does not construct a client or
make a network request. `live-smoke` additionally requires the one-run confirmation value and performs minimal input
safety, streaming, output safety, and abort acceptance. It never prints prompts, generated text, credentials, raw
Provider responses, or account data. The live command remains blocked until a dedicated staging token is mounted.

HCAI Router was accepted with a dedicated `gpt-5.6-terra`-only key, `chat_completions`, and strict text JSON safety.
The five-call application acceptance proved streaming, stop, encrypted history, text attachment, product context,
input/output safety, metered completion settlement, and stopped-cost reconciliation while production remained disabled.

The live gate also requires a Chat-specific approval decision and reference, a named approver, an expiry within 24
hours, the dedicated `chat-staging` environment, exactly four maximum Provider calls, a Provider-side cap no greater
than USD 5, an app-side smoke budget no greater than USD 0.25, named token-rotation/kill-switch/rollback owners, and an
explicit production no-go statement. Missing approval metadata exits before constructing the Provider client.

The full `acceptance` mode allows exactly five calls: input classification, one short streamed completion, final output
classification, a second input classification, and a streamed request aborted through the application stop path. It
also proves encrypted history, one bounded text attachment, one explicit product-context reference, complete usage
settlement, and reconciliation of incomplete stopped usage through the actual Chat service and Provider control plane.
