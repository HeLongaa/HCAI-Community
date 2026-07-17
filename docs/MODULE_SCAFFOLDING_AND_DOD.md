# Module Scaffolding And Definition Of Done

`DX-01` provides a repeatable module bootstrap and a fail-closed completion check. The executable contract is `config/module-scaffolding-contract.json`.

## Generate A Module

Start from `templates/module/module-spec.example.json`, choose an existing owning domain from `config/domain-boundaries.json`, then preview the write set:

```bash
npm run scaffold:module -- --spec ./module-spec.json --dry-run
```

Create the skeleton only after reviewing that plan:

```bash
npm run scaffold:module -- --spec ./module-spec.json
```

The generator creates backend transport, application, domain, repository-port and OpenAPI fragments; frontend page, service and contracts; API and E2E tests; module documentation; and a machine-readable definition under `config/modules/`. It refuses unknown domains, unsupported operation policies, invalid permissions, shared-account scope names, path traversal, and every pre-existing target. It never edits integration registries implicitly.

## Completion Stages

The generated definition supports two checks:

```bash
npm run check:module -- --manifest config/modules/<id>.module.json --stage scaffold
npm run check:module -- --manifest config/modules/<id>.module.json --stage complete
```

`scaffold` proves the declared artifact set exists. `complete` additionally fails while scaffold markers remain or while route registration, architecture inventory, permissions, data operation policy, mutation audit classification, bounded request parsing, Seed/Prisma adapters, OpenAPI, frontend navigation, focused tests, or the quick gate lack explicit evidence.

The generated API mutation is intentionally unavailable until request parsing, authorization, ownership, idempotency, audit and repository behavior are implemented. Production-capable persistence also requires seed/Prisma parity and fresh PostgreSQL evidence. The normal `CI=1 npm run check:pr` remains mandatory after the focused completion check.

## Boundaries

All generated modules are personal-account scoped. The generator does not create shared account containers, real-money flows, Provider calls, database models, or migrations. Those require their owning task's explicit contract and review.
