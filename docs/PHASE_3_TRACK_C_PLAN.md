# Phase 3 Track C Plan

This document defines the Phase 3 Track C planning baseline: **Creative Tool Productization**. The completed closeout handoff lives in `docs/PHASE_3_TRACK_C_CLOSEOUT.md`.

Track A closed the task marketplace depth loop. Track B closed the production-operations baseline. Track C now focuses on replacing selected simulated creative outputs with provider-backed generation and persisted assets while keeping cost, quota, moderation, and review boundaries explicit.

## Objective

Make at least one creative workspace produce a provider-backed, persisted, inspectable output without blurring the remaining demo/catalog surfaces.

Track C should focus on:

- a stable creative provider abstraction before any real paid provider integration
- generated asset persistence through the existing media/storage/governance boundary
- a first workspace integration, with Image Studio as the recommended first candidate
- cost, quota, moderation, and Admin review controls before broad release
- clear runtime labels for provider-backed, mock, demo, and catalog outputs

## Current Baseline

The app already includes rich creative surfaces:

- Music Studio with prompt, modes, queue, and recent-result UI.
- Image Studio with text-to-image, image-to-image, presets, controls, and result actions.
- Video Studio with text-to-video, image-to-video, music video, storyboard, captions, and preview flow.
- AI chat workspace with quick prompts and cross-module actions.
- Explore, player, profile, and catalog-like demo surfaces.

The production foundation already available from earlier tracks:

- Auth, session, permissions, points, notifications, audit, Admin review, and media governance APIs.
- Media upload/storage contracts for mock and S3-compatible storage.
- Media scan governance with manual/mock/webhook scanner modes.
- Admin operations and release quality gates.

Original limitation before Track C implementation:

- Creative outputs remained simulated or demo-content driven.
- Generation state mostly lived in frontend UI state and mock data.
- There was no unified generation request/response contract.
- There was no provider registry or capability model.
- Generated outputs were not yet consistently persisted as media assets.
- Cost, quota, and moderation controls were not defined for provider-backed generation.

Current closeout state:

- Image Studio text-to-image uses `POST /api/creative/generations`.
- The creative provider registry and mock provider adapter are implemented.
- Generated outputs are persisted as media assets and reuse media scan/download governance.
- Cost, quota, moderation, and review routing boundaries are implemented for the provider path.
- Music, Video, Chat, Explore, and catalog surfaces still retain demo/mock content until follow-up phases.

## Scope

### In Scope

- Define a provider registry and provider capability metadata for creative generation.
- Define a unified generation request/response model for image, video, music, and chat workspaces.
- Add a mock provider adapter first so the API boundary is testable without paid provider credentials.
- Add environment/config metadata for enabled providers without exposing secrets.
- Persist generated outputs through the existing media asset/storage/scanner boundary.
- Add a first workspace integration, recommended: Image Studio.
- Add runtime data-source labels that distinguish provider-backed, mock-provider, demo, and catalog content.
- Add cost/quota/moderation/Admin review boundaries before broad provider release.

### Out Of Scope

- Directly wiring a paid external provider in the first PR.
- Replacing every creative workspace in one slice.
- Replacing all Explore/catalog/demo content.
- Building provider-specific infrastructure templates.
- Bypassing media scan governance for generated assets.
- Large visual redesign of creative workspaces.
- Reopening Track A marketplace behavior or Track B operations infrastructure unless a blocker is found.

## Proposed Implementation Order

### 0. Planning And Task Inventory

Confirm Track C scope, create the task list in Notion, and add this planning document.

Exit criteria:

- `docs/PHASE_3_TRACK_C_PLAN.md` exists.
- Phase 3 plan and README point to the Track C plan.
- Notion records Track C planning, implementation slices, validation, and next steps.

Validation:

- `git diff --check`
- `npm run check:quick`
- `npm run check:deploy`

### 1. Creative Provider Abstraction

Goal: create a stable server-side boundary for generation without depending on a real paid provider yet.

Implementation status: completed in PR #13.

Recommended scope:

