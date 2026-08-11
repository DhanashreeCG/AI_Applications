-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('CREATED', 'SCANNING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetState" AS ENUM ('DISCOVERED', 'DOWNLOADING', 'VALIDATING', 'HASHING', 'DUPLICATE_CHECK', 'UPLOADING_TO_S3', 'STORED_IN_S3', 'GENERATING_METADATA', 'METADATA_GENERATED', 'GENERATING_EMBEDDING', 'EMBEDDING_GENERATED', 'COMPLETED', 'FAILED', 'RETRY_PENDING', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'GOOGLE_DRIVE',
    "rootFolderId" TEXT NOT NULL,
    "status" "JobState" NOT NULL DEFAULT 'CREATED',
    "totalDiscovered" INTEGER NOT NULL DEFAULT 0,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalSuccessful" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "totalDuplicate" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionFile" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" BIGINT,
    "folderPath" TEXT,
    "driveFileCreatedAt" TIMESTAMP(3),
    "status" "AssetState" NOT NULL DEFAULT 'DISCOVERED',
    "errorMessage" TEXT,
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "s3Bucket" TEXT NOT NULL,
    "s3ObjectKey" TEXT NOT NULL,
    "status" "AssetState" NOT NULL DEFAULT 'STORED_IN_S3',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetSource" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ingestionFileId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'GOOGLE_DRIVE',
    "externalId" TEXT NOT NULL,
    "folderPath" TEXT,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMetadata" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "objects" TEXT[],
    "actions" TEXT[],
    "styles" TEXT[],
    "colors" TEXT[],
    "background" TEXT,
    "composition" TEXT,
    "orientation" TEXT,
    "ageGroups" TEXT[],
    "educationalUses" TEXT[],
    "searchKeywords" TEXT[],
    "searchDescription" TEXT NOT NULL,
    "searchDescriptionHash" TEXT NOT NULL,
    "rawResponse" JSONB,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "modelVersion" TEXT NOT NULL DEFAULT '1.0',
    "promptVersion" TEXT NOT NULL DEFAULT '1.0',
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEmbedding" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "dimensions" INTEGER NOT NULL DEFAULT 1536,
    "sourceTextHash" TEXT NOT NULL,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
    "vector" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingAttempt" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "ingestionFileId" TEXT,
    "stage" "AssetState" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "stackTrace" TEXT,
    "durationMs" INTEGER,
    "sqsMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionJob_status_idx" ON "IngestionJob"("status");

-- CreateIndex
CREATE INDEX "IngestionJob_createdAt_idx" ON "IngestionJob"("createdAt");

-- CreateIndex
CREATE INDEX "IngestionFile_driveFileId_idx" ON "IngestionFile"("driveFileId");

-- CreateIndex
CREATE INDEX "IngestionFile_status_idx" ON "IngestionFile"("status");

-- CreateIndex
CREATE INDEX "IngestionFile_assetId_idx" ON "IngestionFile"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionFile_jobId_driveFileId_key" ON "IngestionFile"("jobId", "driveFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_contentHash_key" ON "Asset"("contentHash");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_contentHash_idx" ON "Asset"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "AssetSource_ingestionFileId_key" ON "AssetSource"("ingestionFileId");

-- CreateIndex
CREATE INDEX "AssetSource_assetId_idx" ON "AssetSource"("assetId");

-- CreateIndex
CREATE INDEX "AssetSource_sourceType_externalId_idx" ON "AssetSource"("sourceType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetMetadata_assetId_key" ON "AssetMetadata"("assetId");

-- CreateIndex
CREATE INDEX "AssetMetadata_searchDescriptionHash_idx" ON "AssetMetadata"("searchDescriptionHash");

-- CreateIndex
CREATE INDEX "AssetEmbedding_assetId_idx" ON "AssetEmbedding"("assetId");

-- CreateIndex
CREATE INDEX "AssetEmbedding_sourceTextHash_idx" ON "AssetEmbedding"("sourceTextHash");

-- CreateIndex
CREATE INDEX "ProcessingAttempt_assetId_idx" ON "ProcessingAttempt"("assetId");

-- CreateIndex
CREATE INDEX "ProcessingAttempt_ingestionFileId_idx" ON "ProcessingAttempt"("ingestionFileId");

-- CreateIndex
CREATE INDEX "ProcessingAttempt_stage_idx" ON "ProcessingAttempt"("stage");

-- AddForeignKey
ALTER TABLE "IngestionFile" ADD CONSTRAINT "IngestionFile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IngestionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionFile" ADD CONSTRAINT "IngestionFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSource" ADD CONSTRAINT "AssetSource_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSource" ADD CONSTRAINT "AssetSource_ingestionFileId_fkey" FOREIGN KEY ("ingestionFileId") REFERENCES "IngestionFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMetadata" ADD CONSTRAINT "AssetMetadata_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEmbedding" ADD CONSTRAINT "AssetEmbedding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingAttempt" ADD CONSTRAINT "ProcessingAttempt_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingAttempt" ADD CONSTRAINT "ProcessingAttempt_ingestionFileId_fkey" FOREIGN KEY ("ingestionFileId") REFERENCES "IngestionFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
