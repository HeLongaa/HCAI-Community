# RBAC Permission Registry

The immutable registry in `server/src/auth/permissions.js` is the source of truth for stable permission IDs, module/resource/action metadata, risk, default role grants, protected grants, and whether object-level authorization is also required.

RBAC answers whether an actor may attempt an action. It does not grant access to a particular user-owned resource. Permissions marked `resourceAuthorization` must also pass the centralized resource policy introduced by `IAM-01`.

The compatibility exports `permissions`, `rolePermissions`, and `protectedRolePermissions` are derived from the registry. Database seed startup upserts the same metadata into `permissions`, while explicit role assignments remain mutable in `role_permissions`. Protected grants cannot be removed through the admin API.

Admin reads and writes use separate IDs where the current product exposes both behaviors. New permissions must be added to the registry before use in a route and must declare a risk level and resource-authorization requirement.
