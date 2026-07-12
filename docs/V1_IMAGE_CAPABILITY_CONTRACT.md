# V1 Image Capability Contract

This document closes V1-15. The executable source of truth is
`server/src/creative/imageCapabilityContract.js`; its public projection is returned inside each Image capability from
`GET /api/creative/providers` under contract version `image-capability-v1`.

## Decision Boundary

- Conditional primary: OpenAI GPT Image 2, model `gpt-image-2`.
- Approval-gated backup: Replicate FLUX 1.1 Pro, model `black-forest-labs/flux-1.1-pro`.
- The OpenAI primary has a fixture-injectable adapter and fixed HTTP client boundary; it remains unregistered and disabled.
- The Replicate backup remains a disabled staging shell.
- Real Provider calls and production enablement remain unapproved.
- Production fails closed; silent mock or backup fallback is forbidden.
- Provider spend remains separate from creative credits, points, quota, escrow, and refunds.

## Mode Matrix

| Mode | V1 contract | Mock fixture | OpenAI shell | Replicate staging shell | Input contract |
| --- | --- | --- | --- | --- | --- |
| `text_to_image` | Available | Available | Fixture-only | Declared by the disabled shell | No input image |
| `image_to_image` | Available | Available | Fixture-only | Unavailable | Exactly one governed source image |
| `image_edit` | Available | Available | Fixture-only | Unavailable | Governed source plus PNG mask |
| `image_variation` | Available | Available | Fixture-only through edit semantics | Unavailable | Exactly one governed source image |

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

The OpenAI projection supports only `aspectRatio`, `stylePreset`, `quality`, `outputCount`, and `outputFormat` for
`text_to_image`. Its aspect ratios are narrowed to `1:1`, `3:2`, and `2:3`; `seed` is rejected before adapter
dispatch. Product style presets compile into deterministic prompt instructions rather than
being sent as unsupported Provider fields.

V1-17 extends the OpenAI fixture projection to `image_to_image`, `image_edit`, and `image_variation` through the fixed
`/images/edits` boundary. `strength` is compiled into a deterministic prompt instruction and is never sent as an
unsupported Provider field. Variation is a product semantic implemented through an edit request, not a claim that
OpenAI exposes a separate GPT Image 2 variation endpoint.

Input assets are resolved server-side before moderation, quota, credit, Provider cost, or adapter dispatch. They must
be accessible to the actor, uploaded, in an allowed purpose/MIME partition, and scan-clean. Edit masks must be PNG.
Outputs carry `image-lineage-v1` with the generation id, relationship (`derived_from`, `edited_from`, or
`variation_of`), parent asset ids, and source/mask roles; private URLs and raw bytes are excluded.

## Output, Cost, And Safety

- Output type is `image`, output format is PNG, and V1 returns one output per request.
- Aspect ratios map to stable target dimensions in the executable contract.
- Product billing uses creative credits; Provider accounting uses request/image units under the existing immutable
  pricing and budget ledger.
- Prompt moderation, input governance, output persistence, and output scanning are mandatory.
- Raw Provider payload retention is forbidden. Provider URLs, tokens, and raw prompts are not added to catalog data.
- OpenAI returns one synchronous base64 PNG. The adapter validates canonical base64, PNG magic, one-output cardinality,
  a 25 MiB decoded output cap, a 36 MiB response cap, and safe usage fields before governance ingestion.
- Decoded bytes stay in a non-serializable in-process map only long enough to enter source-keyed media ingestion;
  missing bytes fail closed and never fall back to a Provider URL.
- Input bytes use a separately injected reader, are checked against declared MIME and 20 MiB per-file / 40 MiB total
  limits, and exist only long enough to construct the fixture-gated multipart request.

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
- OpenAI adapter tests cover fixed request mapping, staging-only double network gates, response and error projection,
  budget pricing, non-serializable output bytes, Provider-specific parameter rejection, and idempotent cost accounting.
- Input resolver, route, repository, media metadata, Image Studio, and Playwright tests cover ownership, scan state,
  source/mask roles, strength, mode-specific controls, and durable lineage.
- `config/v1-runtime-surfaces.json` continues to classify Image execution as a release blocker until an approved real
  Provider replaces deterministic mock execution.

The OpenAI HTTP client factory is implemented but requires both `CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED=true` and
`CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED=true`, a staging runtime, `staging-only` confirmation, and a deployment
secret. No product route registers it. Callback, polling, probe, fallback, mutation, output-fetch, and external
notification clients remain unregistered, and this task sends no external traffic.
