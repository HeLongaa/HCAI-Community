CREATE TABLE "oauth_authorization_requests" (
  "id" TEXT NOT NULL,
  "state_hash" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "redirect_to" TEXT NOT NULL,
  "link_user_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oauth_authorization_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_authorization_requests_state_hash_key"
  ON "oauth_authorization_requests"("state_hash");

CREATE INDEX "oauth_authorization_requests_expires_at_consumed_at_idx"
  ON "oauth_authorization_requests"("expires_at", "consumed_at");

CREATE INDEX "oauth_authorization_requests_link_user_id_idx"
  ON "oauth_authorization_requests"("link_user_id");

ALTER TABLE "oauth_authorization_requests"
  ADD CONSTRAINT "oauth_authorization_requests_link_user_id_fkey"
  FOREIGN KEY ("link_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "auth_accounts"
    GROUP BY "user_id", "provider"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate OAuth provider bindings must be reconciled before migration 0050';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "auth_accounts_user_id_provider_key"
  ON "auth_accounts"("user_id", "provider");
