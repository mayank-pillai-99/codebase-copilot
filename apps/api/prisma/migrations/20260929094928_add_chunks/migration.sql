-- AlterEnum
ALTER TYPE "SnapshotStatus" ADD VALUE 'EMBEDDING';

-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "symbol_id" UUID,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,
    "header" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    -- Hand-edited: generated from search_text so it can never drift from the content.
    -- 'simple' keeps identifiers intact (no stemming or stop words).
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "search_text")) STORED,
    "embedding" vector(768),
    "embedding_model" TEXT,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chunks_snapshot_id_idx" ON "chunks"("snapshot_id");

-- CreateIndex
CREATE INDEX "chunks_file_id_idx" ON "chunks"("file_id");

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written indexes (Prisma can't express these):
-- HNSW for cosine-distance search over embeddings. Queries filter by snapshot, so they
-- enable pgvector's iterative index scans to keep returning results after filtering.
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);

-- GIN for full-text search.
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");
