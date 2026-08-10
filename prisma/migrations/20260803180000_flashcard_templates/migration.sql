-- Flashcard template system (layout metadata only)
CREATE TABLE "FlashcardTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "supportedAgeMin" INTEGER NOT NULL,
    "supportedAgeMax" INTEGER NOT NULL,
    "supportedGrades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "learningObjectives" TEXT[],
    "subjectsSupported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficultyLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "templateVersion" TEXT NOT NULL DEFAULT '1.0',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "layoutDefinition" JSONB NOT NULL,
    "editableComponents" JSONB NOT NULL,
    "componentHierarchy" JSONB NOT NULL,
    "componentConstraints" JSONB,
    "renderingHints" JSONB,
    "defaultStyles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashcardTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlashcardTemplate_name_templateVersion_key" ON "FlashcardTemplate"("name", "templateVersion");
CREATE INDEX "FlashcardTemplate_active_idx" ON "FlashcardTemplate"("active");
CREATE INDEX "FlashcardTemplate_supportedAgeMin_supportedAgeMax_idx" ON "FlashcardTemplate"("supportedAgeMin", "supportedAgeMax");

CREATE TABLE "TemplateSelectionRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ageMin" INTEGER,
    "ageMax" INTEGER,
    "grades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "learningObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSelectionRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TemplateSelectionRule_active_priority_idx" ON "TemplateSelectionRule"("active", "priority");
CREATE INDEX "TemplateSelectionRule_templateId_idx" ON "TemplateSelectionRule"("templateId");

ALTER TABLE "TemplateSelectionRule" ADD CONSTRAINT "TemplateSelectionRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FlashcardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
