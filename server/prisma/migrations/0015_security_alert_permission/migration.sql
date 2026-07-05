INSERT INTO "permissions" ("id", "description")
VALUES ('security:alerts:manage', NULL)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id")
VALUES ('admin', 'security:alerts:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
