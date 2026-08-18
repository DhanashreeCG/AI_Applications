-- CreateEnum
CREATE TYPE "FlashcardSetStatus" AS ENUM ('GENERATED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FlashcardOutputFormat" AS ENUM ('PNG', 'WEBP', 'PDF');

-- CreateTable
CREATE TABLE "FlashcardSet" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "selection" JSONB NOT NULL,
    "templateSnapshot" JSONB NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "layoutDefinition" JSONB NOT NULL,
    "cards" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "renderedOutput" JSONB,
    "status" "FlashcardSetStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashcardSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashcardOutput" (
    "id" TEXT NOT NULL,
    "flashcardSetId" TEXT NOT NULL,
    "format" "FlashcardOutputFormat" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashcardOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlashcardSet_templateId_idx" ON "FlashcardSet"("templateId");

-- CreateIndex
CREATE INDEX "FlashcardSet_createdAt_idx" ON "FlashcardSet"("createdAt");

-- CreateIndex
CREATE INDEX "FlashcardSet_status_idx" ON "FlashcardSet"("status");

-- CreateIndex
CREATE INDEX "FlashcardOutput_flashcardSetId_idx" ON "FlashcardOutput"("flashcardSetId");

-- AddForeignKey
ALTER TABLE "FlashcardSet" ADD CONSTRAINT "FlashcardSet_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FlashcardTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardOutput" ADD CONSTRAINT "FlashcardOutput_flashcardSetId_fkey" FOREIGN KEY ("flashcardSetId") REFERENCES "FlashcardSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
