-- AlterTable
ALTER TABLE "TemplateSelectionRule" ADD COLUMN "is_fallback" BOOLEAN NOT NULL DEFAULT false;

-- Last-resort catch-all only; must not compete with topical rules.
UPDATE "TemplateSelectionRule"
SET "is_fallback" = true
WHERE name = 'Fallback - Default Vocabulary Card';
