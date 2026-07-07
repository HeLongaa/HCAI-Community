# Real Provider Callback And Polling Prerequisites

This document defines the prerequisites for enabling real-provider webhooks, callback routes, polling workers, or manual lifecycle replay for creative generation.

Current decision: **fixture-safe polling worker interval wiring exists, but real provider callbacks, default provider status polling, manual replay endpoints, and real provider network calls remain no-go until a separate approved external-call task**.

The current real-provider boundary handoff is summarized in `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`. This prerequisite document controls callback, polling, and manual replay enablement; the external-call approval package controls any first real provider network call.

This package does not add a provider SDK, default HTTP client, webhook endpoint, manual replay endpoint, provider network call, Admin mutation endpoint, payment refund flow, or production paid-provider path. The polling worker interval skeleton is disabled by default and only accepts injected mocked status clients.

Implementation status: the repository now has a durable replay ledger schema/repository foundation, a pure lifecycle replay reducer, provider callback auth/parser pure functions, provider polling lease/stop-condition pure functions, provider lifecycle side-effect plan/executor pure functions, fixture-only replay-ledger integration helpers that record side-effect plans/results without provider credentials, mocked provider-status client contract tests that require an injected client, provider lifecycle notification/audit repository wiring behind stable source keys, manual replay authorization/parser pure functions, and fixture-safe polling worker interval wiring. Provider callback routes, default provider status HTTP clients, manual replay endpoints, and real provider network calls remain disabled and unimplemented.

## Scope

Covered event sources:

- Provider webhook or callback delivery.
- Provider polling worker status reads. Current tests cover an injected mocked provider-status client contract and disabled-by-default worker wiring only; no default HTTP client or real provider network call is enabled.
- Manual replay from an operator-controlled internal tool or script.
  Current tests cover authorization/parser envelope construction only; no route, endpoint, worker, or side-effect execution path is enabled.

Covered safety boundaries:

- Authentication and signing.
- Durable replay ledger.
- Lifecycle idempotency.
- Side-effect safety.
- Worker and route kill switches.
- Audit and observability events.
- Tests required before implementation.

Still out of scope:

- Real paid provider execution.
- Production paid-provider enablement.
- Admin retry, cancel, refund, force-review, or manual settlement controls.
- Payment-provider billing reconciliation.
- Public beta traffic.
- Video, music, chat, or batch provider workflows.

## Current Safe Boundary

The repository remains mock-provider only. The `replicate_staging` mode exposes a staging-only, image-only provider shell as safe metadata with `networkCallsEnabled=false`.

Any future callback or polling implementation must preserve these rules:

- Default local and CI paths use the mock provider or disabled provider mode.
- Production denies staging provider tokens, staging preflight flags, and staging adapter modes.
- CI fixture gates do not require real provider credentials.
- Provider payloads, tokens, raw prompts, and raw provider responses are not stored in logs, Notion, screenshots, PR bodies, or audit metadata.
- Provider outputs cannot bypass media scan governance.
- Admin generation history remains read-only unless a separate mutation phase is approved.

## Event Source Contract

Every lifecycle event must normalize into one internal event envelope before it mutates generation state.

Required envelope fields:

| Field | Purpose |
| --- | --- |
| `sourceType` | `webhook`, `polling`, or `manual_replay` |
| `providerId` | Safe provider id, for example `replicate` |
| `providerMode` | Runtime mode, for example `replicate_staging` |
| `generationId` | Internal durable generation id |
| `providerRequestId` | Safe provider request id, when available |
| `providerJobId` | Safe provider job or prediction id |
| `providerStatus` | Raw provider lifecycle status enum after redaction |
| `normalizedStatus` | Internal lifecycle state |
| `occurredAt` | Provider event timestamp, if trusted |
| `receivedAt` | App receive timestamp |
| `payloadHash` | Stable hash of the canonical redacted payload |
| `idempotencyKey` | Stable key used by the replay ledger |
| `actor` | `provider`, `polling_worker`, or approved internal operator |

The envelope must be created before applying side effects. Unsafe or unauthenticated events should still emit safe audit evidence, but they must not create provider jobs, media assets, quota commits, credit settlements, or notifications.

## Authentication Boundary

### Webhook Or Callback Route

Before enabling a provider callback route:

- Require provider-supported signatures when available.
- Require timestamped HMAC validation for app-managed callback secrets.
- Reject missing, malformed, expired, or future-skewed timestamps.
- Enforce a replay window, with the default target no greater than 5 minutes unless provider constraints require otherwise.
- Enforce a strict request body size limit.
- Parse content type explicitly.
- Reject unknown provider ids, unsupported event types, and unsupported adapter modes.
- Do not log raw headers, raw payloads, tokens, signatures, prompts, or provider output URLs.
- Store only safe ids, redacted error previews, hashes, and low-cardinality metadata.

### Polling Worker

Before enabling a polling worker:

