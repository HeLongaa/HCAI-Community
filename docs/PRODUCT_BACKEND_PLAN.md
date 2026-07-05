# Productization Backend Plan

This plan turns the current front-end simulation into a product-ready API-backed platform without forcing a risky rewrite.

## Goals

- Replace static mock state with stable API contracts.
- Persist users, public profiles, tasks, proposals, submissions, posts, comments, library items, and point ledger entries.
- Add authentication, authorization, task state transitions, audit events, and admin review workflows.
- Keep the current front-end feature set working while moving one workflow at a time from mock data to API data.

## Recommended Stack

- Runtime: Node.js
- Framework: NestJS or Fastify
- Database: PostgreSQL
- ORM: Prisma
- Cache/session/rate limit: Redis
- File storage: S3-compatible storage such as Cloudflare R2 or AWS S3
- Validation: Zod or framework-native DTO validation
- API documentation: OpenAPI

## Backend Modules

- `auth`: login, refresh tokens, logout, current user, OAuth adapters.
- `users`: account records, public profiles, creator capabilities, rankings.
- `tasks`: task publishing, matching, proposals, claiming, submissions, reviews, state transitions.
- `community`: forum posts, comments, votes, likes, solved status, task conversion.
- `library`: saved inspirations, templates, prompts, tutorials, reusable assets.
- `points`: balances, pending rewards, point ledger, settlement rules.
- `admin`: moderation queues, task reviews, reports, user actions, audit trail.
- `media`: uploads, attachments, delivery packages, generated assets.

## Implementation Phases

Current implementation note:

- Phase 1 contract/schema work is in place through `docs/API_DESIGN.md`, `docs/DATA_MODEL_AND_AUTH.md`, and OpenAPI skeletons.
- Phase 2 backend skeleton is implemented in `server/`, including routing, envelope responses, validation, auth context, Prisma setup, seed data, repository abstraction, and tests.
- Phase 3 authentication/authorization is partially implemented with demo login, refresh/logout, `/api/me`, route guards, persisted role permissions, and admin permission management.
- Parts of Phase 4/5/6 are already started: task lifecycle endpoints, community/library endpoints, points ledger, audit events, admin review queues, and admin role permission management.

### Phase 1: API Contract And Schema

- Finalize REST contracts in `docs/API_DESIGN.md`.
- Finalize PostgreSQL tables in `docs/DATA_MODEL_AND_AUTH.md`.
- Add OpenAPI skeleton.
- Decide environment naming and deployment targets.

Exit criteria:

- Every current front-end simulated action maps to a named API endpoint.
- Every current mock data entity maps to a persisted model or explicitly remains local-only.

### Phase 2: Backend Skeleton

- Create `server/` package.
- Add health endpoint, request validation, error format, auth middleware, Prisma setup, and seed data.
- Add module folders matching the backend modules.

Exit criteria:

- `GET /health` works.
- Prisma migration creates the core tables.
- Seed data can reproduce enough content for the current UI.

### Phase 3: Authentication And Authorization

- Implement email/password or OAuth login adapter.
- Add access token and refresh token flow.
- Implement role and permission guards.
- Add current-user endpoint.

Exit criteria:

- Front end can replace simulated login with `/api/auth/login` and `/api/me`.
- Admin route visibility can come from server-side role.

### Phase 4: Task Lifecycle

- Implement tasks, proposals, submissions, reviews, task events, and points settlement.
- Enforce transitions through backend state machine.
- Add audit logs for every task state change.

Exit criteria:

- Publish, claim/propose, submit, approve, reject, and points update work through API.

### Phase 5: Community And Library

- Implement posts, comments, likes, saves, solved state, and post-to-task conversion.
- Persist library items.

Exit criteria:

- Current forum and inspiration flows no longer depend on static mock data.

### Phase 6: Admin, Media, And Hardening

- Add admin queues and moderation actions.
- Add file upload signing and persisted attachment references.
- Add rate limits, audit exports, pagination defaults, and monitoring hooks.

Exit criteria:

- Admin review center uses real queues.
- Attachments and delivery packages are persisted outside the app server.

## Front-End Migration Strategy

Use an adapter layer before replacing hooks directly:

```text
mockData
  -> service interfaces
  -> mock service adapters
  -> real API adapters
  -> React Query hooks
```

Recommended files:

```text
src/services/apiClient.ts
src/services/taskService.ts
src/services/communityService.ts
src/services/authService.ts
src/services/profileService.ts
src/services/pointsService.ts
```

Migration order:

1. Add services with mock adapters that return current mock data.
2. Replace direct mock imports in hooks with service calls.
3. Add loading/error states where remote calls are used.
4. Switch adapters endpoint by endpoint to real API.

## Product Risks

- Task settlement touches user rewards, so task state changes and point ledger entries must be transactional.
- Role checks must be action-based, not only page-based.
- Community-to-task conversion can create duplicate tasks unless idempotency keys are used.
- File uploads need signed URLs and virus/content policy checks before public exposure.
- Public profiles should expose only approved fields.

## Immediate Next Step

Next implementation step: wire proposal/submission workflows into the typed frontend service layer, replace mock media upload contracts with a real object storage signer, and add stronger accounting constraints for publisher escrow.
