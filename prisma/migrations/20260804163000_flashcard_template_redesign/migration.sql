-- Redesign FlashcardTemplate: age groups, template/layout types, fold layout extras into layoutDefinition

-- 1) Add new columns (nullable first for backfill)
ALTER TABLE "FlashcardTemplate" ADD COLUMN "templateType" TEXT;
ALTER TABLE "FlashcardTemplate" ADD COLUMN "layoutType" TEXT;
ALTER TABLE "FlashcardTemplate" ADD COLUMN "supportedAgeGroups" TEXT[];
ALTER TABLE "FlashcardTemplate" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "FlashcardTemplate" ADD COLUMN "pageSize" TEXT NOT NULL DEFAULT 'A6';
ALTER TABLE "FlashcardTemplate" ADD COLUMN "orientation" TEXT NOT NULL DEFAULT 'PORTRAIT';
ALTER TABLE "FlashcardTemplate" ADD COLUMN "thumbnail" TEXT;

-- 2) Backfill from legacy columns; nest removed JSON fields into layoutDefinition
UPDATE "FlashcardTemplate"
SET
  "templateType" = COALESCE("templateType", 'flashcard'),
  "layoutType" = COALESCE("layoutType", 'standard'),
  "supportedAgeGroups" = COALESCE(
    "supportedAgeGroups",
    ARRAY[("supportedAgeMin"::text || '-' || "supportedAgeMax"::text)]
  ),
  "tags" = COALESCE("tags", ARRAY[]::TEXT[]),
  "layoutDefinition" = (
    COALESCE("layoutDefinition", '{}'::jsonb)
    || jsonb_build_object(
      'editableComponents', "editableComponents",
      'componentHierarchy', "componentHierarchy",
      'componentConstraints', "componentConstraints",
      'renderingHints', "renderingHints",
      'defaultStyles', "defaultStyles"
    )
  );

-- 3) Enforce required columns
ALTER TABLE "FlashcardTemplate" ALTER COLUMN "templateType" SET NOT NULL;
ALTER TABLE "FlashcardTemplate" ALTER COLUMN "layoutType" SET NOT NULL;
ALTER TABLE "FlashcardTemplate" ALTER COLUMN "supportedAgeGroups" SET NOT NULL;
ALTER TABLE "FlashcardTemplate" ALTER COLUMN "tags" SET NOT NULL;
ALTER TABLE "FlashcardTemplate" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];

-- 4) Drop legacy index + columns
DROP INDEX IF EXISTS "FlashcardTemplate_supportedAgeMin_supportedAgeMax_idx";

ALTER TABLE "FlashcardTemplate" DROP COLUMN "supportedAgeMin";
ALTER TABLE "FlashcardTemplate" DROP COLUMN "supportedAgeMax";
ALTER TABLE "FlashcardTemplate" DROP COLUMN "editableComponents";
ALTER TABLE "FlashcardTemplate" DROP COLUMN "componentHierarchy";
ALTER TABLE "FlashcardTemplate" DROP COLUMN "componentConstraints";
ALTER TABLE "FlashcardTemplate" DROP COLUMN "renderingHints";
ALTER TABLE "FlashcardTemplate" DROP COLUMN "defaultStyles";

-- 5) New indexes
CREATE INDEX "FlashcardTemplate_templateType_idx" ON "FlashcardTemplate"("templateType");
CREATE INDEX "FlashcardTemplate_layoutType_idx" ON "FlashcardTemplate"("layoutType");
CREATE INDEX "FlashcardTemplate_supportedAgeGroups_idx" ON "FlashcardTemplate"("supportedAgeGroups");
