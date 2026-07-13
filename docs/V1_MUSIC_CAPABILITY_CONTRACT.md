# V1 Music Capability Contract

V1-30 freezes the Music product and Provider contract. The executable source of truth is
`server/src/creative/musicCapabilityContract.js`.

Current decision: **the contract and an injected fixture-only ElevenLabs adapter are implemented, but every real Music
Provider path remains unavailable**. ElevenLabs Music v2 Enterprise and Google Lyria 3 Pro Preview remain disabled
catalog shells. There is no Music SDK, HTTP client, credential, product registration, lifecycle worker, output
ingestion, real call, automatic backup, or production enablement.

## Product Modes

- `instrumental`: create one instrumental track from a music brief.
- `lyrics_to_song`: create one song from a music brief plus required lyrics and language.
- Reference audio, remix, voice cloning, and text-to-speech are not V1-30 Music capabilities.
- The current Music UI remains a simulation until later tasks replace it with the application workflow.

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
| Primary | ElevenLabs Music v2 Enterprise (`music_v2`) | Blocked pending Enterprise Music platform/media rights | Instrumental, lyrics-to-song |
| Backup | Google Lyria 3 Pro Preview | Disabled Preview backup; no automatic failover | Instrumental only |

Lyria supplied-lyrics behavior is not confirmed, so the contract does not advertise lyrics-to-song for that Provider.
Ordinary continuation language is never approval to activate either shell.

## Rights, Safety, And Data

- The primary requires Enterprise Music reseller, streaming, media, library, and repository rights.
- Users must attest rights; copyrighted lyrics and artist-imitation requests require application checks.
- Prompt, lyrics, and output audio classification fail closed on unknown results.
- License metadata, reporting, and takedown paths are mandatory.
- ElevenLabs training opt-out, region, ZRM eligibility, retention, deletion, SLA, and support must be confirmed before a
  staging call. Lyria Preview retention, region, quota, SLA, indemnity, and model-lifecycle risks require separate
  written acceptance.

## Lifecycle And Cost

The application exposes queued, running, completed, failed, cancelled, and review-required states even when a Provider
returns a synchronous response or stream. Timeout is 900 seconds with one Provider attempt. Cancellation is idempotent
and application-authoritative.

Provider spend remains separate from product credits: USD 0.60 per job, USD 10 daily, USD 250 monthly, and 20 jobs per
day. A current estimate, Provider cap evidence, control-plane approval, and durable reservation are required before any
future dispatch.

## V1-31 Fixture Boundary

`server/src/creative/elevenLabsMusicProvider.js` implements the governed fixture boundary:

- Instrumental and lyrics-to-song requests map to a closed `music_v2` compose shape with one MP3 output.
- Only an explicitly injected `compose` client can run; there is no default client or network construction path.
- Responses reject unknown fields, invalid IDs, non-MP3 MIME or bytes, duration mismatches, and incomplete license
  evidence.
- Generation projections retain safe output hashes, generated-minute cost metadata, and `fixture_only` license evidence,
  but never retain output bytes, raw Provider payloads, Provider URLs, or credentials.
- Failed fixture calls use the shared safe Provider error projection, and frozen per-job/daily/monthly caps are checked
  before the injected client runs.

## V1-32 Handoff

V1-32 should add application-owned Music lifecycle persistence and bounded MP3 output ingestion for the fixture path,
including owner-scoped generation history, idempotent terminal replay, private storage, scan/review gating, and durable
cost closeout. It must keep the ElevenLabs adapter unregistered and keep HTTP, credentials, real Provider traffic,
automatic Lyria failover, and production enablement absent until separate approval.