- Add a creative provider registry.
- Add capability metadata per workspace and generation mode.
- Add a normalized generation request model:
  - workspace type
  - prompt
  - optional input asset ids
  - mode/preset/control metadata
  - actor and request context
- Add a normalized generation response model:
  - provider id
  - provider mode
  - job/result status
  - output descriptors
  - safe provider metadata
  - cost/quota placeholder metadata
- Add a mock provider adapter that returns deterministic outputs for tests.
- Add safe env/config projection such as provider availability, not provider secrets.

Current implementation slice:

- `GET /api/creative/providers` exposes safe mock-provider capability metadata for Image, Video, Music, and Chat workspaces.
- `POST /api/creative/generations` accepts authenticated normalized generation requests and returns deterministic mock output descriptors.
- `CREATIVE_PROVIDER_MODE=mock|disabled` is projected as safe config metadata only; no real provider secret is accepted or exposed in this slice.
- Mock outputs are explicitly marked `persisted: false` and `source.kind: mock_provider`; generated asset persistence remains Track C step 2.

Exit criteria:

- The backend can execute a creative generation request through a provider registry.
- Mock provider mode is fully testable and does not require external credentials.
- Frontend and docs can identify the path as provider-boundary backed rather than pure UI simulation.

Validation:

- Provider contract tests.
- Mock adapter tests.
- Env/config tests.
- API contract updates when routes are added.
- `npm run check:deploy`.

### 2. Generated Asset Persistence

Goal: make generated outputs durable, inspectable, downloadable, and governable.

Implementation status: completed in PR #14.

Recommended scope:

- Convert provider output descriptors into media asset records.
- Store generated output payloads or URLs through mock/S3-compatible storage adapters.
- Attach provider metadata, prompt metadata, ownership, workspace type, and scan state.
- Reuse media scanner governance before private downloads are allowed.
- Keep generated asset metadata safe; do not store provider secrets or raw unsafe payloads.

Current implementation slice:

- Creative generation outputs are converted into generated media assets with `purpose=library_asset`.
- Mock image outputs are written as safe SVG artifacts through the storage signing path; non-image outputs are written as JSON sidecar artifacts.
- Generated assets store safe `metadata.creative` fields including generation id, output id, workspace, mode, provider id/mode, prompt hash, prompt preview, input asset ids, parameter keys, and source output URL.
- Generated assets immediately enter existing media scan governance. Manual scan mode keeps downloads blocked until an operator marks the asset clean; mock/webhook scanner modes reuse existing scan status semantics.
- Creative generation responses now include `storage.mediaAssetId`, `storage.scanStatus`, `storage.downloadPath`, and a compact `mediaAsset` summary.

Exit criteria:

- At least one generated output is represented as a media asset.
- Existing scan/download boundaries still apply to generated assets.
- Operators can inspect generated assets through existing media governance surfaces or a clearly documented follow-up.

Validation:

- Media persistence tests.
- Provider-output-to-asset tests.
- Scan governance compatibility tests.
- `npm run check:deploy`.

### 3. First Workspace Provider Integration

Goal: connect one user-facing workspace to the provider-backed API path.

Implementation status: completed in PR #15.

Recommended first workspace: **Image Studio**.

Reasoning:

- Image output maps cleanly to existing media asset/storage/download patterns.
- Image generation has simpler first-pass job lifecycle than long-running video/music generation.
- The current UI already has prompt, preset, control, and result-action surfaces.

Recommended scope:

- Add typed frontend service calls for generation.
- Wire Image Studio generate action to API-backed generation when available.
- Keep demo/mock fallback visible and labeled.
- Show loading, success, error, and generated-asset states.
- Let result actions operate on generated asset metadata where available.

Current implementation slice:

- Add a typed `creativeService.createGeneration` client for `POST /api/creative/generations`.
- Wire Image Studio generation to the provider-backed API path for `workspace=image` and `mode=text_to_image`.
- Show provider/mock label, generated media asset id, scan status, and download-gated state in Image Studio.
- Keep Music, Video, and Chat workspaces on their existing simulated surfaces until later slices.

Exit criteria:

