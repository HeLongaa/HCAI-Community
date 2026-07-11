# V1 Provider Cost And Budget Ledger

Task: V1-10

## Scope

V1-10 provides a Provider-independent application-side cost contract, immutable pricing snapshots, and durable budget accounting. It does not register a real Provider client, fetch live prices, reconcile Provider invoices, send real external alerts, or add RMB payment and withdrawal behavior.

## Money Precision

Provider money is persisted as integer micro-units: one currency unit equals `1,000,000` micros. Inputs accept at most six decimal places. Budget arithmetic uses `BigInt` in application code and `BIGINT` in PostgreSQL; JSON DTOs expose micros as decimal strings. This prevents floating-point accumulation from changing cap decisions.

Provider currency is an explicit three-letter code. Provider spend is never converted to or combined with creative credits, quota, points, or escrow.

## Pricing Snapshot

Every durable reservation binds to `provider-pricing-snapshot-v1`, which contains safe Provider, account, model, and workspace references; currency; billing unit; unit price in micros; calculator version; source metadata; timestamps; and a canonical SHA-256 snapshot hash.

The calculator rejects unsupported workspace units, unsafe identifiers, invalid precision, expired snapshots, and snapshot tampering. Fixture snapshots use explicit fixture sources. A missing or expired approved snapshot fails closed before paid dispatch.

## Durable State

`CreativeProviderBudgetWindow` is unique by budget scope, currency, and UTC window. It stores cap, reserved, spent, and released micros. `CreativeProviderCostLedger` is unique by stable source key and stores one generation attempt's estimate, actual, normalized usage, snapshot, status, and safe reconciliation reason.

Ledger states are:

- `reserved`: estimate is held before Provider dispatch
- `settled`: known actual cost is added to spent and the estimate hold is removed
- `released`: an explicitly confirmed non-billed attempt releases its hold
- `reconciliation_required`: billing evidence is missing or inconsistent, so the estimate remains held

Actual cost can exceed estimate or cap and is still recorded; future dispatch is then blocked by the window. Currency mismatch never settles into the window.

## Concurrency And Replay

Prisma reservation uses a transaction, a unique source key, and an optimistic budget-window update. Concurrent requests cannot all pass a stale read and exceed the cap. Duplicate reserve, settle, release, callback, polling, and replay operations reuse the existing ledger result.

Queued and running generations retain Provider budget, creative credit, and quota reservations until callback or polling. Provider cost closeout runs before internal credit/quota closeout, but the ledgers remain separate. Adapter execution or contract validation failures release pre-dispatch reservations. Failed or cancelled Provider results without actual cost enter reconciliation instead of being treated as free.

## Operations Evidence

Admin generation history exposes a safe durable cost summary: status, currency, estimate/actual, pricing hash preview, cap, reserved, spent, released, and safe reason code. Audit and Prometheus surfaces count only low-cardinality lifecycle fields such as Provider, workspace, currency, status, and reason. Generation IDs, ledger IDs, snapshot hashes, prompts, Provider payloads, URLs, and secrets are not metric labels.

## Runtime Boundary

The Replicate staging fixture is the first integration. Image, chat, video, and music calculator contracts are tested with fixture snapshots only. Real pricing sources, Provider account caps, dynamic kill switches, and circuit breakers remain disabled or deferred to V1-11/V1-14 approval work.

## Verification

Coverage includes six-decimal precision, four workspace billing-unit contracts, snapshot tampering, missing/mismatched currency, atomic cap enforcement, duplicate and concurrent reservations, actual overrun, settlement/release/reconciliation, queued callback closeout, Admin redaction, low-cardinality metrics, Seed/Prisma parity, Prisma validation, and full repository quality gates.

`npm audit --omit=dev` retains three moderate advisories from Prisma 7.8's development-tool dependency on `@hono/node-server`. The available automatic fix force-downgrades Prisma to 6.19.3, so V1-10 records the advisory without applying that breaking downgrade.
