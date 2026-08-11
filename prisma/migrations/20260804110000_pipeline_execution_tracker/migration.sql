-- Pipeline execution tracker (observability only)
CREATE TYPE "PipelineExecutionStatus" AS ENUM ('running', 'completed', 'failed', 'cancelled');
CREATE TYPE "PipelineStageStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled');

CREATE TABLE "PipelineExecution" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "currentStage" TEXT,
    "status" "PipelineExecutionStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalDurationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PipelineExecution_requestId_idx" ON "PipelineExecution"("requestId");
CREATE INDEX "PipelineExecution_correlationId_idx" ON "PipelineExecution"("correlationId");
CREATE INDEX "PipelineExecution_status_idx" ON "PipelineExecution"("status");
CREATE INDEX "PipelineExecution_workflowType_idx" ON "PipelineExecution"("workflowType");
CREATE INDEX "PipelineExecution_createdAt_idx" ON "PipelineExecution"("createdAt");

CREATE TABLE "PipelineStageExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "PipelineStageStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStageExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PipelineStageExecution_executionId_sequence_idx" ON "PipelineStageExecution"("executionId", "sequence");
CREATE INDEX "PipelineStageExecution_executionId_stageName_idx" ON "PipelineStageExecution"("executionId", "stageName");
CREATE INDEX "PipelineStageExecution_status_idx" ON "PipelineStageExecution"("status");

ALTER TABLE "PipelineStageExecution" ADD CONSTRAINT "PipelineStageExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PipelineExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PipelineAiInvocation" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stageExecutionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "promptHash" TEXT,
    "responseHash" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "promptPayload" JSONB,
    "responsePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineAiInvocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PipelineAiInvocation_executionId_idx" ON "PipelineAiInvocation"("executionId");
CREATE INDEX "PipelineAiInvocation_stageExecutionId_idx" ON "PipelineAiInvocation"("stageExecutionId");
CREATE INDEX "PipelineAiInvocation_status_idx" ON "PipelineAiInvocation"("status");
CREATE INDEX "PipelineAiInvocation_provider_idx" ON "PipelineAiInvocation"("provider");

ALTER TABLE "PipelineAiInvocation" ADD CONSTRAINT "PipelineAiInvocation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PipelineExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAiInvocation" ADD CONSTRAINT "PipelineAiInvocation_stageExecutionId_fkey" FOREIGN KEY ("stageExecutionId") REFERENCES "PipelineStageExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PipelineImageSearchExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stageExecutionId" TEXT,
    "query" TEXT NOT NULL,
    "filters" JSONB,
    "durationMs" INTEGER,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "selectedAssetId" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineImageSearchExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PipelineImageSearchExecution_executionId_idx" ON "PipelineImageSearchExecution"("executionId");
CREATE INDEX "PipelineImageSearchExecution_stageExecutionId_idx" ON "PipelineImageSearchExecution"("stageExecutionId");
CREATE INDEX "PipelineImageSearchExecution_selectedAssetId_idx" ON "PipelineImageSearchExecution"("selectedAssetId");

ALTER TABLE "PipelineImageSearchExecution" ADD CONSTRAINT "PipelineImageSearchExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PipelineExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineImageSearchExecution" ADD CONSTRAINT "PipelineImageSearchExecution_stageExecutionId_fkey" FOREIGN KEY ("stageExecutionId") REFERENCES "PipelineStageExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
