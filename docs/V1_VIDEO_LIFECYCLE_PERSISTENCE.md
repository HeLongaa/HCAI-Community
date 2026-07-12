# V1 Video Lifecycle Persistence

V1-27 closes the fixture-only asynchronous Video lifecycle. Its sources of truth are
`server/src/creative/videoProviderLifecycle.js`, the shared Provider replay/output/accounting services, and Prisma
migration `0030_video_provider_operations`.

Current decision: **the lifecycle is registered in the worker topology but disabled by default**. It accepts only an
injected fixture `getOperation` or `cancelOperation` function. There is no Veo HTTP client, token, real status read,
callback, external mutation, or production Provider path.

## Safe Operation State

`CreativeProviderOperation` stores one record per generation:

- safe application generation id and normalized Provider job id;
- Provider id/mode and normalized queued/running/terminal status;
- CAS version, bounded poll attempt count, next-poll and 900-second timeout timestamps;
- hashes of the normalized payload and output reference;
- safe error code, side-effect completion flag, and allowlisted low-cardinality metadata.

It never stores the prompt, input bytes, raw Provider request/response, output URL, credentials, account reference, or
raw error. Terminal operation records follow the restricted Provider lifecycle retention policy.

## Lifecycle Execution

- Dispatch keeps both generation and operation `queued`; the first running projection changes them to `running`.
- Polling is enabled only by independent staging `CREATIVE_GOOGLE_VEO_LIFECYCLE_*` switches plus the literal
  `fixture-only` confirmation.
- Status clients are injected. Missing clients fail closed and no network implementation is registered.
- Job mismatches, unknown fields, duplicate/stale transitions, and replay conflicts fail before side effects.
- Status failures have a bounded attempt budget; timeout and exhaustion produce safe terminal failure projections.
- Each worker item is isolated so one invalid operation cannot terminate the sweep.

## Output And Accounting

Successful fixture output passes the shared HTTPS host policy when using the bounded fetcher, streaming size limits,
MP4 magic MIME validation, SHA-256 identity, idempotent ingestion lease, private media storage, and scanner gating.
Provider output URLs are ephemeral and are replaced by application download paths.

The existing replay side-effect ledger then closes Provider cost, credits, quota, generation state, notifications, and
audit evidence exactly once. Failed, cancelled, timed-out, and usage-missing outcomes reconcile Provider cost rather
than guessing. A partial output or accounting failure remains replayable until all required side effects complete.

## V1-28 Closeout

V1-28 replaces the simulated Video workspace with the application-API Video UI: capability-driven mode controls,
governed asset selection, queued/running history, polling of application APIs only, cancellation, private preview,
scanner/review states, retry guidance, and clear Mock/fixture/unavailable labeling. Provider HTTP and production
enablement remain separate approval-gated work owned by later acceptance and release tasks.
