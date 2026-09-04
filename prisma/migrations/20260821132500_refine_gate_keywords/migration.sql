-- Authoritative per-template trigger terms for opt-in (tracing/handwriting)
-- layouts. Digit layouts must not unlock on "letter", and letter layouts must
-- not unlock on "number".
UPDATE "FlashcardTemplate"
SET "explicit_request_keywords" = CASE
  WHEN "templateType" ILIKE '%number%'
    OR "name" ILIKE '%number%'
    OR "name" ILIKE '%digit%'
  THEN ARRAY[
    'tracing',
    'trace',
    'handwriting',
    'pencil control',
    'write',
    'writing',
    'number',
    'numbers',
    'digit',
    'digits'
  ]
  ELSE ARRAY[
    'tracing',
    'trace',
    'handwriting',
    'pencil control',
    'write',
    'writing',
    'letter',
    'letters',
    'alphabet',
    'alphabets',
    'phonics',
    'sound',
    'sounds',
    'letter sound',
    'beginning sound',
    'starts with',
    'spelling'
  ]
END
WHERE "requires_explicit_request" = true;
