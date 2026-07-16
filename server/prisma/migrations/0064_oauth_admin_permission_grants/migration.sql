INSERT INTO "permissions" (
  "id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at"
) VALUES
  ('admin:auth:read', 'identity-access', 'oauth_operation', 'read', 'high', false, false, 'Read secret-free OAuth provider, account, and authorization operations', CURRENT_TIMESTAMP),
  ('admin:auth:manage', 'identity-access', 'oauth_operation', 'manage', 'critical', true, true, 'Control OAuth providers and safely revoke OAuth access', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level",
  "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator', 'admin:auth:read'),
  ('admin', 'admin:auth:read'),
  ('admin', 'admin:auth:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
