# V1 Video Capability Contract

V1-25 freezes the Video product and Provider contract. The executable source of truth is
`server/src/creative/videoCapabilityContract.js`.

Current decision: **the contract and deterministic Mock projection are implemented; Google Veo 3.1 Fast and Runway
Gen-4.5 remain disabled catalog shells. No Video Provider adapter, HTTP client, credential, lifecycle registration,
automatic failover, real call, or production enablement is approved**.

The Mock path produces a deterministic governed placeholder artifact for testing and accounting. It is not a real MP4
render and must remain visibly classified as Mock until the later Video product workflow is implemented.

## Provider Decision

| Role | Provider | Model | V1-25 state |
| --- | --- | --- | --- |
| Primary | Google | Veo 3.1 Fast (`veo-3.1-fast`) | Disabled metadata shell; adapter/client absent |
| Backup | Runway | Gen-4.5 (`gen-4.5`) | Disabled; no-training and retention terms required |

Both Provider projections declare only text-to-video and image-to-video support. Music video is an application-owned
composition workflow and must not be represented as a native Provider capability. Backup routing is never automatic.

## Modes And Inputs

- `text_to_video`: no input asset.
- `image_to_video`: exactly one governed source image (PNG, JPEG, or WebP).
- `music_video`: one governed audio track and an optional governed reference image.
- Duplicate asset ids are rejected.
- Ownership, purpose, upload, scanner, byte, MIME, and lineage validation must complete before a later real dispatch.

## Parameters And Output

- Prompt maximum: 2,000 characters.
- Aspect ratio: `16:9` or `9:16`.
- Duration: 4, 6, or 8 seconds; 8 seconds maximum.
- Motion preset: `subtle`, `cinematic`, `dynamic`, or `fast_cuts`.
- Output: exactly one private `video/mp4`, fixed at 720p.
- Provider output URLs and raw payloads may not be persisted.

## Lifecycle And Composition

Video jobs are asynchronous and use `queued`, `running`, `completed`, `failed`, `cancelled`, or `review_required`.
Timeout is 900 seconds with one Provider attempt. Callback or polling replay, idempotent cancellation, application-owned
terminal records, and media ingestion are required before real traffic.

Storyboards are application or Chat inputs compiled into Provider instructions. Captions, burned-in text, sidecar VTT,
voiceover, and music synchronization are application composition stages, not unverified Provider-native features.

## Safety, Data, And Cost

- Prompt, storyboard, reference image, and audio safety classification is required before dispatch.
- Real-person identity, consent, and rights evidence is required when applicable.
- Representative frames and audio must be classified after generation; the full asset remains private until scanner
  approval.
- C2PA/Content Credentials must be preserved when supplied.
- Unknown safety or region state blocks without bypass.
- Provider spend is separate from product credits: USD 1.20 per job, USD 20 daily, USD 500 monthly, 20 jobs per day.
- A current estimate, Provider cap evidence, control-plane approval, and durable reservation are required before dispatch.

## Handoff

V1-26 through V1-29 own governed input bytes/lineage, async Provider adapter and lifecycle behavior, production Video UI,
and staging acceptance. Those tasks must preserve this contract or update it explicitly with matching tests and docs.
Ordinary continuation language is never approval for a real Video Provider request.
