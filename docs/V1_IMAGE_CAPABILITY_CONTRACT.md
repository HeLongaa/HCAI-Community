# V1 Image Capability Contract

This document closes V1-15. The executable source of truth is
`server/src/creative/imageCapabilityContract.js`; its public projection is returned inside each Image capability from
`GET /api/creative/providers` under contract version `image-capability-v1`.

## Decision Boundary

- Conditional primary: OpenAI GPT Image 2, model `gpt-image-2`.
- Approval-gated backup: Replicate FLUX 1.1 Pro, model `black-forest-labs/flux-1.1-pro`.
- Both real model entries are metadata only, unregistered, and disabled.
- Real Provider calls and production enablement remain unapproved.
- Production fails closed; silent mock or backup fallback is forbidden.
- Provider spend remains separate from creative credits, points, quota, escrow, and refunds.

## Mode Matrix

| Mode | V1 contract | Mock fixture | Replicate staging shell | Input contract |
| --- | --- | --- | --- | --- |
| `text_to_image` | Available | Available | Declared by the disabled shell | No input image |
| `image_to_image` | Available | Available | Unavailable | Exactly one governed image |
| `image_edit` | Declared, unavailable | Unavailable | Unavailable | Source plus mask after a later approved adapter task |
| `image_variation` | Declared, unavailable | Unavailable | Unavailable | Exactly one source after a later approved runtime decision |

Unknown modes are rejected. Declared but unavailable modes return an explicit validation error and never fall back to
another mode. Image Studio shows all four modes, disables unsupported modes, and also disables input-dependent modes
until an asset-selection workflow can satisfy their input contract.

## Request Contract

Image prompts are limited to 2,000 characters. Inputs must be governed assets with purpose `submission_asset`,
`profile_portfolio`, or `library_asset` and MIME type PNG, JPEG, or WebP. The request parser enforces mode-specific asset
counts before moderation, quota reservation, Provider budget work, or adapter dispatch.

| Parameter | Type and range | Default | Modes |
| --- | --- | --- | --- |
| `aspectRatio` | `1:1`, `3:2`, `2:3`, `4:5`, `5:4`, `16:9`, `9:16` | `1:1` | text/image-to-image |
| `stylePreset` | `none`, `editorial`, `editorial_launch`, `poster`, `avatar`, `product_visual`, `logo_concept` | `none` | generation/edit |
| `seed` | integer, 0 through 2,147,483,647 | Provider-selected | all declared modes |
| `strength` | number, 0 through 1 | `0.7` | image-to-image, later edit/variation |
| `quality` | `low`, `medium`, `high` | `medium` | all declared modes |
| `outputCount` | exactly 1 | 1 | all declared modes |
| `outputFormat` | `png` | `png` | all declared modes |

Unknown parameters, invalid types, invalid ranges, unsupported mode/parameter combinations, and invalid asset counts
are rejected. Product presets such as poster, avatar, product visual, and logo concept are `stylePreset` values, not
generation modes. The former arbitrary frontend `controls` array is not part of the contract.

## Output, Cost, And Safety

- Output type is `image`, output format is PNG, and V1 returns one output per request.
- Aspect ratios map to stable target dimensions in the executable contract.
- Product billing uses creative credits; Provider accounting uses request/image units under the existing immutable
  pricing and budget ledger.
- Prompt moderation, input governance, output persistence, and output scanning are mandatory.
- Raw Provider payload retention is forbidden. Provider URLs, tokens, and raw prompts are not added to catalog data.

## API And UI Projection

`GET /api/creative/providers` returns `contractVersion`, supported and declared modes, per-mode availability and reason,
input requirements, parameter definitions, output rules, model decisions, runtime approval flags, cost rules, and safety
rules. Image Studio loads that catalog before enabling generation. A missing or failed catalog disables generation.

`POST /api/creative/generations` and internal generation execution both call the same Image request validator. This
prevents route bypasses from accepting a mode or parameter combination that the public parser would reject.

## Verification

- `server/src/creative/imageCapabilityContract.test.js` covers frozen decisions, projections, valid combinations, and
  fail-closed boundaries.
- Request parser and creative route tests cover API behavior and safe catalog projection.
- OpenAPI contains the four declared modes and the Image parameter allowlist.
- `config/v1-runtime-surfaces.json` continues to classify Image execution as a release blocker until an approved real
  Provider replaces deterministic mock execution.

This task registers no Provider HTTP, callback, polling, probe, fallback, dispatch, mutation, output-fetch, or external
notification client and sends no external traffic.
