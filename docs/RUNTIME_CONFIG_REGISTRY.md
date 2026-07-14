# Runtime Config Registry

Runtime configuration is registered before it is edited. Each registered key has a domain, scope, value type, schema version, default value, and publish strategy.

Secrets are never stored as configuration values. Runtime configuration may only reference managed secrets through `secretref://...` references.

`SystemSetting` stores the currently published value and schema version. Future settings UI work can add draft/review records without changing the registry contract.
