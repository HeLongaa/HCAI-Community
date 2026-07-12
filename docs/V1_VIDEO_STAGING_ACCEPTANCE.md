# V1 Video Staging Acceptance

V1-29 freezes and executes the fixture-only Video staging acceptance matrix. The machine-readable source of truth is
`config/v1-video-staging-gate.json`, verified by `npm run test:v1-video-staging`.

Current decision: **fixture acceptance is complete; real Google Veo calls and production enablement are no-go**.
Runway remains a disabled backup shell and is never selected automatically. Ordinary continuation language is not
approval for Provider HTTP, credentials, paid traffic, or production switches.

## Executed Fixture Matrix

| Area | Required evidence |
| --- | --- |
| Request mapping | Fixed Veo 3.1 Fast request shape, one 720p MP4, bounded parameters, injected client only |
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

- One future Provider call per approval, maximum eight generated seconds.
- USD 1.20 per job, USD 20 daily, and USD 500 monthly application caps.
- A 900-second lifecycle timeout and three status attempts in the deterministic acceptance fixture.
- Output is one private `video/mp4`; Provider URLs and raw payloads are never durable evidence.

## Commands

- `npm run test:v1-video-staging`: validate the matrix and execute selected fixture tests.
- `CI=1 npm run check:pr`: run all contracts, server tests, build, Prisma validation, and browser acceptance.
- `npm run smoke:production`: prove production remains Provider-disabled.

## External-Call Boundary

V1-29 does not add a Google SDK, HTTP client, token, real status read, callback, paid request, or production route.
Status and mutation clients remain injected fixture interfaces. A future real staging rehearsal requires a separate
approval record naming the approver, expiry, exact Provider/model, one-call limit, generated-second limit, Provider and
application spending caps, token rotation owner, kill-switch owner, rollback owner, and production no-go.

Safe rehearsal evidence may include application generation and media ids, normalized states, timestamps, byte count,
checksum presence, scan state, generated seconds, reconciled cost, workflow URL, and rollback result. It must not
include credentials, raw prompts, input/output bytes, raw Provider payloads, private URLs, or unbounded error text.
