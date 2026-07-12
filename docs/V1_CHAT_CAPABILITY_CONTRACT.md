# V1 Chat Capability Contract

This document closes the implementation-planning portion of V1-20. The executable source of truth is
`server/src/creative/chatCapabilityContract.js`.

Current decision: **the Chat contract is frozen; encrypted application-owned conversations, governed attachment
metadata, explicit product context, and application-classified Mock SSE streaming are implemented. Attachment-byte
reads, real Provider calls, the production Chat UI, and production enablement remain unavailable**.

## Provider Decision

| Role | Provider | Model | Runtime state |
| --- | --- | --- | --- |
| Primary | OpenAI | GPT-5.6 Terra (`gpt-5.6-terra`) | Catalog metadata only; adapter and client not implemented |
| Backup | Anthropic | Claude Sonnet 5 (`claude-sonnet-5`) | Catalog metadata only; separately approved backup |

The primary uses the Responses API with streaming, `store=false`, and background mode disabled. The application owns
conversation state. Provider conversation ids are not persisted or trusted as the source of truth.

The backup is never an automatic retry or failover target. It requires prompt, response, safety, and schema parity,
accepted US storage and retention terms, an independent budget, and separate approval.

## Product Modes And Parameters

The V1 contract contains `assistant`, `prompt_assist`, and `storyboard` modes. All modes accept only:

- `maxOutputTokens`: integer from `1` through `8192`, default `2048`.
- `responseFormat`: fixed to `text` for V1.

Provider state controls such as `store`, `background`, raw Provider event formats, user-defined tools, and arbitrary
model parameters are not accepted from clients.

## Context Boundary

- Maximum input context: `32768` tokens.
- Maximum output: `8192` tokens.
- Maximum messages included in one turn: `100`.
- Maximum characters in one message: `12000`.
- Maximum system-instruction characters: `8000`.
- Overflow fails before Provider dispatch; the server does not silently remove old messages.
- Cross-user context, implicit Admin/audit context, secrets, private URLs, and unrelated account data are forbidden.
- Product context must be explicitly selected by the user and re-authorized at read time.

The app cap deliberately remains below Provider long-context pricing thresholds. Long-context pricing is unavailable in
V1 until a later contract changes both the token and budget policies.

## Attachments

V1-22 accepts at most five
owner-accessible, scan-clean `task_attachment` or `library_asset` items, with 20 MiB per item and 40 MiB total. Allowed
types are plain text, Markdown, PDF, PNG, JPEG, and WebP. No attachment bytes may be sent before ownership, purpose,
MIME, size, scanner, region, and content-policy checks pass. The Mock-only V1-22 path resolves and persists safe
attachment references and metadata but deliberately does not read or transmit object bytes; byte extraction and
Provider transfer remain part of the separately approved V1-24 boundary.

## Persistence And Privacy

- Full user and assistant messages are application-owned restricted data, encrypted at rest, owner-scoped, exportable,
  and revocable immediately when deletion is accepted.
- Inactive conversations have a maximum 365-day application retention; physical deletion completes within 30 days of
  an accepted user/account deletion request unless a scoped legal or safety hold applies.
- The machine-readable governance mapping is `chat_conversation_messages` under `chat_inactive_plus_365d`. Deletion
  replay remains active across restores until rolling backups expire no later than 35 days after primary purge.
- Raw Provider request/response payloads and Provider conversation ids are never persisted.
- OpenAI application state remains off with `store=false` and background mode disabled.
- OpenAI default abuse-monitoring retention is treated as up to 30 days. Production requires approved ZDR or Modified
  Abuse Monitoring posture, contract evidence, and a supported deployment/user footprint.
- Anthropic API input/output retention is treated as up to 30 days with documented exceptions. US storage and region
  implications require explicit approval before backup use.
- Neither Provider may train on customer content by default under the accepted contract configuration.

V1-21 implements `ChatConversation`, `ChatTurn`, `ChatMessage`, and `ChatDeletionTombstone`. Message bodies use
versioned AES-256-GCM application encryption with conversation/message identity as authenticated additional data.
History is owner-scoped, turn submission is idempotent, and readable content is produced only after authenticated
decryption. The configured key ring supports key rotation without storing key material in PostgreSQL.

V1-22 adds only selected attachment ids, selected product-context references, and identity-free safety evidence to
`ChatTurn`. Product-context bodies are re-authorized and read from their owning Task or Library record for each new
turn; they are not copied into the Chat row, safety record, audit event, or Admin review.

## Safety And Tools

Input messages and selected context are classified before dispatch. Unknown safety results block. Streaming output may
be released only after application classification; no more than 512 unclassified characters may be buffered, and an
unsafe/refused stream stops with a stable safe reason. Direct identity may not be included in the stable safety id.

The risk taxonomy and dispositions come from `config/v1-content-safety-policy.json`. Tools are disabled in V1-20. A
later tool implementation must use a server-owned allowlist, validate arguments before execution, and re-evaluate tool
results before returning them to the model or user.

## Cost And Failure Behavior

- Provider spend is separate from creative credits, points, quota, escrow, and refunds.
- Per-turn cap: USD `0.10`; daily cap: USD `25`; monthly cap: USD `600`.
- A bounded token estimate, current pricing snapshot, currency, budget evidence, and Provider control evidence are
  required before dispatch.
- Missing or stale evidence, cap exhaustion, unsupported region, open circuit, timeout exhaustion, or unavailable
  safety checks fail closed without automatic backup routing.
- User stop aborts the stream/request and records an application-owned canceled turn without inventing a completed
  answer.

## Handoff

V1-21 implements the authenticated SSE API, application conversation/message persistence, idempotent turn creation,
stop behavior, disconnect recovery, CreativeGeneration quota/credit closeout, owner-scoped history, inactivity cleanup,
and restore-deletion tombstones. Its stream adapter is Mock-only and all emitted chunks carry explicit fixture safety
classification.

V1-22 implements attachment metadata authorization, selected product context, input classification, bounded streaming
classification, safe partial output, and minimal Admin review evidence. V1-23 implements the production Chat UI with
history recovery, SSE rendering, stop, governed inputs, deletion, and appeal entry. V1-24 owns attachment-byte reading,
real Provider clients, and staging acceptance.

No V1-20 through V1-22 validation command requires a Provider credential or network call.
