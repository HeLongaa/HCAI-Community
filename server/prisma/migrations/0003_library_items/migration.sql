-- CreateTable
CREATE TABLE "library_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" "PostSource" NOT NULL,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
