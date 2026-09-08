-- CreateTable
CREATE TABLE "WorksheetTemplateSelectionProfile" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateSlug" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "primaryUse" TEXT NOT NULL,
    "canBeUsedFor" TEXT[],
    "exampleTopics" TEXT[],
    "adaptationNote" TEXT NOT NULL,
    "skillsPracticed" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetTemplateSelectionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetTemplateSelectionProfile_templateId_key" ON "WorksheetTemplateSelectionProfile"("templateId");

-- CreateIndex
CREATE INDEX "WorksheetTemplateSelectionProfile_templateSlug_idx" ON "WorksheetTemplateSelectionProfile"("templateSlug");

-- AddForeignKey
ALTER TABLE "WorksheetTemplateSelectionProfile" ADD CONSTRAINT "WorksheetTemplateSelectionProfile_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorksheetTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
