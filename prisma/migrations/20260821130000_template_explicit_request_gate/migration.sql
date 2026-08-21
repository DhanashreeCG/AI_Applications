-- AlterTable
ALTER TABLE "FlashcardTemplate"
  ADD COLUMN "requires_explicit_request" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "explicit_request_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Tracing / handwriting layouts teach pencil control, not a topic, so they are
-- only appropriate when the request names them.
UPDATE "FlashcardTemplate"
SET
  "requires_explicit_request" = true,
  "explicit_request_keywords" = ARRAY[
    'tracing',
    'trace',
    'handwriting',
    'write',
    'writing',
    'pencil control',
    'letter',
    'letters',
    'alphabet',
    'alphabets',
    'number',
    'numbers',
    'digit',
    'digits'
  ]
WHERE
  "name" ILIKE '%trac%'
  OR "templateType" ILIKE '%trac%'
  OR EXISTS (
    SELECT 1
    FROM unnest("tags") AS tag
    WHERE tag ILIKE '%trac%' OR tag ILIKE '%handwriting%'
  );
