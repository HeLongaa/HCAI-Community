CREATE TABLE "developer_access_controls" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowed_scopes" TEXT[] DEFAULT ARRAY['developer:identity:read']::TEXT[],
    "max_service_accounts_per_user" INTEGER NOT NULL DEFAULT 5,
    "max_active_keys_per_account" INTEGER NOT NULL DEFAULT 3,
    "default_key_ttl_days" INTEGER NOT NULL DEFAULT 90,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reason_code" TEXT NOT NULL DEFAULT 'default_disabled',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_access_controls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "developer_access_controls_singleton_check" CHECK ("id" = 'global'),
    CONSTRAINT "developer_access_controls_accounts_bound_check" CHECK ("max_service_accounts_per_user" BETWEEN 1 AND 20),
    CONSTRAINT "developer_access_controls_keys_bound_check" CHECK ("max_active_keys_per_account" BETWEEN 1 AND 10),
    CONSTRAINT "developer_access_controls_ttl_bound_check" CHECK ("default_key_ttl_days" BETWEEN 1 AND 365)
);

INSERT INTO "developer_access_controls" ("id") VALUES ('global');

CREATE TABLE "service_accounts" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revoke_reason_code" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_accounts_status_check" CHECK ("status" IN ('active', 'revoked')),
    CONSTRAINT "service_accounts_name_length_check" CHECK (char_length("name") BETWEEN 2 AND 80),
    CONSTRAINT "service_accounts_description_length_check" CHECK (char_length("description") <= 240)
);

CREATE TABLE "api_key_credentials" (
    "id" TEXT NOT NULL,
    "service_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "last_used_ip_hash" TEXT,
    "usage_count" BIGINT NOT NULL DEFAULT 0,
    "revoke_reason_code" TEXT,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_key_credentials_status_check" CHECK ("status" IN ('active', 'rotated', 'revoked')),
    CONSTRAINT "api_key_credentials_name_length_check" CHECK (char_length("name") BETWEEN 2 AND 80),
    CONSTRAINT "api_key_credentials_hash_check" CHECK ("secret_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "api_key_credentials_usage_check" CHECK ("usage_count" >= 0)
);

CREATE UNIQUE INDEX "service_accounts_owner_user_id_name_key" ON "service_accounts"("owner_user_id", "name");
CREATE INDEX "service_accounts_owner_user_id_status_created_at_id_idx" ON "service_accounts"("owner_user_id", "status", "created_at", "id");
CREATE INDEX "service_accounts_status_created_at_id_idx" ON "service_accounts"("status", "created_at", "id");
CREATE UNIQUE INDEX "api_key_credentials_key_prefix_key" ON "api_key_credentials"("key_prefix");
CREATE INDEX "api_key_credentials_service_account_id_status_created_at_id_idx" ON "api_key_credentials"("service_account_id", "status", "created_at", "id");
CREATE INDEX "api_key_credentials_status_expires_at_id_idx" ON "api_key_credentials"("status", "expires_at", "id");

ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_key_credentials" ADD CONSTRAINT "api_key_credentials_service_account_id_fkey" FOREIGN KEY ("service_account_id") REFERENCES "service_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "resource", "action", "risk_level", "is_protected", "resource_authorization", "description", "created_at") VALUES
  ('developer:credentials:manage', 'developer-platform', 'service_account', 'manage', 'high', false, true, 'Manage actor-owned service accounts and one-time API keys', CURRENT_TIMESTAMP),
  ('admin:developer:read', 'developer-platform', 'service_account', 'read', 'high', false, false, 'Read safe service account, API key lifecycle, and usage projections', CURRENT_TIMESTAMP),
  ('admin:developer:manage', 'developer-platform', 'developer_access_control', 'manage', 'critical', true, true, 'Enable developer access and immediately revoke service accounts or API keys', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "module" = EXCLUDED."module", "resource" = EXCLUDED."resource", "action" = EXCLUDED."action", "risk_level" = EXCLUDED."risk_level", "is_protected" = EXCLUDED."is_protected", "resource_authorization" = EXCLUDED."resource_authorization", "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('member', 'developer:credentials:manage'),
  ('creator', 'developer:credentials:manage'),
  ('publisher', 'developer:credentials:manage'),
  ('moderator', 'developer:credentials:manage'),
  ('admin', 'developer:credentials:manage'),
  ('moderator', 'admin:developer:read'),
  ('admin', 'admin:developer:read'),
  ('admin', 'admin:developer:manage')
ON CONFLICT ("role", "permission_id") DO NOTHING;
