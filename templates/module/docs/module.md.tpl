# {{displayName}}

Owner task: `{{ownerTask}}`

Domain: `{{domain}}`

Model: `{{model}}`

Operation policy: `{{operationPolicy}}`

## Scope

This module is personal-account scoped. Cross-module writes must enter the owning application contract and reads must use owner-authorized, redacted projections.

## Definition Of Done

- [ ] Replace every `TODO(DX-SCAFFOLD)` and fail-closed `MODULE_NOT_IMPLEMENTED` path.
- [ ] Register routes, domain inventory, permissions, operation policy, mutation audit, request parser, Seed/Prisma adapters, OpenAPI, frontend navigation, and focused quality gate.
- [ ] Cover authentication, ownership, idempotency, audit, redaction, rate limits, recovery, mobile, and accessibility where applicable.
- [ ] Add seed and Prisma parity plus a fresh PostgreSQL integration test when persistence is applicable.
- [ ] Run `npm run check:module -- --manifest config/modules/{{id}}.module.json --stage complete` and the normal PR gate.
