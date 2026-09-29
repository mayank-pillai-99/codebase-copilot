-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "snapshot_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "retriever" TEXT,
    "latency_ms" INTEGER,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_citations" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "marker" INTEGER NOT NULL,
    "chunk_id" UUID,
    "file_id" UUID NOT NULL,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,
    "label" TEXT,

    CONSTRAINT "message_citations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_snapshot_id_idx" ON "chat_sessions"("user_id", "snapshot_id");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "message_citations_message_id_idx" ON "message_citations"("message_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
