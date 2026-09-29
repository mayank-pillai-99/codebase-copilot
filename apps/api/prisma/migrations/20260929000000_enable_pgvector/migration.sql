-- Hand-written: Prisma does not manage PostgreSQL extensions by default.
-- pgvector provides the `vector` type and similarity operators used for code embeddings.
CREATE EXTENSION IF NOT EXISTS vector;
