# Data Relation and JSON Schema Contract

`DATA-02` keeps the product personal-account-only while tightening internal data integrity.

## JSON evolution

Every Prisma `Json` field has a sibling integer `<field>SchemaVersion` column mapped to `<field>_schema_version`. Version 1 preserves the existing JSON value shape and API response. A field owner must register and migrate a new version before writing it; unrelated JSON documents may evolve independently.

## Normalized media references

Three compatibility arrays now have FK-backed projections: task submission assets, creative generation input/output assets, and chat turn input assets. New Prisma writes update the legacy array and relation row in the same transaction. Relation rows include the personal owner, stable position, and restrictive media deletion semantics.

Migration `0041` backfills only IDs that resolve to an existing `MediaAsset`. Historical unknown values stay in compatibility arrays. Operators can reconcile them with an anti-join between each array and its relation table; deployment does not invent assets or discard evidence.

## Intentional non-FKs

Provider IDs are external identifiers. Audit/source/resource IDs are polymorphic evidence. Operation and idempotency keys are correlation identifiers. These families are registered in `config/data-schema-contract.json` instead of receiving misleading foreign keys.

Tenant, organization, team, membership, invitation, and tenant-style workspace entities are explicitly out of scope.
