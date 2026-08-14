-- CreateEnum
CREATE TYPE "WorksheetTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorksheetStatus" AS ENUM ('GENERATED', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorksheetOutputFormat" AS ENUM ('HTML', 'WEBP', 'PDF');

-- CreateTable
CREATE TABLE "WorksheetTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorksheetTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "templateHtml" TEXT NOT NULL,
    "structureDefinition" JSONB NOT NULL,
    "meta" JSONB,
    "rendererType" TEXT NOT NULL DEFAULT 'generic',
    "rendererConfig" JSONB,
    "aiConfig" JSONB,
    "fieldPrompts" JSONB,
    "aiSystemPrompt" TEXT,
    "backgroundAssetId" TEXT,
    "sampleAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "structure" JSONB NOT NULL,
    "status" "WorksheetStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worksheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetOutput" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "format" "WorksheetOutputFormat" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorksheetOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetTemplate_slug_key" ON "WorksheetTemplate"("slug");

-- CreateIndex
CREATE INDEX "WorksheetTemplate_status_idx" ON "WorksheetTemplate"("status");

-- CreateIndex
CREATE INDEX "WorksheetTemplate_category_idx" ON "WorksheetTemplate"("category");

-- CreateIndex
CREATE INDEX "Worksheet_templateId_idx" ON "Worksheet"("templateId");

-- CreateIndex
CREATE INDEX "Worksheet_createdAt_idx" ON "Worksheet"("createdAt");

-- CreateIndex
CREATE INDEX "Worksheet_status_idx" ON "Worksheet"("status");

-- CreateIndex
CREATE INDEX "WorksheetOutput_worksheetId_idx" ON "WorksheetOutput"("worksheetId");

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorksheetTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetOutput" ADD CONSTRAINT "WorksheetOutput_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
