# V1 Chat Provider Boundary

V1-24 implements the Chat Provider code boundary without authorizing a real external call. The normal product and
production-smoke path remains `CHAT_PROVIDER_MODE=mock`.

## Implemented

- Fixed OpenAI `https://api.openai.com/v1/responses` mapping for `gpt-5.6-terra`.
- Streaming SSE projection with an event allowlist, explicit completion, refusal/failure mapping, response MIME checks,
  timeout/abort cleanup, `store=false`, and `background=false`.
- Structured input and output safety decisions using a closed JSON schema and application policy reason codes.
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
- `CHAT_OPENAI_API_TOKEN` configured only in the approved staging secret store
- `CHAT_ATTACHMENT_BYTES_ENABLED=true` only when attachment transfer is approved
- Provider global/provider controls, cap evidence, and circuit state allow dispatch

Any partial or inconsistent configuration fails closed. The base URL cannot be redirected to another host.

## Still Disabled

- Real Chat Provider calls under ordinary development, CI, production smoke, or ordinary continuation language.
- Production Chat Provider enablement.
- Anthropic backup client and automatic failover.
- Tools, user-defined tools, background jobs, and Provider-owned conversation state.
- Raw Provider payload retention, Provider conversation-id persistence, and attachment-byte persistence.

## Validation

All V1-24 tests use local `Response` fixtures or injected `fetch`. No validation command requires a Provider token and no
real network request was made. A first Chat staging call requires a new explicit go/no-go package; the existing Image
rehearsal approval scope does not cover Chat.
