-- CreateTable
CREATE TABLE "snapshot_analyses" (
    "snapshot_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshot_analyses_pkey" PRIMARY KEY ("snapshot_id","kind")
);

-- AddForeignKey
ALTER TABLE "snapshot_analyses" ADD CONSTRAINT "snapshot_analyses_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
