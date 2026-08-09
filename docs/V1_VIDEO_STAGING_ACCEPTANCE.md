# V1 Video Staging Acceptance

V1-29 and AI-VIDEO-01 freeze the Video staging acceptance matrix. The machine-readable source of truth is
`config/v1-video-staging-gate.json`, verified by `npm run test:v1-video-staging`.

Current decision: **fixture acceptance, one credentialed HCAI Router Seedance application acceptance, and one
credentialed MiniMax Hailuo Router application acceptance are complete. Video capability is available in staging;
production remains no-go**. Runway remains a disabled backup shell and is never selected automatically.

## Executed Real Acceptance

On 2026-07-21, the bounded four-second acceptance completed once with `seedance-2.0-fast`. Router reported `SUCCESS`
after about 129 seconds and charged USD 0.484. MuseFlow downloaded one 665,431-byte `video/mp4` through the authenticated
content endpoint, verified the MP4, stored it without retaining the Provider URL or payload, completed a clean media
scan, allowed the owner download, denied an unrelated user, settled credits, and committed quota usage of 8. The Router
status response did not contain authoritative USD cost, so the application cost ledger correctly remains
`reconciliation_required` instead of inventing a settlement amount. The temporary acceptance credential was deleted.

On 2026-07-30, a scoped one-hour `MiniMax-Hailuo-2.3` key completed one six-second, 768P transport acceptance through
the Router task API. The task progressed from `queued` to `IN_PROGRESS` and `SUCCESS`; the authenticated Router content
proxy returned a 2,241,258-byte `video/mp4`, detected as H.264 at 1366x768 with a 5.875-second container duration and a
valid SHA-256 digest. Router deducted 136,986 quota units. Both temporary keys were disabled after verification.

The follow-up application fixture acceptance now executes the actual `/api/creative/generations` route and shared
asynchronous lifecycle. It proves exactly one create call and one authenticated output fetch, MP4 byte-identity
ingestion, explicit output-safety classification, scan-gated private release, owner-only download, settled credits,
product quota usage of 8, and conservative Provider-cost reconciliation for one six-second output. On 2026-08-01 the
same fixture transport completed against the real local PostgreSQL repository and real S3-compatible object storage
under the physical `images/` prefix. Output safety and scanning remained injected fixtures by explicit staging scope.

On 2026-08-04, the bounded MiniMax acceptance completed once through the real application lifecycle with one Provider
create call and one authenticated output fetch. It generated a six-second, 748,679-byte MP4, persisted the exact bytes
to real S3-compatible storage under `images/`, allowed `profile-veyn`, denied `profile-n8than`, settled Credit, committed
quota usage of 8, and retained conservative `reconciliation_required` Provider cost state. Router spend was about USD
0.274. The temporary allow classifier and mock scanner were explicitly approved for this staging run. The one-hour,
USD 1.20 credential was disabled immediately, removed from local environment storage, and all MiniMax network gates
were closed. The machine gate is `config/minimax-video-staging-gate.json`, verified by
`npm run test:minimax-video-staging`; production remains no-go.

Failure, timeout, retry-exhaustion, cancellation, partial-replay, user-visible failure, and rollback paths remain
deterministic fixture evidence; they were not repeated as paid external calls. Router cancellation is unsupported and
fails explicitly without changing job or accounting state.

## Executed Fixture Matrix

| Area | Required evidence |
| --- | --- |
| Request mapping | Stable `seedance-2.0-fast` Router request, one 720p MP4, bounded parameters |
| Ordered inputs | Governed source image; music video audio first and optional reference image second |
| Long-job lifecycle | Queued, running, completed, failed, cancelled, timed out, and retry exhausted |
| Replay recovery | Partial output-ingestion failure resumes without duplicate output or accounting |
| Accounting | Provider cost, credits, and quota settle, refund, release, or enter reconciliation exactly once |
| Output release | Bounded MP4 ingestion remains private through pending/review and downloads only after a clean scan |
| Product failures | Safe owner-visible failure and refresh-safe retry guidance without raw prompts or Provider errors |
| Operations | Safe audit, notification, metrics, and handoff evidence with unsafe identifiers folded or removed |
| Shutdown | Independent lifecycle switches default off; production smoke proves HTTP, workers, and traffic disabled |

The gate validates concrete evidence markers and runs the selected server fixtures. Browser acceptance remains in the
PR gate so application polling, cancellation, private preview, ordered input submission, and mobile layout are checked
against the product surface.

## Frozen Limits

- One Provider call per acceptance approval; the executable acceptance is fixed to four generated seconds.
- USD 1.20 per job, USD 20 daily, and USD 500 monthly application caps.
- A 900-second lifecycle timeout and three status attempts in the deterministic acceptance fixture.
- Output is one private `video/mp4`; Provider URLs and raw payloads are never durable evidence.

## Commands

- `npm run test:v1-video-staging`: validate the matrix and execute selected fixture tests.
- `npm run test:video-router-readiness`: validate the guarded client and application lifecycle with fixture transport.
- `npm run video:router:preflight`: fail-closed environment readiness check.
- `npm run video:router:acceptance`: one real four-second staging call after the approval envelope passes.
- `npm run test:minimax-video-staging`: validate MiniMax transport and application-lifecycle fixture evidence.
- `npm run minimax-video:preflight`: fail-closed MiniMax target-staging environment check.
- `npm run minimax-video:acceptance`: one real six-second application call after the MiniMax approval envelope passes.
- `CI=1 npm run check:pr`: run all contracts, server tests, build, Prisma validation, and browser acceptance.
- `npm run smoke:production`: prove production remains Provider-disabled.

## External-Call Boundary

AI-VIDEO-01 adds a dependency-free Router client for task creation, polling, and authenticated private content reads.
Router exposes no public video cancellation endpoint, so cancellation fails explicitly and leaves job and billing
state unchanged. Construction requires production process semantics in a dedicated staging runtime, independent
HTTP/network switches, the literal `staging-only` confirmation, a scoped Router key, and the fixed Router base URL.
The real acceptance additionally requires approver, expiry, one-call/four-second limits, Provider and application
caps, operational owners, and production no-go.

Safe rehearsal evidence may include application generation and media ids, normalized states, timestamps, byte count,
checksum presence, scan state, generated seconds, reconciled cost, workflow URL, and rollback result. It must not
include credentials, raw prompts, input/output bytes, raw Provider payloads, private URLs, or unbounded error text.
