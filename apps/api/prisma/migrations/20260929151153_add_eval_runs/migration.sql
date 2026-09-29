-- CreateTable
CREATE TABLE "eval_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_runs_kind_created_at_idx" ON "eval_runs"("kind", "created_at");
