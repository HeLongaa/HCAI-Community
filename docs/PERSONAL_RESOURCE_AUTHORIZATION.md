# Personal Resource Authorization

`IAM-01` centralizes object authorization in `server/src/auth/resourcePolicy.js`. The product remains personal-account-only: ownership is matched by stable user ID where available and by handle only for compatibility. There is no tenant, organization, team, membership, or tenant workspace scope.

The policy registry separates read and write, participant reads, public reads, and explicit elevated permissions. Unknown resource types and actions fail closed. User-owned resources hide unauthorized existence with `404`; known administrative resources use `403` so operators receive an actionable permission failure.

RBAC permits attempting an operation. Resource authorization decides whether the actor may access that particular object. Broad `admin:access` is not an automatic bypass: every policy must name its elevated read/write permission.

Field redaction is recursive and policy-owned. Media storage keys and signed URLs, chat encryption fields and prompts, creative Provider payloads and output URLs, user authentication fields, and sensitive accounting references are never returned by an elevated generic resource projection.

Repository migration is incremental. New and changed ownership checks must use `authorizeResource` or `requireResourceAccess`; the contract and matrix tests prove unauthorized read/write behavior for every registered core resource.
