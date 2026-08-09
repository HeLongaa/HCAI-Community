CREATE INDEX "oauth_authorization_requests_retention_idx"
  ON "oauth_authorization_requests"("expires_at", "revoked_at", "id");

CREATE INDEX "refresh_tokens_retention_idx"
  ON "refresh_tokens"("expires_at", "revoked_at", "id");

CREATE INDEX "api_key_credentials_retention_idx"
  ON "api_key_credentials"("expires_at", "revoked_at", "id");
