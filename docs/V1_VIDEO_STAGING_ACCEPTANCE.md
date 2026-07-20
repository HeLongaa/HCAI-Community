# V1 Video Staging Acceptance

V1-29 and AI-VIDEO-01 freeze the Video staging acceptance matrix. The machine-readable source of truth is
`config/v1-video-staging-gate.json`, verified by `npm run test:v1-video-staging`.

Current decision: **fixture and guarded application acceptance are complete; a real Google Veo call is blocked by
Google Cloud credentials, the private GCS output prefix, and the short-lived acceptance envelope. Production remains
no-go**. Runway remains a disabled backup shell and is never selected automatically.

## Executed Fixture Matrix

| Area | Required evidence |
| --- | --- |
| Request mapping | Stable `veo-3.1-fast-generate-001` Vertex request, one 720p MP4, bounded parameters |
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
- `npm run test:video-google-readiness`: validate the guarded client and application lifecycle with fixture transport.
- `npm run video:google:preflight`: fail-closed environment readiness check.
- `npm run video:google:acceptance`: one real four-second staging call after the approval envelope passes.
- `CI=1 npm run check:pr`: run all contracts, server tests, build, Prisma validation, and browser acceptance.
- `npm run smoke:production`: prove production remains Provider-disabled.

## External-Call Boundary

AI-VIDEO-01 adds a dependency-free Vertex REST client for create, fetch-operation, cancel, and authenticated private GCS
download. Construction requires production process semantics in a dedicated staging runtime, independent HTTP/network
switches, the literal `staging-only` confirmation, a short-lived access token, an allowlisted project and region, and a
private GCS prefix. The real acceptance additionally requires approver, expiry, one-call/four-second limits, Provider
and application caps, operational owners, and production no-go.

Safe rehearsal evidence may include application generation and media ids, normalized states, timestamps, byte count,
checksum presence, scan state, generated seconds, reconciled cost, workflow URL, and rollback result. It must not
include credentials, raw prompts, input/output bytes, raw Provider payloads, private URLs, or unbounded error text.
