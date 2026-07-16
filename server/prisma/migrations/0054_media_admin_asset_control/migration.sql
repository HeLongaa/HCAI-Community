INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "created_at") VALUES
  ('admin:media:read', 'media-platform', 'media_asset', 'read', 'high', false, false, CURRENT_TIMESTAMP),
  ('admin:media:manage', 'media-platform', 'media_asset', 'manage', 'critical', false, true, CURRENT_TIMESTAMP),
  ('admin:media:export', 'media-platform', 'media_asset', 'export', 'critical', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
  "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected",
  "resource_authorization" = EXCLUDED."resource_authorization";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('moderator'::"UserRole", 'admin:media:read'),
  ('moderator'::"UserRole", 'admin:media:manage'),
  ('admin'::"UserRole", 'admin:media:read'),
  ('admin'::"UserRole", 'admin:media:manage'),
  ('admin'::"UserRole", 'admin:media:export')
ON CONFLICT ("role", "permission_id") DO NOTHING;
