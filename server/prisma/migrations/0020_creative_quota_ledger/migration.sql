-- CreateEnum
CREATE TYPE "CreativeQuotaReservationStatus" AS ENUM ('reserved', 'committed', 'released');

-- CreateTable
CREATE TABLE "creative_quota_windows" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_handle" TEXT,
    "workspace" TEXT NOT NULL,
    "window_type" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "limit_units" INTEGER NOT NULL,
    "reserved_units" INTEGER NOT NULL DEFAULT 0,
    "used_units" INTEGER NOT NULL DEFAULT 0,
    "released_units" INTEGER NOT NULL DEFAULT 0,
    "policy_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_quota_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_quota_reservations" (
    "id" TEXT NOT NULL,
    "quota_window_id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_handle" TEXT,
    "workspace" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "status" "CreativeQuotaReservationStatus" NOT NULL,
    "reason" TEXT,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_quota_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creative_quota_windows_actor_handle_workspace_window_type_window_start_key" ON "creative_quota_windows"("actor_handle", "workspace", "window_type", "window_start");

-- CreateIndex
CREATE INDEX "creative_quota_windows_actor_id_window_start_idx" ON "creative_quota_windows"("actor_id", "window_start");

-- CreateIndex
CREATE INDEX "creative_quota_windows_actor_handle_workspace_window_start_idx" ON "creative_quota_windows"("actor_handle", "workspace", "window_start");

-- CreateIndex
CREATE INDEX "creative_quota_windows_workspace_window_start_idx" ON "creative_quota_windows"("workspace", "window_start");

-- CreateIndex
CREATE INDEX "creative_quota_reservations_generation_id_idx" ON "creative_quota_reservations"("generation_id");

-- CreateIndex
CREATE INDEX "creative_quota_reservations_actor_handle_workspace_created_at_idx" ON "creative_quota_reservations"("actor_handle", "workspace", "created_at");

-- CreateIndex
CREATE INDEX "creative_quota_reservations_quota_window_id_status_idx" ON "creative_quota_reservations"("quota_window_id", "status");

-- AddForeignKey
ALTER TABLE "creative_quota_windows" ADD CONSTRAINT "creative_quota_windows_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_quota_reservations" ADD CONSTRAINT "creative_quota_reservations_quota_window_id_fkey" FOREIGN KEY ("quota_window_id") REFERENCES "creative_quota_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_quota_reservations" ADD CONSTRAINT "creative_quota_reservations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
