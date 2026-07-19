# Route Navigation Contract

`ARC-02` defines the module-owned route grouping used by backend routes, Admin navigation, breadcrumbs, and deep links.

The executable source is `config/route-navigation-contract.json`; `npm run test:route-navigation-contract` verifies that every server route under `server/src/modules/**/routes.js` maps to one route group unless explicitly ignored.

Rules:

- Route groups are personal-account scoped and must not introduce tenant, organization, team, membership, or invitation navigation.
- Every API route belongs to exactly one module-facing group by prefix.
- Admin routes remain under the `admin` group and require `admin:access` for shell navigation; data routes still enforce their dedicated permissions.
- Deep-link keys are stable product locations, not authorization grants. The destination route must re-check owner, participant, or permission scope.
- Permission-aware discovery uses the `search` group at `/api/search`; Admin index operations remain under the protected `admin` group.
- `/health`, `/metrics`, and `/api/openapi.json` are operational/docs routes and are excluded from product navigation.
