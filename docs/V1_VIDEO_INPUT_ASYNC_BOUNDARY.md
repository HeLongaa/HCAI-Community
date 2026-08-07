# V1 Video Input And Async Boundary

V1-26 implements the application-side Video input and fixture-only HCAI Router Seedance boundary. The executable
sources are `server/src/creative/videoInputAssets.js` and `server/src/creative/routerVideoProvider.js`.

Current decision: **the guarded Router adapter is implemented but remains disabled unless the complete staging envelope
passes**. Fixture injection remains available for deterministic tests. There is no default credential, paid request,
or production enablement.

## Governed Inputs

- `text_to_video` accepts no assets.
- `image_to_video` accepts one `source_image` from submission, profile, or library assets.
- `music_video` accepts one `audio_track` and an optional `reference_image`; the audio must be first.
- Every asset is resolved through the owner-scoped media repository and must be uploaded and scanner-clean.
- Images are PNG, JPEG, or WebP and capped at 20 MiB each.
- Audio is MP3, WAV, or MP4 audio and capped at 50 MiB each.
- Combined input bytes are capped at 60 MiB.
- The reader verifies exact declared size and magic MIME before bytes reach an injected fixture client.
- Output lineage stores only application asset ids and fixed roles. It does not store object keys or signed URLs.

## Router Video Boundary

The canonical request fixes `seedance-2.0-fast`, one 720p MP4 output, 4/6/8 seconds, `16:9` or `9:16`, no native audio,
and one optional source image. The full prompt and optional image bytes exist only in the in-process request passed to
the injected fixture client. Safe metadata contains only the model, mode, closed parameters, input roles, and byte
count.

The strict operation projection accepts only a safe fixture job id, `queued`, `running`, `succeeded`, `failed`, or
`cancelled`, one optional MP4 output reference, a bounded safe error, and bounded usage. Unknown fields and unsafe job
ids fail closed. Terminal mapping uses the shared replay contract, so duplicate/stale transitions and job mismatches
are rejected before side effects. Router exposes no public cancellation endpoint; cancellation therefore returns a
real unsupported error and does not alter generation, operation, or billing state.

## Cost And Persistence

- Router has no reliable public unit price recorded; the generated-second estimate is an application budget guard only.
- Actual Router usage and charges must be reconciled after staging.
- Frozen caps: USD 1.20 per job, USD 20 daily, and USD 500 monthly.
- Dispatch fixtures pass the Provider control plane before a durable generated-second reservation.
- Queued/running jobs keep the reservation open for a later terminal closeout.
- The monthly cap remains contract metadata until a later release task adds a durable monthly ledger window; this is
  one reason production dispatch remains unavailable.
- Provider output references are ephemeral projection data and are not written into generation records or logs.

## V1-27 Closeout

V1-27 adds safe Provider operation state, default-disabled lifecycle registration, bounded fixture status reads,
terminal output ingestion, scanner gating, cost closeout/reconciliation, timeout recovery, partial replay recovery, and
cancellation semantics. All network and production switches remain false. See
`docs/V1_VIDEO_LIFECYCLE_PERSISTENCE.md` for the executable-state boundary and V1-28 handoff.
