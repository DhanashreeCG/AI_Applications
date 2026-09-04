-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN IF NOT EXISTS "cachedInputTokens" INTEGER;

-- AlterTable
ALTER TABLE "PipelineAiInvocation" ADD COLUMN IF NOT EXISTS "cachedInputTokens" INTEGER;
