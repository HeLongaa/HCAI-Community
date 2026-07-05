CREATE TABLE "operation_leases" (
    "key" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "metadata" JSONB,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_leases_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "operation_leases_token_key" ON "operation_leases"("token");
CREATE INDEX "operation_leases_owner_id_idx" ON "operation_leases"("owner_id");
CREATE INDEX "operation_leases_expires_at_idx" ON "operation_leases"("expires_at");
