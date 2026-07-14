# Admin Resource Framework

`ADMIN-01` defines the operation-policy-aware Admin resource framework.

The executable source is `config/admin-resource-framework-contract.json`; `npm run test:admin-resource-framework` verifies that every registered Admin resource has a data operation policy, existing routes, and derived safe capabilities.

Policy mapping:

- `mutable_crud`: list, detail, create, update, soft delete, export; hard delete only when the entity policy explicitly allows it.
- `state_transition`: list, detail, declared transitions, retry, cancel, export; no arbitrary row update or hard delete.
- `soft_delete`: list, detail, archive, restore, export.
- `append_only`: list, detail, export, and registered recovery/replay only; no create/update/delete from generic Admin UI.
- `immutable_evidence`: list, detail, export only.

The framework is a capability projection, not a permission bypass. Every route still applies its route-level permission and repository-level owner/resource checks. Batch operations and JobRun-backed impact previews remain `ADMIN-02`.