- A user can initiate Image Studio generation through the provider abstraction.
- The result is clearly labeled as provider-backed/mock-provider/demo.
- The result can be persisted or linked to a persisted generated asset.

Validation:

- Route tests.
- Service contract or feature simulation updates.
- Focused browser/integration coverage when practical.
- `npm run check:deploy`.

### 4. Cost, Quota, And Moderation Boundaries

Goal: prevent runaway provider spend and unsafe generated output.

Implementation status: completed in PR #16.

Recommended scope:

- Define per-user, per-role, or per-workspace generation quotas.
- Define point/credit deduction or reservation rules.
- Record safe cost metadata per generation.
- Add moderation checks before and/or after generation.
- Route flagged outputs to Admin review when required.
- Add audit and notification hooks for high-risk generation events.

Current implementation slice:

- `POST /api/creative/generations` now runs a creative policy gate before provider execution.
- The policy gate enforces a per-user/per-workspace daily quota with role-aware multipliers and returns `CREATIVE_QUOTA_EXCEEDED` with the active window and remaining quota when blocked.
- Prompt moderation blocks clearly disallowed requests before generation with `CREATIVE_MODERATION_BLOCKED`.
- Review-required prompts are allowed to generate, but the persisted media asset is forced into media scan `review` state so operators can inspect it through the existing media review queue.
- Generation responses and generated media metadata now include safe `usage`, `quota`, `safety`, and `policy` metadata. This is intentionally metadata/accounting only; real paid-provider billing and durable quota ledgers remain deferred.

Exit criteria:

- Provider-backed generation has explicit cost and safety controls.
- Users receive clear feedback when quota, moderation, or review gates block generation.
- Operators can review flagged generated outputs.

Validation:

- Quota accounting tests.
- Moderation policy tests.
- Admin review tests.
- `npm run check:deploy`.

### 5. Track C Closeout

Goal: document usable provider-backed creative flows and remaining simulation boundaries.

Implementation status: completed by `docs/PHASE_3_TRACK_C_CLOSEOUT.md`.

Recommended scope:

- Add a Track C closeout document.
- Update README and Phase 3 plan.
- Update Notion task statuses and next steps.
- Document which workspaces are provider-backed, mock-provider backed, or still simulated.
- Document required provider environment variables without exposing secrets.

Current closeout slice:

- Add `docs/PHASE_3_TRACK_C_CLOSEOUT.md`.
- Update Phase 3 and README handoff links.
- Record usable Image Studio flow, moderation block flow, policy review flow, and quota boundary.
- Keep real provider integration, external billing/reconciliation, and broader workspace migration deferred.

Exit criteria:

- Maintainers can tell which creative paths are real, mock, demo, or deferred.
- Follow-up provider integrations can be added without changing the core abstraction.

Validation:

- `git diff --check`
- `npm run check:quick`
- `npm run check:deploy`

## Historical First Implementation Slice

Track C started with **Creative Provider Abstraction**, completed in PR #13.

Reasoning:

- It creates the contract that later real provider adapters must obey.
- It avoids committing to a paid provider before the app owns persistence, quota, and safety boundaries.
- It lets tests cover request/response shape, capability metadata, and error mapping deterministically.
- It gives the frontend a real API boundary while preserving mock/demo fallback.

Completed first PR scope:

1. Add provider registry and capability metadata.
2. Add mock provider adapter.
3. Add generation request/response contracts.
4. Add config/env safe projection for provider availability.
5. Add backend tests.
6. Update docs and Notion.

Items that were intentionally deferred from the first PR and completed or reclassified later:

- Real paid provider credentials remain deferred beyond Track C.
- Generated asset persistence was completed in PR #14.
- First workspace UI integration was completed for Image Studio in PR #15.
- Cost/quota/moderation boundaries were completed in PR #16.
- Track C closeout is captured in `docs/PHASE_3_TRACK_C_CLOSEOUT.md`.

## Quality Gate

Every Track C PR should pass:

```bash
npm run check:deploy
```

Provider-specific real environment checks should be added only after a real provider adapter is selected and configured.
