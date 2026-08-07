# V1 Music Capability Contract

AI-MUSIC-02 adds the production UX engineering acceptance layer documented in
`docs/V1_MUSIC_PRODUCTION_ACCEPTANCE.md`, including a fixed 44.1 kHz/256 kbps MP3 quality profile, rights disclosure,
private playback/download, limits, mobile and keyboard accessibility, and fail-closed rollback. This evidence does not
change the production Provider no-go decision.

V1-30 freezes the Music product and Provider contract. The executable source of truth is
`server/src/creative/musicCapabilityContract.js`.

Current decision: **HCAI Router MiniMax `music-3.0` has a guarded staging HTTP runtime, while production remains unavailable**.
The runtime is synchronous, registered only when every dedicated staging, network, credential, Router/upstream-rights,
training-opt-out, license-evidence, control-plane, and budget gate passes. A real request reached MiniMax but was rejected
with upstream plan error `2061`; Router must enable the Music 3.0 plan before another live acceptance. Google Lyria remains a disabled shell.

## Product Modes

- `instrumental`: create one instrumental track from a music brief.
- `lyrics_to_song`: create one song from a music brief plus required lyrics and language.
- Reference audio, remix, voice cloning, and text-to-speech are not V1-30 Music capabilities.
- Music Studio consumes application APIs only. Router MiniMax can be selected in a dedicated gated staging process; Mock remains the default and Lyria remains unavailable.

## Parameters And Output

- Prompt maximum: 2,000 characters; lyrics maximum: 5,000 characters.
- Duration: 30, 60, 120, or 180 seconds; three minutes maximum.
- Genre, mood, tempo from 40 to 220 BPM, and language use closed contract values.
- Output: exactly one private `audio/mpeg` MP3.
- The asset remains private until scanning and required policy review are complete.
- License metadata is mandatory; Provider URLs and raw payloads may not be persisted.

## Provider Decision

| Role | Provider | Current state | Contract modes |
| --- | --- | --- | --- |
| Primary | HCAI Router MiniMax Music 3.0 (`music-3.0`) | Adapter ready; blocked by MiniMax upstream plan and production approval | Instrumental, lyrics-to-song |
| Backup | Google Lyria 3 Pro Preview | Disabled Preview backup; no automatic failover | Instrumental only |

Lyria supplied-lyrics behavior is not confirmed, so the contract does not advertise lyrics-to-song for that Provider.
Ordinary continuation language is never approval to activate either shell.

## Rights, Safety, And Data

- The primary requires accepted Router and MiniMax terms plus documented application distribution and media rights.
- Users must attest rights; copyrighted lyrics and artist-imitation requests require application checks.
- Prompt, lyrics, and output audio classification fail closed on unknown results.
- License metadata, reporting, and takedown paths are mandatory.
- Router/MiniMax training opt-out, region, retention, deletion, SLA, and support must be confirmed before a
  staging call. Lyria Preview retention, region, quota, SLA, indemnity, and model-lifecycle risks require separate
  written acceptance.

## Lifecycle And Cost

The application exposes queued, running, completed, failed, cancelled, and review-required states even when a Provider
returns a synchronous response or stream. Timeout is 900 seconds with one Provider attempt. Cancellation is idempotent
and application-authoritative.

Provider spend remains separate from product credits: USD 0.15 per request, USD 0.60 per-job guard, USD 10 daily,
USD 250 monthly, and 20 jobs per day. The request price is stored as a versioned Model Control price and copied into an
immutable generation snapshot. A current estimate, Provider cap evidence, control-plane approval, and durable reservation
are required before any future dispatch.

## Guarded Staging Boundary

`server/src/creative/routerMusicProvider.js` implements fixture injection and the governed staging boundary:

- Instrumental and lyrics-to-song requests map to a closed `music-3.0` compose shape with one MP3 output.
- `createRouterMusicHttpClient` calls Router `POST /v1/music_generation` with explicit `music-3.0`, URL output, and 44.1 kHz/256 kbps MP3 settings.
- Network construction requires production process semantics in a dedicated staging runtime plus independent HTTP/network switches, API key, Router/upstream rights acknowledgement, training opt-out, license ID, and terms version.
- Responses reject unknown fields, invalid IDs, non-MP3 MIME or bytes, duration mismatches, and incomplete license
  evidence.
- Generation projections retain safe output hashes, request-based cost metadata, and `fixture_only` license evidence,
  but never retain output bytes, raw Provider payloads, Provider URLs, or credentials.
- Failed fixture calls use the shared safe Provider error projection, and frozen per-job/daily/monthly caps are checked
  before the injected client runs.

## V1-32 Handoff

V1-32 adds application-owned Music fixture persistence:

- `executeCreativeGeneration` can reserve and settle Router MiniMax request-based Provider cost through the shared durable
  ledger when the fixture adapter is injected.
- Completed fixture outputs carry only an `inline://` descriptor, SHA-256, size, content type, and license metadata in
  serializable generation state.
- `readRouterMusicOutputBytes` exposes MP3 bytes only while the original in-process output object is alive; cloned or
  cross-process records fail closed before ingestion.
- `persistCreativeGenerationOutputs` ingests the MP3 through the shared source-keyed output ingestion path, creating a
  private media asset, scan/review-gated download URL, and owner-scoped generation history without persisting Provider
  URLs or raw payloads.

`scripts/check-router-music-readiness.mjs` validates preflight and a one-call, 30-second application acceptance.
The acceptance verifies moderation, private MP3 ingestion, synchronous scanning, verified staging license evidence,
credits, quota, Provider cost closeout, and production no-go. Automatic Lyria failover and production remain prohibited.
