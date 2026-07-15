# Runtime Config Registry

Runtime configuration is registered before it is edited. Each registered key has a domain, scope, value type, schema version, default value, and publish strategy.

Secrets are never stored as configuration values. Runtime configuration may only reference managed secrets through `secretref://...` references.

`SystemSetting` stores the current published projection. `SystemSettingChange` stores reviewed update and rollback requests with compare-and-set versions, while `SystemSettingRevision` preserves immutable publication evidence. The Admin surface exposes only keys in `config/runtime-config-registry.json`; internal policy rows that also use `system_settings` are not discoverable there.

Every object entry declares required and allowed properties, types, ranges, enums, and patterns. Unknown fields, invalid cross-field constraints, and inline secret material are rejected before a change can be requested.
