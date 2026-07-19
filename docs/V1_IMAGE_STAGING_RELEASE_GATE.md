# V1 Image Staging Release Gate

This is the V1-19 execution contract for OpenAI GPT Image 2 staging acceptance. The machine-readable source is
`config/v1-image-staging-gate.json`.

Current decision: **fixture readiness and application wiring are complete; guarded real staging calls are explicitly
approved; credentialed acceptance is pending; production enablement remains no-go**.

OpenAI documents `gpt-image-2` for both `/v1/images/generations` and `/v1/images/edits`. The Image API returns base64
output, edit multipart uses `image[]`, and `input_fidelity` must be omitted because GPT Image 2 always uses high-fidelity
image inputs. Organization verification may still be required for the staging project.

Official references reviewed on 2026-07-20:

- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/pricing

## Delivered Boundary

- The product route registers the real adapter only when `NODE_ENV=production`, runtime is `staging`, both client and
  network switches are true, `staging-only` is confirmed, and the deployment token exists.
- Text-to-image and image-to-image use the real application route, policy, quota, credit, Provider controls, output
  ingestion, media scan, private download, lineage, and cost ledger paths.
- Provider moderation branches on `error.code=moderation_blocked` and retains only the public stage and allowlisted
  coarse categories.
- Complete Provider usage settles actual token cost. Missing edit modality detail produces
  `reconciliation_required`; estimated cost is never copied into actual cost.
- Provider credentials, raw prompts, base64 output, raw error bodies, private URLs, classifier scores, and internal
  labels are excluded from acceptance summaries.
- Production remains denied even when staging gates are enabled.

## Commands

```bash
npm run test:v1-image-staging
npm run test:image-openai-readiness
npm run test:image-openai-readiness:integration
npm run image:openai:preflight
npm run image:openai:acceptance
```

`test:image-openai-readiness` and fixture preflight make no real Provider call. `image:openai:acceptance` requires
`--profile=env` internally and is the only command in this package authorized to perform the two-call acceptance.

## Required Environment

Runtime and credential:

- `NODE_ENV=production`
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`
- `CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED=true`
- `CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED=true`
- `CREATIVE_OPENAI_IMAGE_CONFIRMATION=staging-only`
- `CREATIVE_OPENAI_IMAGE_API_TOKEN` as a dedicated staging secret
- `MEDIA_SCAN_PROVIDER=mock` for synchronous acceptance output scanning

Short-lived approval envelope:

- `CREATIVE_OPENAI_IMAGE_ACCEPTANCE_CONFIRMATION=real-staging-acceptance`
- `CREATIVE_OPENAI_IMAGE_APPROVAL_DECISION=go-for-image-staging-acceptance`
- non-empty approver, approval reference, branch/PR, token rotation owner, kill-switch owner, and rollback owner
- grant timestamp within the prior 24 hours and expiry within the next 24 hours
- `CREATIVE_OPENAI_IMAGE_STAGING_ENVIRONMENT=image-staging`
- `CREATIVE_OPENAI_IMAGE_MAX_CALLS=2`
- Provider cap above zero and at most USD `1`
- app budget above zero and at most USD `0.25`
- daily budget above zero and no greater than the app budget
- `CREATIVE_OPENAI_IMAGE_PRODUCTION_NO_GO=true`

See `server/.env.example` for exact variable names. Never commit or write the token to Notion, logs, screenshots, or
test output.

## Acceptance Matrix

The credentialed command performs exactly two Provider requests:

1. low-quality 1024x1024 text-to-image generation;
2. low-quality 1024x1024 image-to-image edit using an owned, clean staging PNG.

It also submits a locally blocked violence prompt and proves that application moderation prevents a third Provider
dispatch. Success requires two completed generations, two private clean persisted assets, edit lineage, settled credit,
committed quota, Provider cost closeout, and a secret-free summary.

The current GPT Image 2 pricing snapshot uses text input USD `5`/1M tokens, image input USD `8`/1M tokens, and image
output USD `30`/1M tokens. The acceptance estimate table is low/medium/high USD `0.006/0.053/0.211` for 1024x1024 and
USD `0.005/0.041/0.165` for 1024x1536 or 1536x1024. Recheck official pricing before a later production decision.

## Closeout

Record only low-cardinality evidence: generation/media identifiers, statuses, timestamps, dimensions, byte count,
checksum presence, scan state, ledger state, safe moderation stage/category, workflow URL, and rollback result.

V1-19 remains In Progress until the real environment token is mounted, optional organization verification is resolved,
the two-call command passes, quality gates pass, the PR is merged, and Notion contains the safe acceptance evidence.