- Require a dedicated staging provider token stored only in deployment secrets.
- Use worker leases so only one worker applies a given generation lifecycle event at a time.
- Separate provider dispatch enablement from polling enablement.
- Rate-limit provider status reads.
- Keep provider-status clients injected and disabled by default until the external-call approval package explicitly authorizes a concrete HTTP client.
- Stop polling terminal generations.
- Stop polling when the generation is cancelled, expired, missing, or no longer mapped to the expected provider job id.
- Fail closed when cost budget caps, provider mode checks, or runtime environment checks are invalid.

### Manual Replay

Before enabling manual replay:

- Restrict access to approved internal operators.
- Require an explicit reason code.
- Require a target generation id and provider job id match.
- Reject unsafe manual replay payloads that include raw provider payloads, raw prompts, output URLs, or provider responses.
- Reject terminal-state reopen attempts unless a separate Admin mutation phase explicitly defines that behavior.
- Use the same replay ledger and lifecycle reducer as webhook and polling events.
- Return no-op for duplicate or stale replay attempts.
- Emit audit events for accepted, rejected, and no-op replays.

Manual replay must not become an Admin mutation shortcut for retry, refund, force-review, or manual settlement.

## Durable Replay Ledger

Callback, polling, and manual replay must write through a durable replay ledger before applying side effects.

Minimum ledger fields:

| Field | Requirement |
| --- | --- |
| `id` | Durable ledger id |
| `generationId` | Internal generation id |
| `providerId` | Safe provider id |
| `providerMode` | Runtime mode |
| `providerJobId` | Provider job id |
| `sourceType` | `webhook`, `polling`, or `manual_replay` |
| `providerEventId` | Provider event id if present |
| `idempotencyKey` | Unique key for replay suppression |
| `payloadHash` | Canonical redacted payload hash |
| `previousStatus` | Generation status before reducer |
| `normalizedStatus` | Event status after provider mapping |
| `action` | `applied`, `ignored`, `rejected`, or `noop` |
| `reasonCode` | Stable reason, for example `duplicate_terminal` |
| `sideEffectPlan` | Safe summary of intended side effects |
| `sideEffectResult` | Safe summary of applied side effects |
| `receivedAt` | App receive timestamp |
| `appliedAt` | Timestamp if lifecycle mutation was applied |
| `errorPreview` | Redacted failure preview, if any |

Unique constraints should cover at least:

- Provider event id when available.
- Provider job id plus normalized status plus payload hash.
- Internal generation id plus idempotency key.

## Lifecycle Idempotency Matrix

| Incoming state | Current state | Expected action | Side-effect rule |
| --- | --- | --- | --- |
| `queued` / `starting` | missing generation | reject | No side effects |
| `queued` / `starting` | `queued` | no-op | Do not duplicate audit/notification beyond replay audit |
| `queued` / `starting` | `running` | stale no-op | Do not roll lifecycle backward |
| `running` / `processing` | `queued` | apply running | No output, quota commit, or credit settlement |
| `running` / `processing` | `running` | duplicate no-op | Do not duplicate audit/notification beyond replay audit |
| `running` / `processing` | terminal | stale no-op | Do not reopen terminal state |
| `succeeded` / `completed` | non-terminal | apply completed | Persist outputs once, commit quota once, settle credits once |
| `succeeded` / `completed` | completed | duplicate terminal no-op | Do not persist outputs or settle credits again |
| `failed` | non-terminal | apply failed | Release quota and refund credits only through idempotent ledgers |
| `failed` | failed | duplicate terminal no-op | Do not refund twice |
| `cancelled` / `canceled` | non-terminal | apply cancelled | Release/refund only when policy says provider work did not bill |
| `cancelled` / `canceled` | cancelled | duplicate terminal no-op | Do not release/refund twice |
| any | provider job id mismatch | reject | No side effects |
| any | unsupported provider status | reject | No side effects |

Terminal states must not be reopened by callback, polling, or manual replay unless a separate Admin mutation phase defines permissions, reducer behavior, and idempotent accounting semantics.

## Side-Effect Safety

The lifecycle reducer must produce an explicit side-effect plan before anything mutates durable state.

Required protections:

- Output persistence runs once per provider job result.
- Media assets are not duplicated on callback or polling replay.
- Media downloads remain scan-gated.
- Quota reservations are committed or released once.
- Creative credit reservations are settled or refunded once.
- Provider cost metadata is recorded without changing product credit balances.
- Notifications are deduplicated by stable source id.
- Audit events use stable low-cardinality event names and safe metadata.
- Partial side-effect failures are recoverable through replay no-op or retry-safe operations, not manual database edits.

If output persistence succeeds but credit settlement fails, the replay path must identify the existing output assets and continue only the missing idempotent side effect. If credit settlement succeeds but notification creation fails, replay must not settle credits again.

## Kill Switches

Callback and polling enablement must have kill switches separate from provider dispatch.

Application kill switches:

- `CREATIVE_PROVIDER_MODE=disabled`.
- Provider registry dispatch disabled.
- Callback route disabled or returns reject/no-op without side effects.
- Polling worker disabled.
- Manual replay disabled.
- App-side provider budget cap set to `0`.
- Staging preflight disabled.

Provider-side kill switches:

- Revoke or rotate staging provider token.
- Lower provider-side spending cap to `0`.
- Disable provider webhook targets.
- Disable model access if the provider console supports it.

Verification after a kill switch:

1. Run the relevant smoke profile.
2. Confirm `GET /api/creative/providers` exposes no enabled real provider.
3. Confirm `POST /api/creative/generations` cannot dispatch to a paid provider.
4. Confirm callback and polling paths cannot apply lifecycle side effects.
5. Confirm no provider token or raw payload appears in logs, smoke output, audit events, or Notion.

## Audit Events

Required audit event families before implementation:

- `creative.provider_callback.accepted`
- `creative.provider_callback.rejected`
- `creative.provider_callback.duplicate_suppressed`
- `creative.provider_polling.status_fetched`
- `creative.provider_polling.rejected`
- `creative.provider_replay.noop`
- `creative.provider_replay.applied`
- `creative.provider_replay.provider_mismatch`
- `creative.provider_replay.stale_ignored`
- `creative.provider_lifecycle.side_effect_failed`
- `creative.provider_lifecycle.side_effect_applied`

Audit metadata must stay safe:

- Use provider ids, generation ids, provider job ids, status names, reason codes, and booleans.
- Do not include provider tokens, signatures, raw payloads, raw prompts, raw output URLs, or full provider error bodies.
- Avoid high-cardinality metrics labels for generation ids, provider job ids, prompt hashes, raw errors, and user ids.

## Tests Required Before Implementation

Callback and polling code cannot be enabled until targeted tests cover:

- Signature validation accepts valid timestamped signatures.
- Signature validation rejects missing, malformed, stale, future-skewed, and mismatched signatures.
- Request body and content-type guards reject unsafe callback payloads.
- Polling worker lease plan prevents duplicate side-effect application across instances.
- Polling worker stop-condition plan stops terminal, mismatched, expired, missing, unsafe-runtime, unsupported-provider, or missing-job generations.
- Mocked provider-status client contract maps provider status reads into safe polling envelopes without real credentials or network calls.
- Mocked provider-status client contract rejects missing jobs, job mismatches, rate limits, timeouts, and unsafe error previews without lifecycle replay.
- Manual replay authorization/parser tests require approved operator permissions, explicit reason codes, generation/provider/job matches, safe metadata, and terminal reopen rejection without route wiring.
- Lifecycle reducer maps queued, running, completed, failed, and cancelled provider states.
- Duplicate terminal replay returns no-op.
- Duplicate non-terminal replay returns no-op.
- Stale lifecycle replay returns no-op.
- Provider job id mismatch rejects without side effects.
- Output persistence has a stable side-effect operation key and is not duplicated after partial replay.
- Quota commit/release has stable side-effect operation keys and is not duplicated after partial replay.
- Credit settlement/refund has stable side-effect operation keys and is not duplicated after partial replay.
- Notification and audit source ids are represented as stable side-effect operation keys and persisted with source-key dedupe in repository tests.
- Partial side-effect failure can be replayed without duplicating completed side effects in fixture executor and replay-ledger integration tests.
- Fixture integration tests write replay ledger plans/results using mocked provider data only.
- CI passes without real provider credentials.

## No-Go Checklist

No-go for provider callback, polling, or manual replay if any are true:

- Real provider external-call approval is missing or implied.
- Notion task is missing, stale, or not written in Chinese.
- Callback signing or polling authentication is undefined.
- Durable replay ledger does not exist.
- Lifecycle reducer does not return explicit no-op actions for duplicates and stale events.
- Provider job id mismatch can mutate generation state.
- Any side effect can run outside idempotent quota, credit, media, notification, or audit boundaries.
- Callback route or polling worker has no independent kill switch.
- Admin mutation recovery is required for expected failures.
- CI requires real provider credentials.
- Provider output can bypass media scan governance.
- Provider tokens, raw payloads, raw prompts, or raw output URLs would be logged or stored.

## Handoff To Future Implementation

A future implementation task should continue from the mocked-client status contract, repository-backed lifecycle notification/audit wiring, and manual replay auth/parser envelope:

1. Keep worker interval wiring fixture-safe and disabled by default until an external-call task explicitly approves a real status client.
2. Add callback route wiring only after auth/parser tests, replay ledger, lifecycle reducer, side-effect executor, notification/audit repository wiring, and manual replay envelope tests all pass.
3. Add smoke and quality-gate documentation only after the route or worker exists.
4. Complete the external-call approval package before any real provider network call.
5. Keep `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`, this document, and `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` in sync whenever the boundary changes.

Do not broaden to production, Admin mutation controls, video/music/chat providers, or payment-provider reconciliation during the first callback/polling implementation.
