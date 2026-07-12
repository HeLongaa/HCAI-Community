-- CreateEnum
CREATE TYPE "ChatConversationStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ChatTurnStatus" AS ENUM ('queued', 'streaming', 'completed', 'stopped', 'interrupted', 'failed', 'blocked');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('complete', 'streaming', 'stopped', 'interrupted', 'failed', 'blocked');

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'active',
    "next_message_sequence" INTEGER NOT NULL DEFAULT 1,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retention_expires_at" TIMESTAMP(3) NOT NULL,
    "retention_hold_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_turns" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "generation_id" TEXT,
    "client_turn_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "ChatTurnStatus" NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "usage" JSONB,
    "stop_requested_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "status" "ChatMessageStatus" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "encryption_iv" TEXT NOT NULL,
    "authentication_tag" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "character_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_deletion_tombstones" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "owner_id" TEXT,
    "reason_code" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replay_until" TIMESTAMP(3) NOT NULL,
    "last_replayed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_deletion_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_conversations_owner_id_last_message_at_idx" ON "chat_conversations"("owner_id", "last_message_at");
CREATE INDEX "chat_conversations_status_retention_expires_at_idx" ON "chat_conversations"("status", "retention_expires_at");
CREATE UNIQUE INDEX "chat_turns_generation_id_key" ON "chat_turns"("generation_id");
CREATE UNIQUE INDEX "chat_turns_conversation_id_client_turn_id_key" ON "chat_turns"("conversation_id", "client_turn_id");
CREATE INDEX "chat_turns_conversation_id_created_at_idx" ON "chat_turns"("conversation_id", "created_at");
CREATE INDEX "chat_turns_status_updated_at_idx" ON "chat_turns"("status", "updated_at");
CREATE UNIQUE INDEX "chat_messages_conversation_id_sequence_key" ON "chat_messages"("conversation_id", "sequence");
CREATE INDEX "chat_messages_turn_id_role_idx" ON "chat_messages"("turn_id", "role");
CREATE UNIQUE INDEX "chat_deletion_tombstones_conversation_id_key" ON "chat_deletion_tombstones"("conversation_id");
CREATE INDEX "chat_deletion_tombstones_owner_id_requested_at_idx" ON "chat_deletion_tombstones"("owner_id", "requested_at");
CREATE INDEX "chat_deletion_tombstones_replay_until_idx" ON "chat_deletion_tombstones"("replay_until");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "creative_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "chat_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_deletion_tombstones" ADD CONSTRAINT "chat_deletion_tombstones_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
