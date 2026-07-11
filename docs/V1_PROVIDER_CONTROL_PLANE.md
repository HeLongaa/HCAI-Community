# V1 Provider Control Plane

## Decision

V1-11 implements an application-side, fail-closed Provider control plane. It does not register a real Provider adapter,
pricing source, Provider-side cap reader, network probe, or fallback client. Ordinary continuation or deployment does not
approve real Provider traffic.

## Dispatch Gate

New dispatch checks controls in this order: global, Provider/account, workspace, and model family. Global and Provider
control records are mandatory. Unknown required state, missing or invalid cap evidence, unknown circuit state, an open
circuit, or an unclaimed half-open probe blocks dispatch before Provider budget reservation and adapter execution.

The gate is injected only into fixture dispatch wiring. Callback handling, polling, lifecycle replay, output ingestion,
and accounting closeout continue for jobs that already exist, so an emergency stop does not strand durable work.

## Durable State

- `CreativeProviderControlState` stores versioned enable state and safe reason codes by scope.
- `CreativeProviderCapEvidence` stores immutable integer-micros caps, expiry, source/evidence hashes, and no raw console
  URL or screenshot.
- `CreativeProviderCircuitState` stores closed/open/half-open state, bounded failure windows, cooldown, and a hash-only
  one-claim probe lease.
- `CreativeProviderCircuitEvent` deduplicates normalized outcomes by source key.

Timeouts, HTTP 429, Provider 5xx, and explicit Provider incidents count toward opening. Validation, content-policy,
user, local, and other ignored failures do not. Open circuits never close automatically.

## Operator Workflow

1. An operator with `admin:creative:provider-control:manage` may disable an existing control immediately.
2. The same permission may record new immutable, expiring Provider cap evidence.
3. Enable, half-open, and close transitions require a recovery request from an operator with
   `admin:creative:provider-control:recover`.
4. A different operator with both recovery and queue-review permissions must approve the request.
5. Half-open issues one short-lived probe token; storage retains only its hash and one dispatch may claim it.
6. Closing requires durable successful probe evidence. A successful probe does not auto-close the circuit.

## Safe Interfaces

Admin responses omit Provider account references, raw evidence, source references, full hashes, and probe tokens.
Audit serialization allowlists low-cardinality control fields. Operations metrics expose aggregate blocks, circuit opens,
recovery decisions, cap evidence expiry, Provider/workspace/status/reason counts, and matching Prometheus gauges.

Routes:

- `GET /api/admin/creative/provider-controls`
- `POST /api/admin/creative/provider-controls/disable`
- `POST /api/admin/creative/provider-controls/cap-evidence`
- `POST /api/admin/creative/provider-controls/recovery-requests`

## Recovery And Rollback

Emergency rollback is a version-checked disable at global or Provider scope. Do not delete state or manually alter the
database. Investigate low-cardinality audit/metrics evidence, replace expired cap evidence, wait for the configured
cooldown, request half-open, run exactly one approved fixture probe, and request close only after its durable success.

Any future real Provider integration must separately approve and register the Provider client, pricing source,
Provider-side cap API, probe implementation, credential scope, traffic limit, and rollback owner.

## Verification

```bash
npm --prefix server run db:generate
npm --prefix server test
npm run check:quick
npm run build
cd server && npx prisma validate --schema ./prisma/schema.prisma
git diff --check
```
