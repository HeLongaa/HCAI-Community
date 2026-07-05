# Phase 3 Track C Closeout

This closeout captures the completed Phase 3 Track C creative-tool productization baseline. Track C is considered complete for repository, fixture CI, and PR-ready handoff purposes after the provider abstraction, generated asset persistence, Image Studio integration, and cost/quota/moderation boundaries.

The key product boundary is deliberate: the app now has a real creative generation API path and durable generated assets, but the only provider adapter is still the deterministic mock provider. Real paid providers, durable billing ledgers, and broader workspace migrations are follow-up work.

## Completed Scope

Track C shipped in four implementation slices plus this closeout package:

1. Creative provider abstraction in PR #13.
2. Generated output persistence as media assets in PR #14.
3. Image Studio API-backed provider integration in PR #15.
4. Cost, quota, moderation, and review gates in PR #16.

The completed repository baseline includes:

- `GET /api/creative/providers` for safe creative provider capability metadata.
- `POST /api/creative/generations` for authenticated normalized generation requests.
- A mock creative provider adapter for image, video, music, and chat capability contracts.
- Generated output persistence through the existing media asset, storage, scanner, and download-governance boundary.
- Image Studio as the first frontend workspace using the creative generation API.
- Response and media metadata for provider, usage, quota, safety, policy, generated asset id, scan status, and gated download path.
- Moderation blocks for clearly disallowed prompts before provider execution.
- Review-required generation routing into the media review queue.
- Route, service, media-governance, OpenAPI, permission-matrix, simulation, and deploy-gate coverage.

## Usable User Flows

### Image Studio Generation

1. A signed-in user opens Image Studio.
2. The user enters an image prompt, selects a preset/style option, and chooses controls such as aspect ratio.
3. The frontend calls `POST /api/creative/generations` through `creativeService.createGeneration`.
4. The backend validates workspace, mode, prompt, input assets, and provider availability.
5. The creative policy gate evaluates quota, cost metadata, moderation, and review requirements.
6. The mock provider returns a deterministic generation descriptor.
7. The generated output is persisted as a media asset:
   - image outputs become safe SVG artifacts
   - non-image outputs become JSON sidecar artifacts
8. The media scanner policy determines whether the asset is pending, clean, review, or rejected.
9. Image Studio shows provider/mock state, media asset id, scan status, usage, remaining quota, and download-gated status.
10. Download remains blocked until the media asset is `clean`.

### Moderation Block

1. A signed-in user submits a prompt that matches a blocked creative moderation rule.
2. The backend rejects the request before provider execution.
3. The API returns `CREATIVE_MODERATION_BLOCKED` with safe policy reason metadata.
4. No generated output or media asset is created.

### Policy Review Routing

1. A signed-in user submits a prompt that is allowed but requires review.
2. The generation is allowed to complete through the provider boundary.
3. The persisted media asset is forced into media scan `review` state.
4. Operators can inspect the generated asset in the existing media review queue.
5. Download remains gated until an operator or scanner marks the asset clean.

### Quota Boundary

1. A signed-in user submits generation requests against a user/workspace/day quota.
2. The quota limit is role-aware and controlled by `CREATIVE_DAILY_QUOTA`.
3. When quota is exhausted, the API returns `CREATIVE_QUOTA_EXCEEDED` with the limit, used count, remaining count, and reset window.
4. The current quota counter is process-local and exists to establish the product/API boundary before a durable cross-instance quota ledger is added.

## Runtime Classification

| Surface | Current State | User-Visible Boundary |
| --- | --- | --- |
| Image Studio text-to-image | API-backed through creative provider boundary, persisted as media asset | Provider/mock label, generated asset id, scan status, usage/quota, gated download |
| Image Studio image-to-image controls | Capability exists in provider metadata, frontend first slice uses text-to-image | Follow-up integration |
| Music Studio | Existing simulated workspace UI | Still demo/simulated queue and results |
| Video Studio | Existing simulated workspace UI | Still demo/simulated queue and preview |
| AI chat workspace | Existing simulated workspace UI | Still demo/simulated assistant surface |
| Explore/catalog/player/profile creative content | Existing demo/catalog data | Not generated through provider API |
| Admin media review queue | Real governance path for generated media assets | Generated assets can be inspected and manually released/rejected |

## API And Storage Boundaries

The creative API is now stable enough for future provider adapters:

- Request model: workspace, mode, prompt, optional input asset ids, parameters, optional provider id.
- Provider catalog: safe capability metadata only; no provider secret exposure.
- Response model: generation id, provider metadata, output descriptors, usage, quota, safety, policy, persisted media asset metadata.
- Persistence: generated artifacts are written through the same storage abstraction used by media uploads.
- Download: generated assets reuse private download contracts and require clean scan status.
- Audit/notifications: generated asset creation is audited; review-required generated assets create audit and queue-reader notification events.

The storage model intentionally keeps provider data safe:

- Prompt text is not stored raw in generated media metadata.
- Media metadata stores prompt hash, prompt preview, input asset ids, parameter keys, source output url, and policy metadata.
- Provider secrets are not accepted by the mock adapter and are not exposed in provider catalog responses.

## Configuration

Current Track C configuration:

| Variable | Purpose | Current Meaning |
| --- | --- | --- |
| `CREATIVE_PROVIDER_MODE` | Enables or disables the creative provider boundary | `mock` enables the mock adapter; `disabled` makes provider calls unavailable |
| `CREATIVE_DAILY_QUOTA` | Base daily user/workspace quota | Defaults to `24`; role multipliers apply |
| `MEDIA_SCAN_PROVIDER` | Controls generated asset scan state | `manual`, `mock`, and `webhook` retain their existing media-governance behavior |
| Storage variables | Persist generated artifacts | `mock` storage locally or S3-compatible storage in managed environments |

No real paid-provider credential variables are part of this Track C closeout.

## Validation

The Track C implementation PRs and this closeout package use the repository deploy gate:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

Relevant focused coverage now includes:

- provider catalog contract tests
- generation request validation tests
- mock provider service tests
- generated asset persistence tests
- media scan/download governance tests
- moderation block tests
- quota exceeded tests
- policy review routing tests
- frontend simulation coverage for Image Studio's provider-backed path
- OpenAPI and permission matrix drift checks

## Deferred Work

These items are intentionally outside the Track C closeout boundary:

- Real paid provider adapter selection and integration.
- Provider-specific job polling or webhook lifecycle for long-running video/music generation.
- Durable quota ledger shared across API instances.
- Real billing, point deduction, credit reservation, or refund settlement.
- Admin UI dedicated to creative generation history beyond the existing media review queue.
- Image-to-image frontend integration.
- Music Studio, Video Studio, and AI chat workspace API-backed generation.
- Explore/catalog/player/profile replacement with generated or stored creative assets.
- Provider-specific abuse monitoring, cost dashboards, and provider incident runbooks.

## Recommended Next Phase

Do not connect a paid provider until the durable accounting layer is planned. The best next phase is a narrow provider-readiness track:

1. Add a durable creative generation record and quota ledger.
2. Add credit reservation/settlement/refund semantics.
3. Add provider adapter contract tests for async jobs and external failures.
4. Add Admin generation history and cost inspection.
5. Select one real image provider for a guarded staging-only adapter.

After that, expand from Image Studio to image-to-image, then consider video/music/chat separately because their lifecycle and cost profile are different.
