# V1 Runtime Surface Inventory

This document records every known demo, mock, catalog, seed, fixture, and fallback surface that can affect V1 runtime behavior. `config/v1-runtime-surfaces.json` is the machine-readable source and `npm run test:v1-surfaces` prevents untracked boundaries from entering the repository.

## Decision

- Silent production fallback is forbidden.
- The current repository is not production-ready while any `release_blocker` remains.
- Fixture and development implementations may remain only when their environment boundary is explicit and tested.
- V1-39 owns the final production removal/explicit-unavailable gate; domain tasks own the real replacements.
- A visible “Demo fallback” label is useful audit evidence today, not permission to ship the fallback in V1.

## Frontend Inventory

| Surface id | Current behavior | Production disposition | Owners |
| --- | --- | --- | --- |
| `frontend-marketplace-demo-state` | Tasks and home start from local task records and retain them after list failure | API data or explicit unavailable state | V1-39, V1-64 |
| `frontend-community-library-demo-state` | Community/library start from local posts, works, and inspiration | API data or explicit unavailable state | V1-39, V1-66 |
| `frontend-account-profile-demo-catalog` | Account/profile/search can use local marketplace profiles | Account/profile APIs and governed portfolio assets | V1-36, V1-37, V1-39, V1-66, V1-67 |
| `frontend-player-search-demo-catalog` | Player queue and global search use local tracks/profiles | Unified asset/catalog API | V1-32, V1-33, V1-35, V1-36, V1-39 |
| `frontend-explore-demo-catalog` | Explore radio, tracks, images, and videos are local catalog content | Real catalog or explicit unavailable state | V1-35, V1-36, V1-39 |
| `frontend-music-workspace-simulation` | Music controls and queue are simulated | Real Music Provider job and persisted assets | V1-30 through V1-34, V1-39 |
| `frontend-chat-workspace-simulation` | Chat replies and cross-workspace actions are local | Streaming Chat API and durable conversations | V1-20 through V1-24, V1-39 |
| `frontend-video-workspace-simulation` | Video generation/progress/results are local | Real async Video Provider job | V1-25 through V1-29, V1-39 |
| `creative-image-mock-execution` | Image uses durable API/accounting but executes deterministic mock output | Approved real Image Provider | V1-15 through V1-19, V1-39 |
| `frontend-admin-demo-queue` | Admin review queue retains local rows when API load fails | Admin API data or explicit error | V1-39, V1-42, V1-43, V1-69 |
| `frontend-static-plan-api-catalog` | Pricing/API pages use static local plan and feature cards | Approved internal-credit/API product content | V1-39, V1-40, V1-70, V1-78 |
| `frontend-points-demo-ledger` | Points starts from a local ledger and retains it after failure | Points API or explicit error | V1-39, V1-40, V1-65 |
| `frontend-runtime-source-labels` | Shell exposes API, stored, fallback, and mock classifications | Retain until blockers close, then show only real/unavailable states | V1-02, V1-39 |
| `frontend-mockdata-root` | Shared source for local tasks, profiles, posts, tracks, works, queues, and plans | Restrict to test/development/controlled seed migration | V1-39 |

All 14 direct frontend imports of `src/data/mockData.ts` are checked exactly. Adding, removing, or moving one requires updating the machine inventory in the same pull request.

## Server Inventory

| Surface id | Current behavior | Production disposition | Owners |
| --- | --- | --- | --- |
| `server-seed-repository-fallback` | Missing `DATABASE_URL` silently selects in-memory seed repository | Require PostgreSQL and fail closed | V1-39, V1-49 |
| `server-prisma-demo-autoseed` | An empty Prisma database is populated from demo seed data | Explicit environment bootstrap without demo users/content | V1-39, V1-49 |
| `server-demo-auth-compatibility` | Demo handles/tokens support local and test workflows | Restrict to development and tests | V1-39, V1-48, V1-67 |
| `server-mock-storage-driver` | Missing S3 configuration selects `mock://` upload/download/archive | Require S3-compatible storage in production | V1-39, V1-50 |
| `server-manual-mock-scanner` | Scanner can remain manual or classify from deterministic mock signatures | Require real scanner request and signed callback | V1-39, V1-51 |
| `server-dev-oauth-fallback` | Unconfigured OAuth providers execute a signed local callback | Require external OAuth or explicit unavailable state | V1-39, V1-48 |
| `server-provider-fixture-injection` | Replicate execution/status/replay clients exist only through injected fixtures | Retain tests; never register as default network client | V1-05 through V1-08, V1-12, V1-14 |
| `server-provider-alert-fixture-delivery` | Provider budget alerts can dispatch only through approved fixture-injected clients | Replace with separately approved external delivery clients | V1-13, V1-53 |

## Fixture Inventory

| Surface id | Current behavior | Production disposition | Owners |
| --- | --- | --- | --- |
| `fixture-smoke-and-simulation-profiles` | Deterministic production/staging fixtures and UI simulations exercise safe gates | Retain as CI-only evidence | V1-71, V1-75 |

## Production Classification Rules

1. `release_blocker`: must be replaced or converted to an explicit unavailable state before V1 production.
2. `development_only`: must be unreachable in production and covered by an environment guard.
3. `fixture_only`: may be constructed only by tests or fixture smoke; no default runtime network client or registration.
4. `production_capable`: safe to retain, but its labels must reflect the real source accurately.
5. `explicit_unavailable`: acceptable only when the UI/API clearly reports unavailable and performs no simulated success.

## Verification

```bash
npm run test:v1-surfaces
npm run check:quick
npm run check:deploy
```

The verifier checks paths and markers, exact direct `mockData` imports, visible frontend fallback labels, server demo/mock/fixture boundaries, V1 owners, human-document coverage, and quality-gate wiring.

## Change Control

Any new demo, mock, fixture, catalog, seed, or fallback boundary must include all of:

1. A new or updated machine inventory entry.
2. Production classification and disposition.
3. At least one owning V1 task.
4. Human inventory update.
5. Passing `npm run test:v1-surfaces`.
