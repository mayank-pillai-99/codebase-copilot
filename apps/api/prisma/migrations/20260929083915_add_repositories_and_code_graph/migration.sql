-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('QUEUED', 'FETCHING', 'PARSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('CODE', 'DOC', 'CONFIG');

-- CreateEnum
CREATE TYPE "SymbolKind" AS ENUM ('FUNCTION', 'CLASS', 'METHOD', 'INTERFACE', 'TYPE', 'ENUM', 'VARIABLE');

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_repositories" (
    "user_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_repositories_pkey" PRIMARY KEY ("user_id","repository_id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'QUEUED',
    "failure_reason" TEXT,
    "progress" JSONB,
    "stats" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "language" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "line_count" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "has_errors" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symbols" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "kind" "SymbolKind" NOT NULL,
    "name" TEXT NOT NULL,
    "qualified_name" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,
    "exported" BOOLEAN NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "doc_comment" TEXT,

    CONSTRAINT "symbols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_edges" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "from_file_id" UUID NOT NULL,
    "to_file_id" UUID,
    "specifier" TEXT NOT NULL,
    "imported_names" TEXT[],
    "kind" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "external" BOOLEAN NOT NULL,
    "package_name" TEXT,

    CONSTRAINT "import_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_edges" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "from_symbol_id" UUID,
    "to_symbol_id" UUID,
    "callee_name" TEXT NOT NULL,
    "callee_text" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL,

    CONSTRAINT "call_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "handler_name" TEXT,
    "handler_symbol_id" UUID,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_owner_name_key" ON "repositories"("owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_repository_id_commit_sha_key" ON "snapshots"("repository_id", "commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "files_snapshot_id_path_key" ON "files"("snapshot_id", "path");

-- CreateIndex
CREATE INDEX "symbols_snapshot_id_name_idx" ON "symbols"("snapshot_id", "name");

-- CreateIndex
CREATE INDEX "symbols_file_id_idx" ON "symbols"("file_id");

-- CreateIndex
CREATE INDEX "import_edges_snapshot_id_idx" ON "import_edges"("snapshot_id");

-- CreateIndex
CREATE INDEX "import_edges_from_file_id_idx" ON "import_edges"("from_file_id");

-- CreateIndex
CREATE INDEX "import_edges_to_file_id_idx" ON "import_edges"("to_file_id");

-- CreateIndex
CREATE INDEX "call_edges_snapshot_id_idx" ON "call_edges"("snapshot_id");

-- CreateIndex
CREATE INDEX "call_edges_from_symbol_id_idx" ON "call_edges"("from_symbol_id");

-- CreateIndex
CREATE INDEX "call_edges_to_symbol_id_idx" ON "call_edges"("to_symbol_id");

-- CreateIndex
CREATE INDEX "routes_snapshot_id_idx" ON "routes"("snapshot_id");

-- AddForeignKey
ALTER TABLE "tracked_repositories" ADD CONSTRAINT "tracked_repositories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_repositories" ADD CONSTRAINT "tracked_repositories_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_edges" ADD CONSTRAINT "import_edges_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_edges" ADD CONSTRAINT "import_edges_from_file_id_fkey" FOREIGN KEY ("from_file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_edges" ADD CONSTRAINT "import_edges_to_file_id_fkey" FOREIGN KEY ("to_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_edges" ADD CONSTRAINT "call_edges_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_edges" ADD CONSTRAINT "call_edges_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_edges" ADD CONSTRAINT "call_edges_from_symbol_id_fkey" FOREIGN KEY ("from_symbol_id") REFERENCES "symbols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_edges" ADD CONSTRAINT "call_edges_to_symbol_id_fkey" FOREIGN KEY ("to_symbol_id") REFERENCES "symbols"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_handler_symbol_id_fkey" FOREIGN KEY ("handler_symbol_id") REFERENCES "symbols"("id") ON DELETE SET NULL ON UPDATE CASCADE;
