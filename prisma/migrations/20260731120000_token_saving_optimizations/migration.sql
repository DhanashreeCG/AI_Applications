-- Ingestion job dry-run / cost estimate fields
ALTER TABLE "IngestionJob" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'FULL';
ALTER TABLE "IngestionJob" ADD COLUMN "expectedGeminiCalls" INTEGER;
ALTER TABLE "IngestionJob" ADD COLUMN "expectedEmbeddingCalls" INTEGER;
ALTER TABLE "IngestionJob" ADD COLUMN "estimatedGeminiCostUsd" DOUBLE PRECISION;
ALTER TABLE "IngestionJob" ADD COLUMN "estimatedOpenAiCostUsd" DOUBLE PRECISION;
ALTER TABLE "IngestionJob" ADD COLUMN "estimatedTotalCostUsd" DOUBLE PRECISION;

-- Duplicate audit reason on AssetSource
ALTER TABLE "AssetSource" ADD COLUMN "linkReason" TEXT;

-- AI provider usage audit table
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsage_assetId_idx" ON "AiUsage"("assetId");
CREATE INDEX "AiUsage_stage_idx" ON "AiUsage"("stage");
CREATE INDEX "AiUsage_provider_idx" ON "AiUsage"("provider");
CREATE INDEX "AiUsage_status_idx" ON "AiUsage"("status");
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
