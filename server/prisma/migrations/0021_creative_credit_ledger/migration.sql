-- CreateEnum
CREATE TYPE "CreativeCreditLedgerStatus" AS ENUM ('reserved', 'settled', 'refunded', 'cancelled');

-- AlterTable
ALTER TABLE "creative_generations" ADD COLUMN "credit" JSONB;

-- CreateTable
CREATE TABLE "creative_credit_ledger" (
    "id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "quota_reservation_id" TEXT,
    "actor_id" TEXT,
    "actor_handle" TEXT,
    "workspace" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reservation_amount" INTEGER NOT NULL,
    "settled_amount" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "CreativeCreditLedgerStatus" NOT NULL,
    "reason_code" TEXT,
    "metadata" JSONB,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creative_credit_ledger_quota_reservation_id_key" ON "creative_credit_ledger"("quota_reservation_id");

-- CreateIndex
CREATE INDEX "creative_credit_ledger_generation_id_idx" ON "creative_credit_ledger"("generation_id");

-- CreateIndex
CREATE INDEX "creative_credit_ledger_actor_handle_workspace_created_at_idx" ON "creative_credit_ledger"("actor_handle", "workspace", "created_at");

-- CreateIndex
CREATE INDEX "creative_credit_ledger_status_created_at_idx" ON "creative_credit_ledger"("status", "created_at");

-- AddForeignKey
ALTER TABLE "creative_credit_ledger" ADD CONSTRAINT "creative_credit_ledger_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
